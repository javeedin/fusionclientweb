// PDF preview before saving: renders every page of a jsPDF document (pdf.js, worker bundled with the app so
// it also works offline / in the desktop app), with zoom, Print, Save and Close.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Empty, Modal, Space, Spin, Tooltip, Typography, message } from 'antd';
import { CloseOutlined, DownloadOutlined, PrinterOutlined, ZoomInOutlined, ZoomOutOutlined, ColumnWidthOutlined } from '@ant-design/icons';
import type jsPDF from 'jspdf';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url';

const { Text } = Typography;

export const PdfPreviewModal: React.FC<{
  open: boolean;
  /** the document to show (built by the caller) */
  doc: jsPDF | null;
  fileName: string;
  title?: React.ReactNode;
  onClose: () => void;
  /** after the file was saved */
  onSaved?: () => void | Promise<void>;
  /** after the print dialog was opened */
  onPrinted?: () => void | Promise<void>;
  /** note under the toolbar, e.g. "Saving marks the order as sent" */
  note?: React.ReactNode;
}> = ({ open, doc, fileName, title, onClose, onSaved, onPrinted, note }) => {
  const box = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<any>(null);
  const [pages, setPages] = useState(0);
  const [zoom, setZoom] = useState(1);          // 1 = fit the width of the window
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // load the document into pdf.js
  useEffect(() => {
    if (!open || !doc) return undefined;
    let cancelled = false;
    setLoading(true); setError(null); setPages(0); setZoom(1);
    (async () => {
      try {
        const pdfjs: any = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const data = new Uint8Array(doc.output('arraybuffer'));
        const pdf = await pdfjs.getDocument({ data }).promise;
        if (cancelled) { pdf.destroy(); return; }
        pdfRef.current = pdf;
        setPages(pdf.numPages);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e));
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; pdfRef.current?.destroy?.(); pdfRef.current = null; };
  }, [open, doc]);

  // draw the pages (again when zooming)
  const render = useCallback(async () => {
    const pdf = pdfRef.current;
    const host = box.current;
    if (!pdf || !host) return;
    const fit = Math.max(320, host.clientWidth - 48);
    const dpr = window.devicePixelRatio || 1;
    for (let i = 1; i <= pdf.numPages; i++) {
      const canvas = host.querySelector<HTMLCanvasElement>(`canvas[data-page="${i}"]`);
      if (!canvas) continue;
      const page = await pdf.getPage(i);
      const base = page.getViewport({ scale: 1 });
      const scale = (fit / base.width) * zoom;
      const vp = page.getViewport({ scale: scale * dpr });
      canvas.width = vp.width; canvas.height = vp.height;
      canvas.style.width = `${Math.round(vp.width / dpr)}px`; canvas.style.height = `${Math.round(vp.height / dpr)}px`;
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
    }
  }, [zoom]);
  useEffect(() => { if (pages) render(); }, [pages, render]);

  const save = async () => {
    if (!doc) return;
    setBusy(true);
    try { doc.save(fileName); await onSaved?.(); }
    catch (e: any) { message.error(e?.message || String(e)); }
    finally { setBusy(false); }
  };

  // print the rendered pages (works in the browser and the desktop app, no PDF plug-in needed)
  const print = async () => {
    const host = box.current;
    if (!host) return;
    const imgs = Array.from(host.querySelectorAll<HTMLCanvasElement>('canvas[data-page]')).map(c => c.toDataURL('image/png'));
    if (!imgs.length) return;
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    const w = frame.contentWindow!;
    w.document.open();
    w.document.write(`<!doctype html><html><head><title>${fileName.replace(/[<>&"]/g, '')}</title>
      <style>@page{size:A4;margin:0}body{margin:0}img{width:100%;display:block;page-break-after:always}img:last-child{page-break-after:auto}</style>
      </head><body>${imgs.map(src => `<img src="${src}">`).join('')}</body></html>`);
    w.document.close();
    await new Promise(r => setTimeout(r, 300));
    w.focus(); w.print();
    setTimeout(() => frame.remove(), 60000);
    await onPrinted?.();
  };

  return (
    <Modal open={open} onCancel={onClose} width="min(1100px, 96vw)" style={{ top: 16 }} destroyOnHidden maskClosable={false}
      title={<Space>{title || 'PDF preview'}{pages > 0 && <Text type="secondary" style={{ fontSize: 12 }}>{pages} page{pages > 1 ? 's' : ''}</Text>}</Space>}
      styles={{ body: { padding: 0 } }}
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <Space>
            <Tooltip title="Zoom out"><Button icon={<ZoomOutOutlined />} disabled={!pages} onClick={() => setZoom(z => Math.max(0.5, Math.round((z - 0.25) * 100) / 100))} /></Tooltip>
            <Text style={{ minWidth: 44, display: 'inline-block', textAlign: 'center' }}>{Math.round(zoom * 100)}%</Text>
            <Tooltip title="Zoom in"><Button icon={<ZoomInOutlined />} disabled={!pages} onClick={() => setZoom(z => Math.min(3, Math.round((z + 0.25) * 100) / 100))} /></Tooltip>
            <Tooltip title="Fit width"><Button icon={<ColumnWidthOutlined />} disabled={!pages} onClick={() => setZoom(1)} /></Tooltip>
          </Space>
          <Space wrap>
            <Button icon={<CloseOutlined />} onClick={onClose}>Close</Button>
            <Button icon={<PrinterOutlined />} disabled={!pages} onClick={print}>Print</Button>
            <Button type="primary" icon={<DownloadOutlined />} disabled={!doc} loading={busy} onClick={save}>Save PDF</Button>
          </Space>
        </div>
      }>
      {note && <div style={{ padding: '8px 16px', borderBottom: '1px solid #f0f0f0', fontSize: 12, color: '#8c8c8c' }}>{note}</div>}
      <div ref={box} style={{ height: 'calc(100vh - 230px)', minHeight: 360, overflow: 'auto', background: '#525659', padding: '16px 0' }}>
        {loading && <div style={{ textAlign: 'center', paddingTop: 80 }}><Spin /></div>}
        {error && <Empty style={{ paddingTop: 60 }} description={<span style={{ color: '#fff' }}>Could not show the preview: {error}. You can still save the PDF.</span>} />}
        {Array.from({ length: pages }, (_, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
            <canvas data-page={i + 1} style={{ background: '#fff', boxShadow: '0 2px 10px rgba(0,0,0,0.35)' }} />
          </div>
        ))}
      </div>
    </Modal>
  );
};

export default PdfPreviewModal;
