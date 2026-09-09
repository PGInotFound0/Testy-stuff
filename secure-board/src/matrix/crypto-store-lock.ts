export interface CryptoStoreLockManager {
  request(
    name: string,
    options: { mode: 'exclusive'; ifAvailable: true },
    callback: (lock: object | null) => Promise<void>,
  ): Promise<void>;
}

export interface CryptoStoreLease {
  release(): void;
  readonly settlement: Promise<void>;
}

export function browserCryptoStoreLockManager(): CryptoStoreLockManager | null {
  if (typeof navigator === 'undefined' || !navigator.locks) return null;
  return navigator.locks as unknown as CryptoStoreLockManager;
}

export async function acquireCryptoStoreLease(
  manager: CryptoStoreLockManager | null,
  cryptoDatabasePrefix: string,
): Promise<CryptoStoreLease> {
  if (!manager) {
    throw new Error('Web Locks API is required to safely use Matrix encrypted storage in this browser');
  }

  let release!: () => void;
  let decide!: (granted: boolean) => void;
  let rejectDecision!: (error: unknown) => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  const decision = new Promise<boolean>((resolve, reject) => {
    decide = resolve;
    rejectDecision = reject;
  });
  let callbackStarted = false;
  const settlement = Promise.resolve().then(() => manager.request(
    `secure-board:matrix-crypto:${cryptoDatabasePrefix}`,
    { mode: 'exclusive', ifAvailable: true },
    async (lock) => {
      callbackStarted = true;
      decide(lock !== null);
      if (lock) await hold;
    },
  )).catch((error: unknown) => {
    if (!callbackStarted) rejectDecision(error);
    throw error;
  });
  void settlement.catch(() => undefined);

  let granted: boolean;
  try {
    granted = await decision;
  } catch (error) {
    await settlement.catch(() => undefined);
    throw error;
  }
  if (!granted) {
    await settlement;
    throw new Error('Matrix crypto store is already in use in another browser context');
  }

  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      release();
    },
    settlement,
  };
}
