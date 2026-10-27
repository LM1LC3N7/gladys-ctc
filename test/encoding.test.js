// -----------------------------------------------------------------------------
// The texts users and contributors read are UTF-8 without BOM, never mojibake
// nor control bytes, never say "encrypted"; LICENSE names nobody; the image
// ships the license and the notices.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const MOJIBAKE = /[ÂÃ][\u0080-¿€]|â€/;
const FILES = [
  'gladys-assistant-integration.json',
  'docs/en.md',
  'docs/fr.md',
  'README.md',
  'CHANGELOG.md',
  'CLAUDE.md',
  'TODO.md',
  'THIRD_PARTY_NOTICES.md',
  'SECURITY.md',
  'src/i18n.js',
];
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url));
const isControl = (code) => (code < 0x20 && code !== 0x0a && code !== 0x09) || code === 0x7f;

for (const file of FILES) {
  test(`${file}: UTF-8 without BOM, no mojibake, no control byte, never "encrypted"`, () => {
    const bytes = read(file);
    assert.notDeepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM');
    const text = bytes.toString('utf8');
    assert.ok(!text.includes('�'), 'invalid UTF-8');
    const line = text.split('\n').findIndex((l) => MOJIBAKE.test(l));
    assert.equal(line, -1, `mojibake on line ${line + 1}`);
    assert.ok(![...bytes].some(isControl), 'control byte');
    assert.doesNotMatch(text, /chiffr[ée]|encrypt/i);
  });
}

test('the mojibake pattern catches what it should', () => {
  assert.match('FranÃ§ais', MOJIBAKE);
  assert.match('lâ€™app', MOJIBAKE);
  assert.doesNotMatch('Français « Découverte » 800×534 — l’app… 55 °C', MOJIBAKE);
});

test('LICENSE names nobody', () => {
  const license = read('LICENSE').toString('utf8');
  assert.match(license, /Apache License/);
  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/);
  assert.doesNotMatch(license, /Copyright (?:\(c\) )?\d{4}/i);
});

test('the image ships the license and the third-party notices', () => {
  const dockerfile = read('Dockerfile').toString('utf8');
  assert.match(dockerfile, /COPY [^\n]*LICENSE[^\n]*THIRD_PARTY_NOTICES\.md/);
  const notices = read('THIRD_PARTY_NOTICES.md').toString('utf8');
  assert.match(notices, /HA-CTC-Local-Easyconf/);
  assert.match(notices, /Apache License/);
});
