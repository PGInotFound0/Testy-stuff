import { createClient } from 'matrix-js-sdk';
import { validateMatrixSession, type MatrixSession, type SessionStore } from '../auth/session';
import { mapPrivateBoards, type MatrixRoomSummary } from '../domain/boards';
import { buildBoardPosts, type BoardPost, type MatrixMessageEventLike } from '../domain/posts';
import type { BoardAppService, Workspace } from '../ui/App';
import { cryptoDatabasePrefix, initializeMatrixCrypto, MatrixBoardGateway } from './client';

interface StateEventLike { getContent(): Record<string, unknown> }
interface RoomLike {
  roomId: string;
  name: string;
  getMyMembership(): string;
  hasEncryptionStateEvent(): boolean;
  currentState: { getStateEvents(type: string, stateKey?: string): StateEventLike | null };
  getLiveTimeline?(): { getEvents(): MatrixMessageEventLike[] };
  getThreads?(): Array<{
    timeline?: MatrixMessageEventLike[];
    liveTimeline?: { getEvents(): MatrixMessageEventLike[] };
  }>;
}

interface ServiceMatrixClient {
  initRustCrypto(options: { useIndexedDB: boolean; cryptoDatabasePrefix: string }): Promise<void>;
  startClient(): Promise<void>;
  stopClient(): void;
  on(event: string, listener: (...args: never[]) => void): void;
  off(event: string, listener: (...args: never[]) => void): void;
  getRooms(): RoomLike[];
  getRoom(roomId: string): RoomLike | null;
  getCrypto(): { isEncryptionEnabledInRoom(roomId: string): Promise<boolean> } | undefined;
  sendEvent(roomId: string, eventType: 'm.room.message', content: object): Promise<unknown>;
  logout(stopClient?: boolean): Promise<unknown>;
  login(loginType: string, data: Record<string, unknown>): Promise<{
    access_token: string; user_id: string; device_id: string;
  }>;
  registerRequest?(data: Record<string, unknown>): Promise<{
    access_token: string; user_id: string; device_id: string;
  }>;
  createRoom?(options: Record<string, unknown>): Promise<{ room_id: string }>;
  invite?(roomId: string, userId: string): Promise<unknown>;
  redactEvent?(roomId: string, eventId: string): Promise<unknown>;
  setAccessToken?(token: string): void;
}

interface ClientOptions {
  baseUrl: string;
  accessToken?: string;
  userId?: string;
  deviceId?: string;
}

export type MatrixClientFactory = (options: ClientOptions) => ServiceMatrixClient;

interface UiaaData {
  session?: unknown;
  completed?: unknown;
  flows?: unknown;
}

function registrationChallenge(error: unknown): UiaaData | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { httpStatus?: unknown; data?: unknown };
  if (candidate.httpStatus !== 401 || !candidate.data || typeof candidate.data !== 'object') return null;
  return candidate.data as UiaaData;
}


async function registerWithToken(
  client: ServiceMatrixClient,
  username: string,
  password: string,
  token: string,
): Promise<{
  response: { access_token: string; user_id: string; device_id: string };
  tokenAuthenticated: boolean;
}> {
  const registerRequest = client.registerRequest;
  if (!registerRequest) throw new Error('Matrix registration is not supported by this client');
  const base = { username, password, initial_device_display_name: 'Secure Board Browser' };
  let request: Record<string, unknown> = base;
  let uiSession: string | undefined;
  let selectedStages: string[] | undefined;
  let tokenAuthenticated = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return { response: await registerRequest.call(client, request), tokenAuthenticated };
    } catch (error) {
      const challenge = registrationChallenge(error);
      if (!challenge
        || typeof challenge.session !== 'string'
        || challenge.session.length === 0
        || !Array.isArray(challenge.flows)) throw error;
      if (uiSession !== undefined && challenge.session !== uiSession) {
        throw new Error('Matrix registration UIAA session changed');
      }
      const completed = Array.isArray(challenge.completed)
        ? challenge.completed.filter((stage): stage is string => typeof stage === 'string')
        : [];
      const flows = challenge.flows as Array<{ stages?: unknown }>;
      if (!selectedStages) {
        const supported = flows.find((flow) => {
          if (!Array.isArray(flow.stages) || !flow.stages.every((stage) => typeof stage === 'string')) return false;
          const remaining = (flow.stages as string[]).filter((stage) => !completed.includes(stage));
          return remaining.includes('m.login.registration_token')
            && remaining.every((stage) => stage === 'm.login.registration_token' || stage === 'm.login.dummy');
        });
        if (!supported) {
          throw new Error('Unsupported Matrix registration flow: remaining stages must be registration-token and optional dummy');
        }
        selectedStages = [...supported.stages as string[]];
        uiSession = challenge.session;
      } else {
        const stillAdvertised = flows.some((flow) => Array.isArray(flow.stages)
          && (flow.stages as unknown[]).length === selectedStages!.length
          && (flow.stages as unknown[]).every((stage, index) => stage === selectedStages![index]));
        if (!stillAdvertised) throw new Error('Matrix registration UIAA flow changed');
      }
      const next = selectedStages.find((stage) => !completed.includes(stage));
      if (next !== 'm.login.registration_token' && next !== 'm.login.dummy') {
        throw new Error('Unsupported Matrix registration flow: remaining stages must be registration-token and optional dummy');
      }
      request = {
        ...base,
        auth: next === 'm.login.registration_token'
          ? { type: next, session: uiSession, token }
          : { type: next, session: uiSession },
      };
      if (next === 'm.login.registration_token') tokenAuthenticated = true;
    }
  }
  throw new Error('Matrix registration UIAA did not complete');
}

const defaultFactory: MatrixClientFactory = (options) => createClient(options) as unknown as ServiceMatrixClient;
const activeCryptoStores = new Map<string, MatrixBoardService>();

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
  let settled = false;
  let finish: (error?: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    finish = (error?: Error) => {
      if (settled) return;
      settled = true;
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
  void promise.catch(() => undefined);
  return { promise, cancel: () => finish(new Error('Matrix initial sync cancelled')) };
}

export class MatrixBoardService implements BoardAppService {
  private client: ServiceMatrixClient | null = null;
  private pendingClient: ServiceMatrixClient | null = null;
  private pendingSync: ReturnType<typeof initialSync> | null = null;
  private pendingAbort: ((reason: Error) => void) | null = null;
  private pendingConnection: Promise<void> | null = null;
  private gateway: MatrixBoardGateway | null = null;
  private connectionGeneration = 0;
  private authenticationInProgress: 'restore' | 'login' | 'register' | null = null;
  private authenticationGeneration = 0;
  private authenticationSettlement: Promise<void> | null = null;
  private activeCryptoStore: string | null = null;
  private currentWorkspace: Workspace | null = null;
  private readonly subscribers = new Set<(workspace: Workspace) => void>();
  private readonly observedEvents = new Map<string, Map<string, MatrixMessageEventLike>>();
  private readonly ignoredBackfillIds = new Map<string, Set<string>>();
  private liveListeners: Array<[string, (...args: never[]) => void]> = [];

  constructor(
    private readonly homeserverUrl: string,
    private readonly sessions: SessionStore,
    private readonly clientFactory: MatrixClientFactory = defaultFactory,
  ) {}

  private collectRoomEvents(room: RoomLike): MatrixMessageEventLike[] {
    let known = this.observedEvents.get(room.roomId);
    if (!known) {
      known = new Map();
      this.observedEvents.set(room.roomId, known);
    }
    const initial = [
      ...(room.getLiveTimeline?.().getEvents() ?? []),
      ...(room.getThreads?.() ?? []).flatMap((thread) => thread.liveTimeline?.getEvents() ?? thread.timeline ?? []),
    ];
    for (const event of initial) {
      const id = event.getId();
      if (id && !this.ignoredBackfillIds.get(room.roomId)?.has(id)) known.set(id, event);
    }
    return [...known.values()];
  }

  private snapshot(userId: string): Workspace {
    if (!this.client) return { userId, boards: [], posts: {} };
    const rooms = this.client.getRooms();
    const boards = mapPrivateBoards(rooms.map(roomSummary));
    const posts: Record<string, BoardPost[]> = {};
    for (const board of boards) {
      if (!board.encrypted) continue;
      const room = rooms.find((candidate) => candidate.roomId === board.id);
      if (room) posts[board.id] = buildBoardPosts(this.collectRoomEvents(room));
    }
    return { userId, boards, posts };
  }

  private publish(): void {
    if (!this.currentWorkspace) return;
    this.currentWorkspace = this.snapshot(this.currentWorkspace.userId);
    for (const subscriber of this.subscribers) subscriber(this.currentWorkspace);
  }

  private detachLiveListeners(): void {
    const client = this.client;
    if (client) for (const [name, listener] of this.liveListeners) client.off(name, listener);
    this.liveListeners = [];
  }

  private attachLiveListeners(client: ServiceMatrixClient): void {
    this.detachLiveListeners();
    const timeline = ((event: MatrixMessageEventLike, room?: RoomLike, toStartOfTimeline?: boolean, removed?: boolean) => {
      if (toStartOfTimeline) {
        const id = event.getId();
        if (room && id) {
          let ignored = this.ignoredBackfillIds.get(room.roomId);
          if (!ignored) this.ignoredBackfillIds.set(room.roomId, ignored = new Set());
          ignored.add(id);
        }
        return;
      }
      if (room) {
        let known = this.observedEvents.get(room.roomId);
        if (!known) this.observedEvents.set(room.roomId, known = new Map());
        const id = event.getId();
        if (id) removed ? known.delete(id) : known.set(id, event);
      }
      this.publish();
    }) as (...args: never[]) => void;
    const localEcho = ((
      event: MatrixMessageEventLike & { status?: unknown },
      room: RoomLike,
      oldEventId?: string,
    ) => {
      let known = this.observedEvents.get(room.roomId);
      if (!known) this.observedEvents.set(room.roomId, known = new Map());
      if (oldEventId) known.delete(oldEventId);
      const id = event.getId();
      if (id) event.status === 'cancelled' ? known.delete(id) : known.set(id, event);
      this.publish();
    }) as (...args: never[]) => void;
    const refresh = (() => this.publish()) as (...args: never[]) => void;
    this.liveListeners = [
      ['Room.timeline', timeline],
      ['Room.localEchoUpdated', localEcho],
      ['Event.decrypted', refresh],
      ['Room.redaction', refresh],
      ['RoomState.events', refresh],
      ['Room.myMembership', refresh],
    ];
    for (const [name, listener] of this.liveListeners) client.on(name, listener);
  }

  subscribe(listener: (workspace: Workspace) => void): () => void {
    this.subscribers.add(listener);
    return () => { this.subscribers.delete(listener); };
  }

  dispose(): void {
    const client = this.client ?? this.pendingClient;
    const connectionPending = this.pendingClient !== null;
    this.connectionGeneration += 1;
    this.pendingAbort?.(new Error('Matrix connection was disposed'));
    this.detachLiveListeners();
    this.client = null;
    this.gateway = null;
    this.currentWorkspace = null;
    this.observedEvents.clear();
    this.ignoredBackfillIds.clear();
    this.subscribers.clear();
    if (!connectionPending) {
      try {
        client?.stopClient();
      } finally {
        this.releaseCryptoStore();
      }
    }
  }

  private releaseCryptoStore(): void {
    if (this.activeCryptoStore && activeCryptoStores.get(this.activeCryptoStore) === this) {
      activeCryptoStores.delete(this.activeCryptoStore);
    }
    this.activeCryptoStore = null;
  }

  private async waitForSettlement(promise: Promise<void>): Promise<void> {
    let timeout: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error(
            'Matrix SDK cleanup timed out; reload the page before retrying',
          )), 20_000);
        }),
      ]);
    } finally {
      clearTimeout(timeout!);
    }
  }

  private async connect(session: MatrixSession): Promise<Workspace> {
    const client = this.clientFactory({
      baseUrl: this.homeserverUrl,
      accessToken: session.accessToken,
      userId: session.userId,
      deviceId: session.deviceId,
    });
    const storeName = cryptoDatabasePrefix(session);
    const owner = activeCryptoStores.get(storeName);
    if (owner) throw new Error('Matrix crypto store is already in use');
    activeCryptoStores.set(storeName, this);
    this.activeCryptoStore = storeName;
    const generation = ++this.connectionGeneration;
    this.pendingClient = client;
    let sync: ReturnType<typeof initialSync> | undefined;
    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      client.stopClient();
    };
    let abortReject!: (reason: unknown) => void;
    let aborted = false;
    const abortedPromise = new Promise<never>((_resolve, reject) => { abortReject = reject; });
    const abort = (reason: Error) => {
      if (aborted) return;
      aborted = true;
      const failures: unknown[] = [];
      try { sync?.cancel(); } catch (error) { failures.push(error); }
      try { stop(); } catch (error) { failures.push(error); }
      abortReject(failures.length
        ? new AggregateError([reason, ...failures], 'Matrix connection cancellation cleanup failed')
        : reason);
    };
    this.pendingAbort = abort;

    let connected = false;
    const lifecycle = (async (): Promise<Workspace> => {
      try {
        await initializeMatrixCrypto(client, session);
        if (aborted || generation !== this.connectionGeneration) throw new Error('Matrix connection was disposed');
        sync = initialSync(client);
        this.pendingSync = sync;
        await client.startClient();
        await sync.promise;
        if (aborted || generation !== this.connectionGeneration) throw new Error('Matrix connection was disposed');
        this.pendingSync = null;
        this.pendingClient = null;
        this.client = client;
        this.gateway = new MatrixBoardGateway(client);
        this.observedEvents.clear();
        this.ignoredBackfillIds.clear();
        this.currentWorkspace = this.snapshot(session.userId);
        this.attachLiveListeners(client);
        connected = true;
        return this.currentWorkspace;
      } catch (error) {
        const cleanupFailures: unknown[] = [];
        try { sync?.cancel(); } catch (cleanupError) { cleanupFailures.push(cleanupError); }
        try { this.detachLiveListeners(); } catch (cleanupError) { cleanupFailures.push(cleanupError); }
        this.client = null;
        this.gateway = null;
        this.currentWorkspace = null;
        try { stop(); } catch (cleanupError) { cleanupFailures.push(cleanupError); }
        if (cleanupFailures.length) {
          throw new AggregateError([error, ...cleanupFailures], 'Matrix connection cleanup failed');
        }
        throw error;
      } finally {
        if (this.pendingSync === sync) this.pendingSync = null;
        if (this.pendingClient === client) this.pendingClient = null;
        if (!connected) this.releaseCryptoStore();
      }
    })();
    void lifecycle.catch(() => undefined);
    const settlement = lifecycle.then(() => undefined, () => undefined);
    this.pendingConnection = settlement;
    void settlement.finally(() => {
      if (this.pendingConnection === settlement) this.pendingConnection = null;
    });
    const timeout = setTimeout(() => abort(new Error(
      'Matrix SDK initialization timed out; reload the page if cleanup does not complete',
    )), 20_000);
    try {
      return await Promise.race([lifecycle, abortedPromise]);
    } finally {
      clearTimeout(timeout);
      if (this.pendingAbort === abort) this.pendingAbort = null;
    }
  }

  async restore(): Promise<Workspace | null> {
    if (this.authenticationInProgress) {
      if (this.authenticationInProgress === 'restore'
        && this.authenticationGeneration !== this.connectionGeneration
        && this.authenticationSettlement) {
        await this.waitForSettlement(this.authenticationSettlement);
        return this.restore();
      }
      throw new Error('Matrix authentication already in progress');
    }
    if (this.client) throw new Error('Matrix session is already restored');
    this.authenticationInProgress = 'restore';
    const generation = this.connectionGeneration;
    this.authenticationGeneration = generation;
    let finishAuthentication!: () => void;
    const authenticationSettlement = new Promise<void>((resolve) => { finishAuthentication = resolve; });
    this.authenticationSettlement = authenticationSettlement;
    try {
      if (this.pendingConnection) await this.waitForSettlement(this.pendingConnection);
      const stored = await this.sessions.load();
      if (!stored) return null;
      try {
        const session = validateMatrixSession(stored);
        if (generation !== this.connectionGeneration) throw new Error('Matrix authentication was disposed');
        return await this.connect(session);
      } catch (error) {
        const candidate = stored as Partial<MatrixSession>;
        const usableToken = typeof candidate.accessToken === 'string'
          && candidate.accessToken.trim().length > 0
          && !/[\u0000-\u001f\u007f]/u.test(candidate.accessToken);
        const results = await Promise.allSettled([
          Promise.resolve().then(() => this.sessions.clear()),
          ...(usableToken ? [Promise.resolve().then(async () => {
            const authClient = this.clientFactory({
              baseUrl: this.homeserverUrl,
              accessToken: candidate.accessToken,
              ...(typeof candidate.userId === 'string' ? { userId: candidate.userId } : {}),
              ...(typeof candidate.deviceId === 'string' ? { deviceId: candidate.deviceId } : {}),
            });
            await authClient.logout();
          })] : []),
        ]);
        const failures = results
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => result.reason);
        if (failures.length) {
          throw new AggregateError([error, ...failures], 'Matrix session restore cleanup failed');
        }
        throw error;
      }
    } finally {
      this.authenticationInProgress = null;
      if (this.authenticationSettlement === authenticationSettlement) this.authenticationSettlement = null;
      finishAuthentication();
    }
  }

  async login(username: string, password: string): Promise<Workspace> {
    if (this.authenticationInProgress === 'login') throw new Error('Matrix login already in progress');
    if (this.authenticationInProgress) throw new Error('Matrix authentication already in progress');
    if (this.client) throw new Error('Log out before switching Matrix accounts');
    this.authenticationInProgress = 'login';
    const generation = this.connectionGeneration;
    try {
      return await this.performLogin(username, password, generation);
    } finally {
      this.authenticationInProgress = null;
    }
  }

  private async performLogin(username: string, password: string, generation: number): Promise<Workspace> {
    const loginClient = this.clientFactory({ baseUrl: this.homeserverUrl });
    let response: { access_token: string; user_id: string; device_id: string } | undefined;
    try {
      response = await loginClient.login('m.login.password', {
        identifier: { type: 'm.id.user', user: username },
        password,
        initial_device_display_name: 'Secure Board Browser',
      });
      const session = validateMatrixSession({
        accessToken: response.access_token,
        userId: response.user_id,
        deviceId: response.device_id,
      });
      await this.sessions.save(session);
      if (generation !== this.connectionGeneration) throw new Error('Matrix authentication was disposed');
      return await this.connect(session);
    } catch (error) {
      if (!response) throw error;
      const usableToken = typeof response.access_token === 'string'
        && response.access_token.trim().length > 0
        && !/[\u0000-\u001f\u007f]/u.test(response.access_token);
      const results = await Promise.allSettled([
        Promise.resolve().then(() => this.sessions.clear()),
        ...(usableToken ? [Promise.resolve().then(() => loginClient.logout())] : []),
      ]);
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason);
      if (failures.length) {
        throw new AggregateError([error, ...failures], 'Matrix login cleanup failed');
      }
      throw error;
    }
  }

  async register(username: string, password: string, token: string): Promise<Workspace> {
    if (this.authenticationInProgress) throw new Error('Matrix authentication already in progress');
    if (this.client) throw new Error('Log out before registering another Matrix account');
    this.authenticationInProgress = 'register';
    const generation = this.connectionGeneration;
    const authClient = this.clientFactory({ baseUrl: this.homeserverUrl });
    let response: { access_token: string; user_id: string; device_id: string } | undefined;
    try {
      const registration = await registerWithToken(authClient, username, password, token);
      response = registration.response;
      if (generation !== this.connectionGeneration) throw new Error('Matrix authentication was disposed');
      if (!registration.tokenAuthenticated) {
        throw new Error('Matrix registration completed without registration-token authentication');
      }
      const session = validateMatrixSession({
        accessToken: response.access_token,
        userId: response.user_id,
        deviceId: response.device_id,
      });
      await this.sessions.save(session);
      return await this.connect(session);
    } catch (error) {
      if (!response) throw error;
      const accessToken = typeof response.access_token === 'string'
        && response.access_token.trim().length > 0
        && !/[\u0000-\u001f\u007f]/u.test(response.access_token)
        ? response.access_token
        : null;
      const results = await Promise.allSettled([
        ...(accessToken ? [Promise.resolve().then(() => authClient.setAccessToken?.(accessToken))] : []),
        Promise.resolve().then(() => this.sessions.clear()),
        ...(accessToken ? [Promise.resolve().then(() => authClient.logout())] : []),
      ]);
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
        .map((result) => result.reason);
      if (failures.length) {
        throw new AggregateError([error, ...failures], 'Matrix registration cleanup failed');
      }
      throw error;
    } finally {
      this.authenticationInProgress = null;
    }
  }

  async logout(): Promise<void> {
    const client = this.client;
    this.detachLiveListeners();
    this.client = null;
    this.gateway = null;
    this.currentWorkspace = null;
    this.observedEvents.clear();
    this.ignoredBackfillIds.clear();

    const results = await Promise.allSettled([
      Promise.resolve().then(() => client?.logout(false)),
      Promise.resolve().then(() => client?.stopClient()),
      Promise.resolve().then(() => this.sessions.clear()),
    ]);
    this.releaseCryptoStore();
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'Matrix logout cleanup failed');
  }

  async createBoard(name: string): Promise<string> {
    if (!this.gateway) throw new Error('No Matrix session');
    return this.gateway.createBoard(name);
  }

  async inviteMember(roomId: string, userId: string): Promise<void> {
    if (!this.gateway) throw new Error('No Matrix session');
    await this.gateway.inviteMember(roomId, userId);
  }

  async redact(roomId: string, eventId: string): Promise<void> {
    if (!this.gateway) throw new Error('No Matrix session');
    await this.gateway.redact(roomId, eventId);
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
