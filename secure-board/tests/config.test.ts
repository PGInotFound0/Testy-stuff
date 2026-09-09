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

  it('surfaces a failed config response', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: false, json: vi.fn() });
    await expect(loadRuntimeConfig(fetcher)).rejects.toThrow('Unable to load /config.json');
  });

  it('surfaces invalid JSON', async () => {
    const parseError = new SyntaxError('invalid JSON');
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: vi.fn().mockRejectedValue(parseError) });
    await expect(loadRuntimeConfig(fetcher)).rejects.toBe(parseError);
  });

  it.each([
    [null, 'Invalid runtime config'],
    [{}, 'Invalid homeserver URL'],
    [{ homeserverUrl: 42 }, 'Invalid homeserver URL'],
    [{ homeserverUrl: 'not a URL' }, 'Invalid URL'],
  ])('rejects malformed runtime config %#', async (value, message) => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => value });
    await expect(loadRuntimeConfig(fetcher)).rejects.toThrow(message);
  });

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'allows cleartext loopback homeservers for local development: %s',
    async (host) => {
      const homeserverUrl = `http://${host}:8008`;
      const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ homeserverUrl }) });
      await expect(loadRuntimeConfig(fetcher)).resolves.toEqual({ homeserverUrl });
    },
  );

  it('does not mistake a loopback-looking domain for localhost', async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ homeserverUrl: 'http://127.0.0.1.example.org' }),
    });
    await expect(loadRuntimeConfig(fetcher)).rejects.toThrow('Homeserver URL must use HTTPS');
  });
});
