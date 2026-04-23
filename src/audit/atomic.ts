import * as fs from 'node:fs';
import { randomBytes } from 'node:crypto';

export function atomicWriteFileSync(path: string, data: string | Uint8Array): void {
  const tmp = `${path}.tmp.${process.pid}.${randomBytes(6).toString('hex')}`;
  if (typeof data === 'string') {
    fs.writeFileSync(tmp, data, 'utf-8');
  } else {
    fs.writeFileSync(tmp, data);
  }
  try {
    fs.renameSync(tmp, path);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore cleanup race */
    }
    throw err;
  }
}
