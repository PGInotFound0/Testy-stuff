import { describe, expect, it, vi } from 'vitest';
import { IndexedDbSessionStore, loginAndSaveSession, type SessionStore } from '../src/auth/session';

describe('loginAndSaveSession', () => {
  it('persists the Matrix login session through the session-store abstraction', async () => {
    const save = vi.fn();
    const store: SessionStore = { load: vi.fn(), save, clear: vi.fn() };
    const auth = {
      login: vi.fn().mockResolvedValue({
        access_token: 'token-value',
        user_id: '@organizer:example.org',
        device_id: 'DEVICE',
      }),
    };

    const session = await loginAndSaveSession(auth, store, 'organizer', 'correct horse');

    expect(session).toEqual({
      accessToken: 'token-value',
      userId: '@organizer:example.org',
      deviceId: 'DEVICE',
    });
    expect(save).toHaveBeenCalledWith(session);
  });

  it('rejects malformed login credentials before persistence', async () => {
    const save = vi.fn();
    const store: SessionStore = { load: vi.fn(), save, clear: vi.fn() };
    const auth = {
      login: vi.fn().mockResolvedValue({
        access_token: 'token\u0000value', user_id: '@organizer:example.org', device_id: 'DEVICE',
      }),
    };

    await expect(loginAndSaveSession(auth, store, 'organizer', 'password'))
      .rejects.toThrow('invalid access token');
    expect(save).not.toHaveBeenCalled();
  });
});

describe('IndexedDbSessionStore', () => {
  it('restores and clears a session without localStorage', async () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem });
    const store = new IndexedDbSessionStore(`secure-board-test-${crypto.randomUUID()}`);
    const session = { accessToken: 'secret', userId: '@u:example.org', deviceId: 'D' };

    await store.save(session);
    expect(await store.load()).toEqual(session);
    expect(setItem).not.toHaveBeenCalled();

    await store.clear();
    expect(await store.load()).toBeNull();
    vi.unstubAllGlobals();
  });

  it('does not clear a newer session written by another browser context', async () => {
    const databaseName = `secure-board-session-race-${crypto.randomUUID()}`;
    const first = new IndexedDbSessionStore(databaseName);
    const second = new IndexedDbSessionStore(databaseName);
    const oldSession = { accessToken: 'old', userId: '@old:example.org', deviceId: 'OLD' };
    const newSession = { accessToken: 'new', userId: '@new:example.org', deviceId: 'NEW' };

    await first.save(oldSession);
    await second.save(newSession);
    await first.clear(oldSession);
    expect(await second.load()).toEqual(newSession);

    await second.clear(newSession);
    expect(await first.load()).toBeNull();
  });
});
