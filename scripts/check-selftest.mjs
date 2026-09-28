// ビルド検査そのもののテスト（BL-008。テスト設計者 BL-008_build-checks.md の TS-008-01〜25）
// 違反を 1 つだけ入れた小さな出力を一時ディレクトリに作り、check:size・check:assets・package・package:verify を
// 実際に子プロセスで起動して、終了コードと「どの規則のどのファイルか」のメッセージを確かめる（偽の緑を防ぐ）。
// 実行: npm run test:checks（node --test）。CI では test の後、build:all の前に実行する。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, test } from 'node:test';
import { BUDGET, MB, transferSize } from './check-lib.mjs';
import { readZip } from './package-zip.mjs';

const root = resolve(import.meta.dirname, '..');
const HEADERS = join(root, 'deploy', 'web', '_headers');
const CG = 'https://sdk.crazygames.com/crazygames-sdk-v3.js';
const POKI = 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js';
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const tmpRoot = mkdtempSync(join(tmpdir(), 'od-checks-'));
after(() => rmSync(tmpRoot, { recursive: true, force: true }));
let seq = 0;
const newDist = () => {
  const d = join(tmpRoot, `case-${++seq}`, 'dist');
  mkdirSync(d, { recursive: true });
  return d;
};

const write = (file, data) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
};

const html = (target, extra = '') => {
  const sdk = target.includes('crazygames') ? `<script src="${CG}"></script>` : target.includes('poki') ? `<script src="${POKI}"></script>` : '';
  return `<!doctype html><html><head>${sdk}<script type="module" src="./assets/index-abcd1234.js"></script>${extra}</head><body></body></html>`;
};

/** 想定どおりの最小の出力（違反なし）を作る */
function makeTarget(distRoot, target, { index = true, headers = target === 'web' } = {}) {
  const dir = join(distRoot, target);
  mkdirSync(join(dir, 'assets'), { recursive: true });
  if (index) write(join(dir, 'index.html'), html(target));
  write(join(dir, 'assets', 'index-abcd1234.js'), target.startsWith('e2e') ? 'window.__game={};console.log(1);' : 'console.log(1);');
  if (headers) copyFileSync(HEADERS, join(dir, '_headers'));
  return dir;
}

const run = (script, args, env = {}) => {
  const r = spawnSync(process.execPath, [join(root, 'scripts', script), ...args], {
    encoding: 'utf8',
    env: { ...process.env, RELEASE_TAG: '', ...env },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};
const size = (dist, ...targets) => run('check-size.mjs', ['--dist', dist, ...targets]);
const assertFail = (r, pattern) => {
  assert.equal(r.code, 1, `失敗するはず:\n${r.out}`);
  if (pattern) assert.match(r.out, pattern, r.out);
};
const assertPass = (r) => assert.equal(r.code, 0, `通るはず:\n${r.out}`);

describe('check:size', () => {
  test('TS-008-01 違反のない 7 種の出力は通り、容量を表示する', () => {
    const d = newDist();
    for (const t of ['web', 'crazygames', 'itch', 'poki', 'e2e', 'e2e-crazygames', 'e2e-poki']) makeTarget(d, t);
    const r = size(d);
    assertPass(r);
    assert.match(r.out, /\| web \| 3 \| [\d.]+ \| [\d.]+ \|/);
  });

  test('TS-008-02 初回ダウンロード（gzip）5MB ちょうどは通り、1 バイト超は失敗', () => {
    for (const extra of [0, 1]) {
      const d = newDist();
      const dir = join(d, 'itch');
      write(join(dir, 'index.html'), html('itch'));
      const base = transferSize(readFileSync(join(dir, 'index.html')), 'index.html');
      write(join(dir, 'assets', 'pad.png'), Buffer.alloc(BUDGET.initialGzipFail - base + extra, 1)); // png は圧縮しないで数える
      const r = size(d, 'itch');
      if (extra) assertFail(r, /\[size\.initial\]/);
      else {
        assertPass(r);
        assert.doesNotMatch(r.out, /\[size\.initial\]/);
      }
    }
  });

  test('TS-008-03 1.5MB ちょうどは警告なし、1 バイト超は警告だけ（終了コード 0）', () => {
    for (const extra of [0, 1]) {
      const d = newDist();
      const dir = join(d, 'itch');
      write(join(dir, 'index.html'), html('itch'));
      const base = transferSize(readFileSync(join(dir, 'index.html')), 'index.html');
      write(join(dir, 'assets', 'pad.png'), Buffer.alloc(BUDGET.initialGzipWarn - base + extra, 1));
      const r = size(d, 'itch');
      assertPass(r);
      if (extra) assert.match(r.out, /\[size\.initial\.warn\]/);
      else assert.doesNotMatch(r.out, /size\.initial/);
    }
  });

  test('TS-008-04 合計 8MB ちょうどは通り、1 バイト超は失敗。20MB の自主予算も定義されている', () => {
    assert.equal(BUDGET.totalFail, 8 * MB);
    assert.equal(BUDGET.totalSelf, 20 * MB);
    for (const extra of [0, 1]) {
      const d = newDist();
      const dir = join(d, 'itch');
      write(join(dir, 'index.html'), html('itch'));
      const base = readFileSync(join(dir, 'index.html')).length;
      write(join(dir, 'assets', 'pad.js'), Buffer.alloc(BUDGET.totalFail - base + extra, 'a')); // よく縮むので初回の検査には当たらない
      const r = size(d, 'itch');
      if (extra) assertFail(r, /\[size\.total\]/);
      else assertPass(r);
    }
  });

  test('TS-008-05 ファイル 300 個は通り、301 個は失敗', () => {
    for (const n of [300, 301]) {
      const d = newDist();
      const dir = join(d, 'itch');
      write(join(dir, 'index.html'), html('itch'));
      for (let i = 1; i < n; i++) write(join(dir, 'assets', `f-${i}.txt`), 'x');
      const r = size(d, 'itch');
      if (n > 300) assertFail(r, /\[files\.count\] ファイル数 301/);
      else assertPass(r);
    }
  });

  test('TS-008-06 index.html がルートにないと失敗', () => {
    const d = newDist();
    const dir = makeTarget(d, 'itch', { index: false });
    write(join(dir, 'game', 'index.html'), html('itch'));
    assertFail(size(d, 'itch'), /\[index\.missing\]/);
  });

  test('TS-008-07 二重引用符の絶対パス（/・//）は失敗、./ は通る', () => {
    for (const [tag, bad] of [
      ['<script src="/assets/a.js"></script>', true],
      ['<link rel="stylesheet" href="/style.css">', true],
      ['<script src="//cdn.example/x.js"></script>', true],
      ['<img srcset="./a.png 1x, /b.png 2x">', true],
      ['<script src="./assets/a.js"></script>', false],
    ]) {
      const d = newDist();
      const dir = makeTarget(d, 'itch');
      write(join(dir, 'index.html'), html('itch', tag));
      const r = size(d, 'itch');
      if (bad) assertFail(r, /\[path\.absolute\] index\.html/);
      else assertPass(r);
    }
  });

  test('TS-008-25 単一引用符と CSS の url()・@import の絶対パスは失敗、./ は通る', () => {
    const cases = [
      ['html', "<script src='/a.js'></script>", true],
      ['html', "<link rel='stylesheet' href='/b.css'>", true],
      ['html', "<script src='./a.js'></script>", false],
      ['css', 'body{background:url(/img.png)}', true],
      ['css', 'body{background:url("/img.png")}', true],
      ['css', '@import "/x.css";', true],
      ['css', 'body{background:url(./img.png)}', false],
      ['css', 'body{background:url(data:image/png;base64,AA==)}', false],
    ];
    for (const [kind, text, bad] of cases) {
      const d = newDist();
      const dir = makeTarget(d, 'itch');
      if (kind === 'html') write(join(dir, 'index.html'), html('itch', text));
      else write(join(dir, 'assets', 'index-abcd1234.css'), text);
      const r = size(d, 'itch');
      if (bad) assertFail(r, /\[path\.absolute\]/);
      else assertPass(r);
    }
  });

  test('絶対パス: <object data>・SVG の xlink:href・.svg ファイルの中も検査する（コードレビュー PR #1 の Nit）', () => {
    const svg = (body) => `<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
    for (const [file, content, bad] of [
      ['index.html', html('itch', '<object data="/x.svg"></object>'), true],
      ['index.html', html('itch', '<svg><image xlink:href="/x.png"/></svg>'), true],
      ['assets/icon.svg', svg('<image href="/x.png"/>'), true],
      ['assets/icon.svg', svg('<image href="./x.png"/><use href="#a"/>'), false],
      ['index.html', html('itch', '<div data-x="/a"></div>'), false],
    ]) {
      const d = newDist();
      const dir = makeTarget(d, 'itch');
      write(join(dir, file), content);
      const r = size(d, 'itch');
      if (bad) assertFail(r, /\[path\.absolute\]/);
      else assertPass(r);
    }
  });

  test('ターゲットを指定しないときは、本番の 4 種がそろっていないと失敗する（コードレビュー PR #1 の Nit）', () => {
    const d = newDist();
    for (const t of ['web', 'crazygames', 'itch', 'e2e']) makeTarget(d, t);
    assertFail(size(d), /\[dist\.missing\].*poki/);
    makeTarget(d, 'poki');
    assertPass(size(d));
  });

  test('TS-008-08 ファイル名の大文字・ASCII 以外・空白・大文字のディレクトリは失敗', () => {
    for (const [name, bad] of [
      ['assets/Atlas.png', true],
      ['assets/地層.png', true],
      ['assets/atlas 1.png', true],
      ['Assets/atlas.png', true],
      ['assets/atlas_1.png', true],
      ['assets/atlas-1.png', false],
      ['main.abc123.js', false],
    ]) {
      const d = newDist();
      // Windows は大文字小文字を区別しないので、Assets/ の場合は assets/ を作らずに置く（ここが Windows で気づけない理由）
      const dir = name.startsWith('Assets/') ? join(d, 'itch') : makeTarget(d, 'itch');
      if (name.startsWith('Assets/')) write(join(dir, 'index.html'), html('itch'));
      write(join(dir, name), 'x');
      const r = size(d, 'itch');
      if (bad) assertFail(r, /\[name\.invalid\]/);
      else assertPass(r);
    }
  });

  test('TS-008-09 SDK 2 種・__game・_headers を 6 ターゲットに 1 つずつ入れる（許可 6 件は通り、18 件は失敗）', () => {
    const targets = ['web', 'crazygames', 'itch', 'poki', 'e2e', 'e2e-crazygames'];
    const allowed = new Set(['crazygames:cg', 'e2e-crazygames:cg', 'poki:poki', 'e2e:hooks', 'e2e-crazygames:hooks', 'web:headers']);
    const inject = {
      cg: (dir) => write(join(dir, 'assets', 'x-abcd1234.js'), `load("${CG}")`),
      poki: (dir) => write(join(dir, 'assets', 'x-abcd1234.js'), `load("${POKI}")`),
      hooks: (dir) => write(join(dir, 'assets', 'x-abcd1234.js'), 'window.__game={}'),
      headers: (dir) => copyFileSync(HEADERS, join(dir, '_headers')),
    };
    const rule = { cg: /\[mix\.crazygames\]/, poki: /\[mix\.poki\]/, hooks: /\[mix\.hooks\]/, headers: /\[mix\.headers\]/ };
    let passed = 0;
    let failed = 0;
    for (const t of targets) {
      for (const k of Object.keys(inject)) {
        const d = newDist();
        inject[k](makeTarget(d, t));
        const r = size(d, t);
        if (allowed.has(`${t}:${k}`)) {
          assertPass(r);
          passed++;
        } else {
          assertFail(r, rule[k]);
          failed++;
        }
      }
    }
    assert.deepEqual([passed, failed], [6, 18]);
  });

  test('TS-008-10 dist/web に _headers がないと失敗し、原本と違っても失敗', () => {
    const d1 = newDist();
    makeTarget(d1, 'web', { headers: false });
    assertFail(size(d1, 'web'), /\[mix\.headers\] _headers がない/);
    const d2 = newDist();
    write(join(makeTarget(d2, 'web'), '_headers'), '/*\n  X-Test: 1\n');
    assertFail(size(d2, 'web'), /\[headers\.diff\]/);
  });

  test('TS-008-11 混入の文字列は .html・.json・.css・.map でも検出する（本番の .map 自体も失敗）', () => {
    for (const [name, data] of [
      ['index.html', html('web', '<script>window.__game=1</script>')],
      ['assets/data-abcd1234.json', '{"k":"__game"}'],
      ['assets/index-abcd1234.css', '/* __game */'],
      ['assets/index-abcd1234.js.map', '{"sources":["__game"]}'],
    ]) {
      const d = newDist();
      write(join(makeTarget(d, 'web'), name), data);
      assertFail(size(d, 'web'), /\[mix\.hooks\] __game（テスト用フック） ?が混入/);
    }
  });

  test('ソースマップ: 本番ビルドの .map・sourceMappingURL は失敗、e2e は通る', () => {
    const d1 = newDist();
    write(join(makeTarget(d1, 'itch'), 'assets', 'index-abcd1234.js.map'), '{}');
    assertFail(size(d1, 'itch'), /\[sourcemap\]/);
    const d2 = newDist();
    write(join(makeTarget(d2, 'itch'), 'assets', 'index-abcd1234.js'), 'x;\n//# sourceMappingURL=index-abcd1234.js.map');
    assertFail(size(d2, 'itch'), /\[sourcemap\] 本番ビルドに sourceMappingURL/);
    const d3 = newDist();
    write(join(makeTarget(d3, 'e2e'), 'assets', 'index-abcd1234.js.map'), '{}');
    assertPass(size(d3, 'e2e'));
  });

  test('TS-008-12 第三者のライブラリに __game があっても失敗する（安全側）', () => {
    const d = newDist();
    write(join(makeTarget(d, 'poki'), 'assets', 'vendor-abcd1234.js'), 'var o={__gameState:1};');
    assertFail(size(d, 'poki'), /\[mix\.hooks\].*vendor-abcd1234\.js/);
  });

  test('想定表にないターゲットは、SDK を「なし」として検査する', () => {
    const d = newDist();
    write(join(makeTarget(d, 'newportal'), 'assets', 'x-abcd1234.js'), `load("${CG}")`);
    const r = size(d, 'newportal');
    assertFail(r, /\[mix\.crazygames\]/);
    assert.match(r.out, /\[target\.unknown\]/);
  });

  test('dist がないと失敗', () => {
    assertFail(size(join(tmpRoot, 'nothing'), 'web'), /\[dist\.missing\]/);
  });
});

const LEDGER_HEAD = [
  '| 素材名 | 区分 | 入手元 | ライセンス | 改変の有無 | ツール／モデル／プラン | 生成日 | プロンプトの要旨 | 人の修正の有無 |',
  '|---|---|---|---|---|---|---|---|---|',
];
const row = (name, cat = 'コードで描画') => `| ${name} | ${cat} | 自作 | 自作 | なし | — | 2026-09-28 | — | なし |`;
const ledger = (rows, head = LEDGER_HEAD) => {
  const f = join(tmpRoot, `ledger-${++seq}.md`);
  write(f, ['# 素材台帳', '', ...head, ...rows, ''].join('\n'));
  return f;
};
const assets = (dist, led, ...targets) => run('check-assets.mjs', ['--dist', dist, '--ledger', led, ...targets]);

describe('check:assets', () => {
  test('TS-008-14 台帳にない素材（画像・音声・フォント 11 種）は失敗し、ファイル名を表示する', () => {
    for (const ext of ['png', 'woff2', 'ogg', 'webp', 'jpg', 'gif', 'svg', 'mp3', 'wav', 'woff', 'ttf']) {
      const d = newDist();
      write(join(makeTarget(d, 'web'), 'assets', `thing-abcd1234.${ext}`), 'x');
      assertFail(assets(d, ledger([row('`atlas.png`')]), 'web'), new RegExp(`\\[asset\\.unlisted\\] web/assets/thing-abcd1234\\.${ext}（キー thing\\.${ext}）`));
    }
  });

  test('TS-008-15 すべて台帳にあれば通る。台帳にだけある素材は参考表示で通る', () => {
    const d = newDist();
    const dir = makeTarget(d, 'web');
    write(join(dir, 'assets', 'atlas-abcd1234.png'), 'x');
    write(join(dir, 'assets', 'dotgothic16-subset-abcd1234.woff2'), 'x');
    const r = assets(d, ledger([row('タイル 4 種（`atlas.png` に収録）'), row('DotGothic16 `dotgothic16-subset.woff2`'), row('`hit.ogg`')]), 'web');
    assertPass(r);
    assert.match(r.out, /参考: 台帳の `hit\.ogg`/);
  });

  test('台帳の「ファイル名」の列（技術リードの Q-15 回答の形）でも照合できる', () => {
    const d = newDist();
    const dir = makeTarget(d, 'web');
    write(join(dir, 'assets', 'atlas-abcd1234.png'), 'x');
    write(join(dir, 'assets', 'dotgothic16-subset-abcd1234.woff2'), 'x');
    const head = [
      '| 素材名 | ファイル名 | 区分 | 入手元 | ライセンス | 改変の有無 | ツール／モデル／プラン | 生成日 | プロンプトの要旨 | 人の修正の有無 |',
      '|---|---|---|---|---|---|---|---|---|---|',
    ];
    const r2 = (name, file) => `| ${name} | ${file} | 自作 | 自作 | 自作 | なし | — | 2026-09-28 | — | なし |`;
    assertPass(assets(d, ledger([r2('タイル', 'atlas.png'), r2('フォント', '`dotgothic16-subset.woff2`')], head), 'web'));
    assertFail(assets(d, ledger([r2('タイル', 'atlas.png')], head), 'web'), /dotgothic16-subset\.woff2/);
  });

  test('TS-008-16 照合キーはファイル名（ディレクトリは見ない）。大文字小文字は区別する', () => {
    const d = newDist();
    write(join(makeTarget(d, 'web'), 'assets', 'atlas-abcd1234.png'), 'x');
    assertPass(assets(d, ledger([row('`src/generated/atlas.png`')]), 'web'));
    assertFail(assets(d, ledger([row('`Atlas.png`')]), 'web'), /大文字小文字が違う/);
  });

  test('TS-008-13 台帳に必要な列がないと失敗', () => {
    const d = newDist();
    makeTarget(d, 'web');
    const head = ['| 素材名 | 区分 | 入手元 | ライセンス |', '|---|---|---|---|'];
    assertFail(assets(d, ledger(['| `a.png` | 自作 | 自作 | 自作 |'], head), 'web'), /\[ledger\.columns\].*改変/);
  });

  test('TS-008-17 区分が 6 種以外なら警告（終了コード 0）', () => {
    const d = newDist();
    write(join(makeTarget(d, 'web'), 'assets', 'atlas-abcd1234.png'), 'x');
    const r = assets(d, ledger([row('`atlas.png`', 'その他')]), 'web');
    assertPass(r);
    assert.match(r.out, /WARN \[ledger\.category\]/);
  });

  // ---- コードレビュー PR #1 の Should（台帳の読み方）と Nit（記録の空欄）----
  const ledgerFile = (lines) => {
    const f = join(tmpRoot, `ledger-${++seq}.md`);
    write(f, [...lines, ''].join('\n'));
    return f;
  };

  test('見出しの 1 列目が「素材名」でない表にだけ書いた素材は、台帳にない扱いで失敗する', () => {
    const d = newDist();
    write(join(makeTarget(d, 'web'), 'assets', 'hit-abcd1234.ogg'), 'x');
    const f = ledgerFile(['# 素材台帳', '', ...LEDGER_HEAD, row('`atlas.png`'), '', '## メモ', '', '| 素材の種類 | メモ |', '|---|---|', '| `hit.ogg` | あとで台帳に書く |']);
    assertFail(assets(d, f, 'web'), /\[asset\.unlisted\] web\/assets\/hit-abcd1234\.ogg/);
  });

  test('台帳の表が 2 つあれば、表ごとに必要な列を検査する', () => {
    const d = newDist();
    write(join(makeTarget(d, 'web'), 'assets', 'atlas-abcd1234.png'), 'x');
    const f = ledgerFile(['# 素材台帳', '', ...LEDGER_HEAD, row('`atlas.png`'), '', '| 素材名 | ライセンス |', '|---|---|', '| `hit.ogg` | CC0 |']);
    assertFail(assets(d, f, 'web'), /\[ledger\.columns\] ledger-\d+\.md:\d+ 台帳の表に必要な列がない/);
  });

  test('素材ファイルを書いた行のライセンスが空か「—」なら失敗、入手元が空なら警告。ファイルのない行は「—」でよい', () => {
    const d = newDist();
    write(join(makeTarget(d, 'web'), 'assets', 'atlas-abcd1234.png'), 'x');
    for (const lic of ['', '—', ' - ']) {
      const r = assets(d, ledger([`| \`atlas.png\` | コードで描画 | 自作 | ${lic} | なし | — | 2026-09-28 | — | なし |`]), 'web');
      assertFail(r, /\[ledger\.license\] .*atlas\.png のライセンスが記録されていない/);
    }
    const r = assets(d, ledger(['| `atlas.png` | コードで描画 | — | 自作 | なし | — | 2026-09-28 | — | なし |']), 'web');
    assertPass(r);
    assert.match(r.out, /WARN \[ledger\.source\]/);
    assertPass(assets(d, ledger([row('`atlas.png`'), '| パレット | 自作 | — | — | — | — | 2026-09-28 | — | — |']), 'web'));
  });

  test('ターゲットを指定しないときは、本番の 4 種がそろっていないと失敗する', () => {
    const d = newDist();
    for (const t of ['web', 'crazygames', 'itch']) makeTarget(d, t);
    const led = ledger([row('`atlas.png`')]);
    assertFail(run('check-assets.mjs', ['--dist', d, '--ledger', led]), /\[dist\.missing\] 本番のターゲット poki/);
    makeTarget(d, 'poki');
    assertPass(run('check-assets.mjs', ['--dist', d, '--ledger', led]));
  });

  test('TS-008-17 区分の 6 種（CEO 承認で追加したフォント（OFL）・コードで生成（効果音など）を含む）は警告なし', () => {
    const d = newDist();
    write(join(makeTarget(d, 'web'), 'assets', 'atlas-abcd1234.png'), 'x');
    const cats = ['AI 生成', 'コードで描画', 'CC0', '自作', 'フォント（OFL）', 'コードで生成（効果音など）'];
    const r = assets(d, ledger(cats.map((c) => row('`atlas.png`', c))), 'web');
    assertPass(r);
    assert.doesNotMatch(r.out, /\[ledger\.category\]/);
  });
});

describe('package', () => {
  const prod = ['web', 'crazygames', 'itch', 'poki'];
  const tag = `v${pkg.version}`;
  const makeAll = () => {
    const d = newDist();
    for (const t of [...prod, 'e2e']) makeTarget(d, t);
    return d;
  };
  const pack = (dist, out, ...extra) => run('package.mjs', ['--dist', dist, '--out', out, ...extra]);

  test('TS-008-18〜20 zip 4 種と SHA256SUMS。ルートに index.html、_headers は web だけ。検算と改ざんの検出', () => {
    const d = makeAll();
    const out = join(dirname(d), 'release');
    assertPass(pack(d, out));
    const zips = readdirSync(out).filter((f) => f.endsWith('.zip')).sort();
    assert.deepEqual(zips, prod.map((t) => `${pkg.name}-${t}-${tag}.zip`).sort());
    const sums = readFileSync(join(out, 'SHA256SUMS'), 'utf8').trim().split('\n');
    assert.equal(sums.length, 4);
    for (const z of zips) {
      const names = readZip(readFileSync(join(out, z))).map((e) => e.name);
      assert.ok(names.includes('index.html'), `${z} のルートに index.html`);
      assert.ok(!names.some((n) => n.startsWith('dist/') || n.startsWith('web/')), `${z} に余計な階層がない`);
      assert.equal(names.includes('_headers'), z.includes('-web-'), `${z} の _headers`);
    }
    assertPass(run('package-verify.mjs', ['--out', out]));
    const target = join(out, zips[0]);
    const buf = readFileSync(target);
    buf[40] ^= 0xff; // 1 バイト書き換える
    writeFileSync(target, buf);
    assertFail(run('package-verify.mjs', ['--out', out]), /NG: .*ハッシュが一致しない/);
  });

  test('TS-008-21 ターゲットが足りないと失敗し、zip を作らない', () => {
    const d = newDist();
    for (const t of ['web', 'crazygames', 'itch']) makeTarget(d, t);
    const out = join(dirname(d), 'release');
    assertFail(pack(d, out), /poki/);
    assert.ok(!existsSync(out) || readdirSync(out).length === 0);
  });

  test('TS-008-22 前回の zip と SHA256SUMS の行が混ざらない', () => {
    const d = makeAll();
    const out = join(dirname(d), 'release');
    write(join(out, `${pkg.name}-web-v0.0.0.zip`), 'old');
    write(join(out, 'SHA256SUMS'), `${'0'.repeat(64)}  ${pkg.name}-web-v0.0.0.zip\n`);
    assertPass(pack(d, out));
    assert.ok(!existsSync(join(out, `${pkg.name}-web-v0.0.0.zip`)));
    const sums = readFileSync(join(out, 'SHA256SUMS'), 'utf8');
    assert.doesNotMatch(sums, /v0\.0\.0/);
    assert.equal(sums.trim().split('\n').length, 4);
  });

  test('package:verify は本番の 4 種がそろわないか、SHA256SUMS にない zip があると失敗する（コードレビュー PR #1 の Nit）', () => {
    const d = makeAll();
    const out = join(dirname(d), 'release');
    assertPass(pack(d, out));
    const stray = join(out, `${pkg.name}-web-v0.0.0.zip`);
    write(stray, 'old');
    assertFail(run('package-verify.mjs', ['--out', out]), /NG: .*-web-v0\.0\.0\.zip は SHA256SUMS に載っていない/);
    rmSync(stray);
    const sumsPath = join(out, 'SHA256SUMS');
    const kept = readFileSync(sumsPath, 'utf8').trim().split('\n').filter((l) => !l.includes('-poki-'));
    writeFileSync(sumsPath, `${kept.join('\n')}\n`);
    rmSync(join(out, `${pkg.name}-poki-${tag}.zip`));
    assertFail(run('package-verify.mjs', ['--out', out]), /NG: 本番の .*-poki-.* が SHA256SUMS にない/);
  });

  test('e2e 系は zip にしない。RELEASE_TAG が version と違えば失敗', () => {
    const d = makeAll();
    const out = join(dirname(d), 'release');
    assertFail(pack(d, out, 'e2e'), /本番のターゲットではない/);
    assertFail(run('package.mjs', ['--dist', d, '--out', out], { RELEASE_TAG: 'v999.0.0' }), /RELEASE_TAG/);
  });
});

describe('ci.yml', () => {
  const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8').replaceAll('\r\n', '\n');
  /** jobs: の下の 1 つのジョブの本文 */
  const job = (name) => {
    const m = new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][\\w-]*:\\n|(?![\\s\\S]))`, 'm').exec(ci);
    assert.ok(m, `ジョブ ${name} がない`);
    return m[1];
  };

  test('TS-008-23 verify の順番: gitleaks → lint → typecheck → test → build:all → check:size → check:assets', () => {
    const v = job('verify');
    const order = [
      /"\$RUNNER_TEMP\/gitleaks" git /,
      /run: npm ci$/m,
      /run: npm run lint$/m,
      /run: npm run typecheck$/m,
      /run: npm run test$/m,
      /run: npm run build:all$/m,
      /run: npm run check:size$/m,
      /run: npm run check:assets$/m,
    ].map((re) => {
      const i = v.search(re);
      assert.ok(i >= 0, `verify に ${re} がない`);
      return i;
    });
    for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], `順番が違う（${i} 番目）`);
  });

  test('TS-008-23 前の手順が失敗したら後ろは動かない（continue-on-error・always() なし、後ろのジョブは needs）', () => {
    const v = job('verify');
    assert.doesNotMatch(v, /continue-on-error:\s*true/);
    assert.doesNotMatch(v, /if:.*(always|failure|cancelled)\(\)/);
    assert.match(job('e2e'), /needs:\s*verify/);
    assert.match(job('deploy-preview'), /needs:\s*\[verify, e2e\]/);
    assert.match(job('deploy-staging'), /needs:\s*verify/);
  });

  test('npm に統一（npm ci・cache: npm・npx playwright・PW_CHANNEL=chromium、pnpm なし）', () => {
    assert.doesNotMatch(ci, /pnpm/);
    assert.match(ci, /cache: npm/);
    const e = job('e2e');
    assert.match(e, /run: npx playwright install --with-deps chromium/);
    assert.match(e, /PW_CHANNEL: chromium/);
  });

  // ---- コードレビュー PR #1 の Must: CI から本番（Pages の本番ブランチ main）に出さない ----
  const nightly = readFileSync(join(root, '.github', 'workflows', 'nightly.yml'), 'utf8').replaceAll('\r\n', '\n');
  /** ジョブの本文を step ごとに分ける */
  const steps = (body) => body.split(/\n(?= {6}- )/);

  test('本番に出さない: ci.yml・nightly.yml に本番ブランチ（main・production）へのデプロイがない。ステージングは staging に固定', () => {
    for (const [name, text] of [['ci.yml', ci], ['nightly.yml', nightly]])
      assert.doesNotMatch(text, /--branch(?:=|\s+)["']?(?:main|production)\b/, `${name} に本番ブランチへのデプロイがある`);
    assert.doesNotMatch(nightly, /pages deploy/);
    assert.match(job('deploy-staging'), /wrangler pages deploy dist\/web --project-name="\$PROJECT" --branch=staging /);
  });

  test('本番に出さない: PR は main をベースにしたものだけで動く（head が main の PR を作れないようにする）', () => {
    assert.match(ci, /^on:\n {2}pull_request:\n {4}branches: \[main\]\n/m);
  });

  test('本番に出さない: deploy-preview は同じリポジトリの PR だけ。空・main・staging・production のブランチ名を、同じ step で deploy の前に拒否する', () => {
    const p = job('deploy-preview');
    assert.match(p, /if: .*github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
    const st = steps(p).find((s) => /wrangler pages deploy/.test(s));
    assert.ok(st, 'deploy-preview に wrangler pages deploy の step がない');
    const guard = st.search(/''\|main\|staging\|production\)/);
    assert.ok(guard >= 0, 'ブランチ名の拒否がない');
    const exit = st.indexOf('exit 1', guard);
    assert.ok(exit > guard && exit < st.search(/wrangler pages deploy/), '拒否（exit 1）が deploy より前にない');
    assert.match(st, /tr '\[:upper:\]' '\[:lower:\]'/, '小文字にしてから比べていない');
    assert.match(st, /sed -E 's\/\[\^a-z0-9\]\+\/-\/g/, 'Pages の別名（英数字以外をハイフン）にしてからも比べていない');
  });

  // ---- コードレビュー PR #1 の Should: サプライチェーン ----
  test('サプライチェーン: 第三者のアクションを使わない。gitleaks は版と SHA256 を固定した CLI で、全ブランチの全履歴を -m 付きで走査する', () => {
    for (const [name, text] of [['ci.yml', ci], ['nightly.yml', nightly]])
      for (const m of text.matchAll(/uses:\s*([^\s#]+)/g)) assert.match(m[1], /^actions\//, `${name} に第三者のアクション: ${m[1]}`);
    const v = job('verify');
    assert.match(v, /GITLEAKS_VERSION: \d+\.\d+\.\d+/);
    assert.match(v, /GITLEAKS_SHA256: [0-9a-f]{64}/);
    assert.match(v, /sha256sum -c/);
    assert.match(v, /"\$RUNNER_TEMP\/gitleaks" git --log-opts="--all -m"/);
    assert.match(v, /fetch-depth: 0/);
  });

  test('サプライチェーン: wrangler は deploy/package-lock.json から --ignore-scripts で、トークンのない step で入れる', () => {
    assert.doesNotMatch(ci, /npx[^\n]*wrangler/);
    const dpkg = JSON.parse(readFileSync(join(root, 'deploy', 'package.json'), 'utf8'));
    assert.match(dpkg.devDependencies?.wrangler ?? '', /^\d+\.\d+\.\d+$/, 'wrangler の版を固定する');
    assert.ok(existsSync(join(root, 'deploy', 'package-lock.json')), 'deploy/package-lock.json がない');
    for (const name of ['deploy-preview', 'deploy-staging']) {
      const ss = steps(job(name));
      const install = ss.find((s) => s.includes('npm ci --prefix deploy'));
      assert.ok(install, `${name} に npm ci --prefix deploy がない`);
      assert.match(install, /--ignore-scripts/);
      assert.doesNotMatch(install, /CLOUDFLARE_API_TOKEN/);
      for (const s of ss)
        if (s.includes('CLOUDFLARE_API_TOKEN')) assert.doesNotMatch(s, /npm (ci|install)|npx /, `${name}: トークンのある step でインストールしている`);
    }
  });

  test('checkout は認証情報を残さない（persist-credentials: false）', () => {
    for (const [name, text] of [['ci.yml', ci], ['nightly.yml', nightly]]) {
      const n = (text.match(/uses: actions\/checkout@/g) ?? []).length;
      const p = (text.match(/persist-credentials: false/g) ?? []).length;
      assert.equal(p, n, `${name}: checkout ${n} 件のうち persist-credentials: false は ${p} 件`);
    }
  });
});
