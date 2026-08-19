import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Typography, Input, Tooltip, Badge, Spin, Switch, Select, Modal, Card, Space, Button, Divider, Alert } from 'antd';
import dayjs from 'dayjs';
import {
  RobotOutlined,
  SendOutlined,
  CloseOutlined,
  BulbOutlined,
  ThunderboltOutlined,
  LoadingOutlined,
  FileAddOutlined,
  SearchOutlined,
  UserOutlined,
  SettingOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { APEX_DB_CONFIG } from '../config/api.config';
import { buildApexUrl } from '../config/api.helper';

const { Text } = Typography;
const { TextArea } = Input;

// Oracle Redwood Color Palette
const REDWOOD = {
  primary: '#C74634',
  primaryLight: '#E85D4A',
  success: '#1D7B4D',
  warning: '#D4A800',
  info: '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral300: '#C7C7C7',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface: '#FFFFFF',
  autopilotPurple: '#6B4EFF',
  autopilotGradient: 'linear-gradient(135deg, #6B4EFF 0%, #9D4EDD 100%)',
};

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface SuggestionItem {
  icon: React.ReactNode;
  label: string;
  command: string;
}

const glSuggestions: SuggestionItem[] = [
  { icon: <ThunderboltOutlined />, label: 'Sync journal batches', command: 'Sync all journal batches from Oracle Fusion' },
  { icon: <BulbOutlined />, label: 'Create journal entry', command: 'Help me create a new journal entry' },
  { icon: <ThunderboltOutlined />, label: 'Run trial balance', command: 'Generate trial balance report for current period' },
  { icon: <BulbOutlined />, label: 'Check period status', command: 'What is the current period status?' },
];

const apSuggestions: SuggestionItem[] = [
  { icon: <FileAddOutlined />, label: 'Quick Entry Invoice', command: 'Quick Entry Invoice' },
  { icon: <ThunderboltOutlined />, label: 'Create Payable Invoice', command: 'Create Payable Invoice' },
  { icon: <BulbOutlined />, label: 'Manage Invoices', command: 'Open Manage Invoices' },
  { icon: <ThunderboltOutlined />, label: 'Manage Payments', command: 'Open Manage Payments' },
  { icon: <BulbOutlined />, label: 'Manage Suppliers', command: 'Open Manage Suppliers' },
];

// Quick Entry flow steps
type QuickEntryStep = 'idle' | 'awaiting_supplier' | 'awaiting_amount' | 'awaiting_description' | 'confirming';

interface QuickEntryData {
  supplierInput: string;
  supplierName: string;
  supplierNumber: string;
  amount: number;
  description: string;
}

// Supplier record shape (minimal for matching)
interface SupplierMatch {
  supplier: string;
  supplierNumber: string;
  alternativeName?: string;
}

interface MCPServer {
  id: string;
  name: string;
  description: string;
  type: 'SOAP' | 'REST';
  status: 'active' | 'inactive';
  config: any;
}

interface AutopilotProps {
  module?: 'gl' | 'ap';
  externalOpen?: boolean;       // when provided, hides the built-in button; open state is driven externally
  onExternalClose?: () => void; // called when user closes the panel (so parent can sync state)
}

const Autopilot: React.FC<AutopilotProps> = ({ module = 'gl', externalOpen, onExternalClose }) => {
  const isControlled = externalOpen !== undefined;
  const navigate = useNavigate();
  const suggestions = module === 'ap' ? apSuggestions : glSuggestions;
  const welcomeMessage = module === 'ap'
    ? 'Hello! I\'m your Payables Autopilot assistant. I can help you create invoices, manage payments, look up suppliers, and more. What would you like to do?'
    : 'Hello! I\'m your ERP Autopilot assistant. I can help you with tasks like syncing data, creating journal entries, running reports, and more. What would you like to do?';

  // Quick Entry state
  const [qeStep, setQeStep] = useState<QuickEntryStep>('idle');
  const [qeData, setQeData] = useState<QuickEntryData>({ supplierInput: '', supplierName: '', supplierNumber: '', amount: 0, description: '' });
  const [supplierCache, setSupplierCache] = useState<SupplierMatch[]>([]);
  const [suppliersFetching, setSuppliersFetching] = useState(false);
  // Live supplier suggestions (filtered as user types)
  const [supplierSuggestions, setSupplierSuggestions] = useState<SupplierMatch[]>([]);

  // Claude AI and MCP integration
  const [claudeEnabled, setClaudeEnabled] = useState(() => {
    return localStorage.getItem('autopilot_claude_enabled') === 'true';
  });
  const [claudeApiKey, setClaudeApiKey] = useState(() => {
    return localStorage.getItem('claude_api_key') || '';
  });
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([]);
  const [selectedMcpServer, setSelectedMcpServer] = useState<string>(() => {
    return localStorage.getItem('autopilot_selected_mcp_server') || '';
  });
  const [loadingMcpServers, setLoadingMcpServers] = useState(false);
  const [showMcpSettings, setShowMcpSettings] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);
  const [testingApiKey, setTestingApiKey] = useState(false);
  const [apiKeyTestResult, setApiKeyTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showAddMcpServer, setShowAddMcpServer] = useState(false);
  const [newMcpServerName, setNewMcpServerName] = useState('');
  const [newMcpServerUrl, setNewMcpServerUrl] = useState('');

  // Load MCP servers on mount
  useEffect(() => {
    loadMcpServers();
  }, []);

  // Check if Claude is enabled but no API key
  useEffect(() => {
    if (claudeEnabled && !claudeApiKey) {
      setApiKeyMissing(true);
      setClaudeEnabled(false);
    } else {
      setApiKeyMissing(false);
    }
  }, [claudeEnabled, claudeApiKey]);

  const loadMcpServers = async () => {
    setLoadingMcpServers(true);
    try {
      const response = await fetch(buildApexUrl('mcp-servers'), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const data = await response.json();
        const servers = (data.items || data || []).filter((s: MCPServer) => s.status === 'active');
        setMcpServers(servers);
      }
    } catch (error) {
      console.error('Error loading MCP servers:', error);
    } finally {
      setLoadingMcpServers(false);
    }
  };

  const addNewMcpServer = async () => {
    if (!newMcpServerName.trim() || !newMcpServerUrl.trim()) {
      Modal.error({
        title: 'Missing Information',
        content: 'Please enter both MCP Server name and URL',
      });
      return;
    }

    try {
      const response = await fetch(buildApexUrl('mcp-servers'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newMcpServerName,
          url: newMcpServerUrl,
          type: 'REST',
          status: 'active',
        }),
      });

      if (response.ok) {
        Modal.success({
          title: 'Success',
          content: 'MCP Server added successfully!',
        });
        setNewMcpServerName('');
        setNewMcpServerUrl('');
        setShowAddMcpServer(false);
        await loadMcpServers();
      } else {
        Modal.error({
          title: 'Error',
          content: 'Failed to add MCP Server',
        });
      }
    } catch (error) {
      console.error('Error adding MCP server:', error);
      Modal.error({
        title: 'Error',
        content: `Failed to add MCP Server: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    }
  };

  const fetchClaudeKeyFromServer = async () => {
    try {
      const response = await fetch('https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp/settings/claudekey', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const data = await response.json();
        const key = data.claude_api_key || data.key || data.apiKey || '';
        if (key) {
          setClaudeApiKey(key);
          localStorage.setItem('claude_api_key', key);
          setClaudeEnabled(true);
          localStorage.setItem('autopilot_claude_enabled', 'true');
        }
      }
    } catch (error) {
      console.error('Error fetching Claude key:', error);
    }
  };

  // Fetch Claude key when settings modal opens
  useEffect(() => {
    if (showMcpSettings && !claudeApiKey) {
      fetchClaudeKeyFromServer();
    }
  }, [showMcpSettings, claudeApiKey]);

  const testClaudeApiKey = async () => {
    if (!claudeApiKey) {
      setApiKeyTestResult({ success: false, message: 'No API key to test' });
      return;
    }

    setTestingApiKey(true);
    setApiKeyTestResult(null);

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': claudeApiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          max_tokens: 100,
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      });

      if (response.ok) {
        setApiKeyTestResult({
          success: true,
          message: '✓ Claude API key is valid and working correctly',
        });
      } else {
        const errorData = await response.json();
        setApiKeyTestResult({
          success: false,
          message: `✗ API error: ${errorData.error?.message || 'Unknown error'}`,
        });
      }
    } catch (error) {
      setApiKeyTestResult({
        success: false,
        message: `✗ Connection error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      });
    } finally {
      setTestingApiKey(false);
    }
  };

  const handleClaudeToggle = (checked: boolean) => {
    if (checked && !claudeApiKey) {
      Modal.info({
        title: 'Claude API Key Required',
        content: 'Please add your Claude API key in the settings. Go to Admin > Claude Key Settings.',
        okText: 'OK',
      });
      return;
    }
    setClaudeEnabled(checked);
    localStorage.setItem('autopilot_claude_enabled', checked ? 'true' : 'false');
  };

  const handleMcpServerSelect = (serverId: string) => {
    setSelectedMcpServer(serverId);
    localStorage.setItem('autopilot_selected_mcp_server', serverId);
  };

  const callClaudeApi = async (userMessage: string, conversationContext: string): Promise<string> => {
    if (!claudeApiKey) {
      throw new Error('Claude API key not configured');
    }

    let mcpContext = '';
    if (selectedMcpServer) {
      const selectedServer = mcpServers.find(s => s.id === selectedMcpServer);
      if (selectedServer) {
        mcpContext = `\n\nYou have access to an MCP Server:
- Name: ${selectedServer.name}
- Type: ${selectedServer.type}
- Description: ${selectedServer.description}
- Status: ${selectedServer.status}

You can use this MCP server to enhance your responses with external integrations. When relevant to the user's question, leverage the MCP server's capabilities to provide better answers.`;
      }
    }

    const systemPrompt = module === 'ap'
      ? 'You are an expert Payables Autopilot assistant helping with invoice creation, payment processing, and supplier management. Be concise and actionable. Provide step-by-step guidance when needed.'
      : 'You are an expert GL (General Ledger) Autopilot assistant helping with journal entries, data synchronization, and financial reporting. Be concise and actionable.';

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': claudeApiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-5',
          max_tokens: 1024,
          system: systemPrompt + mcpContext,
          messages: [
            { role: 'user', content: `${conversationContext}\n\nUser: ${userMessage}` }
          ],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`Claude API error: ${errorData.error?.message || 'Unknown error'}`);
      }

      const data = await response.json();
      return data.content[0]?.text || 'No response from Claude';
    } catch (error) {
      console.error('Claude API error:', error);
      throw error;
    }
  };

  const fetchSuppliersForMatch = async (): Promise<SupplierMatch[]> => {
    if (supplierCache.length > 0) return supplierCache;
    setSuppliersFetching(true);
    try {
      const response = await fetch(`${APEX_DB_CONFIG.baseUrl}/suppliers`, { headers: { Accept: 'application/json' } });
      if (!response.ok) return [];
      const data = await response.json();
      const items = data.items || data || [];
      const mapped: SupplierMatch[] = (items as any[]).map((item: any) => ({
        supplier: item.supplier || '',
        supplierNumber: item.supplier_number || '',
        alternativeName: item.alternate_name || '',
      }));
      setSupplierCache(mapped);
      return mapped;
    } catch {
      return [];
    } finally {
      setSuppliersFetching(false);
    }
  };

  const findSupplierMatch = (input: string, suppliers: SupplierMatch[]): SupplierMatch | null => {
    const search = input.toLowerCase().trim();
    // Exact match first
    const exact = suppliers.find(
      (s) => s.supplier.toLowerCase() === search || s.supplierNumber.toLowerCase() === search
    );
    if (exact) return exact;
    // Partial match
    const partial = suppliers.find(
      (s) =>
        s.supplier.toLowerCase().includes(search) ||
        s.supplierNumber.toLowerCase().includes(search) ||
        (s.alternativeName && s.alternativeName.toLowerCase().includes(search))
    );
    return partial || null;
  };

  // Filter suppliers as user types (for live suggestions)
  const filterSuppliers = useCallback((text: string) => {
    if (!text.trim() || text.trim().length < 1) {
      setSupplierSuggestions([]);
      return;
    }
    const search = text.toLowerCase().trim();
    const filtered = supplierCache.filter(
      (s) =>
        s.supplier.toLowerCase().includes(search) ||
        s.supplierNumber.toLowerCase().includes(search) ||
        (s.alternativeName && s.alternativeName.toLowerCase().includes(search))
    );
    setSupplierSuggestions(filtered.slice(0, 8));
  }, [supplierCache]);

  // Try to parse a one-shot command like "create invoice Acme 5000 office supplies"
  const tryParseOneShotEntry = (input: string): { supplier: string; amount: number; description: string } | null => {
    const amountMatch = input.match(/[\s,](\d[\d,]*\.?\d*)\s/);
    if (!amountMatch) return null;

    const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
    if (isNaN(amount) || amount <= 0) return null;

    const amountIdx = input.indexOf(amountMatch[0]);
    const beforeAmount = input.substring(0, amountIdx).trim();
    const afterAmount = input.substring(amountIdx + amountMatch[0].length).trim();

    const supplierText = beforeAmount
      .replace(/^(create|new|add|make|quick)\s+(entry\s+)?(invoice\s+)?(for\s+)?/i, '')
      .trim();

    return {
      supplier: supplierText || '',
      amount,
      description: afterAmount || '',
    };
  };

  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'assistant',
      content: welcomeMessage,
      timestamp: new Date(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Sync with external open state
  useEffect(() => {
    if (isControlled) {
      if (externalOpen && !isOpen) { setIsOpen(true); setIsClosing(false); }
      if (!externalOpen && isOpen) { setIsClosing(true); setTimeout(() => { setIsOpen(false); setIsClosing(false); }, 250); }
    }
  }, [externalOpen, isControlled]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
    }, 250);
    if (isControlled && onExternalClose) onExternalClose();
  };

  const handleOpen = () => {
    setIsClosing(false);
    // Reset conversation on reopen so suggestions show and it feels fresh
    setMessages([
      {
        id: Date.now().toString(),
        type: 'assistant',
        content: welcomeMessage,
        timestamp: new Date(),
      },
    ]);
    setInputValue('');
    setQeStep('idle');
    setSupplierSuggestions([]);
    setIsOpen(true);
  };

  const addAssistantMessage = (content: string) => {
    setMessages((prev) => [...prev, {
      id: (Date.now() + Math.random()).toString(),
      type: 'assistant',
      content,
      timestamp: new Date(),
    }]);
  };

  const createInvoiceFromQuickEntry = (data: QuickEntryData) => {
    const today = dayjs();
    const invoiceNum = `QE-${today.format('YYYYMMDD')}-${Math.floor(Math.random() * 9000 + 1000)}`;

    // Close first, then navigate after animation completes
    setIsClosing(true);
    setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
      setQeStep('idle');
      setSupplierSuggestions([]);

      navigate('/ap/manage-invoices', {
        state: {
          quickCreate: true,
          quickCreateData: {
            supplier: data.supplierName,
            supplierNumber: data.supplierNumber,
            businessUnit: 'BUIMERC CORP FZE_JAFZA',
            invoiceNumber: invoiceNum,
            invoiceAmount: data.amount,
            invoiceDate: today.toISOString(),
            description: data.description,
            invoiceCurrency: 'AED',
            invoiceType: 'Standard',
          },
        },
      });
    }, 300);
  };

  // Handle clicking a supplier suggestion chip
  const handleSupplierSelect = (supplier: SupplierMatch) => {
    setSupplierSuggestions([]);
    setInputValue('');
    // Add user message showing the selected supplier
    setMessages((prev) => [...prev, {
      id: Date.now().toString(),
      type: 'user',
      content: supplier.supplier,
      timestamp: new Date(),
    }]);
    // Set data and advance to amount step
    setQeData((prev) => ({
      ...prev,
      supplierInput: supplier.supplier,
      supplierName: supplier.supplier,
      supplierNumber: supplier.supplierNumber,
    }));
    setQeStep('awaiting_amount');
    addAssistantMessage(`Selected: ${supplier.supplier} (${supplier.supplierNumber})\n\nEnter the invoice amount:`);
  };

  const buildConversationContext = (): string => {
    return messages
      .slice(-6) // Last 6 messages for context
      .map(m => `${m.type === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n');
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isProcessing) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      type: 'user',
      content: inputValue.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const userInput = inputValue.trim();
    setInputValue('');
    setSupplierSuggestions([]);
    setIsProcessing(true);

    try {
      // Handle Quick Entry conversational flow
      if (qeStep !== 'idle') {
        await handleQuickEntryStep(userInput);
        setIsProcessing(false);
        return;
      }

      // Check if this is a one-shot quick entry (e.g. "invoice Acme 5000 office supplies")
      const lowerInput = userInput.toLowerCase();
      if (lowerInput.includes('quick entry') || lowerInput.includes('quick invoice')) {
        await fetchSuppliersForMatch(); // pre-fetch
        setQeStep('awaiting_supplier');
        addAssistantMessage('Let\'s create an invoice quickly!\n\nStart typing the supplier name or number:');
        setIsProcessing(false);
        return;
      }

      // Try one-shot parse: "invoice Acme 5000 office supplies"
      const oneShot = tryParseOneShotEntry(userInput);
      if (oneShot && oneShot.supplier && oneShot.amount > 0) {
        const suppliers = await fetchSuppliersForMatch();
        const match = findSupplierMatch(oneShot.supplier, suppliers);
        if (match) {
          const data: QuickEntryData = {
            supplierInput: oneShot.supplier,
            supplierName: match.supplier,
            supplierNumber: match.supplierNumber,
            amount: oneShot.amount,
            description: oneShot.description || 'Invoice',
          };
          setQeData(data);
          addAssistantMessage(
            `Got it! Creating invoice:\n\n` +
            `Supplier: ${match.supplier} (${match.supplierNumber})\n` +
            `Amount: ${oneShot.amount.toFixed(2)} AED\n` +
            `Description: ${oneShot.description || 'Invoice'}\n` +
            `Date: ${dayjs().format('DD-MMM-YYYY')} (today)\n` +
            `Tax: None\n\n` +
            `Opening invoice form now...`
          );
          createInvoiceFromQuickEntry(data);
          setIsProcessing(false);
          return;
        } else {
          // Supplier not found, start conversational flow
          setQeData((prev) => ({ ...prev, amount: oneShot.amount, description: oneShot.description }));
          setQeStep('awaiting_supplier');
          addAssistantMessage(
            `I couldn't find supplier "${oneShot.supplier}". ` +
            `Start typing the supplier name or number:`
          );
          setIsProcessing(false);
          return;
        }
      }

      // Use Claude if enabled, otherwise fall back to built-in responses
      if (claudeEnabled && claudeApiKey) {
        try {
          const response = await callClaudeApi(userInput, buildConversationContext());
          addAssistantMessage(response);
        } catch (error) {
          addAssistantMessage(`Error calling Claude: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      } else {
        // Built-in responses
        setTimeout(() => {
          const response = generateResponse(userInput);
          addAssistantMessage(response);
        }, 1000);
      }

      setIsProcessing(false);
    } catch (error) {
      console.error('Error in handleSend:', error);
      addAssistantMessage('An error occurred. Please try again.');
      setIsProcessing(false);
    }
  };

  const handleQuickEntryStep = async (input: string) => {
    const lower = input.toLowerCase();

    // Allow cancel at any step
    if (lower === 'cancel' || lower === 'exit' || lower === 'quit') {
      setQeStep('idle');
      setQeData({ supplierInput: '', supplierName: '', supplierNumber: '', amount: 0, description: '' });
      setSupplierSuggestions([]);
      addAssistantMessage('Quick entry cancelled. How else can I help?');
      return;
    }

    if (qeStep === 'awaiting_supplier') {
      const suppliers = await fetchSuppliersForMatch();
      const match = findSupplierMatch(input, suppliers);
      if (match) {
        setQeData((prev) => ({ ...prev, supplierInput: input, supplierName: match.supplier, supplierNumber: match.supplierNumber }));
        setQeStep('awaiting_amount');
        addAssistantMessage(`Selected: ${match.supplier} (${match.supplierNumber})\n\nEnter the invoice amount:`);
      } else {
        // If Claude is enabled and input doesn't look like a supplier search, use Claude
        if (claudeEnabled && claudeApiKey && (input.includes('?') || input.includes('what') || input.includes('how') || input.includes('why'))) {
          try {
            const response = await callClaudeApi(input, buildConversationContext());
            addAssistantMessage(response);
          } catch (error) {
            addAssistantMessage(`Error calling Claude: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          return;
        }

        // Show top closest matches
        const search = input.toLowerCase();
        const closest = suppliers
          .filter((s) =>
            s.supplier.toLowerCase().includes(search.substring(0, 3)) ||
            s.supplierNumber.toLowerCase().includes(search.substring(0, 3)) ||
            (s.alternativeName && s.alternativeName.toLowerCase().includes(search.substring(0, 3)))
          )
          .slice(0, 5);

        if (closest.length > 0) {
          const list = closest.map((s) => `  ${s.supplier} (${s.supplierNumber})`).join('\n');
          addAssistantMessage(`Supplier "${input}" not found. Did you mean:\n\n${list}\n\nType the exact name or click a suggestion below:`);
        } else {
          addAssistantMessage(`Supplier "${input}" not found. Try typing a few letters — suggestions will appear below.\n\n(Type "cancel" to exit)`);
        }
      }
      return;
    }

    if (qeStep === 'awaiting_amount') {
      const amount = parseFloat(input.replace(/,/g, ''));
      if (isNaN(amount) || amount <= 0) {
        addAssistantMessage('Please enter a valid amount (e.g. 5000 or 5,000.50):');
        return;
      }
      setQeData((prev) => ({ ...prev, amount }));
      setQeStep('awaiting_description');
      addAssistantMessage(`Amount: ${amount.toFixed(2)} AED\n\nEnter invoice description:`);
      return;
    }

    if (qeStep === 'awaiting_description') {
      const description = input.trim() || 'Invoice';
      const finalData = { ...qeData, description };
      setQeData(finalData);
      setQeStep('confirming');
      addAssistantMessage(
        `Here's your invoice:\n\n` +
        `Supplier: ${finalData.supplierName} (${finalData.supplierNumber})\n` +
        `Amount: ${finalData.amount.toFixed(2)} AED\n` +
        `Description: ${description}\n` +
        `Date: ${dayjs().format('DD-MMM-YYYY')} (today)\n` +
        `Tax: None\n\n` +
        `Type "yes" to create, or "cancel" to abort.`
      );
      return;
    }

    if (qeStep === 'confirming') {
      if (lower === 'yes' || lower === 'y' || lower === 'ok' || lower === 'confirm' || lower === 'create') {
        addAssistantMessage('Creating invoice now...');
        createInvoiceFromQuickEntry(qeData);
        setQeData({ supplierInput: '', supplierName: '', supplierNumber: '', amount: 0, description: '' });
      } else {
        setQeStep('idle');
        setQeData({ supplierInput: '', supplierName: '', supplierNumber: '', amount: 0, description: '' });
        addAssistantMessage('Invoice creation cancelled. How else can I help?');
      }
      return;
    }
  };

  // Handle input changes — trigger live supplier filtering when awaiting_supplier
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputValue(val);
    if (qeStep === 'awaiting_supplier') {
      filterSuppliers(val);
    } else {
      if (supplierSuggestions.length > 0) setSupplierSuggestions([]);
    }
  };

  const generateResponse = (input: string): string => {
    const lowerInput = input.toLowerCase();

    // AP module responses
    if (lowerInput.includes('create') && lowerInput.includes('payable')) {
      // Navigate to ManageInvoices with quick-create dialog
      setTimeout(() => {
        handleClose();
        navigate('/ap/manage-invoices', {
          state: { quickCreate: true, showQuickCreateDialog: true },
        });
      }, 1200);
      return 'Opening the Create Payable Invoice form for you. You\'ll be able to select a supplier, enter the amount, date, and description to quickly create an invoice.';
    }
    if (lowerInput.includes('manage') && lowerInput.includes('invoice')) {
      setTimeout(() => { handleClose(); navigate('/ap/manage-invoices'); }, 1200);
      return 'Taking you to Manage Invoices where you can search, view, and manage all payable invoices.';
    }
    if (lowerInput.includes('manage') && lowerInput.includes('payment')) {
      setTimeout(() => { handleClose(); navigate('/ap/manage-payments'); }, 1200);
      return 'Opening Manage Payments. You can search and manage payment batches and individual payments.';
    }
    if (lowerInput.includes('manage') && lowerInput.includes('supplier')) {
      setTimeout(() => { handleClose(); navigate('/ap/suppliers'); }, 1200);
      return 'Taking you to Manage Suppliers where you can search and manage supplier master data.';
    }
    if (lowerInput.includes('validate') && lowerInput.includes('invoice')) {
      return 'To validate invoices:\n1. Go to Manage Invoices\n2. Search for the invoice\n3. Open it and click "Invoice Actions → Validate"\n4. The system will check accounting, tax, and matching rules\n\nWould you like me to open Manage Invoices?';
    }
    if (lowerInput.includes('payment') && lowerInput.includes('term')) {
      return 'Payment Terms available:\n• Immediate\n• Net 15\n• Net 30\n• Net 45\n• Net 60\n• Net 90\n\nPayment terms can be set at the supplier level or overridden on individual invoices.';
    }

    // GL module responses
    if (lowerInput.includes('sync') && lowerInput.includes('journal')) {
      return 'I\'ll help you sync journal batches. Navigate to Sync Data page and I\'ll guide you through the process. Would you like me to take you there?';
    }
    if (lowerInput.includes('create') && lowerInput.includes('journal')) {
      return 'To create a journal entry:\n1. Go to General Ledger → Tasks\n2. Click "Create Journal"\n3. Fill in the header details\n4. Add journal lines with debits and credits\n5. Submit for approval\n\nWould you like me to open the journal entry form?';
    }
    if (lowerInput.includes('trial balance') || lowerInput.includes('report')) {
      return 'I can help you generate reports. Go to General Ledger → Reports → Trial Balance. Select the period and ledger, then click "Run Report". Shall I navigate you there?';
    }
    if (lowerInput.includes('period') && lowerInput.includes('status')) {
      return 'Current Period Status:\n• GL Period: Dec-2024 (Open)\n• AP Period: Dec-2024 (Open)\n• AR Period: Dec-2024 (Open)\n\nPeriod close progress: 67% complete.';
    }
    if (lowerInput.includes('help')) {
      if (module === 'ap') {
        return 'I can assist you with:\n• Quick Entry Invoice — just say supplier, amount & description\n• Creating payable invoices (full form)\n• Managing and validating invoices\n• Processing payments\n• Managing suppliers\n\nTry: "Quick Entry Invoice" or "invoice Acme 5000 office supplies"';
      }
      return 'I can assist you with:\n• Data synchronization from Oracle Fusion\n• Creating and posting journal entries\n• Running financial reports\n• Managing periods\n• Navigating modules\n\nJust tell me what you\'d like to do!';
    }

    return 'I understand you want to ' + input.toLowerCase() + '. Let me help you with that. Could you provide more details about what specifically you\'d like to accomplish?';
  };

  const handleSuggestionClick = (command: string) => {
    setInputValue(command);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Step indicator label
  const stepLabel = qeStep === 'awaiting_supplier' ? 'Step 1/4 — Supplier'
    : qeStep === 'awaiting_amount' ? 'Step 2/4 — Amount'
    : qeStep === 'awaiting_description' ? 'Step 3/4 — Description'
    : qeStep === 'confirming' ? 'Step 4/4 — Confirm'
    : '';

  return (
    <>
      {/* Floating Button — hidden when parent controls open state */}
      {!isControlled && <Tooltip title={isOpen ? '' : 'Autopilot Assistant'} placement="right">
        <div
          onClick={isOpen ? handleClose : handleOpen}
          style={{
            position: 'fixed',
            left: 24,
            bottom: 24,
            width: 60,
            height: 60,
            borderRadius: '50%',
            background: REDWOOD.autopilotGradient,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            boxShadow: '0 4px 20px rgba(107, 78, 255, 0.4)',
            transition: 'all 0.3s ease',
            zIndex: 1002,
            transform: isOpen ? 'scale(0.9)' : 'scale(1)',
          }}
          onMouseEnter={(e) => {
            if (!isOpen) {
              e.currentTarget.style.transform = 'scale(1.1)';
              e.currentTarget.style.boxShadow = '0 6px 24px rgba(107, 78, 255, 0.5)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = isOpen ? 'scale(0.9)' : 'scale(1)';
            e.currentTarget.style.boxShadow = '0 4px 20px rgba(107, 78, 255, 0.4)';
          }}
        >
          <Badge dot={!isOpen} offset={[-5, 5]} color={REDWOOD.success}>
            <RobotOutlined style={{ fontSize: 28, color: '#fff' }} />
          </Badge>
        </div>
      </Tooltip>}

      {/* Chat Panel */}
      {isOpen && (
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            ...(isControlled ? { right: 16, top: 56 } : { left: 24, bottom: 100 }),
            width: 420,
            height: 520,
            background: REDWOOD.surface,
            borderRadius: 16,
            boxShadow: '0 12px 40px rgba(0, 0, 0, 0.2)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 1001,
            animation: isClosing ? 'autopilotOut 0.25s ease-in forwards' : 'autopilotIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '16px 20px',
              background: REDWOOD.autopilotGradient,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  background: 'rgba(255,255,255,0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <RobotOutlined style={{ fontSize: 20, color: '#fff' }} />
              </div>
              <div style={{ flex: 1 }}>
                <Text strong style={{ color: '#fff', fontSize: 16, display: 'block' }}>
                  Autopilot
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>
                  {claudeEnabled ? '✨ Claude AI Mode' : 'Standard Mode'} • {qeStep !== 'idle' ? stepLabel : 'AI-powered assistant'}
                </Text>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Tooltip title="MCP Server Settings">
                <SettingOutlined
                  style={{ color: '#fff', cursor: 'pointer', fontSize: 16 }}
                  onClick={() => setShowMcpSettings(true)}
                />
              </Tooltip>
              <CloseOutlined
                style={{ color: '#fff', cursor: 'pointer', fontSize: 16 }}
                onClick={handleClose}
              />
            </div>
          </div>

          {/* Messages */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              overflowX: 'hidden',
              padding: 16,
              background: REDWOOD.neutral100,
              minHeight: 0,
            }}
          >
            {messages.map((message) => (
              <div
                key={message.id}
                style={{
                  display: 'flex',
                  justifyContent: message.type === 'user' ? 'flex-end' : 'flex-start',
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    maxWidth: '85%',
                    padding: '12px 16px',
                    borderRadius: message.type === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: message.type === 'user' ? REDWOOD.autopilotPurple : REDWOOD.surface,
                    color: message.type === 'user' ? '#fff' : REDWOOD.neutral900,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                    whiteSpace: 'pre-line',
                    fontSize: 14,
                    lineHeight: 1.5,
                  }}
                >
                  {message.content}
                </div>
              </div>
            ))}

            {isProcessing && (
              <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
                <div
                  style={{
                    padding: '12px 16px',
                    borderRadius: '16px 16px 16px 4px',
                    background: REDWOOD.surface,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
                  }}
                >
                  <LoadingOutlined style={{ color: REDWOOD.autopilotPurple, fontSize: 18 }} />
                  <Text style={{ marginLeft: 8, color: REDWOOD.neutral600 }}>Thinking...</Text>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Supplier suggestions dropdown (visible during awaiting_supplier step) */}
          {qeStep === 'awaiting_supplier' && supplierSuggestions.length > 0 && (
            <div
              style={{
                maxHeight: 180,
                overflowY: 'auto',
                borderTop: `1px solid ${REDWOOD.neutral200}`,
                background: REDWOOD.surface,
                flexShrink: 0,
              }}
            >
              <div style={{ padding: '6px 12px 2px 12px' }}>
                <Text type="secondary" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  <SearchOutlined /> Matching Suppliers ({supplierSuggestions.length})
                </Text>
              </div>
              {supplierSuggestions.map((s, idx) => (
                <div
                  key={idx}
                  onClick={() => handleSupplierSelect(s)}
                  style={{
                    padding: '8px 16px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    borderBottom: `1px solid ${REDWOOD.neutral100}`,
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = `${REDWOOD.autopilotPurple}08`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <UserOutlined style={{ color: REDWOOD.autopilotPurple, fontSize: 14 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Text strong style={{ fontSize: 13, display: 'block' }}>{s.supplier}</Text>
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      {s.supplierNumber}{s.alternativeName ? ` — ${s.alternativeName}` : ''}
                    </Text>
                  </div>
                  <div
                    style={{
                      padding: '2px 8px',
                      borderRadius: 10,
                      background: `${REDWOOD.success}15`,
                      color: REDWOOD.success,
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  >
                    Select
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Supplier loading indicator */}
          {qeStep === 'awaiting_supplier' && suppliersFetching && (
            <div style={{ padding: '8px 16px', borderTop: `1px solid ${REDWOOD.neutral200}`, textAlign: 'center' }}>
              <Spin size="small" /> <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>Loading suppliers...</Text>
            </div>
          )}

          {/* Suggestions - visible when idle (quick actions) */}
          {qeStep === 'idle' && (
            <div style={{ padding: '12px 16px', borderTop: `1px solid ${REDWOOD.neutral200}`, flexShrink: 0 }}>
              <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Quick Actions
              </Text>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                {suggestions.map((suggestion, index) => (
                  <div
                    key={index}
                    onClick={() => handleSuggestionClick(suggestion.command)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 20,
                      background: `${REDWOOD.autopilotPurple}10`,
                      border: `1px solid ${REDWOOD.autopilotPurple}30`,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      transition: 'all 0.2s',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = `${REDWOOD.autopilotPurple}20`;
                      e.currentTarget.style.borderColor = REDWOOD.autopilotPurple;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = `${REDWOOD.autopilotPurple}10`;
                      e.currentTarget.style.borderColor = `${REDWOOD.autopilotPurple}30`;
                    }}
                  >
                    <span style={{ color: REDWOOD.autopilotPurple, fontSize: 12 }}>{suggestion.icon}</span>
                    <Text style={{ fontSize: 12, color: REDWOOD.neutral900 }}>{suggestion.label}</Text>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Entry step indicator */}
          {qeStep !== 'idle' && supplierSuggestions.length === 0 && !suppliersFetching && (
            <div style={{ padding: '6px 16px', borderTop: `1px solid ${REDWOOD.neutral200}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>{stepLabel}</Text>
              <div
                onClick={() => {
                  setQeStep('idle');
                  setQeData({ supplierInput: '', supplierName: '', supplierNumber: '', amount: 0, description: '' });
                  setSupplierSuggestions([]);
                  addAssistantMessage('Quick entry cancelled. How else can I help?');
                }}
                style={{ fontSize: 11, color: REDWOOD.primary, cursor: 'pointer' }}
              >
                Cancel
              </div>
            </div>
          )}

          {/* Input */}
          <div
            style={{
              padding: 16,
              borderTop: `1px solid ${REDWOOD.neutral200}`,
              background: REDWOOD.surface,
            }}
          >
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
              <TextArea
                value={inputValue}
                onChange={handleInputChange}
                onKeyPress={handleKeyPress}
                placeholder={
                  qeStep === 'awaiting_supplier' ? 'Type supplier name...'
                    : qeStep === 'awaiting_amount' ? 'Enter amount...'
                    : qeStep === 'awaiting_description' ? 'Enter description...'
                    : qeStep === 'confirming' ? 'Type yes or cancel...'
                    : 'Ask me anything...'
                }
                autoSize={{ minRows: 1, maxRows: 4 }}
                style={{
                  flex: 1,
                  borderRadius: 12,
                  resize: 'none',
                  fontSize: 14,
                }}
              />
              <div
                onClick={handleSend}
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 12,
                  background: inputValue.trim() ? REDWOOD.autopilotGradient : REDWOOD.neutral200,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: inputValue.trim() ? 'pointer' : 'default',
                  transition: 'all 0.2s',
                }}
              >
                <SendOutlined style={{ color: inputValue.trim() ? '#fff' : REDWOOD.neutral600, fontSize: 18 }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MCP Settings Modal */}
      <Modal
        title="Autopilot Settings — Claude & MCP"
        open={showMcpSettings}
        onCancel={() => setShowMcpSettings(false)}
        footer={null}
        width={500}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {/* Claude AI Toggle */}
          <Card size="small">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <Text strong style={{ fontSize: 14, display: 'block' }}>✨ Enable Claude AI</Text>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Use Claude instead of built-in responses
                </Text>
              </div>
              <Switch
                checked={claudeEnabled}
                onChange={handleClaudeToggle}
                disabled={!claudeApiKey}
              />
            </div>

            {apiKeyMissing && (
              <Alert
                message="Claude API Key Required"
                description="Go to Admin > Claude Key Settings to add your API key"
                type="warning"
                style={{ marginTop: 12 }}
                showIcon
              />
            )}

            {claudeEnabled && (
              <Alert
                message="Claude AI Enabled"
                description="Your questions will be answered using Claude AI with advanced reasoning"
                type="success"
                style={{ marginTop: 12 }}
                showIcon
              />
            )}

            {claudeApiKey && (
              <div style={{ marginTop: 12 }}>
                <Button
                  onClick={testClaudeApiKey}
                  loading={testingApiKey}
                  block
                  style={{ marginBottom: apiKeyTestResult ? 12 : 0 }}
                >
                  Test API Key
                </Button>
                {apiKeyTestResult && (
                  <Alert
                    message={apiKeyTestResult.success ? 'Test Successful' : 'Test Failed'}
                    description={apiKeyTestResult.message}
                    type={apiKeyTestResult.success ? 'success' : 'error'}
                    showIcon
                    style={{ marginTop: apiKeyTestResult ? 12 : 0 }}
                  />
                )}
              </div>
            )}
          </Card>

          <Divider style={{ margin: '8px 0' }} />

          {/* MCP Server Selection */}
          <Card size="small">
            <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 12 }}>
              <LinkOutlined /> Select MCP Server (Optional)
            </Text>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 12 }}>
              Connect to an MCP server to enhance Claude's capabilities with external integrations
            </Text>

            {loadingMcpServers ? (
              <Spin size="small" style={{ marginTop: 12 }} />
            ) : (
              <>
                {mcpServers.length > 0 ? (
                  <Select
                    placeholder="Select an MCP server (optional)"
                    value={selectedMcpServer || undefined}
                    onChange={handleMcpServerSelect}
                    style={{ width: '100%', marginTop: 12 }}
                    options={mcpServers.map(server => ({
                      label: `${server.name} (${server.type})`,
                      value: server.id,
                      description: server.description,
                    }))}
                    optionLabelProp="label"
                  />
                ) : (
                  <Alert
                    message="No MCP Servers Available"
                    description="Add an MCP server below to enhance Claude's capabilities"
                    type="info"
                    style={{ marginTop: 12 }}
                  />
                )}

                {selectedMcpServer && (
                  <div style={{ marginTop: 12 }}>
                    <Text type="success" style={{ fontSize: 12 }}>
                      ✓ MCP Server Connected: {mcpServers.find(s => s.id === selectedMcpServer)?.name}
                    </Text>
                  </div>
                )}

                <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  <Button
                    onClick={loadMcpServers}
                    loading={loadingMcpServers}
                    flex={1}
                    icon={<ThunderboltOutlined />}
                  >
                    Refresh
                  </Button>
                  <Button
                    onClick={() => setShowAddMcpServer(true)}
                    type="primary"
                    flex={1}
                    icon={<LinkOutlined />}
                  >
                    Add Server
                  </Button>
                </div>
              </>
            )}
          </Card>

          {/* Info */}
          <Alert
            message="About Claude Integration"
            description={`
              • Claude AI provides intelligent responses based on conversation context
              • MCP servers extend Claude's capabilities with external integrations
              • Your API key is stored securely in browser localStorage
              • Only you can see your conversation history
            `}
            type="info"
            showIcon
          />
        </Space>
      </Modal>

      {/* Add MCP Server Modal */}
      <Modal
        title="Add New MCP Server"
        open={showAddMcpServer}
        onCancel={() => {
          setShowAddMcpServer(false);
          setNewMcpServerName('');
          setNewMcpServerUrl('');
        }}
        onOk={addNewMcpServer}
        okText="Add Server"
        cancelText="Cancel"
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <div>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>
              Server Name
            </Text>
            <Input
              placeholder="e.g., Zerodha Trading API"
              value={newMcpServerName}
              onChange={(e) => setNewMcpServerName(e.target.value)}
            />
          </div>

          <div>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>
              Server URL
            </Text>
            <Input
              placeholder="e.g., https://api.zerodha.com"
              value={newMcpServerUrl}
              onChange={(e) => setNewMcpServerUrl(e.target.value)}
            />
          </div>

          <Alert
            message="Server Configuration"
            description="Enter the name and URL for your MCP server. Once added, you can select it from the dropdown to use with Claude."
            type="info"
            showIcon
          />
        </Space>
      </Modal>

      {/* CSS Animations */}
      <style>{`
        @keyframes autopilotIn {
          from {
            opacity: 0;
            transform: translateY(20px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes autopilotOut {
          from {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          to {
            opacity: 0;
            transform: translateY(20px) scale(0.95);
          }
        }
      `}</style>
    </>
  );
};

export default Autopilot;
