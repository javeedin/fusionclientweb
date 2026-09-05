import React, { useState, useRef, useEffect } from 'react';
import { Layout, Typography, Card, Breadcrumb, Space, Tooltip, Row, Col, Statistic, Progress } from 'antd';
import {
  HomeOutlined,
  AccountBookOutlined,
  CheckSquareOutlined,
  BarChartOutlined,
  FileTextOutlined,
  SettingOutlined,
  SwapOutlined,
  AuditOutlined,
  BookOutlined,
  CalendarOutlined,
  DollarOutlined,
  ReconciliationOutlined,
  PieChartOutlined,
  LineChartOutlined,
  FundOutlined,
  ProfileOutlined,
  SolutionOutlined,
  CloseOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  SyncOutlined,
  WarningOutlined,
  TagsOutlined,
  RobotOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';

const { Content } = Layout;
const { Title, Text } = Typography;

// Oracle Redwood Color Palette
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
  taskBlue: '#0572CE',
  reportGreen: '#1D7B4D',
};

// Menu item type
interface MenuItemType {
  key: string;
  icon: React.ReactNode;
  label: string;
  description?: string;
  color?: string;
  path?: string;
}

// Task menu items
const taskMenuItems: MenuItemType[] = [
  { key: 'coa-segments', icon: <BookOutlined />, label: 'COA Segments', description: 'Browse segment values', color: REDWOOD.info, path: '/gl/coa-segments' },
  { key: 'account-analysis', icon: <FundOutlined />, label: 'Account Analysis', description: 'Account detail analysis', color: REDWOOD.warning, path: '/gl/account-analysis' },
  { key: 'manage-journals', icon: <AccountBookOutlined />, label: 'Manage Journals', description: 'Search and manage journal entries', color: REDWOOD.primary, path: '/gl/manage-journals' },
  { key: 'journal-entry', icon: <FileTextOutlined />, label: 'Create Journal', description: 'Create manual journal entry', color: REDWOOD.taskBlue, path: '/gl/create-journal' },
  { key: 'import-journals', icon: <SwapOutlined />, label: 'Import Journals', description: 'Import from spreadsheet', color: REDWOOD.info },
  { key: 'reverse-journal', icon: <ReconciliationOutlined />, label: 'Reverse Journal', description: 'Reverse posted journals', color: REDWOOD.warning },
  { key: 'delete-journals', icon: <DeleteOutlined />, label: 'Delete Journals', description: 'Delete SLA & GL journals (test cleanup)', color: REDWOOD.primary, path: '/gl/delete-journals' },
  { key: 'accounting-periods', icon: <CalendarOutlined />, label: 'Manage Accounting Periods', description: 'View and manage accounting periods', color: REDWOOD.success, path: '/gl/accounting-periods' },
  { key: 'business-units', icon: <SolutionOutlined />, label: 'Manage Business Units', description: 'Business units, legal entities and ledgers', color: REDWOOD.info, path: '/gl/business-units' },
  { key: 'revaluation', icon: <DollarOutlined />, label: 'Run Revaluation', description: 'Foreign currency revaluation', color: REDWOOD.primary },
  { key: 'journal-reconciliation', icon: <ReconciliationOutlined />, label: 'Fusion Journal Reconciliation', description: 'Reconcile batch ↔ header ↔ line totals', color: REDWOOD.primaryDark, path: '/gl/journal-reconciliation' },
];

// Report menu items
const reportMenuItems: MenuItemType[] = [
  { key: 'trial-balance', icon: <ProfileOutlined />, label: 'Trial Balance', description: 'View trial balance report', color: REDWOOD.reportGreen, path: '/gl/trial-balance' },
  { key: 'generate-trial-balance', icon: <BarChartOutlined />, label: 'Generate RR Trial Balance', description: 'Compute TB from journal lines with PTD / YTD / Opening / Closing', color: REDWOOD.primary, path: '/gl/generate-trial-balance' },
  { key: 'balance-sheet', icon: <PieChartOutlined />, label: 'Balance Sheet', description: 'Financial position report', color: REDWOOD.info },
  { key: 'income-statement', icon: <LineChartOutlined />, label: 'Income Statement', description: 'Profit and loss report', color: REDWOOD.success },
  { key: 'journal-report', icon: <FileTextOutlined />, label: 'Journal Report', description: 'Posted journals listing', color: REDWOOD.taskBlue },
  { key: 'account-analysis', icon: <FundOutlined />, label: 'Account Analysis', description: 'Account detail analysis', color: REDWOOD.warning, path: '/gl/account-analysis' },
  { key: 'account-analysis-v2', icon: <FundOutlined />, label: 'Account Analysis V2', description: 'Redesigned account analysis', color: REDWOOD.warning, path: '/gl/account-analysis-v2' },
  { key: 'gl-balances', icon: <BarChartOutlined />, label: 'GL Balances', description: 'General ledger balances', color: REDWOOD.primary },
  { key: 'financial-intelligence', icon: <RobotOutlined />, label: 'Financial Intelligence', description: 'AI-powered GL analysis & chat', color: '#764ba2', path: '/gl/financial-intelligence' },
];

// Setup menu items
const setupMenuItems: MenuItemType[] = [
  { key: 'chart-of-accounts', icon: <BookOutlined />, label: 'Chart of Accounts', description: 'Manage account structure', color: REDWOOD.primary, path: '/gl/chart-of-accounts' },
  { key: 'ledgers', icon: <AccountBookOutlined />, label: 'Ledgers', description: 'Configure ledger settings', color: REDWOOD.info },
  { key: 'fiscal-calendar', icon: <CalendarOutlined />, label: 'Fiscal Calendar', description: 'Define accounting periods', color: REDWOOD.success },
  { key: 'currencies', icon: <DollarOutlined />, label: 'Currencies', description: 'Currency configurations', color: REDWOOD.warning, path: '/gl/currencies' },
  { key: 'account-combinations', icon: <SettingOutlined />, label: 'Account Combinations', description: 'Valid account combinations', color: REDWOOD.primaryDark, path: '/gl/account-combinations' },
  { key: 'cross-validation', icon: <SolutionOutlined />, label: 'Cross Validation', description: 'Validation rules setup', color: REDWOOD.reportGreen },
  { key: 'income-statement-templates', icon: <LineChartOutlined />, label: 'Income Statement Templates', description: 'Manage P&L statement templates', color: REDWOOD.success, path: '/gl/income-statement-templates' },
  { key: 'categories', icon: <TagsOutlined />, label: 'Manage Categories', description: 'Journal entry categories', color: REDWOOD.info, path: '/gl/categories' },
];

// GL KPI Data (mock - would come from API)
const glKpiData = {
  pendingJournals: { value: 24, trend: 'up', change: 8 },
  postedJournals: { value: 156, trend: 'up', change: 12 },
  unpostedBatches: { value: 5, trend: 'down', change: 3 },
  openPeriods: { value: 2, total: 12 },
  periodProgress: 67,
  lastSync: '2 hours ago',
};

const GLModule: React.FC = () => {
  const navigate = useNavigate();
  const [activePanel, setActivePanel] = useState<'none' | 'tasks' | 'reports'>('none');
  const [isClosing, setIsClosing] = useState(false);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const floatingIconsRef = useRef<HTMLDivElement>(null);

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isOutsidePanel = panelRef.current && !panelRef.current.contains(target);
      const isOutsideFloatingIcons = floatingIconsRef.current && !floatingIconsRef.current.contains(target);

      if (isOutsidePanel && isOutsideFloatingIcons) {
        closePanel();
      }
    };

    if (activePanel !== 'none') {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [activePanel]);

  const closePanel = () => {
    setIsClosing(true);
    setTimeout(() => {
      setActivePanel('none');
      setIsClosing(false);
    }, 250);
  };

  const handleMenuItemClick = (key: string, path?: string) => {
    setSelectedItem(key);
    closePanel();
    if (path) {
      navigate(path);
    }
    console.log('Selected:', key);
  };

  const togglePanel = (panel: 'tasks' | 'reports') => {
    if (activePanel === panel) {
      closePanel();
    } else {
      setIsClosing(false);
      setActivePanel(panel);
    }
  };

  // Floating Action Button
  const FloatingIcon = ({
    icon,
    label,
    color,
    isActive,
    onClick,
    position
  }: {
    icon: React.ReactNode;
    label: string;
    color: string;
    isActive: boolean;
    onClick: () => void;
    position: 'top' | 'bottom';
  }) => (
    <Tooltip title={!isActive ? label : ''} placement="left">
      <div
        onClick={onClick}
        style={{
          width: 40,
          height: 40,
          borderRadius: position === 'top' ? '8px 8px 0 0' : '0 0 8px 8px',
          background: isActive ? color : REDWOOD.surface,
          border: `2px solid ${color}`,
          borderBottom: position === 'top' ? 'none' : `2px solid ${color}`,
          borderTop: position === 'bottom' ? 'none' : `2px solid ${color}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'all 0.3s ease',
          boxShadow: isActive ? `0 4px 12px ${color}40` : '0 2px 8px rgba(0,0,0,0.1)',
          color: isActive ? '#fff' : color,
          fontSize: 18,
        }}
      >
        {icon}
      </div>
    </Tooltip>
  );

  // Slide-out Panel
  const SlidePanel = ({
    title,
    items,
    color
  }: {
    title: string;
    items: MenuItemType[];
    color: string;
  }) => (
    <div
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: 300,
        background: REDWOOD.surface,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
        overflow: 'hidden',
        animation: isClosing ? 'slideOut 0.25s ease-in forwards' : 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        zIndex: 1001,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Panel Header */}
      <div style={{
        padding: '10px 14px',
        background: color,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexShrink: 0,
      }}>
        <Text strong style={{ color: '#fff', fontSize: 14 }}>{title}</Text>
        <CloseOutlined
          style={{ color: '#fff', cursor: 'pointer', fontSize: 14, padding: 4 }}
          onClick={closePanel}
        />
      </div>

      {/* Panel Items */}
      <div style={{ padding: 10, flex: 1, overflowY: 'auto' }}>
        {items.map((item, index) => (
          <div
            key={item.key}
            onClick={() => handleMenuItemClick(item.key, item.path)}
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              transition: 'all 0.2s ease',
              marginBottom: 6,
              border: `1px solid ${REDWOOD.neutral200}`,
              background: REDWOOD.surface,
              opacity: 0,
              animation: `fadeInItem 0.3s ease-out ${index * 0.05}s forwards`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = REDWOOD.neutral100;
              e.currentTarget.style.borderColor = color;
              e.currentTarget.style.transform = 'translateX(-4px)';
              e.currentTarget.style.boxShadow = `0 2px 8px ${color}20`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = REDWOOD.surface;
              e.currentTarget.style.borderColor = REDWOOD.neutral200;
              e.currentTarget.style.transform = 'translateX(0)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: `${color}15`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: color,
              fontSize: 16,
              flexShrink: 0,
            }}>
              {item.icon}
            </div>
            <div style={{ flex: 1 }}>
              <Text strong style={{ display: 'block', color: REDWOOD.neutral900, fontSize: 12 }}>
                {item.label}
              </Text>
              {item.description && (
                <Text type="secondary" style={{ fontSize: 10, lineHeight: 1.3 }}>
                  {item.description}
                </Text>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  // KPI Card Component
  const KpiCard = ({
    title,
    value,
    icon,
    color,
    trend,
    change,
    suffix
  }: {
    title: string;
    value: number;
    icon: React.ReactNode;
    color: string;
    trend?: 'up' | 'down';
    change?: number;
    suffix?: string;
  }) => (
    <Card
      style={{
        borderRadius: 12,
        border: 'none',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}
      bodyStyle={{ padding: 20 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <Text type="secondary" style={{ fontSize: 13 }}>{title}</Text>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <Statistic
              value={value}
              suffix={suffix}
              valueStyle={{ fontSize: 28, fontWeight: 600, color: REDWOOD.neutral900 }}
            />
            {trend && change && (
              <span style={{
                color: trend === 'up' ? REDWOOD.success : REDWOOD.primary,
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 2,
              }}>
                {trend === 'up' ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                {change}%
              </span>
            )}
          </div>
        </div>
        <div style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: `${color}15`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: color,
          fontSize: 24,
        }}>
          {icon}
        </div>
      </div>
    </Card>
  );

  // Menu Card Component
  const MenuCard = ({ item }: { item: MenuItemType }) => (
    <Card
      hoverable={!!item.path}
      onClick={() => handleMenuItemClick(item.key, item.path)}
      style={{
        borderRadius: 12,
        border: item.path ? `1px solid ${REDWOOD.success}30` : `1px solid ${REDWOOD.neutral200}`,
        cursor: item.path ? 'pointer' : 'default',
        transition: 'all 0.3s ease',
        height: '100%',
        position: 'relative',
        opacity: item.path ? 1 : 0.72,
      }}
      bodyStyle={{ padding: 20 }}
    >
      {item.path && (
        <div style={{
          position: 'absolute', top: 8, right: 8,
          background: REDWOOD.success, color: '#fff',
          borderRadius: '50%', width: 18, height: 18,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <CheckCircleOutlined style={{ fontSize: 11 }} />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{
          width: 48,
          height: 48,
          borderRadius: 12,
          background: `${item.color || REDWOOD.primary}15`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: item.color || REDWOOD.primary,
          fontSize: 24,
          flexShrink: 0,
        }}>
          {item.icon}
        </div>
        <div style={{ flex: 1 }}>
          <Text strong style={{ display: 'block', color: REDWOOD.neutral900, fontSize: 15 }}>
            {item.label}
          </Text>
          {item.description && (
            <Text type="secondary" style={{ fontSize: 12, lineHeight: 1.5 }}>
              {item.description}
            </Text>
          )}
        </div>
      </div>
    </Card>
  );

  // Section Title Component
  const SectionTitle = ({ icon, title, color }: { icon: React.ReactNode; title: string; color: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      <div style={{
        width: 36,
        height: 36,
        borderRadius: 8,
        background: `${color}15`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: color,
        fontSize: 18,
      }}>
        {icon}
      </div>
      <Text strong style={{ fontSize: 18, color: REDWOOD.neutral900 }}>{title}</Text>
    </div>
  );

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb Header */}
        <div style={{
          padding: '16px 24px',
          background: REDWOOD.surface,
          borderBottom: `1px solid ${REDWOOD.neutral200}`
        }}>
          <Breadcrumb
            items={[
              { title: <Link to="/home"><HomeOutlined /> Home</Link> },
              { title: 'General Ledger' },
            ]}
          />
        </div>

        {/* Main Content Area */}
        <div style={{ padding: 24, paddingRight: 100 }}>
          {/* Page Title */}
          <div style={{ marginBottom: 24 }}>
            <Space align="center">
              <div style={{
                width: 56,
                height: 56,
                borderRadius: 12,
                background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, ${REDWOOD.primaryDark} 100%)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: `0 4px 12px ${REDWOOD.primary}40`,
              }}>
                <AccountBookOutlined style={{ fontSize: 28, color: '#fff' }} />
              </div>
              <div>
                <Title level={2} style={{ margin: 0, color: REDWOOD.neutral900 }}>
                  General Ledger
                </Title>
                <Text type="secondary">Manage accounts, journals, and financial reporting</Text>
              </div>
            </Space>
          </div>

          {/* KPI Cards Row */}
          <Row gutter={[16, 16]} style={{ marginBottom: 32 }}>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard
                title="Pending Journals"
                value={glKpiData.pendingJournals.value}
                icon={<ClockCircleOutlined />}
                color={REDWOOD.warning}
                trend={glKpiData.pendingJournals.trend as 'up' | 'down'}
                change={glKpiData.pendingJournals.change}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard
                title="Posted This Period"
                value={glKpiData.postedJournals.value}
                icon={<CheckCircleOutlined />}
                color={REDWOOD.success}
                trend={glKpiData.postedJournals.trend as 'up' | 'down'}
                change={glKpiData.postedJournals.change}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard
                title="Unposted Batches"
                value={glKpiData.unpostedBatches.value}
                icon={<WarningOutlined />}
                color={REDWOOD.primary}
                trend={glKpiData.unpostedBatches.trend as 'up' | 'down'}
                change={glKpiData.unpostedBatches.change}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard
                title="Open Periods"
                value={glKpiData.openPeriods.value}
                icon={<CalendarOutlined />}
                color={REDWOOD.info}
                suffix={`/ ${glKpiData.openPeriods.total}`}
              />
            </Col>
          </Row>

          {/* Period Progress Card */}
          <Row gutter={[16, 16]} style={{ marginBottom: 32 }}>
            <Col xs={24} lg={12}>
              <Card
                style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
                bodyStyle={{ padding: 20 }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <Text strong style={{ fontSize: 15 }}>Period Close Progress</Text>
                  <Text type="secondary">Dec 2024</Text>
                </div>
                <Progress
                  percent={glKpiData.periodProgress}
                  strokeColor={{
                    '0%': REDWOOD.primary,
                    '100%': REDWOOD.success,
                  }}
                  trailColor={REDWOOD.neutral200}
                  strokeWidth={12}
                  style={{ marginBottom: 8 }}
                />
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {glKpiData.periodProgress}% complete • {100 - glKpiData.periodProgress}% remaining tasks
                </Text>
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card
                style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', height: '100%' }}
                bodyStyle={{ padding: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <div>
                  <Text strong style={{ fontSize: 15, display: 'block' }}>Last Data Sync</Text>
                  <Text type="secondary">{glKpiData.lastSync}</Text>
                </div>
                <Link to="/sync">
                  <div style={{
                    padding: '10px 20px',
                    background: REDWOOD.surface,
                    border: `1px solid ${REDWOOD.neutral200}`,
                    borderRadius: 8,
                    color: REDWOOD.neutral600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}>
                    <SyncOutlined />
                    <span>Sync Now</span>
                  </div>
                </Link>
              </Card>
            </Col>
          </Row>

          {/* Tasks Section */}
          <div style={{ marginBottom: 32 }}>
            <SectionTitle icon={<CheckSquareOutlined />} title="Tasks" color={REDWOOD.taskBlue} />
            <Row gutter={[16, 16]}>
              {taskMenuItems.map((item) => (
                <Col xs={24} sm={12} lg={8} xl={6} key={item.key}>
                  <MenuCard item={item} />
                </Col>
              ))}
            </Row>
          </div>

          {/* Reports Section */}
          <div style={{ marginBottom: 32 }}>
            <SectionTitle icon={<BarChartOutlined />} title="Reports" color={REDWOOD.reportGreen} />
            <Row gutter={[16, 16]}>
              {reportMenuItems.map((item) => (
                <Col xs={24} sm={12} lg={8} xl={6} key={item.key}>
                  <MenuCard item={item} />
                </Col>
              ))}
            </Row>
          </div>

          {/* Setup Section */}
          <div style={{ marginBottom: 32 }}>
            <SectionTitle icon={<SettingOutlined />} title="Setup & Configuration" color={REDWOOD.neutral600} />
            <Row gutter={[16, 16]}>
              {setupMenuItems.map((item) => (
                <Col xs={24} sm={12} lg={8} xl={6} key={item.key}>
                  <MenuCard item={item} />
                </Col>
              ))}
            </Row>
          </div>

          {/* Selected Content Area */}
          {selectedItem && (
            <Card
              style={{
                borderRadius: 12,
                border: `1px solid ${REDWOOD.neutral200}`,
                minHeight: 300,
              }}
            >
              <div style={{ textAlign: 'center', padding: 60 }}>
                <AccountBookOutlined style={{ fontSize: 48, color: REDWOOD.neutral300, marginBottom: 16 }} />
                <Title level={4} style={{ color: REDWOOD.neutral600 }}>
                  {selectedItem.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')}
                </Title>
                <Text type="secondary">
                  Content will be loaded from web services
                </Text>
              </div>
            </Card>
          )}
        </div>

        {/* Floating Connected Icons */}
        <div
          ref={floatingIconsRef}
          style={{
            position: 'fixed',
            right: 24,
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Tasks Icon */}
          <FloatingIcon
            icon={<CheckSquareOutlined />}
            label="Tasks"
            color={REDWOOD.taskBlue}
            isActive={activePanel === 'tasks'}
            onClick={() => togglePanel('tasks')}
            position="top"
          />

          {/* Connector Line */}
          <div style={{
            width: 40,
            height: 2,
            background: REDWOOD.neutral200,
          }} />

          {/* Reports Icon */}
          <FloatingIcon
            icon={<BarChartOutlined />}
            label="Reports"
            color={REDWOOD.reportGreen}
            isActive={activePanel === 'reports'}
            onClick={() => togglePanel('reports')}
            position="bottom"
          />
        </div>

        {/* Backdrop Overlay */}
        {activePanel !== 'none' && (
          <div
            onClick={closePanel}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.3)',
              zIndex: 1000,
              animation: isClosing ? 'fadeOut 0.25s ease forwards' : 'fadeIn 0.3s ease forwards',
            }}
          />
        )}

        {/* Slide-out Panels - Rendered outside to overlay floating icons */}
        <div ref={panelRef}>
          {activePanel === 'tasks' && (
            <SlidePanel
              title="Tasks"
              items={taskMenuItems}
              color={REDWOOD.taskBlue}
            />
          )}
          {activePanel === 'reports' && (
            <SlidePanel
              title="Reports"
              items={reportMenuItems}
              color={REDWOOD.reportGreen}
            />
          )}
        </div>
      </Content>

      {/* Autopilot Assistant */}
      

      {/* CSS Animations */}
      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        @keyframes slideOut {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(100%);
          }
        }
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes fadeOut {
          from {
            opacity: 1;
          }
          to {
            opacity: 0;
          }
        }
        @keyframes fadeInItem {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>
    </Layout>
  );
};

export default GLModule;
