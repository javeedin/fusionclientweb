// Purchasing-RR — attachments for a saved document (PO / requisition / receipt).
// ORDS: po/attachments/:entity_type/:entity_id[/:attachment_id] (database/po/304_po_attachments.sql)
import React, { useCallback, useEffect, useState } from 'react';
import { Table, Button, Space, Upload, Input, Typography, Popconfirm, message, Alert, Tooltip } from 'antd';
import { UploadOutlined, DownloadOutlined, DeleteOutlined, ReloadOutlined, PaperClipOutlined } from '@ant-design/icons';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { formatFileSize } from '../../services/invoiceAttachment.service';

const { Text } = Typography;
const BASE = `${APEX_DB_CONFIG.baseUrl.replace(/\/+$/, '')}/po/attachments`;
const MAX_MB = 20;

interface Att { attachmentId: number; fileName: string; fileSize: number | null; mimeType: string | null;
  description: string | null; uploadedBy: string | null; uploadDate: string }

const toBase64 = (f: File) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = rej;
  r.readAsDataURL(f);
});

const PoAttachments: React.FC<{ entityType: 'PO' | 'REQ' | 'RCV'; entityId: number; user: string; readOnly?: boolean }> =
  ({ entityType, entityId, user, readOnly }) => {
    const [rows, setRows] = useState<Att[]>([]);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [desc, setDesc] = useState('');
    const [err, setErr] = useState<string | null>(null);
    const url = `${BASE}/${entityType}/${entityId}`;

    const load = useCallback(async () => {
      setLoading(true); setErr(null);
      try {
        const res = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
        const text = await res.text();
        let data: any = null; try { data = JSON.parse(text); } catch { /* html */ }
        if (!res.ok || !data) throw new Error(res.status === 404 ? 'Attachments service not deployed — run database/po/304_po_attachments.sql' : data?.error || `HTTP ${res.status}`);
        setRows(data.attachments || []);
      } catch (e: any) { setErr(e.message); } finally { setLoading(false); }
    }, [url]);
    useEffect(() => { load(); }, [load]);

    const upload = async (file: File) => {
      if (file.size > MAX_MB * 1024 * 1024) { message.error(`${file.name} is larger than ${MAX_MB} MB`); return; }
      setBusy(true);
      try {
        const res = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ fileName: file.name, mimeType: file.type || 'application/octet-stream', fileSize: file.size,
            fileContent: await toBase64(file), description: desc || null, uploadedBy: user }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
        message.success(`${file.name} attached`);
        setDesc('');
        load();
      } catch (e: any) { message.error(`Upload failed: ${e.message}`); } finally { setBusy(false); }
    };

    const download = async (a: Att) => {
      try {
        const res = await fetch(`${url}/${a.attachmentId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const href = URL.createObjectURL(blob);
        const el = document.createElement('a');
        el.href = href; el.download = a.fileName; document.body.appendChild(el); el.click(); el.remove();
        setTimeout(() => URL.revokeObjectURL(href), 5000);
      } catch (e: any) { message.error(`Download failed: ${e.message}`); }
    };

    const remove = async (a: Att) => {
      try {
        const res = await fetch(`${url}/${a.attachmentId}?deleted_by=${encodeURIComponent(user)}`, { method: 'DELETE' });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) throw new Error(data?.error || `HTTP ${res.status}`);
        message.success('Attachment removed');
        load();
      } catch (e: any) { message.error(e.message); }
    };

    return (
      <div>
        {err && <Alert type="warning" showIcon style={{ marginBottom: 8 }} message={err} />}
        {!readOnly && (
          <Space wrap style={{ marginBottom: 10 }}>
            <Input placeholder="Description (optional)" value={desc} onChange={e => setDesc(e.target.value)} style={{ width: 280 }} />
            <Upload multiple showUploadList={false} beforeUpload={f => { upload(f as File); return false; }}>
              <Button type="primary" icon={<UploadOutlined />} loading={busy}>Attach files</Button>
            </Upload>
            <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
            <Text type="secondary">Quotations, contracts, delivery notes… up to {MAX_MB} MB each</Text>
          </Space>
        )}
        <Table<Att> size="small" rowKey="attachmentId" loading={loading} dataSource={rows} pagination={false}
          locale={{ emptyText: 'No attachments yet' }}
          columns={[
            { title: 'File', dataIndex: 'fileName', render: (v, a) => <a onClick={() => download(a)}><PaperClipOutlined /> {v}</a> },
            { title: 'Description', dataIndex: 'description', ellipsis: true },
            { title: 'Size', dataIndex: 'fileSize', width: 100, render: v => formatFileSize(v) },
            { title: 'Uploaded by', dataIndex: 'uploadedBy', width: 140 },
            { title: 'Date', dataIndex: 'uploadDate', width: 150, render: v => String(v || '').replace('T', ' ').slice(0, 16) },
            { title: '', width: 90, render: (_, a) => (
              <Space size={0}>
                <Tooltip title="Download"><Button size="small" type="text" icon={<DownloadOutlined />} onClick={() => download(a)} /></Tooltip>
                {!readOnly && <Popconfirm title="Remove this attachment?" onConfirm={() => remove(a)}>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} /></Popconfirm>}
              </Space>) },
          ]} />
      </div>
    );
  };

export default PoAttachments;
