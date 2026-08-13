import React, { useState, useEffect } from 'react';
import { Layout, Card, Table, Typography, Breadcrumb, Tag, Input, Space } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { HomeOutlined, SearchOutlined, TagOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { getCategories } from '../../../services/fa.service';
import type { CategoryRecord } from '../../../services/fa.service';

const { Content } = Layout;
const { Text, Title } = Typography;

const REDWOOD = {
  neutral100: '#F7F7F7', neutral200: '#E5E5E5',
  neutral900: '#1A1A1A', surface: '#FFFFFF',
};
const FA_COLOR = '#CA7700';

const AssetCategories: React.FC = () => {
  const [rows,    setRows]    = useState<CategoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('');

  useEffect(() => {
    getCategories().then(d => { setRows(d); setLoading(false); });
  }, []);

  const filtered = rows.filter(r =>
    !filter ||
    r.segment1?.toLowerCase().includes(filter.toLowerCase()) ||
    r.segment2?.toLowerCase().includes(filter.toLowerCase()) ||
    r.description?.toLowerCase().includes(filter.toLowerCase())
  );

  const columns: ColumnsType<CategoryRecord> = [
    { title: 'ID',          dataIndex: 'categoryId',    key: 'id',   width: 80  },
    { title: 'Segment 1',   dataIndex: 'segment1',      key: 'seg1', width: 150 },
    { title: 'Segment 2',   dataIndex: 'segment2',      key: 'seg2', width: 150 },
    { title: 'Description', dataIndex: 'description',   key: 'desc', ellipsis: true },
    { title: 'Type',        dataIndex: 'categoryType',  key: 'type', width: 120,
      render: (v) => v ? <Tag style={{ borderRadius: 4, fontSize: 11 }}>{v}</Tag> : '—' },
    { title: 'Owned/Leased',dataIndex: 'ownedLeased',   key: 'ol',   width: 110 },
    { title: 'Capitalize',  dataIndex: 'capitalizeFlag',key: 'cap',  width: 90,
      render: (v) => <Tag color={v === 'YES' ? 'success' : 'default'} style={{ borderRadius: 4, fontSize: 11 }}>{v}</Tag> },
    { title: 'Enabled',     dataIndex: 'enabledFlag',   key: 'en',   width: 80,
      render: (v) => <Tag color={v === 'Y' ? 'success' : 'default'} style={{ borderRadius: 4, fontSize: 11 }}>{v}</Tag> },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '16px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/fa">Fixed Assets</Link> },
            { title: 'Asset Categories' },
          ]} />
        </div>
        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Space align="center">
              <div style={{ width: 44, height: 44, borderRadius: 10,
                background: `linear-gradient(135deg, ${FA_COLOR} 0%, #9E5C00 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <TagOutlined style={{ fontSize: 22, color: '#fff' }} />
              </div>
              <div>
                <Title level={4} style={{ margin: 0 }}>Asset Categories</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>Category segments used to classify assets</Text>
              </div>
            </Space>
            <Input placeholder="Search categories…" allowClear prefix={<SearchOutlined />}
              style={{ width: 240 }} value={filter} onChange={e => setFilter(e.target.value)} />
          </div>
          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }} bodyStyle={{ padding: 0 }}>
            <Table<CategoryRecord>
              dataSource={filtered} columns={columns} rowKey="categoryId"
              loading={loading} size="small" pagination={{ pageSize: 50, showTotal: t => `${t} categories` }}
              locale={{ emptyText: 'No categories found' }}
            />
          </Card>
        </div>
      </Content>
      
    </Layout>
  );
};

export default AssetCategories;
