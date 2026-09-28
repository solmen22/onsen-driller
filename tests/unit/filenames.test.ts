// BL-006: ファイル名の規則（TS-006-16。Q-14）と、パッケージ管理が npm に固定されていること（TS-006-02）
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileNameViolation, inScope } from '../../tools/check/filenames.ts';

const root = process.cwd();

describe('TS-006-16 ファイル名の規則', () => {
  it('通る名前', () => {
    for (const p of ['src/core/foo-bar1.ts', 'src/ui/foo.module.css', 'src/ui/App.tsx', 'src/vite-env.d.ts', 'tests/unit/core.test.ts', 'deploy/web/_headers', 'e2e/smoke.spec.ts'])
      expect(fileNameViolation(p), p).toBeNull();
  });
  it('通らない名前', () => {
    for (const p of ['src/core/fooBar.ts', 'src/core/foo_bar.ts', 'src/core/Foo.ts', 'src/core/föo.ts', 'src/core/foo bar.ts', 'src/Core/foo.ts', 'src/ui/fooBar.module.css', 'src/ui/app.Test.tsx'])
      expect(fileNameViolation(p), p).not.toBeNull();
  });
  it('リポジトリの対象のファイルがすべて規則に合う（git で管理するもの＋未追跡で無視しないもの）', () => {
    const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
    const files = out.split('\0').filter((f) => f && inScope(f) && existsSync(resolve(root, f)));
    expect(files.length).toBeGreaterThan(20);
    const bad = files.map((f) => [f, fileNameViolation(f)] as const).filter(([, v]) => v !== null);
    expect(bad).toEqual([]);
  });
});

describe('TS-006-02 パッケージ管理は npm（CEO 決定）', () => {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    packageManager?: string;
    engines?: { node?: string };
    scripts: Record<string, string>;
  };
  it('packageManager が npm、engines.node が 24 系、.nvmrc が 24', () => {
    expect(pkg.packageManager).toMatch(/^npm@\d+\.\d+\.\d+$/);
    expect(pkg.engines?.node).toMatch(/24/);
    expect(readFileSync(resolve(root, '.nvmrc'), 'utf8').trim()).toBe('24');
  });
  it('ロックファイルは package-lock.json だけで、git で管理されている', () => {
    expect(existsSync(resolve(root, 'pnpm-lock.yaml'))).toBe(false);
    expect(existsSync(resolve(root, 'yarn.lock'))).toBe(false);
    const tracked = execFileSync('git', ['ls-files', 'package-lock.json'], { cwd: root, encoding: 'utf8' }).trim();
    expect(tracked).toBe('package-lock.json');
  });
  it('scripts で pnpm を呼ばない', () => {
    for (const [k, v] of Object.entries(pkg.scripts)) expect(v, k).not.toMatch(/\bpnpm\b/);
  });
  it('CI（ci.yml があれば）は npm ci を使い、pnpm を呼ばない', () => {
    const ci = resolve(root, '.github/workflows/ci.yml');
    if (!existsSync(ci)) return; // DevOps の BL-008・BL-080 で追加される
    const y = readFileSync(ci, 'utf8');
    expect(y).toMatch(/npm ci/);
    expect(y).not.toMatch(/\bpnpm\b/);
  });
});
