import React, { useState, useRef, useEffect } from 'react';
import { Button, Tooltip, Modal, Spin, message, Form, Input, Select } from 'antd';
import { VideoCameraOutlined, StopOutlined, SaveOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';

const { Option } = Select;
const REDWOOD_PRIMARY = '#C74634';

const CATEGORIES = ['General', 'AP - Payables', 'GL - General Ledger', 'Cash Management', 'Suppliers', 'Reports', 'System'];

const isElectron = () => !!(window as any).electronAPI?.isElectron;

const ScreenRecorder: React.FC = () => {
  const navigate = useNavigate();
  const [recording, setRecording]         = useState(false);
  const [elapsed, setElapsed]             = useState(0);
  const [sourceModal, setSourceModal]     = useState(false);
  const [sources, setSources]             = useState<any[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [saveModal, setSaveModal]         = useState(false);
  const [saving, setSaving]               = useState(false);
  const [form] = Form.useForm();

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks        = useRef<Blob[]>([]);
  const timerRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef     = useRef<MediaStream | null>(null);
  const elapsedRef    = useRef(0);
  const pendingBuf    = useRef<Uint8Array | null>(null);

  if (!isElectron()) return null;

  const formatTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  const openSourcePicker = async () => {
    setSourcesLoading(true);
    setSourceModal(true);
    try {
      const srcs = await (window as any).electronAPI.getScreenSources();
      setSources(srcs);
    } catch (e: any) {
      message.error('Could not get screen sources: ' + e.message);
      setSourceModal(false);
    } finally {
      setSourcesLoading(false);
    }
  };

  const startRecording = async (sourceId: string) => {
    setSourceModal(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
            minWidth: 1280, maxWidth: 1920,
            minHeight: 720,  maxHeight: 1080,
          },
        } as any,
      });
      streamRef.current = stream;
      chunks.current = [];
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
      rec.start(1000);
      mediaRecorder.current = rec;
      elapsedRef.current = 0;
      setElapsed(0);
      setRecording(true);
      timerRef.current = setInterval(() => {
        elapsedRef.current += 1;
        setElapsed(elapsedRef.current);
      }, 1000);
    } catch (e: any) {
      message.error('Recording failed to start: ' + e.message);
    }
  };

  const stopRecording = () => {
    if (!mediaRecorder.current) return;
    mediaRecorder.current.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);

    mediaRecorder.current.onstop = async () => {
      const blob = new Blob(chunks.current, { type: 'video/webm' });
      const arrayBuf = await blob.arrayBuffer();
      pendingBuf.current = new Uint8Array(arrayBuf);
      chunks.current = [];
      const now = new Date();
      const stamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
      form.setFieldsValue({ title: `Recording ${stamp}`, description: '', category: 'General', defaultName: `ReactERP_Recording_${stamp}.webm` });
      setSaveModal(true);
    };
  };

  const handleSave = async () => {
    await form.validateFields();
    const vals = form.getFieldsValue();
    if (!pendingBuf.current) return;
    setSaving(true);
    try {
      const result = await (window as any).electronAPI.saveRecording(
        Array.from(pendingBuf.current),
        { title: vals.title, description: vals.description || '', category: vals.category || 'General', defaultName: vals.defaultName, duration: elapsedRef.current }
      );
      if (result.success) {
        setSaveModal(false);
        pendingBuf.current = null;
        message.success(
          <span>Recording saved! <a style={{ textDecoration: 'underline' }} onClick={() => navigate('/training')}>Open Training Library</a></span>,
          6
        );
      } else if (!result.cancelled) {
        message.error('Save failed');
      } else {
        setSaveModal(false);
      }
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <>
      {recording ? (
        <Tooltip title={`Stop Recording  (${formatTime(elapsed)})`} placement="bottom">
          <Button
            type="text"
            onClick={stopRecording}
            style={{ color: '#fff', background: 'rgba(255,255,255,0.18)', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', height: 32 }}
          >
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff4444', display: 'inline-block', flexShrink: 0, animation: 'pulse-rec 1s infinite' }} />
            <StopOutlined style={{ fontSize: 15 }} />
            <span style={{ fontSize: 13, fontWeight: 600 }}>{formatTime(elapsed)}</span>
          </Button>
        </Tooltip>
      ) : (
        <Tooltip title="Record Screen" placement="bottom">
          <Button type="text" icon={<VideoCameraOutlined style={{ fontSize: 18, color: '#fff' }} />} style={{ color: '#fff' }} onClick={openSourcePicker} />
        </Tooltip>
      )}

      <style>{`@keyframes pulse-rec { 0%{opacity:1;transform:scale(1)} 50%{opacity:0.35;transform:scale(1.35)} 100%{opacity:1;transform:scale(1)} }`}</style>

      {/* Source picker modal */}
      <Modal
        title={<span><VideoCameraOutlined style={{ color: REDWOOD_PRIMARY, marginRight: 8 }} />Select what to record</span>}
        open={sourceModal} onCancel={() => setSourceModal(false)} footer={null} width={580}
      >
        <Spin spinning={sourcesLoading}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '8px 0' }}>
            {sources.map((src: any) => (
              <div key={src.id} onClick={() => startRecording(src.id)}
                style={{ width: 160, cursor: 'pointer', borderRadius: 8, overflow: 'hidden', border: '2px solid #e5e5e5', transition: 'border-color 0.15s' }}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = REDWOOD_PRIMARY}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = '#e5e5e5'}
              >
                {src.thumbnail
                  ? <img src={src.thumbnail} alt={src.name} style={{ width: '100%', height: 80, objectFit: 'cover', background: '#000', display: 'block' }} />
                  : <div style={{ height: 80, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><VideoCameraOutlined style={{ fontSize: 28, color: '#555' }} /></div>
                }
                <div style={{ padding: '5px 8px', background: '#fafafa', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={src.name}>{src.name}</div>
              </div>
            ))}
          </div>
        </Spin>
      </Modal>

      {/* Save metadata modal */}
      <Modal
        title={<span><SaveOutlined style={{ color: REDWOOD_PRIMARY, marginRight: 8 }} />Save Recording</span>}
        open={saveModal}
        onCancel={() => { if (!saving) { setSaveModal(false); pendingBuf.current = null; } }}
        onOk={handleSave}
        okText="Save Recording"
        okButtonProps={{ loading: saving, style: { background: REDWOOD_PRIMARY, borderColor: REDWOOD_PRIMARY } }}
        cancelButtonProps={{ disabled: saving }}
        width={480}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item label="Title" name="title" rules={[{ required: true, message: 'Please enter a title' }]}>
            <Input placeholder="e.g. How to create an invoice" />
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea rows={2} placeholder="What does this recording cover?" />
          </Form.Item>
          <Form.Item label="Category" name="category">
            <Select>{CATEGORIES.map(c => <Option key={c} value={c}>{c}</Option>)}</Select>
          </Form.Item>
          <Form.Item name="defaultName" hidden><Input /></Form.Item>
        </Form>
        <div style={{ color: '#999', fontSize: 12, marginTop: -4 }}>
          Duration: {formatTime(elapsedRef.current)} &nbsp;·&nbsp; Format: WebM video
        </div>
      </Modal>
    </>
  );
};

export default ScreenRecorder;
