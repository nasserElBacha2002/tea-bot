import axios from 'axios';
import type { Flow, SimulatorResponse } from '../types/flow.types';

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
  ? String(import.meta.env.VITE_API_BASE_URL).replace(/\/$/, '')
  : 'http://localhost:3000';
const API_BASE = `${API_ORIGIN}/api/simulator`;

const client = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

export type SimulatorStartParams = {
  flowId: string;
  sessionId?: string;
  /** Borrador actual (editor de conversación); si falta, el servidor usa el draft guardado. */
  flow?: Flow;
};

export const simulatorApi = {
  start: async (params: SimulatorStartParams): Promise<SimulatorResponse> => {
    const { flow, ...rest } = params;
    const body = flow ? { ...rest, flow } : rest;
    const { data } = await client.post('/start', body);
    return data.data;
  },

  message: async (params: { sessionId: string, text: string }): Promise<SimulatorResponse> => {
    const { data } = await client.post('/message', params);
    return data.data;
  },

  reset: async (sessionId: string): Promise<void> => {
    await client.post('/reset', { sessionId });
  },
};
