// BL-077: 文言の自動検査 check:text の自己テスト（QA の語のリストの付録 B〔165 件＋ファイル名 19 件〕と許可リスト）
// 検出語をわざと含むので、このファイルと tests/fixtures/check-text-selftest.json は check:text の対象外（tests/ は見ない）
import { describe, expect, it } from 'vitest';
import words from '../../scripts/text-words.json';
import selftest from '../fixtures/check-text-selftest.json';
import { allowlistProblems, checkFile, checkText, compileRules, isAllowed, isTarget, type TextHit, type TextRule } from '../../scripts/check-text.mjs';

type Hit = TextHit;
const compiled = compileRules(words.rules as TextRule[]);
const check = (text: string, c: typeof compiled, opts?: { fileName?: boolean }): Hit[] => checkText(text, c, opts);

describe('語のリスト（scripts/text-words.json）', () => {
  it('QA の文書の付録 A をそのまま写している（version・updated・source が残り、25 規則・719 語）', () => {
    expect(words.version).toBe(1);
    expect(words.updated).toBe('2026-09-29');
    expect(words.source).toBe('org/30_quality/qa-lead/2026-09-29_check-text-words.md');
    expect(words.rules).toHaveLength(25);
    expect(words.rules.reduce((n, r) => n + r.words.length, 0)).toBe(719);
  });
});

describe('付録 B の自己テスト（受け入れ基準 3 行目）', () => {
  it.each(selftest.mustHit)('検出する: %s', (s) => {
    expect(check(s, compiled).length).toBeGreaterThan(0);
  });
  it.each(selftest.mustPass)('検出しない: %s', (s) => {
    expect(check(s, compiled)).toEqual([]);
  });
  it.each(selftest.fileNamesHit)('ファイル名で検出する: %s', (s) => {
    expect(check(s, compiled, { fileName: true }).length).toBeGreaterThan(0);
  });
  it.each(selftest.fileNamesPass)('ファイル名で検出しない: %s', (s) => {
    expect(check(s, compiled, { fileName: true })).toEqual([]);
  });
  it('件数: 検出 65・検出しない 100・ファイル名 3＋16', () => {
    expect([selftest.mustHit.length, selftest.mustPass.length, selftest.fileNamesHit.length, selftest.fileNamesPass.length]).toEqual([65, 100, 3, 16]);
  });
});

describe('照合の規則', () => {
  it('sub: 全角・途中の空白も拾う（NFKC・空白の除去）', () => {
    expect(check('１００ ％ 無料', compiled).some((h) => h.rule.startsWith('C'))).toBe(true);
  });
  it('例外は重なっても壊れない（「効能・適応症は書かない」は検出しない）', () => {
    expect(check('効能・適応症は書かない', compiled)).toEqual([]);
  });
  it('絵文字（サロゲートペア）の後ろでも例外を正しい位置で伏せる（PR #51 のレビューの M-1）', () => {
    expect(check('😀😀効能・適応症は書かない', compiled)).toEqual([]);
    expect(check('😀😀😀 効能・適応症は書かない', compiled)).toEqual([]);
    expect(check('😀 効能があります', compiled).map((h) => h.rule)).toContain('H1');
    // 例外（効能は書かない）を伏せた後ろの「健康」は検出する（CEO の例）
    expect(check('😀効能は書かない健康に良い', compiled).map((h) => h.word)).toContain('健康');
  });
  it('ゼロ幅スペース・ソフトハイフン（Unicode の Cf）を語の途中に入れてもすり抜けない（PR #51 のレビューの S-1）', () => {
    expect(check('効​能', compiled).map((h) => h.rule)).toContain('H1');
    expect(check('完全­無料', compiled).map((h) => h.rule)).toContain('C1');
    expect(check('kid​-friendly', compiled).map((h) => h.rule)).toContain('K2');
  });
  it('ファイル名は P・W・N の英字の規則だけ（C2 の no ads はファイル名では見ない）', () => {
    expect(check('balance-no-ads.test.ts', compiled, { fileName: true })).toEqual([]);
  });
});

describe('許可リスト（受け入れ基準 2・3 行目）', () => {
  const file = 'src/i18n/ja.json';
  const body = JSON.stringify({ 'x.claim': '完全無料で遊べる' });
  it('検出語を含む文字列は失敗し、許可リストに入れると通る（ファイル＋キー＋規則＋語で 1 件だけ）', () => {
    const hits = checkFile(file, body, compiled);
    expect(hits.length).toBeGreaterThan(0);
    const h = hits[0]!;
    const allow = [{ file, key: 'x.claim', rule: h.rule, word: h.word, reason: 'テスト', approvedBy: 'qa-lead', date: '2026-10-12' }];
    expect(allowlistProblems(allow)).toEqual([]);
    expect(hits.filter((x) => !isAllowed(allow, x))).toHaveLength(hits.length - hits.filter((x) => x.rule === h.rule && x.word === h.word).length);
    // 別のキーには効かない
    expect(isAllowed(allow, { ...h, key: 'y.other' })).toBe(false);
  });
  it('JSON 以外は行の抜粋で外す', () => {
    const hits = checkFile('ASSETS.md', 'a\n完全無料の素材\n', compiled);
    expect(hits[0]?.line).toBe(2);
    const allow = [{ file: 'ASSETS.md', line: '完全無料の素材', rule: hits[0]!.rule, word: hits[0]!.word, reason: 'r', approvedBy: 'qa-lead', date: '2026-10-12' }];
    expect(isAllowed(allow, hits[0]!)).toBe(true);
  });
  it('reason・approvedBy・date がない・場所がない（ファイル全体）・説明文で H・P・C の許可はエラー', () => {
    const ok = { file, key: 'k', rule: 'C1', word: '完全無料', reason: 'r', approvedBy: 'qa-lead', date: '2026-10-12' };
    expect(allowlistProblems([ok])).toEqual([]);
    for (const k of ['reason', 'approvedBy', 'date'] as const) expect(allowlistProblems([{ ...ok, [k]: '' }])).not.toEqual([]);
    expect(allowlistProblems([{ ...ok, key: undefined }])).not.toEqual([]);
    expect(allowlistProblems([{ ...ok, file: 'index.html', key: undefined, line: 'x' }])).not.toEqual([]);
    expect(allowlistProblems([{ ...ok, file: 'docs/store/crazygames.en.md', key: undefined, line: 'x', rule: 'H1' }])).not.toEqual([]);
    expect(allowlistProblems([{ ...ok, file: 'docs/store/crazygames.en.md', key: undefined, line: 'x', rule: 'V1' }])).toEqual([]);
  });
});

describe('検査の対象（CEO 決定 2026-09-29）', () => {
  it('i18n・content・assets-src・index.html・ASSETS.md・docs/store を見て、語のリスト・許可リスト・tests・e2e・LICENSES は見ない', () => {
    for (const f of ['src/i18n/ja.json', 'src/content/springs.ts', 'assets-src/palette.json', 'index.html', 'ASSETS.md', 'docs/store/itch.en.md']) expect(isTarget(f)).toBe(true);
    for (const f of ['scripts/text-words.json', 'scripts/text-allowlist.json', 'tests/unit/check-text.test.ts', 'e2e/e1.spec.ts', 'LICENSES/OFL.txt', 'src/ui/App.tsx', 'assets-src/fonts/a.ttf'])
      expect(isTarget(f)).toBe(false);
  });
  it('i18n の JSON はキーを見ない（値だけ）', () => {
    expect(checkFile('src/i18n/en.json', JSON.stringify({ 'health.free': 'ok' }), compiled)).toEqual([]);
  });
});
