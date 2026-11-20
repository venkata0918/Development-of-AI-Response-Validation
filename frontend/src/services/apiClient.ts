// Centralized API client for AI Response Quality Evaluation System.

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export interface ApiStatus {
  isBackendConnected: boolean;
  endpoint: string;
  mode: 'Live API' | 'Backend unavailable';
}

export const getApiStatus = async (): Promise<ApiStatus> => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);
    const response = await fetch(`${API_BASE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (response.ok) {
      return { isBackendConnected: true, endpoint: API_BASE_URL, mode: 'Live API' };
    }
  } catch {
    // Expected fallback when local Python FastAPI server is not currently running
  }
  return { isBackendConnected: false, endpoint: API_BASE_URL, mode: 'Backend unavailable' };
};

export const apiClient = {
  get: async <T>(path: string): Promise<T> => {
    return parseResponse<T>(await fetch(`${API_BASE_URL}${path}`));
  },
  post: async <T>(path: string, body: unknown): Promise<T> => {
    const isForm = body instanceof FormData;
    const res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: isForm ? undefined : { 'Content-Type': 'application/json' },
      body: isForm ? body : JSON.stringify(body),
    });
    return parseResponse<T>(res);
  },
  delete: async <T>(path: string): Promise<T> => {
    return parseResponse<T>(await fetch(`${API_BASE_URL}${path}`, { method: 'DELETE' }));
  },
};

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json() as { detail?: string };
      detail = body.detail || detail;
    } catch {
      // Keep the HTTP status when the server does not return JSON.
    }
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }
  return response.json() as Promise<T>;
}
