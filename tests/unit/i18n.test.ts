// BL-052: i18n の骨組みと言語の自動判定（arch §13、QA §3-2(b) 多言語）。シナリオ `org/30_quality/test-designer/scenarios/BL-052_i18n.md`
// 1. 置き換え変数・英語の複数形（キーを分ける。B-N7）: TS-052-01〜04・13
// 2. 言語の判定の順番（設定の上書き → platform.locale() → navigator.language → 英語）: TS-052-09・10
// 3. 文章は en.json・ja.json だけにある: TS-052-05〜08・14
// （TS-052-12 は tests/integration/i18n-ui.test.ts、TS-052-15・16 は e2e〔BL-103〕）
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
import { detectLang, getLang, isOne, resolveLang, setLang, t, tn, translate, type Lang, type TextKey } from '../../src/i18n/index.ts';
import ja from '../../src/i18n/ja.json';
import { TABS } from '../../src/ui/App.tsx';
import type { EtaUnit } from '../../src/ui/format.ts';
import { buyView, etaOf } from '../../src/ui/panels/buy-view.ts';

type Dict = Readonly<Record<string, string>>;
const EN: Dict = en;
const JA: Dict = ja;
/** 文の中の置き換え変数の名前（並べ替えて重複なし） */
const varsOf = (s: string): string[] => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? ''))].sort();

// --- 辞書の検査の関数（TS-052-08 で、壊した写しを渡して働くことを確かめる） ---
/** 片方にしかないキー */
const parityProblems = (a: Dict, b: Dict): string[] => [
  ...Object.keys(b).filter((k) => !(k in a)).map((k) => `ja だけ: ${k}`),
  ...Object.keys(a).filter((k) => !(k in b)).map((k) => `en だけ: ${k}`),
];
/** 空の文・英日で置き換え変数が違う文・元のキーのない「.one」 */
const textProblems = (a: Dict, b: Dict): string[] => [
  ...Object.entries(a).filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => `en が空: ${k}`),
  ...Object.entries(b).filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => `ja が空: ${k}`),
  ...Object.keys(a)
    .filter((k) => k in b && varsOf(a[k] ?? '').join() !== varsOf(b[k] ?? '').join())
    .map((k) => `置き換え変数が違う: ${k}`),
  ...Object.keys(a)
    .filter((k) => k.endsWith('.one'))
    .flatMap((k) => {
      const base = k.slice(0, -'.one'.length);
      if (!(base in a)) return [`元のキーがない: ${k}`];
      return varsOf(a[k] ?? '').join() === varsOf(a[base] ?? '').join() ? [] : [`単数と複数で置き換え変数が違う: ${k}`];
    }),
];
/** 英日のどちらかにないキー */
const missingIn = (keys: readonly string[], a: Dict, b: Dict): string[] => keys.filter((k) => !(k in a && k in b));

afterEach(() => {
  setLang('en');
  vi.unstubAllGlobals();
});

describe('BL-052 受け入れ基準 1: t() の置き換え変数と英語の複数形', () => {
  it('TS-052-01 置き換え変数が入る（数値も文字列に）。変数のない文に vars を渡しても変わらない（英日）', () => {
    setLang('en');
    expect(t('buy.cost', { cost: '1,234' })).toBe('1,234 coins');
    expect(t('hud.maxDepth', { n: 30 })).toBe('best 30m');
    expect(t('buy.level', { n: 12 })).toBe('Lv 12');
    expect(t('tab.dig', { n: 1 })).toBe('Dig');
    setLang('ja');
    expect(t('buy.cost', { cost: '1.23万' })).toBe('1.23万 コイン');
    expect(t('buy.toolNext', { tool: t('tool.pickaxe') })).toBe('ツルハシに進化');
  });

  it('TS-052-02 同じ変数が何度出てもすべて置き換える。値の $ は特別扱いしない', () => {
    // 今の辞書に同じ変数が 2 回出る文はないので、純粋な translate にテスト用の辞書を渡して確かめる
    const d = { en: { k: '{a} and {a}, {b}' }, ja: {} };
    expect(translate(d, 'en', 'k', { a: 'x', b: 2 })).toBe('x and x, 2');
    setLang('en');
    expect(t('eta.coins', { n: '$&$1' })).toBe('$&$1 coins short');
  });

  it('TS-052-03 変数が足りなければ {名前} のまま残し（Q-34 (a)）、余った変数は使わない。例外にならない', () => {
    setLang('en');
    expect(t('buy.cost')).toBe('{cost} coins');
    expect(t('buy.cost', { x: 1 })).toBe('{cost} coins');
    expect(t('buy.cost', { cost: 5, x: 1 })).toBe('5 coins');
  });

  it('TS-052-13 今の言語にない文は英語、英語にもなければキーそのもの（例外なし）', () => {
    const d = { en: { a: 'A', b: 'B' }, ja: { a: 'エー' } };
    expect(translate(d, 'ja', 'a')).toBe('エー');
    expect(translate(d, 'ja', 'b')).toBe('B');
    expect(translate(d, 'ja', 'zzz')).toBe('zzz');
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

  it('TS-052-04 isOne: 表示する数がちょうど「1」のときだけ単数（Q-34 (b)。「1.0」「1K」「0」「1.5」は複数）', () => {
    for (const c of [1, '1', ' 1 ']) expect(isOne(c), String(c)).toBe(true);
    for (const c of [0, 2, 1.5, 0.5, '0', '2', '1.0', '1.5', '1K', '1.2K', '1.23万', '01', '']) expect(isOne(c), String(c)).toBe(false);
  });

  it('TS-052-04 tn: 英語は「1」のとき「<キー>.one」の文、それ以外は複数の文。日本語はどれも同じ言い方', () => {
    setLang('en');
    expect(tn('eta.coins', '1', { n: '1' })).toBe('1 coin short');
    for (const n of ['0', '2', '1.5', '1.2K']) expect(tn('eta.coins', n, { n }), n).toBe(`${n} coins short`);
    expect(tn('buy.cost', 1, { cost: 1 })).toBe('1 coin');
    expect(tn('buy.cost', 0, { cost: 0 })).toBe('0 coins');
    expect(tn('effect.hits', '1', { n: '1' })).toBe('+1 hit/s');
    expect(tn('effect.hits', '0.2', { n: '0.2' })).toBe('+0.2 hits/s');
    expect(tn('buy.level', 1, { n: 1 })).toBe('Lv 1'); // 「.one」のないキーはそのまま
    setLang('ja');
    for (const n of ['0', '1', '2', '1.5']) expect(tn('eta.coins', n, { n }), n).toBe(`あと ${n} コイン`);
  });

  it('TS-052-04（B-N7）: 収入 0 で 1 コイン足りないとき「1 coin short」、0.4 コイン足りないときも表示は「1」なので単数', () => {
    const s = createInitialState(1);
    s.run.coins = num(2); // ツルハシは 3 コイン。最初は収入 0 なので「あと N コイン」
    setLang('en');
    expect(etaOf(s, num(3), 'en').text).toBe('1 coin short');
    expect(etaOf(s, num(5), 'en').text).toBe('3 coins short');
    s.run.coins = num(2.6);
    expect(etaOf(s, num(3), 'en').text).toBe('1 coin short');
    setLang('ja');
    expect(etaOf(s, num(3), 'ja').text).toBe('あと 1 コイン');
  });

  it('TS-052-04 購入ボタン: 自動掘削機を 5 レベル買うと「+1 hit/s」（1 レベル 0.2 打/秒）、1 レベルなら「+0.2 hits/s」', () => {
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
  // TS-052-10: 設定 × platform.locale() × navigator.language の組み合わせ（判定は resolveLang の 1 か所。main.ts も resolveLang を呼ぶ〔BL-046〕）
  const cases: readonly [setting: Lang | 'auto', platform: string | null, browser: string | null, want: Lang][] = [
    // 設定の上書きが最優先（locale によらない）
    ['ja', 'en-US', 'en-US', 'ja'],
    ['ja', null, null, 'ja'],
    ['en', 'ja-JP', 'ja', 'en'],
    // 自動: platform.locale() で決まる（crazygames は SDK の systemInfo.locale）
    ['auto', 'ja-JP', 'en-US', 'ja'], // crazygames: SDK が ja-JP・ブラウザが en-US → 日本語
    ['auto', 'en-US', 'ja-JP', 'en'],
    ['auto', 'fr-FR', 'ja-JP', 'en'], // 分かった最初の候補で決める（fr は英語）
    // platform.locale() が分からない（null・空）ときは navigator.language
    ['auto', null, 'ja', 'ja'], // SDK が null・ブラウザが ja → 日本語
    ['auto', '', 'ja-JP', 'ja'],
    ['auto', '  ', 'en-GB', 'en'],
    ['auto', null, 'fr-FR', 'en'],
    // どちらも分からなければ英語
    ['auto', null, null, 'en'],
    ['auto', '', '', 'en'],
  ];
  for (const [setting, platform, browser, want] of cases) {
    it(`TS-052-10 設定 ${setting}・platform ${JSON.stringify(platform)}・navigator ${JSON.stringify(browser)} → ${want}`, () => {
      expect(resolveLang(setting, platform, browser)).toBe(want);
    });
  }

  it('TS-052-09 ja で始まるロケール（大文字小文字・区切りを問わない）は日本語、ほかはすべて英語（jp も英語）。例外なし', () => {
    for (const l of ['ja', 'JA', 'ja-JP', 'JA-jp', 'ja_JP', 'Ja-jp', 'ja-Hira', ' ja-JP ']) expect(detectLang(l, null), l).toBe('ja');
    for (const l of ['en', 'en-US', 'fr', 'fr-FR', 'zh-CN', 'ko-KR', 'jp', 'jv', 'jav', 'jam', 'x-ja', 'nja', '', undefined as unknown as string]) {
      expect(detectLang(l, null), String(l)).toBe('en');
    }
  });

  it('TS-052-10 detectLang の既定: platform.locale() が null なら navigator.language を見る（navigator がなければ英語）', () => {
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
  /** S1（main `2498478`）の 85 キー。既存のキー名は変えない（sprint-02.md）。消すときは同じ PR でここからも消す */
  const S1_KEYS = [
    'hud.coins', 'hud.perSec', 'hud.depth', 'hud.tapHint', 'tab.dig', 'tab.onsen', 'tab.upgrades', 'tab.prestige', 'tab.menu',
    'item.drill', 'item.autoDigger', 'item.tool', 'item.bath', 'item.autoDig', 'item.pump', 'tool.shovel', 'tool.pickaxe',
    'tool.yagura', 'tool.boring', 'tool.bigDrill', 'tool.geoDrill', 'tool.giantDrill', 'tool.legendDrill', 'spring.simple',
    'spring.co2', 'spring.salt', 'spring.sulfur', 'spring.iron', 'guest.tanuki', 'buy.level', 'buy.cost', 'buy.max', 'buy.locked',
    'buy.maxed', 'state.on', 'state.off', 'slot.empty', 'slot.title', 'onsen.none', 'prestige.soon', 'upgrades.soon', 'menu.lang',
    'menu.version', 'menu.target', 'menu.reset', 'stratum.topsoil', 'stratum.clay', 'stratum.sandstone', 'stratum.tuff',
    'stratum.granite', 'stratum.basalt', 'ore.quartz', 'ore.amber', 'ore.copper', 'ore.obsidian', 'ore.silver', 'ore.ammonite',
    'ore.jade', 'ore.sulfurCrystal', 'ore.gold', 'ore.rockCrystal', 'ore.ruby', 'ore.lavaStone', 'save.warning', 'hud.income',
    'hud.maxDepth', 'hud.tickets', 'hud.settings', 'hud.boost', 'hud.boostSoon', 'hud.vein', 'hud.autoDigLocked', 'panel.soon',
    'effect.power', 'effect.hits', 'effect.sep', 'effect.autoDig', 'buy.toolNext', 'buy.unlockAt', 'buy.qty', 'eta.sec',
    'eta.min', 'eta.hour', 'eta.over', 'eta.coins',
  ];

  it('TS-052-05 en.json と ja.json のキーがちょうど同じで、S1 のキーが 1 つも消えていない', () => {
    expect(parityProblems(EN, JA)).toEqual([]);
    expect(S1_KEYS).toHaveLength(85);
    expect(missingIn(S1_KEYS, EN, JA)).toEqual([]);
  });

  it('TS-052-05・06 どの文も空でない。英日で置き換え変数の名前がそろい、「<キー>.one」（英語の単数）には元のキーと同じ変数がある', () => {
    expect(textProblems(EN, JA)).toEqual([]);
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

  it('TS-052-07 内容定義（地層・鉱石・道具・源泉・お客さん）が参照するキーが英日の両方にある', () => {
    expect(missingIn(contentKeys().filter((k) => !(k in PENDING_KEYS)), EN, JA)).toEqual([]);
  });

  it('TS-052-07 除いているキーは、今のお客さんの定義にあるものだけ（定義から消えたら除外も消す）', () => {
    const keys = new Set(contentKeys());
    expect(Object.keys(PENDING_KEYS).filter((k) => !keys.has(k))).toEqual([]);
  });

  it('TS-052-07 コードが組み立てて引くキー（タブ・「あと N 秒」の単位・言語の名前）が英日の両方にある', () => {
    const units: readonly EtaUnit[] = ['sec', 'min', 'hour', 'over'];
    expect(missingIn([...TABS.map((x) => x.key), ...units.map((u) => `eta.${u}`), 'ui.langName.en', 'ui.langName.ja'], EN, JA)).toEqual([]);
  });

  it('TS-052-08 検査が働く: キーを 1 つ消した写し・変数を変えた写し・知らない ID は、名前つきで失敗する', () => {
    const jaLess = Object.fromEntries(Object.entries(JA).filter(([k]) => k !== 'tab.dig'));
    expect(parityProblems(EN, jaLess)).toEqual(['en だけ: tab.dig']);
    expect(parityProblems({ ...EN, 'x.new': 'X' }, JA)).toEqual(['en だけ: x.new']);
    expect(textProblems(EN, { ...JA, 'buy.cost': '{n} コイン' })).toEqual(['置き換え変数が違う: buy.cost']);
    expect(textProblems({ ...EN, 'hud.coins': ' ' }, JA)).toEqual(['en が空: hud.coins']);
    expect(textProblems({ ...EN, 'nothing.one': 'x' }, JA)).toContain('元のキーがない: nothing.one');
    expect(missingIn([...contentKeys(), 'spring.unknown'], EN, JA)).toContain('spring.unknown');
  });

  /**
   * TS-052-14（【提案】を採用。Q-34 (c)）: UI（src/ui）と描画（src/view）のコードに文章を直書きしていない。
   * - 日本語: .ts・.tsx の文字列・テンプレート・JSX の文のどれにもない（コメントは構文木に入らないので見ない）
   * - 英字: .tsx の JSX の文と、`aria-label`・`title`・`alt`・`placeholder` の文字列の値にない（数字・記号・`t()` の呼び出しは可。
   *   単位の記号〔深さの m〕は英日で同じなので可。文言の中の単位は「{n}m」のように辞書に入れている）
   * 除外: 数値の表記の万進の単位（BL-011 で表記の関数を作り直すときに扱う）
   */
  const PENDING_FILES: Readonly<Record<string, string>> = {
    'src/ui/format.ts': 'BL-011',
  };
  const JAPANESE = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;
  const LETTERS = /[A-Za-z぀-ヿ㐀-鿿ｦ-ﾟ]/;
  const TEXT_ATTRS = new Set(['aria-label', 'title', 'alt', 'placeholder']);
  /** 英日で同じ単位の記号（JSX の文としてだけ許す） */
  const UNIT_SYMBOLS = new Set(['m']);
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [join(dir, d.name)] : []));
  const uiFiles = (): string[] => [...walk(join(root, 'src/ui')), ...walk(join(root, 'src/view'))].map((f) => relative(root, f).replaceAll('\\', '/'));

  /** コードの中の直書きの文章（日本語を含む文字列・テンプレート・JSX の文と、JSX の文・文言の属性の英字） */
  function literalTexts(name: string, code: string): string[] {
    const src = ts.createSourceFile(name, code, ts.ScriptTarget.Latest, true, name.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const found: string[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isJsxText(n)) {
        if (LETTERS.test(n.text) && !UNIT_SYMBOLS.has(n.text.trim())) found.push(n.text.trim());
      } else if (ts.isJsxAttribute(n) && TEXT_ATTRS.has(n.name.getText(src)) && n.initializer && ts.isStringLiteral(n.initializer)) {
        if (LETTERS.test(n.initializer.text)) found.push(`${n.name.getText(src)}="${n.initializer.text}"`);
        return;
      } else if (ts.isStringLiteralLike(n) || ts.isTemplateLiteralToken(n)) {
        if (JAPANESE.test(n.text)) found.push(n.text.trim());
      }
      n.forEachChild(visit);
    };
    visit(src);
    return found;
  }

  it('TS-052-14 src/ui・src/view に文章の直書きがない', () => {
    const files = uiFiles();
    expect(files.length).toBeGreaterThan(10);
    const bad = files.filter((f) => !(f in PENDING_FILES)).flatMap((f) => literalTexts(f, readFileSync(join(root, f), 'utf8')).map((s) => `${f}: ${s}`));
    expect(bad).toEqual([]);
  });

  it('TS-052-14 検出の仕組み: 日本語の文字列・テンプレート・JSX の文、英字の JSX の文と文言の属性を見つけ、コメント・識別子・data-testid は見ない', () => {
    expect(literalTexts(join(root, 'src/ui/format.ts'), readFileSync(join(root, 'src/ui/format.ts'), 'utf8'))).toContain('万');
    const code = [
      '// コメント /* no */',
      "const a = 'あ'; const b = `x${1}い${2}ゃ`; const c = <p title=\"え\">う</p>; /* お */ const d = 'ok';",
      'const e = <button aria-label="Close" data-testid="close-btn" class="row">Buy now</button>;',
      'const f = <span>{t(\'buy.max\')} × 10 · 3</span>; const g = <img alt="" />; const h = <b>{d}m</b>; const i = <b>{d}km</b>;',
    ].join('\n');
    expect(literalTexts('probe.tsx', code)).toEqual(['あ', 'い', 'ゃ', 'title="え"', 'う', 'aria-label="Close"', 'Buy now', 'km']);
  });

  it('TS-052-14 除外しているファイルは実在する（消えたら除外も消す）', () => {
    const files = new Set(uiFiles());
    expect(Object.keys(PENDING_FILES).filter((f) => !files.has(f))).toEqual([]);
  });
});
