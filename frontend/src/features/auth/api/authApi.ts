import axios from 'axios';

const API_ORIGIN = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim()
  ? String(import.meta.env.VITE_API_BASE_URL).replace(/\/$/, '')
  : 'http://localhost:3000';

const client = axios.create({
  baseURL: `${API_ORIGIN}/api/auth`,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

export type AuthUser = { username: string };

export const authApi = {
  login: async (username: string, password: string): Promise<{ ok: true; user: AuthUser }> => {
    const { data } = await client.post('/login', { username, password });
    return data;
  },

  me: async (): Promise<{ ok: true; user: AuthUser }> => {
    const { data } = await client.get('/me');
    return data;
  },

  logout: async (): Promise<void> => {
    await client.post('/logout');
  },
};
