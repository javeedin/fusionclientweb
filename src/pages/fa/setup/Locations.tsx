import React, { useState, useEffect } from 'react';
import { Layout, Card, Table, Typography, Breadcrumb, Input, Space } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { HomeOutlined, SearchOutlined, EnvironmentOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { getLocations } from '../../../services/fa.service';
import type { LocationRecord } from '../../../services/fa.service';

const { Content } = Layout;
const { Text, Title } = Typography;

const REDWOOD = {
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', surface: '#FFFFFF',
};
const FA_COLOR = '#CA7700';

const Locations: React.FC = () => {
  const [rows,    setRows]    = useState<LocationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('');

  useEffect(() => {
    getLocations().then(d => { setRows(d); setLoading(false); });
  }, []);

  const filtered = rows.filter(r =>
    !filter || r.fullLocation?.toLowerCase().includes(filter.toLowerCase())
  );

  const columns: ColumnsType<LocationRecord> = [
    { title: 'ID',           dataIndex: 'locationId', key: 'id',   width: 80  },
    { title: 'Segment 1',    dataIndex: 'segment1',   key: 'seg1', width: 140 },
    { title: 'Segment 2',    dataIndex: 'segment2',   key: 'seg2', width: 140 },
    { title: 'Segment 3',    dataIndex: 'segment3',   key: 'seg3', width: 140 },
    { title: 'Segment 4',    dataIndex: 'segment4',   key: 'seg4', width: 140 },
    { title: 'Full Location',dataIndex: 'fullLocation',key: 'full', ellipsis: true },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '16px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/fa">Fixed Assets</Link> },
            { title: 'Locations' },
          ]} />
        </div>
        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Space align="center">
              <div style={{ width: 44, height: 44, borderRadius: 10,
                background: `linear-gradient(135deg, ${FA_COLOR} 0%, #9E5C00 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <EnvironmentOutlined style={{ fontSize: 22, color: '#fff' }} />
              </div>
              <div>
                <Title level={4} style={{ margin: 0 }}>Asset Locations</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>Physical location segments for asset distribution</Text>
              </div>
            </Space>
            <Input placeholder="Search locations…" allowClear prefix={<SearchOutlined />}
              style={{ width: 240 }} value={filter} onChange={e => setFilter(e.target.value)} />
          </div>
          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }} bodyStyle={{ padding: 0 }}>
            <Table<LocationRecord>
              dataSource={filtered} columns={columns} rowKey="locationId"
              loading={loading} size="small" pagination={{ pageSize: 50, showTotal: t => `${t} locations` }}
              locale={{ emptyText: 'No locations found' }}
            />
          </Card>
        </div>
      </Content>
      
    </Layout>
  );
};

export default Locations;
