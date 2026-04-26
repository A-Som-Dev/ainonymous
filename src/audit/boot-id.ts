// Linux-only OS boot witness. Folded into the v=2 watermark MAC body so a
// watermark copied across kernel boot sessions breaks signature verification.
// Same-host containers share the host kernel and therefore the boot_id, so
// this is cross-boot defense, not cross-pod. macOS/Windows return null until
// a real native source is wired in (mtime fallbacks lie too easily).
import { existsSync, readFileSync } from 'node:fs';

export function getBootId(): string | null {
  if (process.platform !== 'linux') return null;
  try {
    const path = '/proc/sys/kernel/random/boot_id';
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf-8').trim();
    if (raw.length === 0 || raw.length > 64) return null;
    return `linux:${raw}`;
  } catch {
    return null;
  }
}
