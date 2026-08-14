import React, { useState, useEffect, useMemo } from 'react';
import {
  Layout, Breadcrumb, Typography, Card, Table, Input, Row, Col, Spin, Alert,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { HomeOutlined, BankOutlined, SearchOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { FUSION_POD_AUTH } from '../../config/fusionInstance';
import { getCurrentCompany } from '../../config/company.config';

const { Content } = Layout;

// Get Fusion base URL from current company configuration
const getFusionBase = () => {
  const company = getCurrentCompany();
  return company.fusionBaseUrl ? `${company.fusionBaseUrl}/fscmRestApi/resources/11.13.18.05` : '';
};
const { Title, Text } = Typography;

const FUSION_BASE = `${getFusionBase()}`;
const AUTH_HEADER = FUSION_POD_AUTH;
const HEADERS = { Authorization: AUTH_HEADER, Accept: 'application/json' };

const REDWOOD = {
  primary: '#C74634', primaryDark: '#A33B2C', primaryLight: '#E85D4A',
  success: '#1D7B4D', warning: '#D4A800', info: '#0572CE', error: '#D93025',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
  teal: '#00918A',
};

const LABEL_MAP: Record<string, string> = {
  BusinessUnitId: 'BU ID',
  BusinessUnitName: 'Business Unit Name',
  PrimaryLedgerName: 'Primary Ledger',
  DefaultLegalContext: 'Legal Context',
  Status: 'Status',
};

const humanize = (key: string): string => LABEL_MAP[key] ?? key.replace(/([A-Z])/g, ' $1').trim();

const BusinessUnits: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch(`${FUSION_BASE}/finBusinessUnitsLOV?limit=500`, { headers: HEADERS })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => setData(Array.isArray(d) ? d : (d.items ?? [])))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const columns = useMemo<ColumnsType<any>>(() => {
    if (data.length === 0) return [];
    return Object.keys(data[0])
      .filter(k => k !== 'links')
      .map(key => ({
        title: humanize(key),
        dataIndex: key,
        key,
        ellipsis: true,
        render: (v: any) => (v === null || v === undefined || v === '') ? '—' : String(v),
      }));
  }, [data]);

  const filtered = useMemo(() => {
    if (!search) return data;
    const q = search.toLowerCase();
    return data.filter(row =>
      Object.values(row).some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(q))
    );
  }, [data, search]);

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '14px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/procurement">Fusion Supply Chain</Link> },
            { title: 'Business Units' },
          ]} />
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
            <div style={{
              width: 52, height: 52, borderRadius: 12,
              background: `linear-gradient(135deg, ${REDWOOD.info} 0%, #0461B2 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 4px 14px ${REDWOOD.info}40`,
            }}>
              <BankOutlined style={{ fontSize: 26, color: '#fff' }} />
            </div>
            <div>
              <Title level={2} style={{ margin: 0, color: REDWOOD.neutral900 }}>Business Units</Title>
              <Text type="secondary">Oracle Fusion business units</Text>
            </div>
          </div>

          {loading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
              <Spin size="large" />
            </div>
          )}

          {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

          {!loading && !error && (
            <>
              <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
                <Col xs={24} sm={8}>
                  <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, textAlign: 'center' }} styles={{ body: { padding: '14px 16px' } }}>
                    <Text style={{ fontSize: 28, fontWeight: 700, color: REDWOOD.info, display: 'block' }}>{data.length}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>Total Business Units</Text>
                  </Card>
                </Col>
              </Row>

              <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }} styles={{ body: { padding: 0 } }}>
                <div style={{ padding: '12px 16px', borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
                  <Input
                    placeholder="Search business units..."
                    prefix={<SearchOutlined style={{ color: REDWOOD.neutral600 }} />}
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    allowClear
                    style={{ maxWidth: 400 }}
                  />
                </div>
                <Table
                  dataSource={filtered}
                  columns={columns}
                  rowKey={(r, i) => String(r.BusinessUnitId ?? i)}
                  size="small"
                  bordered
                  scroll={{ x: true }}
                  pagination={{ pageSize: 50, showSizeChanger: true, showTotal: t => `${t} records` }}
                />
              </Card>
            </>
          )}
        </div>
      </Content>
    </Layout>
  );
};

export default BusinessUnits;
