import { describe, expect, it, vi } from 'vitest';

vi.mock('matrix-js-sdk', () => ({ createClient: vi.fn() }));

import { MatrixBoardService } from '../src/matrix/service';

class TestCryptoStoreLockManager {
  private readonly held = new Set<string>();

  async request(
    name: string,
    _options: { mode: 'exclusive'; ifAvailable: true },
    callback: (lock: object | null) => Promise<void>,
  ): Promise<void> {
    if (this.held.has(name)) {
      await callback(null);
      return;
    }
    this.held.add(name);
    try {
      await callback({ name });
    } finally {
      this.held.delete(name);
    }
  }
}

const serviceClientShell = () => ({
  initRustCrypto: vi.fn(), startClient: vi.fn(), stopClient: vi.fn(), on: vi.fn(), off: vi.fn(),
  getRooms: () => [], getRoom: vi.fn(), getCrypto: vi.fn(), sendEvent: vi.fn(),
  logout: vi.fn(), login: vi.fn(),
});

describe('MatrixBoardService session restore', () => {
  it('returns the login shell without creating a client when no session exists', async () => {
    const createClient = vi.fn();
    const store = { load: vi.fn().mockResolvedValue(null), save: vi.fn(), clear: vi.fn() };
    const service = new MatrixBoardService('https://matrix.example.org', store, createClient);

    await expect(service.restore()).resolves.toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('preserves a valid saved session when transient crypto initialization fails', async () => {
    const connectionError = new Error('IndexedDB crypto startup failed');
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
    expect(store.clear).not.toHaveBeenCalled();
    expect(client.logout).not.toHaveBeenCalled();
    expect(client.stopClient).toHaveBeenCalledOnce();
  });

  it('rejects malformed restored credentials before crypto and clears local state', async () => {
    const stored = { accessToken: 'token', userId: '@u:example.org', deviceId: 'D\u0000' };
    const cleanupClient = { ...serviceClientShell(), logout: vi.fn().mockResolvedValue(undefined) };
    const store = { load: vi.fn().mockResolvedValue(stored), save: vi.fn(), clear: vi.fn().mockResolvedValue(undefined) };
    const factory = vi.fn(() => cleanupClient);
    const service = new MatrixBoardService('https://matrix.example.org', store, factory);

    await expect(service.restore()).rejects.toThrow('invalid device ID');
    expect(store.clear).toHaveBeenCalledOnce();
    expect(cleanupClient.logout).toHaveBeenCalledOnce();
    expect(cleanupClient.initRustCrypto).not.toHaveBeenCalled();
    expect(factory).toHaveBeenCalledWith(expect.objectContaining({ accessToken: 'token', userId: '@u:example.org' }));
  });

  it('aggregates malformed-session cleanup and remote-revocation failures', async () => {
    const clearError = new Error('clear failed');
    const logoutError = new Error('logout failed');
    const stored = { accessToken: 'token', userId: '@u:example.org', deviceId: 'D\u0000' };
    const cleanupClient = {
      ...serviceClientShell(), logout: vi.fn().mockRejectedValue(logoutError),
    };
    const store = {
      load: vi.fn().mockResolvedValue(stored),
      save: vi.fn(), clear: vi.fn().mockRejectedValue(clearError),
    };
    const factory = vi.fn(() => cleanupClient);
    const service = new MatrixBoardService('https://matrix.example.org', store, factory);

    const failure = await service.restore().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([
      expect.objectContaining({ message: 'Matrix session has an invalid device ID' }),
      clearError,
      logoutError,
    ]);
    expect(store.clear).toHaveBeenCalledWith(stored);
    expect(cleanupClient.logout).toHaveBeenCalledOnce();
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
      posts: { '!aid:example.org': [] },
    });
    expect(createClient).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://matrix.example.org', accessToken: 'token', userId: '@u:example.org', deviceId: 'D',
    }));
    service.dispose();
  });

  it('does not connect a restored session loaded after the service is disposed', async () => {
    let finishLoad: ((session: { accessToken: string; userId: string; deviceId: string }) => void) | undefined;
    const store = {
      load: vi.fn(() => new Promise<{ accessToken: string; userId: string; deviceId: string }>((resolve) => { finishLoad = resolve; })),
      save: vi.fn(), clear: vi.fn().mockResolvedValue(undefined),
    };
    const cleanupClient = { ...serviceClientShell(), logout: vi.fn().mockResolvedValue(undefined) };
    const createClient = vi.fn(() => cleanupClient);
    const service = new MatrixBoardService('https://matrix.example.org', store, createClient);

    const restore = service.restore();
    await vi.waitFor(() => expect(store.load).toHaveBeenCalledOnce());
    service.dispose();
    finishLoad?.({ accessToken: 'token', userId: '@late:example.org', deviceId: 'D' });

    await expect(restore).rejects.toThrow('Matrix authentication was disposed');
    expect(createClient).not.toHaveBeenCalled();
    expect(cleanupClient.logout).not.toHaveBeenCalled();
    expect(store.clear).not.toHaveBeenCalled();
  });

  it('serializes a StrictMode-like restore-dispose-restore sequence', async () => {
    const session = { accessToken: 'token', userId: '@strict:example.org', deviceId: 'D' };
    let finishFirstLoad: ((value: typeof session) => void) | undefined;
    const store = {
      load: vi.fn()
        .mockImplementationOnce(() => new Promise<typeof session>((resolve) => { finishFirstLoad = resolve; }))
        .mockResolvedValueOnce(session),
      save: vi.fn(), clear: vi.fn().mockResolvedValue(undefined),
    };
    let syncListener: ((state: string) => void) | undefined;
    const connectedClient = {
      ...serviceClientShell(), initRustCrypto: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((_event: string, listener: (state: string) => void) => { syncListener = listener; }),
      startClient: vi.fn(async () => { syncListener?.('PREPARED'); }),
    };
    const factory = vi.fn(() => connectedClient);
    const service = new MatrixBoardService('https://matrix.example.org', store, factory);

    const discardedRestore = service.restore();
    await vi.waitFor(() => expect(store.load).toHaveBeenCalledOnce());
    service.dispose();
    const replacementRestore = service.restore();
    finishFirstLoad?.(session);

    await expect(discardedRestore).rejects.toThrow('Matrix authentication was disposed');
    await expect(replacementRestore).resolves.toMatchObject({ userId: session.userId });
    expect(store.load).toHaveBeenCalledTimes(2);
    expect(connectedClient.initRustCrypto).toHaveBeenCalledOnce();
    service.dispose();
  });

  it('blocks login while session restore is initializing the crypto store', async () => {
    let finishCrypto: (() => void) | undefined;
    let syncListener: ((state: string) => void) | undefined;
    const client = {
      initRustCrypto: vi.fn(() => new Promise<void>((resolve) => { finishCrypto = resolve; })),
      on: vi.fn((_event: string, listener: (state: string) => void) => { syncListener = listener; }),
      off: vi.fn(), startClient: vi.fn(async () => { syncListener?.('PREPARED'); }), stopClient: vi.fn(),
      getRooms: () => [], getRoom: vi.fn(), getCrypto: vi.fn(), sendEvent: vi.fn(), logout: vi.fn(), login: vi.fn(),
    };
    const store = {
      load: vi.fn().mockResolvedValue({ accessToken: 'token', userId: '@u:example.org', deviceId: 'D' }),
      save: vi.fn(), clear: vi.fn(),
    };
    const createClient = vi.fn(() => client);
    const service = new MatrixBoardService('https://matrix.example.org', store, createClient);

    const restore = service.restore();
    await vi.waitFor(() => expect(client.initRustCrypto).toHaveBeenCalledOnce());
    await expect(service.login('other', 'password'))
      .rejects.toThrow('Matrix authentication already in progress');
    expect(createClient).toHaveBeenCalledOnce();

    finishCrypto?.();
    await restore;
    await service.logout();
  });

  it('prevents two service instances from using the same Matrix crypto store', async () => {
    const makeClient = () => {
      let syncListener: ((state: string) => void) | undefined;
      return {
        initRustCrypto: vi.fn().mockResolvedValue(undefined),
        on: vi.fn((_event: string, listener: (state: string) => void) => { syncListener = listener; }),
        off: vi.fn(), startClient: vi.fn(async () => { syncListener?.('PREPARED'); }), stopClient: vi.fn(),
        getRooms: () => [], getRoom: vi.fn(), getCrypto: vi.fn(), sendEvent: vi.fn(),
        logout: vi.fn().mockResolvedValue(undefined), login: vi.fn(),
      };
    };
    const session = { accessToken: 'token', userId: '@same:example.org', deviceId: 'DEVICE' };
    const firstClient = makeClient();
    const secondClient = makeClient();
    const locks = new TestCryptoStoreLockManager();
    const first = new MatrixBoardService('https://matrix.example.org', {
      load: vi.fn().mockResolvedValue(session), save: vi.fn(), clear: vi.fn(),
    }, vi.fn(() => firstClient), locks);
    const secondStore = { load: vi.fn().mockResolvedValue(session), save: vi.fn(), clear: vi.fn() };
    const second = new MatrixBoardService('https://matrix.example.org', secondStore, vi.fn(() => secondClient), locks);

    await first.restore();
    await expect(second.restore()).rejects.toThrow('Matrix crypto store is already in use');
    expect(secondClient.initRustCrypto).not.toHaveBeenCalled();

    first.dispose();
    expect(firstClient.stopClient).toHaveBeenCalledOnce();
    await expect(second.restore()).resolves.toMatchObject({ userId: '@same:example.org' });
    await second.logout();
  });

  it('fails closed before crypto initialization when Web Locks are unavailable', async () => {
    const client = serviceClientShell();
    const session = { accessToken: 'token', userId: '@unsupported:example.org', deviceId: 'D' };
    const service = new MatrixBoardService('https://matrix.example.org', {
      load: vi.fn().mockResolvedValue(session), save: vi.fn(), clear: vi.fn().mockResolvedValue(undefined),
    }, vi.fn(() => client), null);

    await expect(service.restore()).rejects.toThrow('Web Locks API is required');
    expect(client.initRustCrypto).not.toHaveBeenCalled();
  });

  it('does not reconnect after disposal while waiting for a crypto-store lock', async () => {
    let grantLock: (() => void) | undefined;
    const locks = {
      async request(
        _name: string,
        _options: { mode: 'exclusive'; ifAvailable: true },
        callback: (lock: object | null) => Promise<void>,
      ): Promise<void> {
        await new Promise<void>((resolve) => { grantLock = resolve; });
        await callback({});
      },
    };
    let syncListener: ((state: string) => void) | undefined;
    const client = {
      ...serviceClientShell(),
      initRustCrypto: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((_event: string, listener: (state: string) => void) => { syncListener = listener; }),
      startClient: vi.fn(async () => { syncListener?.('PREPARED'); }),
    };
    const session = { accessToken: 'token', userId: '@lock-wait:example.org', deviceId: 'D' };
    const createClient = vi.fn(() => client);
    const service = new MatrixBoardService('https://matrix.example.org', {
      load: vi.fn().mockResolvedValue(session), save: vi.fn(), clear: vi.fn(),
    }, createClient, locks);

    const restore = service.restore();
    await vi.waitFor(() => expect(grantLock).toBeTypeOf('function'));
    service.dispose();
    grantLock?.();
    try {
      await expect(restore).rejects.toThrow('Matrix connection was disposed');
      expect(createClient).not.toHaveBeenCalled();
      expect(client.initRustCrypto).not.toHaveBeenCalled();
    } finally {
      service.dispose();
    }
  });

  it('does not leak a crypto-store claim when client creation throws', async () => {
    const factoryError = new Error('client factory failed');
    const session = { accessToken: 'token', userId: '@factory:example.org', deviceId: 'D' };
    const cleanupClient = { ...serviceClientShell(), logout: vi.fn().mockResolvedValue(undefined) };
    const failedFactory = vi.fn()
      .mockImplementationOnce(() => { throw factoryError; })
      .mockReturnValueOnce(cleanupClient);
    const failed = new MatrixBoardService('https://matrix.example.org', {
      load: vi.fn().mockResolvedValue(session), save: vi.fn(), clear: vi.fn(),
    }, failedFactory);
    let syncListener: ((state: string) => void) | undefined;
    const replacementClient = {
      ...serviceClientShell(), initRustCrypto: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((_event: string, listener: (state: string) => void) => { syncListener = listener; }),
      startClient: vi.fn(async () => { syncListener?.('PREPARED'); }),
    };
    const replacement = new MatrixBoardService('https://matrix.example.org', {
      load: vi.fn().mockResolvedValue(session), save: vi.fn(), clear: vi.fn(),
    }, vi.fn(() => replacementClient));

    await expect(failed.restore()).rejects.toBe(factoryError);
    await expect(replacement.restore()).resolves.toMatchObject({ userId: '@factory:example.org' });
    replacement.dispose();
  });

  it('keeps a crypto-store claim until an in-flight disposed connection stops', async () => {
    let finishCrypto: (() => void) | undefined;
    const session = { accessToken: 'token', userId: '@pending:example.org', deviceId: 'D' };
    const pendingClient = {
      initRustCrypto: vi.fn(() => new Promise<void>((resolve) => { finishCrypto = resolve; })),
      on: vi.fn(), off: vi.fn(), startClient: vi.fn(), stopClient: vi.fn(),
      getRooms: () => [], getRoom: vi.fn(), getCrypto: vi.fn(), sendEvent: vi.fn(), logout: vi.fn(), login: vi.fn(),
    };
    let syncListener: ((state: string) => void) | undefined;
    const replacementClient = {
      initRustCrypto: vi.fn(), on: vi.fn((_event: string, listener: (state: string) => void) => { syncListener = listener; }),
      off: vi.fn(), startClient: vi.fn(async () => { syncListener?.('PREPARED'); }), stopClient: vi.fn(),
      getRooms: () => [], getRoom: vi.fn(), getCrypto: vi.fn(), sendEvent: vi.fn(), logout: vi.fn(), login: vi.fn(),
    };
    const locks = new TestCryptoStoreLockManager();
    const pending = new MatrixBoardService('https://matrix.example.org', {
      load: vi.fn().mockResolvedValue(session), save: vi.fn(), clear: vi.fn(),
    }, vi.fn(() => pendingClient), locks);
    const replacement = new MatrixBoardService('https://matrix.example.org', {
      load: vi.fn().mockResolvedValue(session), save: vi.fn(), clear: vi.fn(),
    }, vi.fn(() => replacementClient), locks);

    const pendingRestore = pending.restore();
    await vi.waitFor(() => expect(pendingClient.initRustCrypto).toHaveBeenCalledOnce());
    pending.dispose();
    await expect(replacement.restore()).rejects.toThrow('Matrix crypto store is already in use');

    finishCrypto?.();
    await expect(pendingRestore).rejects.toThrow('Matrix connection was disposed');
    expect(pendingClient.startClient).not.toHaveBeenCalled();
    await expect(replacement.restore()).resolves.toMatchObject({ userId: '@pending:example.org' });
    replacement.dispose();
  });

  it('cancels pending initial sync on dispose and releases its crypto store', async () => {
    let syncListener: ((state: string) => void) | undefined;
    const session = { accessToken: 'token', userId: '@sync-pending:example.org', deviceId: 'D' };
    const pendingClient = {
      ...serviceClientShell(),
      initRustCrypto: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((_event: string, listener: (state: string) => void) => { syncListener = listener; }),
      startClient: vi.fn().mockResolvedValue(undefined),
    };
    let replacementSync: ((state: string) => void) | undefined;
    const replacementClient = {
      ...serviceClientShell(),
      initRustCrypto: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((_event: string, listener: (state: string) => void) => { replacementSync = listener; }),
      startClient: vi.fn(async () => { replacementSync?.('PREPARED'); }),
    };
    const pending = new MatrixBoardService('https://matrix.example.org', {
      load: vi.fn().mockResolvedValue(session), save: vi.fn(), clear: vi.fn(),
    }, vi.fn(() => pendingClient));
    const replacement = new MatrixBoardService('https://matrix.example.org', {
      load: vi.fn().mockResolvedValue(session), save: vi.fn(), clear: vi.fn(),
    }, vi.fn(() => replacementClient));

    const restore = pending.restore();
    await vi.waitFor(() => expect(pendingClient.startClient).toHaveBeenCalledOnce());
    expect(syncListener).toBeTypeOf('function');
    pending.dispose();

    await expect(restore).rejects.toThrow(/disposed|cancelled/);
    await expect(replacement.restore()).resolves.toMatchObject({ userId: '@sync-pending:example.org' });
    replacement.dispose();
  });

  it('bounds disposal while startClient is pending and retains the store until startup settles', async () => {
    let finishStart: (() => void) | undefined;
    let syncListener: ((state: string) => void) | undefined;
    const session = { accessToken: 'token', userId: '@start-pending:example.org', deviceId: 'D' };
    const pendingClient = {
      ...serviceClientShell(), initRustCrypto: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((_event: string, listener: (state: string) => void) => { syncListener = listener; }),
      startClient: vi.fn(() => new Promise<void>((resolve) => { finishStart = resolve; })),
    };
    const cleanupClient = { ...serviceClientShell(), logout: vi.fn().mockResolvedValue(undefined) };
    const pending = new MatrixBoardService('https://matrix.example.org', {
      load: vi.fn().mockResolvedValue(session), save: vi.fn(), clear: vi.fn().mockResolvedValue(undefined),
    }, vi.fn().mockReturnValueOnce(pendingClient).mockReturnValueOnce(cleanupClient));
    let replacementSync: ((state: string) => void) | undefined;
    const replacementClient = {
      ...serviceClientShell(), initRustCrypto: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((_event: string, listener: (state: string) => void) => { replacementSync = listener; }),
      startClient: vi.fn(async () => { replacementSync?.('PREPARED'); }),
    };
    const replacement = new MatrixBoardService('https://matrix.example.org', {
      load: vi.fn().mockResolvedValue(session), save: vi.fn(), clear: vi.fn(),
    }, vi.fn(() => replacementClient));

    const restore = pending.restore();
    await vi.waitFor(() => expect(pendingClient.startClient).toHaveBeenCalledOnce());
    expect(syncListener).toBeTypeOf('function');
    pending.dispose();
    const bounded = await Promise.race([
      restore.then(() => 'resolved', () => 'rejected'),
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 100)),
    ]);
    expect(bounded).toBe('rejected');
    await expect(replacement.restore()).rejects.toThrow('Matrix crypto store is already in use');

    finishStart?.();
    await vi.waitFor(() => expect(pendingClient.stopClient).toHaveBeenCalled());
    await Promise.resolve();
    await Promise.resolve();
    await expect(replacement.restore()).resolves.toMatchObject({ userId: session.userId });
    replacement.dispose();
  });

  it('blocks same-service reconnect while disposed SDK initialization still owns the store', async () => {
    const session = { accessToken: 'token', userId: '@same-service-pending:example.org', deviceId: 'D' };
    const pendingClient = {
      ...serviceClientShell(), initRustCrypto: vi.fn(() => new Promise<void>(() => undefined)),
    };

    const loginClient = {
      ...serviceClientShell(),
      login: vi.fn().mockResolvedValue({ access_token: 'token', user_id: session.userId, device_id: 'D' }),
      logout: vi.fn().mockResolvedValue(undefined),
    };
    const collidingClient = {
      ...serviceClientShell(), initRustCrypto: vi.fn(() => { throw new Error('concurrent crypto access'); }),
    };
    const store = {
      load: vi.fn().mockResolvedValue(session), save: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const factory = vi.fn()
      .mockReturnValueOnce(pendingClient)
      .mockReturnValueOnce(loginClient)
      .mockReturnValueOnce(collidingClient);
    const service = new MatrixBoardService('https://matrix.example.org', store, factory);

    const restore = service.restore();
    await vi.waitFor(() => expect(pendingClient.initRustCrypto).toHaveBeenCalledOnce());
    service.dispose();
    await expect(restore).rejects.toThrow('disposed');
    await expect(service.login('new', 'password')).rejects.toThrow('Matrix crypto store is already in use');
    expect(collidingClient.initRustCrypto).not.toHaveBeenCalled();
  });

  it('times out a stuck SDK initialization without releasing its crypto-store claim', async () => {
    vi.useFakeTimers();
    try {
      const session = { accessToken: 'token', userId: '@never-settles:example.org', deviceId: 'D' };
      const pendingClient = {
        ...serviceClientShell(), initRustCrypto: vi.fn(() => new Promise<void>(() => undefined)),
      };
      const cleanupClient = { ...serviceClientShell(), logout: vi.fn().mockResolvedValue(undefined) };
      const pending = new MatrixBoardService('https://matrix.example.org', {
        load: vi.fn().mockResolvedValue(session), save: vi.fn(), clear: vi.fn().mockResolvedValue(undefined),
      }, vi.fn().mockReturnValueOnce(pendingClient).mockReturnValueOnce(cleanupClient));
      const replacementClient = { ...serviceClientShell(), logout: vi.fn().mockResolvedValue(undefined) };
      const replacement = new MatrixBoardService('https://matrix.example.org', {
        load: vi.fn().mockResolvedValue(session), save: vi.fn(), clear: vi.fn().mockResolvedValue(undefined),
      }, vi.fn(() => replacementClient));

      const restore = pending.restore();
      await vi.advanceTimersByTimeAsync(0);
      expect(pendingClient.initRustCrypto).toHaveBeenCalledOnce();
      const outcome = Promise.race([
        restore.then(() => 'resolved', (error: unknown) => error),
        new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 20_001)),
      ]);
      await vi.advanceTimersByTimeAsync(20_001);
      await expect(outcome).resolves.not.toBe('pending');
      await expect(restore).rejects.toThrow('reload the page');
      await expect(replacement.restore()).rejects.toThrow('Matrix crypto store is already in use');
      expect(replacementClient.initRustCrypto).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['snapshot', 'listener'] as const)('cleans up when post-start %s setup throws', async (failurePoint) => {
    const setupError = new Error(`${failurePoint} setup failed`);
    const session = { accessToken: 'token', userId: `@${failurePoint}:example.org`, deviceId: 'D' };
    let syncListener: ((state: string) => void) | undefined;
    const failedClient = {
      ...serviceClientShell(),
      initRustCrypto: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((event: string, listener: (state: string) => void) => {
        if (event === 'sync') syncListener = listener;
        if (failurePoint === 'listener' && event === 'Room.timeline') throw setupError;
      }),
      startClient: vi.fn(async () => { syncListener?.('PREPARED'); }),
      getRooms: vi.fn(() => {
        if (failurePoint === 'snapshot') throw setupError;
        return [];
      }),
    };
    const cleanupClient = { ...serviceClientShell(), logout: vi.fn().mockResolvedValue(undefined) };
    const failed = new MatrixBoardService('https://matrix.example.org', {
      load: vi.fn().mockResolvedValue(session), save: vi.fn(), clear: vi.fn(),
    }, vi.fn().mockReturnValueOnce(failedClient).mockReturnValueOnce(cleanupClient));
    let replacementSync: ((state: string) => void) | undefined;
    const replacementClient = {
      ...serviceClientShell(), initRustCrypto: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((_event: string, listener: (state: string) => void) => { replacementSync = listener; }),
      startClient: vi.fn(async () => { replacementSync?.('PREPARED'); }),
    };
    const replacement = new MatrixBoardService('https://matrix.example.org', {
      load: vi.fn().mockResolvedValue(session), save: vi.fn(), clear: vi.fn(),
    }, vi.fn(() => replacementClient));

    await expect(failed.restore()).rejects.toBe(setupError);
    expect(failedClient.stopClient).toHaveBeenCalledOnce();
    await expect(replacement.restore()).resolves.toMatchObject({ userId: session.userId });
    replacement.dispose();
  });

  it('releases a failed crypto-store claim even when stopping the client fails', async () => {
    const cryptoError = new Error('crypto failed');
    const stopError = new Error('stop failed');
    const session = { accessToken: 'token', userId: '@failed:example.org', deviceId: 'D' };
    const failedClient = {
      initRustCrypto: vi.fn().mockRejectedValue(cryptoError), on: vi.fn(), off: vi.fn(),
      startClient: vi.fn(), stopClient: vi.fn(() => { throw stopError; }),
      getRooms: () => [], getRoom: vi.fn(), getCrypto: vi.fn(), sendEvent: vi.fn(), logout: vi.fn(), login: vi.fn(),
    };
    let syncListener: ((state: string) => void) | undefined;
    const replacementClient = {
      initRustCrypto: vi.fn(), on: vi.fn((_event: string, listener: (state: string) => void) => { syncListener = listener; }),
      off: vi.fn(), startClient: vi.fn(async () => { syncListener?.('PREPARED'); }), stopClient: vi.fn(),
      getRooms: () => [], getRoom: vi.fn(), getCrypto: vi.fn(), sendEvent: vi.fn(), logout: vi.fn(), login: vi.fn(),
    };
    const failed = new MatrixBoardService('https://matrix.example.org', {
      load: vi.fn().mockResolvedValue(session), save: vi.fn(), clear: vi.fn(),
    }, vi.fn(() => failedClient));
    const replacement = new MatrixBoardService('https://matrix.example.org', {
      load: vi.fn().mockResolvedValue(session), save: vi.fn(), clear: vi.fn(),
    }, vi.fn(() => replacementClient));

    const failure = await failed.restore().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([cryptoError, stopError]);
    await expect(replacement.restore()).resolves.toMatchObject({ userId: '@failed:example.org' });
    replacement.dispose();
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
      userId: '@new:example.org', boards: [], posts: {},
    });
    expect(authClient.login).toHaveBeenCalledWith('m.login.password', {
      identifier: { type: 'm.id.user', user: 'new' },
      password: 'password',
      initial_device_display_name: 'Secure Board Browser',
    });
    expect(store.save).toHaveBeenCalledWith({
      accessToken: 'new-token', userId: '@new:example.org', deviceId: 'NEW',
    });
    service.dispose();
  });

  it('does not connect a login that finishes after the service is disposed', async () => {
    let finishLogin: ((response: { access_token: string; user_id: string; device_id: string }) => void) | undefined;
    const authClient = {
      ...serviceClientShell(),
      login: vi.fn(() => new Promise((resolve) => { finishLogin = resolve; })),
      logout: vi.fn().mockResolvedValue(undefined),
    };
    const connectedClient = {
      ...serviceClientShell(),
      initRustCrypto: vi.fn(() => { throw new Error('unexpected connection after dispose'); }),
    };
    const store = { load: vi.fn(), save: vi.fn(), clear: vi.fn().mockResolvedValue(undefined) };
    const createClient = vi.fn().mockReturnValueOnce(authClient).mockReturnValueOnce(connectedClient);
    const service = new MatrixBoardService('https://matrix.example.org', store, createClient);

    const login = service.login('new', 'password');
    await vi.waitFor(() => expect(authClient.login).toHaveBeenCalledOnce());
    service.dispose();
    finishLogin?.({ access_token: 'new-token', user_id: '@new:example.org', device_id: 'D' });

    await expect(login).rejects.toThrow('Matrix authentication was disposed');
    expect(store.clear).toHaveBeenCalledOnce();
    expect(authClient.logout).toHaveBeenCalledOnce();
    expect(createClient).toHaveBeenCalledOnce();
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

  it('clears and revokes a login token when saving the issued session fails', async () => {
    const saveError = new Error('IndexedDB save failed');
    const clearError = new Error('IndexedDB clear failed');
    const logoutError = new Error('Matrix logout failed');
    const authClient = {
      ...serviceClientShell(),
      login: vi.fn().mockResolvedValue({ access_token: 'new-token', user_id: '@new:example.org', device_id: 'NEW' }),
      logout: vi.fn().mockRejectedValue(logoutError),
    };
    const store = {
      load: vi.fn(), save: vi.fn().mockRejectedValue(saveError), clear: vi.fn().mockRejectedValue(clearError),
    };
    const service = new MatrixBoardService('https://matrix.example.org', store, vi.fn(() => authClient));

    const failure = await service.login('new', 'password').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([saveError, clearError, logoutError]);
    expect(store.clear).toHaveBeenCalledOnce();
    expect(authClient.logout).toHaveBeenCalledOnce();
  });

  it.each([
    [{ access_token: '', user_id: '@new:example.org', device_id: 'NEW' }, 'access token'],
    [{ access_token: 'new\u0000token', user_id: '@new:example.org', device_id: 'NEW' }, 'access token'],
    [{ access_token: 'new-token', user_id: '@new:example..org', device_id: 'NEW' }, 'Matrix user ID'],
    [{ access_token: 'new-token', user_id: '@new:example.org', device_id: '\u007fNEW' }, 'device ID'],
  ])('rejects malformed login credentials before saving (%s)', async (response, field) => {
    const authClient = {
      ...serviceClientShell(), login: vi.fn().mockResolvedValue(response), logout: vi.fn().mockResolvedValue(undefined),
    };
    const store = { load: vi.fn(), save: vi.fn(), clear: vi.fn().mockResolvedValue(undefined) };
    const service = new MatrixBoardService('https://matrix.example.org', store, vi.fn(() => authClient));

    await expect(service.login('new', 'password')).rejects.toThrow(`invalid ${field}`);
    expect(store.save).not.toHaveBeenCalled();
    expect(store.clear).toHaveBeenCalledOnce();
    if (response.access_token && !response.access_token.includes('\u0000')) {
      expect(authClient.logout).toHaveBeenCalledOnce();
    }
  });

  it('preserves a newly saved login session when transient crypto connection fails', async () => {
    const connectionError = new Error('Rust crypto failed');
    const authClient = {
      login: vi.fn().mockResolvedValue({ access_token: 'new-token', user_id: '@new:example.org', device_id: 'NEW' }),
      logout: vi.fn(),
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
    expect(store.clear).not.toHaveBeenCalled();
    expect(authClient.logout).not.toHaveBeenCalled();
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
    await expect(restore).resolves.toEqual({ userId: '@u:example.org', boards: [], posts: {} });
    expect(calls.slice(0, 3)).toEqual(['crypto', 'listen', 'start']);
    service.dispose();
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
    await expect(restore).resolves.toEqual({ userId: '@u:example.org', boards: [], posts: {} });
    service.dispose();
  });

  it('completes registration-token and dummy UIAA then persists and connects the returned session', async () => {
    const challenge = (completed: string[] = []) => Object.assign(new Error('UIAA'), {
      httpStatus: 401,
      data: { session: 'uiaa-session', completed, flows: [{ stages: ['m.login.registration_token', 'm.login.dummy'] }] },
    });
    const registerRequest = vi.fn()
      .mockRejectedValueOnce(challenge())
      .mockRejectedValueOnce(challenge(['m.login.registration_token']))
      .mockResolvedValueOnce({ access_token: 'registered-token', user_id: '@new:example.org', device_id: 'REGISTERED' });
    let syncListener: ((state: string) => void) | undefined;
    const authClient = { registerRequest, logout: vi.fn() };
    const connectedClient = {
      initRustCrypto: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((_event: string, listener: (state: string) => void) => { syncListener = listener; }),
      off: vi.fn(), startClient: vi.fn(async () => { syncListener?.('PREPARED'); }), stopClient: vi.fn(),
      getRooms: () => [], getRoom: vi.fn(), getCrypto: vi.fn(), sendEvent: vi.fn(), logout: vi.fn(), login: vi.fn(),
      registerRequest: vi.fn(), createRoom: vi.fn(), invite: vi.fn(), redactEvent: vi.fn(),
    };
    const store = { load: vi.fn(), save: vi.fn(), clear: vi.fn() };
    const service = new MatrixBoardService('https://matrix.example.org', store, vi.fn()
      .mockReturnValueOnce(authClient).mockReturnValueOnce(connectedClient));

    await expect(service.register('new', 'password', 'invite-token')).resolves.toEqual({
      userId: '@new:example.org', boards: [], posts: {},
    });
    expect(registerRequest).toHaveBeenNthCalledWith(1, {
      username: 'new', password: 'password', initial_device_display_name: 'Secure Board Browser',
    });
    expect(registerRequest).toHaveBeenNthCalledWith(2, expect.objectContaining({
      auth: { type: 'm.login.registration_token', session: 'uiaa-session', token: 'invite-token' },
    }));
    expect(registerRequest).toHaveBeenNthCalledWith(3, expect.objectContaining({
      auth: { type: 'm.login.dummy', session: 'uiaa-session' },
    }));
    expect(store.save).toHaveBeenCalledWith({ accessToken: 'registered-token', userId: '@new:example.org', deviceId: 'REGISTERED' });
    expect(connectedClient.initRustCrypto.mock.invocationCallOrder[0]!)
      .toBeLessThan(connectedClient.startClient.mock.invocationCallOrder[0]!);
    service.dispose();
  });

  it('does not connect a registration that finishes after the service is disposed', async () => {
    const challenge = Object.assign(new Error('UIAA'), {
      httpStatus: 401,
      data: { session: 'uiaa-session', flows: [{ stages: ['m.login.registration_token'] }] },
    });
    let finishRegistration: ((response: { access_token: string; user_id: string; device_id: string }) => void) | undefined;
    const registerRequest = vi.fn()
      .mockRejectedValueOnce(challenge)
      .mockImplementationOnce(() => new Promise((resolve) => { finishRegistration = resolve; }));
    const authClient = {
      ...serviceClientShell(), registerRequest, setAccessToken: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
    };
    const connectedClient = {
      ...serviceClientShell(),
      initRustCrypto: vi.fn(() => { throw new Error('unexpected connection after dispose'); }),
    };
    const store = { load: vi.fn(), save: vi.fn(), clear: vi.fn().mockResolvedValue(undefined) };
    const createClient = vi.fn().mockReturnValueOnce(authClient).mockReturnValueOnce(connectedClient);
    const service = new MatrixBoardService('https://matrix.example.org', store, createClient);

    const registration = service.register('new', 'password', 'invite-token');
    await vi.waitFor(() => expect(registerRequest).toHaveBeenCalledTimes(2));
    service.dispose();
    finishRegistration?.({ access_token: 'registered-token', user_id: '@new:example.org', device_id: 'D' });

    await expect(registration).rejects.toThrow('Matrix authentication was disposed');
    expect(store.save).not.toHaveBeenCalled();
    expect(store.clear).toHaveBeenCalledOnce();
    expect(authClient.logout).toHaveBeenCalledOnce();
    expect(createClient).toHaveBeenCalledOnce();
  });

  it('does not connect a registration disposed while its session is being saved', async () => {
    const challenge = Object.assign(new Error('UIAA'), {
      httpStatus: 401,
      data: { session: 'uiaa-session', flows: [{ stages: ['m.login.registration_token'] }] },
    });
    let finishSave: (() => void) | undefined;
    const registeredSession = { accessToken: 'registered-token', userId: '@new:example.org', deviceId: 'D' };
    const authClient = {
      ...serviceClientShell(),
      registerRequest: vi.fn().mockRejectedValueOnce(challenge).mockResolvedValueOnce({
        access_token: registeredSession.accessToken,
        user_id: registeredSession.userId,
        device_id: registeredSession.deviceId,
      }),
      setAccessToken: vi.fn(), logout: vi.fn().mockResolvedValue(undefined),
    };
    const store = {
      load: vi.fn(),
      save: vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve; })),
      clear: vi.fn().mockResolvedValue(undefined),
    };
    const createClient = vi.fn(() => authClient);
    const service = new MatrixBoardService('https://matrix.example.org', store, createClient);

    const registration = service.register('new', 'password', 'invite-token');
    await vi.waitFor(() => expect(store.save).toHaveBeenCalledOnce());
    service.dispose();
    finishSave?.();

    await expect(registration).rejects.toThrow('Matrix authentication was disposed');
    expect(store.clear).toHaveBeenCalledWith(registeredSession);
    expect(authClient.logout).toHaveBeenCalledOnce();
    expect(createClient).toHaveBeenCalledOnce();
  });

  it('preserves a newly saved registration session when transient crypto connection fails', async () => {
    const challenge = Object.assign(new Error('UIAA'), {
      httpStatus: 401,
      data: { session: 'uiaa-session', flows: [{ stages: ['m.login.registration_token'] }] },
    });
    const connectionError = new Error('Rust crypto unavailable');
    const authClient = {
      ...serviceClientShell(),
      registerRequest: vi.fn().mockRejectedValueOnce(challenge).mockResolvedValueOnce({
        access_token: 'registered-token', user_id: '@new:example.org', device_id: 'REGISTERED',
      }),
      setAccessToken: vi.fn(), logout: vi.fn(),
    };
    const connectedClient = {
      ...serviceClientShell(), initRustCrypto: vi.fn().mockRejectedValue(connectionError),
    };
    const store = { load: vi.fn(), save: vi.fn(), clear: vi.fn() };
    const service = new MatrixBoardService('https://matrix.example.org', store, vi.fn()
      .mockReturnValueOnce(authClient).mockReturnValueOnce(connectedClient));

    await expect(service.register('new', 'password', 'invite-token')).rejects.toBe(connectionError);
    expect(store.save).toHaveBeenCalledOnce();
    expect(store.clear).not.toHaveBeenCalled();
    expect(authClient.logout).not.toHaveBeenCalled();
    expect(connectedClient.stopClient).toHaveBeenCalledOnce();
  });

  it('rejects and revokes an unauthenticated first registration success', async () => {
    const registerRequest = vi.fn().mockResolvedValue({
      access_token: 'unprotected-token', user_id: '@new:example.org', device_id: 'REGISTERED',
    });
    const authClient = {
      ...serviceClientShell(),
      registerRequest,
      setAccessToken: vi.fn(),
      logout: vi.fn().mockResolvedValue(undefined),
    };
    const store = { load: vi.fn(), save: vi.fn(), clear: vi.fn().mockResolvedValue(undefined) };
    const createClient = vi.fn(() => authClient);
    const service = new MatrixBoardService('https://matrix.example.org', store, createClient);

    await expect(service.register('new', 'password', 'invite-token'))
      .rejects.toThrow('Matrix registration completed without registration-token authentication');
    expect(authClient.setAccessToken).toHaveBeenCalledWith('unprotected-token');
    expect(authClient.logout).toHaveBeenCalledOnce();
    expect(store.clear).toHaveBeenCalledOnce();
    expect(store.save).not.toHaveBeenCalled();
    expect(createClient).toHaveBeenCalledOnce();
  });

  it('rejects an empty UIAA session before sending the registration token', async () => {
    const registerRequest = vi.fn().mockRejectedValue(Object.assign(new Error('UIAA'), {
      httpStatus: 401,
      data: { session: '', flows: [{ stages: ['m.login.registration_token'] }] },
    }));
    const authClient = { ...serviceClientShell(), registerRequest };
    const store = { load: vi.fn(), save: vi.fn(), clear: vi.fn() };
    const service = new MatrixBoardService('https://matrix.example.org', store, vi.fn(() => authClient));

    await expect(service.register('new', 'password', 'invite-token')).rejects.toThrow('UIAA');
    expect(registerRequest).toHaveBeenCalledOnce();
    expect(store.save).not.toHaveBeenCalled();
  });

  it.each([
    [{ access_token: '', user_id: '@new:example.org', device_id: 'REGISTERED' }, 'access token'],
    [{ access_token: 'registered-token', user_id: 'new:example.org', device_id: 'REGISTERED' }, 'Matrix user ID'],
    [{ access_token: 'registered-token', user_id: '@new:', device_id: 'REGISTERED' }, 'Matrix user ID'],
    [{ access_token: 'registered-token', user_id: '@new:example.org', device_id: '   ' }, 'device ID'],
  ])('rejects malformed registration credentials %j (%s)', async (response, field) => {
    const challenge = Object.assign(new Error('UIAA'), {
      httpStatus: 401,
      data: { session: 'uiaa-session', flows: [{ stages: ['m.login.registration_token'] }] },
    });
    const registerRequest = vi.fn().mockRejectedValueOnce(challenge).mockResolvedValueOnce(response);
    const authClient = {
      ...serviceClientShell(),
      registerRequest, setAccessToken: vi.fn(), logout: vi.fn().mockResolvedValue(undefined),
    };
    const store = { load: vi.fn(), save: vi.fn(), clear: vi.fn().mockResolvedValue(undefined) };
    const service = new MatrixBoardService('https://matrix.example.org', store, vi.fn(() => authClient));

    await expect(service.register('new', 'password', 'invite-token'))
      .rejects.toThrow(`valid ${field}`);
    expect(store.clear).toHaveBeenCalledOnce();
    expect(store.save).not.toHaveBeenCalled();
    if (response.access_token) expect(authClient.logout).toHaveBeenCalledOnce();
  });

  it('does not use a control-character registration token for cleanup requests', async () => {
    const challenge = Object.assign(new Error('UIAA'), {
      httpStatus: 401,
      data: { session: 'uiaa-session', flows: [{ stages: ['m.login.registration_token'] }] },
    });
    const authClient = {
      ...serviceClientShell(),
      registerRequest: vi.fn().mockRejectedValueOnce(challenge).mockResolvedValueOnce({
        access_token: 'registered\u0000token', user_id: '@new:example.org', device_id: 'REGISTERED',
      }),
      setAccessToken: vi.fn(), logout: vi.fn(),
    };
    const store = { load: vi.fn(), save: vi.fn(), clear: vi.fn().mockResolvedValue(undefined) };
    const service = new MatrixBoardService('https://matrix.example.org', store, vi.fn(() => authClient));

    await expect(service.register('new', 'password', 'invite-token')).rejects.toThrow('invalid access token');
    expect(store.clear).toHaveBeenCalledOnce();
    expect(authClient.setAccessToken).not.toHaveBeenCalled();
    expect(authClient.logout).not.toHaveBeenCalled();
  });

  it('still clears and revokes when registration setAccessToken throws', async () => {
    const saveError = new Error('save failed');
    const tokenError = new Error('set token failed');
    const clearError = new Error('clear failed');
    const logoutError = new Error('logout failed');
    const challenge = Object.assign(new Error('UIAA'), {
      httpStatus: 401,
      data: { session: 'uiaa-session', flows: [{ stages: ['m.login.registration_token'] }] },
    });
    const authClient = {
      ...serviceClientShell(),
      registerRequest: vi.fn().mockRejectedValueOnce(challenge).mockResolvedValueOnce({
        access_token: 'registered-token', user_id: '@new:example.org', device_id: 'REGISTERED',
      }),
      setAccessToken: vi.fn(() => { throw tokenError; }),
      logout: vi.fn().mockRejectedValue(logoutError),
    };
    const store = { load: vi.fn(), save: vi.fn().mockRejectedValue(saveError), clear: vi.fn().mockRejectedValue(clearError) };
    const service = new MatrixBoardService('https://matrix.example.org', store, vi.fn(() => authClient));

    const failure = await service.register('new', 'password', 'invite-token').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([saveError, tokenError, clearError, logoutError]);
    expect(store.clear).toHaveBeenCalledOnce();
    expect(authClient.logout).toHaveBeenCalledOnce();
  });

  it('aggregates session-save failure with local-clear and remote-logout failures', async () => {
    const saveError = new Error('IndexedDB save failed');
    const clearError = new Error('IndexedDB clear failed');
    const logoutError = new Error('Matrix logout failed');
    const challenge = Object.assign(new Error('UIAA'), {
      httpStatus: 401,
      data: { session: 'uiaa-session', flows: [{ stages: ['m.login.registration_token'] }] },
    });
    const authClient = {
      ...serviceClientShell(),
      registerRequest: vi.fn().mockRejectedValueOnce(challenge).mockResolvedValueOnce({
        access_token: 'registered-token', user_id: '@new:example.org', device_id: 'REGISTERED',
      }),
      setAccessToken: vi.fn(),
      logout: vi.fn().mockRejectedValue(logoutError),
    };
    const store = {
      load: vi.fn(), save: vi.fn().mockRejectedValue(saveError), clear: vi.fn().mockRejectedValue(clearError),
    };
    const createClient = vi.fn(() => authClient);
    const service = new MatrixBoardService('https://matrix.example.org', store, createClient);

    const failure = await service.register('new', 'password', 'invite-token').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([saveError, clearError, logoutError]);
    expect(authClient.setAccessToken).toHaveBeenCalledWith('registered-token');
    expect(store.clear).toHaveBeenCalledOnce();
    expect(authClient.logout).toHaveBeenCalledOnce();
    expect(createClient).toHaveBeenCalledOnce();
  });

  it('rejects a registration challenge that switches the UIAA session', async () => {
    const challenge = (session: string, completed: string[] = []) => Object.assign(new Error('UIAA'), {
      httpStatus: 401,
      data: { session, completed, flows: [{ stages: ['m.login.registration_token', 'm.login.dummy'] }] },
    });
    const registerRequest = vi.fn()
      .mockRejectedValueOnce(challenge('session-one'))
      .mockRejectedValue(challenge('session-two', ['m.login.registration_token']));
    const authClient = {
      registerRequest, logout: vi.fn(), initRustCrypto: vi.fn(), startClient: vi.fn(), stopClient: vi.fn(),
      on: vi.fn(), off: vi.fn(), getRooms: () => [], getRoom: vi.fn(), getCrypto: vi.fn(), sendEvent: vi.fn(), login: vi.fn(),
    };
    const service = new MatrixBoardService('https://matrix.example.org', { load: vi.fn(), save: vi.fn(), clear: vi.fn() }, vi.fn(() => authClient));
    await expect(service.register('new', 'password', 'invite-token'))
      .rejects.toThrow('Matrix registration UIAA session changed');
    expect(registerRequest).toHaveBeenCalledTimes(2);
  });

  it('fails registration closed for unsupported UIAA stages without attempting them', async () => {
    const registerRequest = vi.fn().mockRejectedValue(Object.assign(new Error('UIAA'), {
      httpStatus: 401,
      data: { session: 'uiaa-session', flows: [{ stages: ['m.login.terms', 'm.login.registration_token'] }] },
    }));
    const authClient = {
      registerRequest, logout: vi.fn(),
      initRustCrypto: vi.fn(), startClient: vi.fn(), stopClient: vi.fn(), on: vi.fn(), off: vi.fn(),
      getRooms: () => [], getRoom: vi.fn(), getCrypto: vi.fn(), sendEvent: vi.fn(), login: vi.fn(),
    };
    const store = { load: vi.fn(), save: vi.fn(), clear: vi.fn() };
    const service = new MatrixBoardService('https://matrix.example.org', store, vi.fn(() => authClient));

    await expect(service.register('new', 'password', 'invite-token'))
      .rejects.toThrow('Unsupported Matrix registration flow');
    expect(registerRequest).toHaveBeenCalledOnce();
    expect(store.save).not.toHaveBeenCalled();
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
    expect(store.clear).toHaveBeenCalledWith({ accessToken: 'token', userId: '@u:example.org', deviceId: 'D' });
    await expect(service.sendPost('!room:example.org', 'message')).rejects.toThrow('No Matrix session');
  });
});
