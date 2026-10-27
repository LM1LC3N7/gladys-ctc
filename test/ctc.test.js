// -----------------------------------------------------------------------------
// The register map: decoding (signs, markers, pairs, ranges, codes), the
// blocks (within 100 registers, the probe first), the writable addresses.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES as F, LIMITS } from '../src/constants.js';
import {
  BLOCKS,
  CONTROLS,
  IDENTITY,
  PROBE_REGISTER,
  VALUES,
  WRITABLE,
  decode,
  identityOf,
} from '../src/ctc.js';
import { i255Registers } from './fixtures/fakeCtc.js';

const raw = (registers) => new Map(Object.entries(registers).map(([a, w]) => [Number(a), w]));

test('an i255: temperatures signed in tenths, markers dropped, pairs LSB first, codes', () => {
  const v = decode(raw(i255Registers()));
  assert.equal(v[F.TEMP_OUTDOOR], -3.5);
  assert.equal(v[F.TEMP_SUCTION], -8);
  assert.equal(v[F.TEMP_BRINE_IN], undefined, '9999 = no sensor');
  assert.equal(v[F.TEMP_BRINE_OUT], undefined, '-9999 = no sensor');
  assert.equal(v[F.TEMP_ROOM_2], undefined, '32767 = no sensor');
  assert.equal(v[F.DEGREE_MINUTES], -344.7);
  assert.equal(v[F.COMPRESSOR_HOURS], 0x12345);
  assert.equal(v[F.COMPRESSOR_ENERGY], 9166);
  assert.equal(v[F.DHW_CAPACITY], 85.7);
  assert.deepEqual(v[F.HEATPUMP_STATUS], { code: 3, key: 'heating' });
  assert.equal(v[F.COMPRESSOR], 1);
  assert.equal(v[F.DEFROST], 0);
  assert.equal(v[F.ALARM], 0);
  assert.deepEqual(v[F.SYSTEM_STATUS], { code: 4, key: 'heating' });
  assert.deepEqual(v[F.DHW_MODE_SETTING], { code: 1, key: 'normal' });
  assert.equal(v[F.ROOM_SETTING], 21);
});

test('the manual codes, unknown codes kept as codes, missing words unknown', () => {
  const v = decode(raw({ 62005: 7, 62017: 30, 62246: 0 }));
  assert.equal(v[F.SYSTEM_STATUS].key, 'off', 'manual 2026: 7 = Off');
  assert.deepEqual(v[F.HEATPUMP_STATUS], { code: 30, key: undefined });
  assert.equal(v[F.COMPRESSOR], undefined, 'no flag from an unknown code');
  assert.equal(v[F.HEATING_STATUS].key, 'heatingOff');
  assert.equal(decode(new Map())[F.TEMP_OUTDOOR], undefined);
});

test('out of range or a pair of all ones is not a value', () => {
  const v = decode(raw({ 62000: 2000, 62341: 0xffff, 62342: 0xffff, 62214: 5, 62191: 0xffff }));
  assert.equal(v[F.TEMP_OUTDOOR], undefined);
  assert.equal(v[F.COMPRESSOR_ENERGY], undefined);
  assert.equal(v[F.COMPRESSOR_HOURS], undefined, 'half a pair');
  assert.equal(v[F.IMMERSION_ENERGY], undefined);
});

test('the identity: compared as read; markers and zeros are unknown', () => {
  assert.equal(identityOf(1203, 2023), '2023.1203');
  assert.equal(identityOf(0, 0), undefined);
  assert.equal(identityOf(9999, 2023), undefined);
  assert.equal(identityOf(undefined, 2023), undefined);
});

test('the blocks: within 100 registers, the probe first, every value and the identity inside one', () => {
  assert.ok(
    BLOCKS[0].start <= PROBE_REGISTER && PROBE_REGISTER < BLOCKS[0].start + BLOCKS[0].count,
  );
  assert.equal(BLOCKS[0].core, true);
  const inBlock = (address) =>
    BLOCKS.some((b) => address >= b.start && address < b.start + b.count);
  for (const block of BLOCKS) {
    assert.ok(block.count >= 1 && block.count <= LIMITS.registersPerRead, `${block.start}`);
  }
  for (const [role, def] of Object.entries(VALUES)) {
    assert.ok(inBlock(def.address), role);
    if (def.pair) assert.ok(inBlock(def.address + 1), role);
  }
  assert.ok(inBlock(IDENTITY.start) && inBlock(IDENTITY.start + 1));
});

test('only three volatile registers are writable, never the stored settings', () => {
  assert.deepEqual([...WRITABLE].sort(), [1007, 1010, 1015]);
  for (const address of WRITABLE) {
    assert.ok(address >= 1000 && address < 1100);
  }
  assert.equal(CONTROLS[F.HEATING_MODE].options.off, 0);
  assert.equal(CONTROLS[F.HEATING_MODE].options.program, undefined);
});
