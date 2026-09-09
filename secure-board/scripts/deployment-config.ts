export const DEPLOYMENT_PLACEHOLDER = 'https://replace-me.invalid';
export const MAX_JAVASCRIPT_CHUNK_BYTES = 1_200_000;

export function assertJavaScriptChunkWithinBudget(fileName: string, bytes: number): void {
  if (bytes > MAX_JAVASCRIPT_CHUNK_BYTES) {
    throw new Error(`${fileName} exceeds the ${MAX_JAVASCRIPT_CHUNK_BYTES}-byte JavaScript chunk budget`);
  }
}

export interface ProductionConfig {
  homeserverUrl: string;
}

export function validateProductionConfig(
  value: unknown,
  options: { allowPlaceholder?: boolean } = {},
): ProductionConfig {
  if (!value || typeof value !== 'object') throw new Error('Production config must be a JSON object');
  const rawHomeserverUrl = (value as Record<string, unknown>).homeserverUrl;
  if (typeof rawHomeserverUrl !== 'string' || !rawHomeserverUrl.trim()) {
    throw new Error('Production homeserverUrl must be a non-empty string');
  }
  const homeserverUrl = rawHomeserverUrl.trim();
  if (homeserverUrl === DEPLOYMENT_PLACEHOLDER) {
    if (!options.allowPlaceholder) throw new Error('Production homeserverUrl must be replaced at deployment time');
    return { homeserverUrl };
  }

  let parsed: URL;
  try {
    parsed = new URL(homeserverUrl);
  } catch {
    throw new Error('Production homeserverUrl must be a valid URL');
  }
  if (parsed.protocol !== 'https:') throw new Error('Production homeserverUrl must use HTTPS');
  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/u, '');
  const unbracketedHostname = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  const ipv6LoopbackOrUnspecified = unbracketedHostname === '::1'
    || unbracketedHostname === '::'
    || unbracketedHostname === '::ffff:0:0'
    || /^::(?:ffff:)?7f[0-9a-f]{2}:[0-9a-f]{1,4}$/u.test(unbracketedHostname);
  if (hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '0.0.0.0'
    || /^127(?:\.|$)/u.test(hostname)
    || ipv6LoopbackOrUnspecified) {
    throw new Error('Production homeserverUrl must not use a loopback or unspecified host');
  }
  if (parsed.username || parsed.password) throw new Error('Production homeserverUrl cannot contain credentials');
  if (parsed.search || parsed.hash) throw new Error('Production homeserverUrl cannot contain a query or hash');
  const path = parsed.pathname.replace(/\/+$/u, '');
  return { homeserverUrl: `${parsed.origin}${path}` };
}
