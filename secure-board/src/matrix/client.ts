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

export async function initializeMatrixClient(
  client: CryptoCapableMatrixClient,
  session: MatrixSession,
): Promise<void> {
  await client.initRustCrypto({
    useIndexedDB: true,
    cryptoDatabasePrefix: cryptoDatabasePrefix(session),
  });
  await client.startClient();
}

interface BoardMatrixClient {
  getCrypto(): { isEncryptionEnabledInRoom(roomId: string): Promise<boolean> } | undefined;
  sendEvent(roomId: string, eventType: 'm.room.message', content: object): Promise<unknown>;
}

export class MatrixBoardGateway {
  constructor(private readonly client: BoardMatrixClient) {}

  private async assertEncrypted(roomId: string): Promise<void> {
    const crypto = this.client.getCrypto();
    if (!crypto || !(await crypto.isEncryptionEnabledInRoom(roomId))) {
      throw new Error('This board is not encrypted');
    }
  }

  async sendPost(roomId: string, body: string): Promise<void> {
    await this.assertEncrypted(roomId);
    await this.client.sendEvent(roomId, 'm.room.message', { msgtype: 'm.text', body });
  }

  async sendReply(
    roomId: string,
    rootEventId: string,
    body: string,
    replyToEventId = rootEventId,
  ): Promise<void> {
    await this.assertEncrypted(roomId);
    await this.client.sendEvent(
      roomId,
      'm.room.message',
      buildReplyContent(rootEventId, body, replyToEventId),
    );
  }
}
