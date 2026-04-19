// Greek alphabet minus the four two-character names (Mu, Nu, Xi, Pi). A
// two-character pseudonym is a substring of common English/German words
// `nu` inside `null`, `pi` inside `pipe`, `xi` inside `exit`, `mu` inside
// `multi`. The rehydrate pass does a plain-string replaceAll, so a two-char
// pseudo will rewrite any literal in the LLM response that happens to
// contain it (e.g. `null` → `matchingll` when `matching` was mapped to
// `nu`). Ensuring every pseudonym is at least three characters long makes
// the collision class impossible without changing the rehydrate algorithm.
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
  'Omicron',
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
  private counters = {
    email: 0,
    ipv4: 0,
    ipv6: 0,
    mac: 0,
    domain: 0,
    person: 0,
    identifier: 0,
    dob: 0,
    ukNi: 0,
    taxId: 0,
    nhs: 0,
    sv: 0,
    phone: 0,
    iban: 0,
    creditCard: 0,
    address: 0,
    personalausweis: 0,
  };

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

  ipv6(original: string): string {
    return this.cached(`ipv6:${original}`, () => {
      const n = ++this.counters.ipv6;
      const g1 = Math.floor(n / 0x1_0000_0000_0000) & 0xffff;
      const g2 = Math.floor(n / 0x1_0000_0000) & 0xffff;
      const g3 = Math.floor(n / 0x1_0000) & 0xffff;
      const g4 = n & 0xffff;
      return `2001:db8:${g1.toString(16)}:${g2.toString(16)}:0:0:${g3.toString(16)}:${g4.toString(16)}`;
    });
  }

  mac(original: string): string {
    return this.cached(`mac:${original}`, () => {
      const n = ++this.counters.mac;
      const octets: string[] = [];
      let rem = n;
      for (let i = 0; i < 6; i++) {
        octets.unshift((rem & 0xff).toString(16).padStart(2, '0'));
        rem = Math.floor(rem / 256);
      }
      octets[0] = '02';
      return octets.join(':');
    });
  }

  dateOfBirth(original: string): string {
    return this.cached(`dob:${original}`, () => {
      const n = ++this.counters.dob;
      const day = String((n % 28) + 1).padStart(2, '0');
      const month = String((Math.floor(n / 28) % 12) + 1).padStart(2, '0');
      const year = 1900 + (Math.floor(n / (28 * 12)) % 120);
      return `${day}.${month}.${year}`;
    });
  }

  ukNationalInsurance(original: string): string {
    return this.cached(`ukni:${original}`, () => {
      const n = ++this.counters.ukNi;
      const d = String(n % 1_000_000).padStart(6, '0');
      return `AA ${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 6)} A`;
    });
  }

  taxId(original: string): string {
    return this.cached(`taxid:${original}`, () => {
      const n = ++this.counters.taxId;
      const full = String(n).padStart(10, '0');
      return `${full.slice(0, 2)}/${full.slice(2, 5)}/${full.slice(5)}`;
    });
  }

  nhsNumber(original: string): string {
    return this.cached(`nhs:${original}`, () => {
      const n = ++this.counters.nhs;
      const full = String(n).padStart(10, '0');
      return `${full.slice(0, 3)} ${full.slice(3, 6)} ${full.slice(6)}`;
    });
  }

  sozialversicherung(original: string): string {
    return this.cached(`sv:${original}`, () => {
      const n = ++this.counters.sv;
      const full = String(n).padStart(8, '0');
      return `00 ${full.slice(0, 6)} A ${full.slice(6)}`;
    });
  }

  phone(original: string): string {
    return this.cached(`phone:${original}`, () => {
      const n = ++this.counters.phone;
      return `+49 30 000-${String(n).padStart(4, '0')}`;
    });
  }

  iban(original: string): string {
    return this.cached(`iban:${original}`, () => {
      const n = ++this.counters.iban;
      return `DE00 0000 0000 0000 0000 ${String(n).padStart(2, '0')}`;
    });
  }

  creditCard(original: string): string {
    return this.cached(`cc:${original}`, () => {
      const n = ++this.counters.creditCard;
      return `****-****-****-${String(n).padStart(4, '0')}`;
    });
  }

  address(original: string): string {
    return this.cached(`address:${original}`, () => {
      const n = ++this.counters.address;
      return `Beispielweg ${n}, 10000 Berlin`;
    });
  }

  personalausweis(original: string): string {
    return this.cached(`pa:${original}`, () => {
      const n = ++this.counters.personalausweis;
      return `L${String(n).padStart(9, '0')}`;
    });
  }

  clear(): void {
    this.cache.clear();
    this.counters = {
      email: 0,
      ipv4: 0,
      ipv6: 0,
      mac: 0,
      domain: 0,
      person: 0,
      identifier: 0,
      dob: 0,
      ukNi: 0,
      taxId: 0,
      nhs: 0,
      sv: 0,
      phone: 0,
      iban: 0,
      creditCard: 0,
      address: 0,
      personalausweis: 0,
    };
  }
}
