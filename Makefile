.PHONY: build dev test lint check format clean start scan init audit audit-full sbom licenses install-hooks scan-staged scan-branch scan-all

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
	npx --yes @cyclonedx/cyclonedx-npm@4.2.1 --output-file sbom.cdx.json

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

install-hooks:
	git config core.hooksPath .githooks
	chmod +x .githooks/pre-commit .githooks/pre-push scripts/scan-diff-for-secrets.mjs
	@echo "hooks active. create .ainonymity-denylist.local for project-specific terms."

scan-staged:
	node scripts/scan-diff-for-secrets.mjs --staged

scan-branch:
	node scripts/scan-diff-for-secrets.mjs --range origin/master..HEAD

scan-all:
	node scripts/scan-diff-for-secrets.mjs --tree
