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
import { BUDGET, E2E_JOB_TARGETS, FAKE_AD, MB, PRODUCTION_TARGETS, transferSize } from './check-lib.mjs';
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

/** 偽の広告（src/platform/dev.ts）を vite build で圧縮した後の形（2026-09-28 に feat/S1-core の dist/e2e-web で実測した並びを短くしたもの） */
const FAKE_AD_JS = 'let n=document.createElement(`div`);n.textContent=`FAKE AD (${e})`,n.dataset.testid=`fake-ad`;';
/** 偽の広告が入るはずのターゲット（QA test-strategy §4-5: e2e＝web＋フック＋偽の広告。出力名は e2e（PoC）か e2e-web） */
const FAKE_AD_TARGETS = new Set(['e2e', 'e2e-web']);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 想定どおりの最小の出力（違反なし）を作る */
function makeTarget(distRoot, target, { index = true, headers = target === 'web' } = {}) {
  const dir = join(distRoot, target);
  mkdirSync(join(dir, 'assets'), { recursive: true });
  if (index) write(join(dir, 'index.html'), html(target));
  write(join(dir, 'assets', 'index-abcd1234.js'), target.startsWith('e2e') ? 'window.__game={};console.log(1);' : 'console.log(1);');
  if (FAKE_AD_TARGETS.has(target)) write(join(dir, 'assets', 'dev-abcd1234.js'), FAKE_AD_JS);
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

  // ---- コードレビュー S1-core の S-8: .env.local の VITE_FAKE_ADS=true で、偽の広告が本番のビルドに入る ----
  test('S-8 偽の広告の目印（FAKE AD・fake-ad）が 1 つでも、本番 4 種・e2e-crazygames・e2e-poki・想定表にないターゲットに入ると失敗する', () => {
    const cases = [
      ['assets/dev-abcd1234.js', FAKE_AD_JS, 'FAKE AD・fake-ad'], // vite build の実際の形（2 つとも）
      ['assets/dev-abcd1234.js', 'n.textContent=`FAKE AD (${e})`;', 'FAKE AD'], // 画面の文言だけ
      ['assets/dev-abcd1234.js', 'n.dataset.testid="fake-ad";', 'fake-ad'], // data-testid だけ
      ['index.html', null, 'fake-ad'], // .js 以外（全ファイルのバイト列で検査する）
    ];
    for (const t of ['web', 'crazygames', 'itch', 'poki', 'e2e-crazygames', 'e2e-poki', 'newportal']) {
      for (const [name, data, marks] of cases) {
        const d = newDist();
        write(join(makeTarget(d, t), name), data ?? html(t, '<div data-testid="fake-ad"></div>'));
        assertFail(size(d, t), new RegExp(`\\[mix\\.fakeads\\] 偽の広告が混入: ${escRe(`${name}（${marks}）`)}`));
      }
    }
  });

  test('S-8 偽の広告が入るはずの e2e・e2e-web は、目印が 1 つでも欠けると失敗する（dev.ts の文言が変わって目印が古くなる偽の緑を防ぐ）', () => {
    for (const t of FAKE_AD_TARGETS) {
      const ok = newDist();
      makeTarget(ok, t);
      const r = size(ok, t);
      assertPass(r);
      assert.match(r.out, new RegExp(`\\| ${t} \\|(?: [^|]+ \\|){6} あり \\|`), '表の fake ad の列が「あり」');
      for (const [data, missing] of [
        ['n.dataset.testid=`fake-ad`;', 'FAKE AD'],
        ['n.textContent=`FAKE AD (${e})`;', 'fake-ad'],
        ['console.log(2);', 'FAKE AD'],
      ]) {
        const d = newDist();
        write(join(makeTarget(d, t), 'assets', 'dev-abcd1234.js'), data); // 基準の偽の広告を置き換える
        assertFail(size(d, t), new RegExp(`\\[mix\\.fakeads\\] 偽の広告の目印「${missing}」があるはずのビルドにない`));
      }
    }
  });

  test('S-8 目印は 2 つとも偽の広告の本体（src/platform/dev.ts）にある', () => {
    assert.deepEqual(FAKE_AD, ['FAKE AD', 'fake-ad']);
    const src = readFileSync(join(root, 'src', 'platform', 'dev.ts'), 'utf8');
    for (const m of FAKE_AD) assert.ok(src.includes(m), `src/platform/dev.ts に「${m}」がない（文言を変えたら scripts/check-lib.mjs の FAKE_AD も直す）`);
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

describe('check-e2e-dist（CI の e2e ジョブが受け取ったビルドの確認。BL-095）', () => {
  const check = (dist) => run('check-e2e-dist.mjs', ['--dist', dist]);
  const make = (dist, ...dirs) => {
    for (const d of dirs) write(join(dist, d, 'index.html'), '<!doctype html>');
    return dist;
  };

  test('受け取るのは e2e 系 2 種（e2e-web・e2e-crazygames）と本番の 4 種。PoC の e2e・e2e-poki は入れない', () => {
    assert.deepEqual([...E2E_JOB_TARGETS].sort(), ['crazygames', 'e2e-crazygames', 'e2e-web', 'itch', 'poki', 'web']);
    for (const t of PRODUCTION_TARGETS) assert.ok(E2E_JOB_TARGETS.includes(t), `本番の ${t} が E2E_JOB_TARGETS にない`);
    assert.equal(new Set(E2E_JOB_TARGETS).size, E2E_JOB_TARGETS.length, '重複がある');
  });

  test('6 つとも index.html があれば通り、受け取ったものを並べる', () => {
    const d = make(newDist(), ...E2E_JOB_TARGETS);
    const r = check(d);
    assertPass(r);
    for (const t of E2E_JOB_TARGETS) assert.match(r.out, new RegExp(`${escRe(`${d}/${t}`)}(?:・|\\n|$)`));
  });

  test('どれか 1 つでも index.html がなければ、その名前を出して失敗（ディレクトリだけあっても欠けている扱い）', () => {
    for (const miss of E2E_JOB_TARGETS) {
      const d = make(newDist(), ...E2E_JOB_TARGETS.filter((t) => t !== miss));
      mkdirSync(join(d, miss, 'assets'), { recursive: true });
      const r = check(d);
      assertFail(r, new RegExp(`check-e2e-dist: NG ${escRe(`${d}/${miss}/index.html`)} がない`));
    }
  });

  test('PoC の dist/e2e は dist/e2e-web の代わりにならない。欠けたものは全部並べる', () => {
    const d = make(newDist(), 'e2e', 'e2e-crazygames', 'e2e-poki', 'web', 'crazygames');
    const r = check(d);
    assertFail(r, new RegExp(`NG ${escRe(`${d}/e2e-web/index.html`)}・${escRe(`${d}/itch/index.html`)}・${escRe(`${d}/poki/index.html`)} がない`));
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
  /** ジョブの本文を step ごとに分ける */
  const steps = (body) => body.split(/\n(?= {6}- )/);
  /** ワークフローのジョブの名前の一覧（jobs: の直下） */
  const names = (text) => [...(/^jobs:\n([\s\S]*)$/m.exec(text)?.[1] ?? '').matchAll(/^ {2}([a-z][\w-]*):\n/gm)].map((m) => m[1]);

  // verify は E2E まで 1 つのジョブ（Actions の分数の削減 A1。org/10_development/devops/2026-09-29_actions-minutes.md）
  test('TS-008-23 verify の順番: gitleaks → lint → typecheck → test → test:checks → build:all → build:e2e → check:size → check:assets → check-e2e-dist → Playwright → test:e2e', () => {
    const v = job('verify');
    const order = [
      /"\$RUNNER_TEMP\/gitleaks" git /,
      /run: npm ci$/m,
      /run: npm run lint$/m,
      /run: npm run typecheck$/m,
      /run: npm run test$/m,
      /run: npm run test:checks$/m,
      /run: npm run build:all$/m,
      /run: npm run build:e2e$/m,
      /run: npm run check:size$/m,
      /run: npm run check:assets$/m,
      /run: node scripts\/check-e2e-dist\.mjs$/m,
      /run: npx playwright install --with-deps chromium$/m,
      /run: npm run test:e2e$/m,
    ].map((re) => {
      const i = v.search(re);
      assert.ok(i >= 0, `verify に ${re} がない`);
      return i;
    });
    for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], `順番が違う（${i} 番目）`);
  });

  test('TS-008-23 前の手順が失敗したら後ろは動かない（continue-on-error なし、failure() は記録の 2 つだけ、後ろのジョブは needs: verify）', () => {
    // failure()・always()・continue-on-error・step の順番・記録の保存の検査は assertFailureReportPolicy（下の BL-099 の describe）
    assert.doesNotMatch(job('verify'), /continue-on-error:\s*true/);
    assert.deepEqual(names(ci), ['verify', 'deploy-preview', 'deploy-staging'], 'ジョブは verify（E2E を含む）と 2 つのデプロイだけ（A1）');
    assert.match(job('deploy-preview'), /^ {4}needs: verify(?:\s+#.*)?$/m);
    assert.match(job('deploy-staging'), /^ {4}needs: verify(?:\s+#.*)?$/m);
  });

  test('決定 0007（QA の条件 1）: main への push でも PR と同じ npm run test:e2e が動き、deploy-staging はその緑（E2E を含む verify）を待つ', () => {
    const v = job('verify');
    // ジョブの if: は「preview 以外のラベルの run では動かない」だけ。push（や main）を外していない
    const jobIf = /^ {4}if: (.*)$/m.exec(v)?.[1] ?? '';
    assert.equal(jobIf, "github.event.action != 'labeled' || github.event.label.name == 'preview'", `verify の if: が変わった（push で E2E が動くか確かめ直す）: ${jobIf}`);
    assert.match(ci, /^on:\n(?: {2}.*\n| {4}.*\n)*? {2}push:\n {4}branches: \[main\]\n/m, 'main への push で ci.yml が動かない');
    // test:e2e の step 自体に if: がない（push で飛ばされない）
    const st = steps(v).find((s) => /^ +run: npm run test:e2e$/m.test(s));
    assert.ok(st, 'verify に npm run test:e2e の step がない');
    assert.doesNotMatch(st, /^ {6}(?:- | {2})if:/m, 'test:e2e の step に if: がある（main の push で飛ばしうる）');
    const staging = job('deploy-staging');
    assert.match(staging, /^ {4}needs: verify(?:\s+#.*)?$/m, 'deploy-staging が E2E を含む verify を待たない');
    assert.doesNotMatch(staging, /^ {4}if: .*(always|failure|cancelled)\(\)/m, 'deploy-staging が E2E の失敗でも動く');
  });

  test('A2: deploy-preview は preview のラベルの付いた PR だけ。preview 以外のラベルを付けただけの run は何もせず、実行中の CI を取り消さない', () => {
    assert.match(ci, /^ {2}pull_request:\n {4}branches: \[main\]\n(?: {4}#.*\n)* {4}types: \[opened, synchronize, reopened, labeled\]\n/m, 'pull_request の types に labeled（ほかは既定の 3 つ）');
    assert.match(job('deploy-preview'), /^ {4}if: .*&& contains\(github\.event\.pull_request\.labels\.\*\.name, 'preview'\)$/m, 'deploy-preview が preview のラベルを条件にしない');
    assert.match(
      ci,
      /^ {2}group: ci-\$\{\{ github\.ref \}\}\$\{\{ github\.event\.action == 'labeled' && github\.event\.label\.name != 'preview' && format\('-label-\{0\}', github\.run_id\) \|\| '' \}\}$/m,
      'preview 以外のラベルの run が、同じ PR の実行中の CI を取り消す',
    );
  });

  test('A3: Playwright のブラウザは actions/cache で package-lock.json をキーにキャッシュし、その後に install --with-deps する', () => {
    const ss = steps(job('verify'));
    const cache = ss.findIndex((s) => /uses: actions\/cache@\S+/.test(s));
    const install = ss.findIndex((s) => /^ +run: npx playwright install --with-deps chromium$/m.test(s));
    assert.ok(cache >= 0 && install > cache, 'キャッシュの step が Playwright の導入の前にない');
    assert.match(ss[cache], /^ {10}path: ~\/\.cache\/ms-playwright$/m);
    assert.match(ss[cache], /^ {10}key: playwright-\$\{\{ runner\.os \}\}-\$\{\{ hashFiles\('package-lock\.json'\) \}\}$/m);
    assert.equal((ci.match(/uses: actions\/cache@/g) ?? []).length, 1, 'キャッシュは Playwright の 1 つだけ');
  });

  test('npm に統一（npm ci・cache: npm・npx playwright・PW_CHANNEL=chromium、pnpm なし）', () => {
    assert.doesNotMatch(ci, /pnpm/);
    assert.match(ci, /cache: npm/);
    const v = job('verify');
    assert.match(v, /run: npx playwright install --with-deps chromium/);
    assert.match(v, /PW_CHANNEL: chromium/);
  });

  // ---- E2E が配信するビルド（BL-095 から e2e 系 2 種と本番 4 種。A1 で同じジョブで作る） ----
  /** コメント行を除いた本文（注記に書いた語で検査が通ったり落ちたりしないように） */
  const code = (body) => body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

  test('A1: dist-e2e の受け渡しはない（E2E は同じジョブのビルドを使う）。保存するのはデプロイ用の dist-web（1 日）と失敗したときの記録だけ', () => {
    const c = code(ci);
    assert.doesNotMatch(c, /dist-e2e|download-artifact@\S+\n {8}with:\n {10}name: (?!dist-web\n)/, 'dist-e2e の保存・受け取りが残っている');
    const st = steps(job('verify')).find((s) => /^ {10}name: dist-web$/m.test(s));
    assert.ok(st, 'verify に dist-web の upload-artifact がない');
    assert.match(st, /^ {10}path: dist\/web\/$/m);
    assert.match(st, /^ {10}retention-days: 1$/m, '保存は 1 日（500MB の枠）');
    assert.match(st, /^ {10}if-no-files-found: error$/m);
  });

  test('verify は check-e2e-dist.mjs で E2E が配信する 6 つ（E2E_JOB_TARGETS）を Playwright の導入の前に確かめ、常に npm run test:e2e を流す', () => {
    const v = job('verify');
    const c = code(v);
    for (const [re, why] of [
      [/PW_DIST/, 'PW_DIST を渡さない（serve.mjs で mode の outDir より優先され、S2 の PW_MODE=e2e-crazygames を上書きする）'],
      [/smoke\.spec\.ts/, 'PoC のスモークだけを流す分岐は撤去済み'],
      [/test:e2e:nightly|if node -e/, 'test:e2e:nightly の有無による分岐は撤去済み'],
      [/pick-e2e-dist/, 'pick-e2e-dist.mjs は check-e2e-dist.mjs に置き換えた'],
    ])
      assert.doesNotMatch(c, re, why);
    const ss = steps(v);
    const at = (re, what) => {
      const i = ss.findIndex((s) => re.test(s));
      assert.ok(i >= 0, `verify に ${what} がない`);
      return i;
    };
    const order = [
      at(/^ +run: npm run build:e2e$/m, 'build:e2e'),
      at(/^ +run: node scripts\/check-e2e-dist\.mjs$/m, 'check-e2e-dist.mjs'),
      at(/^ +run: npx playwright install --with-deps chromium$/m, 'Playwright の導入'),
      at(/^ +run: npm run test:e2e$/m, 'npm run test:e2e（1 行だけの run）'),
    ];
    for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], `verify の E2E の step の順番が違う（${i} 番目）`);
  });

  // ---- コードレビュー PR #1 の Must: CI から本番（Pages の本番ブランチ main）に出さない ----
  const nightly = readFileSync(join(root, '.github', 'workflows', 'nightly.yml'), 'utf8').replaceAll('\r\n', '\n');

  test('本番に出さない: ci.yml・nightly.yml に本番ブランチ（main・production）へのデプロイがない。ステージングは staging に固定', () => {
    for (const [name, text] of [['ci.yml', ci], ['nightly.yml', nightly]])
      assert.doesNotMatch(text, /--branch(?:=|\s+)["']?(?:main|production)\b/, `${name} に本番ブランチへのデプロイがある`);
    assert.doesNotMatch(nightly, /pages deploy/);
    assert.match(job('deploy-staging'), /wrangler pages deploy dist\/web --project-name="\$PROJECT" --branch=staging /);
  });

  test('本番に出さない: PR は main をベースにしたものだけで動く（head が main の PR を作れないようにする）', () => {
    assert.match(ci, /^on:\n {2}pull_request:\n {4}branches: \[main\]\n/m);
  });

  test('本番に出さない（PR #25 のレビュー S-2）: pages deploy は deploy-preview・deploy-staging の 2 つだけで、どちらも --branch を明示する。secrets を参照するのもこの 2 つだけ', () => {
    // --branch がないと wrangler は git のブランチ（main の push では main＝Pages の本番ブランチ）を使いうる【一般知見・要確認】
    const all = [...code(ci).matchAll(/pages deploy[^\n]*/g)].map((m) => m[0]);
    assert.equal(all.length, 2, `pages deploy が 2 か所でない: ${all.join(' / ')}`);
    for (const name of names(ci)) {
      const body = code(job(name));
      if (name === 'deploy-preview' || name === 'deploy-staging') {
        const d = /pages deploy[^\n]*/.exec(body)?.[0];
        assert.ok(d, `${name} に pages deploy がない`);
        assert.match(d, / --branch=\S+/, `${name} の pages deploy が --branch を明示しない: ${d}`);
      } else {
        assert.doesNotMatch(body, /pages deploy/, `${name} に pages deploy がある`);
        assert.doesNotMatch(body, /\bsecrets\b/, `${name} が secrets を参照している（secrets はデプロイの 2 つのジョブだけ）`);
      }
    }
    assert.doesNotMatch(code(ci.slice(0, ci.indexOf('\njobs:'))), /\bsecrets\b/, 'ワークフロー直下（env: など）で secrets を参照している');
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

// ---- 毎晩のジョブ（BL-084）と、失敗したときの E2E の記録（BL-099 と同じ方針。決定 0006-2・4、QA 判定書 S1 §6-2・§6-3） ----
/** ワークフローの jobs: の下の 1 つのジョブの本文 */
function jobOf(text, name) {
  const m = new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][\\w-]*:\\n|(?![\\s\\S]))`, 'm').exec(text);
  assert.ok(m, `ジョブ ${name} がない`);
  return m[1];
}
/** ジョブの本文を step ごとに分ける */
const stepsOf = (body) => body.split(/\n(?= {6}- )/);
/** コメント行を除いた本文 */
const codeOf = (body) => body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
const HTML_REPORT = "hashFiles('playwright-report/index.html')";

/**
 * 失敗したときの記録の方針: playwright-report/ だけを 3 日。test-results/ は HTML レポートができなかったとき
 * （index.html がないとき）だけ。成功した回には何も残さない。failure()・always() を使うのはこの 2 つの step だけ。
 * テストの step には、ジョブより短い timeout-minutes（ジョブのタイムアウトで止まると failure() の step も動かず、何も残らない）
 */
function assertFailureReportPolicy(body, label, testRuns, allowUploads = []) {
  const ss = stepsOf(body);
  // step の最初の行が `- if:` の形でも `- name:` の下の `if:` でも捕まえる（PR #9 のレビュー S-2 (1)）
  const ifOf = (s) => /^ {6}(?:- | {2})if: (.*)$/m.exec(s)?.[1] ?? '';
  const artifactOf = (s) => /^ {10}name: (\S+)$/m.exec(s)?.[1];
  // 記録以外に許す保存（名前で明示。例: ci.yml の verify のデプロイ用の dist-web。A1）は、条件なし・1 日
  const others = ss.filter((s) => /uses: actions\/upload-artifact@/.test(s) && allowUploads.includes(artifactOf(s)));
  assert.equal(others.length, allowUploads.length, `${label}: 許した保存（${allowUploads.join('・')}）がない`);
  for (const s of others) {
    assert.equal(ifOf(s), '', `${label}: ${artifactOf(s)} の保存に if: がある`);
    assert.match(s, /^ {10}retention-days: 1$/m, `${label}: ${artifactOf(s)} の保存は 1 日`);
  }
  const uploads = ss.filter((s) => /uses: actions\/upload-artifact@/.test(s) && !others.includes(s));
  // このジョブの保存は記録の 2 つだけ（3 つ目を足すなら、この検査を明示的に変える。S-2 (2)）
  assert.equal(uploads.length, 2, `${label}: upload-artifact の step が 2 つでない（${uploads.length}）。失敗したときの記録の 2 つ以外に保存を足していないか`);
  const report = uploads.filter((s) => /^ {10}path: playwright-report\/$/m.test(s));
  const results = uploads.filter((s) => /^ {10}path: test-results\/$/m.test(s));
  assert.equal(report.length, 1, `${label}: playwright-report/ を保存する step が 1 つでない（${report.length}）`);
  assert.equal(results.length, 1, `${label}: test-results/ を保存する step が 1 つでない（${results.length}）`);
  assert.equal(ifOf(report[0]), `failure() && ${HTML_REPORT} != ''`, `${label}: HTML レポートは失敗したときで index.html があるときだけ`);
  assert.equal(ifOf(results[0]), `failure() && ${HTML_REPORT} == ''`, `${label}: test-results/ は HTML レポートができなかったときだけ`);
  for (const s of [report[0], results[0]]) {
    assert.match(s, /^ {10}retention-days: 3$/m, `${label}: 失敗したときの記録の保存は 3 日（500MB の枠。BL-099）`);
    assert.doesNotMatch(s, /^ {10}path: \|/m, `${label}: 1 つの成果物に playwright-report/ と test-results/ を一緒に入れない`);
  }
  for (const s of ss) {
    if (/(?:always|failure|cancelled)\(\)/.test(ifOf(s)))
      assert.ok(s === report[0] || s === results[0], `${label}: failure()・always() を記録を残す step 以外に使っている:\n${s}`);
    // `if:` をブロックスカラー（> や |）で書くと ifOf が読めない。1 行で書き、`${{ }}` で包まない（PR #19 のレビュー N-2）
    assert.doesNotMatch(s, /^ {6}(?:- | {2})if:\s*[>|]/m, `${label}: if: をブロックスカラーで書いている:\n${s}`);
    // continue-on-error は false 以外の値（true・`${{ true }}` など）をすべて拒む（N-2）
    assert.doesNotMatch(s, /continue-on-error:\s*(?!false\s*(?:#.*)?$)\S/m, `${label}: continue-on-error`);
  }
  assert.doesNotMatch(body, /^ {4}continue-on-error:\s*(?!false\s*(?:#.*)?$)\S/m, `${label}: ジョブ単位の continue-on-error`);
  const job = /^ {4}timeout-minutes: (\d+)(?:\s+#.*)?$/m.exec(body);
  assert.ok(job, `${label}: ジョブに timeout-minutes がない`);
  const lastRecord = Math.min(ss.indexOf(report[0]), ss.indexOf(results[0]));
  for (const run of testRuns) {
    const i = ss.findIndex((s) => new RegExp(`^ {8}run: ${escRe(run)}$`, 'm').test(s));
    assert.ok(i >= 0, `${label}: run: ${run} の step がない`);
    // 記録の step はテストの後（前にあると、テストが落ちても何も保存されない。S-2 (3)）
    assert.ok(i < lastRecord, `${label}: 失敗したときの記録の step が ${run} より前にある`);
    const t = /^ {8}timeout-minutes: (\d+)(?:\s+#.*)?$/m.exec(ss[i]);
    assert.ok(t, `${label}: ${run} に timeout-minutes がない（ジョブのタイムアウトで止まると記録が残らない）`);
    // 準備（npm ci・ブラウザの導入など）と記録の保存に使う時間を 10 分残す（PR #9 のレビュー N-2）
    assert.ok(Number(job[1]) - Number(t[1]) >= 10, `${label}: ${run} の timeout-minutes（${t[1]}）とジョブ（${job[1]}）の差が 10 分より短い`);
  }
}

describe('nightly.yml（BL-084。毎晩の E2E は balance・property と別のジョブ。決定 0006-2）', () => {
  const nightly = readFileSync(join(root, '.github', 'workflows', 'nightly.yml'), 'utf8').replaceAll('\r\n', '\n');
  const e = jobOf(nightly, 'e2e');

  test('E2E のジョブは balance・property を呼ばず、ほかのジョブを待たない（BL-090 がそろう前から動く）', () => {
    const c = codeOf(e);
    assert.doesNotMatch(c, /test:balance|test:property/);
    assert.doesNotMatch(c, /^ {4}needs:/m);
  });

  test('npm ci → build:all → build:e2e → Playwright（chromium・webkit・firefox）→ mode ごとに test:e2e:nightly／test:e2e:full（PR #6 のレビュー S-3）', () => {
    const ss = stepsOf(e);
    const at = (re, what) => {
      const i = ss.findIndex((s) => re.test(s));
      assert.ok(i >= 0, `nightly.yml の e2e に ${what} がない`);
      return i;
    };
    const order = [
      at(/^ {8}run: npm ci$/m, 'npm ci'),
      at(/^ {8}run: npm run build:all$/m, 'build:all（e2e-full の prod-builds が本番 4 種を使う）'),
      at(/^ {8}run: npm run build:e2e$/m, 'build:e2e'),
      at(/^ {8}run: npx playwright install --with-deps chromium webkit firefox$/m, 'Playwright の 3 ブラウザの導入'),
    ];
    const nightlyRun = at(/^ {8}run: npm run test:e2e:nightly$/m, 'test:e2e:nightly');
    const fullRun = at(/^ {8}run: npm run test:e2e:full$/m, 'test:e2e:full');
    for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], `nightly.yml の e2e の step の順番が違う（${i} 番目）`);
    assert.ok(order.at(-1) < nightlyRun && order.at(-1) < fullRun, 'テストがビルドと Playwright の導入より前にある');
    assert.match(ss[nightlyRun], /^ {8}if: .*inputs\.mode != 'full'$/m);
    assert.match(ss[fullRun], /^ {8}if: .*inputs\.mode == 'full'$/m);
    const c = codeOf(e);
    assert.doesNotMatch(c, /^ {8}run: npm run test:e2e$/m, 'test:e2e（--project=chromium。PR ごとに流している）は毎晩に使わない');
    assert.doesNotMatch(c, /PW_DIST/, 'PW_DIST を渡さない（serve.mjs で mode の outDir より優先される）');
  });

  test('package.json の test:e2e:nightly は WebKit・Firefox を含み、PR ごとの chromium を重ねない', () => {
    const projects = [...pkg.scripts['test:e2e:nightly'].matchAll(/--project=([\w-]+)/g)].map((m) => m[1]);
    for (const p of ['webkit', 'firefox']) assert.ok(projects.includes(p), `test:e2e:nightly に ${p} がない`);
    assert.ok(!projects.includes('chromium'), 'test:e2e:nightly に chromium（PR ごとの test:e2e と同じ）がある');
  });

  test('失敗したときの記録: playwright-report/ だけを 3 日、HTML レポートができなかったときだけ test-results/（BL-099 と同じ方針）', () => {
    assertFailureReportPolicy(e, 'nightly.yml の e2e', ['npm run test:e2e:nightly', 'npm run test:e2e:full']);
  });

  test('schedule は週 2 回（月・木の 03:00 JST＝UTC の日・水 18:00。CEO 決定）。コメントのままでも値を固定する', () => {
    const crons = [...nightly.matchAll(/cron: '([^']+)'/g)].map((m) => m[1]);
    assert.ok(crons.length >= 1, 'cron の行がない');
    for (const c of crons) assert.equal(c, '0 18 * * 0,3');
  });
});

describe('失敗したときの E2E の記録（BL-099。決定 0006-4・QA 判定書 S1 §6-3。500MB の保存量の枠）', () => {
  const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8').replaceAll('\r\n', '\n');
  const pw = readFileSync(join(root, 'playwright.config.ts'), 'utf8');

  test('ci.yml の verify（E2E を含む。A1）: playwright-report/ だけを 3 日、HTML レポートができなかったときだけ test-results/。failure() はこの 2 つだけ', () => {
    assertFailureReportPolicy(jobOf(ci, 'verify'), 'ci.yml の verify', ['npm run test:e2e'], ['dist-web']);
  });

  test('ci.yml の成果物の名前: HTML レポートは e2e-report、test-results/ は e2e-test-results（手順書・実行記録の名前と合わせる）', () => {
    const ss = stepsOf(jobOf(ci, 'verify'));
    const nameOf = (path) => {
      const st = ss.find((s) => new RegExp(`^ {10}path: ${escRe(path)}$`, 'm').test(s));
      assert.ok(st, `${path} の upload がない`);
      return /^ {10}name: (\S+)$/m.exec(st)?.[1];
    };
    assert.equal(nameOf('playwright-report/'), 'e2e-report');
    assert.equal(nameOf('test-results/'), 'e2e-test-results');
    // ほかのジョブ・複数行の path で同じものを保存し直していない（コメント行は除く）
    const c = codeOf(ci);
    // path の値（1 行の `path: x` と、`path: |` の下の一覧の行）だけを数える
    assert.equal((c.match(/^\s+(?:path: )?playwright-report\/?$/gm) ?? []).length, 1, 'ci.yml で playwright-report/ を保存する場所が 1 つでない');
    assert.equal((c.match(/^\s+(?:path: )?test-results\/?$/gm) ?? []).length, 1, 'ci.yml で test-results/ を保存する場所が 1 つでない');
  });

  test('nightly.yml は書き込みの権限と secrets を持たない（ワークフロー直下の contents: read だけ。PR #9 のレビュー S-3）', () => {
    const nightly = readFileSync(join(root, '.github', 'workflows', 'nightly.yml'), 'utf8').replaceAll('\r\n', '\n');
    const c = codeOf(nightly);
    assert.match(c, /^permissions:\n {2}contents: read\n(?! )/m, 'ワークフロー直下の permissions が contents: read だけでない');
    assert.equal((c.match(/permissions:/g) ?? []).length, 1, 'ジョブ単位の permissions がある（ワークフロー直下の 1 つだけにする）');
    for (const [re, what] of [
      [/\bsecrets\b/, 'secrets（`secrets.X`・`secrets[\'X\']`・`toJSON(secrets)`。PR #19 のレビュー N-1）'],
      [/github\.token|GITHUB_TOKEN/, 'GitHub のトークン'],
      [/wrangler|CLOUDFLARE_/, 'Cloudflare（デプロイ）'],
      [/butler|BUTLER_/, 'itch.io（butler）'],
    ])
      assert.doesNotMatch(c, re, `nightly.yml に ${what} がある（schedule で main の上を人の目なしに動き、npm ci とテストのコードが動くジョブ）`);
  });

  test('playwright.config.ts: トレースは最初の実行の失敗だけ（retain-on-first-failure）、スクリーンショットは失敗したときだけ、動画なし（TS-073-02 を保ったまま小さく）', () => {
    const code = pw.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.match(code, /^\s+trace: 'retain-on-first-failure',$/m);
    assert.match(code, /^\s+screenshot: 'only-on-failure',$/m);
    assert.match(code, /^\s+video: 'off',$/m);
    assert.equal((code.match(/\btrace:/g) ?? []).length, 1, 'trace の設定が 2 か所以上ある（project ごとの上書きを含む）');
    assert.match(code, /\['html', \{ open: 'never', outputFolder: 'playwright-report' \}\]/, 'HTML レポートの出力先が playwright-report/ でない（ci.yml の hashFiles と合わない）');
    // playwright.config.ts の外から trace・レポートの出力先を変えない（PR #19 のレビュー N-3）
    for (const [name, s] of Object.entries(pkg.scripts).filter(([k]) => k.startsWith('test:e2e')))
      assert.doesNotMatch(s, /--trace\b|--reporter\b/, `package.json の ${name} が --trace・--reporter で設定を上書きしている`);
    for (const f of ['ci.yml', 'nightly.yml'])
      assert.doesNotMatch(codeOf(readFileSync(join(root, '.github', 'workflows', f), 'utf8')), /PLAYWRIGHT_HTML_|PLAYWRIGHT_JSON_|PW_TEST_HTML_REPORT/, `${f} が環境変数で HTML レポートの出力先を変えている（hashFiles と合わなくなる）`);
  });

  test('playwright.config.ts: maxFailures は CI で 10・手元で 0（上限なし）、PW_MAX_FAILURES で変えられる（実行・修復エンジニアの決定。CEO 承認。PR 1 回の全体の失敗の時間とレポートを抑える）', () => {
    const code = pw.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.match(code, /^\s+maxFailures: Number\(process\.env\.PW_MAX_FAILURES \?\? \(CI \? 10 : 0\)\),$/m);
    assert.equal((code.match(/\bmaxFailures:/g) ?? []).length, 1, 'maxFailures の設定が 2 か所以上ある');
    for (const f of ['ci.yml'])
      assert.doesNotMatch(codeOf(readFileSync(join(root, '.github', 'workflows', f), 'utf8')), /PW_MAX_FAILURES/, `${f} が PR の上限（10）を上書きしている`);
  });
});
