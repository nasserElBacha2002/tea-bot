const ALLOWED = new Set(['image/jpeg', 'image/png', 'application/pdf']);

export async function buildSimulatorAttachmentPayload(file: File) {
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