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

  const parsed = new URL(homeserverUrl);
  const localDevelopment = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localDevelopment)) {
    throw new Error('Homeserver URL must use HTTPS');
  }

  return { homeserverUrl: parsed.origin };
}
