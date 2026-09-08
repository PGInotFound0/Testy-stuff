import { describe, expect, it, vi } from 'vitest';
import { initializeMatrixClient, MatrixBoardGateway } from '../src/matrix/client';

describe('initializeMatrixClient', () => {
  it('initializes account-specific Rust IndexedDB crypto before starting sync', async () => {
    const calls: string[] = [];
    const client = {
      initRustCrypto: vi.fn(async () => { calls.push('crypto'); }),
      startClient: vi.fn(async () => { calls.push('start'); }),
    };

    await initializeMatrixClient(client, {
      accessToken: 'token', userId: '@alice:example.org', deviceId: 'ALICE-WEB',
    });

    expect(calls).toEqual(['crypto', 'start']);
    expect(client.initRustCrypto).toHaveBeenCalledWith({
      useIndexedDB: true,
      cryptoDatabasePrefix: 'secure-board-crypto-18-@alice:example.org-9-ALICE-WEB',
    });
  });

  it('uses stable, distinct crypto stores for each Matrix user and device', async () => {
    const prefixes: string[] = [];
    const initialize = async (userId: string, deviceId: string) => initializeMatrixClient({
      initRustCrypto: vi.fn(async ({ cryptoDatabasePrefix }) => { prefixes.push(cryptoDatabasePrefix); }),
      startClient: vi.fn(async () => undefined),
    }, { accessToken: 'token', userId, deviceId });

    await initialize('@alice:example.org', 'WEB');
    await initialize('@alice:example.org', 'PHONE');
    await initialize('@bob:example.org', 'WEB');
    await initialize('@alice:example.org', 'WEB');

    expect(prefixes[0]).not.toBe(prefixes[1]);
    expect(prefixes[0]).not.toBe(prefixes[2]);
    expect(prefixes[0]).toBe(prefixes[3]);
  });

  it('awaits asynchronous Matrix startup', async () => {
    let finishStart: (() => void) | undefined;
    let initialized = false;
    const client = {
      initRustCrypto: vi.fn().mockResolvedValue(undefined),
      startClient: vi.fn(() => new Promise<void>((resolve) => { finishStart = resolve; })),
    };

    const initialization = initializeMatrixClient(client, {
      accessToken: 'token', userId: '@alice:example.org', deviceId: 'WEB',
    }).then(() => { initialized = true; });
    await vi.waitFor(() => expect(client.startClient).toHaveBeenCalled());

    expect(initialized).toBe(false);
    finishStart?.();
    await initialization;
    expect(initialized).toBe(true);
  });
});

describe('MatrixBoardGateway', () => {
  it('refuses to send into an unencrypted room', async () => {
    const sendEvent = vi.fn();
    const client = {
      getCrypto: () => ({ isEncryptionEnabledInRoom: vi.fn().mockResolvedValue(false) }),
      sendEvent,
    };
    const gateway = new MatrixBoardGateway(client);

    await expect(gateway.sendPost('!unsafe:example.org', 'Secret plan'))
      .rejects.toThrow('This board is not encrypted');
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it('sends replies as Matrix thread events in encrypted rooms', async () => {
    const sendEvent = vi.fn().mockResolvedValue({ event_id: '$reply' });
    const client = {
      getCrypto: () => ({ isEncryptionEnabledInRoom: vi.fn().mockResolvedValue(true) }),
      sendEvent,
    };
    const gateway = new MatrixBoardGateway(client);

    await gateway.sendReply('!safe:example.org', '$root', 'I can help', '$latest');

    expect(sendEvent).toHaveBeenCalledWith('!safe:example.org', 'm.room.message', {
      msgtype: 'm.text',
      body: 'I can help',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: '$root',
        is_falling_back: true,
        'm.in_reply_to': { event_id: '$latest' },
      },
    });
  });
});
