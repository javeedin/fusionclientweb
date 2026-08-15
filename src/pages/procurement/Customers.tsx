import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Layout, Breadcrumb, Card, Table, Button, Tag, Typography, Space,
  Modal, Input, Select, Row, Col, Form, Tabs, message, Empty, Spin,
  Tooltip, Drawer, Divider, InputNumber,
} from 'antd';
import { Link, useParams } from 'react-router-dom';
import {
  HomeOutlined, SearchOutlined, ApiOutlined, CopyOutlined, InfoCircleOutlined,
  ReloadOutlined, ClearOutlined, PlusOutlined, EditOutlined, ExportOutlined,
  TeamOutlined, EnvironmentOutlined, PhoneOutlined, MailOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { buildApexUrl, getFusionAuthHeaders, getFusionInstanceUrl } from '../../config/api.helper';
import { useAuth } from '../../context/AuthContext';
import { searchCustomersByBIP, CustomerSearchResult } from '../../services/customerSearchBip.service';
import { ORACLE_SOAP_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary: '#C74634', primaryLight: '#E85D4A', primaryDark: '#A33B2C',
  success: '#1D7B4D', warning: '#D4A800', info: '#0572CE', error: '#D93025',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
  teal: '#00918A',
};

interface CustomerDetail extends CustomerSearchResult {
  [key: string]: any;
}

// ─ Customers Search Tab ────────────────────────────────────────────────────────
const SearchTab: React.FC<{ onCustomerSelect: (cust: CustomerDetail) => void; onOpenInNewTab: (cust: CustomerDetail) => void }> = ({ onCustomerSelect, onOpenInNewTab }) => {
  const [searchType, setSearchType] = useState<'name' | 'number'>('name');
  const [searchText, setSearchText] = useState('');
  const [businessUnitId, setBusinessUnitId] = useState<string>('');
  const [customers, setCustomers] = useState<CustomerDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [apiDrawerOpen, setApiDrawerOpen] = useState(false);
  const [lastApiDetails, setLastApiDetails] = useState<{ url?: string; envelope?: string }>({});
  const [buOptions, setBuOptions] = useState<{ value: string; label: string }[]>([]);

  // Fetch business units on mount
  useEffect(() => {
    const fetchBUs = async () => {
      try {
        const url = `${buildApexUrl('gl/businessunits')}`;
        const res = await fetch(url, { headers: getFusionAuthHeaders() });
        if (res.ok) {
          const data = await res.json();
          const options = (data.items ?? []).map((bu: any) => ({
            value: bu.business_unit_id?.toString() || '',
            label: bu.business_unit_name || '',
          })).filter((o: any) => o.value && o.label);
          setBuOptions(options);
        } else {
          console.warn('Failed to fetch business units:', res.status);
        }
      } catch (e) {
        console.warn('Failed to fetch business units:', e);
      }
    };
    fetchBUs();
  }, []);

  const handleSearch = async () => {
    if (!searchText.trim()) {
      message.warning('Please enter a search term');
      return;
    }

    setLoading(true);
    setSearched(true);
    try {
      const loggedInUsername = localStorage.getItem('fusion_username') || ORACLE_SOAP_CONFIG.prod.username;
      const loggedInPassword = localStorage.getItem('fusion_password') || ORACLE_SOAP_CONFIG.prod.password;
      const soapBaseUrl = `${getFusionInstanceUrl() || ORACLE_SOAP_CONFIG.prod.baseUrl}`;

      const response = await searchCustomersByBIP(
        businessUnitId,
        searchText,
        soapBaseUrl,
        loggedInUsername,
        loggedInPassword,
        searchType as 'name' | 'account'
      );

      setLastApiDetails({
        url: response.soapUrl,
        envelope: response.soapEnvelope,
      });

      if (response.success && response.customers) {
        setCustomers(response.customers as CustomerDetail[]);
      } else {
        message.error(response.error || 'Search failed');
        setCustomers([]);
      }
    } catch (error) {
      console.error('Customer search error:', error);
      message.error(`Search error: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  };

  const cols: ColumnsType<CustomerDetail> = [
    {
      title: 'Account Name',
      dataIndex: 'accountName',
      width: 200,
      render: (v) => <Text strong style={{ color: REDWOOD.info }}>{v || '—'}</Text>,
    },
    {
      title: 'Account Number',
      dataIndex: 'accountNumber',
      width: 130,
      render: (v) => <Text style={{ fontFamily: 'monospace' }}>{v || '—'}</Text>,
    },
    {
      title: 'Party Number',
      dataIndex: 'partyNumber',
      width: 120,
      render: (v) => v || '—',
    },
    {
      title: 'City',
      dataIndex: 'city',
      width: 120,
      render: (v) => v || '—',
    },
    {
      title: 'Country',
      dataIndex: 'country',
      width: 100,
      render: (v) => v || '—',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 80,
      render: (v) => (
        <Tag color={v === 'A' ? 'green' : 'red'}>
          {v === 'A' ? 'Active' : 'Inactive'}
        </Tag>
      ),
    },
    {
      title: 'Action',
      width: 120,
      render: (_, record) => (
        <Space>
          <Button
            type="primary"
            size="small"
            icon={<EditOutlined />}
            onClick={() => onCustomerSelect(record)}
          >
            View
          </Button>
          <Button
            type="default"
            size="small"
            icon={<ExportOutlined />}
            title="Open in new tab"
            onClick={() => onOpenInNewTab(record)}
          />
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={16} align="bottom" style={{ width: '100%' }}>
          <Col xs={24} sm={12} md={6}>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>Search Type</Text>
              <Select
                value={searchType}
                onChange={(value) => setSearchType(value as 'name' | 'number')}
                style={{ width: '100%' }}
                options={[
                  { label: 'By Name', value: 'name' },
                  { label: 'By Account', value: 'number' },
                ]}
              />
            </div>
          </Col>

          <Col xs={24} sm={12} md={8}>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>Business Unit</Text>
              <Select
                placeholder="Select business unit (optional)"
                value={businessUnitId}
                onChange={(value) => setBusinessUnitId(value)}
                style={{ width: '100%' }}
                options={buOptions}
                allowClear
                loading={buOptions.length === 0}
              />
            </div>
          </Col>

          <Col xs={24} sm={24} md={10}>
            <div>
              <Text strong style={{ display: 'block', marginBottom: 8 }}>Search Term</Text>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Input
                  placeholder={searchType === 'name' ? 'Enter customer name' : 'Enter account number'}
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  onPressEnter={handleSearch}
                  allowClear
                  style={{ flex: 1 }}
                />
                <Button
                  type="primary"
                  icon={<SearchOutlined />}
                  onClick={handleSearch}
                  loading={loading}
                />
                <Button
                  type="text"
                  icon={<ApiOutlined style={{ color: REDWOOD.info }} />}
                  onClick={() => setApiDrawerOpen(true)}
                  title="View API details"
                />
              </div>
            </div>
          </Col>
        </Row>
      </Card>

      {/* API Details Drawer */}
      <Drawer
        title={<Space><ApiOutlined /> API Details</Space>}
        placement="right"
        onClose={() => setApiDrawerOpen(false)}
        open={apiDrawerOpen}
        width={700}
      >
        {lastApiDetails.url || searchText.trim() ? (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <div>
              <Text strong>SOAP Endpoint</Text>
              <div
                style={{
                  backgroundColor: REDWOOD.neutral100,
                  padding: 12,
                  borderRadius: 6,
                  fontFamily: 'monospace',
                  fontSize: 11,
                  wordBreak: 'break-all',
                  marginTop: 8,
                }}
              >
                {lastApiDetails.url || `${getFusionInstanceUrl() || ORACLE_SOAP_CONFIG.prod.baseUrl}`}
              </div>
            </div>
            <Divider style={{ margin: '16px 0' }} />
            <div>
              <Text strong>SOAP Envelope</Text>
              <div
                style={{
                  backgroundColor: REDWOOD.neutral100,
                  padding: 12,
                  borderRadius: 6,
                  fontFamily: 'monospace',
                  fontSize: 10,
                  overflow: 'auto',
                  maxHeight: 400,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  marginTop: 8,
                }}
              >
                {lastApiDetails.envelope || 'Run a search to see the payload'}
              </div>
            </div>
          </Space>
        ) : (
          <Empty description="Run a search to view API details" />
        )}
      </Drawer>

      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <Spin size="large" tip="Searching customers..." />
        </div>
      )}

      {!loading && searched && customers.length === 0 && (
        <Empty description="No customers found" style={{ marginTop: 40 }} />
      )}

      {!loading && !searched && (
        <Empty description="Enter search criteria and click Search" style={{ marginTop: 40 }} />
      )}

      {!loading && searched && customers.length > 0 && (
        <div>
          <Text type="secondary" style={{ fontSize: 12, marginBottom: 12, display: 'block' }}>
            Found {customers.length} customer(s)
          </Text>
          <Table
            size="small"
            columns={cols}
            dataSource={customers}
            rowKey={(record) => record.accountNumber || record.partyNumber}
            pagination={{ pageSize: 20 }}
            scroll={{ x: 1000 }}
          />
        </div>
      )}

    </div>
  );
};

// ─ Customer Detail Tab ─────────────────────────────────────────────────────────
const CustomerDetailTab: React.FC<{ customer: CustomerDetail; onClose: () => void }> = ({ customer, onClose }) => {
  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Button onClick={onClose}>← Back to Search</Button>
      </div>

      <Card title={<Title level={4}>{customer.accountName}</Title>}>
        <Row gutter={24}>
          <Col xs={24} md={12}>
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                Account Number
              </Text>
              <div style={{ fontSize: 14, fontWeight: 'bold', marginTop: 4 }}>
                {customer.accountNumber || '—'}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                Party Number
              </Text>
              <div style={{ fontSize: 14, marginTop: 4 }}>{customer.partyNumber || '—'}</div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                Status
              </Text>
              <div style={{ marginTop: 4 }}>
                <Tag color={customer.status === 'A' ? 'green' : 'red'}>
                  {customer.status === 'A' ? 'Active' : 'Inactive'}
                </Tag>
              </div>
            </div>
          </Col>
          <Col xs={24} md={12}>
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                City
              </Text>
              <div style={{ fontSize: 14, marginTop: 4 }}>{customer.city || '—'}</div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                Country
              </Text>
              <div style={{ fontSize: 14, marginTop: 4 }}>{customer.country || '—'}</div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase' }}>
                Credit Limit
              </Text>
              <div style={{ fontSize: 14, marginTop: 4 }}>
                {customer.creditLimit ? `$${customer.creditLimit.toFixed(2)}` : '—'}
              </div>
            </div>
          </Col>
        </Row>
      </Card>
    </div>
  );
};

// ─ Main Customers Page ─────────────────────────────────────────────────────────
const Customers: React.FC = () => {
  const auth = useAuth();
  const [activeTab, setActiveTab] = useState('search');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetail | null>(null);
  const [openTabs, setOpenTabs] = useState<CustomerDetail[]>([]);

  const handleCustomerSelect = (customer: CustomerDetail) => {
    setSelectedCustomer(customer);
    setActiveTab(`customer-${customer.accountNumber}`);
  };

  const handleOpenInNewTab = (customer: CustomerDetail) => {
    const existing = openTabs.find((t) => t.accountNumber === customer.accountNumber);
    if (!existing) {
      setOpenTabs([...openTabs, customer]);
    }
    setActiveTab(`customer-${customer.accountNumber}`);
  };

  const handleCloseTab = (accountNumber: string) => {
    setOpenTabs(openTabs.filter((t) => t.accountNumber !== accountNumber));
    setActiveTab('search');
  };

  const tabs = [
    {
      key: 'search',
      label: <span><SearchOutlined /> Search Customers</span>,
      children: <SearchTab onCustomerSelect={handleCustomerSelect} onOpenInNewTab={handleOpenInNewTab} />,
    },
    ...openTabs.map((customer) => ({
      key: `customer-${customer.accountNumber}`,
      label: (
        <span>
          {customer.accountName} <span style={{ marginLeft: 8, cursor: 'pointer' }}>×</span>
        </span>
      ),
      closable: true,
      children: <CustomerDetailTab customer={customer} onClose={() => setActiveTab('search')} />,
    })),
  ];

  return (
    <Layout style={{ minHeight: '100vh', background: REDWOOD.neutral100 }}>
      <Content style={{ padding: '24px', width: '100%', margin: '0 auto' }}>
        <Breadcrumb style={{ marginBottom: 24 }} items={[{ icon: <HomeOutlined />, title: <Link to="/procurement">Fusion Supply Chain</Link> }, { title: 'Customers' }]} />

        <Card style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <TeamOutlined style={{ fontSize: 24, color: REDWOOD.teal }} />
              <Title level={4} style={{ margin: 0 }}>
                Customers
              </Title>
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              User: {auth.user?.username || '—'}
            </Text>
          </div>
        </Card>

        <Card>
          <Tabs
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key)}
            onEdit={(key, action) => {
              if (action === 'remove' && typeof key === 'string') {
                const accountNumber = key.replace('customer-', '');
                handleCloseTab(accountNumber);
              }
            }}
            type="editable-card"
            items={tabs}
          />
        </Card>
      </Content>
    </Layout>
  );
};

export default Customers;
