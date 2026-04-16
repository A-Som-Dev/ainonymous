import { describe, it, expect, beforeAll } from 'vitest';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { getDefaults } from '../../src/config/loader.js';
import { initParser } from '../../src/ast/extractor.js';

function newPipeline(lang = 'csharp') {
  return new Pipeline({
    ...getDefaults(),
    identity: { company: 'acme', domains: ['acme.com'], people: [] },
    code: { ...getDefaults().code, language: lang, domainTerms: [], preserve: [] },
  });
}

describe('Fence-regex edge cases', () => {
  beforeAll(async () => {
    await initParser();
  });

  it('recognizes c# language tag (hash char in fence label)', async () => {
    const pipeline = newPipeline('csharp');
    const text = ['Hier:', '```c#', 'public class OrderHandler { }', '```'].join('\n');
    const result = await pipeline.anonymize(text);
    expect(result.text).not.toContain('OrderHandler');
  });

  it('recognizes language tag with a dot like `jsx.react`', async () => {
    const pipeline = newPipeline('typescript');
    const text = ['```tsx.react', 'class UserWidget { render() {} }', '```'].join('\n');
    const result = await pipeline.anonymize(text);
    expect(result.text).not.toContain('UserWidget');
  });

  it('handles CRLF line endings in the fence', async () => {
    const pipeline = newPipeline('java');
    const text = ['```java', 'public class CrlfThing { }', '```'].join('\r\n');
    const result = await pipeline.anonymize(text);
    expect(result.text).not.toContain('CrlfThing');
  });

  it('handles mixed fences + inline backticks on same line', async () => {
    const pipeline = newPipeline('java');
    const text = [
      'Sieh `Orchestrator` und',
      '```java',
      'class EventBus {}',
      '```',
      'plus `NotificationRouter`.',
    ].join('\n');
    const result = await pipeline.anonymize(text);
    expect(result.text).not.toContain('Orchestrator');
    expect(result.text).not.toContain('EventBus');
    expect(result.text).not.toContain('NotificationRouter');
  });
});
