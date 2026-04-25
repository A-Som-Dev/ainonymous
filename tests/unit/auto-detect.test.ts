import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoDetect } from '../../src/config/auto-detect.js';

function mkRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ain-autodetect-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'someone@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Someone'], { cwd: dir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
  return dir;
}

function commit(dir: string, authorName: string, email: string, msg = 'x'): void {
  writeFileSync(join(dir, `f-${Date.now()}-${Math.random()}.txt`), 'x', 'utf-8');
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync(
    'git',
    ['-c', `user.name=${authorName}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', msg],
    { cwd: dir },
  );
}

describe('auto-detect', () => {
  let dir: string | null = null;

  afterEach(() => {
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
      dir = null;
    }
  });

  beforeEach(() => {
    dir = null;
  });

  it('strips git-log author parentheses from people list', () => {
    dir = mkRepo();
    commit(dir, 'Sommer Artur (ARTUR.SOMMER EXAMPLE.COM)', 'artur.sommer@example.com');
    commit(dir, 'Großmann Peter (GROSSMP)', 'peter@example.com');
    commit(dir, 'Kurz Clemens [ADMIN]', 'clemens@example.com');

    const cfg = autoDetect(dir);

    expect(cfg.identity.people).toContain('Sommer Artur');
    expect(cfg.identity.people).toContain('Großmann Peter');
    expect(cfg.identity.people).toContain('Kurz Clemens');
    for (const p of cfg.identity.people) {
      expect(p).not.toMatch(/\(/);
      expect(p).not.toMatch(/\[/);
    }
  });

  it('drops build-service style bot commit authors', () => {
    dir = mkRepo();
    commit(dir, 'DevOps Build Service (acme)', 'build@example.com');
    commit(dir, 'Renovate Bot', 'renovate@example.com');
    commit(dir, 'Peter Müller', 'peter@example.com');

    const cfg = autoDetect(dir);

    expect(cfg.identity.people).not.toContain('DevOps Build Service');
    expect(cfg.identity.people).not.toContain('Renovate Bot');
    expect(cfg.identity.people).toContain('Peter Müller');
  });

  it('collapses duplicate authors case-insensitively', () => {
    dir = mkRepo();
    commit(dir, 'Peter Müller', 'peter@example.com');
    commit(dir, 'peter müller', 'peter@example.com');
    commit(dir, 'PETER MÜLLER', 'peter@example.com');

    const cfg = autoDetect(dir);
    const matches = cfg.identity.people.filter((p) => p.toLowerCase() === 'peter müller');
    expect(matches).toHaveLength(1);
  });

  it('collapses first-last vs last-first author formats', () => {
    dir = mkRepo();
    commit(dir, 'Großmann Peter', 'peter@example.com');
    commit(dir, 'Peter Großmann', 'peter@example.com');

    const cfg = autoDetect(dir);
    const matches = cfg.identity.people.filter(
      (p) => p.toLowerCase().includes('großmann') && p.toLowerCase().includes('peter'),
    );
    expect(matches).toHaveLength(1);
  });

  it('prefers project groupId over parent BOM groupId', () => {
    dir = mkRepo();
    writeFileSync(
      join(dir, 'pom.xml'),
      `<project>
        <parent>
          <groupId>org.springframework.boot</groupId>
          <artifactId>spring-boot-starter-parent</artifactId>
        </parent>
        <groupId>de.acme</groupId>
        <artifactId>tmf-service</artifactId>
      </project>`,
      'utf-8',
    );
    execFileSync('git', ['config', 'user.email', '123+bot@users.noreply.github.com'], {
      cwd: dir,
    });

    const cfg = autoDetect(dir);
    expect(cfg.identity.company).toBe('acme');
    expect(cfg.identity.company).not.toBe('springframework');
    expect(cfg.identity.domains).toContain('acme.de');
    expect(cfg.identity.domains).not.toContain('springframework.org');
  });

  it('falls back to parent groupId for maven submodules without local groupId', () => {
    dir = mkRepo();
    writeFileSync(
      join(dir, 'pom.xml'),
      `<project>
        <parent>
          <groupId>de.acme</groupId>
          <artifactId>parent-pom</artifactId>
        </parent>
        <artifactId>customer-api</artifactId>
      </project>`,
      'utf-8',
    );
    execFileSync('git', ['config', 'user.email', '123+bot@users.noreply.github.com'], {
      cwd: dir,
    });

    const cfg = autoDetect(dir);
    expect(cfg.identity.company).toBe('acme');
    expect(cfg.identity.domains).toContain('acme.de');
  });

  it('does not fall back to parent groupId if parent is a known BOM', () => {
    dir = mkRepo();
    writeFileSync(
      join(dir, 'pom.xml'),
      `<project>
        <parent>
          <groupId>org.springframework.boot</groupId>
          <artifactId>spring-boot-starter-parent</artifactId>
        </parent>
        <artifactId>customer-api</artifactId>
      </project>`,
      'utf-8',
    );
    execFileSync('git', ['config', 'user.email', '123+bot@users.noreply.github.com'], {
      cwd: dir,
    });

    const cfg = autoDetect(dir);
    expect(cfg.identity.domains).not.toContain('springframework.org');
    expect(cfg.identity.company).not.toBe('springframework');
  });

  it('filters framework words out of domain_terms', () => {
    dir = mkRepo();
    writeFileSync(
      join(dir, 'pom.xml'),
      '<project><artifactId>reporthub-spring-boot-starter</artifactId></project>',
      'utf-8',
    );

    const cfg = autoDetect(dir);

    expect(cfg.code.domainTerms).toContain('Reporthub');
    expect(cfg.code.domainTerms).not.toContain('Spring');
    expect(cfg.code.domainTerms).not.toContain('Boot');
    expect(cfg.code.domainTerms).not.toContain('Starter');
  });

  it('filters generic words like Name, Parent, Service', () => {
    dir = mkRepo();
    writeFileSync(
      join(dir, 'pom.xml'),
      '<project><artifactId>customer-parent-service-name</artifactId></project>',
      'utf-8',
    );

    const cfg = autoDetect(dir);
    expect(cfg.code.domainTerms).toContain('Customer');
    expect(cfg.code.domainTerms).not.toContain('Parent');
    expect(cfg.code.domainTerms).not.toContain('Service');
    expect(cfg.code.domainTerms).not.toContain('Name');
  });

  it('deduplicates identical terms from different sources', () => {
    dir = mkRepo();
    writeFileSync(
      join(dir, 'pom.xml'),
      '<project><artifactId>customer-app</artifactId></project>',
      'utf-8',
    );
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'customer-lib' }), 'utf-8');

    const cfg = autoDetect(dir);
    const count = cfg.code.domainTerms.filter((t) => t === 'Customer').length;
    expect(count).toBe(1);
  });

  it('derives domain from pom groupId when git email is noreply', () => {
    dir = mkRepo();
    writeFileSync(
      join(dir, 'pom.xml'),
      '<project><groupId>de.acme</groupId><artifactId>customer-api</artifactId></project>',
      'utf-8',
    );
    execFileSync('git', ['config', 'user.email', '123+bot@users.noreply.github.com'], {
      cwd: dir,
    });

    const cfg = autoDetect(dir);
    expect(cfg.identity.company).toBe('acme');
    expect(cfg.identity.domains).toContain('acme.de');
  });

  it('merges git-email domain and pom groupId domain when they differ', () => {
    dir = mkRepo();
    writeFileSync(
      join(dir, 'pom.xml'),
      '<project><groupId>de.acme</groupId><artifactId>customer-api</artifactId></project>',
      'utf-8',
    );
    execFileSync('git', ['config', 'user.email', 'contractor@example.com'], { cwd: dir });

    const cfg = autoDetect(dir);
    expect(cfg.identity.domains).toContain('example.com');
    expect(cfg.identity.domains).toContain('acme.de');
  });

  it('falls back to backend/ subdir for language in monorepo layouts', () => {
    dir = mkRepo();
    writeFileSync(join(dir, 'docker-compose.yml'), 'version: "3"\n', 'utf-8');
    execFileSync('git', ['config', '--add', 'safe.directory', dir], { cwd: dir });
    // backend subdir with python markers
    execFileSync('mkdir', ['backend'], { cwd: dir });
    writeFileSync(join(dir, 'backend', 'requirements.txt'), 'fastapi\n', 'utf-8');

    const cfg = autoDetect(dir);
    expect(cfg.code.language).toBe('python');
  });

  it('filters additional stoplist entries (listener, management, connector)', () => {
    dir = mkRepo();
    writeFileSync(
      join(dir, 'pom.xml'),
      '<project><artifactId>cachedb-listener-management-connector</artifactId></project>',
      'utf-8',
    );

    const cfg = autoDetect(dir);
    expect(cfg.code.domainTerms).toContain('Cachedb');
    expect(cfg.code.domainTerms).not.toContain('Listener');
    expect(cfg.code.domainTerms).not.toContain('Management');
    expect(cfg.code.domainTerms).not.toContain('Connector');
  });

  it('falls back to language "unknown" for an empty repo without source markers', () => {
    dir = mkRepo();
    // Directory has only .git/ - no pom, package.json, requirements, Cargo, go.mod.
    const cfg = autoDetect(dir);
    expect(cfg.code.language).toBe('unknown');
  });

  it.each(['aol.de', 'zoho.com', 'fastmail.com'])(
    'treats %s as free-provider, no company derived',
    (provider) => {
      dir = mkRepo();
      execFileSync('git', ['config', 'user.email', `someone@${provider}`], { cwd: dir });
      commit(dir, 'Someone', `someone@${provider}`);

      const cfg = autoDetect(dir);
      expect(cfg.identity.company).toBe('');
      expect(cfg.identity.domains).not.toContain(provider);
    },
  );
});
