import React from 'react';
import { Layout, Breadcrumb, Typography, Card, Empty } from 'antd';
import { HomeOutlined, TagsOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';

const { Content } = Layout;
const { Title, Text } = Typography;

const REDWOOD = {
  primary: '#C74634', info: '#0572CE',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', surface: '#FFFFFF',
};

// Placeholder — the Price List web service / layout is not yet specified.
const PriceList: React.FC = () => (
  <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
    <Content>
      <div style={{ padding: '12px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
        <Breadcrumb items={[
          { title: <Link to="/home"><HomeOutlined /> Home</Link> },
          { title: <Link to="/procurement">Procurement</Link> },
          { title: 'Price List' },
        ]} />
        <Title level={4} style={{ margin: '8px 0 0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <TagsOutlined style={{ color: REDWOOD.primary }} /> Price List
          <Text type="secondary" style={{ fontSize: 13, fontWeight: 400 }}>— price lists (coming soon)</Text>
        </Title>
      </div>
      <div style={{ padding: 20 }}>
        <Card style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
          <Empty description={
            <span>Price List is not configured yet. Share the Fusion price-list web service and the columns you want, and this page will be built out.</span>
          } />
        </Card>
      </div>
    </Content>
  </Layout>
);

export default PriceList;
