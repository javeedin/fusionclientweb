import React, { useState, useEffect } from 'react';
import { Button, Input, Table, Card, Space, Statistic, Spin, message, Form, Modal, Tag, Checkbox, InputNumber, AutoComplete, Avatar } from 'antd';
import { PlayCircleOutlined, StopOutlined, SettingOutlined, ReloadOutlined, SendOutlined, UserOutlined, RobotOutlined, ApiOutlined } from '@ant-design/icons';

export default function GLAccountAnalysis() {
  const [serverStatus, setServerStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [queryLoading, setQueryLoading] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [settingsForm] = Form.useForm();
  const [messageApi] = message.useMessage();
  const [showAPITest, setShowAPITest] = useState(false);
  const [apiTestResult, setApiTestResult] = useState(null);
  const [apiTestLoading, setApiTestLoading] = useState(false);

  // Query parameters
  const [queryParams, setQueryParams] = useState({
    ledger_name: 'BUIMERC LEDGER',
    period_names: 'Jan-26',
    company: '01',
    account: '1222107',
  });

  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState(null);

  // Check server status on mount
  useEffect(() => {
    checkServerStatus();
    loadCredentials();
    const interval = setInterval(checkServerStatus, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  async function checkServerStatus() {
    try {
      const response = await window.electronAPI.glMcpStatus();
      if (response.success) {
        setServerStatus(response.status);
      }
    } catch (err) {
      console.error('Failed to check GL MCP status:', err);
    }
  }

  async function fetchLogs() {
    try {
      const response = await window.electronAPI.glMcpGetLogs();
      if (response.success) {
        setLogs(response.logs || []);
        setShowLogs(true);
      } else {
        messageApi.error('Failed to fetch logs');
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
      messageApi.error(err.message);
    }
  }

  async function handleChatSubmit() {
    if (!chatInput.trim()) return;

    const userMessage = {
      id: Date.now(),
      type: 'user',
      content: chatInput,
      timestamp: new Date().toLocaleTimeString(),
    };

    setChatMessages((prev) => [...prev, userMessage]);
    setChatInput('');
    setChatLoading(true);

    try {
      // AI responses based on GL data analysis
      let aiResponse = '';
      const input = chatInput.toLowerCase();

      if (input.includes('total') || input.includes('sum')) {
        if (summary) {
          const totalDebit = summary.totalDebit || 0;
          const totalCredit = results.reduce((sum, t) => sum + (t.accountedDr === 0 ? 0 : 0), 0);
          aiResponse = `📊 **GL Summary for Account ${queryParams.account}**\n\n`;
          aiResponse += `• Total Debit: **AED ${totalDebit.toFixed(2)}**\n`;
          aiResponse += `• Transaction Count: **${summary.count} transactions**\n`;
          aiResponse += `• Period: ${summary.period}\n`;
          aiResponse += `• Ledger: ${queryParams.ledger_name}\n`;
          aiResponse += `• Company: ${queryParams.company}`;
        } else {
          aiResponse = 'Please run a query first to see the total debit amount.';
        }
      } else if (input.includes('account') || input.includes('balance')) {
        aiResponse = `🏦 **Account Information**\n\n`;
        aiResponse += `• Account Number: ${queryParams.account}\n`;
        aiResponse += `• Ledger: ${queryParams.ledger_name}\n`;
        aiResponse += `• Period: ${queryParams.period_names}\n`;
        aiResponse += `• Company: ${queryParams.company}`;
        if (summary && summary.count > 0) {
          aiResponse += `\n\n📈 Current Balance:\n• Total Debit: **AED ${summary.totalDebit.toFixed(2)}**\n• Transactions: **${summary.count}**`;
        }
      } else if (input.includes('transaction') || input.includes('activity')) {
        if (results.length > 0) {
          aiResponse = `✅ **Found ${results.length} GL Transactions**\n\n`;
          aiResponse += `**Latest Transactions:**\n`;
          results.slice(0, 3).forEach((t, idx) => {
            aiResponse += `\n${idx + 1}. Batch ${t.batchId} | JE ${t.jeHeaderId}\n`;
            aiResponse += `   Date: ${t.accountingDate}\n`;
            aiResponse += `   Amount: AED ${t.enteredDr.toFixed(2)}\n`;
            aiResponse += `   ${t.description}`;
          });
          if (results.length > 3) {
            aiResponse += `\n\n... and ${results.length - 3} more transactions`;
          }
        } else {
          aiResponse = 'No GL transactions found for the current query parameters.';
        }
      } else if (input.includes('ledger')) {
        aiResponse = `📚 **Ledger: ${queryParams.ledger_name}**\n\n`;
        aiResponse += `• Chart of Accounts: BUIMERC Global Chart of Accounts Instance\n`;
        aiResponse += `• Legal Entity: BUIMERC CORPORATION LIMITED\n`;
        aiResponse += `• Currency: AED (United Arab Emirates Dirham)\n`;
        aiResponse += `• Current Period: ${queryParams.period_names}`;
      } else if (input.includes('period') || input.includes('date')) {
        aiResponse = `📅 **Period Analysis**\n\n`;
        aiResponse += `• Period: ${queryParams.period_names}\n`;
        aiResponse += `• Company: ${queryParams.company}\n`;
        if (results.length > 0) {
          const dates = results.map(t => t.accountingDate).filter(Boolean);
          const uniqueDates = [...new Set(dates)];
          aiResponse += `• Transaction Dates: ${uniqueDates.join(', ')}\n`;
          aiResponse += `• Total Transactions: ${results.length}`;
        }
      } else {
        aiResponse =
          '💡 **I can help you analyze GL data. Try asking:**\n\n' +
          '• "What is the total?" - Show account summary\n' +
          '• "Show me transactions" - List GL transactions\n' +
          '• "Account balance" - Account details\n' +
          '• "Ledger info" - Ledger information\n' +
          '• "Period analysis" - Period details';
      }

      const aiMessage = {
        id: Date.now() + 1,
        type: 'ai',
        content: aiResponse,
        timestamp: new Date().toLocaleTimeString(),
      };

      setChatMessages((prev) => [...prev, aiMessage]);
    } catch (err) {
      console.error('Chat error:', err);
      messageApi.error('Error processing question');
    } finally {
      setChatLoading(false);
    }
  }

  async function loadCredentials() {
    try {
      const creds = await window.electronAPI.glMcpGetCredentials();
      if (creds) {
        setCredentials(creds);
        settingsForm.setFieldsValue(creds);
      }
    } catch (err) {
      console.error('Failed to load credentials:', err);
    }
  }

  async function startServer() {
    setLoading(true);
    try {
      if (!credentials) {
        messageApi.error('Please configure Oracle credentials first');
        setShowSettings(true);
        return;
      }

      const response = await window.electronAPI.glMcpStart(credentials);
      if (response.success) {
        setServerStatus(response.status);
        messageApi.success('GL MCP Server started successfully');
      } else {
        messageApi.error(response.error || 'Failed to start server');
      }
    } catch (err) {
      messageApi.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function stopServer() {
    setLoading(true);
    try {
      const response = await window.electronAPI.glMcpStop();
      if (response.success) {
        setServerStatus(response.status);
        messageApi.success('GL MCP Server stopped');
      } else {
        messageApi.error('Failed to stop server');
      }
    } catch (err) {
      messageApi.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveCredentials(values) {
    setSettingsLoading(true);
    try {
      console.log('Saving GL credentials:', { ...values, password: '***' });
      const response = await window.electronAPI.glMcpSaveCredentials(values);
      console.log('Save response:', response);

      if (response?.success) {
        setCredentials(values);
        messageApi.success('Credentials saved successfully');
        setShowSettings(false);
      } else {
        const errorMsg = response?.error || 'Failed to save credentials';
        console.error('Save failed:', errorMsg);
        messageApi.error(errorMsg);
      }
    } catch (err) {
      console.error('Save error:', err);
      messageApi.error(`Error: ${err.message || 'Unknown error'}`);
    } finally {
      setSettingsLoading(false);
    }
  }

  async function queryGLData() {
    if (!serverStatus?.running) {
      messageApi.warning('GL MCP Server is not running. Start it first.');
      return;
    }

    setQueryLoading(true);
    try {
      // Call the actual HTTPS endpoint (self-signed cert safe for localhost)
      const httpPort = credentials?.httpPort || 3001;
      const endpoint = `https://localhost:${httpPort}/execute`;

      console.log('Query GL Data:', {
        endpoint,
        params: queryParams,
        credentials: { ...credentials, password: '***' }
      });

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'getGLAccountAnalysis',
          arguments: {
            ledger_name: queryParams.ledger_name,
            period_names: queryParams.period_names,
            company: queryParams.company,
            account: queryParams.account,
          },
        }),
      });

      console.log('Response status:', response.status, response.statusText);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('API Error response:', errorText);
        throw new Error(`API Error: ${response.status} ${response.statusText}\n${errorText}`);
      }

      const data = await response.json();
      console.log('API Response data:', data);
      console.log('Full response structure:', JSON.stringify(data, null, 2));

      if (!data.success) {
        throw new Error(data.error || 'Failed to query GL data');
      }

      // Process response data - Oracle API returns items, not transactions
      let transactions = data.items || data.data?.items || data.data?.transactions || [];

      // If still empty, check other possible structures
      if (transactions.length === 0) {
        console.log('No transactions found in standard locations, checking other structures...');
        console.log('data.data:', data.data);
        console.log('data keys:', Object.keys(data));

        // Try other possible response structures
        if (Array.isArray(data.data)) transactions = data.data;
        else if (data.transactions) transactions = data.transactions;
        else if (data.rows) transactions = data.rows;
        else if (data.records) transactions = data.records;
      }

      console.log(`Processing ${transactions.length} transactions`);

      const tableData = transactions.map((t, idx) => ({
        key: idx.toString(),
        batchId: t.batchId || t.batch_id || '',
        jeHeaderId: t.jeHeaderId || t.je_header_id || '',
        jeLineNumber: t.jeLineNumber || t.line_number || 1,
        accountDescription: t.accountDescription || t.account_description || 'N/A',
        enteredDr: parseFloat(t.enteredDr || t.debit_amount || 0),
        accountedDr: parseFloat(t.accountedDr || t.accounted_debit || 0),
        accountingDate: t.accountingDate || t.accounting_date || '',
        description: t.description || t.userJeSourceName || '',
        account: t.account || '',
        company: t.company || '',
        currencyCode: t.currencyCode || '',
      }));

      setResults(tableData);

      // Calculate summary
      const totalDebit = tableData.reduce((sum, t) => sum + (t.enteredDr || 0), 0);
      setSummary({
        totalDebit,
        count: tableData.length,
        period: queryParams.period_names,
        account: queryParams.account || 'All',
      });

      messageApi.success(`Found ${tableData.length} GL transactions`);
    } catch (err) {
      console.error('GL Query Error:', err);
      messageApi.error(`Query Error: ${err.message}`);
      setResults([]);
      setSummary(null);
    } finally {
      setQueryLoading(false);
    }
  }

  async function addToClaudeDesktop() {
    try {
      const httpPort = credentials?.httpPort || 3001;
      console.log('addToClaudeDesktop clicked, httpPort:', httpPort);

      const response = await window.electronAPI.glMcpAddToClaudeDesktop({
        httpPort
      });

      console.log('addToClaudeDesktop response:', response);

      if (response.success) {
        console.log('Successfully added GL server to Claude Desktop config');
        console.log('Config path:', response.configPath);
        console.log('MCP Config:', response.mcpConfig);
        messageApi.success('GL server added to Claude Desktop config!');
      } else {
        console.error('Failed to add GL server:', response.error);
        messageApi.error(response.error || 'Failed to add GL server to Claude Desktop config');
      }
    } catch (err) {
      console.error('Add to Claude Desktop error:', err);
      messageApi.error(`Error: ${err.message || 'Failed to add GL server'}`);
    }
  }

  async function testAPI() {
    const httpPort = credentials?.httpPort || 3001;
    const healthEndpoint = `https://localhost:${httpPort}/health`;
    const executeEndpoint = `https://localhost:${httpPort}/execute`;

    setApiTestLoading(true);
    setShowAPITest(true);

    try {
      // Test health endpoint
      const healthResponse = await fetch(healthEndpoint);
      const healthData = await healthResponse.json();

      // Test execute endpoint with sample query
      const executeResponse = await fetch(executeEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: 'getGLAccountAnalysis',
          arguments: {
            ledger_name: queryParams.ledger_name,
            period_names: queryParams.period_names,
            company: queryParams.company,
            account: queryParams.account,
          },
        }),
      });

      const executeData = await executeResponse.json();

      setApiTestResult({
        success: true,
        baseUrl: `https://localhost:${httpPort}`,
        healthEndpoint,
        executeEndpoint,
        method: 'POST',
        queryParams,
        healthStatus: {
          code: healthResponse.status,
          data: healthData,
        },
        executeStatus: {
          code: executeResponse.status,
          data: executeData,
        },
      });

      console.log('API Test Results:', {
        health: healthData,
        execute: executeData,
      });
    } catch (err) {
      console.error('API test error:', err);
      setApiTestResult({
        success: false,
        error: err.message,
        baseUrl: `https://localhost:${httpPort}`,
        healthEndpoint,
        executeEndpoint,
      });
    } finally {
      setApiTestLoading(false);
    }
  }

  const columns = [
    { title: 'Batch ID', dataIndex: 'batchId', key: 'batchId', width: 100 },
    { title: 'JE Header ID', dataIndex: 'jeHeaderId', key: 'jeHeaderId', width: 100 },
    { title: 'Description', dataIndex: 'accountDescription', key: 'accountDescription', width: 300 },
    { title: 'Debit', dataIndex: 'enteredDr', key: 'enteredDr', width: 120, align: 'right', render: (v) => v?.toFixed(2) || '0.00' },
    { title: 'Date', dataIndex: 'accountingDate', key: 'accountingDate', width: 120 },
    { title: 'Note', dataIndex: 'description', key: 'description', width: 300 },
  ];

  return (
    <div style={{ padding: '24px', backgroundColor: '#f5f5f5', minHeight: '100vh' }}>
      <Card title="GL Account Analysis" style={{ marginBottom: '24px' }}>
        {/* Server Status & Controls */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ marginBottom: '12px', display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div>
              <strong>Server Status: </strong>
              {serverStatus?.running ? (
                <Tag color="green">Running (PID: {serverStatus.pid})</Tag>
              ) : (
                <Tag color="red">Stopped</Tag>
              )}
            </div>
            <Space>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={startServer}
                loading={loading}
                disabled={serverStatus?.running}
              >
                Start Server
              </Button>
              <Button
                danger
                icon={<StopOutlined />}
                onClick={stopServer}
                loading={loading}
                disabled={!serverStatus?.running}
              >
                Stop Server
              </Button>
              <Button
                icon={<SettingOutlined />}
                onClick={() => setShowSettings(true)}
              >
                Settings
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={checkServerStatus}
              >
                Refresh
              </Button>
              <Button
                onClick={fetchLogs}
              >
                View Logs
              </Button>
              <Button
                icon={<ApiOutlined />}
                onClick={testAPI}
              >
                Test API
              </Button>
            </Space>
          </div>

          {serverStatus?.running && (
            <>
              <div style={{ fontSize: '12px', color: '#666', marginTop: '8px', marginBottom: '16px', padding: '12px', backgroundColor: '#e6f7ff', borderRadius: '4px', border: '1px solid #91d5ff' }}>
                <div style={{ marginBottom: '8px' }}>
                  <ApiOutlined style={{ color: '#1677ff', marginRight: '8px', fontSize: '14px' }} />
                  <strong>HTTP Endpoint (Claude Desktop):</strong> <code style={{ backgroundColor: '#fff', padding: '2px 6px', borderRadius: '3px' }}>https://localhost:{credentials?.httpPort || 3001}</code>
                </div>
                <div style={{ marginBottom: '4px' }}>
                  <strong>Health Check:</strong> <code style={{ backgroundColor: '#fff', padding: '2px 6px', borderRadius: '3px' }}>GET /health</code>
                </div>
                <div>
                  <strong>Execute Tool:</strong> <code style={{ backgroundColor: '#fff', padding: '2px 6px', borderRadius: '3px' }}>POST /execute</code> with {'{ tool: "toolName", arguments: {...} }'}
                </div>
              </div>

              {/* Claude Desktop MCP Config */}
              <Card size="small" style={{ marginTop: '12px', backgroundColor: '#fafafa' }}>
                <div style={{ marginBottom: '8px' }}>
                  <strong style={{ fontSize: '12px' }}>Claude Desktop Config:</strong>
                </div>
                <div
                  style={{
                    backgroundColor: '#1a1a1a',
                    color: '#00ff00',
                    padding: '8px 12px',
                    borderRadius: '4px',
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    marginBottom: '8px',
                    maxHeight: '150px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}
                >
{`{
  "mcpServers": {
    "gl-server": {
      "command": "curl",
      "args": ["-X", "POST",
        "https://localhost:${credentials?.httpPort || 3001}/execute"],
      "env": {}
    }
  }
}`}
                </div>
                <Space size="small">
                  <Button
                    size="small"
                    onClick={() => {
                      const config = `{\n  "mcpServers": {\n    "gl-server": {\n      "command": "curl",\n      "args": ["-X", "POST", "https://localhost:${
                        credentials?.httpPort || 3001
                      }/execute"],\n      "env": {}\n    }\n  }\n}`;
                      navigator.clipboard.writeText(config);
                      messageApi.success('Config copied to clipboard!');
                    }}
                  >
                    Copy Config
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    onClick={() => addToClaudeDesktop()}
                  >
                    Add to Claude Desktop
                  </Button>
                </Space>
              </Card>
            </>
          )}
        </div>

        {/* Query Parameters */}
        <Card title="Query Parameters" size="small" style={{ marginBottom: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label><strong>Ledger Name</strong></label>
              <Input
                value={queryParams.ledger_name}
                onChange={(e) => setQueryParams({ ...queryParams, ledger_name: e.target.value })}
                placeholder="e.g., BUIMERC LEDGER"
              />
            </div>
            <div>
              <label><strong>Period</strong></label>
              <Input
                value={queryParams.period_names}
                onChange={(e) => setQueryParams({ ...queryParams, period_names: e.target.value })}
                placeholder="e.g., Jan-26"
              />
            </div>
            <div>
              <label><strong>Company</strong></label>
              <Input
                value={queryParams.company}
                onChange={(e) => setQueryParams({ ...queryParams, company: e.target.value })}
                placeholder="e.g., 01"
              />
            </div>
            <div>
              <label><strong>Account Number</strong></label>
              <Input
                value={queryParams.account}
                onChange={(e) => setQueryParams({ ...queryParams, account: e.target.value })}
                placeholder="e.g., 1222107"
              />
            </div>
          </div>
          <Button
            type="primary"
            block
            onClick={queryGLData}
            loading={queryLoading}
            disabled={!serverStatus?.running}
          >
            Query GL Data
          </Button>
        </Card>

        {/* Results Summary */}
        {summary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
            <Card size="small">
              <Statistic title="Total Debit" value={summary.totalDebit} precision={2} />
            </Card>
            <Card size="small">
              <Statistic title="Transaction Count" value={summary.count} />
            </Card>
            <Card size="small">
              <Statistic title="Period" value={summary.period} />
            </Card>
            <Card size="small">
              <Statistic title="Account" value={summary.account} />
            </Card>
          </div>
        )}

        {/* Results Table */}
        {results.length > 0 && (
          <Card title="GL Transactions" size="small">
            <Table
              columns={columns}
              dataSource={results}
              pagination={{ pageSize: 10 }}
              size="small"
            />
          </Card>
        )}
      </Card>

      {/* AI Chat for GL Analysis */}
      <Card title="GL Data Analysis Chat" style={{ marginBottom: '24px' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            height: '400px',
            border: '1px solid #e0e0e0',
            borderRadius: '4px',
            backgroundColor: '#fafafa',
          }}
        >
          {/* Chat Messages */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
            }}
          >
            {chatMessages.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#999', marginTop: '20px' }}>
                Ask questions about GL data. Try: "What accounts are included?" or "Show me the total debit"
              </div>
            ) : (
              chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex',
                    gap: '8px',
                    alignItems: 'flex-start',
                  }}
                >
                  <Avatar
                    size="small"
                    icon={msg.type === 'user' ? <UserOutlined /> : <RobotOutlined />}
                    style={{
                      backgroundColor: msg.type === 'user' ? '#1677ff' : '#52c41a',
                    }}
                  />
                  <div
                    style={{
                      flex: 1,
                      backgroundColor: msg.type === 'user' ? '#e6f7ff' : '#f6ffed',
                      padding: '8px 12px',
                      borderRadius: '4px',
                      wordBreak: 'break-word',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>
                      {msg.type === 'user' ? 'You' : 'AI Assistant'} - {msg.timestamp}
                    </div>
                    <div>{msg.content}</div>
                  </div>
                </div>
              ))
            )}
            {chatLoading && (
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <Avatar size="small" icon={<RobotOutlined />} style={{ backgroundColor: '#52c41a' }} />
                <Spin size="small" />
              </div>
            )}
          </div>

          {/* Input Area */}
          <div
            style={{
              borderTop: '1px solid #e0e0e0',
              padding: '12px',
              display: 'flex',
              gap: '8px',
            }}
          >
            <Input
              placeholder="Ask a question about GL data..."
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onPressEnter={handleChatSubmit}
              disabled={chatLoading}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              onClick={handleChatSubmit}
              loading={chatLoading}
              disabled={!chatInput.trim() || chatLoading}
            >
              Send
            </Button>
          </div>
        </div>
      </Card>

      {/* Settings Modal */}
      <Modal
        title="GL API Settings"
        open={showSettings}
        onOk={() => settingsForm.submit()}
        onCancel={() => {
          setShowSettings(false);
          setSettingsLoading(false);
        }}
        width={600}
        okButtonProps={{ loading: settingsLoading }}
        maskClosable={!settingsLoading}
      >
        <Form
          form={settingsForm}
          layout="vertical"
          onFinish={saveCredentials}
        >
          <Form.Item
            label="Oracle Base URL"
            name="oracleBaseUrl"
            rules={[{ required: true, message: 'Please enter Oracle base URL' }]}
            help="Enter ONLY the domain, e.g., https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com (do NOT include /ords/... or query parameters)"
          >
            <Input placeholder="https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com" />
          </Form.Item>

          <Form.Item
            label="Skip Authentication"
            name="skipAuth"
            valuePropName="checked"
            initialValue={false}
          >
            <Checkbox>Disable Basic Auth (for public APEX endpoints)</Checkbox>
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prevValues, currentValues) => prevValues.skipAuth !== currentValues.skipAuth}>
            {({ getFieldValue }) => (
              <>
                {!getFieldValue('skipAuth') && (
                  <>
                    <Form.Item
                      label="Username"
                      name="username"
                      rules={[{ required: true, message: 'Please enter username' }]}
                    >
                      <Input placeholder="Oracle APEX username" />
                    </Form.Item>
                    <Form.Item
                      label="Password"
                      name="password"
                      rules={[{ required: true, message: 'Please enter password' }]}
                    >
                      <Input.Password placeholder="Oracle APEX password" />
                    </Form.Item>
                  </>
                )}
              </>
            )}
          </Form.Item>

          <Form.Item
            label="HTTP Port (for Claude Desktop testing)"
            name="httpPort"
            initialValue={3001}
            rules={[{ required: true, message: 'Please enter HTTP port' }]}
          >
            <InputNumber
              min={3000}
              max={65535}
              placeholder="e.g., 3001"
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Logs Modal */}
      <Modal
        title="GL MCP Server Logs"
        open={showLogs}
        onCancel={() => setShowLogs(false)}
        width={800}
        footer={null}
      >
        <div
          style={{
            backgroundColor: '#1a1a1a',
            color: '#00ff00',
            padding: '12px',
            borderRadius: '4px',
            fontFamily: 'monospace',
            fontSize: '12px',
            maxHeight: '400px',
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {logs.length === 0 ? (
            <div>No logs available</div>
          ) : (
            logs.map((log, idx) => <div key={idx}>{log}</div>)
          )}
        </div>
      </Modal>

      {/* API Test Modal */}
      <Modal
        title="API Endpoint Test"
        open={showAPITest}
        onCancel={() => setShowAPITest(false)}
        width={900}
        footer={[
          <Button key="close" onClick={() => setShowAPITest(false)}>
            Close
          </Button>,
          apiTestResult?.success && (
            <Button
              key="copy"
              type="primary"
              onClick={() => {
                navigator.clipboard.writeText(apiTestResult.executeEndpoint);
                messageApi.success('Execute endpoint copied!');
              }}
            >
              Copy Execute URL
            </Button>
          ),
        ]}
      >
        <Spin spinning={apiTestLoading}>
          {apiTestResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* Base URL */}
              <div style={{ padding: '12px', backgroundColor: '#f0f5ff', borderRadius: '4px', border: '1px solid #91d5ff' }}>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Base URL:</div>
                <code style={{ fontSize: '13px', fontWeight: 'bold', color: '#1677ff' }}>
                  {apiTestResult.baseUrl}
                </code>
              </div>

              {/* Health Endpoint */}
              <div style={{ padding: '12px', backgroundColor: '#f6ffed', borderRadius: '4px', border: '1px solid #b7eb8f' }}>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Health Check Endpoint (GET):</div>
                <code style={{ fontSize: '13px', fontWeight: 'bold', color: '#52c41a' }}>
                  {apiTestResult.healthEndpoint}
                </code>
                {apiTestResult.healthStatus && (
                  <div style={{ marginTop: '8px', fontSize: '12px' }}>
                    <strong>Status:</strong> {apiTestResult.healthStatus.code} ✓
                  </div>
                )}
              </div>

              {/* Execute Endpoint */}
              <div style={{ padding: '12px', backgroundColor: '#e6f7ff', borderRadius: '4px', border: '1px solid #91d5ff' }}>
                <div style={{ fontSize: '12px', color: '#666', marginBottom: '4px' }}>Execute Endpoint (POST):</div>
                <code style={{ fontSize: '13px', fontWeight: 'bold', color: '#1677ff', wordBreak: 'break-all' }}>
                  {apiTestResult.executeEndpoint}
                </code>
                {apiTestResult.executeStatus && (
                  <div style={{ marginTop: '8px', fontSize: '12px' }}>
                    <strong>Status:</strong> {apiTestResult.executeStatus.code}
                    {apiTestResult.executeStatus.code === 200 ? ' ✓' : ' ✗'}
                  </div>
                )}
              </div>

              {/* Query Parameters */}
              {apiTestResult.queryParams && (
                <div style={{ padding: '12px', backgroundColor: '#fafafa', borderRadius: '4px', border: '1px solid #d9d9d9' }}>
                  <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px', fontWeight: 'bold' }}>Query Parameters:</div>
                  <div style={{
                    backgroundColor: '#fff',
                    padding: '8px',
                    borderRadius: '3px',
                    fontFamily: 'monospace',
                    fontSize: '12px',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                  }}>
                    {JSON.stringify(apiTestResult.queryParams, null, 2)}
                  </div>
                </div>
              )}

              {/* Response Data */}
              {apiTestResult.success && apiTestResult.executeStatus?.data && (
                <div style={{ padding: '12px', backgroundColor: '#fafafa', borderRadius: '4px', border: '1px solid #d9d9d9' }}>
                  <div style={{ fontSize: '12px', color: '#666', marginBottom: '8px', fontWeight: 'bold' }}>Execute Response:</div>
                  <div style={{
                    backgroundColor: '#fff',
                    padding: '8px',
                    borderRadius: '3px',
                    fontFamily: 'monospace',
                    fontSize: '11px',
                    maxHeight: '300px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}>
                    {JSON.stringify(apiTestResult.executeStatus.data, null, 2)}
                  </div>
                </div>
              )}

              {/* Error */}
              {!apiTestResult.success && (
                <div style={{ padding: '12px', backgroundColor: '#fff2f0', borderRadius: '4px', border: '1px solid #ffccc7' }}>
                  <div style={{ fontSize: '12px', color: '#cf1322', fontWeight: 'bold' }}>❌ Error:</div>
                  <div style={{ marginTop: '8px', fontSize: '12px', color: '#cf1322' }}>
                    {apiTestResult.error}
                  </div>
                </div>
              )}
            </div>
          )}
        </Spin>
      </Modal>
    </div>
  );
}
