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

  it.each([
    ['https://example.org/matrix', 'https://example.org/matrix'],
    ['https://example.org/matrix/', 'https://example.org/matrix'],
  ])('preserves a path-prefixed homeserver and normalizes only its trailing slash: %s', async (homeserverUrl, expected) => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ homeserverUrl }),
    });

    await expect(loadRuntimeConfig(fetcher)).resolves.toEqual({
      homeserverUrl: expected,
    });
  });

  it.each([
    'https://example.org/matrix?tenant=secret',
    'https://example.org/matrix#fragment',
  ])('rejects a homeserver URL containing a query or hash: %s', async (homeserverUrl) => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ homeserverUrl }),
    });

    await expect(loadRuntimeConfig(fetcher)).rejects.toThrow('Homeserver URL cannot contain a query or hash');
  });

  it('rejects cleartext remote homeservers', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ homeserverUrl: 'http://matrix.example.org' }),
    });

    await expect(loadRuntimeConfig(fetcher)).rejects.toThrow('Homeserver URL must use HTTPS');
  });
});
