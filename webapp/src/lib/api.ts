export interface ApiClient {
  get<T>(path: string): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
}

async function request<T>(initData: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": initData,
      ...init.headers,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function createApiClient(initData: string): ApiClient {
  return {
    get: <T>(path: string) => request<T>(initData, path),
    post: <T>(path: string, body: unknown) => request<T>(initData, path, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    put: <T>(path: string, body: unknown) => request<T>(initData, path, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  };
}
