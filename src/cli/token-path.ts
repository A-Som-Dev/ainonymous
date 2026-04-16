import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir, tmpdir, userInfo } from 'node:os';
import { execFileSync } from 'node:child_process';
import { log } from '../logger.js';

type Platform = NodeJS.Platform;

export function getTokenPath(
  port: number,
  platform: Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (platform === 'win32') {
    const home = env['USERPROFILE'] ?? homedir();
    return join(home, '.ainonymity', `ainonymity-${port}.token`);
  }
  return join(tmpdir(), `ainonymity-${port}.token`);
}

export function ensureTokenDir(tokenFilePath: string, platform: Platform = process.platform): void {
  if (platform !== 'win32') return;
  const dir = dirname(tokenFilePath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}

// Windows-only: strip inheritance and grant RW only to the current user.
// Best effort - if icacls is missing or fails, the default home-dir ACL still
// applies (profile dir is user-only by default on modern Windows).
export function hardenTokenFileAcl(
  tokenFilePath: string,
  platform: Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (platform !== 'win32') return true;
  const user = env['USERNAME']?.trim() || safeUserInfoName();
  if (!user) {
    log.warn('token_acl_harden_skipped', { reason: 'no_username' });
    return false;
  }
  try {
    execFileSync('icacls', [tokenFilePath, '/inheritance:r', '/grant:r', `${user}:(R,W)`], {
      stdio: 'ignore',
    });
    return true;
  } catch (err) {
    log.warn('token_acl_harden_failed', {
      reason: String((err as Error).message ?? err),
      file: tokenFilePath,
    });
    return false;
  }
}

function safeUserInfoName(): string | null {
  try {
    return userInfo().username || null;
  } catch {
    return null;
  }
}
