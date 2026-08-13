import React, { useState } from 'react';
import { Modal, Card, Button, Space, Typography, Tag } from 'antd';
import { PlayCircleOutlined, BookOutlined } from '@ant-design/icons';
import { useShowAndTell } from './ShowAndTellContext';
import { createInvoiceTour } from './tours/createInvoice';
import type { Tour } from './ShowAndTellContext';

const { Text, Title } = Typography;

const ALL_TOURS: Tour[] = [
  createInvoiceTour,
  // Add more tours here as they are built
];

const CARD_COLORS: Record<string, string> = {
  'create-invoice': '#e3f2fd',
};

interface Props {
  open: boolean;
  onClose: () => void;
}

export const ShowAndTellPanel: React.FC<Props> = ({ open, onClose }) => {
  const { startTour } = useShowAndTell();
  const [hovered, setHovered] = useState<string | null>(null);

  const handleStart = (tour: Tour) => {
    onClose();
    setTimeout(() => startTour(tour), 200);
  };

  return (
    <Modal
      title={
        <Space>
          <BookOutlined style={{ color: '#1677ff', fontSize: 18 }} />
          <Title level={5} style={{ margin: 0 }}>Show & Tell</Title>
          <Tag color="blue" style={{ fontSize: 11, fontWeight: 600 }}>Interactive Tours</Tag>
        </Space>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      width={680}
    >
      <Text type="secondary" style={{ display: 'block', marginBottom: 20, fontSize: 13 }}>
        Step-by-step guided walkthroughs of key features. Each tour navigates to the screen, fills in demo data, and explains every action with sticky notes.
      </Text>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {ALL_TOURS.map(tour => (
          <Card
            key={tour.id}
            hoverable
            onMouseEnter={() => setHovered(tour.id)}
            onMouseLeave={() => setHovered(null)}
            style={{
              background:   CARD_COLORS[tour.id] ?? '#f9f9f9',
              border:       `1px solid ${hovered === tour.id ? '#1677ff' : '#e8e8e8'}`,
              borderRadius: 10,
              transition:   'border-color 0.2s, box-shadow 0.2s',
              boxShadow:    hovered === tour.id ? '0 4px 16px rgba(22,119,255,0.15)' : 'none',
              cursor:       'pointer',
            }}
            styles={{ body: { padding: 16 } }}
            onClick={() => handleStart(tour)}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>{tour.icon}</div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4, color: '#1a1a1a' }}>
              {tour.title}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {tour.description}
            </Text>
            <div style={{ marginTop: 12 }}>
              <Button
                type="primary"
                size="small"
                icon={<PlayCircleOutlined />}
                style={{ fontSize: 12 }}
              >
                Start Tour
              </Button>
              <Tag style={{ marginLeft: 8, fontSize: 10 }}>
                {tour.steps.length} steps
              </Tag>
            </div>
          </Card>
        ))}

        {/* Placeholder cards for upcoming tours */}
        {['Pay in Full', 'Create Payment', 'Manage Installments'].map(name => (
          <Card
            key={name}
            style={{
              background: '#fafafa',
              border: '1px dashed #d9d9d9',
              borderRadius: 10,
            }}
            styles={{ body: { padding: 16 } }}
          >
            <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.4 }}>🔜</div>
            <div style={{ fontWeight: 600, fontSize: 14, color: '#999', marginBottom: 4 }}>
              {name}
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>Coming soon</Text>
          </Card>
        ))}
      </div>
    </Modal>
  );
};
