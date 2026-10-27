// -----------------------------------------------------------------------------
// The state kept in /data (the only writable place of the container): the
// heating stop asked from Gladys and the address it goes to, so that a
// restart writes it again at once, before the configuration is even read.
// Nothing else: the other held values are never replayed after a restart.
//
// A small JSON file, written through a temporary file and a rename, one save
// after the other (taken from gladys-iskra, approved). A file that exists
// but cannot be read is NOT empty: it is never overwritten (`broken`), and
// the saves fail until it is fixed or removed.
// -----------------------------------------------------------------------------

import { readFileSync, statSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';

export const DEFAULT_STATE_FILE = '/data/ctc-state.json';
/** A larger file is not ours (read bounded). */
const MAX_STATE_BYTES = 64 * 1024;

export function createFileStore(file = DEFAULT_STATE_FILE) {
  let queue = Promise.resolve();
  let broken = false;
  const write = async (data) => {
    if (broken) {
      throw new Error('state file unreadable, not overwritten');
    }
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(data), 'utf8');
    await rename(tmp, file);
  };
  return {
    /** `{ data, ok }`: ok false when the file exists but cannot be read. */
    load() {
      let size;
      try {
        size = statSync(file).size;
      } catch (err) {
        if (err?.code === 'ENOENT') {
          return { data: {}, ok: true };
        }
        broken = true;
        return { data: {}, ok: false };
      }
      try {
        if (size > MAX_STATE_BYTES) {
          throw new Error('too large');
        }
        const data = JSON.parse(readFileSync(file, 'utf8'));
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          throw new Error('not an object');
        }
        return { data, ok: true };
      } catch {
        broken = true;
        return { data: {}, ok: false };
      }
    },
    save(data) {
      const job = queue.then(
        () => write(data),
        () => write(data),
      );
      queue = job.catch(() => {});
      return job;
    },
  };
}

/** The same in memory (tests): `fail` makes the saves fail, `broken` the load. */
export function createMemoryStore(initial = {}, { broken = false } = {}) {
  let data = structuredClone(initial);
  const store = {
    fail: false,
    saves: 0,
    load: () => (broken ? { data: {}, ok: false } : { data: structuredClone(data), ok: true }),
    async save(next) {
      if (store.fail || broken) {
        throw new Error('save failed');
      }
      store.saves += 1;
      data = structuredClone(next);
    },
    get data() {
      return data;
    },
  };
  return store;
}
