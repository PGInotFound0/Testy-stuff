import { buildReplyContent } from '../domain/threads';
import { isMatrixUserId, type MatrixSession } from '../auth/session';

export interface CryptoCapableMatrixClient {
  initRustCrypto(options: {
    useIndexedDB: boolean;
    cryptoDatabasePrefix: string;
  }): Promise<void>;
  startClient(): Promise<void>;
}

export function cryptoDatabasePrefix(session: MatrixSession): string {
  return `secure-board-crypto-${session.userId.length}-${session.userId}-${session.deviceId.length}-${session.deviceId}`;
}

export async function initializeMatrixCrypto(
  client: CryptoCapableMatrixClient,
  session: MatrixSession,
): Promise<void> {
  await client.initRustCrypto({
    useIndexedDB: true,
    cryptoDatabasePrefix: cryptoDatabasePrefix(session),
  });
}

export async function initializeMatrixClient(
  client: CryptoCapableMatrixClient,
  session: MatrixSession,
): Promise<void> {
  await initializeMatrixCrypto(client, session);
  await client.startClient();
}

interface BoardMatrixClient {
  getRoom(roomId: string): {
    getMyMembership(): string;
    currentState: {
      getStateEvents(type: string, stateKey?: string): { getContent(): Record<string, unknown> } | null;
    };
  } | null;
  getCrypto(): { isEncryptionEnabledInRoom(roomId: string): Promise<boolean> } | undefined;
  sendEvent(roomId: string, eventType: 'm.room.message', content: object): Promise<unknown>;
  createRoom?(options: {
    name: string;
    visibility: 'private';
    preset: 'private_chat';
    initial_state: Array<{ type: 'm.room.encryption'; state_key: ''; content: { algorithm: 'm.megolm.v1.aes-sha2' } }>;
  }): Promise<{ room_id: string }>;
  invite?(roomId: string, userId: string): Promise<unknown>;
  redactEvent?(roomId: string, eventId: string): Promise<unknown>;
}

export class MatrixBoardGateway {
  constructor(private readonly client: BoardMatrixClient) {}

  private async assertPrivateEncryptedBoard(roomId: string): Promise<void> {
    const room = this.client.getRoom(roomId);
    const joinRule = room?.currentState
      .getStateEvents('m.room.join_rules', '')
      ?.getContent().join_rule;
    if (!room || room.getMyMembership() !== 'join' || joinRule !== 'invite') {
      throw new Error('This room is not an invite-only joined board');
    }

    const crypto = this.client.getCrypto();
    if (!crypto || !(await crypto.isEncryptionEnabledInRoom(roomId))) {
      throw new Error('This board is not encrypted');
    }

    const currentRoom = this.client.getRoom(roomId);
    const currentJoinRule = currentRoom?.currentState
      .getStateEvents('m.room.join_rules', '')
      ?.getContent().join_rule;
    if (!currentRoom || currentRoom.getMyMembership() !== 'join' || currentJoinRule !== 'invite') {
      throw new Error('This room is not an invite-only joined board');
    }
  }

  async createBoard(name: string): Promise<string> {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 80) {
      throw new Error('Board name must be between 1 and 80 characters');
    }
    if (!this.client.createRoom) throw new Error('Matrix room creation is not supported by this client');
    const response = await this.client.createRoom({
      name: trimmed,
      visibility: 'private',
      preset: 'private_chat',
      initial_state: [{
        type: 'm.room.encryption',
        state_key: '',
        content: { algorithm: 'm.megolm.v1.aes-sha2' },
      }],
    });
    if (typeof response.room_id !== 'string'
      || !/^![^:\s\u0000-\u001f\u007f]+:[^\s\u0000-\u001f\u007f]+$/u.test(response.room_id)) {
      throw new Error('Matrix room creation succeeded without a valid Matrix room ID');
    }
    return response.room_id;
  }

  async inviteMember(roomId: string, userId: string): Promise<void> {
    if (!isMatrixUserId(userId)) {
      throw new Error('Enter an exact Matrix user ID such as @name:server.example');
    }
    await this.assertPrivateEncryptedBoard(roomId);
    if (!this.client.invite) throw new Error('Matrix room invitations are not supported by this client');
    await this.client.invite(roomId, userId);
  }

  async redact(roomId: string, eventId: string): Promise<void> {
    await this.assertPrivateEncryptedBoard(roomId);
    if (!this.client.redactEvent) throw new Error('Matrix redaction is not supported by this client');
    await this.client.redactEvent(roomId, eventId);
  }

  async sendPost(roomId: string, body: string): Promise<void> {
    await this.assertPrivateEncryptedBoard(roomId);
    await this.client.sendEvent(roomId, 'm.room.message', { msgtype: 'm.text', body });
  }

  async sendReply(
    roomId: string,
    rootEventId: string,
    body: string,
    replyToEventId = rootEventId,
  ): Promise<void> {
    await this.assertPrivateEncryptedBoard(roomId);
    await this.client.sendEvent(
      roomId,
      'm.room.message',
      buildReplyContent(rootEventId, body, replyToEventId),
    );
  }
}
