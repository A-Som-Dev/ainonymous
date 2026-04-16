type Level = 'debug' | 'info' | 'warn' | 'error';

interface Record_ {
  level: Level;
  ts: string;
  msg: string;
  [key: string]: unknown;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  const rec: Record_ = { level, ts: new Date().toISOString(), msg, ...fields };
  const line = JSON.stringify(rec);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const log = {
  info(msg: string, fields?: Record<string, unknown>): void {
    emit('info', msg, fields);
  },
  warn(msg: string, fields?: Record<string, unknown>): void {
    emit('warn', msg, fields);
  },
  error(msg: string, fields?: Record<string, unknown>): void {
    emit('error', msg, fields);
  },
  debug(msg: string, fields?: Record<string, unknown>): void {
    if (process.env['DEBUG']) emit('debug', msg, fields);
  },
};
