function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw.trim().toLowerCase() === 'true';
}

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export const config = {
  port: int('PORT', 8787),
  staticDir: process.env.STATIC_DIR ?? '../client/dist',
  maxFiles: int('MAX_FILES_PER_TRANSFER', 500),
  maxTotalBytes: int('MAX_TOTAL_BYTES', 10 * 1024 * 1024 * 1024),
  maxInflightBytesPerSession: int('MAX_INFLIGHT_BYTES_PER_SESSION', 16 * 1024 * 1024),
  codeIdleTimeoutMs: int('CODE_IDLE_TIMEOUT_MS', 30 * 60 * 1000),
  rateLimitPerMinute: int('RATE_LIMIT_MAX_CONNECTIONS_PER_MINUTE', 30),
  allowedOrigins: list('ALLOWED_ORIGINS', ['*']),
  trustProxy: bool('TRUST_PROXY', true),
} as const;

export function isOriginAllowed(origin: string | undefined): boolean {
  if (config.allowedOrigins.includes('*')) return true;
  if (!origin) return false;
  return config.allowedOrigins.includes(origin);
}
