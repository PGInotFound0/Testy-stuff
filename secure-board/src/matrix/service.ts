import { createClient } from 'matrix-js-sdk';
import type { MatrixSession, SessionStore } from '../auth/session';
import { loginAndSaveSession } from '../auth/session';
import { mapPrivateBoards, type MatrixRoomSummary } from '../domain/boards';
import type { BoardAppService, Workspace } from '../ui/App';
import { initializeMatrixClient, MatrixBoardGateway } from './client';

interface StateEventLike { getContent(): Record<string, unknown> }
interface RoomLike {
  roomId: string;
  name: string;
  getMyMembership(): string;
  hasEncryptionStateEvent(): boolean;
  currentState: { getStateEvents(type: string, stateKey?: string): StateEventLike | null };
}

interface ServiceMatrixClient {
  initRustCrypto(options: { useIndexedDB: boolean; cryptoDatabasePrefix: string }): Promise<void>;
  startClient(): Promise<void>;
  stopClient(): void;
  on(event: string, listener: (state: string) => void): void;
  off(event: string, listener: (state: string) => void): void;
  getRooms(): RoomLike[];
  getCrypto(): { isEncryptionEnabledInRoom(roomId: string): Promise<boolean> } | undefined;
  sendEvent(roomId: string, eventType: 'm.room.message', content: object): Promise<unknown>;
  logout(stopClient?: boolean): Promise<unknown>;
  login(loginType: string, data: Record<string, unknown>): Promise<{
    access_token: string; user_id: string; device_id: string;
  }>;
}

interface ClientOptions {
  baseUrl: string;
  accessToken?: string;
  userId?: string;
  deviceId?: string;
}

export type MatrixClientFactory = (options: ClientOptions) => ServiceMatrixClient;

const defaultFactory: MatrixClientFactory = (options) => createClient(options) as unknown as ServiceMatrixClient;

function roomSummary(room: RoomLike): MatrixRoomSummary {
  const joinRule = room.currentState.getStateEvents('m.room.join_rules', '')?.getContent().join_rule;
  const topic = room.currentState.getStateEvents('m.room.topic', '')?.getContent().topic;
  return {
    roomId: room.roomId,
    name: room.name,
    ...(typeof topic === 'string' ? { topic } : {}),
    membership: room.getMyMembership(),
    ...(typeof joinRule === 'string' ? { joinRule } : {}),
    encrypted: room.hasEncryptionStateEvent(),
  };
}

function initialSync(client: ServiceMatrixClient): { promise: Promise<void>; cancel(): void } {
  let timeout: ReturnType<typeof setTimeout>;
  let listener: (state: string) => void;
  const promise = new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      client.off('sync', listener);
      error ? reject(error) : resolve();
    };
    listener = (state) => {
      if (state === 'PREPARED') finish();
      if (state === 'ERROR') finish(new Error('Matrix initial sync failed'));
    };
    client.on('sync', listener);
    timeout = setTimeout(() => finish(new Error('Matrix initial sync timed out')), 20_000);
  });
  return { promise, cancel: () => { clearTimeout(timeout); client.off('sync', listener); } };
}

export class MatrixBoardService implements BoardAppService {
  private client: ServiceMatrixClient | null = null;
  private gateway: MatrixBoardGateway | null = null;

  constructor(
    private readonly homeserverUrl: string,
    private readonly sessions: SessionStore,
    private readonly clientFactory: MatrixClientFactory = defaultFactory,
  ) {}

  private async connect(session: MatrixSession): Promise<Workspace> {
    const client = this.clientFactory({
      baseUrl: this.homeserverUrl,
      accessToken: session.accessToken,
      userId: session.userId,
      deviceId: session.deviceId,
    });
    const sync = initialSync(client);
    try {
      await initializeMatrixClient(client, session);
      await sync.promise;
    } catch (error) {
      sync.cancel();
      client.stopClient();
      throw error;
    }
    this.client = client;
    this.gateway = new MatrixBoardGateway(client);
    return { userId: session.userId, boards: mapPrivateBoards(client.getRooms().map(roomSummary)) };
  }

  async restore(): Promise<Workspace | null> {
    const session = await this.sessions.load();
    return session ? this.connect(session) : null;
  }

  async login(username: string, password: string): Promise<Workspace> {
    const loginClient = this.clientFactory({ baseUrl: this.homeserverUrl });
    const session = await loginAndSaveSession({
      login: (user, pass) => loginClient.login('m.login.password', {
        identifier: { type: 'm.id.user', user },
        password: pass,
        initial_device_display_name: 'Secure Board Browser',
      }),
    }, this.sessions, username, password);
    try {
      return await this.connect(session);
    } catch (error) {
      const [clearResult] = await Promise.allSettled([
        Promise.resolve().then(() => this.sessions.clear()),
        Promise.resolve().then(() => loginClient.logout()),
      ]);
      if (clearResult.status === 'rejected') {
        throw new AggregateError([error, clearResult.reason], 'Matrix login cleanup failed');
      }
      throw error;
    }
  }

  async logout(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.gateway = null;

    const results = await Promise.allSettled([
      Promise.resolve().then(() => client?.logout(false)),
      Promise.resolve().then(() => client?.stopClient()),
      Promise.resolve().then(() => this.sessions.clear()),
    ]);
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'Matrix logout cleanup failed');
  }

  async sendPost(roomId: string, body: string): Promise<void> {
    if (!this.gateway) throw new Error('No Matrix session');
    await this.gateway.sendPost(roomId, body);
  }

  async sendReply(
    roomId: string,
    rootEventId: string,
    body: string,
    replyToEventId = rootEventId,
  ): Promise<void> {
    if (!this.gateway) throw new Error('No Matrix session');
    await this.gateway.sendReply(roomId, rootEventId, body, replyToEventId);
  }
}
