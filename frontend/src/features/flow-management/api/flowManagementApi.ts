import axios from 'axios';
import { toUserFacingError } from '../../../utils/apiError';
import type {
  FlowListItem,
  FlowNodeRecord,
  FlowTransitionRecord,
  FlowValidationResult,
  FlowVersionSummary,
} from '../types/flowManagement.types';

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
  ? String(import.meta.env.VITE_API_BASE_URL).replace(/\/$/, '')
  : 'http://localhost:3000';

const client = axios.create({
  baseURL: `${API_ORIGIN}/api/flow-management`,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(toUserFacingError(error)),
);

export const flowManagementApi = {
  listFlows: async (): Promise<FlowListItem[]> => {
    const { data } = await client.get('/flows');
    return data.data.items;
  },

  getFlow: async (flowId: string) => {
    const { data } = await client.get(`/flows/${flowId}`);
    return data.data;
  },

  listVersions: async (flowId: string): Promise<{ flow: FlowListItem; items: FlowVersionSummary[] }> => {
    const { data } = await client.get(`/flows/${flowId}/versions`);
    return data.data;
  },

  getVersion: async (versionId: string) => {
    const { data } = await client.get(`/flow-versions/${versionId}`);
    return data.data as {
      version: FlowVersionSummary;
      flow: FlowListItem;
      nodes: FlowNodeRecord[];
      transitions: FlowTransitionRecord[];
      validation: FlowValidationResult;
      snapshot?: { checksum?: string; createdAt?: string };
    };
  },

  getSnapshot: async (versionId: string) => {
    const { data } = await client.get(`/flow-versions/${versionId}/snapshot`);
    return data.data;
  },

  createDraft: async (flowId: string, baseVersionId: string) => {
    const { data } = await client.post(`/flows/${flowId}/drafts`, { baseVersionId });
    return data.data.version as FlowVersionSummary;
  },

  validate: async (versionId: string): Promise<FlowValidationResult> => {
    const { data } = await client.post(`/flow-versions/${versionId}/validate`);
    return data.data;
  },

  publish: async (versionId: string) => {
    const { data } = await client.post(`/flow-versions/${versionId}/publish`);
    return data.data;
  },

  discardDraft: async (versionId: string) => {
    const { data } = await client.delete(`/flow-versions/${versionId}/draft`);
    return data.data;
  },

  rollback: async (versionId: string, publishImmediately = false) => {
    const { data } = await client.post(`/flow-versions/${versionId}/rollback`, {
      publishImmediately,
    });
    return data.data;
  },

  updateNode: async (nodeId: string, patch: Partial<FlowNodeRecord>) => {
    const { data } = await client.patch(`/flow-nodes/${nodeId}`, patch);
    return data.data.node as FlowNodeRecord;
  },

  createTransition: async (
    nodeId: string,
    body: { type: string; value?: unknown; nextNodeKey: string; priority?: number },
  ) => {
    const { data } = await client.post(`/flow-nodes/${nodeId}/transitions`, body);
    return data.data.transition as FlowTransitionRecord;
  },

  updateTransition: async (
    transitionId: string,
    patch: Partial<{ type: string; value: unknown; nextNodeKey: string; priority: number }>,
  ) => {
    const { data } = await client.patch(`/flow-transitions/${transitionId}`, patch);
    return data.data.transition as FlowTransitionRecord;
  },

  deleteTransition: async (transitionId: string) => {
    await client.delete(`/flow-transitions/${transitionId}`);
  },
};
