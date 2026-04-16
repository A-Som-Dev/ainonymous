import { describe, it, expect, beforeAll } from 'vitest';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { initParser } from '../../src/ast/extractor.js';
import { replaceTextInJson, detectApiFormat } from '../../src/proxy/interceptor.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FIXTURE = resolve(__dirname, '../fixtures/sample-request.json');
const OPENAI_FIXTURE = resolve(__dirname, '../fixtures/sample-openai-request.json');

describe('full pipeline integration', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    await initParser();
    pipeline = new Pipeline({
      version: 1,
      secrets: { patterns: [] },
      identity: {
        company: 'Asom GmbH',
        domains: ['asom.de', 'asom.internal'],
        people: ['Artur Sommer'],
      },
      code: {
        language: 'typescript',
        domainTerms: ['Customer'],
        preserve: [],
        sensitivePaths: [],
        redactBodies: [],
      },
      behavior: {
        interactive: false,
        auditLog: true,
        dashboard: false,
        port: 8100,
        upstream: { anthropic: 'https://api.anthropic.com', openai: 'https://api.openai.com' },
      },
    });
  });

  it('anonymizes a realistic API request', async () => {
    const req = JSON.parse(readFileSync(FIXTURE, 'utf8'));
    const sysResult = await pipeline.anonymize(req.system);
    expect(sysResult.text).not.toContain('Asom GmbH');
    expect(sysResult.text).not.toContain('Artur Sommer');
    expect(sysResult.text).not.toContain('artur@asom.de');

    const msgResult = await pipeline.anonymize(req.messages[0].content);
    expect(msgResult.text).not.toContain('hunter2!');
    expect(msgResult.text).not.toContain('asom.internal');
    expect(msgResult.text).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(msgResult.text).toContain('class');
    expect(msgResult.text).toContain('async');
  });

  it('rehydrates a simulated LLM response', async () => {
    await pipeline.anonymize('class CustomerService { getCustomer() {} }');
    const map = pipeline.getSessionMap();
    const custPseudo = map.getByOriginal('Customer');
    if (custPseudo) {
      const llmResponse = `The \`${custPseudo}Service\` class looks good.`;
      const rehydrated = pipeline.rehydrate(llmResponse);
      expect(rehydrated).toContain('Customer');
    }
  });

  it('secrets are never rehydrated', async () => {
    await pipeline.anonymize('password = "hunter2!"');
    const back = pipeline.rehydrate('The ***REDACTED*** should be rotated.');
    expect(back).not.toContain('hunter2!');
  });

  it('anonymizes an OpenAI-format request end-to-end', async () => {
    const req = JSON.parse(readFileSync(OPENAI_FIXTURE, 'utf8'));

    const anonymized = await replaceTextInJson(
      req,
      async (text) => (await pipeline.anonymize(text)).text,
    );

    const out = anonymized as Record<string, unknown>;
    const msgs = out.messages as Array<{ role: string; content: string }>;

    const sysMsg = msgs.find((m) => m.role === 'system');
    expect(sysMsg).toBeDefined();
    expect(sysMsg!.content).not.toContain('Asom GmbH');
    expect(sysMsg!.content).not.toContain('Artur Sommer');
    expect(sysMsg!.content).not.toContain('artur@asom.de');

    const userMsg = msgs.find((m) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(userMsg!.content).not.toContain('hunter2!');
    expect(userMsg!.content).not.toContain('asom.internal');
    expect(userMsg!.content).not.toContain('eyJhbGciOiJIUzI1NiJ9');

    expect(out.model).toBe('gpt-4o');
    expect(out.temperature).toBe(0.7);
  });

  it('detects API format from request path', () => {
    expect(detectApiFormat({}, '/v1/messages')).toBe('anthropic');
    expect(detectApiFormat({}, '/v1/chat/completions')).toBe('openai');
    expect(detectApiFormat({}, '/v1/other')).toBe('unknown');
  });

  it('detects API format from body when path is ambiguous', () => {
    const anthropicBody = { system: 'You are helpful.', messages: [] };
    expect(detectApiFormat(anthropicBody, '/proxy')).toBe('anthropic');

    const openaiBody = { messages: [{ role: 'system', content: 'You are helpful.' }] };
    expect(detectApiFormat(openaiBody, '/proxy')).toBe('openai');
  });

  it('does not anonymize OpenAI scalar fields', async () => {
    const req = {
      model: 'gpt-4o',
      temperature: 0.5,
      presence_penalty: 0.6,
      frequency_penalty: 0.3,
      seed: 42,
      messages: [{ role: 'user', content: 'Tell me about Asom GmbH' }],
    };

    const anonymized = await replaceTextInJson(
      req,
      async (text) => (await pipeline.anonymize(text)).text,
    );

    const out = anonymized as Record<string, unknown>;
    expect(out.model).toBe('gpt-4o');
    expect(out.temperature).toBe(0.5);
    expect(out.presence_penalty).toBe(0.6);
    expect(out.frequency_penalty).toBe(0.3);
    expect(out.seed).toBe(42);
  });
});
