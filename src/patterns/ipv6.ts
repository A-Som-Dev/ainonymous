import { isIPv6 } from 'node:net';

const HEX_GROUP_RE = /^[0-9a-f]{1,4}$/;

// Canonicalize an IPv6 literal into the fully expanded, lowercase form (eight
// 4-hex groups joined by ':'). Returns undefined for anything that is not a
// plain IPv6 hex form - zone identifiers (%eth0), IPv4-mapped shortcuts
// (::ffff:1.2.3.4) and ambiguous inputs all opt out so we never produce a
// string that collides with a real canonical form.
export function canonicalIPv6(s: string): string | undefined {
  if (s.includes('%')) return undefined;
  if (s.includes('.')) return undefined;
  if (!isIPv6(s)) return undefined;
  const lower = s.toLowerCase();
  const doubleColon = lower.indexOf('::');
  let groups: string[];
  if (doubleColon === -1) {
    groups = lower.split(':');
  } else {
    const left = lower.slice(0, doubleColon).split(':').filter(Boolean);
    const right = lower
      .slice(doubleColon + 2)
      .split(':')
      .filter(Boolean);
    const missing = 8 - left.length - right.length;
    if (missing < 0) return undefined;
    groups = [...left, ...Array(missing).fill('0'), ...right];
  }
  if (groups.length !== 8) return undefined;
  for (const g of groups) if (!HEX_GROUP_RE.test(g)) return undefined;
  return groups.map((g) => g.padStart(4, '0')).join(':');
}

// Factory for the stateful /g regex - each call site gets its own instance so
// concurrent `rehydrate()` calls from different requests cannot share
// `lastIndex`. The pattern needs at least one ':' inside a hex run to cut
// down false positives on plain hex tokens like git hashes.
export function ipv6CandidateRegex(): RegExp {
  return /[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){2,}/g;
}
