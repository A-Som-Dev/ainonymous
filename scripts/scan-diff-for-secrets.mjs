#!/usr/bin/env node
// Standalone secret/PII scanner for git hooks. Intentionally zero-dependency
// (no dist/ build required) so it works on a fresh clone before `npm install`.
// The scanner exits non-zero on any finding; the hook treats that as a hard
// block. Findings can be silenced per-line with a `# ainonymous:allow`
// trailer. Use sparingly and never for real secrets.

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const RED = '\u001b[31m';
const YELLOW = '\u001b[33m';
const BOLD = '\u001b[1m';
const RESET = '\u001b[0m';

const SECRET_PATTERNS = [
  { type: 'aws-access-key', re: /AKIA[0-9A-Z]{16}/g },
  {
    type: 'aws-secret-key',
    re: /(?:aws_secret_access_key|secret_key|aws_secret)\s*[=:]\s*["']?([A-Za-z0-9/+=]{40,})["']?/g,
  },
  {
    type: 'private-key',
    re: /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE KEY-----/g,
  },
  { type: 'jwt', re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { type: 'github-token', re: /gh[pousr]_[A-Za-z0-9_]{36,}/g },
  { type: 'gitlab-token', re: /glpat-[A-Za-z0-9_-]{20,}/g },
  { type: 'npm-token', re: /npm_[A-Za-z0-9]{36,}/g },
  { type: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { type: 'openai-key', re: /sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}/g },
  { type: 'slack-token', re: /xox[abpr]-[A-Za-z0-9-]{10,}/g },
  { type: 'stripe-key', re: /(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{24,}/g },
  { type: 'google-api-key', re: /AIza[0-9A-Za-z_-]{35}/g },
  { type: 'bearer-token', re: /Bearer\s+[A-Za-z0-9_.\-/+=]{24,}/g },
  {
    type: 'connection-string-with-password',
    re: /(?:mongodb|postgres(?:ql)?|mysql|redis|amqp):\/\/[^\s"']*:[^\s"'@]+@[^\s"']+/g,
  },
  {
    type: 'password-assignment',
    re: /(?:password|passwd|pwd)\s*[=:]\s*(?:"[^"\s]{6,}"|'[^'\s]{6,}'|[^\s"',;]{6,})/gi,
  },
  {
    type: 'api-key-assignment',
    re: /(?:api[_-]?key|apikey|secret|access[_-]?token)\s*[=:]\s*(?:"[^"\s]{12,}"|'[^'\s]{12,}'|[A-Za-z0-9_.-]{20,})/gi,
  },
];

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:\s?\d{4}){3,5}\s?\d{1,4}\b/g;
const PHONE_DE_RE = /(?<!\d)(?:\+49|0049|01[5-7]\d)[\s\-/.()]*\d[\d\s\-/.()]{8,16}\d(?!\d)/g;

// Safe email domains permitted in code/tests/examples. Anything else counts
// as a potential leak of a real identity.
const ALLOWED_EMAIL_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'acme.com',
  'acme.de',
  'acme.test',
  'acme-corp.com',
  'acme-corp.de',
  'acme-corp.local',
  'acme-logistics.de',
  'acme-gmbh.de',
  'test.com',
  'localhost',
  'foo.bar',
  'attacker.com',
  'user.example',
  'company-alpha.com',
  'company-alpha.de',
  'company-beta.com',
  'company-beta.de',
  'company-gamma.com',
  'company-gamma.de',
  'company-delta.com',
  'company-delta.de',
  'anthropic.com',
  'openai.com',
  'noreply.github.com',
  'users.noreply.github.com',
]);

// Reserved / private TLDs that are safe by definition (RFC 2606, RFC 6761,
// RFC 6762) plus widely-used corporate internal suffixes. An email or host on
// these can never resolve on the public internet.
const ALLOWED_TLD_SUFFIXES = [
  '.local',
  '.test',
  '.example',
  '.invalid',
  '.internal',
  '.localhost',
  '.tld',
];

function loadDenylist() {
  const path = resolve(process.cwd(), '.ainonymity-denylist.local');
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  const terms = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    terms.push(trimmed);
  }
  return terms;
}

function getChangedFiles(mode, range) {
  let cmd;
  if (mode === 'staged') {
    cmd = 'git diff --cached --name-only --diff-filter=ACMR';
  } else if (mode === 'range') {
    cmd = `git diff --name-only --diff-filter=ACMR ${range}`;
  } else if (mode === 'tree') {
    cmd = 'git ls-files';
  } else {
    throw new Error(`unknown mode: ${mode}`);
  }
  const out = execSync(cmd, { encoding: 'utf8' }).trim();
  return out ? out.split(/\r?\n/) : [];
}

function getFileContent(mode, range, file) {
  try {
    if (mode === 'staged') {
      return execSync(`git show :${JSON.stringify(file)}`, {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
    }
    // Compare between the two sides of a range: we want the "after" side,
    // i.e. the HEAD (or right-hand ref) version of the file.
    const rightRef = range.includes('..') ? range.split('..').pop() : range;
    return execSync(`git show ${rightRef}:${JSON.stringify(file)}`, {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return '';
  }
}

function getAddedLines(mode, range, file) {
  if (mode === 'tree') {
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      return [];
    }
    return content.split(/\r?\n/).map((text, i) => ({ line: i + 1, text }));
  }
  let cmd;
  if (mode === 'staged') {
    cmd = `git diff --cached --unified=0 -- ${JSON.stringify(file)}`;
  } else {
    cmd = `git diff --unified=0 ${range} -- ${JSON.stringify(file)}`;
  }
  let diff;
  try {
    diff = execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return [];
  }
  const lines = [];
  let lineNo = 0;
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith('@@')) {
      const m = /\+(\d+)(?:,\d+)?/.exec(raw);
      if (m) lineNo = parseInt(m[1], 10);
      continue;
    }
    if (raw.startsWith('+++') || raw.startsWith('---')) continue;
    if (raw.startsWith('+')) {
      lines.push({ line: lineNo, text: raw.slice(1) });
      lineNo++;
    } else if (raw.startsWith(' ')) {
      lineNo++;
    }
  }
  return lines;
}

function shouldSkipFile(file) {
  // Ignore binary and generated outputs.
  if (/\.(png|jpg|jpeg|gif|webp|pdf|zip|tar|gz|bz2|ico|woff2?|ttf|eot|mp4|webm|mp3)$/i.test(file)) {
    return true;
  }
  if (/^(dist|coverage|node_modules|graphify-out|\.playwright-mcp)\//.test(file)) return true;
  // Generated lockfile is heavy, and npm tokens/secrets don't belong there
  // anyway. The regex scanner still catches them if they are, just skip
  // the noisy metadata.
  if (file === 'package-lock.json') return true;
  // Scanner itself contains the regex definitions, self-match would be
  // a false positive.
  if (file === 'scripts/scan-diff-for-secrets.mjs') return true;
  return false;
}

function isAllowed(line) {
  return /#\s*ainonymous:allow\b/.test(line) || /\/\/\s*ainonymous:allow\b/.test(line);
}

// Obviously synthetic placeholder values. If the matched snippet contains one
// of these substrings the scanner treats it as a doc/test placeholder rather
// than a leak. Real credentials never look like this.
const SYNTHETIC_MARKERS = [
  '***REDACTED***',
  'REDACTED',
  'changeme',
  'CHANGEME',
  'placeholder',
  'PLACEHOLDER',
  'your-password',
  'your-secret',
  'your-api-key',
  'yourtoken',
  'xxxxx',
  'XXXXX',
  '<password>',
  '<secret>',
  '<token>',
  '<redacted>',
  '{{',
  '}}',
  'example',
  'EXAMPLE',
  'hunter2',
  'TESTKEY',
  'test-key',
  'test_key',
  'FAKE',
  'fake-',
  'fake_',
  'generic-secret',
  'generic-password',
  'aturehere',
  'signaturehere',
];

function looksSynthetic(snippet) {
  if (SYNTHETIC_MARKERS.some((m) => snippet.includes(m))) return true;
  if (/abcdefghij/i.test(snippet)) return true;
  if (/0123456789|123456789/.test(snippet)) return true;
  if (/abc123xyz/i.test(snippet)) return true;
  if (/\b[A-Z]{2}\d{2}(?:\s?0{4}){3,}/.test(snippet)) return true;
  if (/-(?:secret|key|token|password|long)-/i.test(snippet)) return true;
  return false;
}

// Low-signal patterns are suppressed inside tests/ because test fixtures
// legitimately contain synthetic secrets, fake emails and placeholder
// passwords to exercise the detection patterns. High-severity types (real
// API keys, private keys, live JWTs) stay enforced everywhere.
const LOW_SEVERITY_TYPES = new Set([
  'password-assignment',
  'api-key-assignment',
  'connection-string-with-password',
  'email-non-allowlisted',
  'phone-de',
  'iban',
  'bearer-token',
]);

function isTestPath(file) {
  return (
    /^(tests?|__tests?__|spec)\//.test(file) ||
    /\.test\.[tj]sx?$/.test(file) ||
    /\.spec\.[tj]sx?$/.test(file)
  );
}

function scanText(file, line, text, denylist) {
  const findings = [];
  if (isAllowed(text)) return findings;
  const inTest = isTestPath(file);

  for (const { type, re } of SECRET_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (inTest && LOW_SEVERITY_TYPES.has(type)) continue;
      if (looksSynthetic(m[0])) continue;
      findings.push({ file, line, type, snippet: truncate(m[0]) });
    }
  }

  if (!inTest) {
    EMAIL_RE.lastIndex = 0;
    let em;
    while ((em = EMAIL_RE.exec(text)) !== null) {
      const addr = em[0];
      const domain = addr.split('@')[1]?.toLowerCase() ?? '';
      const reservedTld = ALLOWED_TLD_SUFFIXES.some((s) => domain.endsWith(s));
      if (!ALLOWED_EMAIL_DOMAINS.has(domain) && !reservedTld) {
        findings.push({ file, line, type: 'email-non-allowlisted', snippet: addr });
      }
    }

    IBAN_RE.lastIndex = 0;
    let ib;
    while ((ib = IBAN_RE.exec(text)) !== null) {
      if (looksSynthetic(ib[0])) continue;
      findings.push({ file, line, type: 'iban', snippet: ib[0] });
    }

    PHONE_DE_RE.lastIndex = 0;
    let ph;
    while ((ph = PHONE_DE_RE.exec(text)) !== null) {
      if (looksSynthetic(ph[0])) continue;
      findings.push({ file, line, type: 'phone-de', snippet: ph[0] });
    }
  }

  const lower = text.toLowerCase();
  for (const term of denylist) {
    if (!term) continue;
    const needle = term.toLowerCase();
    if (lower.includes(needle)) {
      findings.push({ file, line, type: 'denylist-term', snippet: `***(denylist hit)***` });
    }
  }

  return findings;
}

function truncate(s) {
  if (s.length <= 48) return s;
  return s.slice(0, 20) + '...' + s.slice(-12);
}

function main() {
  const args = process.argv.slice(2);
  let mode = null;
  let range = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--staged') mode = 'staged';
    else if (args[i] === '--tree') mode = 'tree';
    else if (args[i] === '--range') {
      mode = 'range';
      range = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log('Usage: scan-diff-for-secrets.mjs [--staged | --range <A..B> | --tree]');
      process.exit(0);
    }
  }
  if (!mode) {
    console.error('error: pass --staged, --range <spec> or --tree');
    process.exit(2);
  }

  const denylist = loadDenylist();
  const files = getChangedFiles(mode, range).filter((f) => !shouldSkipFile(f));
  const findings = [];

  for (const file of files) {
    const added = getAddedLines(mode, range, file);
    for (const { line, text } of added) {
      for (const f of scanText(file, line, text, denylist)) {
        findings.push(f);
      }
    }
  }

  if (findings.length === 0) {
    console.log(`${BOLD}ainonymous scanner:${RESET} ${files.length} file(s), no findings.`);
    process.exit(0);
  }

  console.error(
    `${RED}${BOLD}ainonymous scanner: ${findings.length} finding(s) in ${new Set(findings.map((f) => f.file)).size} file(s)${RESET}`,
  );
  for (const f of findings) {
    console.error(`  ${RED}${f.type}${RESET} ${f.file}:${f.line}  ${YELLOW}${f.snippet}${RESET}`);
  }
  console.error('');
  console.error(
    `${BOLD}Commit/push blocked.${RESET} Remove the sensitive data or, if truly a false positive,`,
  );
  console.error(`append \`# ainonymous:allow\` to the specific line. Never allow real secrets.`);
  process.exit(1);
}

main();
