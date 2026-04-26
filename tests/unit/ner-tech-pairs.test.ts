import { describe, it, expect } from 'vitest';
import { detectNames } from '../../src/patterns/ner.js';

describe('NER pass-1 rejects tech-only pairs after the prefix trigger', () => {
  it.each([
    ['from Payment Pipeline'],
    ['by the Request Storage'],
    ['from Event Queue'],
    ['by Schema Registry'],
    ['from Order Transaction'],
    ['by the Retry Callback'],
    ['from Payment Session'],
    ['by Storage Bucket'],
    ['from Cache Snapshot'],
  ])('does not flag %s as a person', (text) => {
    const hits = detectNames(text);
    expect(hits).toHaveLength(0);
  });

  it('still detects real names after the same prefix triggers', () => {
    const hits = detectNames('from Peter Müller');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].name).toContain('Müller');
  });
});
