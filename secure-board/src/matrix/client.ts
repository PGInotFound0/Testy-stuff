import { buildReplyContent } from '../domain/threads';
import type { MatrixSession } from '../auth/session';

export interface CryptoCapableMatrixClient {
  initRustCrypto(options: {
    useIndexedDB: boolean;
    cryptoDatabasePrefix: string;
  }): Promise<void>;
  startClient(): Promise<void>;
}

function cryptoDatabasePrefix(session: MatrixSession): string {
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
