import React, { useState, useEffect } from 'react';
import { Layout, Card, Table, Typography, Breadcrumb, Tag, Input, Space } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { HomeOutlined, SearchOutlined, FileTextOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { getBookControls } from '../../../services/fa.service';
import type { BookControlRecord } from '../../../services/fa.service';

const { Content } = Layout;
const { Text, Title } = Typography;

const REDWOOD = {
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', surface: '#FFFFFF', success: '#1D7B4D',
};
const FA_COLOR = '#CA7700';

const bookClassColor: Record<string, string> = {
  CORPORATE: '#0572CE',
  TAX:       '#D4A800',
  BUDGET:    '#1D7B4D',
};

const BookControls: React.FC = () => {
  const [rows,    setRows]    = useState<BookControlRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('');

  useEffect(() => {
    getBookControls().then(d => { setRows(d); setLoading(false); });
  }, []);

  const filtered = rows.filter(r =>
    !filter ||
    r.bookTypeCode?.toLowerCase().includes(filter.toLowerCase()) ||
    r.bookTypeName?.toLowerCase().includes(filter.toLowerCase())
  );

  const columns: ColumnsType<BookControlRecord> = [
    { title: 'Book Type Code', dataIndex: 'bookTypeCode',       key: 'code',  width: 200 },
    { title: 'Book Type Name', dataIndex: 'bookTypeName',       key: 'name',  ellipsis: true },
    { title: 'Class',          dataIndex: 'bookClass',          key: 'class', width: 120,
      render: (v) => (
        <Tag style={{
          borderRadius: 4, fontSize: 11,
          background: `${bookClassColor[v] || FA_COLOR}20`,
          color: bookClassColor[v] || FA_COLOR,
          border: `1px solid ${bookClassColor[v] || FA_COLOR}40`,
        }}>{v || '—'}</Tag>
      ),
    },
    { title: 'Deprn Calendar', dataIndex: 'deprnCalendar',      key: 'cal',   width: 160 },
    { title: 'Fiscal Year',    dataIndex: 'fiscalYearName',     key: 'fy',    width: 130 },
    { title: 'Current FY',     dataIndex: 'currentFiscalYear',  key: 'cfy',   width: 100 },
    { title: 'Deprn Status',   dataIndex: 'deprnStatus',        key: 'status',width: 130,
      render: (v) => (
        <Tag color={v === 'RUNNING' ? 'processing' : v === 'IDLE' ? 'success' : 'default'}
          style={{ borderRadius: 4, fontSize: 11 }}>{v || '—'}</Tag>
      ),
    },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        <div style={{ padding: '16px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/fa">Fixed Assets</Link> },
            { title: 'Book Controls' },
          ]} />
        </div>
        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Space align="center">
              <div style={{ width: 44, height: 44, borderRadius: 10,
                background: `linear-gradient(135deg, ${FA_COLOR} 0%, #9E5C00 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <FileTextOutlined style={{ fontSize: 22, color: '#fff' }} />
              </div>
              <div>
                <Title level={4} style={{ margin: 0 }}>Book Controls</Title>
                <Text type="secondary" style={{ fontSize: 12 }}>Corporate, tax, and budget book configurations</Text>
              </div>
            </Space>
            <Input placeholder="Search books…" allowClear prefix={<SearchOutlined />}
              style={{ width: 240 }} value={filter} onChange={e => setFilter(e.target.value)} />
          </div>
          <Card style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }} bodyStyle={{ padding: 0 }}>
            <Table<BookControlRecord>
              dataSource={filtered} columns={columns} rowKey="bookTypeCode"
              loading={loading} size="small" pagination={{ pageSize: 50, showTotal: t => `${t} books` }}
              locale={{ emptyText: 'No book controls found' }}
            />
          </Card>
        </div>
      </Content>
      
    </Layout>
  );
};

export default BookControls;
