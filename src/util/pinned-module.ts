import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const HEX64 = /^[0-9a-f]{64}$/;

export class PinnedModulePinFormatError extends Error {
  constructor(path: string, pin: string) {
    super(`module ${path} sha256 pin must be 64 hex chars (got "${pin}")`);
    this.name = 'PinnedModulePinFormatError';
  }
}

export class PinnedModuleMissingError extends Error {
  constructor(path: string) {
    super(`module not found: ${path}`);
    this.name = 'PinnedModuleMissingError';
  }
}

export interface PinValidatedSource {
  abs: string;
  // Same buffer feeds hash check and data URL, so no TOCTOU swap.
  bytes: Buffer;
  dataUrl: string;
}

export function loadPinnedModuleSource(
  abs: string,
  pin: string | undefined,
  onPinMismatch: (abs: string, expected: string, actual: string) => never,
): PinValidatedSource {
  if (!existsSync(abs)) throw new PinnedModuleMissingError(abs);
  const bytes = readFileSync(abs);
  if (pin !== undefined) {
    const lower = pin.toLowerCase();
    if (!HEX64.test(lower)) throw new PinnedModulePinFormatError(abs, pin);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== lower) onPinMismatch(abs, lower, actual);
  }
  const dataUrl =
    'data:text/javascript;base64,' + bytes.toString('base64') + `#${encodeURIComponent(abs)}`;
  return { abs, bytes, dataUrl };
}
