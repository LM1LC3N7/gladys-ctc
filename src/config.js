// -----------------------------------------------------------------------------
// The configuration: the manifest `config_schema` values, normalized so the
// rest of the code never deals with strings typed in a form.
// -----------------------------------------------------------------------------

import { isIP } from 'node:net';
import { DEFAULT_PORT, POLL_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULT_CONFIG = {
  address: '',
  allow_commands: false,
  poll_interval: POLL_INTERVAL.default,
  language: 'fr',
};

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

const isControl = (ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f;
const hasControl = (text) => [...text].some(isControl);
const stripControls = (text) => [...text].map((ch) => (isControl(ch) ? '?' : ch)).join('');

/**
 * The address of the controller typed by the user: an IPv4 address or a
 * host name, with an optional port (502 by default). A pasted URL is
 * reduced to its host and port. Never a broadcast, multicast nor 0.0.0.0.
 * @returns {{ host: string, port: number } | undefined} undefined when invalid or empty.
 */
export function parseAddress(raw) {
  let text = String(raw ?? '')
    .trim()
    .toLowerCase();
  text = text.replace(/^https?:\/\//, '').replace(/[/?#].*$/, '');
  if (text === '' || text.length > 260 || /\s/.test(text) || hasControl(text)) {
    return undefined;
  }
  const match = text.match(/^([^:@]+)(?::(\d{1,5}))?$/);
  if (!match) {
    return undefined;
  }
  const host = match[1];
  const port = match[2] === undefined ? DEFAULT_PORT : Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || host.length > 253) {
    return undefined;
  }
  if (isIP(host) === 4) {
    const octets = host.split('.').map(Number);
    if (
      octets.some((o, i) => String(o) !== host.split('.')[i]) ||
      octets[0] === 0 ||
      octets[0] >= 224 ||
      octets[3] === 255
    ) {
      return undefined;
    }
    return { host, port };
  }
  if (/^[\d.]+$/.test(host)) {
    return undefined;
  }
  return host.split('.').every((label) => LABEL.test(label)) ? { host, port } : undefined;
}

export const addressKey = ({ host, port }) => (port === DEFAULT_PORT ? host : `${host}:${port}`);

export const sameAddress = (a, b) =>
  Boolean(a && b && a.host === b.host && a.port === b.port) || (!a && !b);

/** Only `true` (or the text "true") allows: anything else, missing included, refuses. */
const strictTrue = (value) => value === true || value === 'true';

/** A number typed in the form: a finite number, or undefined ('' and null are not 0). */
function numberOf(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(value)) {
    return Number(value);
  }
  return undefined;
}

export function normalizeConfig(raw = {}) {
  const c = { ...DEFAULT_CONFIG };
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (Object.hasOwn(DEFAULT_CONFIG, key) && value != null) {
      c[key] = value;
    }
  }
  const typed = String(c.address ?? '').trim();
  const address = parseAddress(typed);
  const interval = numberOf(c.poll_interval);
  return {
    address,
    /** What was typed, when it is not a valid address (shown in the status, bounded). */
    invalid: typed !== '' && !address ? stripControls(typed).slice(0, 60) : undefined,
    allowCommands: strictTrue(c.allow_commands),
    pollInterval:
      interval === undefined
        ? POLL_INTERVAL.default
        : Math.min(POLL_INTERVAL.max, Math.max(POLL_INTERVAL.min, Math.round(interval))),
    language: c.language === 'en' ? 'en' : 'fr',
  };
}
