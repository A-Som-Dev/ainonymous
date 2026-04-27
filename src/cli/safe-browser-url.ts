// cmd.exe parses the url a second time, so `^&` becomes `&` and rewrites
// the command line. Caret, parens and CR/LF are the openings.
const SHELL_META = /[&|;<>%`$"\\^()\r\n]/;

export function assertSafeBrowserUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`refusing to open invalid url: ${url}`);
  }
  if (parsed.protocol !== 'http:') {
    throw new Error(`refusing to open url with scheme ${parsed.protocol} (only http: allowed)`);
  }
  if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
    throw new Error(
      `refusing to open url with non-loopback host ${parsed.hostname} (only 127.0.0.1 and localhost allowed)`,
    );
  }
  if (SHELL_META.test(url)) {
    throw new Error(
      `refusing to open url containing shell metacharacter (cmd /c start would interpret it)`,
    );
  }
}
