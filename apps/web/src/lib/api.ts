'use client';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333';
const TOKEN_KEY = 'd360.token';
const TENANT_KEY = 'd360.tenant';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* navegador sem storage: sessão dura só até recarregar */
  }
}

export const session = {
  getToken: () => safeGet(TOKEN_KEY),
  setToken: (t: string | null) => safeSet(TOKEN_KEY, t),
  getTenantId: () => safeGet(TENANT_KEY),
  setTenantId: (id: string | null) => safeSet(TENANT_KEY, id),
  clear: () => {
    safeSet(TOKEN_KEY, null);
    safeSet(TENANT_KEY, null);
  },
};

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Envia o restaurante atual no cabeçalho x-tenant-id. */
  tenant?: boolean | string;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = session.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.tenant) {
    const tenantId = typeof opts.tenant === 'string' ? opts.tenant : session.getTenantId();
    if (tenantId) headers['x-tenant-id'] = tenantId;
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Não foi possível conectar ao servidor.');
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const raw = data?.message;
    const message = Array.isArray(raw) ? raw.join(' ') : raw || 'Erro inesperado.';
    if (res.status === 401 && token) {
      session.clear();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    throw new ApiError(res.status, message);
  }
  return data as T;
}

/** Baixa um arquivo da API com o login (ex.: cupom em PDF) e devolve um endereço local para abrir. */
export async function apiBlobUrl(path: string): Promise<string> {
  const headers: Record<string, string> = {};
  const token = session.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const tenantId = session.getTenantId();
  if (tenantId) headers['x-tenant-id'] = tenantId;
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { headers });
  } catch {
    throw new ApiError(0, 'Não foi possível conectar ao servidor.');
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, data?.message || 'Não foi possível abrir o arquivo.');
  }
  return URL.createObjectURL(await res.blob());
}
