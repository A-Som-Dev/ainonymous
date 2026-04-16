.PHONY: build dev test lint check format clean start scan init audit audit-full sbom licenses

build:
	npx tsc

dev:
	npx tsc --watch

test:
	npx vitest run

test-watch:
	npx vitest

test-unit:
	npx vitest run tests/unit/

test-integration:
	npx vitest run tests/integration/

test-single:
	npx vitest run $(TEST)

lint:
	npx eslint src/ tests/

format:
	npx prettier --write "src/**/*.ts" "tests/**/*.ts"

format-check:
	npx prettier --check "src/**/*.ts" "tests/**/*.ts"

check:
	npx tsc --noEmit && npx eslint src/ tests/

clean:
	rm -rf dist/ coverage/

audit:
	npm audit --audit-level=moderate

audit-full:
	npm audit --json

sbom:
	npx --yes @cyclonedx/cyclonedx-npm --output-file sbom.cdx.json

licenses:
	npx --yes license-checker --production --summary

start:
	node dist/cli/index.js start

scan:
	node dist/cli/index.js scan

init:
	node dist/cli/index.js init

graphify:
	cd $(shell pwd) && graphify
