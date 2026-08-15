import { buildApexUrl } from '../../config/api.helper';
import React, { useState, useEffect, useMemo } from 'react';
import {
  Layout, Breadcrumb, Typography, Card, Row, Col, Input, Tag, Badge, Spin, Alert, Table,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { HomeOutlined, ApartmentOutlined, SearchOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';

const { Content } = Layout;
const { Title, Text } = Typography;

const ORDS_BASE = buildApexUrl('test/FUSIONCLIENTERP');

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

interface SubinventoryData {
  key: string;
  warehouseCode: string;
  warehouseName: string;
  subinventoryCode: string;
  subinventoryName: string;
}

const SubinventoriesTable: React.FC<{ data: SubinventoryData[] }> = ({ data }) => {
  const [search, setSearch] = useState('');

  const filtered = data.filter(d =>
    !search || [d.warehouseCode, d.warehouseName, d.subinventoryCode, d.subinventoryName]
      .some(v => String(v).toLowerCase().includes(search.toLowerCase()))
  );

  const cols: ColumnsType<SubinventoryData> = [
    { title: 'Warehouse', dataIndex: 'warehouseName', width: 180, render: (v, r) => <><Text strong style={{ color: REDWOOD.info }}>{r.warehouseCode}</Text><br /><Text type="secondary" style={{ fontSize: 11 }}>{v}</Text></> },
    { title: 'Subinventory', dataIndex: 'subinventoryName', width: 200, render: (v, r) => <><Text strong style={{ color: REDWOOD.teal }}>{r.subinventoryCode}</Text><br /><Text type="secondary" style={{ fontSize: 11 }}>{v}</Text></> },
  ];

  return (
    <>
      <Input
        placeholder="Search by warehouse or subinventory..."
        prefix={<SearchOutlined style={{ color: REDWOOD.neutral600 }} />}
        value={search}
        onChange={e => setSearch(e.target.value)}
        allowClear
        style={{ marginBottom: 16, maxWidth: 500 }}
      />
      <Table
        columns={cols}
        dataSource={filtered}
        rowKey="key"
        pagination={{ pageSize: 20, showSizeChanger: true, showQuickJumper: true }}
        size="small"
        scroll={{ x: 600 }}
      />
    </>
  );
};

const Subinventories: React.FC = () => {
  const [rows, setRows] = useState<SubinventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    fetch(`${ORDS_BASE}/inventory/inventorywarehousesubinventory`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => { setRows(Array.isArray(d) ? d : (d.items ?? [])); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

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

  const totalWHs = useMemo(() => { let c = 0; hierarchy.forEach(bu => { c += bu.warehouses.size; }); return c; }, [hierarchy]);
  const totalSubs = useMemo(() => { let c = 0; hierarchy.forEach(bu => { bu.warehouses.forEach(wh => { c += wh.subinventories.length; }); }); return c; }, [hierarchy]);

  const tableData = useMemo(() => {
    const data: SubinventoryData[] = [];
    filteredHierarchy.forEach(bu => {
      bu.warehouses.forEach(wh => {
        wh.subinventories.forEach(s => {
          data.push({
            key: `${wh.code}-${s.code}`,
            warehouseCode: wh.code,
            warehouseName: wh.name,
            subinventoryCode: s.code,
            subinventoryName: s.name,
          });
        });
      });
    });
    return data;
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
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

          {loading && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
              <Spin size="large" />
            </div>
          )}

          {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

          {!loading && !error && (
            <>
              <Row gutter={[12, 12]} style={{ marginBottom: 20 }}>
                {[
                  { label: 'Warehouses', value: totalWHs, color: REDWOOD.info },
                  { label: 'Subinventories', value: totalSubs, color: REDWOOD.teal },
                ].map(kpi => (
                  <Col xs={24} sm={12} key={kpi.label}>
                    <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}`, textAlign: 'center' }} styles={{ body: { padding: '14px 16px' } }}>
                      <Text style={{ fontSize: 28, fontWeight: 700, color: kpi.color, display: 'block' }}>{kpi.value}</Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>{kpi.label}</Text>
                    </Card>
                  </Col>
                ))}
              </Row>

              <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }} styles={{ body: { padding: '16px' } }}>
                <SubinventoriesTable data={tableData} />
              </Card>
            </>
          )}
        </div>
      </Content>
    </Layout>
  );
};

export default Subinventories;
