# Contributing to AInonymity

## Development Setup

```bash
git clone https://github.com/A-Som-Dev/ainonymity.git
cd ainonymity
npm install
make test
```

## Workflow

1. Fork the repo and create a feature branch
2. Write tests first (TDD)
3. Implement the feature
4. Run `make check` (TypeScript + ESLint) and `make test`
5. Submit a pull request

## Code Style

- TypeScript strict mode
- No frameworks for HTTP (`node:http` only) or dashboard (vanilla HTML)
- Meaningful variable names — no single-letter variables outside loops
- No unnecessary comments — code should be self-documenting
- Performance target: p95 < 200 ms per request for typical payloads (<5 KB). See [BENCHMARKS.md](BENCHMARKS.md) for measured p50/p95.

## Architecture Rules

- The 3-layer pipeline (Secrets → Identity → Code) processes in strict order
- Secrets are never rehydrated — `***REDACTED***` is permanent
- The reverse session map is AES-256-GCM encrypted in-process (raises the bar for heap dumps, not a substitute for process isolation); the forward map uses SHA-256 hashed keys
- Domain-aware pseudonymization: structural parts preserved, domain parts replaced

## Testing

- Unit tests: `tests/unit/`
- Integration tests: `tests/integration/`
- Snapshot tests: `tests/snapshots/`
- Run all: `make test`
- Run specific: `npx vitest run tests/unit/my-test.test.ts`

## DCO Sign-Off

All commits must include a sign-off line:

```
Signed-off-by: Your Name <your.email@example.com>
```

Use `git commit -s` to add it automatically. This certifies that you have the right to submit the contribution under the project's license (Developer Certificate of Origin).

## Reporting Issues

- Use GitHub Issues for bug reports and feature requests
- Include reproduction steps, expected vs. actual behavior
- For security vulnerabilities, see [SECURITY.md](SECURITY.md)
