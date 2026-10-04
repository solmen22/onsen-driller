// BL-011: 数値の表記 3 種（src/i18n/number-format.ts）。シナリオ `org/30_quality/test-designer/scenarios/BL-011_number-format.md`
// の TS-011-01〜11（unit）。表記の規則は Q-32・Q-33 の PM の回答（traceability §5-4）
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { num, NUM_EXP_MAX, NUM_MAX, type Num } from '../../src/core/num.ts';
import { digitsOf, formatAmount, formatRate, formatShortfall, type Notation } from '../../src/i18n/number-format.ts';
import type { Lang } from '../../src/i18n/index.ts';
import { buyQuote } from '../../src/core/index.ts';
import { etaOf } from '../../src/ui/panels/buy-view.ts';
import { stateWith } from '../support/states.ts';

const amt = (v: string | number | Num, lang: Lang, notation: Notation = 'auto'): string => formatAmount(num(v), lang, notation).text;
const rate = (v: string | number | Num, lang: Lang, notation: Notation = 'auto'): string => formatRate(num(v), lang, notation).text;
const lack = (v: string | number | Num, lang: Lang, notation: Notation = 'auto'): string => formatShortfall(num(v), lang, notation).text;
const JA_UNITS = ['万', '億', '兆', '京', '垓', '秭', '穣', '溝', '澗', '正', '載', '極', '恒河沙', '阿僧祇', '那由他', '不可思議', '無量大数'];

describe('日本語の自動表記（TS-011-01〜03）', () => {
  it('TS-011-01 0・1・1,234・9,999・10,000・12,345・4.56 億・7.89 兆', () => {
    expect([0, 1, 1234, 9999, 10000, 12345, 4.56e8, 7.89e12].map((v) => amt(v, 'ja'))).toEqual(['0', '1', '1,234', '9,999', '1万', '1.23万', '4.56億', '7.89兆']);
  });
  it('TS-011-02 10^(4k) は「1＋単位」、そのすぐ下は 1 つ下の単位で「9,999＋単位」（k=1 は「9,999」）。5 桁・繰り上がりの表記が出ない', () => {
    JA_UNITS.forEach((unit, i) => {
      const k = i + 1;
      expect(amt(`1e${4 * k}`, 'ja'), unit).toBe(`1${unit}`);
      // すぐ下（10^(4k)×(1−1e-9)）。Decimal で作る
      const below = amt(`9.999999999e${4 * k - 1}`, 'ja');
      expect(below, unit).toBe(k === 1 ? '9,999' : `9,999${JA_UNITS[i - 1]}`);
    });
    for (const k of [1, 2, 5, 17]) {
      for (const s of [amt(`9.99999999999999e${4 * k - 1}`, 'ja'), amt(10 ** (4 * k) - 1e-7 * 10 ** (4 * k), 'ja')]) {
        expect(s).not.toMatch(/\d{5}|,\d{4}|10000|1\.00|\.0(?!\d)/);
      }
    }
  });
  it('TS-011-03 1e68 は「1無量大数」、9.999e71 は「9,999無量大数」、1e72 以上は指数', () => {
    expect(['1e68', '9.999e71', '9.9999e71', '1e72', '1.23e100'].map((v) => amt(v, 'ja'))).toEqual(['1無量大数', '9,999無量大数', '9,999無量大数', '1e72', '1.23e100']);
  });
});

describe('英語の自動表記（TS-011-04・05）', () => {
  it('TS-011-04 999・1,234・4.56e6・7.89e9 と T〜Dc', () => {
    expect([999, 1234, 4.56e6, 7.89e9].map((v) => amt(v, 'en'))).toEqual(['999', '1.23K', '4.56M', '7.89B']);
    expect(['1e12', '1e15', '1e18', '1e21', '1e24', '1e27', '1e30', '1e33'].map((v) => amt(v, 'en'))).toEqual(['1T', '1Qa', '1Qi', '1Sx', '1Sp', '1Oc', '1No', '1Dc']);
  });
  it('TS-011-05 999,999 は「999K」（1000K にならない）、Dc の後は aa…zz、1e2064 から指数', () => {
    expect(amt(999_999, 'en')).toBe('999K');
    expect(amt(999_999.994, 'en')).toBe('999K'); // PR #22 のレビューの申し送り: 境界で丸め上げない
    expect(amt(1e6, 'en')).toBe('1M');
    expect(amt('9.99999e35', 'en')).toBe('999Dc');
    expect(amt('1e36', 'en')).toBe('1aa');
    expect(amt('1e39', 'en')).toBe('1ab');
    expect(amt(`1e${36 + 3 * 25}`, 'en')).toBe('1az');
    expect(amt(`1e${36 + 3 * 26}`, 'en')).toBe('1ba');
    expect(amt(`9.999e${36 + 3 * 675 + 2}`, 'en')).toBe('999zz');
    expect(amt('1e2064', 'en')).toBe('1e2064');
  });
});

describe('指数の設定（TS-011-06）', () => {
  it('1,000 未満は自動と同じ、1,000 以上は指数（仮数は小数 2 桁まで切り捨て、末尾の 0 を落とす。言語によらない）', () => {
    for (const lang of ['ja', 'en'] as const) {
      expect([999, 1000, 1234, '1.2e45', '1e45', '1.239e45', 0.5, 0].map((v) => amt(v, lang, 'exp'))).toEqual(['999', '1e3', '1.23e3', '1.2e45', '1e45', '1.23e45', '0', '0']);
    }
    expect(amt('9.996e305', 'en', 'exp')).toBe('9.99e305'); // PR #22 のレビューの申し送り: 「10.00e305」にしない
  });
});

describe('上限と不正な値（TS-011-07）', () => {
  const values: unknown[] = [NUM_MAX, '1e308', '1e309', 0, -5, -0, Number.NaN, Number.POSITIVE_INFINITY, 'abc'];
  it('3 種の表記 × 所持・毎秒・不足で例外にならず、NaN・Infinity・負の記号が出ない', () => {
    for (const v of values)
      for (const lang of ['ja', 'en'] as const)
        for (const notation of ['auto', 'exp'] as const)
          for (const f of [formatAmount, formatRate, formatShortfall]) {
            const s = f(num(v), lang, notation).text;
            expect(s, String(v)).not.toMatch(/NaN|Infinity|-|undefined/);
            expect(s.length).toBeGreaterThan(0);
          }
  });
  it('上限 1e(9e15−1) は正しい指数部で出る', () => {
    expect(amt(NUM_MAX, 'ja')).toBe(`1e${NUM_EXP_MAX}`);
    expect(amt(NUM_MAX, 'en')).toBe(`1e${NUM_EXP_MAX}`);
    // toNumber() が Infinity になる 1e309 以上も正しく出る（英語は zz〔〜1e2063〕まで単位、日本語は 1e72 から指数）
    expect(amt('1e309', 'en')).toBe('1dn');
    expect(amt('1e309', 'en', 'exp')).toBe('1e309');
    expect(amt('1e308', 'ja')).toBe('1e308');
  });
  it('正規化されていない仮数（0.999…e7。BL-106）でも桁を正規化して出す', () => {
    const odd = num(1).add(num(9999998.999999976)); // 仮数 0.999999999999998・指数 7（break_infinity の誤差）
    expect(digitsOf(odd).e).toBe(6);
    expect(formatAmount(odd, 'ja').text).toBe('999万');
    expect(formatAmount(odd, 'en').text).toBe('9.99M');
  });
});

describe('切り捨てと不足額の切り上げ（TS-011-08）', () => {
  it('所持コインとコストは同じ切り捨て、四捨五入を使わない。不足額だけ切り上げ', () => {
    for (const v of [12_300, 12_301, 12_349]) expect(amt(v, 'ja')).toBe('1.23万');
    for (const v of [12_300, 12_301, 12_349]) expect(amt(v, 'en')).toBe('12.3K');
    expect(amt(999_999, 'ja')).toBe('99.9万');
    expect(amt(999_999, 'en')).toBe('999K');
    expect(amt(0.4, 'ja')).toBe('0');
    expect(amt('1.2345e45', 'en', 'exp')).toBe('1.23e45');
    expect(lack(12_301, 'ja')).toBe('1.24万');
    expect(lack(12_301, 'en')).toBe('12.4K');
    expect(lack(12_300, 'ja')).toBe('1.23万'); // ちょうどなら上げない
    expect(lack(0.4, 'ja')).toBe('1');
    expect(lack('1.2345e45', 'en', 'exp')).toBe('1.24e45');
    // 足りないのに Decimal の引き算で差が 0 になった場合（相対 1e-14 未満の差）も「0」にしない
    const c = num(1);
    const k = num(1.0000000000000002);
    expect(c.lt(k)).toBe(true);
    expect(k.sub(c).eq(0)).toBe(true);
    expect(lack(k.sub(c), 'en')).toBe('1');
  });
});

/** c・k を広い桁で作る（差が表示の桁より小さい組を多めに。10^k のすぐ下の値も混ぜる。PR #22 のレビューの申し送り） */
const bigNum = fc.oneof(
  fc.double({ min: 0, max: 2e4, noNaN: true }).map((v) => num(v)),
  fc.tuple(fc.double({ min: 1, max: 9.999999999999, noNaN: true }), fc.integer({ min: 0, max: 400 })).map(([m, e]) => num(`${m}e${e}`)),
  fc.tuple(fc.integer({ min: 1, max: 2100 }), fc.integer({ min: 1, max: 12 })).map(([e, d]) => num(`${(10 - 10 ** -d).toFixed(d)}e${e - 1}`)), // 10^e のすぐ下
  fc.integer({ min: 0, max: 9e15 - 1 }).map((e) => num(`1e${e}`)),
);
/**
 * 表記の境目（QA リードの条件 (a)）: どの境目も 10 のべき乗（日本語の単位 10^(4k)・単位の中の 4 桁の帯の出入り〔1,000万 = 1e7・
 * 9,999万の次 = 1e8〕・英語の 1,000 倍ごと・1e72・1e2064・指数の設定の 1,000）。その直前・ちょうど・直後
 */
const EDGE_OFFSETS = [-1e-3, -1e-9, -1e-15, 0, 1e-15, 1e-9, 1e-3] as const;
const edgeNum = fc
  .tuple(fc.oneof(fc.integer({ min: 0, max: 80 }), fc.constantFrom(72, 2061, 2063, 2064, 2065), fc.integer({ min: 0, max: 2100 })), fc.constantFrom(...EDGE_OFFSETS))
  .map(([e, o]) => num(num(`1e${e}`).mul(1 + o)));
const nearPair = fc.oneof(
  fc.tuple(bigNum, bigNum),
  fc.tuple(bigNum, fc.double({ min: -1e-3, max: 1e-3, noNaN: true })).map(([c, r]) => [c, num(c.mul(1 + r))] as const),
  bigNum.map((c) => [c, c] as const),
  fc.tuple(edgeNum, edgeNum), // 境目をまたぐ組
  fc.tuple(fc.integer({ min: 0, max: 2100 }), fc.constantFrom(...EDGE_OFFSETS), fc.constantFrom(...EDGE_OFFSETS)).map(
    ([e, a, b]) => [num(num(`1e${e}`).mul(1 + a)), num(num(`1e${e}`).mul(1 + b))] as const,
  ),
);

describe('表記と「買えるか」の一致（TS-011-09。Q-33）', () => {
  it('表記どうしで 所持 < コスト なら必ず買えない・所持 > コスト なら必ず買える・等しい値は同じ表記・表記が同じで足りないときの不足額は 0 に見えない', () => {
    fc.assert(
      fc.property(nearPair, fc.constantFrom<Lang>('ja', 'en'), fc.constantFrom<Notation>('auto', 'exp'), ([c, k], lang, notation) => {
        // buyQuote の決め方（所持 ≥ コストなら affordable。src/core/actions.ts）
        const affordable = c.gte(k);
        const fc_ = formatAmount(c, lang, notation);
        const fk = formatAmount(k, lang, notation);
        const d = fc_.value.cmp(fk.value);
        if (d < 0) expect(affordable).toBe(false);
        if (d > 0) expect(affordable).toBe(true);
        if (c.eq(k)) expect(fc_.text).toBe(fk.text);
        // 条件 (b): 表記の種類と言語が同じなら「丸めた値が同じ ⇔ 文字列が同じ」
        expect(fc_.text === fk.text).toBe(d === 0);
        if (!affordable) {
          const l = formatShortfall(k.sub(c), lang, notation);
          expect(l.text).not.toBe('0');
          // 切り上げ: 実際の不足以上（仮数は有効 15 桁に丸めてから切るので、相対 1e-14 未満の差は浮動小数の誤差として扱う）
          expect(l.value.gte(k.sub(c).mul(1 - 1e-14))).toBe(true);
        }
      }),
      { numRuns: 3000, seed: 110 },
    );
  });
  it('条件 (c): 足りないときの目安は「あと 0 コイン」も「あと 0 秒」も出ない（所持がコストのごく近く〔Decimal の引き算で差が消える〕でも）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 150 }),
        fc.constantFrom(-1e-3, -1e-9, -1e-15, -1e-17),
        fc.boolean(),
        fc.constantFrom<Lang>('ja', 'en'),
        (drill, rel, withIncome, lang) => {
          const s = withIncome ? stateWith({ drill, tool: 1, autoOn: true, depth: 3 }) : stateWith({ drill });
          const cost = buyQuote(s, 'drill', 1).cost;
          s.run.coins = num(cost.mul(1 + rel));
          if (s.run.coins.gte(cost)) return; // 浮動小数で同じ値に戻った組は対象外
          const eta = etaOf(s, cost, lang);
          expect(eta.text).not.toMatch(/(^|\s)0(\s|s|$)/);
          if (eta.seconds !== null) expect(eta.seconds).toBeGreaterThanOrEqual(1);
          if (!withIncome) {
            // 収入 0 なら秒の目安はなく（secondsUntil が null。BL-113）、コインの形で出す（PR #38 のレビューの S-1）
            expect(eta.seconds).toBeNull();
            expect(eta.text).toMatch(/^(あと \S+ コイン|\S+ coins? short)$/); // 文言の言語は今の setLang（lang は数の表記だけ）
          }
        },
      ),
      { numRuns: 400, seed: 112 },
    );
  });
  it('表記は値の大小の順番を崩さない（単調）', () => {
    fc.assert(
      fc.property(bigNum, bigNum, fc.constantFrom<Lang>('ja', 'en'), fc.constantFrom<Notation>('auto', 'exp'), (a, b, lang, notation) => {
        const [lo, hi] = a.lte(b) ? [a, b] : [b, a];
        for (const f of [formatAmount, formatRate, formatShortfall]) expect(f(lo, lang, notation).value.lte(f(hi, lang, notation).value)).toBe(true);
      }),
      { numRuns: 2000, seed: 111 },
    );
  });
});

describe('毎秒の量（TS-011-10）', () => {
  it('100 未満は小数 2 桁まで切り捨て（0.29 を 0.28 にしない）、100 以上は所持コインと同じ', () => {
    expect([0, 0.29, 0.375, 0.999, 9.999, 99.999, 100].map((v) => rate(v, 'ja'))).toEqual(['0', '0.29', '0.37', '0.99', '9.99', '99.99', '100']);
    expect(rate(12_345, 'ja')).toBe('1.23万');
    expect(rate(12_345, 'en')).toBe('12.3K');
    expect(rate(0.1 + 0.2, 'en')).toBe('0.3');
    expect(rate(0.005, 'en')).toBe('0');
  });
});

describe('実行環境のロケールによらない（TS-011-11）', () => {
  it('toLocaleString・Intl を使っていない（コードを読む）', async () => {
    const { readFileSync } = await import('node:fs');
    const code = readFileSync(fileURLToPath(new URL('../../src/i18n/number-format.ts', import.meta.url)), 'utf8').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/toLocaleString|Intl\.|toFixed/);
  });
  it('de-DE・fr-FR・ja-JP の子プロセスでも「1,234」「1.23万」「1.23K」', () => {
    const script = [
      "const { formatAmount } = await import('./src/i18n/number-format.ts');",
      "const { num } = await import('./src/core/num.ts');",
      "console.log(JSON.stringify([formatAmount(num(1234),'ja').text, formatAmount(num(12345),'ja').text, formatAmount(num(1234),'en').text]));",
    ].join('\n');
    const root = fileURLToPath(new URL('../..', import.meta.url));
    for (const lang of ['de_DE.UTF-8', 'fr_FR.UTF-8', 'ja_JP.UTF-8']) {
      const out = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', '--input-type=module', '-e', script], {
        cwd: root,
        env: { ...process.env, LANG: lang, LC_ALL: lang },
        encoding: 'utf8',
      });
      expect(JSON.parse(out.trim()), lang).toEqual(['1,234', '1.23万', '1.23K']);
    }
  });
});
