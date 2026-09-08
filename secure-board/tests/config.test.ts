import { describe, expect, it, vi } from 'vitest';
import { loadRuntimeConfig } from '../src/config';

describe('loadRuntimeConfig', () => {
  it('loads and validates the homeserver from same-origin config', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ homeserverUrl: 'https://matrix.example.org' }),
    });

    await expect(loadRuntimeConfig(fetcher)).resolves.toEqual({
      homeserverUrl: 'https://matrix.example.org',
    });
    expect(fetcher).toHaveBeenCalledWith('/config.json', { credentials: 'same-origin' });
  });

  it('rejects cleartext remote homeservers', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ homeserverUrl: 'http://matrix.example.org' }),
    });

    await expect(loadRuntimeConfig(fetcher)).rejects.toThrow('Homeserver URL must use HTTPS');
  });
});
