// BL-052: i18n の骨組みと言語の自動判定（arch §13、QA §3-2(b) 多言語）
// 1. 置き換え変数・英語の複数形（キーを分ける。B-N7）
// 2. 言語の判定の順番（設定の上書き → platform.locale() → navigator.language → 英語）
// 3. 文章は en.json・ja.json だけにある: キーの突き合わせ・内容定義が参照するキー・UI と描画のコードに日本語の文章がないこと
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GUESTS } from '../../src/content/guests.ts';
import { ORES } from '../../src/content/ores.ts';
import { SPRINGS } from '../../src/content/springs.ts';
import { STRATA } from '../../src/content/strata.ts';
import { TOOLS } from '../../src/content/tools.ts';
import { buyQuote, createInitialState, num } from '../../src/core/index.ts';
import en from '../../src/i18n/en.json';
import { detectLang, getLang, isOne, resolveLang, setLang, t, tn, type Lang, type TextKey } from '../../src/i18n/index.ts';
import ja from '../../src/i18n/ja.json';
import { TABS } from '../../src/ui/App.tsx';
import type { EtaUnit } from '../../src/ui/format.ts';
import { buyView, etaOf } from '../../src/ui/panels/buy-view.ts';

const EN: Readonly<Record<string, string>> = en;
const JA: Readonly<Record<string, string>> = ja;
/** 文の中の置き換え変数の名前（並べ替えて重複なし） */
const varsOf = (s: string): string[] => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? ''))].sort();

afterEach(() => {
  setLang('en');
  vi.unstubAllGlobals();
});

describe('BL-052 受け入れ基準 1: t() の置き換え変数と英語の複数形', () => {
  it("t('buy.cost', { cost }) で置き換え変数が入る（英日）", () => {
    setLang('en');
    expect(t('buy.cost', { cost: '1,234' })).toBe('1,234 coins');
    expect(t('buy.level', { n: 12 })).toBe('Lv 12');
    setLang('ja');
    expect(t('buy.cost', { cost: '1.23万' })).toBe('1.23万 コイン');
    expect(t('buy.toolNext', { tool: t('tool.pickaxe') })).toBe('ツルハシに進化');
  });

  it('同じ変数が何度出てもすべて置き換え、知らない変数は残す。値の $ は特別扱いしない', () => {
    // 今の文には同じ変数が 2 回出るものがないので、置き換えの規則だけを確かめる（キーのない文はキーそのものを返す）
    setLang('en');
    expect(t('{a} and {a}, {b}' as TextKey, { a: 'x' })).toBe('x and x, {b}');
    expect(t('eta.coins', { n: '$&$1' })).toBe('$&$1 coins short');
    expect(t('eta.coins')).toBe('{n} coins short');
  });

  it('今の言語にない文は英語、英語にもなければキーそのもの', () => {
    setLang('ja');
    expect(t('no.such.key' as TextKey)).toBe('no.such.key');
  });

  it('setLang は今の言語と <html lang> を変える', () => {
    const documentElement = { lang: 'en' };
    vi.stubGlobal('document', { documentElement });
    setLang('ja');
    expect(getLang()).toBe('ja');
    expect(documentElement.lang).toBe('ja');
    setLang('en');
    expect(documentElement.lang).toBe('en');
  });

  it('isOne: 表示する数がちょうど 1 のときだけ単数（「1.0」「1K」「01」は複数）', () => {
    for (const c of [1, '1', ' 1 ']) expect(isOne(c), String(c)).toBe(true);
    for (const c of [0, 2, 1.5, 0.5, '0', '2', '1.0', '1.5', '1K', '1.23万', '01', '']) expect(isOne(c), String(c)).toBe(false);
  });

  it('tn: 英語は 1 のとき「<キー>.one」の文、それ以外は複数の文。日本語は同じ文', () => {
    setLang('en');
    expect(tn('eta.coins', '1', { n: '1' })).toBe('1 coin short');
    expect(tn('eta.coins', '2', { n: '2' })).toBe('2 coins short');
    expect(tn('eta.coins', '1.23K', { n: '1.23K' })).toBe('1.23K coins short');
    expect(tn('buy.cost', 1, { cost: 1 })).toBe('1 coin');
    expect(tn('buy.cost', 0, { cost: 0 })).toBe('0 coins');
    expect(tn('effect.hits', '1', { n: '1' })).toBe('+1 hit/s');
    expect(tn('effect.hits', '0.2', { n: '0.2' })).toBe('+0.2 hits/s');
    // 「.one」のないキーはそのまま
    expect(tn('buy.level', 1, { n: 1 })).toBe('Lv 1');
    setLang('ja');
    expect(tn('eta.coins', '1', { n: '1' })).toBe('あと 1 コイン');
    expect(tn('eta.coins', '2', { n: '2' })).toBe('あと 2 コイン');
  });

  it('B-N7: 収入 0 で 1 コイン足りないとき「1 coin short」（「1 coins short」にならない）', () => {
    const s = createInitialState(1);
    s.run.coins = num(2); // ツルハシは 3 コイン → 1 足りない。最初は収入 0 なので「あと N コイン」
    setLang('en');
    expect(etaOf(s, num(3), 'en').text).toBe('1 coin short');
    expect(etaOf(s, num(5), 'en').text).toBe('3 coins short');
    setLang('ja');
    expect(etaOf(s, num(3), 'ja').text).toBe('あと 1 コイン');
  });

  it('購入ボタン: 自動掘削機を 5 レベル買うと「+1 hit/s」（1 レベル 0.2 打/秒）、1 レベルなら「+0.2 hits/s」', () => {
    const s = createInitialState(1);
    s.run.drill.tool = 1; // ツルハシの後
    let five = num(0);
    for (let l = 0; l < 5; l++) {
      s.run.autoDig.level = l;
      five = five.add(buyQuote(s, 'autoDigger', 1).cost);
    }
    s.run.autoDig.level = 0;
    s.run.coins = five; // ちょうど 5 レベル分
    setLang('en');
    const max = buyView(s, 'autoDigger', 'max', 'en');
    expect(max.n).toBe(5);
    expect(max.effectText).toBe('+1 hit/s');
    expect(buyView(s, 'autoDigger', 1, 'en').effectText).toBe('+0.2 hits/s');
    expect(buyView(s, 'tool', 1, 'en').costText).toBe('400 coins'); // 次の道具（手掘りやぐら）
  });
});

describe('BL-052 受け入れ基準 2: 言語の判定の順番（設定 → platform.locale() → navigator.language → 英語）', () => {
  const cases: readonly [setting: Lang | 'auto', platform: string | null, browser: string | null, want: Lang][] = [
    // 設定の上書きが最優先
    ['ja', 'en-US', 'en-US', 'ja'],
    ['en', 'ja-JP', 'ja-JP', 'en'],
    // 自動: platform.locale() で決まる（ポータルの言語。CrazyGames の systemInfo.locale）
    ['auto', 'ja-JP', 'en-US', 'ja'],
    ['auto', 'en-US', 'ja-JP', 'en'],
    ['auto', 'fr-FR', 'ja-JP', 'en'], // 分かった最初の候補で決める（fr は英語）
    // platform.locale() が分からない（null・空）ときは navigator.language
    ['auto', null, 'ja-JP', 'ja'],
    ['auto', '', 'ja', 'ja'],
    ['auto', '  ', 'en-GB', 'en'],
    // どちらも分からなければ英語
    ['auto', null, null, 'en'],
    ['auto', '', '', 'en'],
  ];
  for (const [setting, platform, browser, want] of cases) {
    it(`設定 ${setting}・platform ${JSON.stringify(platform)}・navigator ${JSON.stringify(browser)} → ${want}`, () => {
      expect(resolveLang(setting, platform, browser)).toBe(want);
    });
  }

  it('ja で始まるロケール（大文字小文字・区切りを問わない）は日本語、ほかの言語は英語', () => {
    for (const l of ['ja', 'JA', 'ja-JP', 'ja_JP', 'Ja-jp', 'ja-Hira', ' ja-JP ']) expect(detectLang(l, null), l).toBe('ja');
    for (const l of ['en', 'en-US', 'fr', 'fr-FR', 'zh-CN', 'ko-KR', 'jv', 'jav', 'jam', 'x-ja', 'nja']) expect(detectLang(l, null), l).toBe('en');
  });

  it('detectLang の既定: platform.locale() が null なら navigator.language を見る', () => {
    vi.stubGlobal('navigator', { language: 'ja-JP' });
    expect(detectLang(null)).toBe('ja');
    expect(detectLang('en-US')).toBe('en');
    vi.stubGlobal('navigator', { language: 'de-DE' });
    expect(detectLang(null)).toBe('en');
    vi.stubGlobal('navigator', undefined);
    expect(detectLang(null)).toBe('en');
  });
});

describe('BL-052 受け入れ基準 3: 文章は en.json・ja.json にあり、コードとコンテンツはキーだけを持つ', () => {
  it('en.json と ja.json のキーがちょうど同じ（片方にないキーがない）', () => {
    const e = Object.keys(EN).sort();
    const j = Object.keys(JA).sort();
    expect(j.filter((k) => !(k in EN)), 'ja.json にだけある').toEqual([]);
    expect(e.filter((k) => !(k in JA)), 'en.json にだけある').toEqual([]);
  });

  it('どの文も空でない文字列', () => {
    for (const [name, d] of [
      ['en', EN],
      ['ja', JA],
    ] as const) {
      for (const [k, v] of Object.entries(d)) expect(typeof v === 'string' && v.trim() !== '', `${name}: ${k}`).toBe(true);
    }
  });

  it('英日で置き換え変数の名前がそろっている', () => {
    for (const k of Object.keys(EN)) expect(varsOf(JA[k] ?? ''), k).toEqual(varsOf(EN[k] ?? ''));
  });

  it('「<キー>.one」（英語の単数）には元のキーがあり、置き換え変数が同じ', () => {
    for (const k of Object.keys(EN).filter((x) => x.endsWith('.one'))) {
      const base = k.slice(0, -'.one'.length);
      expect(base in EN, `${k} の元のキー ${base}`).toBe(true);
      expect(varsOf(EN[k] ?? ''), k).toEqual(varsOf(EN[base] ?? ''));
    }
  });

  /**
   * 内容定義が参照する名前のキー。帯と鉱石は定義の nameKey、道具・源泉・お客さんは「<種類>.<id>」（core-api.md §6）。
   * まだ文を入れていないお客さんは、入れるチケットを書いて除く（入れたら消す）
   */
  const PENDING_KEYS: Readonly<Record<string, string>> = {
    'guest.monkey': 'BL-017',
    'guest.capybara': 'BL-017',
    'guest.fox': 'BL-017',
    'guest.cat': 'BL-019',
    'guest.redPanda': 'BL-019',
  };
  const contentKeys = (): string[] => [
    ...STRATA.map((b) => b.nameKey),
    ...ORES.map((o) => o.nameKey),
    ...TOOLS.map((x) => `tool.${x.id}`),
    ...SPRINGS.map((x) => `spring.${x.id}`),
    ...GUESTS.map((x) => `guest.${x.id}`),
  ];

  it('内容定義（地層・鉱石・道具・源泉・お客さん）が参照するキーが英日の両方にある', () => {
    const missing = contentKeys().filter((k) => !(k in PENDING_KEYS) && !(k in EN && k in JA));
    expect(missing).toEqual([]);
  });

  it('除いているキーは、今のお客さんの定義にあるものだけ（定義から消えたら除外も消す）', () => {
    const keys = new Set(contentKeys());
    expect(Object.keys(PENDING_KEYS).filter((k) => !keys.has(k))).toEqual([]);
  });

  it('コードが組み立てて引くキー（タブ・「あと N 秒」の単位・言語の名前）が英日の両方にある', () => {
    const units: readonly EtaUnit[] = ['sec', 'min', 'hour', 'over'];
    const keys = [...TABS.map((x) => x.key), ...units.map((u) => `eta.${u}`), 'ui.langName.en', 'ui.langName.ja'];
    for (const k of keys) expect(k in EN && k in JA, k).toBe(true);
  });

  /**
   * UI（src/ui）と描画（src/view）のコードに、日本語の文章を直書きしていない（文字列・テンプレート・JSX の文。コメントは除く）。
   * 英語の直書きは機械では見分けにくいので、コードレビューで見る。
   * 除外: 数値の表記の万進の単位（BL-011 で fmt.* のキーに移す）
   */
  const PENDING_FILES: Readonly<Record<string, string>> = {
    'src/ui/format.ts': 'BL-011',
  };
  const JAPANESE = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [join(dir, d.name)] : []));

  /** コードの中の、日本語を含む文字列・テンプレート・JSX の文（コメントは構文木に入らないので見ない） */
  function japaneseTextsOf(name: string, code: string): string[] {
    const src = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const found: string[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isStringLiteralLike(n) || ts.isTemplateLiteralToken(n) || ts.isJsxText(n)) {
        if (JAPANESE.test(n.text)) found.push(n.text.trim());
      }
      n.forEachChild(visit);
    };
    visit(src);
    return found;
  }
  const japaneseTexts = (file: string): string[] => japaneseTextsOf(file, readFileSync(file, 'utf8'));

  it('src/ui・src/view に日本語の文章の直書きがない', () => {
    const files = [...walk(join(root, 'src/ui')), ...walk(join(root, 'src/view'))];
    expect(files.length).toBeGreaterThan(10);
    const bad = files
      .map((f) => relative(root, f).replaceAll('\\', '/'))
      .filter((f) => !(f in PENDING_FILES))
      .flatMap((f) => japaneseTexts(join(root, f)).map((s) => `${f}: ${s}`));
    expect(bad).toEqual([]);
  });

  it('検出の仕組み: 文字列・テンプレート・JSX の文の日本語を見つけ、コメントの日本語は見ない', () => {
    const file = join(root, 'src/ui/format.ts'); // 今は万進の単位を直書きしている（BL-011 まで）
    expect(japaneseTexts(file)).toContain('万');
    const code = "// コメント\nconst a = 'あ'; const b = `x${1}い${2}ゃ`; const c = <p title=\"え\">う</p>; /* お */ const d = 'ok';";
    expect(japaneseTextsOf('probe.tsx', code)).toEqual(['あ', 'い', 'ゃ', 'え', 'う']);
  });

  it('除外しているファイルは実在する（消えたら除外も消す）', () => {
    const files = new Set([...walk(join(root, 'src/ui')), ...walk(join(root, 'src/view'))].map((f) => relative(root, f).replaceAll('\\', '/')));
    expect(Object.keys(PENDING_FILES).filter((f) => !files.has(f))).toEqual([]);
  });
});
