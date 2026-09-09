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
  const privateRoom = (membership = 'join', joinRule = 'invite') => ({
    getMyMembership: () => membership,
    currentState: {
      getStateEvents: () => ({ getContent: () => ({ join_rule: joinRule }) }),
    },
  });

  it('refuses to send into an unencrypted room', async () => {
    const sendEvent = vi.fn();
    const client = {
      getRoom: () => privateRoom(),
      getCrypto: () => ({ isEncryptionEnabledInRoom: vi.fn().mockResolvedValue(false) }),
      sendEvent,
    };
    const gateway = new MatrixBoardGateway(client);

    await expect(gateway.sendPost('!unsafe:example.org', 'Secret plan'))
      .rejects.toThrow('This board is not encrypted');
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it.each([
    ['leave', 'invite'],
    ['join', 'restricted'],
    ['join', 'knock_restricted'],
  ])('revalidates membership %s and join rule %s immediately before sending', async (membership, joinRule) => {
    const sendEvent = vi.fn();
    const client = {
      getRoom: () => privateRoom(membership, joinRule),
      getCrypto: () => ({ isEncryptionEnabledInRoom: vi.fn().mockResolvedValue(true) }),
      sendEvent,
    };
    const gateway = new MatrixBoardGateway(client);

    await expect(gateway.sendPost('!changed:example.org', 'Secret plan'))
      .rejects.toThrow('This room is not an invite-only joined board');
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it('fails closed when board policy changes during asynchronous encryption validation', async () => {
    let membership = 'join';
    let finishEncryptionCheck: ((encrypted: boolean) => void) | undefined;
    const sendEvent = vi.fn();
    const client = {
      getRoom: () => privateRoom(membership, 'invite'),
      getCrypto: () => ({
        isEncryptionEnabledInRoom: vi.fn(() => new Promise<boolean>((resolve) => { finishEncryptionCheck = resolve; })),
      }),
      sendEvent,
    };
    const gateway = new MatrixBoardGateway(client);

    const sending = gateway.sendPost('!changed:example.org', 'Secret plan');
    await vi.waitFor(() => expect(finishEncryptionCheck).toBeTypeOf('function'));
    membership = 'leave';
    finishEncryptionCheck?.(true);

    await expect(sending).rejects.toThrow('This room is not an invite-only joined board');
    expect(sendEvent).not.toHaveBeenCalled();
  });

  const privateClient = (overrides: Record<string, unknown> = {}) => ({
    getRoom: () => privateRoom(),
    getCrypto: () => ({ isEncryptionEnabledInRoom: vi.fn().mockResolvedValue(true) }),
    sendEvent: vi.fn(), createRoom: vi.fn(), invite: vi.fn(), redactEvent: vi.fn(),
    ...overrides,
  });

  it('creates encryption atomically in a private invite-only room without a plaintext topic', async () => {
    const createRoom = vi.fn().mockResolvedValue({ room_id: '!new:example.org' });
    const gateway = new MatrixBoardGateway(privateClient({ createRoom }));

    await expect(gateway.createBoard('  Tenant Union  ')).resolves.toBe('!new:example.org');
    expect(createRoom).toHaveBeenCalledWith({
      name: 'Tenant Union',
      visibility: 'private',
      preset: 'private_chat',
      initial_state: [{
        type: 'm.room.encryption', state_key: '',
        content: { algorithm: 'm.megolm.v1.aes-sha2' },
      }],
    });
    expect(JSON.stringify(createRoom.mock.calls[0])).not.toContain('topic');
  });

  it('rejects a malformed room ID returned from createRoom', async () => {
    const createRoom = vi.fn().mockResolvedValue({ room_id: '' });
    const gateway = new MatrixBoardGateway(privateClient({ createRoom }));

    await expect(gateway.createBoard('Tenant Union')).rejects.toThrow('valid Matrix room ID');
  });

  it.each(['', '   ', 'x'.repeat(81)])('rejects invalid board name %j before createRoom', async (name) => {
    const createRoom = vi.fn();
    const gateway = new MatrixBoardGateway(privateClient({ createRoom }));
    await expect(gateway.createBoard(name)).rejects.toThrow('Board name must be between 1 and 80 characters');
    expect(createRoom).not.toHaveBeenCalled();
  });

  it('accepts Matrix user IDs with server ports and bracketed IPv6', async () => {
    const invite = vi.fn().mockResolvedValue({});
    const gateway = new MatrixBoardGateway(privateClient({ invite }));

    await gateway.inviteMember('!safe:example.org', '@bob:example.org:8448');
    await gateway.inviteMember('!safe:example.org', '@bob:[2001:db8::1]:8448');

    expect(invite).toHaveBeenNthCalledWith(1, '!safe:example.org', '@bob:example.org:8448');
    expect(invite).toHaveBeenNthCalledWith(2, '!safe:example.org', '@bob:[2001:db8::1]:8448');
  });

  it.each([
    'bob@example.org', '@:example.org', '@bob:', '@bo\u0000b:example.org',
    '@bob:exam\u001fple.org', '@bob:example.org\u007f', '@bob:-example.org',
    '@bob:example..org', '@bob:example.org:0', '@bob:[not-ipv6]',
  ])('rejects malformed Matrix invite user ID %j', async (userId) => {
    const invite = vi.fn();
    const gateway = new MatrixBoardGateway(privateClient({ invite }));

    await expect(gateway.inviteMember('!safe:example.org', userId))
      .rejects.toThrow('Enter an exact Matrix user ID');
    expect(invite).not.toHaveBeenCalled();
  });

  it('redacts an event through the SDK after rechecking board policy', async () => {
    const redactEvent = vi.fn().mockResolvedValue({ event_id: '$redaction' });
    const gateway = new MatrixBoardGateway(privateClient({ redactEvent }));
    await gateway.redact('!safe:example.org', '$message');
    expect(redactEvent).toHaveBeenCalledWith('!safe:example.org', '$message');
  });

  it('sends replies as Matrix thread events in encrypted rooms', async () => {
    const sendEvent = vi.fn().mockResolvedValue({ event_id: '$reply' });
    const client = privateClient({ sendEvent });
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
