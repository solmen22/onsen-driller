// BL-007: 配信先ごとのビルドの設定（TS-007-11・12・14 と、TS-007-01・04・06・07 の設定の側）
// 出力そのものの検査（dist の中身）は check:size（BL-008）と、技術リードの確認の記録（完了報告）で行う。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILD_MODES, CRAZYGAMES_SDK, POKI_SDK, resolveMode } from '../../tools/build/modes.ts';

const root = process.cwd();
function readEnv(mode: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of readFileSync(resolve(root, `.env.${mode}`), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m?.[1] && m[2] !== undefined) out[m[1]] = m[2];
  }
  return out;
}

describe('TS-007-11・12 .env の中身', () => {
  it('本番の 4 種は VITE_TARGET が mode と同じで、テスト用フック・偽の広告がない', () => {
    for (const mode of ['web', 'crazygames', 'itch', 'poki']) {
      const env = readEnv(mode);
      expect(env.VITE_TARGET, mode).toBe(mode);
      expect(env.VITE_TEST_HOOKS, mode).not.toBe('true');
      expect(env.VITE_FAKE_ADS, mode).not.toBe('true');
    }
  });
  it('.env.crazygames は VITE_CG_ADS=false（Basic Launch 用）', () => {
    expect(readEnv('crazygames').VITE_CG_ADS).toBe('false');
  });
  it('e2e 系は VITE_TEST_HOOKS=true。e2e は target web、e2e-crazygames は target crazygames', () => {
    expect(readEnv('e2e')).toMatchObject({ VITE_TARGET: 'web', VITE_TEST_HOOKS: 'true' });
    expect(readEnv('e2e-crazygames')).toMatchObject({ VITE_TARGET: 'crazygames', VITE_TEST_HOOKS: 'true' });
  });
  it('.env に秘密情報らしい値がない（VITE_ で始まり、値は短い識別子か真偽値だけ）', () => {
    for (const mode of ['web', 'crazygames', 'itch', 'poki', 'e2e', 'e2e-crazygames', 'example']) {
      for (const [k, v] of Object.entries(readEnv(mode))) {
        expect(k, `${mode}: ${k}`).toMatch(/^VITE_/);
        expect(v, `${mode}: ${k}`).toMatch(/^[a-z0-9-]{1,20}$/);
      }
    }
  });
});

describe('TS-007-01・04・06・07・14 ビルドの mode', () => {
  it('本番の 4 種の出力先と SDK', () => {
    expect(resolveMode('web', 'build')).toEqual({ outDir: 'dist/web', sdk: null, production: true });
    expect(resolveMode('itch', 'build')).toEqual({ outDir: 'dist/itch', sdk: null, production: true });
    expect(resolveMode('crazygames', 'build')).toEqual({ outDir: 'dist/crazygames', sdk: CRAZYGAMES_SDK, production: true });
    expect(resolveMode('poki', 'build')).toEqual({ outDir: 'dist/poki', sdk: POKI_SDK, production: true });
  });
  it('e2e 2 種は dist/e2e-web・dist/e2e-crazygames', () => {
    expect(resolveMode('e2e', 'build').outDir).toBe('dist/e2e-web');
    expect(resolveMode('e2e-crazygames', 'build')).toMatchObject({ outDir: 'dist/e2e-crazygames', sdk: CRAZYGAMES_SDK });
  });
  it('SDK の script は crazygames・poki の系統にだけ入る', () => {
    for (const [mode, m] of Object.entries(BUILD_MODES)) {
      if (mode.includes('crazygames')) expect(m.sdk, mode).toBe(CRAZYGAMES_SDK);
      else if (mode.includes('poki')) expect(m.sdk, mode).toBe(POKI_SDK);
      else expect(m.sdk, mode).toBeNull();
    }
  });
  it('定義のない mode のビルドは失敗する（黙って web として出さない）', () => {
    expect(() => resolveMode('foo', 'build')).toThrow(/定義のない mode/);
    expect(() => resolveMode('development', 'serve')).not.toThrow();
  });
  it('npm run build:all は 4 種、build:e2e は e2e 2 種、build:web だけ _headers をコピーする', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['build:all']).toBe('npm run build:web && npm run build:crazygames && npm run build:itch && npm run build:poki');
    expect(pkg.scripts['build:e2e']).toBe('vite build --mode e2e && vite build --mode e2e-crazygames');
    expect(pkg.scripts['build:web']).toMatch(/copy-headers/);
    for (const k of ['build:crazygames', 'build:itch', 'build:poki']) expect(pkg.scripts[k], k).not.toMatch(/headers/);
  });
  it('vite の base は相対（./）でソースマップを出さない', () => {
    const src = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');
    expect(src).toMatch(/base: '\.\/'/);
    expect(src).toMatch(/sourcemap: false/);
  });
});
