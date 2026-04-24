import axios from 'axios';
import type {
  Flow,
  FlowSummary,
  PublishedVersionsSummary,
  PublishedVersionDetailResponse,
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

  validate: async (flow: Partial<Flow>): Promise<{ valid: boolean; error?: string }> => {
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
};
