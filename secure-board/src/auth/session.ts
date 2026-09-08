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
  const session = {
    accessToken: response.access_token,
    userId: response.user_id,
    deviceId: response.device_id,
  };
  await store.save(session);
  return session;
}
