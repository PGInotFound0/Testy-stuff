import { describe, expect, it, vi } from 'vitest';

vi.mock('matrix-js-sdk', () => ({ createClient: vi.fn() }));

import { MatrixBoardService } from '../src/matrix/service';

describe('MatrixBoardService session restore', () => {
  it('returns the login shell without creating a client when no session exists', async () => {
    const createClient = vi.fn();
    const store = { load: vi.fn().mockResolvedValue(null), save: vi.fn(), clear: vi.fn() };
    const service = new MatrixBoardService('https://matrix.example.org', store, createClient);

    await expect(service.restore()).resolves.toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('clears an invalid saved session when restore connection fails', async () => {
    const connectionError = new Error('Stored Matrix session is invalid');
    const client = {
      initRustCrypto: vi.fn().mockRejectedValue(connectionError),
      on: vi.fn(), off: vi.fn(), startClient: vi.fn(), stopClient: vi.fn(),
      getRooms: () => [], getRoom: vi.fn(), getCrypto: vi.fn(), sendEvent: vi.fn(), logout: vi.fn(), login: vi.fn(),
    };
    const store = {
      load: vi.fn().mockResolvedValue({ accessToken: 'bad-token', userId: '@u:example.org', deviceId: 'D' }),
      save: vi.fn(), clear: vi.fn().mockResolvedValue(undefined),
    };
    const service = new MatrixBoardService('https://matrix.example.org', store, vi.fn(() => client));

    await expect(service.restore()).rejects.toBe(connectionError);
    expect(store.clear).toHaveBeenCalledOnce();
    expect(client.stopClient).toHaveBeenCalledOnce();
  });

  it('restores credentials into a Rust-crypto client and maps its private rooms', async () => {
    let syncListener: ((state: string) => void) | undefined;
    const room = {
      roomId: '!aid:example.org',
      name: 'Mutual Aid',
      getMyMembership: () => 'join',
      hasEncryptionStateEvent: () => true,
      currentState: { getStateEvents: (type: string) => ({
        getContent: () => type === 'm.room.join_rules' ? { join_rule: 'invite' } : { topic: 'Needs and offers' },
      }) },
    };
    const client = {
      initRustCrypto: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((_event: string, listener: (state: string) => void) => { syncListener = listener; }),
      off: vi.fn(),
      startClient: vi.fn(async () => { syncListener?.('PREPARED'); }),
      stopClient: vi.fn(),
      getRooms: () => [room],
      getRoom: vi.fn(),
      getCrypto: vi.fn(),
      sendEvent: vi.fn(),
      logout: vi.fn(),
      login: vi.fn(),
    };
    const createClient = vi.fn(() => client);
    const store = {
      load: vi.fn().mockResolvedValue({ accessToken: 'token', userId: '@u:example.org', deviceId: 'D' }),
      save: vi.fn(), clear: vi.fn(),
    };
    const service = new MatrixBoardService('https://matrix.example.org', store, createClient);

    await expect(service.restore()).resolves.toEqual({
      userId: '@u:example.org',
      boards: [{ id: '!aid:example.org', name: 'Mutual Aid', topic: 'Needs and offers', encrypted: true }],
    });
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://matrix.example.org', accessToken: 'token', userId: '@u:example.org', deviceId: 'D',
    }));
  });

  it('logs in with Matrix password auth and saves the returned session', async () => {
    let syncListener: ((state: string) => void) | undefined;
    const authClient = {
      login: vi.fn().mockResolvedValue({ access_token: 'new-token', user_id: '@new:example.org', device_id: 'NEW' }),
      logout: vi.fn(),
    };
    const connectedClient = {
      initRustCrypto: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((_event: string, listener: (state: string) => void) => { syncListener = listener; }),
      off: vi.fn(), startClient: vi.fn(async () => { syncListener?.('PREPARED'); }), stopClient: vi.fn(),
      getRooms: () => [], getRoom: vi.fn(), getCrypto: vi.fn(), sendEvent: vi.fn(), logout: vi.fn(), login: vi.fn(),
    };
    const createClient = vi.fn()
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(connectedClient);
    const store = { load: vi.fn(), save: vi.fn(), clear: vi.fn() };
    const service = new MatrixBoardService('https://matrix.example.org', store, createClient);

    await expect(service.login('new', 'password')).resolves.toEqual({
      userId: '@new:example.org', boards: [],
    });
    expect(authClient.login).toHaveBeenCalledWith('m.login.password', {
      identifier: { type: 'm.id.user', user: 'new' },
      password: 'password',
      initial_device_display_name: 'Secure Board Browser',
    });
    expect(store.save).toHaveBeenCalledWith({
      accessToken: 'new-token', userId: '@new:example.org', deviceId: 'NEW',
    });
  });

  it('fails closed when login is submitted concurrently', async () => {
    let failLogin: ((error: Error) => void) | undefined;
    const authClient = {
      login: vi.fn(() => new Promise<never>((_, reject) => { failLogin = reject; })),
      logout: vi.fn(),
      initRustCrypto: vi.fn(), startClient: vi.fn(), stopClient: vi.fn(), on: vi.fn(), off: vi.fn(),
      getRooms: () => [], getRoom: vi.fn(), getCrypto: vi.fn(), sendEvent: vi.fn(),
    };
    const createClient = vi.fn(() => authClient);
    const store = { load: vi.fn(), save: vi.fn(), clear: vi.fn() };
    const service = new MatrixBoardService('https://matrix.example.org', store, createClient);

    const firstLogin = service.login('new', 'password');
    await expect(service.login('new', 'password')).rejects.toThrow('Matrix login already in progress');
    expect(authClient.login).toHaveBeenCalledOnce();
    expect(createClient).toHaveBeenCalledOnce();

    failLogin?.(new Error('cancel test login'));
    await expect(firstLogin).rejects.toThrow('cancel test login');
  });

  it('clears and best-effort revokes a newly saved session when crypto connection fails', async () => {
    const connectionError = new Error('Rust crypto failed');
    const authClient = {
      login: vi.fn().mockResolvedValue({ access_token: 'new-token', user_id: '@new:example.org', device_id: 'NEW' }),
      logout: vi.fn().mockRejectedValue(new Error('revocation unavailable')),
    };
    const connectedClient = {
      initRustCrypto: vi.fn().mockRejectedValue(connectionError),
      on: vi.fn(), off: vi.fn(), startClient: vi.fn().mockResolvedValue(undefined), stopClient: vi.fn(),
      getRooms: () => [], getRoom: vi.fn(), getCrypto: vi.fn(), sendEvent: vi.fn(), logout: vi.fn(), login: vi.fn(),
    };
    const createClient = vi.fn()
      .mockReturnValueOnce(authClient)
      .mockReturnValueOnce(connectedClient);
    const store = { load: vi.fn(), save: vi.fn(), clear: vi.fn().mockResolvedValue(undefined) };
    const service = new MatrixBoardService('https://matrix.example.org', store, createClient);

    await expect(service.login('new', 'password')).rejects.toBe(connectionError);
    expect(store.clear).toHaveBeenCalledOnce();
    expect(authClient.logout).toHaveBeenCalledOnce();
    expect(connectedClient.stopClient).toHaveBeenCalledOnce();
  });

  it('starts the initial-sync listener only after crypto initialization and before startClient', async () => {
    const calls: string[] = [];
    let finishCrypto: (() => void) | undefined;
    let syncListener: ((state: string) => void) | undefined;
    const client = {
      initRustCrypto: vi.fn(() => {
        calls.push('crypto');
        return new Promise<void>((resolve) => { finishCrypto = resolve; });
      }),
      on: vi.fn((_event: string, listener: (state: string) => void) => {
        calls.push('listen');
        syncListener = listener;
      }),
      off: vi.fn(),
      startClient: vi.fn(async () => { calls.push('start'); syncListener?.('PREPARED'); }),
      stopClient: vi.fn(), getRooms: () => [], getRoom: vi.fn(), getCrypto: vi.fn(),
      sendEvent: vi.fn(), logout: vi.fn(), login: vi.fn(),
    };
    const store = {
      load: vi.fn().mockResolvedValue({ accessToken: 'token', userId: '@u:example.org', deviceId: 'D' }),
      save: vi.fn(), clear: vi.fn(),
    };
    const service = new MatrixBoardService('https://matrix.example.org', store, vi.fn(() => client));

    const restore = service.restore();
    await vi.waitFor(() => expect(client.initRustCrypto).toHaveBeenCalled());
    expect(calls).toEqual(['crypto']);

    finishCrypto?.();
    await expect(restore).resolves.toEqual({ userId: '@u:example.org', boards: [] });
    expect(calls).toEqual(['crypto', 'listen', 'start']);
  });

  it('waits for PREPARED instead of treating SYNCING as initial-sync completion', async () => {
    let syncListener: ((state: string) => void) | undefined;
    const client = {
      initRustCrypto: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((_event: string, listener: (state: string) => void) => { syncListener = listener; }),
      off: vi.fn(),
      startClient: vi.fn(async () => { syncListener?.('SYNCING'); }),
      stopClient: vi.fn(), getRooms: () => [], getRoom: vi.fn(), getCrypto: vi.fn(), sendEvent: vi.fn(), logout: vi.fn(), login: vi.fn(),
    };
    const store = {
      load: vi.fn().mockResolvedValue({ accessToken: 'token', userId: '@u:example.org', deviceId: 'D' }),
      save: vi.fn(), clear: vi.fn(),
    };
    const service = new MatrixBoardService('https://matrix.example.org', store, vi.fn(() => client));
    let restored = false;

    const restore = service.restore().then((workspace) => { restored = true; return workspace; });
    await vi.waitFor(() => expect(client.startClient).toHaveBeenCalled());
    await Promise.resolve();
    expect(restored).toBe(false);

    syncListener?.('PREPARED');
    await expect(restore).resolves.toEqual({ userId: '@u:example.org', boards: [] });
  });

  it('revokes the token and still clears and stops locally when Matrix logout fails', async () => {
    const logoutError = new Error('Matrix logout failed');
    let syncListener: ((state: string) => void) | undefined;
    const client = {
      initRustCrypto: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((_event: string, listener: (state: string) => void) => { syncListener = listener; }),
      off: vi.fn(), startClient: vi.fn(async () => { syncListener?.('PREPARED'); }),
      stopClient: vi.fn(),
      getRooms: () => [], getRoom: vi.fn(), getCrypto: vi.fn(), sendEvent: vi.fn(),
      logout: vi.fn().mockRejectedValue(logoutError), login: vi.fn(),
    };
    const store = {
      load: vi.fn().mockResolvedValue({ accessToken: 'token', userId: '@u:example.org', deviceId: 'D' }),
      save: vi.fn(), clear: vi.fn().mockResolvedValue(undefined),
    };
    const service = new MatrixBoardService('https://matrix.example.org', store, vi.fn(() => client));
    await service.restore();

    await expect(service.logout()).rejects.toBe(logoutError);
    expect(client.logout).toHaveBeenCalledWith(false);
    expect(client.stopClient).toHaveBeenCalledOnce();
    expect(store.clear).toHaveBeenCalledOnce();
    await expect(service.sendPost('!room:example.org', 'message')).rejects.toThrow('No Matrix session');
  });
});
