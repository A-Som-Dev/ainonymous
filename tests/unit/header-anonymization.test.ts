import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { anonymizeHeaders, PASSTHROUGH_HEADERS } from '../../src/proxy/header-anonymizer.js';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { AuditLogger } from '../../src/audit/logger.js';
import { getDefaults } from '../../src/config/loader.js';
import { initParser } from '../../src/ast/extractor.js';
import type { AInonymityConfig } from '../../src/types.js';

function buildPipeline(cfg?: Partial<AInonymityConfig>): {
  pipeline: Pipeline;
  logger: AuditLogger;
} {
  const base = getDefaults();
  const merged: AInonymityConfig = {
    ...base,
    ...cfg,
    identity: {
      ...base.identity,
      ...(cfg?.identity ?? {}),
    },
    behavior: {
      ...base.behavior,
      ...(cfg?.behavior ?? {}),
      auditLog: false,
    },
  };
  const logger = new AuditLogger();
  return { pipeline: new Pipeline(merged, logger), logger };
}

describe('anonymizeHeaders', () => {
  let pipeline: Pipeline;
  let logger: AuditLogger;

  beforeAll(async () => {
    await initParser();
  });

  beforeEach(() => {
    const p = buildPipeline({
      identity: { company: 'AsomGmbH', domains: ['asom.de'], people: ['Artur Sommer'] },
    });
    pipeline = p.pipeline;
    logger = p.logger;
  });

  it('passes Authorization header through unchanged', async () => {
    const out = await anonymizeHeaders({ authorization: 'Bearer sk-ant-abc123xyz' }, pipeline);
    expect(out['authorization']).toBe('Bearer sk-ant-abc123xyz');
  });

  it('passes x-api-key header through unchanged', async () => {
    const out = await anonymizeHeaders({ 'x-api-key': 'sk-ant-secret-key-value' }, pipeline);
    expect(out['x-api-key']).toBe('sk-ant-secret-key-value');
  });

  it('matches passthrough names case-insensitively', async () => {
    const out = await anonymizeHeaders(
      {
        Authorization: 'Bearer sk-ant-abc',
        'X-API-Key': 'sk-ant-xyz',
        'ANTHROPIC-VERSION': '2023-06-01',
      },
      pipeline,
    );
    expect(out['Authorization']).toBe('Bearer sk-ant-abc');
    expect(out['X-API-Key']).toBe('sk-ant-xyz');
    expect(out['ANTHROPIC-VERSION']).toBe('2023-06-01');
  });

  it('anonymizes custom x-company header value', async () => {
    const out = await anonymizeHeaders({ 'x-company': 'AsomGmbH' }, pipeline);
    const val = out['x-company'];
    expect(typeof val).toBe('string');
    expect(val).not.toBe('AsomGmbH');
    expect(val).not.toContain('AsomGmbH');
  });

  it('anonymizes custom x-user-email header value', async () => {
    const out = await anonymizeHeaders({ 'x-user-email': 'user@asom.de' }, pipeline);
    const val = out['x-user-email'];
    expect(typeof val).toBe('string');
    expect(val).not.toContain('user@asom.de');
    expect(val).not.toContain('asom.de');
  });

  it('redacts secrets that slip into custom headers', async () => {
    const out = await anonymizeHeaders({ 'x-debug-context': 'password=SuperSecret123!' }, pipeline);
    const val = out['x-debug-context'] as string;
    expect(val).toContain('REDACTED');
    expect(val).not.toContain('SuperSecret123');
  });

  it('handles multi-value (array) custom headers', async () => {
    const out = await anonymizeHeaders(
      { 'x-context': ['company=AsomGmbH', 'user=Artur Sommer'] },
      pipeline,
    );
    const val = out['x-context'];
    expect(Array.isArray(val)).toBe(true);
    const arr = val as string[];
    expect(arr).toHaveLength(2);
    expect(arr[0]).not.toContain('AsomGmbH');
    expect(arr[1]).not.toContain('Artur Sommer');
  });

  it('preserves array shape for passthrough headers', async () => {
    const out = await anonymizeHeaders(
      { accept: ['application/json', 'text/event-stream'] },
      pipeline,
    );
    expect(out['accept']).toEqual(['application/json', 'text/event-stream']);
  });

  it('leaves undefined header values alone', async () => {
    const out = await anonymizeHeaders(
      { 'x-custom': undefined, authorization: 'Bearer x' },
      pipeline,
    );
    expect(out['x-custom']).toBeUndefined();
    expect(out['authorization']).toBe('Bearer x');
  });

  it('does not leak raw Authorization header into the audit log', async () => {
    await anonymizeHeaders(
      {
        authorization: 'Bearer sk-ant-verySecretToken123',
        'x-api-key': 'sk-ant-another-secret-key',
        'x-company': 'AsomGmbH',
      },
      pipeline,
    );

    const serialized = JSON.stringify(logger.entries());
    expect(serialized).not.toContain('sk-ant-verySecretToken123');
    expect(serialized).not.toContain('sk-ant-another-secret-key');
    expect(serialized).not.toContain('Bearer ');
    expect(serialized).not.toContain('AsomGmbH');
  });

  it('PASSTHROUGH_HEADERS contains the standard LLM auth/content headers', () => {
    expect(PASSTHROUGH_HEADERS.has('authorization')).toBe(true);
    expect(PASSTHROUGH_HEADERS.has('x-api-key')).toBe(true);
    expect(PASSTHROUGH_HEADERS.has('anthropic-version')).toBe(true);
    expect(PASSTHROUGH_HEADERS.has('content-type')).toBe(true);
    expect(PASSTHROUGH_HEADERS.has('content-length')).toBe(true);
    expect(PASSTHROUGH_HEADERS.has('host')).toBe(true);
  });

  it('user-agent is NOT a passthrough header so company names in UA get anonymized', async () => {
    expect(PASSTHROUGH_HEADERS.has('user-agent')).toBe(false);
    const out = await anonymizeHeaders(
      { 'user-agent': 'Mozilla/5.0 AsomGmbH-InternalBuild Artur Sommer/1.0' },
      pipeline,
    );
    const ua = out['user-agent'] as string;
    expect(typeof ua).toBe('string');
    expect(ua).not.toContain('AsomGmbH');
    expect(ua).not.toContain('Artur Sommer');
  });
});
