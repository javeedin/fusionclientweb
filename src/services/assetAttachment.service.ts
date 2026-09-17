// Asset (addition) attachments — mirror of retirementAttachment.service.ts,
// keyed by ASSET_ID against the fa/assets/:assetId/attachments ORDS endpoints
// (database/fa/158_fa_asset_attachments.sql).
import { APEX_DB_CONFIG } from '../config/api.config';

const BASE = `${APEX_DB_CONFIG.baseUrl}/fa/assets`;

export interface AssetAttachment {
  attachmentId: number;
  fileName:     string;
  fileSize:     number | null;
  mimeType:     string | null;
  description:  string | null;
  uploadedBy:   string | null;
  uploadDate:   string;
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listAssetAttachments(assetId: number | string): Promise<AssetAttachment[]> {
  const res  = await fetch(`${BASE}/${assetId}/attachments`, {
    headers: { Accept: 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return (data.attachments || []) as AssetAttachment[];
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

export async function uploadAssetAttachment(
  assetId: number | string,
  file:         File,
  description:  string,
  uploadedBy:   string,
): Promise<{ success: boolean; attachmentId?: number; error?: string }> {
  try {
    const fileContent = await fileToBase64(file);
    const res = await fetch(`${BASE}/${assetId}/attachments`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        assetId,
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

export async function downloadAssetAttachment(
  assetId: number | string,
  attachmentId: number,
  fileName:     string,
): Promise<void> {
  const res = await fetch(`${BASE}/${assetId}/attachments/${attachmentId}`, {
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

export async function deleteAssetAttachment(
  assetId: number | string,
  attachmentId: number,
  deletedBy:    string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(
      `${BASE}/${assetId}/attachments/${attachmentId}?deleted_by=${encodeURIComponent(deletedBy)}`,
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

// Shared display helpers — same implementations as the invoice service.
export { formatFileSize, fileIcon } from './invoiceAttachment.service';
