import { describe, it, expect } from 'vitest';
import { assertSafeBrowserUrl } from '../../src/cli/safe-browser-url.js';

describe('assertSafeBrowserUrl', () => {
  it('accepts plain loopback dashboard URL with hex token', () => {
    expect(() =>
      assertSafeBrowserUrl('http://127.0.0.1:8100/dashboard?token=abc123'),
    ).not.toThrow();
  });

  it('accepts localhost host', () => {
    expect(() =>
      assertSafeBrowserUrl('http://localhost:8100/dashboard'),
    ).not.toThrow();
  });

  it('rejects https scheme', () => {
    expect(() =>
      assertSafeBrowserUrl('https://127.0.0.1:8100/dashboard'),
    ).toThrow(/scheme|protocol/i);
  });

  it('rejects file:// scheme', () => {
    expect(() => assertSafeBrowserUrl('file:///etc/passwd')).toThrow();
  });

  it('rejects non-loopback hostname', () => {
    expect(() => assertSafeBrowserUrl('http://attacker.example/')).toThrow(/host/i);
  });

  it('rejects URL containing shell-metacharacter ampersand even after URL parsing', () => {
    // Operator-supplied mgmt token of `ab&calc.exe` would otherwise let
    // `cmd /c start` execute calc.exe via shell-meta-interpretation.
    expect(() =>
      assertSafeBrowserUrl('http://127.0.0.1:8100/dashboard?token=ab&calc.exe'),
    ).toThrow(/metacharacter|shell/i);
  });

  it('rejects pipe character', () => {
    expect(() =>
      assertSafeBrowserUrl('http://127.0.0.1:8100/dashboard?token=a|b'),
    ).toThrow(/metacharacter|shell/i);
  });

  it('rejects backtick injection', () => {
    expect(() =>
      assertSafeBrowserUrl('http://127.0.0.1:8100/dashboard?token=a`b'),
    ).toThrow(/metacharacter|shell/i);
  });

  it('rejects caret cmd-escape', () => {
    // `cmd /c start "" url^&calc.exe` runs calc.exe because cmd unescapes
    // `^&` to `&` during its second parse pass.
    expect(() =>
      assertSafeBrowserUrl('http://127.0.0.1:8100/dashboard?token=ab^&calc.exe'),
    ).toThrow(/metacharacter|shell/i);
  });

  it('rejects cmd grouping parentheses', () => {
    expect(() =>
      assertSafeBrowserUrl('http://127.0.0.1:8100/dashboard?token=a(b)c'),
    ).toThrow(/metacharacter|shell/i);
  });

  it('rejects embedded CRLF', () => {
    expect(() =>
      assertSafeBrowserUrl('http://127.0.0.1:8100/dashboard\r\ncalc.exe'),
    ).toThrow();
  });
});
