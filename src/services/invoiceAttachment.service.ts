import { APEX_DB_CONFIG } from '../config/api.config';

const BASE = `${APEX_DB_CONFIG.baseUrl}/ap/invoices`;

export interface InvoiceAttachment {
  attachmentId: number;
  fileName:     string;
  fileSize:     number | null;
  mimeType:     string | null;
  description:  string | null;
  uploadedBy:   string | null;
  uploadDate:   string;
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listAttachments(invoiceId: number): Promise<InvoiceAttachment[]> {
  const res  = await fetch(`${BASE}/${invoiceId}/attachments`, {
    headers: { Accept: 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return (data.attachments || []) as InvoiceAttachment[];
}

// ── Upload ────────────────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => {
      // result is "data:<mime>;base64,<data>" — strip the prefix
      const raw = (reader.result as string).split(',')[1];
      resolve(raw);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export async function uploadAttachment(
  invoiceId:   number,
  file:        File,
  description: string,
  uploadedBy:  string,
): Promise<{ success: boolean; attachmentId?: number; error?: string }> {
  try {
    const fileContent = await fileToBase64(file);
    const res = await fetch(`${BASE}/${invoiceId}/attachments`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        invoiceId,
        fileName:    file.name,
        mimeType:    file.type || 'application/octet-stream',
        fileSize:    file.size,
        fileContent,
        description: description || null,
        uploadedBy:  uploadedBy  || null,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data?.error || `HTTP ${res.status}` };
    }
    return { success: true, attachmentId: data.attachmentId };
  } catch (e: any) {
    return { success: false, error: e?.message ?? 'Upload failed' };
  }
}

// ── Download ──────────────────────────────────────────────────────────────────

export async function downloadAttachment(
  invoiceId:    number,
  attachmentId: number,
  fileName:     string,
): Promise<void> {
  const res = await fetch(`${BASE}/${invoiceId}/attachments/${attachmentId}`, {
    headers: { Accept: '*/*' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const blob    = await res.blob();
  const url     = URL.createObjectURL(blob);
  const anchor  = document.createElement('a');
  anchor.href     = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function deleteAttachment(
  invoiceId:    number,
  attachmentId: number,
  deletedBy:    string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${BASE}/${invoiceId}/attachments/${attachmentId}?deleted_by=${encodeURIComponent(deletedBy)}`,
      { method: 'DELETE', headers: { Accept: 'application/json' } },
    );
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data?.error || `HTTP ${res.status}` };
    }
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message ?? 'Delete failed' };
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function formatFileSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileIcon(mimeType: string | null): string {
  if (!mimeType) return '📄';
  if (mimeType.startsWith('image/'))           return '🖼️';
  if (mimeType === 'application/pdf')          return '📕';
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) return '📊';
  if (mimeType.includes('word') || mimeType.includes('document'))     return '📝';
  if (mimeType.includes('zip') || mimeType.includes('compressed'))    return '🗜️';
  return '📄';
}
