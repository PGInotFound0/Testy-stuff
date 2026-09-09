export interface MatrixSession {
  accessToken: string;
  userId: string;
  deviceId: string;
}

export interface SessionStore {
  load(): Promise<MatrixSession | null>;
  save(session: MatrixSession): Promise<void>;
  clear(): Promise<void>;
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;

function hasValidPort(value: string): boolean {
  if (!/^\d{1,5}$/u.test(value)) return false;
  const port = Number(value);
  return port >= 1 && port <= 65_535;
}

function isValidIpv6(value: string): boolean {
  if (!/^[0-9a-f:]+$/iu.test(value) || value.includes(':::')) return false;
  const halves = value.split('::');
  if (halves.length > 2) return false;
  const groups = halves.flatMap((half) => half ? half.split(':') : []);
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/iu.test(group))) return false;
  return halves.length === 2 ? groups.length < 8 : groups.length === 8;
}

function isValidServerName(value: string): boolean {
  let host = value;
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close < 0 || !isValidIpv6(value.slice(1, close))) return false;
    const suffix = value.slice(close + 1);
    return suffix === '' || (suffix.startsWith(':') && hasValidPort(suffix.slice(1)));
  }
  const colon = value.lastIndexOf(':');
  if (colon >= 0) {
    if (value.indexOf(':') !== colon || !hasValidPort(value.slice(colon + 1))) return false;
    host = value.slice(0, colon);
  }
  if (!host || host.length > 253) return false;
  const labels = host.split('.');
  return labels.every((label) => label.length >= 1
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label));
}

export function isMatrixUserId(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 4 || value !== value.trim()
    || CONTROL_CHARACTERS.test(value) || /\s/u.test(value) || value[0] !== '@') return false;
  const separator = value.indexOf(':', 1);
  if (separator < 2) return false;
  const localpart = value.slice(1, separator);
  return !localpart.includes(':') && isValidServerName(value.slice(separator + 1));
}

function isValidCredential(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && !CONTROL_CHARACTERS.test(value);
}

export function validateMatrixSession(value: unknown): MatrixSession {
  if (!value || typeof value !== 'object') throw new Error('Matrix session is malformed');
  const candidate = value as Partial<Record<keyof MatrixSession, unknown>>;
  if (!isValidCredential(candidate.accessToken)) throw new Error('Matrix session has an invalid access token');
  if (!isMatrixUserId(candidate.userId)) throw new Error('Matrix session has an invalid Matrix user ID');
  if (!isValidCredential(candidate.deviceId)) throw new Error('Matrix session has an invalid device ID');
  return {
    accessToken: candidate.accessToken,
    userId: candidate.userId,
    deviceId: candidate.deviceId,
  };
}

const SESSION_STORE = 'sessions';
const CURRENT_SESSION = 'current';

export class IndexedDbSessionStore implements SessionStore {
  constructor(private readonly databaseName = 'secure-board-session') {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(SESSION_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async load(): Promise<MatrixSession | null> {
    const database = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const request = database.transaction(SESSION_STORE).objectStore(SESSION_STORE).get(CURRENT_SESSION);
        request.onsuccess = () => resolve((request.result as MatrixSession | undefined) ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }

  async save(session: MatrixSession): Promise<void> {
    const database = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(SESSION_STORE, 'readwrite');
        transaction.objectStore(SESSION_STORE).put(session, CURRENT_SESSION);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }

  async clear(): Promise<void> {
    const database = await this.open();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(SESSION_STORE, 'readwrite');
        transaction.objectStore(SESSION_STORE).delete(CURRENT_SESSION);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }
}

interface PasswordAuthenticator {
  login(username: string, password: string): Promise<{
    access_token: string;
    user_id: string;
    device_id: string;
  }>;
}

export async function loginAndSaveSession(
  auth: PasswordAuthenticator,
  store: SessionStore,
  username: string,
  password: string,
): Promise<MatrixSession> {
  const response = await auth.login(username, password);
  const session = validateMatrixSession({
    accessToken: response.access_token,
    userId: response.user_id,
    deviceId: response.device_id,
  });
  await store.save(session);
  return session;
}
