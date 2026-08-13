import React, { useState, useEffect } from 'react';
import { Layout, Card, Table, Typography, Breadcrumb, Tag, Input, Space } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { HomeOutlined, SearchOutlined, ScheduleOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { getMethods } from '../../../services/fa.service';
import type { MethodRecord } from '../../../services/fa.service';

const { Content } = Layout;
const { Text, Title } = Typography;

const REDWOOD = {
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', surface: '#FFFFFF',
};
const FA_COLOR = '#CA7700';

const DeprnMethods: React.FC = () => {
  const [rows,    setRows]    = useState<MethodRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('');

  useEffect(() => {
    getMethods().then(d => { setRows(d); setLoading(false); });
  }, []);

  const filtered = rows.filter(r =>
    !filter ||
    r.methodCode?.toLowerCase().includes(filter.toLowerCase()) ||
    r.name?.toLowerCase().includes(filter.toLowerCase())
  );

  const columns: ColumnsType<MethodRecord> = [
    { title: 'ID',          dataIndex: 'methodId',        key: 'id',     width: 80  },
    { title: 'Code',        dataIndex: 'methodCode',      key: 'code',   width: 160 },
    { title: 'Name',        dataIndex: 'name',            key: 'name',   ellipsis: true },
    { title: 'Life (Mths)', dataIndex: 'lifeInMonths',    key: 'life',   width: 110, align: 'right' as const },
    { title: 'STL',         dataIndex: 'stlMethodFlag',   key: 'stl',    width: 70,
      render: (v) => <Tag color={v === 'YES' ? 'blue' : 'default'} style={{ borderRadius: 4, fontSize: 11 }}>{v || '—'}</Tag> },
    { title: 'Rate Source',  dataIndex: 'rateSourceRule',  key: 'rsr',   width: 140 },
    { title: 'Deprn Basis',  dataIndex: 'deprnBasisRule',  key: 'dbr',   width: 140 },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '16px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/fa">Fixed Assets</Link> },
            { title: 'Depreciation Methods' },
          ]} />
        </div>
        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Space align="center">
              <div style={{ width: 44, height: 44, borderRadius: 10,
                background: `linear-gradient(135deg, ${FA_COLOR} 0%, #9E5C00 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ScheduleOutlined style={{ fontSize: 22, color: '#fff' }} />
              </div>
              <div>
                <Title level={4} style={{ margin: 0 }}>Depreciation Methods</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>Methods used to calculate asset depreciation</Text>
              </div>
            </Space>
            <Input placeholder="Search methods…" allowClear prefix={<SearchOutlined />}
              style={{ width: 240 }} value={filter} onChange={e => setFilter(e.target.value)} />
          </div>
          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }} bodyStyle={{ padding: 0 }}>
            <Table<MethodRecord>
              dataSource={filtered} columns={columns} rowKey="methodId"
              loading={loading} size="small" pagination={{ pageSize: 50, showTotal: t => `${t} methods` }}
              locale={{ emptyText: 'No methods found' }}
            />
          </Card>
        </div>
      </Content>
      
    </Layout>
  );
};

export default DeprnMethods;
