export interface RuntimeConfig {
  homeserverUrl: string;
}

type ConfigFetcher = (
  input: string,
  init: { credentials: 'same-origin' },
) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

export async function loadRuntimeConfig(fetcher: ConfigFetcher = fetch): Promise<RuntimeConfig> {
  const response = await fetcher('/config.json', { credentials: 'same-origin' });
  if (!response.ok) throw new Error('Unable to load /config.json');

  const value = await response.json();
  if (!value || typeof value !== 'object') throw new Error('Invalid runtime config');
  const homeserverUrl = (value as Record<string, unknown>).homeserverUrl;
  if (typeof homeserverUrl !== 'string') throw new Error('Invalid homeserver URL');

  // Fail fast when the image was built without a homeserver URL and the
  // deployment did not replace /config.json at runtime.
  if (homeserverUrl.trim() === 'https://replace-me.invalid') {
    throw new Error('App is not configured: set SECURE_BOARD_HOMESERVER_URL and redeploy');
  }

  const parsed = new URL(homeserverUrl);
  const localDevelopment = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localDevelopment)) {
    throw new Error('Homeserver URL must use HTTPS');
  }
  if (parsed.search || parsed.hash) {
    throw new Error('Homeserver URL cannot contain a query or hash');
  }

  const path = parsed.pathname.replace(/\/+$/, '');
  return { homeserverUrl: `${parsed.origin}${path}` };
}
