import React, { useState, useEffect, useMemo } from 'react';
import { Layout, Typography, Breadcrumb, Input, Select, Card, Tag, Button, Modal, Space, Tooltip, Empty, Spin, Popconfirm, message, Badge } from 'antd';
import {
  HomeOutlined, VideoCameraOutlined, SearchOutlined, PlayCircleOutlined,
  DeleteOutlined, FolderOpenOutlined, ClockCircleOutlined, CalendarOutlined,
  UserOutlined, TagOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;

const REDWOOD = {
  primary: '#C74634', success: '#1D7B4D', info: '#0572CE',
  neutral100: '#F7F7F7', neutral200: '#E5E5E5', neutral600: '#6B6B6B',
  surface: '#FFFFFF',
};

const CATEGORIES = ['All', 'General', 'AP - Payables', 'GL - General Ledger', 'Cash Management', 'Suppliers', 'Reports', 'System'];

const CATEGORY_COLORS: Record<string, string> = {
  'AP - Payables': 'red', 'GL - General Ledger': 'blue', 'Cash Management': 'green',
  'Suppliers': 'purple', 'Reports': 'orange', 'System': 'cyan', 'General': 'default',
};

const isElectron = () => !!(window as any).electronAPI?.isElectron;

const formatTime = (s: number) =>
  `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

const formatSize = (bytes: number) => {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

interface Recording {
  id: string;
  title: string;
  description: string;
  category: string;
  filePath: string;
  fileName: string;
  duration: number;
  fileSize: number;
  createdAt: string;
  createdBy: string;
}

const TrainingModule: React.FC = () => {
  const [recordings, setRecordings]       = useState<Recording[]>([]);
  const [loading, setLoading]             = useState(true);
  const [search, setSearch]               = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [playerUrl, setPlayerUrl]         = useState<string | null>(null);
  const [playerTitle, setPlayerTitle]     = useState('');
  const [playerVisible, setPlayerVisible] = useState(false);

  const load = async () => {
    if (!isElectron()) { setLoading(false); return; }
    setLoading(true);
    try {
      const data = await (window as any).electronAPI.listRecordings();
      setRecordings(data || []);
    } catch {
      message.error('Could not load recordings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => recordings.filter(r => {
    const matchSearch = !search || r.title.toLowerCase().includes(search.toLowerCase()) || r.description?.toLowerCase().includes(search.toLowerCase());
    const matchCat = categoryFilter === 'All' || r.category === categoryFilter;
    return matchSearch && matchCat;
  }), [recordings, search, categoryFilter]);

  const playRecording = async (rec: Recording) => {
    try {
      const url = isElectron()
        ? await (window as any).electronAPI.getFileUrl(rec.filePath)
        : rec.filePath;
      setPlayerUrl(url);
      setPlayerTitle(rec.title);
      setPlayerVisible(true);
    } catch {
      message.error('Could not open video');
    }
  };

  const deleteRecording = async (rec: Recording) => {
    try {
      const result = await (window as any).electronAPI.deleteRecording(rec.id, rec.filePath);
      if (result.success) {
        message.success('Recording deleted');
        load();
      } else {
        message.error('Delete failed');
      }
    } catch {
      message.error('Delete failed');
    }
  };

  const openFolder = async () => {
    if (isElectron()) await (window as any).electronAPI.openRecordingsFolder();
  };

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb */}
        <div style={{ padding: '16px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: 'Training Library' },
          ]} />
        </div>

        <div style={{ padding: 24, paddingRight: 96 }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <Space align="center" size={14}>
              <div style={{
                width: 52, height: 52, borderRadius: 12,
                background: `linear-gradient(135deg, ${REDWOOD.primary} 0%, #8B1A0E 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: `0 4px 14px ${REDWOOD.primary}40`,
              }}>
                <VideoCameraOutlined style={{ fontSize: 26, color: '#fff' }} />
              </div>
              <div>
                <Title level={3} style={{ margin: 0 }}>Training Library</Title>
                <Text type="secondary">Screen recordings for user manuals and UAT scripts</Text>
              </div>
            </Space>
            <Space>
              <Button icon={<FolderOpenOutlined />} onClick={openFolder} disabled={!isElectron()}>
                Open Folder
              </Button>
              <Button icon={<VideoCameraOutlined />} onClick={load}>Refresh</Button>
            </Space>
          </div>

          {/* Filters */}
          <Card style={{ marginBottom: 20, borderRadius: 10, border: `1px solid ${REDWOOD.neutral200}` }} styles={{ body: { padding: '14px 16px' } }}>
            <Space wrap>
              <Input
                prefix={<SearchOutlined style={{ color: REDWOOD.neutral600 }} />}
                placeholder="Search recordings..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                allowClear
                style={{ width: 260 }}
              />
              <Select value={categoryFilter} onChange={setCategoryFilter} style={{ width: 200 }}>
                {CATEGORIES.map(c => <Option key={c} value={c}>{c}</Option>)}
              </Select>
              <Text type="secondary" style={{ fontSize: 13 }}>
                {filtered.length} of {recordings.length} recording{recordings.length !== 1 ? 's' : ''}
              </Text>
            </Space>
          </Card>

          {/* Grid */}
          <Spin spinning={loading}>
            {!isElectron() ? (
              <Empty description="Training Library is only available in the desktop app" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ padding: 60 }} />
            ) : filtered.length === 0 && !loading ? (
              <Empty
                image={<VideoCameraOutlined style={{ fontSize: 64, color: REDWOOD.neutral600 }} />}
                description={
                  recordings.length === 0
                    ? <span>No recordings yet.<br />Use the <VideoCameraOutlined /> button in the toolbar to record your screen.</span>
                    : 'No recordings match your search'
                }
                style={{ padding: 60 }}
              />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
                {filtered.map(rec => (
                  <Card
                    key={rec.id}
                    hoverable
                    style={{ borderRadius: 10, border: `1px solid ${REDWOOD.neutral200}`, overflow: 'hidden' }}
                    styles={{ body: { padding: 0 } }}
                  >
                    {/* Thumbnail / play area */}
                    <div
                      onClick={() => playRecording(rec)}
                      style={{
                        height: 160, background: '#1a1a2e', display: 'flex', alignItems: 'center',
                        justifyContent: 'center', cursor: 'pointer', position: 'relative',
                      }}
                    >
                      <div style={{
                        width: 56, height: 56, borderRadius: '50%',
                        background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(4px)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'background 0.2s',
                      }}>
                        <PlayCircleOutlined style={{ fontSize: 32, color: '#fff' }} />
                      </div>
                      {rec.duration > 0 && (
                        <div style={{
                          position: 'absolute', bottom: 8, right: 10,
                          background: 'rgba(0,0,0,0.7)', color: '#fff',
                          fontSize: 12, padding: '2px 7px', borderRadius: 4, fontWeight: 600,
                        }}>
                          {formatTime(rec.duration)}
                        </div>
                      )}
                      <Tag color={CATEGORY_COLORS[rec.category] || 'default'} style={{ position: 'absolute', top: 8, left: 10 }}>
                        {rec.category}
                      </Tag>
                    </div>

                    {/* Info */}
                    <div style={{ padding: '12px 14px' }}>
                      <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 4 }} ellipsis title={rec.title}>
                        {rec.title}
                      </Text>
                      {rec.description && (
                        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }} ellipsis title={rec.description}>
                          {rec.description}
                        </Text>
                      )}
                      <Space size={12} style={{ fontSize: 11, color: REDWOOD.neutral600, flexWrap: 'wrap' }}>
                        <span><CalendarOutlined /> {rec.createdAt?.slice(0, 10)}</span>
                        {rec.fileSize > 0 && <span>{formatSize(rec.fileSize)}</span>}
                        {rec.createdBy && <span><UserOutlined /> {rec.createdBy}</span>}
                      </Space>
                    </div>

                    {/* Actions */}
                    <div style={{ borderTop: `1px solid ${REDWOOD.neutral200}`, padding: '8px 14px', display: 'flex', justifyContent: 'space-between' }}>
                      <Button
                        type="primary"
                        size="small"
                        icon={<PlayCircleOutlined />}
                        onClick={() => playRecording(rec)}
                        style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
                      >
                        Play
                      </Button>
                      <Popconfirm
                        title="Delete this recording?"
                        description="The video file will also be deleted from disk."
                        onConfirm={() => deleteRecording(rec)}
                        okText="Delete"
                        okButtonProps={{ danger: true }}
                      >
                        <Tooltip title="Delete recording">
                          <Button size="small" danger icon={<DeleteOutlined />} />
                        </Tooltip>
                      </Popconfirm>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </Spin>
        </div>
      </Content>

      {/* Video player modal */}
      <Modal
        title={<Space><PlayCircleOutlined style={{ color: REDWOOD.primary }} />{playerTitle}</Space>}
        open={playerVisible}
        onCancel={() => { setPlayerVisible(false); setPlayerUrl(null); }}
        footer={<Button onClick={() => { setPlayerVisible(false); setPlayerUrl(null); }}>Close</Button>}
        width={900}
        styles={{ body: { padding: '12px 0 0', background: '#000' } }}
      >
        {playerUrl && (
          <video
            src={playerUrl}
            controls
            autoPlay
            style={{ width: '100%', display: 'block', maxHeight: '70vh', background: '#000' }}
          />
        )}
      </Modal>
    </Layout>
  );
};

export default TrainingModule;
