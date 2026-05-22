import axios from 'axios';

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
  ? String(import.meta.env.VITE_API_BASE_URL).replace(/\/$/, '')
  : 'http://localhost:3000';

function parseFilename(contentDisposition: string | undefined, fallback: string): string {
  if (!contentDisposition) return fallback;
  const match = /filename="([^"]+)"/i.exec(contentDisposition);
  return match?.[1] || fallback;
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function toDownloadError(error: unknown): Error {
  const ax = error as {
    response?: { status?: number; data?: { message?: string } };
    message?: string;
  };
  if (ax.response?.status === 404) {
    return new Error(ax.response.data?.message || 'No se encontró el flujo solicitado.');
  }
  return new Error(ax.response?.data?.message || ax.message || 'No se pudo descargar el flujo.');
}

export async function downloadFlowJson(flowId: string): Promise<void> {
  try {
    const response = await axios.get(`${API_ORIGIN}/api/flows/${encodeURIComponent(flowId)}/export`, {
      responseType: 'blob',
      withCredentials: true,
    });
    const filename = parseFilename(
      response.headers['content-disposition'] as string | undefined,
      `${flowId}.json`,
    );
    triggerBrowserDownload(response.data, filename);
  } catch (error) {
    throw toDownloadError(error);
  }
}

export async function downloadFlowVersionJson(flowId: string, version: string): Promise<void> {
  try {
    const response = await axios.get(
      `${API_ORIGIN}/api/flows/${encodeURIComponent(flowId)}/versions/${encodeURIComponent(version)}/export`,
      { responseType: 'blob', withCredentials: true },
    );
    const filename = parseFilename(
      response.headers['content-disposition'] as string | undefined,
      `${flowId}-${version}.json`,
    );
    triggerBrowserDownload(response.data, filename);
  } catch (error) {
    throw toDownloadError(error);
  }
}
