import type { BrowserContext, Page } from 'playwright';
import type { BrowserRunner } from './browser.js';

interface Entry {
  ready: Promise<{ context: BrowserContext; page: Page }>;
  lifetime: Promise<void>;
  release(): void;
  idle?: ReturnType<typeof setTimeout>;
}

// AccountRepository owns serialization. This pool owns browser lifetime only;
// a failed action is returned to the caller and is never replayed.
export function createBrowserPool(runner: BrowserRunner, idleMs = 120000) {
  const entries = new Map<string, Entry>();
  let closed = false;
  const retire = async (directory: string, entry: Entry) => {
    clearTimeout(entry.idle);
    entry.release();
    try {
      await entry.lifetime;
    } finally {
      if (entries.get(directory) === entry) entries.delete(directory);
    }
  };
  const run: BrowserRunner = async (directory, action) => {
    if (closed) throw new Error('Browser pool is closed');
    let entry = entries.get(directory);
    if (!entry) {
      let opened!: (value: { context: BrowserContext; page: Page }) => void;
      let failed!: (error: unknown) => void;
      const ready = new Promise<{ context: BrowserContext; page: Page }>((resolve, reject) => {
        opened = resolve;
        failed = reject;
      });
      let release!: () => void;
      const finished = new Promise<void>((resolve) => {
        release = resolve;
      });
      const lifetime = runner(directory, async (context, page) => {
        context.once('close', release);
        opened({ context, page });
        try {
          await finished;
        } finally {
          context.off('close', release);
        }
      });
      entry = { ready, lifetime, release };
      entries.set(directory, entry);
      const current = entry;
      void lifetime.catch(failed).finally(() => {
        clearTimeout(current.idle);
        if (entries.get(directory) === current) entries.delete(directory);
      });
    }
    clearTimeout(entry.idle);
    try {
      const { context, page } = await entry.ready;
      return await action(context, page);
    } finally {
      if (entries.get(directory) === entry) {
        const current = entry;
        current.idle = setTimeout(() => {
          void retire(directory, current).catch(() => {});
        }, idleMs);
        current.idle.unref();
      }
    }
  };
  return {
    run,
    async close() {
      closed = true;
      await Promise.allSettled([...entries].map(([directory, entry]) => retire(directory, entry)));
    },
  };
}
