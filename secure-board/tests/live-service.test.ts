import { describe, expect, it, vi } from 'vitest';
vi.mock('matrix-js-sdk', () => ({ createClient: vi.fn() }));
import { MatrixBoardService } from '../src/matrix/service';

function message(id: string, body: unknown, relation?: object, type = 'm.room.message') {
  let redacted = false;
  return {
    getId: () => id, getType: () => type,
    getWireType: () => 'm.room.encrypted', isEncrypted: () => true,
    getContent: () => ({ msgtype: 'm.text', body, ...(relation ? { 'm.relates_to': relation } : {}) }),
    getTs: () => id === '$root' ? 1 : 2, getSender: () => '@alice:example.org',
    isRedacted: () => redacted,
    redact: () => { redacted = true; },
  };
}

describe('MatrixBoardService live workspaces', () => {
  it('publishes decrypted posts/replies live and drops content when room policy changes', async () => {
    const root = message('$root', 'Root');
    const malformed = message('$bad', 42);
    let encryptedType = 'm.room.encrypted';
    let encryptedBody = 'ciphertext';
    const encrypted = {
      getId: () => '$encrypted', getType: () => encryptedType,
      getWireType: () => 'm.room.encrypted', isEncrypted: () => true,
      getContent: () => encryptedType === 'm.room.message' ? { msgtype: 'm.text', body: encryptedBody } : {},
      getTs: () => 3, getSender: () => '@alice:example.org', isRedacted: () => false,
    };
    const events = [root, malformed, encrypted];
    let membership = 'join';
    let joinRule = 'invite';
    const room = {
      roomId: '!board:example.org', name: 'Board', getMyMembership: () => membership,
      hasEncryptionStateEvent: () => true,
      currentState: { getStateEvents: (type: string) => ({ getContent: () => type === 'm.room.join_rules' ? { join_rule: joinRule } : {} }) },
      getLiveTimeline: () => ({ getEvents: () => events }), getThreads: () => [],
    };
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const client = {
      initRustCrypto: vi.fn(),
      on: vi.fn((name: string, listener: (...args: unknown[]) => void) => { listeners.set(name, listener); }),
      off: vi.fn((name: string) => { listeners.delete(name); }),
      startClient: vi.fn(async () => { listeners.get('sync')?.('PREPARED'); }), stopClient: vi.fn(),
      getRooms: () => [room], getRoom: () => room,
      getCrypto: () => ({ isEncryptionEnabledInRoom: vi.fn().mockResolvedValue(true) }),
      sendEvent: vi.fn(), logout: vi.fn(), login: vi.fn(), registerRequest: vi.fn(),
      createRoom: vi.fn(), invite: vi.fn(), redactEvent: vi.fn(),
    };
    const store = { load: vi.fn().mockResolvedValue({ accessToken: 't', userId: '@alice:example.org', deviceId: 'D' }), save: vi.fn(), clear: vi.fn() };
    const service = new MatrixBoardService('https://matrix.example.org', store, vi.fn(() => client));
    const initial = await service.restore();
    expect(listeners.has('Event.decrypted')).toBe(true);
    expect(listeners.has('Room.localEchoUpdated')).toBe(true);
    expect(initial?.posts).toEqual({ '!board:example.org': [{ id: '$root', body: 'Root', sender: '@alice:example.org', timestamp: 1, replies: [] }] });

    const updates: unknown[] = [];
    const unsubscribe = service.subscribe((workspace) => updates.push(workspace));
    encryptedType = 'm.room.message';
    encryptedBody = 'Decrypted later';
    listeners.get('Event.decrypted')?.(encrypted);
    expect(updates.at(-1)).toMatchObject({ posts: { '!board:example.org': expect.arrayContaining([
      expect.objectContaining({ id: '$encrypted', body: 'Decrypted later' }),
    ]) } });
    updates.length = 0;

    const backfill = message('$older', 'Historical');
    events.push(backfill);
    listeners.get('Room.timeline')?.(backfill, room, true, false, { liveEvent: false });
    expect(updates).toEqual([]);

    const reply = message('$reply', 'Reply', { rel_type: 'm.thread', event_id: '$root', 'm.in_reply_to': { event_id: '$root' } });
    events.push(reply);
    listeners.get('Room.timeline')?.(reply, room, false, false, { liveEvent: true });
    expect(updates.at(-1)).toMatchObject({ posts: { '!board:example.org': expect.arrayContaining([
      expect.objectContaining({ id: '$root', replies: [expect.objectContaining({ id: '$reply' })] }),
    ]) } });

    joinRule = 'public';
    listeners.get('RoomState.events')?.({}, room.currentState, null);
    expect(updates.at(-1)).toMatchObject({ boards: [], posts: {} });
    unsubscribe();
    membership = 'leave';
    service.dispose();
  });

  it('removes a cancelled local echo instead of retaining stale content', async () => {
    const local = Object.assign(message('~local', 'Pending post'), { status: 'sending' as string | null });
    const events = [local];
    const room = {
      roomId: '!board:example.org', name: 'Board', getMyMembership: () => 'join', hasEncryptionStateEvent: () => true,
      currentState: { getStateEvents: () => ({ getContent: () => ({ join_rule: 'invite' }) }) },
      getLiveTimeline: () => ({ getEvents: () => events }), getThreads: () => [],
    };
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const client = {
      initRustCrypto: vi.fn(), on: vi.fn((name: string, listener: (...args: unknown[]) => void) => listeners.set(name, listener)),
      off: vi.fn((name: string) => listeners.delete(name)),
      startClient: vi.fn(async () => listeners.get('sync')?.('PREPARED')), stopClient: vi.fn(),
      getRooms: () => [room], getRoom: () => room, getCrypto: vi.fn(), sendEvent: vi.fn(),
      logout: vi.fn(), login: vi.fn(), registerRequest: vi.fn(), createRoom: vi.fn(), invite: vi.fn(), redactEvent: vi.fn(),
    };
    const service = new MatrixBoardService('https://matrix.example.org', {
      load: vi.fn().mockResolvedValue({ accessToken: 't', userId: '@local:example.org', deviceId: 'D' }),
      save: vi.fn(), clear: vi.fn(),
    }, vi.fn(() => client));
    expect((await service.restore())?.posts?.['!board:example.org']).toHaveLength(1);
    const updates: unknown[] = [];
    service.subscribe((workspace) => updates.push(workspace));

    events.splice(0, 1);
    local.status = 'cancelled';
    listeners.get('Room.localEchoUpdated')?.(local, room, '~local', 'sending');

    expect(updates.at(-1)).toMatchObject({ posts: { '!board:example.org': [] } });
    service.dispose();
  });

  it('removes redacted events live and detaches Matrix listeners on dispose', async () => {
    const root = message('$root', 'Root');
    const events = [root];
    const room = {
      roomId: '!board:example.org', name: 'Board', getMyMembership: () => 'join', hasEncryptionStateEvent: () => true,
      currentState: { getStateEvents: () => ({ getContent: () => ({ join_rule: 'invite' }) }) },
      getLiveTimeline: () => ({ getEvents: () => events }), getThreads: () => [],
    };
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const client = {
      initRustCrypto: vi.fn(), on: vi.fn((n: string, fn: (...a: unknown[]) => void) => listeners.set(n, fn)),
      off: vi.fn((n: string) => listeners.delete(n)), startClient: vi.fn(async () => listeners.get('sync')?.('PREPARED')), stopClient: vi.fn(),
      getRooms: () => [room], getRoom: () => room, getCrypto: () => ({ isEncryptionEnabledInRoom: vi.fn().mockResolvedValue(true) }),
      sendEvent: vi.fn(), logout: vi.fn(), login: vi.fn(), registerRequest: vi.fn(), createRoom: vi.fn(), invite: vi.fn(), redactEvent: vi.fn(),
    };
    const service = new MatrixBoardService('https://matrix.example.org', { load: vi.fn().mockResolvedValue({ accessToken: 't', userId: '@alice:example.org', deviceId: 'D' }), save: vi.fn(), clear: vi.fn() }, vi.fn(() => client));
    await service.restore();
    await expect(service.login('other', 'password')).rejects.toThrow('Log out before switching Matrix accounts');
    const updates: unknown[] = [];
    service.subscribe((workspace) => updates.push(workspace));
    root.redact();
    listeners.get('Room.redaction')?.({}, room);
    expect(updates.at(-1)).toMatchObject({ posts: { '!board:example.org': [] } });

    service.dispose();
    expect(listeners.has('Room.timeline')).toBe(false);
    expect(listeners.has('Room.redaction')).toBe(false);
    expect(listeners.has('RoomState.events')).toBe(false);
    expect(listeners.has('Room.myMembership')).toBe(false);
  });
});
