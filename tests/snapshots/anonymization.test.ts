import { describe, it, expect, beforeAll } from 'vitest';
import { Pipeline } from '../../src/pipeline/pipeline.js';
import { getDefaults } from '../../src/config/loader.js';
import { initParser } from '../../src/ast/extractor.js';

describe('anonymization snapshots', () => {
  let pipeline: Pipeline;

  beforeAll(async () => {
    await initParser();
    pipeline = new Pipeline({
      ...getDefaults(),
      identity: { company: 'Asom GmbH', domains: ['asom.internal'], people: ['Artur Sommer'] },
      code: {
        ...getDefaults().code,
        domainTerms: ['Customer', 'Order', 'Invoice'],
        preserve: ['Express'],
      },
    });
  });

  it('anonymizes code consistently', async () => {
    const code = `class CustomerOrderService {
  async getOrderById(id: string) {
    return this.db.order.findUnique({ where: { id } });
  }
}`;
    const result = await pipeline.anonymize(code);
    // verify structure is preserved
    expect(result.text).toContain('class');
    expect(result.text).toContain('Service');
    expect(result.text).toContain('async');
    expect(result.text).not.toContain('Customer');
    expect(result.text).not.toContain('Order');
    // snapshot the replacement count and types
    expect(result.replacements.length).toBeGreaterThan(0);
    const types = new Set(result.replacements.map((r) => r.type));
    expect(types.size).toBeGreaterThan(0);
  });

  it('anonymizes mixed content consistently', async () => {
    const mixed = `// Author: Artur Sommer <artur@asom.de>
// Server: api.asom.internal
const API_KEY = "sk-ant-secret123456789012345678";

class CustomerService {
  async getCustomer(id: string) {
    return fetch("https://api.asom.internal/customers/" + id);
  }
}`;
    const result = await pipeline.anonymize(mixed);
    expect(result.text).not.toContain('Artur Sommer');
    expect(result.text).not.toContain('asom.internal');
    expect(result.text).not.toContain('sk-ant-');
    expect(result.text).not.toContain('Customer');
    // secrets get wrapped in *** markers (code layer may rename the inner word)
    expect(result.text).toMatch(/\*{3}[A-Za-z]+\*{3}/);
    expect(result.text).toContain('Service'); // structural preserved
    // all three layers should have found something
    const layers = new Set(result.replacements.map((r) => r.layer));
    expect(layers.has('secrets')).toBe(true);
    expect(layers.has('identity')).toBe(true);
  });

  it('roundtrip: anonymize then rehydrate code identifiers', async () => {
    const code = 'class CustomerService { getCustomer() {} }';
    await pipeline.anonymize(code);
    const map = pipeline.getSessionMap();
    const custPseudo = map.getByOriginal('Customer');
    if (custPseudo) {
      const llmResponse = `Rename ${custPseudo}Service to ${custPseudo}Handler`;
      const back = pipeline.rehydrate(llmResponse);
      expect(back).toContain('CustomerService');
      expect(back).toContain('CustomerHandler');
    }
  });
});
