import { describe, it, expect } from 'vitest';
import { matchInfra } from '../../src/patterns/infra.js';

describe('infra patterns', () => {
  it('detects IPv4 addresses', () => {
    const hits = matchInfra('server at 192.168.1.50:8080');
    expect(hits).toContainEqual(expect.objectContaining({ type: 'ipv4' }));
  });

  it('detects IPv6 addresses', () => {
    const hits = matchInfra('host: 2001:0db8:85a3::8a2e:0370:7334');
    expect(hits).toContainEqual(expect.objectContaining({ type: 'ipv6' }));
  });

  it('detects internal domains', () => {
    const hits = matchInfra('fetch("https://api.asom.internal/v2/users")');
    expect(hits).toContainEqual(expect.objectContaining({ type: 'internal-url' }));
  });

  it('detects MAC addresses', () => {
    const hits = matchInfra('mac: AA:BB:CC:DD:EE:FF');
    expect(hits).toContainEqual(expect.objectContaining({ type: 'mac' }));
  });

  it('skips localhost and common ranges', () => {
    const hits = matchInfra('http://localhost:3000');
    const ipHits = hits.filter((h) => h.type === 'ipv4');
    expect(ipHits).toHaveLength(0);
  });
});
