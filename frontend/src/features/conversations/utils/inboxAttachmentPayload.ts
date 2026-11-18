const ALLOWED = new Set(['image/jpeg', 'image/png', 'application/pdf']);

export const INBOX_MAX_OUTBOUND_FILES = 5;

export interface InboxAttachmentPayload {
  fileName: string;
  mimeType: string;
  contentBase64: string;
}

export async function buildInboxAttachmentPayload(file: File): Promise<InboxAttachmentPayload> {
  const mimeType = file.type?.trim().toLowerCase() || '';
  if (!ALLOWED.has(mimeType)) {
    throw new Error('mime_not_allowed');
  }
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return {
    fileName: file.name,
    mimeType,
    contentBase64: btoa(binary),
  };
}

export const INBOX_ATTACHMENT_ACCEPT = 'image/jpeg,image/png,application/pdf';