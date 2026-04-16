const GREEK = [
  'Alpha',
  'Beta',
  'Gamma',
  'Delta',
  'Epsilon',
  'Zeta',
  'Eta',
  'Theta',
  'Iota',
  'Kappa',
  'Lambda',
  'Mu',
  'Nu',
  'Xi',
  'Omicron',
  'Pi',
  'Rho',
  'Sigma',
  'Tau',
  'Upsilon',
  'Phi',
  'Chi',
  'Psi',
  'Omega',
] as const;

const DOMAIN_NAMES = GREEK.map((g) => g.toLowerCase());

function greekAt(index: number): string {
  const cycle = Math.floor(index / GREEK.length);
  const name = GREEK[index % GREEK.length];
  return cycle === 0 ? name : `${name}${cycle + 1}`;
}

export class PseudoGen {
  private cache = new Map<string, string>();
  private counters = { email: 0, ipv4: 0, domain: 0, person: 0, identifier: 0 };

  private cached(key: string, generator: () => string): string {
    const existing = this.cache.get(key);
    if (existing !== undefined) return existing;

    const value = generator();
    this.cache.set(key, value);
    return value;
  }

  email(original: string): string {
    return this.cached(`email:${original}`, () => {
      const n = ++this.counters.email;
      const domainWord = DOMAIN_NAMES[(n - 1) % DOMAIN_NAMES.length];
      const cycle = Math.floor((n - 1) / DOMAIN_NAMES.length);
      const suffix = cycle === 0 ? '' : `${cycle + 1}`;
      const tld = original.split('.').pop() ?? 'com';
      return `user${n}@company-${domainWord}${suffix}.${tld}`;
    });
  }

  ipv4(original: string): string {
    return this.cached(`ipv4:${original}`, () => {
      const n = ++this.counters.ipv4;
      const third = Math.floor(n / 256) % 256;
      const fourth = n % 256;
      return `10.0.${third}.${fourth}`;
    });
  }

  domain(original: string): string {
    return this.cached(`domain:${original}`, () => {
      const tld = original.split('.').pop() ?? 'local';
      const word = DOMAIN_NAMES[this.counters.domain % DOMAIN_NAMES.length];
      this.counters.domain++;
      return `${word}-corp.${tld}`;
    });
  }

  person(original: string): string {
    return this.cached(`person:${original}`, () => {
      const name = greekAt(this.counters.person);
      this.counters.person++;
      return `Person ${name}`;
    });
  }

  identifier(original: string): string {
    return this.cached(`identifier:${original}`, () => {
      const name = greekAt(this.counters.identifier);
      this.counters.identifier++;
      return name;
    });
  }

  clear(): void {
    this.cache.clear();
    this.counters = { email: 0, ipv4: 0, domain: 0, person: 0, identifier: 0 };
  }
}
