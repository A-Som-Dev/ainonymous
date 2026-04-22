import { log } from './logger.js';

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

type CounterName =
  | 'email'
  | 'ipv4'
  | 'ipv6'
  | 'mac'
  | 'domain'
  | 'person'
  | 'identifier'
  | 'dob'
  | 'ukNi'
  | 'taxId'
  | 'nhs'
  | 'sv'
  | 'phone'
  | 'iban'
  | 'creditCard'
  | 'address'
  | 'personalausweis'
  | 'ssn'
  | 'zipUs'
  | 'passportUs'
  | 'passportUk'
  | 'dlUs'
  | 'dlUk'
  | 'postcodeUk'
  | 'sinCa'
  | 'tfnAu'
  | 'medicareAu'
  | 'aadhaar'
  | 'pan'
  | 'cpf'
  | 'cnpj'
  | 'curp'
  | 'rfc'
  | 'rrnKr'
  | 'idZa'
  | 'taxIdHu'
  | 'pidHu'
  | 'nikId';

export class PseudoGen {
  private cache = new Map<string, string>();
  private identitySkips = 0;
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
    ssn: 0,
    zipUs: 0,
    passportUs: 0,
    passportUk: 0,
    dlUs: 0,
    dlUk: 0,
    postcodeUk: 0,
    sinCa: 0,
    tfnAu: 0,
    medicareAu: 0,
    aadhaar: 0,
    pan: 0,
    cpf: 0,
    cnpj: 0,
    curp: 0,
    rfc: 0,
    rrnKr: 0,
    idZa: 0,
    taxIdHu: 0,
    pidHu: 0,
    nikId: 0,
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
      let name = `Person ${greekAt(this.counters.person)}`;
      this.counters.person++;
      while (name === original) {
        this.identitySkips++;
        name = `Person ${greekAt(this.counters.person)}`;
        this.counters.person++;
      }
      return name;
    });
  }

  identifier(original: string): string {
    return this.cached(`identifier:${original}`, () => {
      let name = greekAt(this.counters.identifier);
      this.counters.identifier++;
      while (name === original) {
        this.identitySkips++;
        name = greekAt(this.counters.identifier);
        this.counters.identifier++;
      }
      return name;
    });
  }

  identityMapSkips(): number {
    return this.identitySkips;
  }

  /** Sets a baseline so the next generated value for `name` lands at `start`.
   *  Used by the pipeline to reserve a non-overlapping counter block per
   *  process when session persistence is on. Counters are 1-based in the
   *  generator API: passing start=42 means the next bump produces index 42. */
  seedCounter(name: CounterName, start: number): void {
    if (!Number.isInteger(start) || start < 1) {
      log.warn('pseudoGen: ignoring invalid counter seed', { name, start });
      return;
    }
    if (this.counters[name] < start) {
      this.counters[name] = start - 1;
    }
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

  ssn(original: string): string {
    return this.cached(`ssn:${original}`, () => {
      const n = ++this.counters.ssn;
      const d = String(n).padStart(9, '0');
      return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
    });
  }

  zipCodeUs(original: string): string {
    return this.cached(`zipus:${original}`, () => {
      const n = ++this.counters.zipUs;
      return String(n).padStart(5, '0');
    });
  }

  passportUs(original: string): string {
    return this.cached(`passus:${original}`, () => {
      const n = ++this.counters.passportUs;
      return String(n).padStart(9, '0');
    });
  }

  passportUk(original: string): string {
    return this.cached(`passuk:${original}`, () => {
      const n = ++this.counters.passportUk;
      return String(n).padStart(9, '0');
    });
  }

  drivingLicenseUs(original: string): string {
    return this.cached(`dlus:${original}`, () => {
      const n = ++this.counters.dlUs;
      return `D${String(n).padStart(8, '0')}`;
    });
  }

  drivingLicenseUk(original: string): string {
    return this.cached(`dluk:${original}`, () => {
      const n = ++this.counters.dlUk;
      return `ANONY${String(n).padStart(7, '0')}ZZZZ`;
    });
  }

  postcodeUk(original: string): string {
    return this.cached(`postuk:${original}`, () => {
      const n = ++this.counters.postcodeUk;
      const d1 = n % 10;
      const d2 = Math.floor(n / 10) % 10;
      const l1 = String.fromCharCode(65 + (Math.floor(n / 100) % 26));
      const l2 = String.fromCharCode(65 + (Math.floor(n / (100 * 26)) % 26));
      return `ZZ${d1} ${d2}${l1}${l2}`;
    });
  }

  canadianSin(original: string): string {
    return this.cached(`sinca:${original}`, () => {
      const n = ++this.counters.sinCa;
      const d = String(n).padStart(9, '0');
      return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
    });
  }

  australianTfn(original: string): string {
    return this.cached(`tfnau:${original}`, () => {
      const n = ++this.counters.tfnAu;
      const d = String(n).padStart(9, '0');
      return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
    });
  }

  australianMedicare(original: string): string {
    return this.cached(`medau:${original}`, () => {
      const n = ++this.counters.medicareAu;
      return String(n).padStart(10, '0');
    });
  }

  indiaAadhaar(original: string): string {
    return this.cached(`aad:${original}`, () => {
      const n = ++this.counters.aadhaar;
      const d = String(n).padStart(12, '0');
      return `${d.slice(0, 4)} ${d.slice(4, 8)} ${d.slice(8)}`;
    });
  }

  indiaPan(original: string): string {
    return this.cached(`pan:${original}`, () => {
      const n = ++this.counters.pan;
      return `AAAAA${String(n).padStart(4, '0')}Z`;
    });
  }

  brazilianCpf(original: string): string {
    return this.cached(`cpf:${original}`, () => {
      const n = ++this.counters.cpf;
      const d = String(n).padStart(11, '0');
      return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
    });
  }

  brazilianCnpj(original: string): string {
    return this.cached(`cnpj:${original}`, () => {
      const n = ++this.counters.cnpj;
      const d = String(n).padStart(14, '0');
      return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
    });
  }

  mexicanCurp(original: string): string {
    return this.cached(`curp:${original}`, () => {
      const n = ++this.counters.curp;
      return `ANON${String(n).padStart(8, '0')}XXXXXX`;
    });
  }

  mexicanRfc(original: string): string {
    return this.cached(`rfc:${original}`, () => {
      const n = ++this.counters.rfc;
      return `ANON${String(n).padStart(9, '0')}`;
    });
  }

  southKoreanRrn(original: string): string {
    return this.cached(`rrnkr:${original}`, () => {
      const n = ++this.counters.rrnKr;
      const d = String(n).padStart(13, '0');
      return `${d.slice(0, 6)}-${d.slice(6)}`;
    });
  }

  southAfricaId(original: string): string {
    return this.cached(`idza:${original}`, () => {
      const n = ++this.counters.idZa;
      return String(n).padStart(13, '0');
    });
  }

  hungarianTaxId(original: string): string {
    return this.cached(`taxhu:${original}`, () => {
      const n = ++this.counters.taxIdHu;
      return String(n).padStart(10, '0');
    });
  }

  hungarianPersonalId(original: string): string {
    return this.cached(`pidhu:${original}`, () => {
      const n = ++this.counters.pidHu;
      return String(n).padStart(11, '0');
    });
  }

  indonesiaNik(original: string): string {
    return this.cached(`nikid:${original}`, () => {
      const n = ++this.counters.nikId;
      return String(n).padStart(16, '0');
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
      ssn: 0,
      zipUs: 0,
      passportUs: 0,
      passportUk: 0,
      dlUs: 0,
      dlUk: 0,
      postcodeUk: 0,
      sinCa: 0,
      tfnAu: 0,
      medicareAu: 0,
      aadhaar: 0,
      pan: 0,
      cpf: 0,
      cnpj: 0,
      curp: 0,
      rfc: 0,
      rrnKr: 0,
      idZa: 0,
      taxIdHu: 0,
      pidHu: 0,
      nikId: 0,
    };
  }
}
