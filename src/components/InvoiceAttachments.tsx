import React, { useState, useEffect, useCallback } from 'react';
import {
  Table, Button, Upload, Space, Typography, Tooltip, Popconfirm,
  Tag, Progress, Alert, Empty, message,
} from 'antd';
import type { UploadFile, UploadProps } from 'antd';
import {
  UploadOutlined, DownloadOutlined, DeleteOutlined,
  PaperClipOutlined, ReloadOutlined, InboxOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import {
  listAttachments, uploadAttachment, downloadAttachment, deleteAttachment,
  formatFileSize, fileIcon,
  type InvoiceAttachment,
} from '../services/invoiceAttachment.service';
import { useAuth } from '../context/AuthContext';

const { Text } = Typography;
const { Dragger } = Upload;

const MAX_FILE_MB = 10;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

interface Props {
  invoiceId:     number | null | undefined;
  readOnly?:     boolean;
  onCountChange?: (count: number) => void;
}

interface UploadingFile {
  uid:      string;
  name:     string;
  progress: number;
  status:   'uploading' | 'done' | 'error';
  error?:   string;
}

const InvoiceAttachments: React.FC<Props> = ({ invoiceId, readOnly = false, onCountChange }) => {
  const { user } = useAuth();

  const [attachments,  setAttachments]  = useState<InvoiceAttachment[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [fetchError,   setFetchError]   = useState<string | null>(null);
  const [uploading,    setUploading]    = useState<UploadingFile[]>([]);
  const [downloading,  setDownloading]  = useState<Set<number>>(new Set());
  const [deleting,     setDeleting]     = useState<Set<number>>(new Set());

  const load = useCallback(async () => {
    if (!invoiceId) return;
    setLoading(true);
    setFetchError(null);
    try {
      const rows = await listAttachments(invoiceId);
      setAttachments(rows);
      onCountChange?.(rows.length);
    } catch (e: any) {
      setFetchError(e?.message ?? 'Failed to load attachments');
    }
    setLoading(false);
  }, [invoiceId]);

  useEffect(() => { load(); }, [load]);

  // ── Upload handler ───────────────────────────────────────────────────────
  const handleUpload: UploadProps['customRequest'] = async (options) => {
    const file = options.file as File;
    const uid  = (file as any).uid ?? Math.random().toString(36).slice(2);

    if (file.size > MAX_FILE_BYTES) {
      message.error(`"${file.name}" exceeds ${MAX_FILE_MB} MB limit`);
      options.onError?.(new Error('File too large'));
      return;
    }

    setUploading(prev => [...prev, { uid, name: file.name, progress: 10, status: 'uploading' }]);

    // Simulate progress while upload runs
    const progressTimer = setInterval(() => {
      setUploading(prev =>
        prev.map(u => u.uid === uid && u.progress < 85
          ? { ...u, progress: u.progress + 15 }
          : u
        )
      );
    }, 400);

    const result = await uploadAttachment(
      invoiceId!,
      file,
      '',               // description — could be wired to a form later
      user?.name || user?.username || 'System',
    );

    clearInterval(progressTimer);

    if (result.success) {
      setUploading(prev => prev.map(u => u.uid === uid ? { ...u, progress: 100, status: 'done' } : u));
      options.onSuccess?.(result);
      setTimeout(() => setUploading(prev => prev.filter(u => u.uid !== uid)), 1500);
      load();
    } else {
      setUploading(prev => prev.map(u => u.uid === uid
        ? { ...u, status: 'error', error: result.error }
        : u
      ));
      options.onError?.(new Error(result.error));
      message.error(`Upload failed: ${result.error}`);
    }
  };

  // ── Download ─────────────────────────────────────────────────────────────
  const handleDownload = async (rec: InvoiceAttachment) => {
    setDownloading(prev => new Set([...prev, rec.attachmentId]));
    try {
      await downloadAttachment(invoiceId!, rec.attachmentId, rec.fileName);
    } catch (e: any) {
      message.error(`Download failed: ${e?.message}`);
    }
    setDownloading(prev => { const s = new Set(prev); s.delete(rec.attachmentId); return s; });
  };

  // ── Delete ───────────────────────────────────────────────────────────────
  const handleDelete = async (rec: InvoiceAttachment) => {
    setDeleting(prev => new Set([...prev, rec.attachmentId]));
    const result = await deleteAttachment(
      invoiceId!,
      rec.attachmentId,
      user?.name || user?.username || 'System',
    );
    setDeleting(prev => { const s = new Set(prev); s.delete(rec.attachmentId); return s; });
    if (result.success) {
      setAttachments(prev => {
        const next = prev.filter(a => a.attachmentId !== rec.attachmentId);
        onCountChange?.(next.length);
        return next;
      });
      message.success('Attachment deleted');
    } else {
      message.error(`Delete failed: ${result.error}`);
    }
  };

  // ── Table columns ─────────────────────────────────────────────────────────
  const columns: ColumnsType<InvoiceAttachment> = [
    {
      title: '',
      width: 30,
      render: (_, rec) => (
        <span style={{ fontSize: 18, lineHeight: 1 }}>{fileIcon(rec.mimeType)}</span>
      ),
    },
    {
      title: 'File Name',
      dataIndex: 'fileName',
      ellipsis: true,
      render: (name, rec) => (
        <Tooltip title={name}>
          <Button
            type="link"
            size="small"
            style={{ padding: 0, height: 'auto', fontSize: 13 }}
            loading={downloading.has(rec.attachmentId)}
            onClick={() => handleDownload(rec)}
          >
            {name}
          </Button>
        </Tooltip>
      ),
    },
    {
      title:     'Size',
      dataIndex: 'fileSize',
      width:     90,
      render:    (v) => <Text type="secondary" style={{ fontSize: 12 }}>{formatFileSize(v)}</Text>,
    },
    {
      title:  'Type',
      width:  130,
      render: (_, rec) => (
        <Tag style={{ fontSize: 11 }}>{rec.mimeType?.split('/')[1]?.toUpperCase() || '—'}</Tag>
      ),
    },
    {
      title:     'Uploaded By',
      dataIndex: 'uploadedBy',
      width:     120,
      ellipsis:  true,
      render:    (v) => <Text style={{ fontSize: 12 }}>{v || '—'}</Text>,
    },
    {
      title:     'Date',
      dataIndex: 'uploadDate',
      width:     140,
      render:    (v) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {v ? new Date(v).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'}
        </Text>
      ),
    },
    {
      title:  'Actions',
      width:  100,
      render: (_, rec) => (
        <Space size={4}>
          <Tooltip title="Download">
            <Button
              type="text"
              size="small"
              icon={<DownloadOutlined />}
              loading={downloading.has(rec.attachmentId)}
              onClick={() => handleDownload(rec)}
            />
          </Tooltip>
          {!readOnly && (
            <Popconfirm
              title="Delete this attachment?"
              onConfirm={() => handleDelete(rec)}
              okText="Delete"
              okType="danger"
            >
              <Tooltip title="Delete">
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  loading={deleting.has(rec.attachmentId)}
                />
              </Tooltip>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  if (!invoiceId) {
    return (
      <Alert
        type="info"
        showIcon
        message="Save the invoice first to enable attachments"
        style={{ margin: '12px 0' }}
      />
    );
  }

  return (
    <div>
      {/* Upload area */}
      {!readOnly && (
        <div style={{ marginBottom: 16 }}>
          <Dragger
            multiple
            showUploadList={false}
            customRequest={handleUpload}
            accept="*/*"
            style={{ padding: '8px 0' }}
          >
            <p style={{ margin: 0 }}>
              <InboxOutlined style={{ fontSize: 28, color: '#1677ff' }} />
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 13 }}>
              Click or drag files here to upload
            </p>
            <p style={{ margin: 0, fontSize: 11, color: '#999' }}>
              Any file type · Max {MAX_FILE_MB} MB per file
            </p>
          </Dragger>

          {/* Upload progress bars */}
          {uploading.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {uploading.map(u => (
                <div key={u.uid} style={{ marginBottom: 4 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                    <Text ellipsis style={{ maxWidth: 300, fontSize: 12 }}>{u.name}</Text>
                    <Text type={u.status === 'error' ? 'danger' : 'secondary'} style={{ fontSize: 12 }}>
                      {u.status === 'error' ? u.error : u.status === 'done' ? 'Done' : 'Uploading…'}
                    </Text>
                  </div>
                  <Progress
                    percent={u.progress}
                    size="small"
                    status={u.status === 'error' ? 'exception' : u.status === 'done' ? 'success' : 'active'}
                    showInfo={false}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {fetchError && (
        <Alert type="warning" showIcon message={fetchError} style={{ marginBottom: 12 }} />
      )}

      {/* Attachments table */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Space>
          <PaperClipOutlined style={{ color: '#999' }} />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {attachments.length} attachment{attachments.length !== 1 ? 's' : ''}
          </Text>
        </Space>
        <Button size="small" icon={<ReloadOutlined />} onClick={load} loading={loading}>
          Refresh
        </Button>
      </div>

      <Table
        dataSource={attachments}
        columns={columns}
        rowKey="attachmentId"
        size="small"
        loading={loading}
        pagination={false}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No attachments yet"
              style={{ margin: '16px 0' }}
            />
          ),
        }}
      />
    </div>
  );
};

export default InvoiceAttachments;
