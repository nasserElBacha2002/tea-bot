import axios from 'axios';
import type {
  Flow,
  FlowSummary,
  PublishedVersionsSummary,
  PublishedVersionDetailResponse,
  ImportJsonVersionResponse,
} from '../types/flow.types';

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
  ? String(import.meta.env.VITE_API_BASE_URL).replace(/\/$/, '')
  : 'http://localhost:3000';
const API_BASE = `${API_ORIGIN}/api/flows`;

const client = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

const FLOW_API_ERROR_CODES = new Set([
  'CONVERSATION_PERSISTENCE_UNAVAILABLE',
  'FLOW_VALIDATION_FAILED',
  'FLOW_PUBLISH_VALIDATION_FAILED',
  'FLOW_NOT_FOUND',
  'REQUEST_FAILED',
]);

function isHumanReadableApiError(value: string | undefined): boolean {
  if (!value) return false;
  if (FLOW_API_ERROR_CODES.has(value)) return false;
  return value.includes(' ') || value.includes('.');
}

function toFlowApiError(error: unknown): Error {
  const ax = error as {
    response?: {
      data?: {
        message?: string;
        error?: string;
        details?: { errors?: Array<{ message: string }> };
      };
    };
    message?: string;
  };
  const data = ax.response?.data;
  const detailMessages = data?.details?.errors?.map(e => e.message).filter(Boolean);
  const msg =
    (detailMessages?.length ? detailMessages.join('\n') : null) ||
    data?.message ||
    (isHumanReadableApiError(data?.error) ? data?.error : null) ||
    (data?.error === 'CONVERSATION_PERSISTENCE_UNAVAILABLE'
      ? 'No se pudo conectar con la base de datos de flujos. Verificá SQL Server y las variables DB_*.'
      : null) ||
    ax.message ||
    'Error al comunicarse con el servidor de flujos.';
  const wrapped = new Error(msg);
  if (data) {
    (wrapped as Error & { apiDetails?: unknown }).apiDetails = data.details;
    (wrapped as Error & { apiCode?: string }).apiCode = data.error;
  }
  return wrapped;
}

client.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(toFlowApiError(error)),
);

export const flowsApi = {
  list: async (): Promise<FlowSummary[]> => {
    const { data } = await client.get('/');
    return data.data;
  },

  get: async (flowId: string): Promise<Flow> => {
    const { data } = await client.get(`/${flowId}`);
    return data.data;
  },

  create: async (flow: Partial<Flow>): Promise<Flow> => {
    const { data } = await client.post('/', flow);
    return data.data;
  },

  update: async (flowId: string, flow: Partial<Flow>): Promise<Flow> => {
    const { data } = await client.put(`/${flowId}`, flow);
    return data.data;
  },

  duplicate: async (flowId: string, newId: string): Promise<Flow> => {
    const { data } = await client.post(`/${flowId}/duplicate`, { newId });
    return data.data;
  },

  archive: async (flowId: string): Promise<void> => {
    await client.post(`/${flowId}/archive`);
  },

  publish: async (flowId: string): Promise<{ flowId: string; version: string; publishedAt: string }> => {
    const { data } = await client.post(`/${flowId}/publish`);
    return data.data;
  },

  validate: async (
    flow: Partial<Flow>
  ): Promise<{ valid: boolean; error?: string; errors?: Array<{ message: string }> }> => {
    const { data } = await client.post('/validate', flow);
    return data.data;
  },

  listVersions: async (flowId: string): Promise<PublishedVersionsSummary> => {
    const { data } = await client.get(`/${encodeURIComponent(flowId)}/versions`);
    return data.data;
  },

  getPublishedVersion: async (
    flowId: string,
    version: string
  ): Promise<PublishedVersionDetailResponse> => {
    const { data } = await client.get(
      `/${encodeURIComponent(flowId)}/versions/${encodeURIComponent(version)}`
    );
    return data.data;
  },

  duplicatePublishedToDraft: async (
    flowId: string,
    version: string,
    overwriteDraft: boolean
  ): Promise<Flow> => {
    const { data } = await client.post(
      `/${encodeURIComponent(flowId)}/versions/${encodeURIComponent(version)}/duplicate-to-draft`,
      { overwriteDraft }
    );
    return data.data;
  },

  importJsonAsNewVersion: async (
    flowId: string,
    flow: Partial<Flow>,
    options: { publish?: boolean; target?: 'draft' | 'new_version' } = {}
  ): Promise<ImportJsonVersionResponse> => {
    const { publish = false, target = 'new_version' } = options;
    const { data } = await client.post(
      `/${encodeURIComponent(flowId)}/versions/import-json`,
      { flow, publish, target }
    );
    return data.data;
  },

  /** Descarga JSON portable desde DB (no usa archivos en disco). */
  exportFlow: (flowId: string) =>
    client.get(`/${encodeURIComponent(flowId)}/export`, { responseType: 'blob' }),

  exportFlowVersion: (flowId: string, version: string) =>
    client.get(
      `/${encodeURIComponent(flowId)}/versions/${encodeURIComponent(version)}/export`,
      { responseType: 'blob' },
    ),
};
