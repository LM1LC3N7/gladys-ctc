// -----------------------------------------------------------------------------
// The /data file: written through a temporary file, read back; a file that
// exists but cannot be read is never taken for empty nor overwritten.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileStore } from '../src/store.js';

async function dir(t) {
  const path = await mkdtemp(join(tmpdir(), 'gladys-ctc-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test('saved then loaded; a missing file is empty and fine', async (t) => {
  const file = join(await dir(t), 'state.json');
  const store = createFileStore(file);
  assert.deepEqual(store.load(), { data: {}, ok: true });
  const data = { version: 1, stop: { host: '192.168.1.80', port: 502, since: 1 } };
  await store.save(data);
  assert.deepEqual(createFileStore(file).load(), { data, ok: true });
});

test('an unreadable file is not empty: never overwritten', async (t) => {
  const file = join(await dir(t), 'state.json');
  await writeFile(file, '{"version":1,"stop":', 'utf8');
  const store = createFileStore(file);
  assert.equal(store.load().ok, false);
  await assert.rejects(store.save({ version: 1 }));
  assert.equal(await readFile(file, 'utf8'), '{"version":1,"stop":');
});

test('a file too large or not an object is not ours', async (t) => {
  const base = await dir(t);
  for (const [name, text] of [
    ['big.json', JSON.stringify({ pad: 'x'.repeat(70 * 1024) })],
    ['array.json', '[1,2]'],
  ]) {
    const file = join(base, name);
    await writeFile(file, text, 'utf8');
    assert.equal(createFileStore(file).load().ok, false, name);
  }
});
