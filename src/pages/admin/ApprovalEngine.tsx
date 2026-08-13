import { buildApexUrl } from '../config/api.helper';
// ─────────────────────────────────────────────────────────────────────────────
// Approval Management Engine — Main UI Page
// ─────────────────────────────────────────────────────────────────────────────

import React, { useState, useEffect } from 'react';
import {
  Layout,
  Typography,
  Tabs,
  Table,
  Button,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Tag,
  Space,
  Card,
  Row,
  Col,
  Tooltip,
  Alert,
  Timeline,
  Drawer,
  Divider,
  Popconfirm,
  Avatar,
  notification,
  message,
  Breadcrumb,
  Badge,
  Radio,
  Empty,
  Statistic,
} from 'antd';
import {
  HomeOutlined,
  TeamOutlined,
  SafetyOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SendOutlined,
  EditOutlined,
  DeleteOutlined,
  PlusOutlined,
  UserOutlined,
  MailOutlined,
  BellOutlined,
  HistoryOutlined,
  ApartmentOutlined,
  ApiOutlined,
  ThunderboltOutlined,
  EyeOutlined,
  ForwardOutlined,
  RollbackOutlined,
  PhoneOutlined,
  SettingOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import type {
  ApprovalUser,
  ApprovalRule,
  ApprovalRequest,
  ApprovalHistoryEntry,
  RuleApprover,
  EmailReply,
  ApprovalToken,
} from '../../services/approvals.service';
import {
  APPROVAL_MODULES,
  TRANSACTION_TYPES,
  getApprovalUsers,
  createApprovalUser,
  updateApprovalUser,
  deleteApprovalUser,
  getApprovalRules,
  createApprovalRule,
  updateApprovalRule,
  deleteApprovalRule,
  getApprovalRequests,
  getApprovalHistory,
  sendTestNotification,
  getEmailReplies,
  processEmailReply,
  simulateEmailReply,
  getApprovalTokens,
} from '../../services/approvals.service';

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;

const APEX_ADMIN_BASE = buildApexUrl('admin');
const APPROVAL_BASE   = buildApexUrl('approvals');

// ─── Oracle Redwood Color Palette ─────────────────────────────────────────────

const REDWOOD = {
  primary: '#C74634',
  primaryLight: '#E85D4A',
  primaryDark: '#A33B2C',
  success: '#1D7B4D',
  warning: '#D4A800',
  info: '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral300: '#C7C7C7',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface: '#FFFFFF',
  surfaceSecondary: '#F5F5F5',
  textPrimary: '#1A1A1A',
  textSecondary: '#6B6B6B',
};

// ─── Helper Utilities ─────────────────────────────────────────────────────────

const fmtAmount = (n?: number | null, ccy = 'AED') =>
  n == null
    ? 'Unlimited'
    : new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n) +
      ' ' +
      ccy;

const statusColor = (s: string): string =>
  (({
    PENDING: 'orange',
    APPROVED: 'success',
    REJECTED: 'error',
    CANCELLED: 'default',
    RECALLED: 'purple',
  } as Record<string, string>)[s] ?? 'default');

const actionColor = (a: string): string =>
  (({
    SUBMITTED: '#0572CE',
    APPROVED: '#1D7B4D',
    REJECTED: '#C74634',
    FORWARDED: '#0572CE',
    RECALLED: '#D4A800',
    NOTIFIED: '#722ed1',
    CANCELLED: '#6B6B6B',
  } as Record<string, string>)[a] ?? '#6B6B6B');

const actionIcon = (a: string): React.ReactNode => {
  const iconMap: Record<string, React.ReactNode> = {
    SUBMITTED: <SendOutlined />,
    APPROVED: <CheckCircleOutlined />,
    REJECTED: <CloseCircleOutlined />,
    FORWARDED: <ForwardOutlined />,
    RECALLED: <RollbackOutlined />,
    NOTIFIED: <BellOutlined />,
    CANCELLED: <CloseCircleOutlined />,
  };
  return iconMap[a] ?? <HistoryOutlined />;
};

const moduleColor = (m: string): string =>
  (({
    AP: '#C74634',
    AR: '#0572CE',
    CASH: '#1D7B4D',
    GL: '#D4A800',
    FA: '#722ed1',
    PROCUREMENT: '#08979c',
  } as Record<string, string>)[m] ?? '#6B6B6B');

const approvalTypeLabel: Record<string, string> = {
  SEQUENTIAL: 'Sequential',
  PARALLEL: 'Parallel',
  ANY_ONE: 'Any One',
};

const approvalTypeColor: Record<string, string> = {
  SEQUENTIAL: 'blue',
  PARALLEL: 'green',
  ANY_ONE: 'orange',
};

// ─── Error Boundary ───────────────────────────────────────────────────────────

class ApprovalErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32 }}>
          <Alert
            type="error"
            showIcon
            message="Approval Engine failed to render"
            description={
              <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {this.state.error.message}
                {'\n\n'}
                {this.state.error.stack}
              </pre>
            }
          />
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────

const ApprovalEngine: React.FC = () => {
  const { user } = useAuth();
  // ── Tab state ────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState('approvers');

  // ── Approvers state ──────────────────────────────────────────────────────────
  const [approvers, setApprovers] = useState<ApprovalUser[]>([]);
  const [approversLoading, setApproversLoading] = useState(false);
  const [approverModalOpen, setApproverModalOpen] = useState(false);
  const [editingApprover, setEditingApprover] = useState<ApprovalUser | null>(null);
  const [approverForm] = Form.useForm();
  const [approverSearch, setApproverSearch] = useState('');

  // ── Rules state ───────────────────────────────────────────────────────────────
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(false);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ApprovalRule | null>(null);
  const [ruleForm] = Form.useForm();
  const [ruleModule, setRuleModule] = useState<string | undefined>();
  const [selectedRuleApprovers, setSelectedRuleApprovers] = useState<RuleApprover[]>([]);
  const [ruleModuleFilter, setRuleModuleFilter] = useState<string | undefined>();

  // ── Requests state ────────────────────────────────────────────────────────────
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [reqModuleFilter, setReqModuleFilter] = useState<string | undefined>();
  const [reqStatusFilter, setReqStatusFilter] = useState<string | undefined>();
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<ApprovalRequest | null>(null);
  const [historyEntries, setHistoryEntries] = useState<ApprovalHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // ── Notifications state ───────────────────────────────────────────────────────
  const [testUser, setTestUser] = useState<number | undefined>();
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; usingTokens?: boolean; message: string } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  // ── Email Confirmations state ─────────────────────────────────────────────────
  const [emailReplies, setEmailReplies]             = useState<EmailReply[]>([]);
  const [emailRepliesLoading, setEmailRepliesLoading] = useState(false);
  const [processingReplyId, setProcessingReplyId]   = useState<number | null>(null);
  const [simAction, setSimAction]                   = useState<'APPROVE' | 'REJECT'>('APPROVE');
  const [simRef, setSimRef]                         = useState('INV-TEST-001');
  const [simSending, setSimSending]                 = useState(false);

  // ── Token Links state ─────────────────────────────────────────
  const [tokens, setTokens]               = useState<ApprovalToken[]>([]);
  const [tokensLoading, setTokensLoading] = useState(false);

  // ── Saving state ─────────────────────────────────────────────────────────────
  const [approverSaving, setApproverSaving] = useState(false);
  const [ruleSaving, setRuleSaving] = useState(false);

  // ── ERP system users (for approver picker) ────────────────────────────────────
  const [erpUsers, setErpUsers]               = useState<{ label: string; value: string; username: string; email?: string }[]>([]);
  const [erpUsersLoading, setErpUsersLoading] = useState(false);

  // ── API inspector ─────────────────────────────────────────────────────────────
  const [apiModalOpen, setApiModalOpen] = useState(false);

  // ── Approver modal API test panel ─────────────────────────────────────────────
  const [approverApiPanelOpen, setApproverApiPanelOpen] = useState(false);
  const [approverApiTesting, setApproverApiTesting]     = useState(false);
  const [approverApiResult, setApproverApiResult]       = useState<{ ok: boolean; body: string } | null>(null);

  // ── Rule modal API test panel ─────────────────────────────────────────────────
  const [ruleApiPanelOpen, setRuleApiPanelOpen]   = useState(false);
  const [ruleApiTesting, setRuleApiTesting]       = useState(false);
  const [ruleApiResult, setRuleApiResult]         = useState<{ ok: boolean; body: string } | null>(null);

  // ─── Data Loading ─────────────────────────────────────────────────────────────

  useEffect(() => {
    loadApprovers();
    loadRules();
    loadRequests();
  }, []);

  useEffect(() => {
    if (activeTab === 'email-confirmations') loadEmailReplies();
    if (activeTab === 'tokens') loadTokens();
  }, [activeTab]);

  const loadApprovers = async () => {
    setApproversLoading(true);
    try {
      setApprovers(await getApprovalUsers());
    } catch {
      message.error('Failed to load approvers');
    } finally {
      setApproversLoading(false);
    }
  };

  const loadRules = async () => {
    setRulesLoading(true);
    try {
      setRules(await getApprovalRules());
    } catch {
      message.error('Failed to load approval rules');
    } finally {
      setRulesLoading(false);
    }
  };

  const loadRequests = async () => {
    setRequestsLoading(true);
    try {
      setRequests(await getApprovalRequests());
    } catch (e: any) {
      message.error(`Failed to load requests: ${e.message ?? e}`);
    } finally {
      setRequestsLoading(false);
    }
  };

  const loadErpUsers = async () => {
    setErpUsersLoading(true);
    try {
      const res  = await fetch(`${APEX_ADMIN_BASE}/users`);
      const data = await res.json();
      // admin/users returns { status, data: [...] }
      const items: any[] = data.data ?? data.items ?? (Array.isArray(data) ? data : []);
      setErpUsers(
        items
          .filter((u: any) => u.username && u.suspended_flag !== 'Y')
          .map((u: any) => ({
            label:    u.email
                        ? `${u.username}  —  ${u.email}`
                        : u.username,
            value:    u.username,
            username: u.username,
            email:    u.email ?? u.username,  // username IS the email in this system
          }))
      );
    } catch {
      // silently ignore
    } finally {
      setErpUsersLoading(false);
    }
  };

  // ─── Approver Handlers ────────────────────────────────────────────────────────

  const openApproverModal = (record?: ApprovalUser) => {
    setEditingApprover(record ?? null);
    approverForm.resetFields();
    if (record) {
      approverForm.setFieldsValue({
        fullName: record.fullName,
        email: record.email,
        phoneNumber: record.phoneNumber,
        department: record.department,
        jobTitle: record.jobTitle,
        maxApprovalAmount: record.maxApprovalAmount,
        currency: record.currency,
        modules: record.modules,
        active: record.active === 'Y',
      });
    } else {
      approverForm.setFieldsValue({ currency: 'AED', active: true });
      loadErpUsers();
    }
    setApproverModalOpen(true);
  };

  const buildApproverPayload = (values: any) => ({
    fullName: values.fullName,
    email: values.email,
    phoneNumber: values.phoneNumber ?? null,
    department: values.department ?? null,
    jobTitle: values.jobTitle ?? null,
    maxApprovalAmount: values.maxApprovalAmount ?? null,
    currency: values.currency ?? 'AED',
    modules: values.modules ?? [],
    active: (values.active ? 'Y' : 'N') as 'Y' | 'N',
  });

  const handleApproverApiTest = async () => {
    const values = approverForm.getFieldsValue();
    const payload = buildApproverPayload(values);
    const url = editingApprover
      ? `${APPROVAL_BASE}/users/${editingApprover.userId}`
      : `${APPROVAL_BASE}/users`;
    const method = editingApprover ? 'PUT' : 'POST';
    setApproverApiTesting(true);
    setApproverApiResult(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      setApproverApiResult({ ok: res.ok, body: text });
    } catch (e: any) {
      setApproverApiResult({ ok: false, body: e.message });
    } finally {
      setApproverApiTesting(false);
    }
  };

  const handleApproverSave = async () => {
    try {
      const values = await approverForm.validateFields();
      setApproverSaving(true);
      const payload = buildApproverPayload(values);
      if (editingApprover) {
        await updateApprovalUser(editingApprover.userId, payload);
        notification.success({ message: 'Approver updated successfully' });
      } else {
        await createApprovalUser(payload);
        notification.success({ message: 'Approver created successfully' });
      }
      setApproverModalOpen(false);
      loadApprovers();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return; // validation error
      message.error('Failed to save approver');
    } finally {
      setApproverSaving(false);
    }
  };

  const handleApproverDelete = async (userId: number) => {
    try {
      await deleteApprovalUser(userId);
      notification.success({ message: 'Approver deleted' });
      loadApprovers();
    } catch {
      message.error('Failed to delete approver');
    }
  };

  const handleTestNotify = async (userId: number) => {
    setTestUser(userId);
    setActiveTab('notifications');
  };

  // ─── Rule Handlers ────────────────────────────────────────────────────────────

  const openRuleModal = (record?: ApprovalRule) => {
    setEditingRule(record ?? null);
    ruleForm.resetFields();
    setSelectedRuleApprovers([]);
    if (record) {
      setRuleModule(record.module);
      ruleForm.setFieldsValue({
        ruleName: record.ruleName,
        description: record.description,
        module: record.module,
        transactionType: record.transactionType,
        minAmount: record.minAmount,
        maxAmount: record.maxAmount,
        currency: record.currency,
        approvalType: record.approvalType,
        priority: record.priority,
        active: record.active === 'Y',
      });
      setSelectedRuleApprovers(record.approvers ?? []);
    } else {
      ruleForm.setFieldsValue({
        currency: 'AED',
        approvalType: 'SEQUENTIAL',
        priority: 10,
        minAmount: 0,
        active: true,
      });
    }
    setRuleModalOpen(true);
  };

  const handleRuleSave = async () => {
    try {
      const values = await ruleForm.validateFields();
      setRuleSaving(true);
      const payload = buildRulePayload(values);
      if (editingRule) {
        await updateApprovalRule(editingRule.ruleId, payload);
        notification.success({ message: 'Rule updated successfully' });
      } else {
        await createApprovalRule(payload);
        notification.success({ message: 'Rule created successfully' });
      }
      setRuleModalOpen(false);
      loadRules();
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error('Failed to save approval rule');
    } finally {
      setRuleSaving(false);
    }
  };

  const buildRulePayload = (values: any) => ({
    ruleName: values.ruleName,
    description: values.description ?? null,
    module: values.module,
    transactionType: values.transactionType,
    minAmount: values.minAmount ?? 0,
    maxAmount: values.maxAmount ?? null,
    currency: values.currency ?? 'AED',
    approvalType: values.approvalType ?? 'SEQUENTIAL',
    priority: values.priority ?? 10,
    active: (values.active ? 'Y' : 'N') as 'Y' | 'N',
    approvers: selectedRuleApprovers,
  });

  const handleRuleApiTest = async () => {
    const values = ruleForm.getFieldsValue();
    const payload = buildRulePayload(values);
    const url = editingRule
      ? `${APPROVAL_BASE}/rules/${editingRule.ruleId}`
      : `${APPROVAL_BASE}/rules`;
    const method = editingRule ? 'PUT' : 'POST';
    setRuleApiTesting(true);
    setRuleApiResult(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      setRuleApiResult({ ok: res.ok, body: text });
    } catch (e: any) {
      setRuleApiResult({ ok: false, body: e.message });
    } finally {
      setRuleApiTesting(false);
    }
  };

  const handleRuleDelete = async (ruleId: number) => {
    try {
      await deleteApprovalRule(ruleId);
      notification.success({ message: 'Rule deleted' });
      loadRules();
    } catch {
      message.error('Failed to delete approval rule');
    }
  };

  // ─── Rule Approver Management ─────────────────────────────────────────────────

  const addRuleApprover = (userId: number) => {
    const user = approvers.find((a) => a.userId === userId);
    if (!user) return;
    if (selectedRuleApprovers.find((a) => a.userId === userId)) {
      message.warning('This approver is already in the list');
      return;
    }
    const nextSeq = selectedRuleApprovers.length + 1;
    setSelectedRuleApprovers([
      ...selectedRuleApprovers,
      {
        sequence: nextSeq,
        userId: user.userId,
        fullName: user.fullName,
        email: user.email,
        department: user.department,
      },
    ]);
  };

  const removeRuleApprover = (userId: number) => {
    const updated = selectedRuleApprovers
      .filter((a) => a.userId !== userId)
      .map((a, i) => ({ ...a, sequence: i + 1 }));
    setSelectedRuleApprovers(updated);
  };

  const moveRuleApprover = (index: number, direction: 'up' | 'down') => {
    const arr = [...selectedRuleApprovers];
    const swapIdx = direction === 'up' ? index - 1 : index + 1;
    if (swapIdx < 0 || swapIdx >= arr.length) return;
    [arr[index], arr[swapIdx]] = [arr[swapIdx], arr[index]];
    setSelectedRuleApprovers(arr.map((a, i) => ({ ...a, sequence: i + 1 })));
  };

  // ─── History / Requests Handlers ──────────────────────────────────────────────

  const openHistoryDrawer = async (request: ApprovalRequest) => {
    setSelectedRequest(request);
    setHistoryDrawerOpen(true);
    setHistoryLoading(true);
    try {
      const entries = await getApprovalHistory(request.requestId);
      setHistoryEntries(entries);
    } catch {
      message.error('Failed to load approval history');
    } finally {
      setHistoryLoading(false);
    }
  };

  // ─── Notification Handlers ────────────────────────────────────────────────────

  const handleSendTest = async () => {
    if (!testUser) {
      message.warning('Please select an approver first');
      return;
    }
    const approver = approvers.find((a) => a.userId === testUser);
    if (!approver?.email) {
      message.warning('Selected approver has no email address');
      return;
    }
    setTestSending(true);
    setTestResult(null);
    try {
      const result = await sendTestNotification(approver.email, approver.fullName);
      setTestResult(result);
    } catch (err: unknown) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : 'Failed to send test notification',
      });
    } finally {
      setTestSending(false);
    }
  };

  // ─── Email Confirmations handlers ────────────────────────────────────────────

  const loadEmailReplies = async () => {
    setEmailRepliesLoading(true);
    try {
      setEmailReplies(await getEmailReplies());
    } catch {
      message.error('Failed to load email replies');
    } finally {
      setEmailRepliesLoading(false);
    }
  };

  const loadTokens = async () => {
    setTokensLoading(true);
    try {
      setTokens(await getApprovalTokens());
    } catch {
      // silently ignore — tokens endpoint may not be deployed yet
    } finally {
      setTokensLoading(false);
    }
  };

  const handleProcessReply = async (reply: EmailReply) => {
    setProcessingReplyId(reply.replyId);
    try {
      const actorName = user?.name ?? user?.username ?? undefined;
      await processEmailReply(reply.replyId, reply.actionDetected, reply.requestId, undefined, actorName);
      notification.success({
        message: `Reply ${reply.actionDetected === 'APPROVE' ? 'Approved ✓' : 'Rejected ✗'}`,
        description: `Ref: ${reply.refNumber || '—'} — AP webservice call would fire here.`,
        duration: 5,
      });
      loadEmailReplies();
    } catch {
      message.error('Failed to process reply');
    } finally {
      setProcessingReplyId(null);
    }
  };

  const handleSimulateReply = async () => {
    if (!simRef.trim()) { message.warning('Enter a reference number'); return; }
    setSimSending(true);
    try {
      await simulateEmailReply(simAction, simRef.trim());
      message.success(`Simulated ${simAction} reply inserted`);
      loadEmailReplies();
    } catch {
      message.error('Simulate failed');
    } finally {
      setSimSending(false);
    }
  };

  // ─── Filtered data ────────────────────────────────────────────────────────────

  const filteredApprovers = approvers.filter((a) => {
    if (!approverSearch) return true;
    const q = approverSearch.toLowerCase();
    return (
      a.fullName.toLowerCase().includes(q) ||
      a.email.toLowerCase().includes(q) ||
      (a.department ?? '').toLowerCase().includes(q)
    );
  });

  const filteredRules = ruleModuleFilter
    ? rules.filter((r) => r.module === ruleModuleFilter)
    : rules;

  const filteredRequests = requests.filter((r) => {
    if (reqModuleFilter && r.module !== reqModuleFilter) return false;
    if (reqStatusFilter && r.status !== reqStatusFilter) return false;
    return true;
  });

  // ─── Module-filtered approvers for rule modal ─────────────────────────────────
  const eligibleApprovers = ruleModule
    ? approvers.filter((a) => a.modules.includes(ruleModule) && a.active === 'Y')
    : approvers.filter((a) => a.active === 'Y');

  const selectedApproverIds = selectedRuleApprovers.map((a) => a.userId);

  // ─── Preview email approver ───────────────────────────────────────────────────
  const previewApprover = testUser ? approvers.find((a) => a.userId === testUser) : null;

  // ─── Tab 1 — Approvers ────────────────────────────────────────────────────────

  const renderApproversTab = () => {
    const columns = [
      {
        title: 'Name',
        key: 'name',
        render: (_: unknown, record: ApprovalUser) => (
          <Space>
            <Avatar
              style={{
                background: `${moduleColor(record.modules[0] ?? 'AP')}20`,
                color: moduleColor(record.modules[0] ?? 'AP'),
                fontWeight: 600,
              }}
              icon={<UserOutlined />}
            />
            <div>
              <div style={{ fontWeight: 500, color: REDWOOD.textPrimary }}>{record.fullName}</div>
              {record.jobTitle && (
                <div style={{ fontSize: 12, color: REDWOOD.textSecondary }}>{record.jobTitle}</div>
              )}
            </div>
          </Space>
        ),
      },
      {
        title: 'Email',
        dataIndex: 'email',
        key: 'email',
        render: (email: string) => (
          <Space size={4}>
            <MailOutlined style={{ color: REDWOOD.textSecondary }} />
            <Text style={{ fontSize: 13 }}>{email}</Text>
          </Space>
        ),
      },
      {
        title: 'Department',
        dataIndex: 'department',
        key: 'department',
        render: (d?: string) => d ?? <Text type="secondary">—</Text>,
      },
      {
        title: 'Max Amount',
        key: 'maxAmount',
        render: (_: unknown, record: ApprovalUser) => (
          <Text style={{ fontWeight: 500 }}>
            {fmtAmount(record.maxApprovalAmount, record.currency)}
          </Text>
        ),
      },
      {
        title: 'Modules',
        key: 'modules',
        render: (_: unknown, record: ApprovalUser) => (
          <Space wrap size={4}>
            {(record.modules ?? []).map((m) => (
              <Tag
                key={m}
                style={{
                  background: `${moduleColor(m)}15`,
                  borderColor: `${moduleColor(m)}40`,
                  color: moduleColor(m),
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {m}
              </Tag>
            ))}
          </Space>
        ),
      },
      {
        title: 'Status',
        key: 'active',
        render: (_: unknown, record: ApprovalUser) =>
          record.active === 'Y' ? (
            <Badge status="success" text="Active" />
          ) : (
            <Badge status="default" text="Inactive" />
          ),
      },
      {
        title: 'Actions',
        key: 'actions',
        render: (_: unknown, record: ApprovalUser) => (
          <Space>
            <Tooltip title="Edit">
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => openApproverModal(record)}
              />
            </Tooltip>
            <Tooltip title="Send Test Notification">
              <Button
                size="small"
                icon={<BellOutlined />}
                style={{ color: REDWOOD.info, borderColor: REDWOOD.info }}
                onClick={() => handleTestNotify(record.userId)}
              />
            </Tooltip>
            <Popconfirm
              title="Delete this approver?"
              description="This action cannot be undone."
              onConfirm={() => handleApproverDelete(record.userId)}
              okText="Delete"
              okButtonProps={{ danger: true }}
            >
              <Tooltip title="Delete">
                <Button size="small" icon={<DeleteOutlined />} danger />
              </Tooltip>
            </Popconfirm>
          </Space>
        ),
      },
    ];

    return (
      <div style={{ padding: '16px 24px 24px' }}>
        <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
          <Col>
            <Input.Search
              placeholder="Search by name, email or department…"
              value={approverSearch}
              onChange={(e) => setApproverSearch(e.target.value)}
              style={{ width: 320 }}
              allowClear
            />
          </Col>
          <Col>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
              onClick={() => openApproverModal()}
            >
              Add Approver
            </Button>
          </Col>
        </Row>

        <Table
          dataSource={filteredApprovers}
          columns={columns}
          rowKey="userId"
          size="small"
          bordered
          loading={approversLoading}
          locale={{
            emptyText: (
              <Empty
                description="No approvers configured yet. Click 'Add Approver' to get started."
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ),
          }}
          pagination={{ pageSize: 10, showSizeChanger: true }}
        />
      </div>
    );
  };

  // ─── Tab 2 — Approval Rules ───────────────────────────────────────────────────

  const renderRulesTab = () => {
    const columns = [
      {
        title: 'Priority',
        dataIndex: 'priority',
        key: 'priority',
        sorter: (a: ApprovalRule, b: ApprovalRule) => a.priority - b.priority,
        render: (p: number) => (
          <Tag style={{ fontWeight: 700, minWidth: 32, textAlign: 'center' }}>{p}</Tag>
        ),
      },
      {
        title: 'Rule Name',
        dataIndex: 'ruleName',
        key: 'ruleName',
        render: (name: string, record: ApprovalRule) => (
          <div>
            <div style={{ fontWeight: 500 }}>{name}</div>
            {record.description && (
              <div style={{ fontSize: 12, color: REDWOOD.textSecondary }}>{record.description}</div>
            )}
          </div>
        ),
      },
      {
        title: 'Module',
        dataIndex: 'module',
        key: 'module',
        render: (m: string) => (
          <Tag
            style={{
              background: `${moduleColor(m)}15`,
              borderColor: `${moduleColor(m)}40`,
              color: moduleColor(m),
              fontWeight: 600,
            }}
          >
            {m}
          </Tag>
        ),
      },
      {
        title: 'Transaction Type',
        dataIndex: 'transactionType',
        key: 'transactionType',
        render: (t: string) => <Text style={{ fontSize: 12 }}>{t}</Text>,
      },
      {
        title: 'Amount Range',
        key: 'amountRange',
        render: (_: unknown, record: ApprovalRule) => (
          <Text style={{ fontFamily: 'monospace', fontSize: 12 }}>
            {fmtAmount(record.minAmount, record.currency)} –{' '}
            {fmtAmount(record.maxAmount, record.currency)}
          </Text>
        ),
      },
      {
        title: 'Approval Type',
        dataIndex: 'approvalType',
        key: 'approvalType',
        render: (t: string) => (
          <Tag color={approvalTypeColor[t] ?? 'default'}>{approvalTypeLabel[t] ?? t}</Tag>
        ),
      },
      {
        title: 'Approvers',
        key: 'approvers',
        render: (_: unknown, record: ApprovalRule) => (
          <Avatar.Group max={{ count: 3 }}>
            {(record.approvers ?? []).map((a) => (
              <Tooltip key={a.userId} title={`${a.fullName} (seq: ${a.sequence})`}>
                <Avatar
                  size="small"
                  style={{ background: REDWOOD.info, cursor: 'default' }}
                >
                  {a.fullName.charAt(0)}
                </Avatar>
              </Tooltip>
            ))}
          </Avatar.Group>
        ),
      },
      {
        title: 'Status',
        key: 'active',
        render: (_: unknown, record: ApprovalRule) =>
          record.active === 'Y' ? (
            <Badge status="success" text="Active" />
          ) : (
            <Badge status="default" text="Inactive" />
          ),
      },
      {
        title: 'Actions',
        key: 'actions',
        render: (_: unknown, record: ApprovalRule) => (
          <Space>
            <Tooltip title="Edit">
              <Button size="small" icon={<EditOutlined />} onClick={() => openRuleModal(record)} />
            </Tooltip>
            <Popconfirm
              title="Delete this rule?"
              description="This will also remove all approver assignments for this rule."
              onConfirm={() => handleRuleDelete(record.ruleId)}
              okText="Delete"
              okButtonProps={{ danger: true }}
            >
              <Tooltip title="Delete">
                <Button size="small" icon={<DeleteOutlined />} danger />
              </Tooltip>
            </Popconfirm>
          </Space>
        ),
      },
    ];

    return (
      <div style={{ padding: '16px 24px 24px' }}>
        <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
          <Col>
            <Select
              placeholder="Filter by Module"
              allowClear
              value={ruleModuleFilter}
              onChange={setRuleModuleFilter}
              style={{ width: 200 }}
              options={APPROVAL_MODULES.map((m) => ({ label: m, value: m }))}
            />
          </Col>
          <Col>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
              onClick={() => openRuleModal()}
            >
              Add Rule
            </Button>
          </Col>
        </Row>

        <Table
          dataSource={filteredRules}
          columns={columns}
          rowKey="ruleId"
          size="small"
          bordered
          loading={rulesLoading}
          locale={{
            emptyText: (
              <Empty
                description="No approval rules configured yet. Click 'Add Rule' to create one."
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ),
          }}
          pagination={{ pageSize: 10, showSizeChanger: true }}
        />
      </div>
    );
  };

  // ─── Tab 3 — Requests & History ───────────────────────────────────────────────

  const renderRequestsTab = () => {
    const columns = [
      {
        title: 'ID',
        dataIndex: 'requestId',
        key: 'requestId',
        width: 70,
        render: (id: number) => <Text style={{ fontSize: 12, color: REDWOOD.textSecondary }}>#{id}</Text>,
      },
      {
        title: 'Txn Number',
        dataIndex: 'transactionRef',
        key: 'transactionRef',
        width: 170,
        render: (ref: string) => <Text strong style={{ fontFamily: 'monospace', fontSize: 12 }}>{ref}</Text>,
      },
      {
        title: 'Description',
        dataIndex: 'description',
        key: 'description',
        ellipsis: true,
        render: (d?: string) => d
          ? <Text style={{ fontSize: 12 }}>{d}</Text>
          : <Text type="secondary">—</Text>,
      },
      {
        title: 'Module',
        dataIndex: 'module',
        key: 'module',
        render: (m: string) => (
          <Tag
            style={{
              background: `${moduleColor(m)}15`,
              borderColor: `${moduleColor(m)}40`,
              color: moduleColor(m),
              fontWeight: 600,
            }}
          >
            {m}
          </Tag>
        ),
      },
      {
        title: 'Type',
        dataIndex: 'transactionType',
        key: 'transactionType',
        render: (t: string) => <Text style={{ fontSize: 12 }}>{t}</Text>,
      },
      {
        title: 'Amount',
        key: 'amount',
        render: (_: unknown, record: ApprovalRequest) => (
          <Text style={{ fontWeight: 500 }}>{fmtAmount(record.amount, record.currency)}</Text>
        ),
      },
      {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        render: (s: string) => <Tag color={statusColor(s)}>{s}</Tag>,
      },
      {
        title: 'Requested By',
        dataIndex: 'requestedByName',
        key: 'requestedByName',
      },
      {
        title: 'Date',
        dataIndex: 'requestedDate',
        key: 'requestedDate',
        render: (d: string) => (
          <Text style={{ fontSize: 12 }}>{d ? new Date(d).toLocaleDateString() : '—'}</Text>
        ),
      },
      {
        title: 'Current Approver',
        dataIndex: 'currentApproverName',
        key: 'currentApproverName',
        render: (n?: string) => n ?? <Text type="secondary">—</Text>,
      },
      {
        title: 'Actions',
        key: 'actions',
        render: (_: unknown, record: ApprovalRequest) => (
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => openHistoryDrawer(record)}
          >
            History
          </Button>
        ),
      },
    ];

    return (
      <div style={{ padding: '16px 24px 24px' }}>
        <Row gutter={12} style={{ marginBottom: 16 }}>
          <Col>
            <Select
              placeholder="Filter by Module"
              allowClear
              value={reqModuleFilter}
              onChange={setReqModuleFilter}
              style={{ width: 180 }}
              options={APPROVAL_MODULES.map((m) => ({ label: m, value: m }))}
            />
          </Col>
          <Col>
            <Select
              placeholder="Filter by Status"
              allowClear
              value={reqStatusFilter}
              onChange={setReqStatusFilter}
              style={{ width: 180 }}
              options={['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'RECALLED'].map((s) => ({
                label: s,
                value: s,
              }))}
            />
          </Col>
          <Col>
            <Button icon={<ThunderboltOutlined />} onClick={loadRequests}>
              Refresh
            </Button>
          </Col>
        </Row>

        <Table
          dataSource={filteredRequests}
          columns={columns}
          rowKey="requestId"
          size="small"
          bordered
          loading={requestsLoading}
          locale={{
            emptyText: (
              <Empty
                description="No approval requests yet. Requests will appear here when transactions are submitted for approval."
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ),
          }}
          pagination={{ pageSize: 15, showSizeChanger: true }}
        />
      </div>
    );
  };

  // ─── Tab 4 — Notifications ────────────────────────────────────────────────────

  const renderNotificationsTab = () => {
    const sqlSnippet = `-- ORDS handler for notify/test
BEGIN
  ORDS.DEFINE_HANDLER(
    p_module_name    => 'reerp',
    p_pattern        => 'approvals/notify/test',
    p_method         => 'POST',
    p_source_type    => 'plsql/block',
    p_source         => q'[
      DECLARE
        v_user_id NUMBER := :user_id;
        v_email   VARCHAR2(300);
        v_name    VARCHAR2(200);
      BEGIN
        SELECT EMAIL, FULL_NAME INTO v_email, v_name
        FROM RR_APPROVAL_USERS WHERE USER_ID = v_user_id;
        APEX_MAIL.SEND(
          p_to        => v_email,
          p_from      => 'noreply@bumeric.ae',
          p_subj      => '[TEST] ERP Approval Notification',
          p_body      => 'Dear '||v_name||', test notification.',
          p_body_html => '<p>Dear '||v_name||', test notification.</p>'
        );
        APEX_MAIL.PUSH_QUEUE;
        :status := 200;
        :body   := ''{"success":true}'';
      END;
    ]'
  );
  COMMIT;
END;`;

    return (
      <div style={{ padding: '16px 24px 24px' }}>
        <Row gutter={24}>
          {/* Section 1 — Test Notification */}
          <Col xs={24} lg={14}>
            <Card
              title={
                <Space>
                  <BellOutlined style={{ color: REDWOOD.info }} />
                  <span>Send Test Notification</span>
                </Space>
              }
              bordered
              style={{ marginBottom: 24 }}
            >
              <Paragraph type="secondary">
                Send a test email notification to verify your email configuration is working
                correctly. Select an approver below and click the send button.
              </Paragraph>

              <Row gutter={12} align="middle" style={{ marginTop: 16 }}>
                <Col flex="1">
                  <Select
                    placeholder="Select approver to test…"
                    value={testUser}
                    onChange={setTestUser}
                    style={{ width: '100%' }}
                    showSearch
                    filterOption={(input, option) =>
                      (option?.label?.toString() ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                    options={approvers
                      .filter((a) => a.active === 'Y')
                      .map((a) => ({
                        label: `${a.fullName} — ${a.email}`,
                        value: a.userId,
                      }))}
                  />
                </Col>
                <Col>
                  <Button
                    type="primary"
                    icon={<SendOutlined />}
                    loading={testSending}
                    onClick={handleSendTest}
                    style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
                  >
                    Send Test
                  </Button>
                </Col>
                <Col>
                  <Button icon={<EyeOutlined />} onClick={() => setPreviewOpen(true)}>
                    Preview Email
                  </Button>
                </Col>
              </Row>

              {testResult && (
                <Alert
                  style={{ marginTop: 16 }}
                  type={
                    !testResult.success ? 'error' :
                    testResult.usingTokens ? 'success' : 'warning'
                  }
                  message={
                    !testResult.success ? 'Failed to send' :
                    testResult.usingTokens ? '✓ Email sent with secure token links' :
                    '⚠ Email sent — but using mailto: fallback (token links not active)'
                  }
                  description={
                    <>
                      {testResult.message}
                      {testResult.success && !testResult.usingTokens && (
                        <div style={{ marginTop: 8 }}>
                          <strong>To enable bumeric.ae token links, run in APEX SQL Workshop:</strong>
                          <ol style={{ margin: '6px 0 0 16px', fontSize: 12 }}>
                            <li>Step 1 from <code>07_approval_tokens.sql</code> — CREATE TABLE RR_APPROVAL_TOKENS</li>
                            <li>Updated Step 2 from <code>07_approval_tokens.sql</code> — POST approvals/tokens handler</li>
                            <li><code>08_get_tokens_endpoint.sql</code> — GET approvals/tokens handler</li>
                          </ol>
                        </div>
                      )}
                    </>
                  }
                  showIcon
                  closable
                  onClose={() => setTestResult(null)}
                />
              )}
            </Card>

            {/* Section 2 — Email Config Note */}
            <Card
              title={
                <Space>
                  <SettingOutlined style={{ color: REDWOOD.warning }} />
                  <span>Email Configuration</span>
                </Space>
              }
              bordered
            >
              <Alert
                type="info"
                showIcon
                message="ORDS Configuration Required"
                description={
                  <span>
                    Email notifications require the ORDS <code>approvals/notify</code> endpoint to
                    be configured with <strong>APEX_MAIL</strong> or SMTP settings. The test
                    endpoint at <code>approvals/notify/test</code> must be deployed to your APEX
                    workspace.
                  </span>
                }
                style={{ marginBottom: 16 }}
              />
              <Divider titlePlacement="left" style={{ fontSize: 13 }}>
                ORDS Handler SQL (deploy to Oracle APEX)
              </Divider>
              <pre
                style={{
                  background: REDWOOD.neutral100,
                  border: `1px solid ${REDWOOD.neutral200}`,
                  borderRadius: 6,
                  padding: 16,
                  fontSize: 11,
                  overflowX: 'auto',
                  color: REDWOOD.textPrimary,
                  lineHeight: 1.6,
                }}
              >
                {sqlSnippet}
              </pre>
            </Card>
          </Col>

          {/* Quick stats panel */}
          <Col xs={24} lg={10}>
            <Card title="Approver Summary" bordered>
              <Row gutter={[16, 16]}>
                <Col span={12}>
                  <Card
                    size="small"
                    style={{ background: `${REDWOOD.success}10`, borderColor: `${REDWOOD.success}30` }}
                  >
                    <div style={{ fontSize: 28, fontWeight: 700, color: REDWOOD.success }}>
                      {approvers.filter((a) => a.active === 'Y').length}
                    </div>
                    <div style={{ fontSize: 12, color: REDWOOD.textSecondary }}>Active Approvers</div>
                  </Card>
                </Col>
                <Col span={12}>
                  <Card
                    size="small"
                    style={{ background: `${REDWOOD.info}10`, borderColor: `${REDWOOD.info}30` }}
                  >
                    <div style={{ fontSize: 28, fontWeight: 700, color: REDWOOD.info }}>
                      {rules.filter((r) => r.active === 'Y').length}
                    </div>
                    <div style={{ fontSize: 12, color: REDWOOD.textSecondary }}>Active Rules</div>
                  </Card>
                </Col>
                <Col span={12}>
                  <Card
                    size="small"
                    style={{ background: `${REDWOOD.warning}10`, borderColor: `${REDWOOD.warning}30` }}
                  >
                    <div style={{ fontSize: 28, fontWeight: 700, color: REDWOOD.warning }}>
                      {requests.filter((r) => r.status === 'PENDING').length}
                    </div>
                    <div style={{ fontSize: 12, color: REDWOOD.textSecondary }}>Pending Requests</div>
                  </Card>
                </Col>
                <Col span={12}>
                  <Card
                    size="small"
                    style={{
                      background: `${REDWOOD.primary}10`,
                      borderColor: `${REDWOOD.primary}30`,
                    }}
                  >
                    <div style={{ fontSize: 28, fontWeight: 700, color: REDWOOD.primary }}>
                      {requests.filter((r) => r.status === 'APPROVED').length}
                    </div>
                    <div style={{ fontSize: 12, color: REDWOOD.textSecondary }}>Approved Total</div>
                  </Card>
                </Col>
              </Row>

              <Divider style={{ margin: '16px 0 12px' }} />
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>
                Coverage by Module
              </div>
              {APPROVAL_MODULES.map((m) => {
                const count = approvers.filter((a) => a.modules.includes(m) && a.active === 'Y').length;
                return (
                  <Row key={m} justify="space-between" align="middle" style={{ marginBottom: 6 }}>
                    <Col>
                      <Tag
                        style={{
                          background: `${moduleColor(m)}15`,
                          borderColor: `${moduleColor(m)}40`,
                          color: moduleColor(m),
                          fontWeight: 600,
                        }}
                      >
                        {m}
                      </Tag>
                    </Col>
                    <Col>
                      <Text style={{ fontSize: 13 }}>
                        {count} approver{count !== 1 ? 's' : ''}
                      </Text>
                    </Col>
                    <Col>
                      <Badge
                        status={count > 0 ? 'success' : 'error'}
                        text={count > 0 ? 'Covered' : 'Not covered'}
                      />
                    </Col>
                  </Row>
                );
              })}
            </Card>
          </Col>
        </Row>
      </div>
    );
  };

  // ─── Approver Modal ───────────────────────────────────────────────────────────

  const renderApproverModal = () => (
    <Modal
      title={
        <Space>
          <UserOutlined style={{ color: REDWOOD.info }} />
          {editingApprover ? 'Edit Approver' : 'Add New Approver'}
        </Space>
      }
      open={approverModalOpen}
      onCancel={() => { setApproverModalOpen(false); setApproverApiPanelOpen(false); setApproverApiResult(null); }}
      onOk={handleApproverSave}
      okText={editingApprover ? 'Save Changes' : 'Create Approver'}
      okButtonProps={{
        loading: approverSaving,
        style: { background: REDWOOD.primary, borderColor: REDWOOD.primary },
      }}
      footer={(_, { OkBtn, CancelBtn }) => (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: approverApiPanelOpen ? 8 : 0 }}>
            <Button
              size="small"
              icon={<ApiOutlined />}
              onClick={() => { setApproverApiPanelOpen(p => !p); setApproverApiResult(null); }}
              style={{ fontSize: 12, color: REDWOOD.textSecondary }}
              type="text"
            >
              API
            </Button>
            <Space>
              <CancelBtn />
              <OkBtn />
            </Space>
          </div>
          {approverApiPanelOpen && (
            <div style={{ background: '#0d1117', borderRadius: 6, padding: '10px 12px', fontSize: 12, fontFamily: 'monospace' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Space size={6}>
                  <Tag color={editingApprover ? 'gold' : 'green'} style={{ fontSize: 11 }}>{editingApprover ? 'PUT' : 'POST'}</Tag>
                  <Text style={{ fontSize: 11, color: '#8b949e' }}>{editingApprover ? `${APPROVAL_BASE}/users/${editingApprover.userId}` : `${APPROVAL_BASE}/users`}</Text>
                </Space>
                <Button
                  size="small"
                  loading={approverApiTesting}
                  onClick={handleApproverApiTest}
                  style={{ fontSize: 11, height: 24 }}
                >
                  Test
                </Button>
              </div>
              <pre style={{ color: '#e6edf3', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 180, overflowY: 'auto' }}>
                {JSON.stringify(buildApproverPayload(approverForm.getFieldsValue()), null, 2)}
              </pre>
              {approverApiResult && (
                <div style={{ marginTop: 8, borderTop: '1px solid #30363d', paddingTop: 8 }}>
                  <Tag color={approverApiResult.ok ? 'green' : 'red'} style={{ marginBottom: 4 }}>
                    {approverApiResult.ok ? 'SUCCESS' : 'ERROR'}
                  </Tag>
                  <pre style={{ color: approverApiResult.ok ? '#3fb950' : '#f85149', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 120, overflowY: 'auto' }}>
                    {(() => { try { return JSON.stringify(JSON.parse(approverApiResult.body), null, 2); } catch { return approverApiResult.body; } })()}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      destroyOnClose
      width={620}
    >
      <Form form={approverForm} layout="vertical" style={{ marginTop: 8 }}>
        {!editingApprover && (
          <>
            <Form.Item label={<Text strong>Select from existing ERP users</Text>}>
              <Select
                showSearch
                loading={erpUsersLoading}
                placeholder="Pick a user to pre-fill name…"
                options={erpUsers}
                optionFilterProp="label"
                allowClear
                style={{ width: '100%' }}
                onChange={(val: string) => {
                  if (val) {
                    const user = erpUsers.find(u => u.value === val);
                    approverForm.setFieldsValue({
                      fullName: val,
                      ...(user?.email ? { email: user.email } : {}),
                    });
                  }
                }}
              />
            </Form.Item>
            <Divider style={{ margin: '4px 0 16px' }} />
          </>
        )}
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="fullName"
              label="Full Name"
              rules={[{ required: true, message: 'Full name is required' }]}
            >
              <Input prefix={<UserOutlined />} placeholder="e.g. Ahmed Al Rashid" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="email"
              label="Email Address"
              rules={[
                { required: true, message: 'Email is required' },
                { type: 'email', message: 'Enter a valid email address' },
              ]}
            >
              <Input prefix={<MailOutlined />} placeholder="user@company.com" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="phoneNumber" label="Phone Number">
              <Input prefix={<PhoneOutlined />} placeholder="+971 50 000 0000" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="department" label="Department">
              <Input placeholder="e.g. Finance" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="jobTitle" label="Job Title">
              <Input placeholder="e.g. Finance Manager" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="currency" label="Currency">
              <Select
                options={['AED', 'USD', 'EUR', 'GBP'].map((c) => ({ label: c, value: c }))}
              />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="maxApprovalAmount" label="Max Approval Amount">
              <InputNumber
                style={{ width: '100%' }}
                placeholder="Leave blank for Unlimited"
                min={0}
                formatter={(v) => (v ? `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '')}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="active" label="Status" valuePropName="checked">
              <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          name="modules"
          label="Modules Authorized to Approve"
          rules={[{ required: true, message: 'Select at least one module' }]}
        >
          <Select
            mode="multiple"
            placeholder="Select modules…"
            options={APPROVAL_MODULES.map((m) => ({ label: m, value: m }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );

  // ─── Rule Modal ───────────────────────────────────────────────────────────────

  const renderRuleModal = () => (
    <Modal
      title={
        <Space>
          <ApartmentOutlined style={{ color: REDWOOD.info }} />
          {editingRule ? 'Edit Approval Rule' : 'Add New Approval Rule'}
        </Space>
      }
      open={ruleModalOpen}
      onCancel={() => { setRuleModalOpen(false); setRuleApiPanelOpen(false); setRuleApiResult(null); }}
      onOk={handleRuleSave}
      okText={editingRule ? 'Save Changes' : 'Create Rule'}
      okButtonProps={{
        loading: ruleSaving,
        style: { background: REDWOOD.primary, borderColor: REDWOOD.primary },
      }}
      footer={(_, { OkBtn, CancelBtn }) => (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: ruleApiPanelOpen ? 8 : 0 }}>
            <Button
              size="small"
              icon={<ApiOutlined />}
              onClick={() => { setRuleApiPanelOpen(p => !p); setRuleApiResult(null); }}
              style={{ fontSize: 12, color: REDWOOD.textSecondary }}
              type="text"
            >
              API
            </Button>
            <Space>
              <CancelBtn />
              <OkBtn />
            </Space>
          </div>
          {ruleApiPanelOpen && (
            <div style={{ background: '#0d1117', borderRadius: 6, padding: '10px 12px', fontSize: 12, fontFamily: 'monospace' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Space size={6}>
                  <Tag color={editingRule ? 'gold' : 'green'} style={{ fontSize: 11 }}>{editingRule ? 'PUT' : 'POST'}</Tag>
                  <Text style={{ fontSize: 11, color: '#8b949e' }}>{editingRule ? `${APPROVAL_BASE}/rules/${editingRule.ruleId}` : `${APPROVAL_BASE}/rules`}</Text>
                </Space>
                <Button
                  size="small"
                  loading={ruleApiTesting}
                  onClick={handleRuleApiTest}
                  style={{ fontSize: 11, height: 24 }}
                >
                  Test
                </Button>
              </div>
              <pre style={{ color: '#e6edf3', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 200, overflowY: 'auto' }}>
                {JSON.stringify(buildRulePayload(ruleForm.getFieldsValue()), null, 2)}
              </pre>
              {ruleApiResult && (
                <div style={{ marginTop: 8, borderTop: '1px solid #30363d', paddingTop: 8 }}>
                  <Tag color={ruleApiResult.ok ? 'green' : 'red'} style={{ marginBottom: 4 }}>
                    {ruleApiResult.ok ? 'SUCCESS' : 'ERROR'}
                  </Tag>
                  <pre style={{ color: ruleApiResult.ok ? '#3fb950' : '#f85149', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 120, overflowY: 'auto' }}>
                    {(() => { try { return JSON.stringify(JSON.parse(ruleApiResult.body), null, 2); } catch { return ruleApiResult.body; } })()}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}
      destroyOnClose
      width={720}
    >
      <Form form={ruleForm} layout="vertical" style={{ marginTop: 8 }}>
        <Row gutter={16}>
          <Col span={16}>
            <Form.Item
              name="ruleName"
              label="Rule Name"
              rules={[{ required: true, message: 'Rule name is required' }]}
            >
              <Input placeholder="e.g. AP Invoices Over 50K" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="priority" label="Priority (1=highest)">
              <InputNumber style={{ width: '100%' }} min={1} max={99} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="description" label="Description">
          <Input.TextArea rows={2} placeholder="Optional description…" />
        </Form.Item>

        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="module"
              label="Module"
              rules={[{ required: true, message: 'Module is required' }]}
            >
              <Select
                placeholder="Select module…"
                options={APPROVAL_MODULES.map((m) => ({ label: m, value: m }))}
                onChange={(v) => {
                  setRuleModule(v);
                  ruleForm.setFieldValue('transactionType', undefined);
                }}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="transactionType"
              label="Transaction Type"
              rules={[{ required: true, message: 'Transaction type is required' }]}
            >
              <Select
                placeholder="Select type…"
                disabled={!ruleModule}
                options={(TRANSACTION_TYPES[ruleModule ?? ''] ?? []).map((t) => ({
                  label: t,
                  value: t,
                }))}
              />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col span={8}>
            <Form.Item name="minAmount" label="Min Amount">
              <InputNumber style={{ width: '100%' }} min={0} placeholder="0" />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="maxAmount" label="Max Amount">
              <InputNumber
                style={{ width: '100%' }}
                min={0}
                placeholder="Leave blank for Unlimited"
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="currency" label="Currency">
              <Select
                options={['AED', 'USD', 'EUR', 'GBP'].map((c) => ({ label: c, value: c }))}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="approvalType"
          label={
            <Space>
              Approval Type
              <Tooltip
                title={
                  <div>
                    <div>
                      <strong>Sequential:</strong> Approvers are notified one-by-one in order.
                    </div>
                    <div>
                      <strong>Parallel:</strong> All approvers are notified simultaneously; all must
                      approve.
                    </div>
                    <div>
                      <strong>Any One:</strong> Any one of the approvers can approve the request.
                    </div>
                  </div>
                }
              >
                <ThunderboltOutlined style={{ color: REDWOOD.info, cursor: 'help' }} />
              </Tooltip>
            </Space>
          }
        >
          <Radio.Group>
            <Radio value="SEQUENTIAL">Sequential</Radio>
            <Radio value="PARALLEL">Parallel</Radio>
            <Radio value="ANY_ONE">Any One</Radio>
          </Radio.Group>
        </Form.Item>

        <Form.Item name="active" label="Status" valuePropName="checked">
          <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
        </Form.Item>

        {/* ── Approvers Section ── */}
        <Divider titlePlacement="left" style={{ fontSize: 13, margin: '8px 0 12px' }}>
          Approvers ({selectedRuleApprovers.length})
        </Divider>

        <Row gutter={8} style={{ marginBottom: 12 }}>
          <Col flex="1">
            <Select
              showSearch
              placeholder={
                ruleModule
                  ? `Add approver (showing ${eligibleApprovers.length} eligible for ${ruleModule})…`
                  : 'Select a module first…'
              }
              disabled={!ruleModule}
              filterOption={(input, option) =>
                (option?.label?.toString() ?? '').toLowerCase().includes(input.toLowerCase())
              }
              options={eligibleApprovers
                .filter((a) => !selectedApproverIds.includes(a.userId))
                .map((a) => ({
                  label: `${a.fullName} — ${a.email}${a.department ? ' (' + a.department + ')' : ''}`,
                  value: a.userId,
                }))}
              onChange={(v) => {
                if (v) addRuleApprover(v as number);
              }}
              value={undefined}
              style={{ width: '100%' }}
            />
          </Col>
        </Row>

        {selectedRuleApprovers.length === 0 ? (
          <Alert
            type="warning"
            showIcon
            message="No approvers added yet. Select approvers from the dropdown above."
          />
        ) : (
          <div
            style={{
              border: `1px solid ${REDWOOD.neutral200}`,
              borderRadius: 6,
              overflow: 'hidden',
            }}
          >
            {selectedRuleApprovers.map((approver, index) => (
              <div
                key={approver.userId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '8px 12px',
                  borderBottom:
                    index < selectedRuleApprovers.length - 1
                      ? `1px solid ${REDWOOD.neutral200}`
                      : 'none',
                  background: index % 2 === 0 ? REDWOOD.surface : REDWOOD.neutral100,
                }}
              >
                <Tag
                  style={{
                    minWidth: 28,
                    textAlign: 'center',
                    fontWeight: 700,
                    marginRight: 8,
                    background: `${REDWOOD.info}15`,
                    borderColor: `${REDWOOD.info}40`,
                    color: REDWOOD.info,
                  }}
                >
                  {approver.sequence}
                </Tag>
                <Avatar size="small" style={{ background: REDWOOD.info, marginRight: 8 }}>
                  {approver.fullName.charAt(0)}
                </Avatar>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>{approver.fullName}</div>
                  <div style={{ fontSize: 11, color: REDWOOD.textSecondary }}>{approver.email}</div>
                </div>
                <Space size={4}>
                  <Button
                    size="small"
                    icon={<ArrowUpOutlined />}
                    disabled={index === 0}
                    onClick={() => moveRuleApprover(index, 'up')}
                  />
                  <Button
                    size="small"
                    icon={<ArrowDownOutlined />}
                    disabled={index === selectedRuleApprovers.length - 1}
                    onClick={() => moveRuleApprover(index, 'down')}
                  />
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => removeRuleApprover(approver.userId)}
                  />
                </Space>
              </div>
            ))}
          </div>
        )}
      </Form>
    </Modal>
  );

  // ─── History Drawer ───────────────────────────────────────────────────────────

  const renderHistoryDrawer = () => (
    <Drawer
      title={
        <Space>
          <HistoryOutlined style={{ color: REDWOOD.info }} />
          <span>Approval History</span>
          {selectedRequest && (
            <Tag color={statusColor(selectedRequest.status)}>{selectedRequest.status}</Tag>
          )}
        </Space>
      }
      open={historyDrawerOpen}
      onClose={() => setHistoryDrawerOpen(false)}
      width={520}
      destroyOnClose
    >
      {selectedRequest && (
        <>
          <Card
            size="small"
            style={{
              marginBottom: 20,
              background: REDWOOD.surfaceSecondary,
              border: `1px solid ${REDWOOD.neutral200}`,
            }}
          >
            <Row gutter={8}>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 11 }}>Txn Number</Text>
                <div style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 13 }}>{selectedRequest.transactionRef}</div>
              </Col>
              <Col span={12}>
                <Text type="secondary" style={{ fontSize: 11 }}>
                  Amount
                </Text>
                <div style={{ fontWeight: 600 }}>
                  {fmtAmount(selectedRequest.amount, selectedRequest.currency)}
                </div>
              </Col>
              <Col span={12} style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Module / Type</Text>
                <div>{selectedRequest.module} / {selectedRequest.transactionType}</div>
              </Col>
              <Col span={12} style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: 11 }}>Requested By</Text>
                <div>{selectedRequest.requestedByName}</div>
              </Col>
              {selectedRequest.description && (
                <Col span={24} style={{ marginTop: 8 }}>
                  <Text type="secondary" style={{ fontSize: 11 }}>Description</Text>
                  <div style={{ fontSize: 12 }}>{selectedRequest.description}</div>
                </Col>
              )}
            </Row>
          </Card>

          <Divider titlePlacement="left" style={{ fontSize: 13 }}>
            Timeline
          </Divider>

          {historyLoading ? (
            <div style={{ textAlign: 'center', padding: 32 }}>
              <Text type="secondary">Loading history…</Text>
            </div>
          ) : historyEntries.length === 0 ? (
            <Empty
              description="No history entries found for this request."
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <Timeline
              items={historyEntries.map((entry) => ({
                color: actionColor(entry.action),
                dot: (
                  <span style={{ color: actionColor(entry.action), fontSize: 14 }}>
                    {actionIcon(entry.action)}
                  </span>
                ),
                children: (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <Space size={4}>
                        <Tag
                          style={{
                            background: `${actionColor(entry.action)}15`,
                            borderColor: `${actionColor(entry.action)}40`,
                            color: actionColor(entry.action),
                            fontWeight: 600,
                            fontSize: 11,
                          }}
                        >
                          {entry.action}
                        </Tag>
                        {entry.notificationSent === 'Y' && (
                          <Tooltip title="Notification sent">
                            <BellOutlined style={{ color: '#722ed1', fontSize: 12 }} />
                          </Tooltip>
                        )}
                      </Space>
                      <Text style={{ fontSize: 11, color: REDWOOD.textSecondary }}>
                        {entry.actionDate ? new Date(entry.actionDate).toLocaleString() : '—'}
                      </Text>
                    </div>
                    <div style={{ fontWeight: 500, marginTop: 2 }}>{entry.actorName}</div>
                    {entry.comments && (
                      <div
                        style={{
                          fontSize: 12,
                          color: REDWOOD.textSecondary,
                          marginTop: 2,
                          fontStyle: 'italic',
                        }}
                      >
                        "{entry.comments}"
                      </div>
                    )}
                  </div>
                ),
              }))}
            />
          )}
        </>
      )}
    </Drawer>
  );

  // ─── Token Links Tab ─────────────────────────────────────────────────────────

  const renderTokensTab = () => {
    const usedCount    = tokens.filter(t => t.status === 'USED').length;
    const pendingCount = tokens.filter(t => t.status === 'PENDING').length;
    const expiredCount = tokens.filter(t => t.status === 'EXPIRED').length;

    const columns = [
      {
        title: 'Sent',
        dataIndex: 'createdDate',
        key: 'createdDate',
        width: 140,
        render: (d: string) => (
          <Text style={{ fontSize: 12, color: REDWOOD.textSecondary }}>
            {d ? new Date(d).toLocaleString('en-AE', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
          </Text>
        ),
      },
      {
        title: 'To',
        key: 'to',
        render: (_: unknown, r: ApprovalToken) => (
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{r.toName || r.toEmail}</div>
            <div style={{ fontSize: 11, color: REDWOOD.textSecondary }}>{r.toEmail}</div>
          </div>
        ),
      },
      {
        title: 'Txn Number',
        dataIndex: 'requestRef',
        key: 'requestRef',
        width: 140,
        render: (v: string) => v
          ? <Tag style={{ fontWeight: 600, fontSize: 12 }}>{v}</Tag>
          : <Text type="secondary">—</Text>,
      },
      {
        title: 'Link Action',
        dataIndex: 'action',
        key: 'action',
        width: 110,
        render: (a: string) => (
          <Tag color={a === 'APPROVE' ? 'success' : 'error'} style={{ fontWeight: 700, fontSize: 12 }}>
            {a === 'APPROVE' ? '✓ APPROVE' : '✗ REJECT'}
          </Tag>
        ),
      },
      {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        width: 110,
        render: (s: string) => (
          <Tag color={s === 'USED' ? 'blue' : s === 'PENDING' ? 'orange' : 'default'}>
            {s === 'USED' ? '✓ CLICKED' : s}
          </Tag>
        ),
      },
      {
        title: 'Clicked At',
        dataIndex: 'usedDate',
        key: 'usedDate',
        width: 140,
        render: (d: string) => d
          ? <Text style={{ fontSize: 12 }}>{new Date(d).toLocaleString('en-AE', { dateStyle: 'short', timeStyle: 'short' })}</Text>
          : <Text type="secondary" style={{ fontSize: 12 }}>—</Text>,
      },
      {
        title: 'Expires',
        dataIndex: 'expiresDate',
        key: 'expiresDate',
        width: 140,
        render: (d: string) => {
          if (!d) return <Text type="secondary">—</Text>;
          const isExpired = new Date(d) < new Date();
          return (
            <Text style={{ fontSize: 12, color: isExpired ? REDWOOD.primary : REDWOOD.textSecondary }}>
              {new Date(d).toLocaleString('en-AE', { dateStyle: 'short', timeStyle: 'short' })}
            </Text>
          );
        },
      },
    ];

    return (
      <div style={{ padding: '16px 24px 24px' }}>
        <Row gutter={16} style={{ marginBottom: 16 }} align="middle">
          <Col flex="1">
            <Space size={24}>
              <Statistic title="Pending (not clicked)" value={pendingCount}
                valueStyle={{ fontSize: 20, color: pendingCount > 0 ? REDWOOD.warning : REDWOOD.textSecondary }} />
              <Statistic title="Clicked (used)" value={usedCount}
                valueStyle={{ fontSize: 20, color: usedCount > 0 ? REDWOOD.success : REDWOOD.textSecondary }} />
              <Statistic title="Expired" value={expiredCount}
                valueStyle={{ fontSize: 20, color: expiredCount > 0 ? REDWOOD.primary : REDWOOD.textSecondary }} />
            </Space>
          </Col>
          <Col>
            <Button icon={<ReloadOutlined />} loading={tokensLoading} onClick={loadTokens}>
              Refresh
            </Button>
          </Col>
        </Row>

        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          showIcon
          message="How secure approval links work"
          description={
            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
              <strong>1.</strong> Send test email → app generates an APPROVE token + REJECT token (stored here).<br />
              <strong>2.</strong> Email buttons link to <code>bumeric.ae?token=...</code> — Oracle URL is hidden.<br />
              <strong>3.</strong> Approver clicks → browser shows confirmation page → token marked <Tag color="blue" style={{ fontSize: 11 }}>CLICKED</Tag><br />
              <strong>4.</strong> Action recorded automatically in <strong>Email Confirmations</strong> tab — no email reply needed.
            </div>
          }
        />

        <Card
          title={
            <Space>
              <SafetyOutlined style={{ color: REDWOOD.info }} />
              <span>Approval Link Tokens</span>
              {pendingCount > 0 && <Badge count={pendingCount} style={{ background: REDWOOD.warning }} />}
            </Space>
          }
          extra={
            <Text style={{ fontSize: 12, color: REDWOOD.textSecondary }}>
              {tokens.length} total · each link is single-use, 72 hr expiry
            </Text>
          }
          bordered
        >
          <Table
            columns={columns}
            dataSource={tokens}
            rowKey="tokenId"
            loading={tokensLoading}
            size="small"
            pagination={{ pageSize: 20 }}
            locale={{ emptyText: 'No tokens yet. Send a test email from the Notifications tab first.' }}
          />
        </Card>
      </div>
    );
  };

  // ─── Email Confirmations Tab ─────────────────────────────────────────────────

  const renderEmailConfirmationsTab = () => {
    const pending   = emailReplies.filter(r => r.status === 'PENDING').length;
    const processed = emailReplies.filter(r => r.status === 'PROCESSED').length;

    const columns = [
      {
        title: 'Received',
        dataIndex: 'receivedDate',
        key: 'receivedDate',
        width: 150,
        render: (d: string) => (
          <Text style={{ fontSize: 12, color: REDWOOD.textSecondary }}>
            {d ? new Date(d).toLocaleString('en-AE', { dateStyle: 'short', timeStyle: 'short' }) : '—'}
          </Text>
        ),
      },
      {
        title: 'From',
        key: 'from',
        render: (_: unknown, r: EmailReply) => (
          <div>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{r.fromName || r.fromEmail}</div>
            <div style={{ fontSize: 11, color: REDWOOD.textSecondary }}>{r.fromEmail}</div>
          </div>
        ),
      },
      {
        title: 'Txn Number',
        dataIndex: 'refNumber',
        key: 'refNumber',
        width: 140,
        render: (v: string) => v
          ? <Tag style={{ fontWeight: 600, fontSize: 12 }}>{v}</Tag>
          : <Text type="secondary">—</Text>,
      },
      {
        title: 'Action',
        dataIndex: 'actionDetected',
        key: 'actionDetected',
        width: 100,
        render: (a: string) => (
          <Tag
            color={a === 'APPROVE' ? 'success' : a === 'REJECT' ? 'error' : 'default'}
            style={{ fontWeight: 700, fontSize: 12 }}
          >
            {a === 'APPROVE' ? '✓ APPROVE' : a === 'REJECT' ? '✗ REJECT' : '? UNKNOWN'}
          </Tag>
        ),
      },
      {
        title: 'Status',
        dataIndex: 'status',
        key: 'status',
        width: 110,
        render: (s: string) => (
          <Tag color={s === 'PROCESSED' ? 'blue' : s === 'PENDING' ? 'orange' : 'default'}>
            {s}
          </Tag>
        ),
      },
      {
        title: 'Action',
        key: 'action',
        width: 130,
        render: (_: unknown, r: EmailReply) =>
          r.status === 'PENDING' ? (
            <Button
              size="small"
              type="primary"
              loading={processingReplyId === r.replyId}
              onClick={() => handleProcessReply(r)}
              style={{
                background: r.actionDetected === 'APPROVE' ? REDWOOD.success : REDWOOD.primary,
                borderColor: r.actionDetected === 'APPROVE' ? REDWOOD.success : REDWOOD.primary,
                fontSize: 12,
              }}
            >
              {r.actionDetected === 'APPROVE' ? 'Process Approval' : 'Process Rejection'}
            </Button>
          ) : (
            <Space size={4}>
              <CheckCircleOutlined style={{ color: REDWOOD.success }} />
              <Text style={{ fontSize: 12, color: REDWOOD.textSecondary }}>
                {r.processedDate
                  ? new Date(r.processedDate).toLocaleString('en-AE', { dateStyle: 'short', timeStyle: 'short' })
                  : 'Done'}
              </Text>
            </Space>
          ),
      },
    ];

    return (
      <div style={{ padding: '16px 24px 24px' }}>
        {/* Header row */}
        <Row gutter={16} style={{ marginBottom: 16 }} align="middle">
          <Col flex="1">
            <Space size={16}>
              <Statistic
                title="Pending"
                value={pending}
                valueStyle={{ fontSize: 20, color: pending > 0 ? REDWOOD.warning : REDWOOD.textSecondary }}
              />
              <Statistic
                title="Processed"
                value={processed}
                valueStyle={{ fontSize: 20, color: REDWOOD.success }}
              />
            </Space>
          </Col>
          <Col>
            <Button
              icon={<ReloadOutlined />}
              loading={emailRepliesLoading}
              onClick={loadEmailReplies}
              style={{ marginRight: 8 }}
            >
              Check Inbox
            </Button>
          </Col>
        </Row>

        {/* How it works info */}
        <Alert
          style={{ marginBottom: 16 }}
          type="info"
          showIcon
          message="How email confirmations work"
          description={
            <div style={{ fontSize: 12, lineHeight: 1.6 }}>
              <strong>1.</strong> Send a test email from the Notifications tab → approver receives it.<br />
              <strong>2.</strong> Approver clicks <strong>APPROVE</strong> or <strong>REJECT</strong> link in email → browser opens confirmation page.<br />
              <strong>3.</strong> Token is marked <Tag color="blue" style={{ fontSize: 11 }}>USED</Tag> and a record is written here automatically — no email reply needed.<br />
              <strong>4.</strong> Click <strong>Check Inbox</strong> to refresh → action appears in this list.<br />
              <strong>5.</strong> Click <strong>Process</strong> → AP webservice fires (placeholder — link to real webservice later).
              <br /><br />
              <strong>See Token Links tab</strong> to view which links have been clicked and which are still pending.
            </div>
          }
        />

        {/* Replies table */}
        <Card
          title={
            <Space>
              <MailOutlined style={{ color: REDWOOD.info }} />
              <span>Email Replies</span>
              {pending > 0 && <Badge count={pending} style={{ background: REDWOOD.warning }} />}
            </Space>
          }
          extra={
            <Text style={{ fontSize: 12, color: REDWOOD.textSecondary }}>
              {emailReplies.length} total replies
            </Text>
          }
          bordered
          style={{ marginBottom: 24 }}
        >
          <Table
            columns={columns}
            dataSource={emailReplies}
            rowKey="replyId"
            loading={emailRepliesLoading}
            size="small"
            pagination={{ pageSize: 15 }}
            locale={{ emptyText: 'No email replies yet. Click "Check Inbox" to refresh.' }}
            expandable={{
              expandedRowRender: (r: EmailReply) => (
                <div style={{ padding: '8px 16px' }}>
                  <Text strong style={{ fontSize: 12 }}>Subject: </Text>
                  <Text style={{ fontSize: 12 }}>{r.subject}</Text>
                  <br />
                  <Text strong style={{ fontSize: 12 }}>Body: </Text>
                  <Text style={{ fontSize: 12, whiteSpace: 'pre-wrap' }}>{r.bodyText}</Text>
                </div>
              ),
            }}
          />
        </Card>

        {/* Simulate panel */}
        <Card
          title={
            <Space>
              <ThunderboltOutlined style={{ color: REDWOOD.warning }} />
              <span>Simulate Reply (Testing)</span>
            </Space>
          }
          bordered
        >
          <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 16 }}>
            Insert a fake email reply into the inbox to test processing without needing a real email.
          </Paragraph>
          <Space size={12}>
            <Select
              value={simAction}
              onChange={setSimAction}
              style={{ width: 120 }}
              options={[
                { label: '✓ APPROVE', value: 'APPROVE' },
                { label: '✗ REJECT',  value: 'REJECT'  },
              ]}
            />
            <Input
              value={simRef}
              onChange={e => setSimRef(e.target.value)}
              placeholder="Reference e.g. INV-TEST-001"
              style={{ width: 220 }}
            />
            <Button
              type="primary"
              loading={simSending}
              onClick={handleSimulateReply}
              style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
            >
              Simulate Reply
            </Button>
          </Space>
        </Card>
      </div>
    );
  };

  // ─── Email Preview Modal ──────────────────────────────────────────────────────

  const renderEmailPreviewModal = () => {
    const today = new Date().toLocaleDateString('en-AE', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const recipientName = previewApprover?.fullName ?? 'Approver';
    const recipientEmail = previewApprover?.email ?? 'approver@company.com';

    return (
      <Modal
        title={
          <Space>
            <MailOutlined style={{ color: REDWOOD.info }} />
            Email Notification Preview
          </Space>
        }
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={[
          <Button key="close" onClick={() => setPreviewOpen(false)}>
            Close
          </Button>,
        ]}
        width={640}
        destroyOnClose
      >
        {/* Email header meta */}
        <div
          style={{
            background: REDWOOD.neutral100,
            border: `1px solid ${REDWOOD.neutral200}`,
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 16,
            fontSize: 12,
            fontFamily: 'monospace',
          }}
        >
          <div>
            <strong>Subject:</strong> [APPROVAL REQUIRED] Invoice #INV-2024-001 — AED 125,000.00
          </div>
          <div>
            <strong>From:</strong> ERP System &lt;noreply@bumeric.ae&gt;
          </div>
          <div>
            <strong>To:</strong> {recipientEmail}
          </div>
        </div>

        {/* Email body preview */}
        <div
          style={{
            border: `1px solid ${REDWOOD.neutral200}`,
            borderRadius: 8,
            overflow: 'hidden',
            fontFamily: 'Arial, sans-serif',
          }}
        >
          {/* Banner */}
          <div
            style={{
              background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, ${REDWOOD.primaryDark} 100%)`,
              padding: '20px 24px',
              textAlign: 'center',
              color: '#fff',
            }}
          >
            <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.8, marginBottom: 4 }}>
              BUMERIC BUSINESS SOLUTIONS
            </div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>Approval Required</div>
            <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
              ERP Approval Management System
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: '20px 24px', background: '#fff' }}>
            <p style={{ margin: '0 0 16px', fontSize: 14 }}>Dear {recipientName},</p>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: '#444' }}>
              A transaction has been submitted for your approval. Please review the details below
              and take the appropriate action.
            </p>

            {/* Transaction details card */}
            <div
              style={{
                border: `1px solid ${REDWOOD.neutral200}`,
                borderRadius: 6,
                overflow: 'hidden',
                marginBottom: 20,
              }}
            >
              <div
                style={{
                  background: REDWOOD.neutral100,
                  padding: '8px 14px',
                  fontSize: 12,
                  fontWeight: 600,
                  color: REDWOOD.textSecondary,
                  letterSpacing: 0.5,
                }}
              >
                TRANSACTION DETAILS
              </div>
              {[
                ['Module', 'Accounts Payable (AP)'],
                ['Type', 'Invoice'],
                ['Reference', 'INV-2024-001'],
                ['Amount', 'AED 125,000.00'],
                ['Submitted by', 'John Smith'],
                ['Date', today],
                ['Description', 'Vendor invoice for Q4 services'],
              ].map(([label, value], i) => (
                <div
                  key={label}
                  style={{
                    display: 'flex',
                    padding: '8px 14px',
                    background: i % 2 === 0 ? '#fff' : REDWOOD.neutral100,
                    borderTop: `1px solid ${REDWOOD.neutral200}`,
                    fontSize: 13,
                  }}
                >
                  <div style={{ width: 130, color: REDWOOD.textSecondary, flexShrink: 0 }}>
                    {label}:
                  </div>
                  <div style={{ fontWeight: i < 4 ? 600 : 400 }}>{value}</div>
                </div>
              ))}
            </div>

            {/* Action buttons */}
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <span
                style={{
                  display: 'inline-block',
                  background: REDWOOD.success,
                  color: '#fff',
                  padding: '8px 20px',
                  borderRadius: 4,
                  fontWeight: 600,
                  fontSize: 13,
                  marginRight: 8,
                  cursor: 'pointer',
                }}
              >
                ✓ APPROVE
              </span>
              <span
                style={{
                  display: 'inline-block',
                  background: REDWOOD.primary,
                  color: '#fff',
                  padding: '8px 20px',
                  borderRadius: 4,
                  fontWeight: 600,
                  fontSize: 13,
                  marginRight: 8,
                  cursor: 'pointer',
                }}
              >
                ✗ REJECT
              </span>
              <span
                style={{
                  display: 'inline-block',
                  background: REDWOOD.info,
                  color: '#fff',
                  padding: '8px 20px',
                  borderRadius: 4,
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                View Details
              </span>
            </div>

            {/* Footer */}
            <div
              style={{
                borderTop: `1px solid ${REDWOOD.neutral200}`,
                paddingTop: 12,
                fontSize: 11,
                color: REDWOOD.textSecondary,
                textAlign: 'center',
              }}
            >
              This is an automated notification from the ERP Approval System. Please do not reply
              to this email.
              <br />
              © {new Date().getFullYear()} Bumeric Business Solutions LLC — noreply@bumeric.ae
            </div>
          </div>
        </div>
      </Modal>
    );
  };

  // ─── Main Render ──────────────────────────────────────────────────────────────

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.surfaceSecondary }}>
      <Content style={{ padding: '24px 48px' }}>
        {/* Breadcrumb */}
        <Breadcrumb
          items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/admin">Admin</Link> },
            { title: 'Approval Engine' },
          ]}
          style={{ marginBottom: 16 }}
        />

        {/* Page Header */}
        <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <Title level={2} style={{ color: REDWOOD.textPrimary, margin: 0 }}>
              <SafetyOutlined style={{ marginRight: 12, color: REDWOOD.info }} />
              Approval Management Engine
            </Title>
            <Text type="secondary">
              Configure approvers, rules, and track approval requests across all modules.
            </Text>
          </div>
          <Tooltip title="API Inspector — view all web service endpoints">
            <Button
              icon={<ApiOutlined />}
              onClick={() => setApiModalOpen(true)}
              style={{ color: REDWOOD.info, borderColor: REDWOOD.info, marginTop: 4 }}
            >
              API
            </Button>
          </Tooltip>
        </div>

        {/* Main Tabs Card */}
        <Card style={{ marginTop: 0 }} styles={{ body: { padding: 0 } }}>
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            style={{ padding: '0 24px' }}
            items={[
              {
                key: 'approvers',
                label: (
                  <span>
                    <TeamOutlined style={{ marginRight: 6 }} />
                    Approvers
                    {approvers.length > 0 && (
                      <Badge
                        count={approvers.length}
                        style={{
                          marginLeft: 8,
                          background: REDWOOD.info,
                          fontSize: 10,
                        }}
                      />
                    )}
                  </span>
                ),
                children: renderApproversTab(),
              },
              {
                key: 'rules',
                label: (
                  <span>
                    <ApartmentOutlined style={{ marginRight: 6 }} />
                    Approval Rules
                    {rules.length > 0 && (
                      <Badge
                        count={rules.length}
                        style={{ marginLeft: 8, background: REDWOOD.success, fontSize: 10 }}
                      />
                    )}
                  </span>
                ),
                children: renderRulesTab(),
              },
              {
                key: 'requests',
                label: (
                  <span>
                    <HistoryOutlined style={{ marginRight: 6 }} />
                    Requests & History
                    {requests.filter((r) => r.status === 'PENDING').length > 0 && (
                      <Badge
                        count={requests.filter((r) => r.status === 'PENDING').length}
                        style={{ marginLeft: 8, background: REDWOOD.warning, fontSize: 10 }}
                      />
                    )}
                  </span>
                ),
                children: renderRequestsTab(),
              },
              {
                key: 'notifications',
                label: (
                  <span>
                    <BellOutlined style={{ marginRight: 6 }} />
                    Notifications
                  </span>
                ),
                children: renderNotificationsTab(),
              },
              {
                key: 'email-confirmations',
                label: (
                  <span>
                    <MailOutlined style={{ marginRight: 6 }} />
                    Email Confirmations
                    {emailReplies.filter(r => r.status === 'PENDING').length > 0 && (
                      <Badge
                        count={emailReplies.filter(r => r.status === 'PENDING').length}
                        size="small"
                        style={{ marginLeft: 6 }}
                      />
                    )}
                  </span>
                ),
                children: renderEmailConfirmationsTab(),
              },
              {
                key: 'tokens',
                label: (
                  <span>
                    <SafetyOutlined style={{ marginRight: 6 }} />
                    Token Links
                    {tokens.filter(t => t.status === 'USED').length > 0 && (
                      <Badge
                        count={tokens.filter(t => t.status === 'USED').length}
                        color="blue"
                        size="small"
                        style={{ marginLeft: 6 }}
                      />
                    )}
                  </span>
                ),
                children: renderTokensTab(),
              },
            ]}
          />
        </Card>
      </Content>

      {/* Modals & Drawers */}
      {renderApproverModal()}
      {renderRuleModal()}
      {renderHistoryDrawer()}
      {renderEmailPreviewModal()}

      {/* ── API Inspector Modal ───────────────────────────────────────── */}
      <Modal
        title={<Space><ApiOutlined style={{ color: REDWOOD.info }} /><span>API Inspector — Approval Engine Endpoints</span></Space>}
        open={apiModalOpen}
        onCancel={() => setApiModalOpen(false)}
        footer={<Button onClick={() => setApiModalOpen(false)}>Close</Button>}
        width={700}
      >
        {[
          { method: 'GET',    url: `${APPROVAL_BASE}/users`,                  desc: 'Load all approval users' },
          { method: 'POST',   url: `${APPROVAL_BASE}/users`,                  desc: 'Create a new approval user' },
          { method: 'PUT',    url: `${APPROVAL_BASE}/users/:id`,              desc: 'Update an approval user' },
          { method: 'DELETE', url: `${APPROVAL_BASE}/users/:id`,              desc: 'Delete an approval user' },
          { method: 'GET',    url: `${APPROVAL_BASE}/rules`,                  desc: 'Load all approval rules' },
          { method: 'POST',   url: `${APPROVAL_BASE}/rules`,                  desc: 'Create a new approval rule' },
          { method: 'PUT',    url: `${APPROVAL_BASE}/rules/:id`,              desc: 'Update an approval rule' },
          { method: 'DELETE', url: `${APPROVAL_BASE}/rules/:id`,              desc: 'Delete an approval rule' },
          { method: 'GET',    url: `${APPROVAL_BASE}/requests`,               desc: 'Load pending approval requests' },
          { method: 'POST',   url: `${APPROVAL_BASE}/requests/:id/action`,    desc: 'Approve / Reject / Delegate a request' },
          { method: 'GET',    url: `${APPROVAL_BASE}/requests/:id/history`,   desc: 'Load approval history for a request' },
          { method: 'POST',   url: `${APPROVAL_BASE}/notify/test`,            desc: 'Send test email notification' },
          { method: 'GET',    url: `${APEX_ADMIN_BASE}/users`,                desc: 'Load ERP system users (for approver picker)' },
        ].map((ep, i) => (
          <div key={i} style={{ marginBottom: 10, padding: '8px 12px', background: REDWOOD.neutral100, borderRadius: 6, borderLeft: `3px solid ${ep.method === 'GET' ? REDWOOD.info : ep.method === 'POST' ? REDWOOD.success : ep.method === 'PUT' ? REDWOOD.warning : REDWOOD.primary}` }}>
            <Space>
              <Tag color={ep.method === 'GET' ? 'blue' : ep.method === 'POST' ? 'green' : ep.method === 'PUT' ? 'orange' : 'red'} style={{ fontFamily: 'monospace', fontSize: 11, width: 52, textAlign: 'center' }}>
                {ep.method}
              </Tag>
              <Text copyable code style={{ fontSize: 11 }}>{ep.url}</Text>
            </Space>
            <div style={{ fontSize: 12, color: REDWOOD.neutral600, marginTop: 4, marginLeft: 60 }}>{ep.desc}</div>
          </div>
        ))}
      </Modal>
    </Layout>
  );
};

const ApprovalEngineWithBoundary: React.FC = () => (
  <ApprovalErrorBoundary>
    <ApprovalEngine />
  </ApprovalErrorBoundary>
);

export default ApprovalEngineWithBoundary;
