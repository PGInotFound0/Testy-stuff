import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

const heldWebLocks = new Set<string>();
Object.defineProperty(navigator, 'locks', {
  configurable: true,
  value: {
    async request(
      name: string,
      _options: { mode: 'exclusive'; ifAvailable: true },
      callback: (lock: object | null) => Promise<void>,
    ): Promise<void> {
      if (heldWebLocks.has(name)) {
        await callback(null);
        return;
      }
      heldWebLocks.add(name);
      try {
        await callback({ name });
      } finally {
        heldWebLocks.delete(name);
      }
    },
  },
});

afterEach(cleanup);
