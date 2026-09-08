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
});
