import { getFusionAuthHeaders } from '../../config/api.helper';
import React, { useState, useEffect, useMemo } from 'react';
import {
  Layout, Breadcrumb, Typography, Card, Row, Col, Input, Tag, Collapse, Badge, Spin, Alert, Button, Drawer, Space, Divider, message, Select,
} from 'antd';
import { HomeOutlined, ApartmentOutlined, SearchOutlined, ApiOutlined, CopyOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { getCurrentCompany } from '../../config/company.config';

const { Content } = Layout;
const { Title, Text } = Typography;

const getFusionBase = () => {
  const company = getCurrentCompany();
  return company.fusionBaseUrl ? `${company.fusionBaseUrl}/fscmRestApi/resources/11.13.18.05` : '';
};

const REDWOOD = {
  primary: '#C74634', primaryDark: '#A33B2C', primaryLight: '#E85D4A',
  success: '#1D7B4D', warning: '#D4A800', info: '#0572CE', error: '#D93025',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral300: '#C7C7C7',
  neutral600: '#6B6B6B', neutral900: '#1A1A1A', surface: '#FFFFFF',
  teal: '#00918A',
};

interface SubinventoryRow {
  business_unit_code: string;
  business_unit_name: string;
  warehouse_code: string;
  warehouse_name: string;
  subinventory_code: string;
  subinventory_name: string;
  locator_id: string;
  instance_name: string;
}

interface Subinventory {
  code: string;
  name: string;
}

interface Warehouse {
  code: string;
  name: string;
  subinventories: Subinventory[];
}

interface BusinessUnit {
  code: string;
  name: string;
  warehouses: Map<string, Warehouse>;
}

const buildHierarchy = (rows: SubinventoryRow[]): Map<string, BusinessUnit> => {
  const buMap = new Map<string, BusinessUnit>();
  rows.forEach(row => {
    if (!buMap.has(row.business_unit_code)) {
      buMap.set(row.business_unit_code, { code: row.business_unit_code, name: row.business_unit_name, warehouses: new Map() });
    }
    const bu = buMap.get(row.business_unit_code)!;
    if (!bu.warehouses.has(row.warehouse_code)) {
      bu.warehouses.set(row.warehouse_code, { code: row.warehouse_code, name: row.warehouse_name, subinventories: [] });
    }
    const wh = bu.warehouses.get(row.warehouse_code)!;
    const already = wh.subinventories.some(s => s.code === row.subinventory_code);
    if (!already) {
      wh.subinventories.push({ code: row.subinventory_code, name: row.subinventory_name });
    }
  });
  return buMap;
};

const matchesSearch = (q: string, ...vals: string[]) => {
  if (!q) return true;
  const low = q.toLowerCase();
  return vals.some(v => v.toLowerCase().includes(low));
};

const Subinventories: React.FC = () => {
  const [rows, setRows] = useState<SubinventoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [apiDrawerOpen, setApiDrawerOpen] = useState(false);
  const [apiUrl, setApiUrl] = useState('');
  const [apiResponse, setApiResponse] = useState('');
  const [busUnits, setBusUnits] = useState<any[]>([]);
  const [orgs, setOrgs] = useState<any[]>([]);
  const [selectedBU, setSelectedBU] = useState('');
  const [selectedOrg, setSelectedOrg] = useState('');
  const [buLoading, setBuLoading] = useState(true);
  const [buApiUrl, setBuApiUrl] = useState('');
  const [orgsApiUrl, setOrgsApiUrl] = useState('');

  // Fetch business units on mount
  useEffect(() => {
    const fusionBase = getFusionBase();
    const url = `${fusionBase}/payablesOptions?onlyData=true&limit=500&fields=businessUnitId,businessUnitName,paymentCurrency,ledgerCurrency`;
    setBuApiUrl(url);
    fetch(url, { headers: getFusionAuthHeaders() })
      .then(r => r.json())
      .then(d => {
        const seen = new Set<string>();
        const options = (d.items ?? [])
          .filter((b: any) => {
            const name = b.businessUnitName;
            if (!name || seen.has(name)) return false;
            seen.add(name);
            return true;
          });
        setBusUnits(options);
      })
      .catch(e => console.error('Failed to fetch business units:', e))
      .finally(() => setBuLoading(false));
  }, []);

  // Fetch organizations when BU changes
  useEffect(() => {
    if (!selectedBU) {
      setOrgs([]);
      setSelectedOrg('');
      setRows([]);
      setOrgsApiUrl('');
      return;
    }

    const fusionBase = getFusionBase();
    const url = `${fusionBase}/inventoryOrganizations?q=ManagementBusinessUnitId=${selectedBU}&onlyData=true&limit=500`;
    setOrgsApiUrl(url);
    fetch(url, { headers: getFusionAuthHeaders() })
      .then(r => r.json())
      .then(d => {
        const items = d.items ?? [];
        setOrgs(items);
      })
      .catch(e => {
        console.error('Failed to fetch organizations:', e);
        setOrgs([]);
      });
  }, [selectedBU]);

  // Fetch subinventories when org changes
  useEffect(() => {
    if (!selectedOrg) {
      setRows([]);
      setApiUrl('');
      setApiResponse('');
      return;
    }

    setLoading(true);
    setError('');

    const fusionBase = getFusionBase();
    const url = `${fusionBase}/subinventories?q=OrganizationCode=${encodeURIComponent(selectedOrg)}&onlyData=true&limit=500`;
    const headers = getFusionAuthHeaders();
    setApiUrl(url);

    fetch(url, { headers })
      .then(r => {
        if (!r.ok) {
          return r.text().then(text => {
            setApiResponse(`HTTP ${r.status}: ${text}`);
            throw new Error(`HTTP ${r.status}`);
          });
        }
        return r.json().then(d => {
          setApiResponse(JSON.stringify(d, null, 2));
          return d;
        });
      })
      .then(d => {
        const items = Array.isArray(d) ? d : (d.items ?? []);
        const rows = items.map((item: any) => ({
          business_unit_code: selectedBU || '',
          business_unit_name: busUnits.find(b => b.businessUnitId === parseInt(selectedBU))?.businessUnitName || '',
          warehouse_code: item.WarehouseCode || item.warehouse_code || '',
          warehouse_name: item.WarehouseName || item.warehouse_name || '',
          subinventory_code: item.SubinventoryCode || item.subinventory_code || '',
          subinventory_name: item.SubinventoryName || item.subinventory_name || '',
          locator_id: item.LocatorId || item.locator_id || '',
          instance_name: item.InstanceName || item.instance_name || '',
        }));
        setRows(rows);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [selectedOrg, selectedBU, busUnits]);

  const hierarchy = useMemo(() => buildHierarchy(rows), [rows]);

  const filteredHierarchy = useMemo(() => {
    if (!search) return hierarchy;
    const q = search.toLowerCase();
    const result = new Map<string, BusinessUnit>();
    hierarchy.forEach((bu, buKey) => {
      const buMatch = matchesSearch(q, bu.code, bu.name);
      const filteredWhs = new Map<string, Warehouse>();
      bu.warehouses.forEach((wh, whKey) => {
        const whMatch = matchesSearch(q, wh.code, wh.name);
        const filteredSubs = wh.subinventories.filter(s => matchesSearch(q, s.code, s.name));
        if (buMatch || whMatch || filteredSubs.length > 0) {
          filteredWhs.set(whKey, { ...wh, subinventories: buMatch || whMatch ? wh.subinventories : filteredSubs });
        }
      });
      if (buMatch || filteredWhs.size > 0) {
        result.set(buKey, { ...bu, warehouses: buMatch ? bu.warehouses : filteredWhs });
      }
    });
    return result;
  }, [hierarchy, search]);

  const totalBUs = hierarchy.size;
  const totalWHs = useMemo(() => { let c = 0; hierarchy.forEach(bu => { c += bu.warehouses.size; }); return c; }, [hierarchy]);
  const totalSubs = useMemo(() => { let c = 0; hierarchy.forEach(bu => { bu.warehouses.forEach(wh => { c += wh.subinventories.length; }); }); return c; }, [hierarchy]);

  const buPanels = useMemo(() => {
    const panels: any[] = [];
    filteredHierarchy.forEach(bu => {
      const whPanels: any[] = [];
      bu.warehouses.forEach(wh => {
        whPanels.push({
          key: wh.code,
          label: (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Text strong style={{ color: REDWOOD.info, fontSize: 13 }}>{wh.code}</Text>
              <Text style={{ fontSize: 13 }}>{wh.name}</Text>
              <Badge count={wh.subinventories.length} style={{ backgroundColor: REDWOOD.teal }} />
            </div>
          ),
          children: (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {wh.subinventories.map(s => (
                <Tag key={s.code} style={{ borderRadius: 12, background: REDWOOD.teal + '18', borderColor: REDWOOD.teal, color: REDWOOD.teal, margin: 0 }}>
                  <span style={{ fontWeight: 600, marginRight: 4 }}>{s.code}</span>
                  <span style={{ fontSize: 11, color: REDWOOD.neutral600 }}>{s.name}</span>
                </Tag>
              ))}
            </div>
          ),
        });
      });

      panels.push({
        key: bu.code,
        label: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Text strong style={{ color: REDWOOD.primary, fontSize: 14 }}>{bu.code}</Text>
            <Text style={{ fontSize: 14 }}>{bu.name}</Text>
            <Badge count={bu.warehouses.size} style={{ backgroundColor: REDWOOD.primary }} />
          </div>
        ),
        children: (
          <Collapse
            size="small"
            style={{ background: REDWOOD.neutral100 }}
            items={whPanels}
          />
        ),
      });
    });
    return panels;
  }, [filteredHierarchy]);

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '14px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/procurement">Fusion Supply Chain</Link> },
            { title: 'Subinventories' },
          ]} />
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 52, height: 52, borderRadius: 12,
                background: `linear-gradient(135deg, ${REDWOOD.teal} 0%, #007A74 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: `0 4px 14px ${REDWOOD.teal}40`,
              }}>
                <ApartmentOutlined style={{ fontSize: 26, color: '#fff' }} />
              </div>
              <div>
                <Title level={2} style={{ margin: 0, color: REDWOOD.neutral900 }}>Subinventories</Title>
                <Text type="secondary">Warehouse and subinventory hierarchy by business unit</Text>
              </div>
            </div>
            <Button
              type="text"
              icon={<ApiOutlined style={{ color: REDWOOD.info, fontSize: 18 }} />}
              onClick={() => setApiDrawerOpen(true)}
              title="View API Details"
            />
          </div>

          {/* Business Unit and Organization Selection */}
          <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, marginBottom: 16 }} styles={{ body: { padding: '16px' } }}>
            <Row gutter={16}>
              <Col xs={24} sm={12}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>Business Unit</Text>
                <Select
                  placeholder="Select business unit"
                  value={selectedBU}
                  onChange={setSelectedBU}
                  loading={buLoading}
                  style={{ width: '100%' }}
                  options={busUnits.map(bu => ({
                    value: bu.businessUnitId?.toString() || '',
                    label: bu.businessUnitName || '',
                  }))}
                  allowClear
                />
              </Col>
              <Col xs={24} sm={12}>
                <Text strong style={{ display: 'block', marginBottom: 8 }}>Inventory Organization</Text>
                <Select
                  placeholder="Select organization"
                  value={selectedOrg}
                  onChange={setSelectedOrg}
                  disabled={!selectedBU}
                  style={{ width: '100%' }}
                  options={orgs.map(org => ({
                    value: org.OrganizationCode || org.organization_code || '',
                    label: org.OrganizationName || org.organization_name || org.OrganizationCode || '',
                  }))}
                  allowClear
                />
              </Col>
            </Row>
          </Card>

          {loading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
              <Spin size="large" tip="Loading subinventories..." />
            </div>
          )}

          {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

          {!loading && rows.length > 0 && (
            <>
              <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
                {[
                  { label: 'Business Units', value: totalBUs, color: REDWOOD.primary },
                  { label: 'Warehouses', value: totalWHs, color: REDWOOD.info },
                  { label: 'Subinventories', value: totalSubs, color: REDWOOD.teal },
                ].map(kpi => (
                  <Col xs={24} sm={8} key={kpi.label}>
                    <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, textAlign: 'center' }} styles={{ body: { padding: '14px 16px' } }}>
                      <Text style={{ fontSize: 28, fontWeight: 700, color: kpi.color, display: 'block' }}>{kpi.value}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>{kpi.label}</Text>
                    </Card>
                  </Col>
                ))}
              </Row>

              <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, marginBottom: 16 }} styles={{ body: { padding: '12px 16px' } }}>
                <Input
                  placeholder="Search business units, warehouses, or subinventories..."
                  prefix={<SearchOutlined style={{ color: REDWOOD.neutral600 }} />}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  allowClear
                  style={{ maxWidth: 500 }}
                />
              </Card>

              <Collapse
                style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, background: REDWOOD.surface }}
                items={buPanels}
              />
            </>
          )}

          {!loading && !selectedOrg && !error && (
            <Alert type="info" message="Select a business unit and inventory organization to view subinventories" style={{ marginTop: 16 }} />
          )}

          {!loading && selectedOrg && rows.length === 0 && !error && (
            <Alert type="info" message="No subinventories found for the selected organization" style={{ marginTop: 16 }} />
          )}
        </div>

        {/* API Details Drawer */}
        <Drawer
          title={<Space><ApiOutlined /> API Details - Subinventories</Space>}
          placement="right"
          onClose={() => setApiDrawerOpen(false)}
          open={apiDrawerOpen}
          width={750}
        >
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <div>
              <Text strong style={{ fontSize: 12, color: REDWOOD.neutral900, display: 'block', marginBottom: 12 }}>📡 API Calls Sequence</Text>
              {[
                { step: '1️⃣', name: 'Business Units', url: buApiUrl, status: busUnits.length > 0 ? '✓ Loaded' : 'Pending' },
                { step: '2️⃣', name: 'Inventory Organizations', url: orgsApiUrl, status: selectedBU && orgs.length > 0 ? '✓ Loaded' : selectedBU ? '⏳ Loading...' : 'Disabled' },
                { step: '3️⃣', name: 'Subinventories', url: apiUrl, status: selectedOrg && rows.length > 0 ? '✓ Loaded' : selectedOrg ? '⏳ Loading...' : 'Disabled' },
              ].map((api, idx) => (
                <div key={idx} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: idx < 2 ? `1px solid ${REDWOOD.neutral200}` : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 16 }}>{api.step}</span>
                    <Text strong style={{ fontSize: 13 }}>{api.name}</Text>
                    <Tag color={api.status.includes('✓') ? 'green' : api.status.includes('⏳') ? 'blue' : 'default'} style={{ fontSize: 11 }}>
                      {api.status}
                    </Tag>
                  </div>
                  {api.url && (
                    <div
                      style={{
                        backgroundColor: REDWOOD.neutral100,
                        padding: 10,
                        borderRadius: 4,
                        fontFamily: 'monospace',
                        fontSize: 10,
                        wordBreak: 'break-all',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 8,
                      }}
                    >
                      <span style={{ flex: 1 }}>{api.url}</span>
                      <Button
                        type="text"
                        size="small"
                        icon={<CopyOutlined />}
                        onClick={() => {
                          navigator.clipboard.writeText(api.url);
                          message.success('URL copied');
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>

            {selectedOrg && apiResponse && (
              <>
                <Divider style={{ margin: '12px 0' }} />
                <div>
                  <Text strong style={{ color: REDWOOD.info, fontSize: 12 }}>Response (Last Call)</Text>
                  <div style={{ marginTop: 8 }}>
                    <div
                      style={{
                        backgroundColor: REDWOOD.neutral100,
                        padding: 12,
                        borderRadius: 6,
                        fontFamily: 'monospace',
                        fontSize: 10,
                        overflow: 'auto',
                        maxHeight: 300,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        border: `1px solid ${REDWOOD.neutral200}`,
                      }}
                    >
                      {apiResponse}
                    </div>
                  </div>
                </div>
              </>
            )}
          </Space>
        </Drawer>
      </Content>
    </Layout>
  );
};

export default Subinventories;
