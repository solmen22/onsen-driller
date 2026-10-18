// ビルド検査そのもののテスト（BL-008。テスト設計者 BL-008_build-checks.md の TS-008-01〜25）
// 違反を 1 つだけ入れた小さな出力を一時ディレクトリに作り、check:size・check:assets・package・package:verify を
// 実際に子プロセスで起動して、終了コードと「どの規則のどのファイルか」のメッセージを確かめる（偽の緑を防ぐ）。
// 実行: npm run test:checks（node --test）。CI では test の後、build:all の前に実行する。
import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, test } from 'node:test';
import { promisify } from 'node:util';
import { BUDGET, E2E_JOB_TARGETS, EXTERNAL_URL_ALLOW, FAKE_AD, MB, PRODUCTION_TARGETS, SDK, TARGETS, transferSize } from './check-lib.mjs';
import * as gate from './nightly-gate.mjs';
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

  test('TS-008-09・TS-056-01 SDK 2 種・__game・_headers を 6 ターゲットに 1 つずつ入れる（許可 6 件は通り、18 件は失敗）', () => {
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

  // ---- 外部への送信と Service Worker（BL-096。コードレビュー PR #4 の M-1・N-10、TS-007-10） ----
  const SIX = ['web', 'crazygames', 'itch', 'poki', 'e2e-web', 'e2e-crazygames'];

  test('BL-096 sendBeacon・keepalive・preconnect・dns-prefetch は、6 ターゲットのどれの JS・HTML に 1 つあっても失敗する（24 件）', () => {
    const cases = [
      ['net.beacon', 'js', 'addEventListener("pagehide",()=>navigator.sendBeacon(u,d))'],
      ['net.keepalive', 'js', 'fetch(u,{method:"POST",body:d,keepalive:!0})'],
      ['net.preconnect', 'html', '<link rel="preconnect" href="./">'],
      ['net.preconnect', 'html', '<link rel="DNS-Prefetch" href="./">'],
    ];
    let n = 0;
    for (const t of SIX)
      for (const [rule, kind, snippet] of cases) {
        const d = newDist();
        const dir = makeTarget(d, t);
        if (kind === 'js') write(join(dir, 'assets', 'x-abcd1234.js'), snippet);
        else write(join(dir, 'index.html'), html(t, snippet));
        assertFail(size(d, t), new RegExp(`FAIL ${escRe(t)}: \\[${escRe(rule)}\\] (assets/x-abcd1234\\.js|index\\.html): `));
        n++;
      }
    assert.equal(n, 24);
  });

  test('BL-096 許可リストにない外部の絶対 URL（http・https・ws・wss）は失敗。似た名前・パス違いも失敗', () => {
    for (const url of [
      'https://www.google-analytics.com/g/collect',
      'http://example.com/pixel.gif',
      'wss://example.com/socket',
      'https://phaser.io.example.com/',
      'https://phaser.io/x',
      'http://www.w3.org/2000/svg2',
      'HTTPS://example.com/',
    ]) {
      const d = newDist();
      write(join(makeTarget(d, 'web'), 'assets', 'x-abcd1234.js'), `const u="${url}";`);
      assertFail(size(d, 'web'), new RegExp(`\\[net\\.url\\] assets/x-abcd1234\\.js: 許可リストにない外部の URL ${escRe(url)}`));
    }
    // HTML・CSS の中も見る
    const d = newDist();
    const dir = makeTarget(d, 'itch');
    write(join(dir, 'assets', 'index-abcd1234.css'), 'body{background:url("https://example.com/bg.png")}');
    assertFail(size(d, 'itch'), /\[net\.url\] assets\/index-abcd1234\.css: 許可リストにない外部の URL https:\/\/example\.com\/bg\.png/);
  });

  test('TS-056-01 BL-096 許可リストの URL はそのターゲットでだけ通る（XML 名前空間・Phaser の文字列は全部、SDK は SDK を持つターゲットだけ）', () => {
    const common = EXTERNAL_URL_ALLOW.filter((a) => a.targets === 'all').map((a) => a.url);
    for (const t of SIX) {
      const d = newDist();
      write(join(makeTarget(d, t), 'assets', 'x-abcd1234.js'), common.map((u) => `a("${u}");`).join(''));
      assertPass(size(d, t));
    }
    // SDK の URL を SDK のないターゲットに書くと、mix の検査に加えて net.url でも失敗する
    const d = newDist();
    write(join(makeTarget(d, 'itch'), 'assets', 'x-abcd1234.js'), `load("${CG}");load("${POKI}")`);
    const r = size(d, 'itch');
    assertFail(r, new RegExp(`\\[net\\.url\\] assets/x-abcd1234\\.js: 許可リストにない外部の URL ${escRe(CG)}・${escRe(POKI)}`));
  });

  test('BL-096 許可リストは各行に理由があり、SDK の URL は SDK を持つターゲット（check-lib の TARGETS）だけに許す', () => {
    for (const a of EXTERNAL_URL_ALLOW) {
      assert.match(a.url, /^(?:https?|wss?):\/\/[^\s"'`<>()\\,;{}[\]]+$/, `許可リストの URL の形: ${a.url}`);
      assert.ok(a.why && a.why.length >= 10, `理由がない: ${a.url}`);
      assert.ok(a.targets === 'all' || (Array.isArray(a.targets) && a.targets.length > 0), `targets: ${a.url}`);
      for (const [key, host] of [['cg', SDK.crazygames], ['poki', SDK.poki]])
        if (a.url.includes(host)) {
          assert.notEqual(a.targets, 'all', `${a.url} を全ターゲットに許している`);
          for (const t of a.targets) assert.ok(TARGETS[t]?.[key], `${a.url} を SDK のないターゲット ${t} に許している`);
        }
    }
  });

  test('TS-007-10 Service Worker: serviceWorker の API 名と、sw.js・service-worker.js・workbox の名前のファイルは失敗する', () => {
    for (const t of SIX) {
      const d = newDist();
      write(join(makeTarget(d, t), 'assets', 'x-abcd1234.js'), 'navigator.serviceWorker.register("./sw.js")');
      assertFail(size(d, t), /\[sw\] assets\/x-abcd1234\.js: serviceWorker/);
    }
    for (const name of ['sw.js', 'service-worker.js', 'serviceworker.js', 'workbox-abcd1234.js', 'assets/sw-abcd1234.js']) {
      const d = newDist();
      write(join(makeTarget(d, 'web'), name), 'console.log(1)');
      assertFail(size(d, 'web'), new RegExp(`\\[sw\\] Service Worker らしい名前のファイル: ${escRe(name)}`));
    }
    // 名前が似ているだけのものは通す
    const d = newDist();
    write(join(makeTarget(d, 'web'), 'assets', 'swing-abcd1234.js'), 'console.log(1)');
    assertPass(size(d, 'web'));
  });

  test('BL-096 ソースマップ（.map。e2e 系だけにありうる）の中の語・URL は見ない。画像などのバイナリも見ない', () => {
    const d = newDist();
    const dir = makeTarget(d, 'e2e-web');
    write(join(dir, 'assets', 'index-abcd1234.js.map'), JSON.stringify({ sourcesContent: ['// https://github.com/x/y sendBeacon keepalive preconnect serviceWorker'] }));
    write(join(dir, 'assets', 'atlas-abcd1234.png'), Buffer.from('\x89PNG https://example.com/ sendBeacon', 'latin1'));
    assertPass(size(d, 'e2e-web'));
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

  // BL-137（PR #58 のレビューの範囲外の気づき 1）: verify の検査の step（TS-008-23 の順番）に step の if: を足すと、PR・push のどちらかで
  // 検査が黙って外れる。if: を持ってよいのは、失敗したときの記録の 2 つ（中身は assertFailureReportPolicy が検査する）だけ
  test('BL-137: verify の step に if: があるのは、失敗したときの記録の 2 つだけ（検査の step が黙って外れない）', () => {
    const named = (s) => /^ {6}- name: (.*)$/m.exec(s)?.[1] ?? s.trim().split('\n')[0];
    const withIf = steps(job('verify'))
      .filter((s) => /^ {6}(?:- | {2})if:/m.test(s))
      .map(named);
    assert.deepEqual(
      withIf,
      ['失敗したときの記録を残す（HTML レポート）', '失敗したときの記録を残す（HTML レポートができなかったときだけ test-results/）'],
      `verify で if: を持つ step: ${withIf.join(' / ')}`,
    );
  });

  // verify は E2E まで 1 つのジョブ（Actions の分数の削減 A1。org/10_development/devops/2026-09-29_actions-minutes.md）
  test('TS-008-23 verify の順番: gitleaks → lint → typecheck → test → test:checks → build:all → build:e2e → check:size → check:assets → check:text（BL-077） → check-e2e-dist → Playwright → test:e2e', () => {
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
      /run: npm run check:text$/m,
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
    // verify にはジョブの if: を置かない（どのきっかけでも必ず動く。BL-098・PR #28 のレビュー S-1 (b)。ラベルの run は preview.yml）
    assert.doesNotMatch(v, /^ {4}if:/m, 'verify にジョブの if: がある（push や特定のきっかけで E2E を含む verify が skip になりうる）');
    assert.match(ci, /^on:\n(?: {2}.*\n| {4}.*\n)*? {2}push:\n {4}branches: \[main\]\n/m, 'main への push で ci.yml が動かない');
    // パスの絞り込みを置かない（リポジトリの公開〔2026-10-18〕の後、main のルールセットで verify を必須のチェックにする前提。
    // 絞り込みがあると run の出ない PR は verify が「待機中」のまま残り、マージできない）
    assert.doesNotMatch(code(ci), /^ {4}paths(?:-ignore)?:/m, 'ci.yml の on: に paths・paths-ignore がある（verify が必須のチェックのとき、run の出ない PR がマージできない）');
    // test:e2e の step 自体に if: がない（push で飛ばされない）
    const st = steps(v).find((s) => /^ +run: npm run test:e2e$/m.test(s));
    assert.ok(st, 'verify に npm run test:e2e の step がない');
    assert.doesNotMatch(st, /^ {6}(?:- | {2})if:/m, 'test:e2e の step に if: がある（main の push で飛ばしうる）');
    const staging = job('deploy-staging');
    assert.match(staging, /^ {4}needs: verify(?:\s+#.*)?$/m, 'deploy-staging が E2E を含む verify を待たない');
    assert.doesNotMatch(staging, /^ {4}if: .*(always|failure|cancelled)\(\)/m, 'deploy-staging が E2E の失敗でも動く');
  });

  test('A2・BL-098（PR #28 のレビュー S-1 (b)）: ci.yml はラベルでは動かない（verify が skip のチェックで前の赤を隠さない）。deploy-preview は preview のラベルの付いた PR の push だけ', () => {
    // labeled・unlabeled・edited などを足すと、コードの変わらない run ができ、verify が skip のチェックとして同じ head に並びうる
    assert.match(ci, /^ {2}pull_request:\n {4}branches: \[main\]\n(?: {4}#.*\n)* {4}types: \[opened, synchronize, reopened\]\n/m, 'pull_request の types は既定の 3 つだけ（labeled を置かない。ラベルのプレビューは preview.yml）');
    assert.equal((code(ci).match(/^ {4}types:/gm) ?? []).length, 1, 'types: が 2 か所以上ある');
    assert.match(ci, /^concurrency:\n {2}group: ci-\$\{\{ github\.ref \}\}\n/m, 'concurrency のグループは ref ごと（ラベルの run の特別扱いは要らない）');
    const ifs = /^ {4}if: (.*)$/m.exec(job('deploy-preview'))?.[1] ?? '';
    assert.match(ifs, /&& contains\(github\.event\.pull_request\.labels\.\*\.name, 'preview'\)$/, 'deploy-preview が preview のラベルを条件にしない');
    assert.match(ifs, /github\.event\.pull_request\.user\.login != 'dependabot\[bot\]'/, 'deploy-preview が Dependabot の PR を除かない（PR #28 のレビュー N-2）');
  });

  test('BL-098（PR #28 のレビュー N-4）キャッシュの守り: restore-keys なし・path と key だけ。dist-web の保存はキャッシュの step より前', () => {
    const ss = steps(job('verify'));
    const cache = ss.findIndex((s) => /uses: actions\/cache@\S+/.test(s));
    const upload = ss.findIndex((s) => /^ {10}name: dist-web$/m.test(s));
    assert.ok(cache >= 0 && upload >= 0, 'キャッシュか dist-web の保存の step がない');
    assert.ok(upload < cache, 'dist-web の保存がキャッシュの step より後（キャッシュから戻したブラウザが動いた後にデプロイするものを保存しうる）');
    const keys = [...ss[cache].matchAll(/^ {10}([\w-]+):/gm)].map((m) => m[1]);
    assert.deepEqual(keys, ['path', 'key'], `キャッシュの with: は path と key だけ（restore-keys・lookup-only などを足さない）: ${keys.join(', ')}`);
    assert.doesNotMatch(code(ci), /restore-keys/, 'restore-keys がある（package-lock.json を戻したときに古い〔汚れうる〕キャッシュに戻る）');
  });

  test('BL-098 gitleaks は -v で検出の場所（File・Line・Commit・RuleID・Fingerprint）をログに出し、--redact（100%）を必ず付ける', () => {
    const line = code(job('verify')).split('\n').find((l) => l.includes('"$RUNNER_TEMP/gitleaks" git '));
    assert.ok(line, 'verify に gitleaks の走査の行がない');
    const args = line.trim().split(/\s+/);
    assert.ok(args.includes('-v') || args.includes('--verbose'), `gitleaks に -v がない: ${line.trim()}`);
    assert.ok(args.includes('--redact') || args.includes('--redact=100'), `gitleaks に --redact（100%）がない（値をログに出さない）: ${line.trim()}`);
    assert.ok(!args.some((a) => /^--redact=(?!100$)/.test(a)), `--redact の割合を下げている（値の一部がログに出る）: ${line.trim()}`);
    for (const a of ['--no-banner', '--exit-code']) assert.ok(args.includes(a), `gitleaks に ${a} がない`);
    assert.equal(args[args.indexOf('--exit-code') + 1], '1', '--exit-code 1 でない（検出しても緑になる）');
  });

  test('BL-098（PR #5 のレビュー N-1 の M4）PW_DIST は ci.yml のどこにも書かない（ワークフロー直下の env: を含む。コメント行は除く）', () => {
    assert.doesNotMatch(code(ci), /PW_DIST/);
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
  /** .github/workflows/ のすべてのワークフロー（[名前, 本文]）。増えたら下の一覧と検査を明示的に直す（BL-098） */
  const wfDir = join(root, '.github', 'workflows');
  const workflows = readdirSync(wfDir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f) => [f, readFileSync(join(wfDir, f), 'utf8').replaceAll('\r\n', '\n')]);
  /** デプロイしてよいジョブ（ワークフロー/ジョブ）。secrets を参照してよいのもここだけ */
  const DEPLOY_JOBS = ['ci.yml/deploy-preview', 'ci.yml/deploy-staging', 'preview.yml/preview-label'];

  test('BL-098: ワークフローは ci.yml・nightly.yml・preview.yml の 3 つだけ（足すときはこの一覧と、本番に出さない・secrets の検査を一緒に直す）', () => {
    assert.deepEqual(
      workflows.map(([f]) => f),
      ['ci.yml', 'nightly.yml', 'preview.yml'],
    );
  });

  test('BL-098（PR #28 のレビュー N-2）: どのワークフローも pull_request_target・workflow_run で動かない（PR のコードを secrets・書き込みの権限つきで動かす形になりうる）', () => {
    for (const [name, text] of workflows) assert.doesNotMatch(code(text), /\bpull_request_target\b|\bworkflow_run\b/, `${name} に pull_request_target か workflow_run がある`);
  });

  test('BL-098（PR #28 のレビュー N-1）: secrets を参照するのはデプロイのジョブの wrangler pages deploy の step 1 つだけ。その step に別の送信・publish はない', () => {
    for (const [file, text] of workflows) {
      assert.doesNotMatch(code(text.slice(0, text.indexOf('\njobs:'))), /\bsecrets\b/, `${file}: ワークフロー直下（env: など）で secrets を参照している`);
      assert.doesNotMatch(code(text), /pages publish|wrangler (?:deploy|publish)\b|wrangler versions/, `${file}: pages deploy 以外の wrangler の出し方がある（--branch の検査をすり抜けうる）`);
      for (const name of names(text)) {
        const body = jobOf(text, name);
        const ss = steps(body);
        const head = ss[0].split(/\n {4}steps:\n/)[0];
        assert.doesNotMatch(code(head), /\bsecrets\b/, `${file}/${name}: ジョブの env: など step の外で secrets を参照している`);
        const withSecrets = ss.filter((s) => /\bsecrets\b/.test(code(s)));
        if (!DEPLOY_JOBS.includes(`${file}/${name}`)) {
          assert.equal(withSecrets.length, 0, `${file}/${name}: secrets を参照している（secrets はデプロイのジョブだけ）`);
          continue;
        }
        assert.equal(withSecrets.length, 1, `${file}/${name}: secrets を参照する step が 1 つでない（${withSecrets.length}）`);
        const st = code(withSecrets[0]);
        assert.equal((st.match(/wrangler pages deploy /g) ?? []).length, 1, `${file}/${name}: secrets の step に wrangler pages deploy が 1 つでない`);
        assert.doesNotMatch(st, /\bcurl\b|\bwget\b|cloudflare\.com|\bnpx\b|\bnpm\b|\bnode\b|\bgh\b/, `${file}/${name}: secrets の step で wrangler pages deploy 以外の送信・実行をしている`);
      }
    }
  });

  test('本番に出さない: どのワークフローにも本番ブランチ（main・production）へのデプロイがない。ステージングは staging に固定', () => {
    for (const [name, text] of workflows)
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
    for (const [name, text] of workflows)
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
    for (const [name, text] of workflows) {
      const n = (text.match(/uses: actions\/checkout@/g) ?? []).length;
      const p = (text.match(/persist-credentials: false/g) ?? []).length;
      assert.equal(p, n, `${name}: checkout ${n} 件のうち persist-credentials: false は ${p} 件`);
    }
  });
});

// ---- PR に preview のラベルを付けたときのプレビュー（BL-098。PR #28 のレビュー S-1 (b)） ----
describe('preview.yml（ラベルのプレビュー。verify という名前のチェックを作らず、同じ head の ci.yml の verify が success の run の dist-web を出す）', () => {
  const pv = readFileSync(join(root, '.github', 'workflows', 'preview.yml'), 'utf8').replaceAll('\r\n', '\n');
  const nightly = readFileSync(join(root, '.github', 'workflows', 'nightly.yml'), 'utf8').replaceAll('\r\n', '\n');
  const names = (text) => [...(/^jobs:\n([\s\S]*)$/m.exec(text)?.[1] ?? '').matchAll(/^ {2}([a-z][\w-]*):\n/gm)].map((m) => m[1]);
  // stepsOf・codeOf はこの describe より後で定義されるので、テストの中で使う（describe の本文では呼ばない）
  let job = '';
  let ss = [];
  test('preview-label のジョブがある', () => {
    job = jobOf(pv, 'preview-label');
    ss = stepsOf(job);
    assert.ok(ss.length > 1);
  });
  const at = (re, what) => {
    const i = ss.findIndex((s) => re.test(s));
    assert.ok(i >= 0, `preview-label に ${what} がない`);
    return i;
  };

  test('きっかけは main への PR の labeled だけ。ジョブは preview-label の 1 つで、verify という名前のジョブはほかのワークフローにない', () => {
    assert.match(pv, /^on:\n {2}pull_request:\n {4}branches: \[main\]\n {4}types: \[labeled\]\n\n?concurrency:/m, 'on: は pull_request（branches: [main]・types: [labeled]）だけ');
    assert.deepEqual(names(pv), ['preview-label']);
    assert.ok(!names(nightly).includes('verify'), 'nightly.yml に verify という名前のジョブがある（ci.yml の verify と同じ名前のチェックになる）');
    assert.match(pv, /^concurrency:\n {2}group: preview-\$\{\{ github\.ref \}\}\n {2}cancel-in-progress: false\n/m);
  });

  test('preview のラベル・同じリポジトリ・Dependabot 以外の PR だけ。権限は contents: read と actions: read（読むだけ）', () => {
    const ifs = /^ {4}if: (.*)$/m.exec(job)?.[1] ?? '';
    for (const c of [
      "github.event.label.name == 'preview'",
      'github.event.pull_request.head.repo.full_name == github.repository',
      "github.event.pull_request.user.login != 'dependabot[bot]'",
      "vars.CF_PAGES_PROJECT != ''",
    ])
      assert.ok(ifs.split(' && ').includes(c), `preview-label の if: に「${c}」がない: ${ifs}`);
    assert.doesNotMatch(ifs, /\|\||always\(\)/, 'preview-label の if: に || や always() がある');
    assert.match(pv, /^permissions:\n {2}contents: read\n(?! )/m, 'ワークフロー直下の permissions が contents: read だけでない');
    const perms = /^ {4}permissions:\n((?: {6}.*\n)+)/m.exec(job)?.[1] ?? '';
    const p = [...perms.matchAll(/^ {6}([\w-]+): (\w+)/gm)].map((m) => `${m[1]}: ${m[2]}`);
    assert.deepEqual(p, ['contents: read', 'actions: read'], `preview-label の permissions: ${p.join(', ')}`);
    assert.doesNotMatch(codeOf(pv), /:\s*write\b|write-all/, '書き込みの権限がある');
  });

  test('同じ head の ci.yml の run の verify（skip でない最新）が success のときだけ、その run の dist-web を受け取る（verify を回し直さない）', () => {
    const find = at(/^ {8}id: ci$/m, 'run を探す step（id: ci）');
    const s = codeOf(ss[find]);
    assert.doesNotMatch(s, /\bsecrets\b/, 'run を探す step が secrets を参照している');
    assert.match(s, /^ {10}GH_TOKEN: \$\{\{ github\.token \}\}$/m);
    assert.match(s, /^ {10}SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}$/m, 'PR の head の SHA で探さない');
    assert.match(s, /repos\/\$REPO\/actions\/workflows\/ci\.yml\/runs\?event=pull_request&head_sha=\$SHA/, 'ci.yml の pull_request の run を head の SHA で探さない');
    assert.match(s, /sort_by\(\.created_at\) \| reverse/, '新しい順に見ない');
    assert.match(s, /select\(\.head_repository\.full_name == "'"\$REPO"'"\)/, '同じリポジトリの run に限らない');
    assert.match(s, /select\(\.name == "verify"\)/, 'verify のジョブの結論を見ない');
    // skip は飛ばし、success なら採る、それ以外（動いている・赤・取り消し）は失敗させる
    assert.match(s, /'completed skipped'\|''\|'null null'\) continue ;;/);
    assert.match(s, /'completed success'\) found="\$id"; break ;;/);
    assert.match(s, /\*\) echo "::error::[^\n]*"; exit 1 ;;/, 'success でも skip でもない verify で失敗させない');
    assert.match(s, /if \[ -z "\$found" \]; then\n[^\n]*exit 1/, 'run がないときに失敗させない');
    assert.match(s, /select\(\.name == "dist-web" and \(\.expired \| not\)\)/, 'dist-web が期限切れでないか見ない');
    assert.match(s, /echo "run_id=\$found" >> "\$GITHUB_OUTPUT"/);
    const dl = at(/uses: actions\/download-artifact@/, 'download-artifact');
    assert.match(ss[dl], /^ {10}name: dist-web\n {10}path: dist\/web\/\n {10}run-id: \$\{\{ steps\.ci\.outputs\.run_id \}\}\n {10}github-token: \$\{\{ github\.token \}\}$/m, 'dist-web を探した run から受け取らない');
    assert.equal((codeOf(pv).match(/download-artifact@/g) ?? []).length, 1);
    const deploy = at(/wrangler pages deploy/, 'wrangler pages deploy');
    assert.ok(find < dl && dl < deploy, '順番が「run を探す → dist-web を受け取る → デプロイ」でない');
    assert.doesNotMatch(codeOf(pv), /upload-artifact|npm run |npx playwright/, 'preview.yml でビルド・テスト・保存をしている（verify の結果をそのまま使う）');
  });

  test('本番に出さない: --branch="$BRANCH"（PR の head_ref）で dist/web だけを出し、空・main・staging・production の名前を同じ step で deploy の前に拒否する', () => {
    const st = ss[at(/wrangler pages deploy/, 'wrangler pages deploy')];
    assert.match(st, /deploy\/node_modules\/\.bin\/wrangler pages deploy dist\/web --project-name="\$PROJECT" --branch="\$BRANCH" /);
    assert.match(st, /^ {10}BRANCH: \$\{\{ github\.head_ref \}\}$/m);
    const guard = st.search(/''\|main\|staging\|production\)/);
    assert.ok(guard >= 0, 'ブランチ名の拒否がない');
    const exit = st.indexOf('exit 1', guard);
    assert.ok(exit > guard && exit < st.search(/wrangler pages deploy/), '拒否（exit 1）が deploy より前にない');
    assert.match(st, /tr '\[:upper:\]' '\[:lower:\]'/);
    assert.match(st, /sed -E 's\/\[\^a-z0-9\]\+\/-\/g/);
  });

  test('サプライチェーン: wrangler は deploy/package-lock.json から --ignore-scripts で、トークンのない step で入れる。checkout は deploy/ だけ', () => {
    const install = ss.find((s) => s.includes('npm ci --prefix deploy'));
    assert.ok(install, 'npm ci --prefix deploy がない');
    assert.match(install, /--ignore-scripts/);
    assert.doesNotMatch(install, /CLOUDFLARE_API_TOKEN|secrets/);
    assert.match(ss[at(/uses: actions\/checkout@/, 'checkout')], /^ {10}sparse-checkout: deploy$/m);
  });
});

// ---- PR ごとの E2E の中身（BL-098。PR #28 のレビュー N-3） ----
describe('package.json の test:e2e（テストを 1 件も流さずに緑にならない）', () => {
  test('test:e2e は playwright test --project=chromium --project=prod-builds（変えるときはこの検査も明示的に直す）', () => {
    assert.equal(pkg.scripts['test:e2e'], 'playwright test --project=chromium --project=prod-builds');
  });

  test('E2E のスクリプト（test:e2e・test:e2e:nightly・test:e2e:full）に、流さずに終える・一部だけ流すオプションがない', () => {
    for (const [name, s] of Object.entries(pkg.scripts).filter(([k]) => /^test:e2e(?::nightly|:full)?$/.test(k)))
      assert.doesNotMatch(s, /--list\b|--pass-with-no-tests\b|--grep\b|-g\s|--grep-invert\b|--only-changed\b|--last-failed\b|--shard\b|--max-failures\b|-x\b/, `package.json の ${name} に流す範囲を変えるオプション: ${s}`);
    for (const k of ['pretest:e2e', 'posttest:e2e']) assert.ok(!(k in pkg.scripts), `package.json に ${k} がある（npm が test:e2e の前後に自動で動かす）`);
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
 * 失敗したときの記録の方針: playwright-report/ だけを days 日（ci.yml は 3 日、nightly.yml は 7 日。BL-128）。test-results/ は
 * HTML レポートができなかったとき（index.html がないとき）だけ。failure()・always() を使うのはこの 2 つの step だけ。
 * 成功した回に残すのは notes に名前を書いたもの（nightly.yml の playwright-report/results.json だけ。BL-128）だけ。
 * テストの step には、ジョブより短い timeout-minutes（ジョブのタイムアウトで止まると failure() の step も動かず、何も残らない）
 */
function assertFailureReportPolicy(body, label, testRuns, { allowUploads = [], days = 3, notes = null } = {}) {
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
  // 緑の回の注記の記録（BL-128）: results.json だけ・failure()／always() なし（緑の回だけ。赤の回は HTML レポートの中にある）・days 日・
  // 見つからなければ失敗（reporter の設定が変わって注記が黙って残らなくなるのを防ぐ）
  const noteSteps = notes ? ss.filter((s) => /uses: actions\/upload-artifact@/.test(s) && artifactOf(s) === notes) : [];
  assert.equal(noteSteps.length, notes ? 1 : 0, `${label}: 注記の記録（${notes}）の step が 1 つでない（${noteSteps.length}）`);
  for (const s of noteSteps) {
    assert.match(s, /^ {10}path: playwright-report\/results\.json$/m, `${label}: ${notes} は playwright-report/results.json だけ（トレース・スクリーンショットを毎回残さない）`);
    assert.doesNotMatch(ifOf(s), /(?:always|failure|cancelled)\(\)/, `${label}: ${notes} に failure()・always() がある（赤の回は HTML レポートに results.json が入る）`);
    assert.match(s, new RegExp(`^ {10}retention-days: ${days}$`, 'm'), `${label}: ${notes} の保存は ${days} 日（BL-128）`);
    assert.match(s, /^ {10}if-no-files-found: error$/m, `${label}: ${notes} が見つからないときに失敗しない`);
  }
  const uploads = ss.filter((s) => /uses: actions\/upload-artifact@/.test(s) && !others.includes(s) && !noteSteps.includes(s));
  // このジョブの保存は記録の 2 つだけ（3 つ目を足すなら、この検査を明示的に変える。S-2 (2)）
  assert.equal(uploads.length, 2, `${label}: upload-artifact の step が 2 つでない（${uploads.length}）。失敗したときの記録の 2 つ以外に保存を足していないか`);
  const report = uploads.filter((s) => /^ {10}path: playwright-report\/$/m.test(s));
  const results = uploads.filter((s) => /^ {10}path: test-results\/$/m.test(s));
  assert.equal(report.length, 1, `${label}: playwright-report/ を保存する step が 1 つでない（${report.length}）`);
  assert.equal(results.length, 1, `${label}: test-results/ を保存する step が 1 つでない（${results.length}）`);
  assert.equal(ifOf(report[0]), `failure() && ${HTML_REPORT} != ''`, `${label}: HTML レポートは失敗したときで index.html があるときだけ`);
  assert.equal(ifOf(results[0]), `failure() && ${HTML_REPORT} == ''`, `${label}: test-results/ は HTML レポートができなかったときだけ`);
  for (const s of [report[0], results[0]]) {
    assert.match(s, new RegExp(`^ {10}retention-days: ${days}$`, 'm'), `${label}: 失敗したときの記録の保存は ${days} 日（500MB の枠。BL-099・BL-128）`);
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
  const lastRecord = Math.min(ss.indexOf(report[0]), ss.indexOf(results[0]), ...noteSteps.map((s) => ss.indexOf(s)));
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
  const e = jobOf(nightly, 'e2e-nightly');

  test('TS-084-01 E2E のジョブは balance・property を呼ばず、gate のほかのジョブを待たない（BL-090 がそろう前から動く）。gate の run が true のときだけ動く（決定 0010 の 12）', () => {
    const c = codeOf(e);
    assert.doesNotMatch(c, /test:balance|test:property/);
    assert.deepEqual([...c.matchAll(/^ {4}needs: (.*)$/gm)].map((m) => m[1]), ['gate'], 'e2e-nightly の needs が gate だけでない');
    assert.deepEqual([...c.matchAll(/^ {4}if: (.*)$/gm)].map((m) => m[1]), ["needs.gate.outputs.run == 'true'"], 'e2e-nightly の if: が gate の run だけでない');
    // 前の「4 日間の変更」の見方を戻さない（step の if: で飛ばすとジョブが success になり、gate が「前回の成功」と取り違える）
    assert.doesNotMatch(c, /steps\.changed|--since=|fetch-depth/, 'e2e-nightly に前の「前回から変更があるか」の step が残っている');
    // 「前回の成功」は E2E の step の成功で数える（nightly-gate.mjs の E2E_STEP_RE）。テストの step の名前がそれに合うこと
    const tests = stepsOf(e).filter((s) => /^ {8}run: npm run test:e2e:(?:nightly|full)$/m.test(s));
    assert.equal(tests.length, 2, 'test:e2e:nightly・test:e2e:full の step が 2 つでない');
    for (const s of tests) assert.match(/^ {6}- name: (.*)$/m.exec(s)?.[1] ?? '', gate.E2E_STEP_RE, `E2E の step の名前が gate の E2E_STEP_RE に合わない:\n${s}`);
    assert.equal(stepsOf(e).filter((s) => gate.E2E_STEP_RE.test(/^ {6}- name: (.*)$/m.exec(s)?.[1] ?? '')).length, 2, 'E2E_STEP_RE に合う step がテストの 2 つ以外にもある');
  });

  test('TS-084-01 npm ci → build:all → build:e2e → Playwright（chromium・webkit・firefox）→ mode ごとに test:e2e:nightly／test:e2e:full（PR #6 のレビュー S-3）', () => {
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

  // BL-137 と同じ考え（PR #58 のレビューの Nit 1 は、前の steps.changed の if: がなくなって解消）: e2e-nightly で step の if: を持つのは、
  // mode で分ける 2 つのテストの step と、失敗したときの記録の 2 つだけ（緑の回の注記の保存・ビルド・導入は条件なしで動く）
  test('BL-137: e2e-nightly で if: を持つ step は、mode の 2 つのテストと失敗したときの記録の 2 つだけ', () => {
    const withIf = stepsOf(e)
      .filter((s) => /^ {6}(?:- | {2})if:/m.test(s))
      .map((s) => /^ {6}- name: (.*)$/m.exec(s)?.[1] ?? s.trim().split('\n')[0]);
    assert.deepEqual(
      withIf,
      [
        'E2E（webkit・firefox・mobile-safari・mobile-chrome）',
        'e2e-full（chromium-full・毎晩の 4 つ・prod-builds）',
        '失敗したときの記録を残す（HTML レポート）',
        '失敗したときの記録を残す（HTML レポートができなかったときだけ test-results/）',
      ],
      `e2e-nightly で if: を持つ step: ${withIf.join(' / ')}`,
    );
  });

  test('TS-084-06 package.json の test:e2e:nightly は WebKit・Firefox・モバイル 2 種で、PR ごとの chromium・prod-builds を重ねず、失敗の件数に上限がある（PR #9 のレビュー S-1・N-6）', () => {
    const script = pkg.scripts['test:e2e:nightly'];
    const projects = [...script.matchAll(/--project=([\w-]+)/g)].map((m) => m[1]);
    for (const p of ['webkit', 'firefox', 'mobile-safari', 'mobile-chrome']) assert.ok(projects.includes(p), `test:e2e:nightly に ${p} がない`);
    for (const p of ['chromium', 'prod-builds'])
      assert.ok(!projects.includes(p), `test:e2e:nightly に ${p}（PR ごとの test:e2e で流しているもの）がある`);
    // 上限は playwright.config.ts の maxFailures（PW_MAX_FAILURES）で決める。スクリプトの引数では上書きしない
    assert.doesNotMatch(script, /--max-failures/, 'test:e2e:nightly の --max-failures（上限は nightly.yml の PW_MAX_FAILURES で決める）');
  });

  test('毎晩の E2E は PW_MAX_FAILURES=25 で失敗の件数に上限がある（全体が落ちたときのレポートと分数を抑える。PR #9 のレビュー S-1。実行・修復エンジニアの決定）', () => {
    const env = /^ {4}env:\n((?: {6}.*\n)+)/m.exec(e)?.[1] ?? '';
    const m = /^ {6}PW_MAX_FAILURES: (\d+)(?:\s+#.*)?$/m.exec(env);
    assert.ok(m, 'nightly.yml の e2e-nightly ジョブの env に PW_MAX_FAILURES がない（全体が落ちるとレポートが 0.1〜0.4GB になりうる。infra §4-3）');
    assert.equal(Number(m[1]), 25, `PW_MAX_FAILURES=${m[1]}（実行・修復エンジニアの決定は 25）`);
    assert.equal((codeOf(nightly).match(/PW_MAX_FAILURES/g) ?? []).length, 1, 'PW_MAX_FAILURES を 2 か所以上で決めている');
  });

  // 週 2 回（月・木）の schedule に 3 日の保存は合わず、次の回の前に消えていた（BL-128。QA の S2 判定書 §2-2 の 5）
  test('TS-084-02 失敗したときの記録: playwright-report/ だけを 7 日、HTML レポートができなかったときだけ test-results/。緑の回も results.json だけを 7 日（BL-099・BL-128）', () => {
    assertFailureReportPolicy(e, 'nightly.yml の e2e-nightly', ['npm run test:e2e:nightly', 'npm run test:e2e:full'], {
      days: 7,
      notes: 'nightly-e2e-results-json',
    });
  });

  // 公開中は毎日・非公開の間は月・木（決定 0010 の 12。QA 2026-10-18 §2-1 の条件 1・3）。毎日の cron 1 本（'17 18 * * *'）にすると、
  // gate が「月・木の回」を見分けられず、非公開の間も毎日流れるので赤にする
  test('TS-084-05 schedule は 03:17 JST の 2 本（月・木／それ以外の 5 日）で、合わせて毎日・重ならない。文字列は nightly-gate.mjs の定数と同じ（PR #9 のレビュー N-3）', () => {
    const crons = [...codeOf(nightly).matchAll(/cron: '([^']+)'/g)].map((m) => m[1]);
    assert.deepEqual(crons, [gate.CRON_TWICE_WEEKLY, gate.CRON_OTHER_DAYS], `cron が月・木とそれ以外の 5 日の 2 本でない: ${crons.join(' / ')}`);
    assert.equal(gate.CRON_TWICE_WEEKLY, '17 18 * * 0,3', '月・木の 03:17 JST（UTC の日・水 18:17）でない');
    const days = (c) => {
      const f = c.split(' ');
      assert.equal(f.length, 5, `cron の欄が 5 つでない: ${c}`);
      assert.deepEqual(f.slice(0, 4), ['17', '18', '*', '*'], `03:17 JST（UTC 18:17）・毎月毎日でない: ${c}`);
      assert.match(f[4], /^[0-6](?:,[0-6])*$/, `曜日は 0〜6 の列挙で書く（* や範囲にしない）: ${c}`);
      return f[4].split(',').map(Number);
    };
    const all = [...days(gate.CRON_TWICE_WEEKLY), ...days(gate.CRON_OTHER_DAYS)].sort();
    assert.deepEqual(all, [0, 1, 2, 3, 4, 5, 6], '2 本で毎日にならないか、重なっている（同じ日に 2 回動く）');
  });

  test('TS-084-05 schedule は on: の下にあり、workflow_dispatch と並ぶ（字下げを誤るとワークフロー全体が無効になる。PR #9 のレビュー N-4）', () => {
    const on = /^on:\n((?: {2}.*\n|\s*\n)+)/m.exec(codeOf(nightly))?.[1] ?? '';
    assert.match(on, /^ {2}schedule:\n {4}- cron: '17 18 \* \* 0,3'.*\n {4}- cron: '17 18 \* \* 1,2,4,5,6'/m, 'on: の直下に schedule: と 2 本の - cron: がない');
    assert.match(on, /^ {2}workflow_dispatch:$/m, 'on: の直下に workflow_dispatch: がない（手動実行ができなくなる）');
    assert.equal((codeOf(nightly).match(/^\s*schedule:/gm) ?? []).length, 1, 'schedule: が on: の外にもある');
  });
});

describe('失敗したときの E2E の記録（BL-099。決定 0006-4・QA 判定書 S1 §6-3。500MB の保存量の枠）', () => {
  const ci = readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8').replaceAll('\r\n', '\n');
  const pw = readFileSync(join(root, 'playwright.config.ts'), 'utf8');

  test('ci.yml の verify（E2E を含む。A1）: playwright-report/ だけを 3 日、HTML レポートができなかったときだけ test-results/。failure() はこの 2 つだけ', () => {
    assertFailureReportPolicy(jobOf(ci, 'verify'), 'ci.yml の verify', ['npm run test:e2e'], { allowUploads: ['dist-web'] });
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

  test('TS-084-03 nightly.yml は書き込みの権限と secrets を持たない（ワークフロー直下の contents: read だけ。トークンは gate だけ。PR #9 のレビュー S-3・決定 0010 の 12）', () => {
    const nightly = readFileSync(join(root, '.github', 'workflows', 'nightly.yml'), 'utf8').replaceAll('\r\n', '\n');
    assert.match(codeOf(nightly), /^permissions:\n {2}contents: read\n(?! )/m, 'ワークフロー直下の permissions が contents: read だけでない');
    assert.doesNotMatch(codeOf(nightly), /:\s*write\b|write-all/, '書き込みの権限がある');
    // gate（npm ci もテストのコードも動かさないジョブ）だけが actions: read とトークンを持つ。gate の中身は nightly-gate の describe で検査する
    const c = codeOf(nightly.replace(jobOf(nightly, 'gate'), ''));
    assert.equal((c.match(/permissions:/g) ?? []).length, 1, 'gate のほかにジョブ単位の permissions がある（ワークフロー直下の 1 つだけにする）');
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

  test('TS-084-06 playwright.config.ts: maxFailures は CI で 10・手元で 0（上限なし）、PW_MAX_FAILURES で変えられる（実行・修復エンジニアの決定。CEO 承認。PR 1 回の全体の失敗の時間とレポートを抑える）', () => {
    const code = pw.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    assert.match(code, /^\s+maxFailures: Number\(process\.env\.PW_MAX_FAILURES \?\? \(CI \? 10 : 0\)\),$/m);
    assert.equal((code.match(/\bmaxFailures:/g) ?? []).length, 1, 'maxFailures の設定が 2 か所以上ある');
    for (const f of ['ci.yml'])
      assert.doesNotMatch(codeOf(readFileSync(join(root, '.github', 'workflows', f), 'utf8')), /PW_MAX_FAILURES/, `${f} が PR の上限（10）を上書きしている`);
  });
});

// ---- nightly の gate（決定 0010 の 12。QA 2026-10-18 §2-1 の条件 1〜3）: 公開中は毎日・非公開の間は月・木。前回の成功から変わったときだけ ----
describe('nightly-gate.mjs（公開中は毎日・非公開の間は月・木。前回に成功した nightly の SHA と main を比べる）', () => {
  const nightly = readFileSync(join(root, '.github', 'workflows', 'nightly.yml'), 'utf8').replaceAll('\r\n', '\n');
  const H = 'a'.repeat(40);
  const OLD = 'b'.repeat(40);
  const TW = gate.CRON_TWICE_WEEKLY;
  const OD = gate.CRON_OTHER_DAYS;
  const E2E = { name: 'E2E（webkit・firefox・mobile-safari・mobile-chrome）', conclusion: 'success' };
  const FULL = { name: 'e2e-full（chromium-full・毎晩の 4 つ・prod-builds）', conclusion: 'success' };
  const skippedStep = (s) => ({ ...s, conclusion: 'skipped' });
  /** jobs の形: E2E まで成功／gate だけ（e2e-nightly は skip）／前の形（step の if: で E2E を飛ばしてジョブは success）／e2e-full で成功 */
  const JOBS = {
    green: [
      { name: 'gate', conclusion: 'success', steps: [] },
      { name: 'e2e-nightly', conclusion: 'success', steps: [E2E, skippedStep(FULL)] },
    ],
    gateOnly: [
      { name: 'gate', conclusion: 'success', steps: [] },
      { name: 'e2e-nightly', conclusion: 'skipped', steps: [] },
    ],
    oldSkipped: [{ name: 'e2e-nightly', conclusion: 'success', steps: [skippedStep(E2E), skippedStep(FULL)] }],
    fullGreen: [
      { name: 'gate', conclusion: 'success', steps: [] },
      { name: 'e2e-nightly', conclusion: 'success', steps: [skippedStep(E2E), FULL] },
    ],
    otherJob: [{ name: 'e2e', conclusion: 'success', steps: [E2E] }],
  };

  test('decide: 手動実行は常に流す。月・木以外の回は公開のときだけ。前回の成功と同じ SHA なら流さない', () => {
    const d = (p) => gate.decide({ event: 'schedule', schedule: TW, isPrivate: false, headSha: H, lastGreen: { sha: OLD, runId: 1 }, ...p });
    assert.equal(d({ event: 'workflow_dispatch', lastGreen: { sha: H, runId: 1 } }).run, true, '手動実行は同じ SHA でも流す');
    assert.equal(d({ event: 'workflow_dispatch', schedule: '', isPrivate: true, lastGreen: undefined }).needLastGreen, false, '手動実行で API を読みに行く');
    assert.equal(d({}).run, true, '月・木・公開・変更あり');
    assert.equal(d({ isPrivate: true }).run, true, '月・木は非公開でも流す（変更があれば）');
    assert.equal(d({ isPrivate: null }).run, true, '月・木は可視性が分からなくても流す（変更があれば）');
    assert.equal(d({ lastGreen: { sha: H, runId: 1 } }).run, false, '前回の成功と同じ SHA を流した');
    assert.equal(d({ lastGreen: null }).run, true, '前回の成功が見つからない・読めないときに流さない');
    assert.equal(d({ schedule: OD }).run, true, '月・木以外・公開・変更あり');
    assert.equal(d({ schedule: OD, lastGreen: { sha: H, runId: 1 } }).run, false, '月・木以外・公開・同じ SHA');
    const priv = d({ schedule: OD, isPrivate: true, lastGreen: undefined });
    assert.deepEqual([priv.run, priv.needLastGreen], [false, false], '非公開の月・木以外で流す（または run の一覧を読みに行く）');
    assert.equal(d({ schedule: OD, isPrivate: null, lastGreen: undefined }).run, false, '可視性が分からない月・木以外を公開として扱った');
    assert.equal(d({ lastGreen: undefined }).needLastGreen, true, '月・木で前回の成功を調べない');
  });

  test('isGreenE2E: e2e-nightly が success で、E2E か e2e-full の step が success の回だけを「前回の成功」に数える', () => {
    assert.equal(gate.isGreenE2E(JOBS.green), true);
    assert.equal(gate.isGreenE2E(JOBS.fullGreen), true);
    assert.equal(gate.isGreenE2E(JOBS.gateOnly), false, 'gate だけの回（E2E が skip）を成功に数えた');
    assert.equal(gate.isGreenE2E(JOBS.oldSkipped), false, '前の形の「省略した回」（ジョブは success・E2E の step は skip）を成功に数えた');
    assert.equal(gate.isGreenE2E(JOBS.otherJob), false, 'e2e-nightly 以外のジョブを数えた');
    assert.equal(gate.isGreenE2E([{ name: 'e2e-nightly', conclusion: 'failure', steps: [E2E] }]), false, '赤のジョブを数えた');
  });

  // 偽の API サーバー（GITHUB_API_URL で向ける）にスクリプトを子プロセスでつなぎ、GITHUB_OUTPUT と要求を確かめる
  const execFileP = promisify(execFile);
  async function runGate({ event = 'schedule', schedule = TW, eventPrivate = '', head = H, repo = { private: false }, runs = [], jobs = {}, fail = [] }) {
    const requests = [];
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://x');
      requests.push({ path: url.pathname, query: url.search, auth: req.headers.authorization });
      const send = (code, body) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const p = url.pathname;
      const kind =
        p === '/repos/o/r' ? 'repo' : p === '/repos/o/r/actions/workflows/nightly.yml/runs' ? 'runs' : /^\/repos\/o\/r\/actions\/runs\/\d+\/jobs$/.test(p) ? 'jobs' : '';
      if (!kind || fail.includes(kind)) return send(kind ? 500 : 404, { message: 'x' });
      if (kind === 'repo') return send(200, repo);
      if (kind === 'runs') {
        // 本物の API と同じく status・head_sha で絞り、per_page・page で切る（新しい順は渡した runs の順）
        const q = url.searchParams;
        const list = runs.filter((r) => (!q.get('head_sha') || r.head_sha === q.get('head_sha')) && (q.get('status') !== 'success' || r.conclusion === 'success'));
        const per = Number(q.get('per_page') ?? 30);
        const page = Number(q.get('page') ?? 1);
        return send(200, { total_count: list.length, workflow_runs: list.slice((page - 1) * per, page * per) });
      }
      return send(200, { jobs: jobs[p.split('/')[6]] ?? [] });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const dir = mkdtempSync(join(tmpRoot, 'gate-'));
    const out = join(dir, 'out');
    writeFileSync(out, '');
    try {
      const r = await execFileP(process.execPath, [join(root, 'scripts', 'nightly-gate.mjs')], {
        encoding: 'utf8',
        env: {
          ...process.env,
          GITHUB_API_URL: `http://127.0.0.1:${server.address().port}`,
          GITHUB_REPOSITORY: 'o/r',
          GITHUB_EVENT_NAME: event,
          GITHUB_SHA: head,
          GITHUB_OUTPUT: out,
          GITHUB_STEP_SUMMARY: join(dir, 'summary'),
          GH_TOKEN: 'tok',
          EVENT_SCHEDULE: event === 'schedule' ? schedule : '',
          EVENT_PRIVATE: eventPrivate,
        },
      });
      const lines = readFileSync(out, 'utf8').trim().split('\n');
      assert.equal(lines.length, 1, `GITHUB_OUTPUT の行が 1 つでない: ${lines.join(' / ')}`);
      return { run: lines[0], log: r.stdout, requests };
    } finally {
      server.close();
    }
  }
  const run = (id, sha, conclusion = 'success') => ({ id, head_sha: sha, conclusion });

  test('偽の API: 公開・月・木以外・main が前回の成功から変わった → 流す。gate だけの回（同じ SHA）は前回に数えない', async () => {
    const r = await runGate({ schedule: OD, runs: [run(3, H), run(2, OLD)], jobs: { 3: JOBS.gateOnly, 2: JOBS.green } });
    assert.equal(r.run, 'run=true', r.log);
    const runsReq = r.requests.find((q) => q.path.endsWith('/runs'));
    assert.ok(runsReq, 'run の一覧を読んでいない');
    assert.match(runsReq.query, /[?&]status=success(&|$)/, '成功した run だけを読んでいない');
    assert.ok(r.requests.every((q) => q.auth === 'Bearer tok'), 'トークンを付けずに読んだ（非公開のときに読めない）');
  });

  // PR #66 のレビュー S-1: 「新しい順に 30 件」だと、gate だけの回が積み上がる（非公開で約 4 週間 main が変わらない）か、別のブランチの
  // 手動実行が後から入ると、同じ SHA を流し直していた。この SHA で絞り（head_sha）、全ページを読み、古い順に jobs を見る
  test('偽の API（レビュー S-1）: head_sha で絞って全ページを読み、gate だけの回が 250 件・別の SHA の成功が後にあっても、この SHA の成功を見つけて流さない', async () => {
    const gateOnly = Array.from({ length: 250 }, (_, i) => run(1000 - i, H));
    const runs = [run(2000, OLD), ...gateOnly, run(5, H)]; // 新しい順: 別のブランチの手動実行（OLD で成功）→ gate だけの回 → この SHA の E2E の成功
    const jobs = { 2000: JOBS.green, 5: JOBS.green, ...Object.fromEntries(gateOnly.map((r) => [r.id, JOBS.gateOnly])) };
    const r = await runGate({ schedule: OD, runs, jobs });
    assert.equal(r.run, 'run=false', r.log);
    const listReqs = r.requests.filter((q) => q.path.endsWith('/runs'));
    for (const q of listReqs) assert.match(q.query, new RegExp(`[?&]head_sha=${H}(&|$)`), `run の一覧を SHA で絞っていない: ${q.query}`);
    assert.equal(listReqs.length, 3, `全ページ（100 件ずつで 3 ページ）を読んでいない: ${listReqs.length}`);
    const jobReqs = r.requests.filter((q) => q.path.endsWith('/jobs'));
    assert.equal(jobReqs.length, 1, `古い順に見ていない（jobs の呼び出しが ${jobReqs.length} 回）`);
    // この SHA の成功がなく、別の SHA の成功だけがある → 流す
    const r2 = await runGate({ schedule: OD, runs: [run(2000, OLD), ...gateOnly], jobs });
    assert.equal(r2.run, 'run=true', r2.log);
  });

  test('偽の API: この回の SHA が読めない（空・40 桁の 16 進でない）→ API を読まずに流す', async () => {
    const r = await runGate({ head: '', runs: [run(1, H)], jobs: { 1: JOBS.green } });
    assert.equal(r.run, 'run=true', r.log);
    assert.ok(!r.requests.some((q) => q.path.endsWith('/runs')), 'SHA が読めないのに run の一覧を読んだ');
  });

  test('偽の API: 公開・月・木以外・前回の成功（e2e-full を含む）と同じ SHA → 流さない', async () => {
    const r = await runGate({ schedule: OD, runs: [run(5, H)], jobs: { 5: JOBS.fullGreen } });
    assert.equal(r.run, 'run=false', r.log);
  });

  test('偽の API: 前の形の「省略した回」（ジョブは success・E2E の step は skip）は前回に数えず、その前の成功と比べる', async () => {
    const r = await runGate({ runs: [run(9, H), run(8, H)], jobs: { 9: JOBS.oldSkipped, 8: JOBS.gateOnly } });
    assert.equal(r.run, 'run=true', r.log);
    const r2 = await runGate({ runs: [run(9, OLD), run(8, H)], jobs: { 9: JOBS.oldSkipped, 8: JOBS.green } });
    assert.equal(r2.run, 'run=false', r2.log);
  });

  test('偽の API: 非公開・月・木以外 → 流さず、run の一覧も読まない。非公開・月・木 → 変更があれば流す', async () => {
    const r = await runGate({ schedule: OD, repo: { private: true }, runs: [run(1, OLD)], jobs: { 1: JOBS.green } });
    assert.equal(r.run, 'run=false', r.log);
    assert.ok(!r.requests.some((q) => q.path.endsWith('/runs')), '非公開の月・木以外で run の一覧を読んだ');
    const r2 = await runGate({ schedule: TW, repo: { private: true }, runs: [run(1, OLD)], jobs: { 1: JOBS.green } });
    assert.equal(r2.run, 'run=true', r2.log);
    const r3 = await runGate({ schedule: TW, repo: { private: true }, runs: [run(1, H)], jobs: { 1: JOBS.green } });
    assert.equal(r3.run, 'run=false', r3.log);
  });

  test('偽の API: 可視性が読めない → イベントの値を使い、それもなければ非公開として扱う（月・木以外は流さない）', async () => {
    const r = await runGate({ schedule: OD, fail: ['repo'], runs: [run(1, OLD)], jobs: { 1: JOBS.green } });
    assert.equal(r.run, 'run=false', r.log);
    assert.match(r.log, /::warning::/, '読めなかったことを警告していない');
    const r2 = await runGate({ schedule: OD, fail: ['repo'], eventPrivate: 'false', runs: [run(1, OLD)], jobs: { 1: JOBS.green } });
    assert.equal(r2.run, 'run=true', r2.log);
    const r3 = await runGate({ schedule: OD, fail: ['repo'], eventPrivate: 'true', runs: [run(1, OLD)], jobs: { 1: JOBS.green } });
    assert.equal(r3.run, 'run=false', r3.log);
  });

  test('偽の API: run の一覧・jobs が読めない、または成功が見つからない → 流す（証拠を欠かない側）', async () => {
    for (const fail of [['runs'], ['jobs']]) {
      const r = await runGate({ fail, runs: [run(1, H)], jobs: { 1: JOBS.green } });
      assert.equal(r.run, 'run=true', `${fail}: ${r.log}`);
      assert.match(r.log, /::warning::/, `${fail}: 読めなかったことを警告していない`);
    }
    const r = await runGate({ runs: [run(2, H), run(1, H)], jobs: { 2: JOBS.gateOnly, 1: JOBS.otherJob } });
    assert.equal(r.run, 'run=true', r.log);
    const r2 = await runGate({ runs: [] });
    assert.equal(r2.run, 'run=true', r2.log);
  });

  test('偽の API: 手動実行は API を読まずに流す。知らない cron は月・木の回として扱い、警告する', async () => {
    const r = await runGate({ event: 'workflow_dispatch', fail: ['repo', 'runs', 'jobs'] });
    assert.equal(r.run, 'run=true', r.log);
    assert.equal(r.requests.length, 0, '手動実行で API を読んだ');
    const r2 = await runGate({ schedule: '17 18 * * *', repo: { private: true }, runs: [run(1, OLD)], jobs: { 1: JOBS.green } });
    assert.equal(r2.run, 'run=true', r2.log);
    assert.match(r2.log, /::warning::知らない cron/);
  });

  test('nightly.yml の gate: 権限は contents: read と actions: read だけ。トークンは gate の step 1 つだけ。npm・setup-node を使わない', () => {
    assert.deepEqual(names(nightly), ['gate', 'e2e-nightly'], 'nightly.yml のジョブは gate と e2e-nightly');
    const g = jobOf(nightly, 'gate');
    const c = codeOf(g);
    const perms = /^ {4}permissions:\n((?: {6}.*\n)+)/m.exec(g)?.[1] ?? '';
    assert.deepEqual([...perms.matchAll(/^ {6}([\w-]+): (\w+)/gm)].map((m) => `${m[1]}: ${m[2]}`), ['contents: read', 'actions: read'], 'gate の permissions');
    assert.match(c, /^ {4}outputs:\n {6}run: \$\{\{ steps\.gate\.outputs\.run \}\}$/m, 'gate の outputs.run が steps.gate.outputs.run でない');
    const ss = stepsOf(g);
    const withToken = ss.filter((s) => /github\.token|GITHUB_TOKEN|GH_TOKEN/.test(codeOf(s)));
    assert.equal(withToken.length, 1, 'トークンを使う step が 1 つでない');
    const st = codeOf(withToken[0]);
    assert.match(st, /^ {8}id: gate$/m);
    assert.match(st, /^ {8}run: node scripts\/nightly-gate\.mjs$/m, 'トークンの step は node scripts/nightly-gate.mjs だけ');
    assert.match(st, /^ {10}GH_TOKEN: \$\{\{ github\.token \}\}$/m);
    assert.match(st, /^ {10}EVENT_SCHEDULE: \$\{\{ github\.event\.schedule \}\}$/m, 'github.event.schedule を渡していない（月・木を見分けられない）');
    assert.match(st, /^ {10}EVENT_PRIVATE: \$\{\{ github\.event\.repository\.private \}\}$/m);
    assert.doesNotMatch(c, /\bnpm\b|\bnpx\b|setup-node|\bsecrets\b/, 'gate で npm・npx・setup-node・secrets を使っている（トークンのあるジョブで依存のコードを動かさない）');
    assert.match(g, /sparse-checkout: \|\n {12}scripts\/nightly-gate\.mjs\n {10}sparse-checkout-cone-mode: false\n/, 'gate の checkout は scripts/nightly-gate.mjs だけ');
  });

  test('nightly-gate.mjs は node: の組み込みだけを読み込み、既定の送り先は api.github.com だけ', () => {
    const src = readFileSync(join(root, 'scripts', 'nightly-gate.mjs'), 'utf8');
    const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    assert.ok(imports.length > 0);
    for (const m of imports) assert.match(m, /^node:/, `node: 以外の読み込み: ${m}`);
    assert.doesNotMatch(src, /\bimport\(|\brequire\(|child_process/, '動的な読み込み・子プロセス');
    assert.equal((src.match(/\bfetch\(/g) ?? []).length, 1, 'fetch が 1 か所でない');
    assert.deepEqual([...src.matchAll(/https?:\/\/[^\s'`)]+/g)].map((m) => m[0]), ['https://api.github.com'], '既定の送り先が api.github.com だけでない');
  });
});

/** ワークフローのジョブの名前の一覧（jobs: の直下） */
function names(text) {
  return [...(/^jobs:\n([\s\S]*)$/m.exec(text)?.[1] ?? '').matchAll(/^ {2}([a-z][\w-]*):\n/gm)].map((m) => m[1]);
}
