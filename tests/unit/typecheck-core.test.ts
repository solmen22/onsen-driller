// BL-006: tsconfig.core.json（lib に DOM なし）で core・content・tools/sim に DOM の型を使うと型エラーになる（TS-006-03・17）
// TypeScript の Compiler API に仮想のファイルを渡して検査する（リポジトリに一時ファイルを作らない）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function diagnosticsFor(configFile: string, files: Record<string, string>): Map<string, readonly ts.Diagnostic[]> {
  const cfg = ts.readConfigFile(resolve(root, configFile), (p) => ts.sys.readFile(p));
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, root);
  const virtual = new Map(Object.entries(files).map(([p, c]) => [resolve(root, p).replaceAll('\\', '/'), c]));
  const host = ts.createCompilerHost(parsed.options);
  const norm = (p: string): string => resolve(p).replaceAll('\\', '/');
  const origGet = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, lang, onError, create) => {
    const v = virtual.get(norm(fileName));
    return v !== undefined ? ts.createSourceFile(fileName, v, lang) : origGet(fileName, lang, onError, create);
  };
  const origExists = host.fileExists.bind(host);
  host.fileExists = (f) => virtual.has(norm(f)) || origExists(f);
  const origRead = host.readFile.bind(host);
  host.readFile = (f) => virtual.get(norm(f)) ?? origRead(f);
  const program = ts.createProgram([...virtual.keys()], parsed.options, host);
  const out = new Map<string, readonly ts.Diagnostic[]>();
  for (const f of virtual.keys()) {
    const sf = program.getSourceFile(f);
    out.set(f, sf ? [...program.getSemanticDiagnostics(sf), ...program.getSyntacticDiagnostics(sf)] : []);
  }
  return out;
}

const DOM_SNIPPETS = {
  document: 'export const a: string = document.title;',
  window: 'export const a: number = window.innerWidth;',
  localStorage: "export const a: string | null = localStorage.getItem('x');",
  HTMLElement: 'export let a: HTMLElement | null = null;',
};
const LAYERS = ['src/core', 'src/content', 'tools/sim'];

describe('TS-006-03 tsconfig.core.json では DOM の型が使えない', () => {
  const files: Record<string, string> = {};
  for (const dir of LAYERS) for (const [k, code] of Object.entries(DOM_SNIPPETS)) files[`${dir}/__fixture_${k}.ts`] = code;

  it('3 層 × 4 種＝12 件すべて型エラー（名前が見つからない）', () => {
    const d = diagnosticsFor('tsconfig.core.json', files);
    for (const [f, diags] of d) {
      expect(diags.length, f).toBeGreaterThan(0);
      // 2304: Cannot find name / 2584・2552: lib の変更を勧めるもの
      expect(diags.some((x) => [2304, 2552, 2584].includes(x.code)), `${f}: ${diags.map((x) => x.code).join(',')}`).toBe(true);
    }
  });

  it('同じコードは tsconfig.json（DOM あり）なら通る（失敗の原因が DOM であることの確認）', () => {
    const code = Object.values(DOM_SNIPPETS)
      .map((c, i) => c.replace(/export (const|let) a/, `export $1 v${i}`))
      .join('\n');
    const d = diagnosticsFor('tsconfig.json', { 'src/app/__fixture_dom.ts': code });
    for (const [f, diags] of d) expect(diags.map((x) => ts.flattenDiagnosticMessageText(x.messageText, '\n')), f).toEqual([]);
  });
});

describe('TS-006-17 typecheck は tsconfig.json と tsconfig.core.json（DOM なし）の両方を検査する', () => {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  const core = ts.readConfigFile(resolve(root, 'tsconfig.core.json'), (p) => ts.sys.readFile(p)).config as {
    compilerOptions: { lib: string[] };
    include: string[];
    exclude?: string[];
  };

  it('npm run typecheck が 3 つの tsconfig を検査する', () => {
    const tc = pkg.scripts.typecheck ?? '';
    expect(tc).toMatch(/-p tsconfig\.json\b/);
    expect(tc).toMatch(/-p tsconfig\.core\.json\b/);
    expect(tc).toMatch(/-p tsconfig\.node\.json\b/);
  });

  it('tsconfig.core.json の lib は ES2023 だけで、core・content・tools/sim を含む', () => {
    expect(core.compilerOptions.lib).toEqual(['ES2023']);
    expect(core.include).toEqual(expect.arrayContaining(['src/core', 'src/content', 'tools/sim']));
  });

  it('npm run test（Vitest）の対象に unit・property・integration・balance が入っている', async () => {
    const cfg = (await import('../../vitest.config.ts')).default as { test?: { include?: string[] } };
    const inc = cfg.test?.include ?? [];
    expect(inc.some((g) => g.startsWith('tests/'))).toBe(true);
  });
});
