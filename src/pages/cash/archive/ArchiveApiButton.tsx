// Cash Management — API button for the archive screens: checks that the web services exist
// (cash/execute, archive tables, registered procedures, account analysis) and lists every call
// with its URL, request body and response.
import React, { useEffect, useState } from 'react';
import { Alert, Badge, Button, Collapse, Drawer, Empty, Segmented, Space, Spin, Tag, Tooltip, Typography, message } from 'antd';
import { ApiOutlined, CheckCircleFilled, CloseCircleFilled, CopyOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  ArchiveApiCall, ServiceCheck, apexBase, checkArchiveServices, clearArchiveApiLog, getArchiveApiLog, onArchiveApiLog,
} from '../../../services/cmArchive.service';

const { Text } = Typography;
const pretty = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const copy = (t: string) => { navigator.clipboard?.writeText(t).then(() => message.success('Copied'), () => message.error('Copy failed')); };
const curlOf = (c: ArchiveApiCall) => (c.method === 'GET'
  ? `curl '${c.url}'`
  : `curl -X ${c.method} '${c.url}' -H 'Content-Type: application/json' -d '${JSON.stringify(c.body).replace(/'/g, "'\\''")}'`);
const short = (url: string) => url.replace(/^.*?\/(?=(ai|cash|gl)\/)/, '');

export const ArchiveApiButton: React.FC<{ size?: 'small' | 'middle'; /** change the number to open the drawer */ openSignal?: number }> = ({ size, openSignal }) => {
  const [open, setOpen] = useState(false);
  const [, force] = useState(0);
  const [filter, setFilter] = useState<'ALL' | 'SAVES' | 'ERRORS'>('ALL');
  const [checks, setChecks] = useState<ServiceCheck[] | null>(null);
  const [checking, setChecking] = useState(false);
  useEffect(() => onArchiveApiLog(() => force(x => x + 1)), []);
  useEffect(() => { if (openSignal) setOpen(true); }, [openSignal]);
  const runChecks = async () => {
    setChecking(true);
    try { setChecks(await checkArchiveServices()); } finally { setChecking(false); }
  };
  useEffect(() => { if (open && !checks && !checking) runChecks(); }, [open]);   // eslint-disable-line react-hooks/exhaustive-deps

  const log = getArchiveApiLog();
  const errors = log.filter(c => !c.ok).length;
  const shown = log.filter(c => filter === 'ALL' || (filter === 'ERRORS' ? !c.ok : c.url.includes('/cash/execute')));
  const failed = checks?.filter(c => c.ok === false) || [];

  return (
    <>
      <Tooltip title="API — check the web services and see each call with its request and response">
        <Badge count={errors} size="small" offset={[-4, 4]}>
          <Button size={size} icon={<ApiOutlined />} onClick={() => setOpen(true)} style={{ color: '#0572CE', borderColor: '#0572CE' }}>API</Button>
        </Badge>
      </Tooltip>
      <Drawer open={open} onClose={() => setOpen(false)} width={860} destroyOnHidden={false}
        title={<Space><ApiOutlined />Archive web services <Text type="secondary" style={{ fontSize: 12 }}>{apexBase()}</Text></Space>}>
        {/* ── service check ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text strong>Web services</Text>
          <Button size="small" icon={<ReloadOutlined />} loading={checking} onClick={runChecks}>Check again</Button>
        </div>
        <Spin spinning={checking}>
          {checks?.map(c => (
            <div key={c.key} style={{ border: `1px solid ${c.ok ? '#b7eb8f' : '#ffa39e'}`, background: c.ok ? '#f6ffed' : '#fff1f0', borderRadius: 8, padding: '8px 10px', marginBottom: 6 }}>
              <Space align="start" style={{ width: '100%' }}>
                {c.ok ? <CheckCircleFilled style={{ color: '#52c41a', marginTop: 3 }} /> : <CloseCircleFilled style={{ color: '#ff4d4f', marginTop: 3 }} />}
                <div style={{ minWidth: 0 }}>
                  <Text strong style={{ fontSize: 13 }}>{c.name}</Text>
                  <div style={{ fontSize: 12 }}>{c.detail}</div>
                  <Text copyable={{ text: c.url }} type="secondary" style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all' }}>{c.url}</Text>
                  {c.fix && <div style={{ fontSize: 12, marginTop: 4 }}><Tag color="red" style={{ marginRight: 6 }}>Fix</Tag>{c.fix}</div>}
                </div>
              </Space>
            </div>
          ))}
          {!checks && !checking && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Not checked yet" />}
        </Spin>
        {failed.some(c => c.key === 'execute') && (
          <Alert type="warning" showIcon style={{ margin: '8px 0' }} message="cash/execute is missing, so Archive and Save cannot work yet"
            description={<span>Run <code>database/cash/169_cm_execute.sql</code> and then <code>database/cash/170_cm_archive_bank_statements.sql</code> in your
              database as the schema owner, then click <b>Check again</b>.</span>} />
        )}

        {/* ── calls ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '14px 0 8px' }}>
          <Space><Text strong>Calls</Text><Text type="secondary" style={{ fontSize: 12 }}>(last {log.length}, newest first)</Text></Space>
          <Space>
            <Segmented size="small" value={filter} onChange={v => setFilter(v as typeof filter)}
              options={[{ value: 'ALL', label: 'All' }, { value: 'SAVES', label: 'cash/execute' }, { value: 'ERRORS', label: `Errors (${errors})` }]} />
            <Button size="small" onClick={() => clearArchiveApiLog()}>Clear</Button>
          </Space>
        </div>
        {!shown.length && <Empty description="No calls yet" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        <Collapse size="small" accordion items={shown.map(c => ({
          key: c.id,
          label: (
            <Space size={6} wrap>
              <Tag color={c.ok ? 'green' : 'red'} style={{ marginInlineEnd: 0 }}>{c.status ?? 'ERR'}</Tag>
              <Tag color="blue" style={{ marginInlineEnd: 0 }}>{c.method}</Tag>
              <Text code style={{ fontSize: 12 }}>{short(c.url).slice(0, 70)}</Text>
              <Text strong style={{ fontSize: 12 }}>{c.label}</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>{c.at.slice(11, 19)} · {c.ms} ms</Text>
            </Space>
          ),
          children: (
            <div>
              <Space style={{ marginBottom: 6 }} wrap>
                <Text strong>URL</Text>
                <Text copyable style={{ fontFamily: 'monospace', fontSize: 12, wordBreak: 'break-all' }}>{c.url}</Text>
              </Space>
              {c.body != null && <>
                <Space style={{ marginBottom: 6 }}>
                  <Text strong>Request body</Text>
                  <Button size="small" icon={<CopyOutlined />} onClick={() => copy(pretty(c.body))}>Copy body</Button>
                  <Button size="small" onClick={() => copy(curlOf(c))}>Copy as curl</Button>
                </Space>
                <pre style={{ background: '#0f172a', color: '#e2e8f0', padding: 10, borderRadius: 6, fontSize: 12, maxHeight: 300, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{pretty(c.body)}</pre>
              </>}
              <Space style={{ margin: '6px 0' }}>
                <Text strong>Response</Text>
                <Button size="small" icon={<CopyOutlined />} onClick={() => copy(pretty(c.response))}>Copy</Button>
              </Space>
              <pre style={{ background: c.ok ? '#f6ffed' : '#fff1f0', border: `1px solid ${c.ok ? '#b7eb8f' : '#ffa39e'}`, padding: 10, borderRadius: 6, fontSize: 12, maxHeight: 240, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{pretty(c.response)}</pre>
            </div>
          ),
        }))} />
      </Drawer>
    </>
  );
};

export default ArchiveApiButton;
