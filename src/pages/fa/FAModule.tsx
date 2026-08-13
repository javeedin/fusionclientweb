import React, { useState, useRef, useEffect } from 'react';
import { Layout, Typography, Card, Breadcrumb, Space, Tooltip, Row, Col, Statistic } from 'antd';
import {
  HomeOutlined,
  BarChartOutlined,
  FileTextOutlined,
  SettingOutlined,
  CheckSquareOutlined,
  CloseOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  PlusCircleOutlined,
  SearchOutlined,
  ToolOutlined,
  TagOutlined,
  LineChartOutlined,
  AuditOutlined,
  DatabaseOutlined,
  FundProjectionScreenOutlined,
  EnvironmentOutlined,
  ScheduleOutlined,
  SwapOutlined,
  DollarOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';

const { Content } = Layout;
const { Title, Text } = Typography;

// Oracle Redwood Color Palette
const REDWOOD = {
  primary:      '#C74634',
  primaryLight: '#E85D4A',
  primaryDark:  '#A33B2C',
  success:      '#1D7B4D',
  warning:      '#D4A800',
  info:         '#0572CE',
  neutral100:   '#F7F7F7',
  neutral200:   '#E5E5E5',
  neutral300:   '#C7C7C7',
  neutral600:   '#6B6B6B',
  neutral900:   '#1A1A1A',
  surface:      '#FFFFFF',
  taskBlue:     '#0572CE',
  reportGreen:  '#1D7B4D',
};

// Fixed Assets accent colour
const FA_COLOR = '#CA7700'; // amber / gold

interface MenuItemType {
  key:          string;
  icon:         React.ReactNode;
  label:        string;
  description?: string;
  color?:       string;
  path?:        string;
}

// ── Task menu ─────────────────────────────────────────────────────────────────
const taskMenuItems: MenuItemType[] = [
  {
    key: 'manage-assets', icon: <SearchOutlined />,
    label: 'Manage Assets', description: 'Search and view asset details',
    color: REDWOOD.info, path: '/fa/assets',
  },
  {
    key: 'create-asset', icon: <PlusCircleOutlined />,
    label: 'Create Asset', description: 'Add a new fixed asset',
    color: REDWOOD.success, path: '/fa/create-asset',
  },
  {
    key: 'calculate-deprn', icon: <LineChartOutlined />,
    label: 'Calculate Depreciation', description: 'Run depreciation for the open period',
    color: FA_COLOR, path: '/fa/calculate-deprn',
  },
  {
    key: 'depreciation', icon: <LineChartOutlined />,
    label: 'Depreciation Workbench', description: 'Review depreciation by period',
    color: FA_COLOR, path: '/fa/depreciation',
  },
  {
    key: 'retirements', icon: <AuditOutlined />,
    label: 'Asset Retirements', description: 'Process and review retirements',
    color: REDWOOD.primary, path: '/fa/retirements',
  },
  {
    key: 'adjustments', icon: <ToolOutlined />,
    label: 'Asset Adjustments', description: 'Cost and depreciation adjustments',
    color: REDWOOD.warning,
  },
  {
    key: 'transfers', icon: <SwapOutlined />,
    label: 'Asset Transfers', description: 'Transfer assets between locations',
    color: REDWOOD.neutral600,
  },
];

// ── Report menu ───────────────────────────────────────────────────────────────
const reportMenuItems: MenuItemType[] = [
  {
    key: 'asset-register', icon: <DatabaseOutlined />,
    label: 'Asset Register', description: 'Full listing of all active assets',
    color: REDWOOD.reportGreen,
  },
  {
    key: 'deprn-report', icon: <LineChartOutlined />,
    label: 'Depreciation Report', description: 'Period depreciation summary',
    color: FA_COLOR,
  },
  {
    key: 'nbv-report', icon: <FundProjectionScreenOutlined />,
    label: 'NBV Analysis', description: 'Net book value by category',
    color: REDWOOD.info,
  },
  {
    key: 'retirement-report', icon: <AuditOutlined />,
    label: 'Retirement Report', description: 'Retired assets with gain/loss',
    color: REDWOOD.primary,
  },
];

// ── Setup menu ────────────────────────────────────────────────────────────────
const setupMenuItems: MenuItemType[] = [
  {
    key: 'categories', icon: <TagOutlined />,
    label: 'Asset Categories', description: 'Define category segments',
    color: FA_COLOR, path: '/fa/setup/categories',
  },
  {
    key: 'methods', icon: <ScheduleOutlined />,
    label: 'Depreciation Methods', description: 'Configure depreciation rules',
    color: REDWOOD.info, path: '/fa/setup/methods',
  },
  {
    key: 'locations', icon: <EnvironmentOutlined />,
    label: 'Locations', description: 'Manage asset location segments',
    color: REDWOOD.success, path: '/fa/setup/locations',
  },
  {
    key: 'book-controls', icon: <FileTextOutlined />,
    label: 'Book Controls', description: 'Corporate and tax book settings',
    color: REDWOOD.neutral600, path: '/fa/setup/book-controls',
  },
];

// ── Mock KPI data ─────────────────────────────────────────────────────────────
const faKpi = {
  activeAssets:  { value: 1_248, trend: 'up',   change: 5  },
  totalCost:     { value: 24_730_000, trend: 'up', change: 3 },
  totalNbv:      { value: 18_210_000, trend: 'down', change: 2 },
  retiredAssets: { value: 87, trend: 'up', change: 11 },
};

// ─────────────────────────────────────────────────────────────────────────────

const FAModule: React.FC = () => {
  const navigate = useNavigate();
  const [activePanel,  setActivePanel]  = useState<'none' | 'tasks' | 'reports'>('none');
  const [isClosing,    setIsClosing]    = useState(false);
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const panelRef        = useRef<HTMLDivElement>(null);
  const floatingIconsRef = useRef<HTMLDivElement>(null);

  // Close panel on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        panelRef.current && !panelRef.current.contains(t) &&
        floatingIconsRef.current && !floatingIconsRef.current.contains(t)
      ) {
        closePanel();
      }
    };
    if (activePanel !== 'none') document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activePanel]);

  const closePanel = () => {
    setIsClosing(true);
    setTimeout(() => { setActivePanel('none'); setIsClosing(false); }, 250);
  };

  const handleMenuItemClick = (key: string, path?: string) => {
    setSelectedItem(key);
    closePanel();
    if (path) navigate(path);
  };

  const togglePanel = (panel: 'tasks' | 'reports') => {
    if (activePanel === panel) { closePanel(); }
    else { setIsClosing(false); setActivePanel(panel); }
  };

  // ── Sub-components ──────────────────────────────────────────────────────────

  const FloatingIcon = ({
    icon, label, color, isActive, onClick, position,
  }: {
    icon: React.ReactNode; label: string; color: string;
    isActive: boolean; onClick: () => void; position: 'top' | 'bottom';
  }) => (
    <Tooltip title={!isActive ? label : ''} placement="left">
      <div
        onClick={onClick}
        style={{
          width: 40, height: 40,
          borderRadius: position === 'top' ? '8px 8px 0 0' : '0 0 8px 8px',
          background: isActive ? color : REDWOOD.surface,
          border: `2px solid ${color}`,
          borderBottom: position === 'top'    ? 'none' : `2px solid ${color}`,
          borderTop:    position === 'bottom' ? 'none' : `2px solid ${color}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', transition: 'all 0.3s ease',
          boxShadow: isActive ? `0 4px 12px ${color}40` : '0 2px 8px rgba(0,0,0,0.1)',
          color: isActive ? '#fff' : color, fontSize: 18,
        }}
      >
        {icon}
      </div>
    </Tooltip>
  );

  const SlidePanel = ({ title, items, color }: { title: string; items: MenuItemType[]; color: string }) => (
    <div style={{
      position: 'fixed', right: 0, top: 0, bottom: 0, width: 300,
      background: REDWOOD.surface, boxShadow: '-4px 0 24px rgba(0,0,0,0.15)',
      overflow: 'hidden',
      animation: isClosing
        ? 'slideOut 0.25s ease-in forwards'
        : 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      zIndex: 1001, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        padding: '10px 14px', background: color,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
      }}>
        <Text strong style={{ color: '#fff', fontSize: 14 }}>{title}</Text>
        <CloseOutlined style={{ color: '#fff', cursor: 'pointer', fontSize: 14, padding: 4 }} onClick={closePanel} />
      </div>

      <div style={{ padding: 10, flex: 1, overflowY: 'auto' }}>
        {items.map((item, index) => (
          <div
            key={item.key}
            onClick={() => handleMenuItemClick(item.key, item.path)}
            style={{
              padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 10,
              transition: 'all 0.2s ease', marginBottom: 6,
              border: `1px solid ${REDWOOD.neutral200}`, background: REDWOOD.surface,
              opacity: 0,
              animation: `fadeInItem 0.3s ease-out ${index * 0.05}s forwards`,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background    = REDWOOD.neutral100;
              e.currentTarget.style.borderColor   = color;
              e.currentTarget.style.transform     = 'translateX(-4px)';
              e.currentTarget.style.boxShadow     = `0 2px 8px ${color}20`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background    = REDWOOD.surface;
              e.currentTarget.style.borderColor   = REDWOOD.neutral200;
              e.currentTarget.style.transform     = 'translateX(0)';
              e.currentTarget.style.boxShadow     = 'none';
            }}
          >
            <div style={{
              width: 32, height: 32, borderRadius: 8,
              background: `${color}15`, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              color, fontSize: 16, flexShrink: 0,
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

  const KpiCard = ({
    title, value, icon, color, trend, change, prefix,
  }: {
    title: string; value: number; icon: React.ReactNode; color: string;
    trend?: 'up' | 'down'; change?: number; prefix?: string;
  }) => (
    <Card
      style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
      bodyStyle={{ padding: 20 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <Text type="secondary" style={{ fontSize: 13 }}>{title}</Text>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
            <Statistic
              value={value}
              prefix={prefix}
              valueStyle={{ fontSize: 24, fontWeight: 600, color: REDWOOD.neutral900 }}
            />
            {trend && change && (
              <span style={{
                color: trend === 'up' ? REDWOOD.success : REDWOOD.primary,
                fontSize: 12, display: 'flex', alignItems: 'center', gap: 2,
              }}>
                {trend === 'up' ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                {change}%
              </span>
            )}
          </div>
        </div>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: `${color}15`, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color, fontSize: 24,
        }}>
          {icon}
        </div>
      </div>
    </Card>
  );

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
          width: 48, height: 48, borderRadius: 12,
          background: `${item.color || FA_COLOR}15`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: item.color || FA_COLOR, fontSize: 24, flexShrink: 0,
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

  const SectionTitle = ({ icon, title, color }: { icon: React.ReactNode; title: string; color: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      <div style={{
        width: 36, height: 36, borderRadius: 8,
        background: `${color}15`, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        color, fontSize: 18,
      }}>
        {icon}
      </div>
      <Text strong style={{ fontSize: 18, color: REDWOOD.neutral900 }}>{title}</Text>
    </div>
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb */}
        <div style={{
          padding: '16px 24px', background: REDWOOD.surface,
          borderBottom: `1px solid ${REDWOOD.neutral200}`,
        }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: 'Fixed Assets' },
          ]} />
        </div>

        {/* Main content */}
        <div style={{ padding: 24, paddingRight: 100 }}>

          {/* Page title */}
          <div style={{ marginBottom: 24 }}>
            <Space align="center">
              <div style={{
                width: 56, height: 56, borderRadius: 12,
                background: `linear-gradient(135deg, ${FA_COLOR} 0%, #9E5C00 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: `0 4px 12px ${FA_COLOR}40`,
              }}>
                <DatabaseOutlined style={{ fontSize: 28, color: '#fff' }} />
              </div>
              <div>
                <Title level={2} style={{ margin: 0, color: REDWOOD.neutral900 }}>Fixed Assets</Title>
                <Text type="secondary">Manage assets, depreciation, retirements, and financial reporting</Text>
              </div>
            </Space>
          </div>

          {/* KPI Cards */}
          <Row gutter={[16, 16]} style={{ marginBottom: 32 }}>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard
                title="Active Assets"
                value={faKpi.activeAssets.value}
                icon={<CheckCircleOutlined />}
                color={REDWOOD.success}
                trend={faKpi.activeAssets.trend as 'up' | 'down'}
                change={faKpi.activeAssets.change}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard
                title="Total Cost"
                value={faKpi.totalCost.value}
                icon={<DollarOutlined />}
                color={FA_COLOR}
                prefix="$"
                trend={faKpi.totalCost.trend as 'up' | 'down'}
                change={faKpi.totalCost.change}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard
                title="Total NBV"
                value={faKpi.totalNbv.value}
                icon={<LineChartOutlined />}
                color={REDWOOD.info}
                prefix="$"
                trend={faKpi.totalNbv.trend as 'up' | 'down'}
                change={faKpi.totalNbv.change}
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <KpiCard
                title="Retired Assets"
                value={faKpi.retiredAssets.value}
                icon={<WarningOutlined />}
                color={REDWOOD.primary}
                trend={faKpi.retiredAssets.trend as 'up' | 'down'}
                change={faKpi.retiredAssets.change}
              />
            </Col>
          </Row>

          {/* Quick-action strip */}
          <Row gutter={[16, 16]} style={{ marginBottom: 32 }}>
            <Col xs={24} sm={12}>
              <Card
                style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', cursor: 'pointer' }}
                bodyStyle={{ padding: 20, display: 'flex', alignItems: 'center', gap: 16 }}
                onClick={() => navigate('/fa/assets')}
              >
                <div style={{
                  width: 48, height: 48, borderRadius: 12,
                  background: `${REDWOOD.info}15`, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  color: REDWOOD.info, fontSize: 24, flexShrink: 0,
                }}>
                  <SearchOutlined />
                </div>
                <div>
                  <Text strong style={{ display: 'block', fontSize: 15 }}>Asset Workbench</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Search, filter, and drill into any asset record
                  </Text>
                </div>
              </Card>
            </Col>
            <Col xs={24} sm={12}>
              <Card
                style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', cursor: 'pointer' }}
                bodyStyle={{ padding: 20, display: 'flex', alignItems: 'center', gap: 16 }}
                onClick={() => navigate('/fa/create-asset')}
              >
                <div style={{
                  width: 48, height: 48, borderRadius: 12,
                  background: `${REDWOOD.success}15`, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  color: REDWOOD.success, fontSize: 24, flexShrink: 0,
                }}>
                  <PlusCircleOutlined />
                </div>
                <div>
                  <Text strong style={{ display: 'block', fontSize: 15 }}>Add New Asset</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Create a new capitalised, CIP, or expensed asset
                  </Text>
                </div>
              </Card>
            </Col>
          </Row>

          {/* Tasks */}
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

          {/* Reports */}
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

          {/* Setup */}
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

          {/* Placeholder when a non-routed menu item is selected */}
          {selectedItem && (
            <Card
              style={{ borderRadius: 12, border: `1px solid ${REDWOOD.neutral200}`, minHeight: 200 }}
            >
              <div style={{ textAlign: 'center', padding: 48 }}>
                <DatabaseOutlined style={{ fontSize: 48, color: REDWOOD.neutral300, marginBottom: 16 }} />
                <Title level={4} style={{ color: REDWOOD.neutral600 }}>
                  {selectedItem.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                </Title>
                <Text type="secondary">This feature is coming soon.</Text>
              </div>
            </Card>
          )}
        </div>

        {/* Floating panel icons */}
        <div
          ref={floatingIconsRef}
          style={{
            position: 'fixed', right: 24, top: '50%',
            transform: 'translateY(-50%)', zIndex: 1000,
            display: 'flex', flexDirection: 'column',
          }}
        >
          <FloatingIcon
            icon={<CheckSquareOutlined />} label="Tasks"
            color={REDWOOD.taskBlue}
            isActive={activePanel === 'tasks'}
            onClick={() => togglePanel('tasks')}
            position="top"
          />
          <div style={{ width: 40, height: 2, background: REDWOOD.neutral200 }} />
          <FloatingIcon
            icon={<BarChartOutlined />} label="Reports"
            color={REDWOOD.reportGreen}
            isActive={activePanel === 'reports'}
            onClick={() => togglePanel('reports')}
            position="bottom"
          />
        </div>

        {/* Backdrop */}
        {activePanel !== 'none' && (
          <div
            onClick={closePanel}
            style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(0,0,0,0.3)', zIndex: 1000,
              animation: isClosing ? 'fadeOut 0.25s ease forwards' : 'fadeIn 0.3s ease forwards',
            }}
          />
        )}

        {/* Slide panels */}
        <div ref={panelRef}>
          {activePanel === 'tasks'   && <SlidePanel title="Tasks"   items={taskMenuItems}   color={REDWOOD.taskBlue}    />}
          {activePanel === 'reports' && <SlidePanel title="Reports" items={reportMenuItems} color={REDWOOD.reportGreen} />}
        </div>
      </Content>

      

      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to   { transform: translateX(0);    }
        }
        @keyframes slideOut {
          from { transform: translateX(0);    }
          to   { transform: translateX(100%); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes fadeOut {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
        @keyframes fadeInItem {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0);    }
        }
      `}</style>
    </Layout>
  );
};

export default FAModule;
