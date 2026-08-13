import React, { useState, useCallback, useEffect } from 'react';
import {
  Layout,
  Card,
  Table,
  Input,
  Button,
  Space,
  Typography,
  Breadcrumb,
  Tag,
  Row,
  Col,
  Switch,
  Tooltip,
  Spin,
  Alert,
  Statistic,
} from 'antd';
import {
  HomeOutlined,
  SearchOutlined,
  ReloadOutlined,
  DatabaseOutlined,
  CloudOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { ORACLE_FUSION_CONFIG, APEX_DB_CONFIG } from '../../config/api.config';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Search } = Input;

// Oracle Redwood Color Palette
const REDWOOD = {
  primary: '#C74634',
  primaryDark: '#A33B2C',
  success: '#1D7B4D',
  warning: '#D4A800',
  error: '#C74634',
  info: '#0572CE',
  neutral: '#383838',
  surface: '#FFFFFF',
  surfaceSecondary: '#F7F7F7',
  border: '#E5E5E5',
  textPrimary: '#1A1A1A',
  textSecondary: '#6B6B6B',
};

interface CodeCombination {
  accounttype: string;
  detailbudgetingallowedflag: string;
  jgzzreconflag: string;
  financialcategory: string | null;
  detailpostingallowedflag: string;
  reference3: string;
  summaryflag: string;
  startdateactive: string;
  enddateactive: string | null;
  enabledflag: string;
  _code_combination_id: number;
  _chart_of_accounts_id: number;
  buimercfinglbcoaco: string;
  buimercfinglbcoalob: string;
  buimercfinglbcoadepartment: string;
  buimercfinglbcoaaccount: string;
  buimercfinglbcoasubacc: string;
  buimercfinglbcoaalys: string;
  buimercfinglbcoaic: string;
  buimercfinglbcoafut1: string;
  buimercfinglbcoafut2: string;
  // APEX specific fields
  created_by?: string;
  creation_date?: string;
  last_updated_by?: string;
  last_update_date?: string;
  // Fusion specific fields (PascalCase)
  AccountType?: string;
  DetailBudgetingAllowedFlag?: string;
  JgzzReconFlag?: string;
  FinancialCategory?: string | null;
  DetailPostingAllowedFlag?: string;
  Reference3?: string;
  SummaryFlag?: string;
  StartDateActive?: string;
  EndDateActive?: string | null;
  EnabledFlag?: string;
  _CODE_COMBINATION_ID?: number;
  _CHART_OF_ACCOUNTS_ID?: number;
  buimercFinGlbCoaCo?: string;
  buimercFinGlbCoaLob?: string;
  buimercFinGlbCoaDepartment?: string;
  buimercFinGlbCoaAccount?: string;
  buimercFinGlbCoaSubAcc?: string;
  buimercFinGlbCoaAlys?: string;
  buimercFinGlbCoaIc?: string;
  buimercFinGlbCoaFut1?: string;
  buimercFinGlbCoaFut2?: string;
}

// Normalize data from either source to consistent format
const normalizeData = (item: CodeCombination, source: 'fusion' | 'apex'): CodeCombination => {
  if (source === 'fusion') {
    return {
      accounttype: item.AccountType || item.accounttype || '',
      detailbudgetingallowedflag: item.DetailBudgetingAllowedFlag || item.detailbudgetingallowedflag || '',
      jgzzreconflag: item.JgzzReconFlag || item.jgzzreconflag || '',
      financialcategory: item.FinancialCategory || item.financialcategory || null,
      detailpostingallowedflag: item.DetailPostingAllowedFlag || item.detailpostingallowedflag || '',
      reference3: item.Reference3 || item.reference3 || '',
      summaryflag: item.SummaryFlag || item.summaryflag || '',
      startdateactive: item.StartDateActive || item.startdateactive || '',
      enddateactive: item.EndDateActive || item.enddateactive || null,
      enabledflag: item.EnabledFlag || item.enabledflag || '',
      _code_combination_id: item._CODE_COMBINATION_ID || item._code_combination_id || 0,
      _chart_of_accounts_id: item._CHART_OF_ACCOUNTS_ID || item._chart_of_accounts_id || 0,
      buimercfinglbcoaco: item.buimercFinGlbCoaCo || item.buimercfinglbcoaco || '',
      buimercfinglbcoalob: item.buimercFinGlbCoaLob || item.buimercfinglbcoalob || '',
      buimercfinglbcoadepartment: item.buimercFinGlbCoaDepartment || item.buimercfinglbcoadepartment || '',
      buimercfinglbcoaaccount: item.buimercFinGlbCoaAccount || item.buimercfinglbcoaaccount || '',
      buimercfinglbcoasubacc: item.buimercFinGlbCoaSubAcc || item.buimercfinglbcoasubacc || '',
      buimercfinglbcoaalys: item.buimercFinGlbCoaAlys || item.buimercfinglbcoaalys || '',
      buimercfinglbcoaic: item.buimercFinGlbCoaIc || item.buimercfinglbcoaic || '',
      buimercfinglbcoafut1: item.buimercFinGlbCoaFut1 || item.buimercfinglbcoafut1 || '',
      buimercfinglbcoafut2: item.buimercFinGlbCoaFut2 || item.buimercfinglbcoafut2 || '',
    };
  }
  return item;
};

const AccountCombinations: React.FC = () => {
  const [dataSource, setDataSource] = useState<'fusion' | 'apex'>('apex');
  const [data, setData] = useState<CodeCombination[]>([]);
  const [filteredData, setFilteredData] = useState<CodeCombination[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [searchText, setSearchText] = useState('');
  const [totalRecords, setTotalRecords] = useState(0);

  // Fetch data from selected source
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    setData([]);
    setFilteredData([]);

    const fusionAuth = 'Basic ' + btoa(`${ORACLE_FUSION_CONFIG.username}:${ORACLE_FUSION_CONFIG.password}`);
    try {
      let url: string;
      let fetchOptions: RequestInit = {};
      if (dataSource === 'fusion') {
        url = `${ORACLE_FUSION_CONFIG.baseUrl}/accountCombinationsLOV?limit=500`;
        fetchOptions = { headers: { Authorization: fusionAuth, Accept: 'application/json' } };
      } else {
        url = `${APEX_DB_CONFIG.baseUrl}/getcodecombinations/get`;
      }

      const response = await fetch(url, fetchOptions);
      const result = await response.json();

      if (dataSource === 'fusion') {
        const items = result.items || [];
        const normalized = items.map((item: CodeCombination) => normalizeData(item, 'fusion'));
        setData(normalized);
        setFilteredData(normalized);
        setTotalRecords(normalized.length);
      } else {
        if (result.items) {
          const normalized = result.items.map((item: CodeCombination) => normalizeData(item, 'apex'));
          setData(normalized);
          setFilteredData(normalized);
          setTotalRecords(normalized.length);
        } else {
          throw new Error('Failed to fetch from APEX');
        }
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [dataSource]);

  // Fetch on mount and when source changes
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter data based on search text
  const handleSearch = (value: string) => {
    setSearchText(value);
    if (!value.trim()) {
      setFilteredData(data);
      return;
    }

    const searchLower = value.toLowerCase();
    const filtered = data.filter((item) => {
      const concatenated = `${item.buimercfinglbcoaco}-${item.buimercfinglbcoalob}-${item.buimercfinglbcoadepartment}-${item.buimercfinglbcoaaccount}-${item.buimercfinglbcoasubacc}-${item.buimercfinglbcoaalys}-${item.buimercfinglbcoaic}-${item.buimercfinglbcoafut1}-${item.buimercfinglbcoafut2}`;
      return (
        concatenated.toLowerCase().includes(searchLower) ||
        String(item._code_combination_id).includes(searchLower) ||
        item.buimercfinglbcoaco?.toLowerCase().includes(searchLower) ||
        item.buimercfinglbcoalob?.toLowerCase().includes(searchLower) ||
        item.buimercfinglbcoadepartment?.toLowerCase().includes(searchLower) ||
        item.buimercfinglbcoaaccount?.toLowerCase().includes(searchLower) ||
        item.buimercfinglbcoasubacc?.toLowerCase().includes(searchLower) ||
        item.accounttype?.toLowerCase().includes(searchLower)
      );
    });
    setFilteredData(filtered);
  };

  // Toggle data source
  const handleSourceToggle = (checked: boolean) => {
    setDataSource(checked ? 'fusion' : 'apex');
  };

  // Generate unique filter values for a column
  const getColumnFilters = (dataIndex: keyof CodeCombination) => {
    const uniqueValues = [...new Set(data.map((item) => item[dataIndex]).filter(Boolean))];
    return uniqueValues.sort().map((value) => ({
      text: String(value),
      value: String(value),
    }));
  };

  // Table columns with trimmed labels and filters
  const columns = [
    {
      title: 'CC ID',
      dataIndex: '_code_combination_id',
      key: '_code_combination_id',
      width: 140,
      sorter: (a: CodeCombination, b: CodeCombination) => a._code_combination_id - b._code_combination_id,
      render: (id: number) => <Text code style={{ fontSize: 11 }}>{id}</Text>,
      filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }: any) => (
        <div style={{ padding: 8 }}>
          <Input
            placeholder="Search CC ID"
            value={selectedKeys[0]}
            onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
            onPressEnter={() => confirm()}
            style={{ marginBottom: 8, display: 'block' }}
          />
          <Space>
            <Button type="primary" onClick={() => confirm()} size="small" style={{ width: 90 }}>
              Filter
            </Button>
            <Button onClick={() => clearFilters?.()} size="small" style={{ width: 90 }}>
              Reset
            </Button>
          </Space>
        </div>
      ),
      onFilter: (value: React.Key | boolean, record: CodeCombination) =>
        String(record._code_combination_id).includes(String(value)),
      filterIcon: (filtered: boolean) => (
        <SearchOutlined style={{ color: filtered ? REDWOOD.primary : undefined }} />
      ),
    },
    {
      title: 'Co',
      dataIndex: 'buimercfinglbcoaco',
      key: 'co',
      width: 70,
      sorter: (a: CodeCombination, b: CodeCombination) => (a.buimercfinglbcoaco || '').localeCompare(b.buimercfinglbcoaco || ''),
      filters: getColumnFilters('buimercfinglbcoaco'),
      onFilter: (value: React.Key | boolean, record: CodeCombination) => record.buimercfinglbcoaco === value,
      filterSearch: true,
    },
    {
      title: 'LOB',
      dataIndex: 'buimercfinglbcoalob',
      key: 'lob',
      width: 70,
      sorter: (a: CodeCombination, b: CodeCombination) => (a.buimercfinglbcoalob || '').localeCompare(b.buimercfinglbcoalob || ''),
      filters: getColumnFilters('buimercfinglbcoalob'),
      onFilter: (value: React.Key | boolean, record: CodeCombination) => record.buimercfinglbcoalob === value,
      filterSearch: true,
    },
    {
      title: 'Dept',
      dataIndex: 'buimercfinglbcoadepartment',
      key: 'department',
      width: 80,
      sorter: (a: CodeCombination, b: CodeCombination) => (a.buimercfinglbcoadepartment || '').localeCompare(b.buimercfinglbcoadepartment || ''),
      filters: getColumnFilters('buimercfinglbcoadepartment'),
      onFilter: (value: React.Key | boolean, record: CodeCombination) => record.buimercfinglbcoadepartment === value,
      filterSearch: true,
    },
    {
      title: 'Account',
      dataIndex: 'buimercfinglbcoaaccount',
      key: 'account',
      width: 110,
      sorter: (a: CodeCombination, b: CodeCombination) => (a.buimercfinglbcoaaccount || '').localeCompare(b.buimercfinglbcoaaccount || ''),
      render: (account: string) => <Text strong>{account}</Text>,
      filters: getColumnFilters('buimercfinglbcoaaccount'),
      onFilter: (value: React.Key | boolean, record: CodeCombination) => record.buimercfinglbcoaaccount === value,
      filterSearch: true,
    },
    {
      title: 'SubAcc',
      dataIndex: 'buimercfinglbcoasubacc',
      key: 'subacc',
      width: 90,
      sorter: (a: CodeCombination, b: CodeCombination) => (a.buimercfinglbcoasubacc || '').localeCompare(b.buimercfinglbcoasubacc || ''),
      filters: getColumnFilters('buimercfinglbcoasubacc'),
      onFilter: (value: React.Key | boolean, record: CodeCombination) => record.buimercfinglbcoasubacc === value,
      filterSearch: true,
    },
    {
      title: 'Alys',
      dataIndex: 'buimercfinglbcoaalys',
      key: 'alys',
      width: 70,
      sorter: (a: CodeCombination, b: CodeCombination) => (a.buimercfinglbcoaalys || '').localeCompare(b.buimercfinglbcoaalys || ''),
      filters: getColumnFilters('buimercfinglbcoaalys'),
      onFilter: (value: React.Key | boolean, record: CodeCombination) => record.buimercfinglbcoaalys === value,
      filterSearch: true,
    },
    {
      title: 'IC',
      dataIndex: 'buimercfinglbcoaic',
      key: 'ic',
      width: 60,
      sorter: (a: CodeCombination, b: CodeCombination) => (a.buimercfinglbcoaic || '').localeCompare(b.buimercfinglbcoaic || ''),
      filters: getColumnFilters('buimercfinglbcoaic'),
      onFilter: (value: React.Key | boolean, record: CodeCombination) => record.buimercfinglbcoaic === value,
      filterSearch: true,
    },
    {
      title: 'Fut1',
      dataIndex: 'buimercfinglbcoafut1',
      key: 'fut1',
      width: 70,
      sorter: (a: CodeCombination, b: CodeCombination) => (a.buimercfinglbcoafut1 || '').localeCompare(b.buimercfinglbcoafut1 || ''),
      filters: getColumnFilters('buimercfinglbcoafut1'),
      onFilter: (value: React.Key | boolean, record: CodeCombination) => record.buimercfinglbcoafut1 === value,
      filterSearch: true,
    },
    {
      title: 'Fut2',
      dataIndex: 'buimercfinglbcoafut2',
      key: 'fut2',
      width: 70,
      sorter: (a: CodeCombination, b: CodeCombination) => (a.buimercfinglbcoafut2 || '').localeCompare(b.buimercfinglbcoafut2 || ''),
      filters: getColumnFilters('buimercfinglbcoafut2'),
      onFilter: (value: React.Key | boolean, record: CodeCombination) => record.buimercfinglbcoafut2 === value,
      filterSearch: true,
    },
    {
      title: 'Type',
      dataIndex: 'accounttype',
      key: 'accounttype',
      width: 70,
      filters: [
        { text: 'A - Asset', value: 'A' },
        { text: 'L - Liability', value: 'L' },
        { text: 'O - Equity', value: 'O' },
        { text: 'E - Expense', value: 'E' },
        { text: 'R - Revenue', value: 'R' },
      ],
      onFilter: (value: React.Key | boolean, record: CodeCombination) => record.accounttype === value,
      render: (type: string) => {
        const typeMap: Record<string, { label: string; color: string }> = {
          'A': { label: 'Asset', color: REDWOOD.info },
          'L': { label: 'Liability', color: REDWOOD.warning },
          'O': { label: 'Equity', color: REDWOOD.success },
          'E': { label: 'Expense', color: REDWOOD.error },
          'R': { label: 'Revenue', color: REDWOOD.success },
        };
        const info = typeMap[type] || { label: type, color: REDWOOD.neutral };
        return (
          <Tooltip title={info.label}>
            <Tag color={info.color} style={{ margin: 0 }}>{type}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: 'Enabled',
      dataIndex: 'enabledflag',
      key: 'enabledflag',
      width: 90,
      render: (flag: string) => (
        flag === 'Y'
          ? <CheckCircleOutlined style={{ color: REDWOOD.success, fontSize: 16 }} />
          : <CloseCircleOutlined style={{ color: REDWOOD.error, fontSize: 16 }} />
      ),
      filters: [
        { text: 'Enabled', value: 'Y' },
        { text: 'Disabled', value: 'N' },
      ],
      onFilter: (value: React.Key | boolean, record: CodeCombination) => record.enabledflag === value,
    },
    {
      title: 'Posting',
      dataIndex: 'detailpostingallowedflag',
      key: 'detailpostingallowedflag',
      width: 90,
      render: (flag: string) => (
        flag === 'Y'
          ? <CheckCircleOutlined style={{ color: REDWOOD.success, fontSize: 16 }} />
          : <CloseCircleOutlined style={{ color: REDWOOD.textSecondary, fontSize: 16 }} />
      ),
      filters: [
        { text: 'Allowed', value: 'Y' },
        { text: 'Not Allowed', value: 'N' },
      ],
      onFilter: (value: React.Key | boolean, record: CodeCombination) => record.detailpostingallowedflag === value,
    },
    {
      title: 'Budgeting',
      dataIndex: 'detailbudgetingallowedflag',
      key: 'detailbudgetingallowedflag',
      width: 100,
      render: (flag: string) => (
        flag === 'Y'
          ? <CheckCircleOutlined style={{ color: REDWOOD.success, fontSize: 16 }} />
          : <CloseCircleOutlined style={{ color: REDWOOD.textSecondary, fontSize: 16 }} />
      ),
      filters: [
        { text: 'Allowed', value: 'Y' },
        { text: 'Not Allowed', value: 'N' },
      ],
      onFilter: (value: React.Key | boolean, record: CodeCombination) => record.detailbudgetingallowedflag === value,
    },
    {
      title: 'Start Date',
      dataIndex: 'startdateactive',
      key: 'startdateactive',
      width: 110,
      render: (date: string) => date ? new Date(date).toLocaleDateString() : '-',
      sorter: (a: CodeCombination, b: CodeCombination) =>
        new Date(a.startdateactive || 0).getTime() - new Date(b.startdateactive || 0).getTime(),
    },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.surfaceSecondary }}>
      <Content>
        {/* Header */}
        <div style={{
          padding: '16px 24px',
          background: REDWOOD.surface,
          borderBottom: `1px solid ${REDWOOD.border}`
        }}>
          <Breadcrumb
            items={[
              { title: <Link to="/home"><HomeOutlined /> Home</Link> },
              { title: <Link to="/gl">General Ledger</Link> },
              { title: 'Account Combinations' },
            ]}
          />
        </div>

        <div style={{ padding: 24 }}>
          {/* Title Section */}
          <div style={{ marginBottom: 24 }}>
            <Space align="center">
              <div style={{
                width: 48,
                height: 48,
                borderRadius: 8,
                background: REDWOOD.primary,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <SettingOutlined style={{ fontSize: 24, color: '#fff' }} />
              </div>
              <div>
                <Title level={3} style={{ margin: 0, color: REDWOOD.textPrimary }}>
                  Account Combinations
                </Title>
                <Text type="secondary">Valid GL account code combinations</Text>
              </div>
            </Space>
          </div>

          {/* Toolbar */}
          <Card
            style={{
              borderRadius: 12,
              border: `1px solid ${REDWOOD.border}`,
              marginBottom: 16,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}
            bodyStyle={{ padding: '16px 20px' }}
          >
            <Row gutter={16} align="middle">
              <Col flex="auto">
                <Search
                  placeholder="Search by account, segment, or CC ID..."
                  allowClear
                  enterButton={<SearchOutlined />}
                  size="large"
                  value={searchText}
                  onChange={(e) => handleSearch(e.target.value)}
                  onSearch={handleSearch}
                  style={{ maxWidth: 500 }}
                />
              </Col>
              <Col>
                <Space size="large">
                  {/* Data Source Toggle */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '8px 16px',
                    background: REDWOOD.surfaceSecondary,
                    borderRadius: 8,
                  }}>
                    <Space>
                      <DatabaseOutlined style={{ color: dataSource === 'apex' ? REDWOOD.primary : REDWOOD.textSecondary }} />
                      <Text strong={dataSource === 'apex'} style={{ color: dataSource === 'apex' ? REDWOOD.textPrimary : REDWOOD.textSecondary }}>
                        APEX DB
                      </Text>
                    </Space>
                    <Switch
                      checked={dataSource === 'fusion'}
                      onChange={handleSourceToggle}
                      style={{ background: dataSource === 'fusion' ? REDWOOD.info : REDWOOD.primary }}
                    />
                    <Space>
                      <CloudOutlined style={{ color: dataSource === 'fusion' ? REDWOOD.info : REDWOOD.textSecondary }} />
                      <Text strong={dataSource === 'fusion'} style={{ color: dataSource === 'fusion' ? REDWOOD.textPrimary : REDWOOD.textSecondary }}>
                        Fusion
                      </Text>
                    </Space>
                  </div>

                  <Button
                    icon={<ReloadOutlined />}
                    onClick={fetchData}
                    loading={loading}
                  >
                    Refresh
                  </Button>
                </Space>
              </Col>
            </Row>
          </Card>

          {/* Stats Row */}
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col xs={24} sm={8}>
              <Card
                style={{
                  borderRadius: 12,
                  border: `1px solid ${REDWOOD.border}`,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                }}
                bodyStyle={{ padding: 16 }}
              >
                <Statistic
                  title="Total Records"
                  value={totalRecords}
                  prefix={<DatabaseOutlined style={{ color: REDWOOD.primary }} />}
                  valueStyle={{ color: REDWOOD.textPrimary }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card
                style={{
                  borderRadius: 12,
                  border: `1px solid ${REDWOOD.border}`,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                }}
                bodyStyle={{ padding: 16 }}
              >
                <Statistic
                  title="Filtered Results"
                  value={filteredData.length}
                  prefix={<SearchOutlined style={{ color: REDWOOD.info }} />}
                  valueStyle={{ color: REDWOOD.textPrimary }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card
                style={{
                  borderRadius: 12,
                  border: `1px solid ${REDWOOD.border}`,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                }}
                bodyStyle={{ padding: 16 }}
              >
                <Statistic
                  title="Data Source"
                  value={dataSource === 'fusion' ? 'Oracle Fusion' : 'APEX Database'}
                  prefix={dataSource === 'fusion' ? <CloudOutlined style={{ color: REDWOOD.info }} /> : <DatabaseOutlined style={{ color: REDWOOD.success }} />}
                  valueStyle={{ color: REDWOOD.textPrimary, fontSize: 18 }}
                />
              </Card>
            </Col>
          </Row>

          {/* Error Alert */}
          {error && (
            <Alert
              message="Error Loading Data"
              description={error}
              type="error"
              showIcon
              closable
              onClose={() => setError('')}
              style={{ marginBottom: 16, borderRadius: 8 }}
            />
          )}

          {/* Data Table */}
          <Card
            style={{
              borderRadius: 12,
              border: `1px solid ${REDWOOD.border}`,
              boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
            }}
            bodyStyle={{ padding: 0 }}
          >
            <Spin spinning={loading} tip="Loading account combinations...">
              <Table
                dataSource={filteredData}
                columns={columns}
                rowKey="_code_combination_id"
                size="small"
                pagination={{
                  pageSize: 50,
                  showSizeChanger: true,
                  pageSizeOptions: ['25', '50', '100', '200'],
                  showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} records`,
                }}
                scroll={{ x: 1200 }}
                style={{ borderRadius: '0 0 12px 12px' }}
              />
            </Spin>
          </Card>
        </div>
      </Content>

      {/* Autopilot Assistant */}
      
    </Layout>
  );
};

export default AccountCombinations;
