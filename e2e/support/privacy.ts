// 共通の検査（e2e_common_privacy-checks.md。QA テスト戦略 §4-3「プライバシーと規約の自動検査」）
//
// - TS-COM-01 通信: context 全体（ページ・iframe・Worker）の要求を記録し、許可リスト外は context.route で中止しつつ記録する
//   （CI は外に出られないので、中止した要求も「送ろうとした」として数える）
// - TS-COM-02 WebSocket・ビーコン: page.on('request') では WebSocket を拾えないので、context.routeWebSocket で
//   すべての WebSocket を捕まえて記録し、つながせない。ページが開いている間のビーコン（sendBeacon）は要求として記録される
// - ページを離れるとき（pagehide。再読み込み・同じタブの移動）の送信: sendBeacon・fetch(keepalive)・画像の読み込みは
//   context.on('request') にも context.route にも来ない（PR #4 のレビュー M-1 の実測）。そこで初期化スクリプトで
//   sendBeacon・fetch（keepalive のとき）・img の src を包み、別オリジンへの送信先を sessionStorage の
//   NET_JOURNAL_KEY（`onsen-driller:e2e:net`。TS-COM-05 の接頭辞の規則どおり）に同期で書き留める。
//   再読み込みの後も同じタブの sessionStorage に残るので、検査の終わりに開いているページで読み、許可リスト外を
//   TS-COM-02（ビーコン）・TS-COM-01（keepalive の fetch・画像）の違反に数える。
//   限界: タブ・context を閉じると記録も消えるので見えない（ゲームの流れの E2E はタブを閉じない）。script・link・iframe などの
//   要素の読み込みと setAttribute('src') は包んでいない。preconnect・dns-prefetch は要求にならない。これらはビルドの静的検査で塞ぐ案がある
// - TS-COM-03 Cookie: context.cookies() と、開いているページの document.cookie
// - TS-COM-04 キー名: localStorage のキーがすべて `onsen-driller:` で始まる（テストが自分で入れた他のゲームのキーは除く）
import type { BrowserContext, ConsoleMessage, Frame, Page } from '@playwright/test';

export const STORAGE_PREFIX = 'onsen-driller:';

/** ページを離れるときの送信の記録（sessionStorage。キー名の規則 `onsen-driller:` に合わせる） */
export const NET_JOURNAL_KEY = `${STORAGE_PREFIX}e2e:net`;

/** 記録の 1 件（kind: beacon＝sendBeacon、keepalive＝fetch(keepalive)、image＝img の src） */
export interface NetJournalEntry {
  kind: 'beacon' | 'keepalive' | 'image';
  url: string;
}

export type CheckId = 'TS-COM-01' | 'TS-COM-02' | 'TS-COM-03' | 'TS-COM-04';

export interface Violation {
  check: CheckId;
  detail: string;
}

export class CommonCheckError extends Error {
  readonly violations: Violation[];
  constructor(violations: Violation[]) {
    super(`共通の検査（通信・Cookie・キー名）に違反があります:\n${violations.map((v) => `  - ${v.check}: ${v.detail}`).join('\n')}`);
    this.name = 'CommonCheckError';
    this.violations = violations;
  }
}

/**
 * ページのスクリプトより先に入れる仕掛け（e2e_E1_first-play.md「準備」の 2）
 * - 全画面の要求の回数を window.__fsCalls に数える（TS-E1-12）
 * - Space・矢印キーの keydown のイベントを window.__keys にためる（TS-E1-11）。defaultPrevented は
 *   ゲームの処理が済んだ後に読む（イベントの物を持っておけば、配送が終わった後も値が残る）
 * - 別オリジンへの sendBeacon・fetch(keepalive)・img の src を sessionStorage の journalKey に同期で書き留める（M-1）。
 *   読み出しは window.__e2eNetJournal()。harness の初期化スクリプトは保存できない環境（V2〜V7）の差し替えより先に入るので、
 *   ここで取っておく Storage.prototype の getItem・setItem は本物
 */
function pageProbe(journalKey: string): void {
  const w = window as unknown as { __fsCalls: number; __keys: KeyboardEvent[]; __e2eNetJournal: () => unknown[] };
  w.__fsCalls = 0;
  w.__keys = [];
  // --- ページを離れるときの送信の記録 ---
  // 元の関数は記述子から取る（V2〜V7 の差し替えより先に動くので本物）
  const getItem = Object.getOwnPropertyDescriptor(Storage.prototype, 'getItem')?.value as (this: Storage, k: string) => string | null;
  const setItem = Object.getOwnPropertyDescriptor(Storage.prototype, 'setItem')?.value as (this: Storage, k: string, v: string) => void;
  let ss: Storage | null = null;
  try {
    ss = window.sessionStorage;
  } catch {
    ss = null;
  }
  const read = (): unknown[] => {
    try {
      const raw = ss ? getItem.call(ss, journalKey) : null;
      const v: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  };
  const note = (kind: string, target: unknown): void => {
    let url = String(target);
    try {
      const u = new URL(url, location.href);
      url = u.href;
      // 同じオリジン・data:・blob: は書き留めない（ゲームの素材の読み込みで記録が膨らまないように。許可リストの判定は Node 側）
      if (u.origin === location.origin || u.protocol === 'data:' || u.protocol === 'blob:') return;
    } catch {
      /* URL にできないものはそのまま書き留める */
    }
    const list = read();
    list.push({ kind, url });
    try {
      if (ss) setItem.call(ss, journalKey, JSON.stringify(list));
    } catch {
      /* 書けなければ諦める（検査が見えなくなるだけで、ゲームには影響しない） */
    }
  };
  w.__e2eNetJournal = read;
  const origBeacon = Object.getOwnPropertyDescriptor(Navigator.prototype, 'sendBeacon')?.value as
    | ((this: Navigator, url: string | URL, data?: BodyInit | null) => boolean)
    | undefined;
  if (typeof origBeacon === 'function') {
    Object.defineProperty(Navigator.prototype, 'sendBeacon', {
      configurable: true,
      writable: true,
      value: function (this: Navigator, url: string | URL, data?: BodyInit | null) {
        note('beacon', url);
        return origBeacon.call(this, url, data);
      },
    });
  }
  const origFetch = Object.getOwnPropertyDescriptor(window, 'fetch')?.value as ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) | undefined;
  if (typeof origFetch === 'function') {
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const req = input instanceof Request ? input : null;
      if (init?.keepalive === true || req?.keepalive === true) note('keepalive', req ? req.url : input instanceof URL ? input.href : input);
      return origFetch.call(window, input, init);
    };
  }
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  const srcSet = (srcDesc ? Reflect.get(srcDesc, 'set') : undefined) as ((this: HTMLImageElement, v: string) => void) | undefined;
  if (srcDesc && srcSet) {
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...srcDesc,
      set(this: HTMLImageElement, v: string) {
        note('image', v);
        srcSet.call(this, v);
      },
    });
  }
  const wrap = (proto: object, name: string): void => {
    const orig = (proto as Record<string, unknown>)[name];
    if (typeof orig !== 'function') return;
    Object.defineProperty(proto, name, {
      configurable: true,
      writable: true,
      value: function (this: unknown, ...args: unknown[]) {
        w.__fsCalls++;
        return (orig as (...a: unknown[]) => unknown).apply(this, args);
      },
    });
  };
  wrap(Element.prototype, 'requestFullscreen');
  wrap(Element.prototype, 'webkitRequestFullscreen');
  wrap(Element.prototype, 'webkitRequestFullScreen');
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.code === 'Space' || e.code.startsWith('Arrow')) w.__keys.push(e);
    },
    true,
  );
}

/** pageProbe がためた keydown（コード・自動リピートか・preventDefault されたか）。page はポータルの枠を模した iframe の Frame でもよい */
export async function recordedKeydowns(page: Page | Frame): Promise<{ code: string; repeat: boolean; prevented: boolean }[]> {
  return (page as Frame).evaluate(() =>
    (window as unknown as { __keys: KeyboardEvent[] }).__keys.map((e) => ({ code: e.code, repeat: e.repeat, prevented: e.defaultPrevented })),
  );
}

export function isAllowedUrl(url: string, allowedOrigins: readonly string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:') return true;
  return allowedOrigins.includes(u.origin);
}

/** Playwright の Clock API がタイマー・rAF を実行する関数の名前（Playwright 1.63 の ClockController。例外のスタックに必ず出る） */
const CLOCK_TIMER_RUNNER = '_callFirstTimer';

/**
 * console.error が「Clock API の偽のタイマー・rAF の中の、捕まえていない例外」なら `名前: 文`、そうでなければ null（BL-108。
 * PR #15 のレビューの連絡 1）。時計が流れている間（bootGame の起動中・pauseClock: false）は、Clock API がその例外を
 * `console.error(e)` で出すだけで、window の error・pageerror・__game.errors() のどれにも入らない（止めている間は
 * runFor・fastForward の呼び出し元に投げ返すので、テストが失敗して見逃さない）。
 * 見分け方（2026-10-04 の手元の実測。chromium・firefox・webkit）: 引数が Error 1 つ・そのスタックに CLOCK_TIMER_RUNNER がある・
 * 呼び出しの位置が http(s) の URL ではない（Clock API は注入されたスクリプトから呼ぶ。Firefox は text() が「Error」だけなので、
 * 名前と文は Error から読む）。アプリが自分で出す console.error（store の購読者の例外など。位置はアプリの http の URL）や、
 * ブラウザが出す console.error（404 の読み込みの失敗など）は含めない（それらは consoleErrors で見る）
 */
async function clockUncaughtErrorOf(m: ConsoleMessage): Promise<string | null> {
  const args = m.args();
  if (args.length !== 1 || /^https?:/.test(m.location().url)) return null;
  try {
    return await args[0]!.evaluate(
      (a, runner) => (a instanceof Error && String(a.stack).includes(runner) ? `${a.name}: ${a.message}` : null),
      CLOCK_TIMER_RUNNER,
    );
  } catch {
    // 中身を読めなかった（ページが閉じた直後など）。見逃さない側に倒す
    return `${m.text()}（Clock API の例外かどうか確かめられなかった console.error）`;
  }
}

/** 1 つの browser context を見張る */
export class ContextMonitor {
  readonly requests: { url: string; type: string }[] = [];
  readonly blocked: string[] = [];
  readonly websockets: string[] = [];
  readonly pageErrors: string[] = [];
  readonly consoleErrors: string[] = [];
  /** Clock API の偽のタイマー・rAF の中の、捕まえていない例外（clockUncaughtErrorOf。settled() の後に読む） */
  readonly clockErrors: string[] = [];
  private readonly pending = new Set<Promise<void>>();
  readonly context: BrowserContext;
  readonly allowedOrigins: readonly string[];
  readonly foreignKeys: ReadonlySet<string>;

  constructor(context: BrowserContext, allowedOrigins: readonly string[], foreignKeys: ReadonlySet<string>) {
    this.context = context;
    this.allowedOrigins = allowedOrigins;
    this.foreignKeys = foreignKeys;
  }

  async attach(): Promise<void> {
    await this.context.addInitScript(pageProbe, NET_JOURNAL_KEY);
    // 許可リスト外は中止しつつ記録する（許可するものは、ほかの route（S2 の SDK のモックなど）に回す）
    await this.context.route('**/*', async (route) => {
      const url = route.request().url();
      if (isAllowedUrl(url, this.allowedOrigins)) return route.fallback();
      this.blocked.push(url);
      return route.abort('blockedbyclient');
    });
    // WebSocket はすべて記録してつながせない（本作は WebSocket を使わない。vite preview も HMR を使わない）
    await this.context.routeWebSocket(/.*/, async (ws) => {
      this.websockets.push(ws.url());
      await ws.close({ code: 1008, reason: 'blocked by e2e network check' });
    });
    this.context.on('request', (r) => this.requests.push({ url: r.url(), type: r.resourceType() }));
    const watch = (p: Page): void => {
      p.on('pageerror', (e) => this.pageErrors.push(`${e.name}: ${e.message}`));
      p.on('console', (m) => {
        if (m.type() !== 'error') return;
        this.consoleErrors.push(m.text());
        const job = clockUncaughtErrorOf(m).then((e) => {
          if (e) this.clockErrors.push(e);
        });
        this.pending.add(job);
        void job.finally(() => this.pending.delete(job));
      });
      // routeWebSocket を通らなかったもの（Worker など）の保険
      p.on('websocket', (ws) => {
        if (!this.websockets.includes(ws.url())) this.websockets.push(ws.url());
      });
    };
    for (const p of this.context.pages()) watch(p);
    this.context.on('page', watch);
  }

  /** console.error の見分け（clockUncaughtErrorOf）が終わるのを待つ */
  async settled(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  /** 開いているページの送信の記録（pageProbe が sessionStorage に書き留めたもの。同じタブの再読み込みの前の分を含む） */
  async netJournal(): Promise<NetJournalEntry[]> {
    const all: NetJournalEntry[] = [];
    for (const p of this.context.pages()) {
      if (p.isClosed()) continue;
      const j = await p
        .evaluate(() => {
          const f = (window as unknown as { __e2eNetJournal?: () => unknown[] }).__e2eNetJournal;
          return typeof f === 'function' ? f() : [];
        })
        .catch(() => [] as unknown[]);
      for (const e of j) {
        if (e && typeof e === 'object' && typeof (e as NetJournalEntry).url === 'string') all.push(e as NetJournalEntry);
      }
    }
    return all;
  }

  /** 共通の検査の違反を集める（context が開いている間に呼ぶ） */
  async violations(): Promise<Violation[]> {
    const out: Violation[] = [];
    const seen = new Set<string>();
    // ページの記録（どの API で送ったか）。WebKit はページを離れるときの画像の読み込みを PingLoader で送り、要求の種類が
    // 'ping' になる（2026-09-29 の実測。Firefox は 'image'。Chromium はページを離れるときの送信が要求として見えず、記録だけで数える
    // 〔PR #12 のレビュー N-1〕）。種類だけで分けると画像がビーコン（TS-COM-02）に
    // 数えられ、「画像＝TS-COM-01」（QA §4-3・TS-COM-08 (c)）と合わない。記録にある URL は記録の種類で分ける（BL-094）
    const journal = await this.netJournal();
    const kindOf = new Map(journal.map((e) => [e.url, e.kind] as const));
    for (const r of this.requests) {
      if (isAllowedUrl(r.url, this.allowedOrigins) || seen.has(r.url)) continue;
      seen.add(r.url);
      const kind = kindOf.get(r.url);
      const isBeacon = kind ? kind === 'beacon' : r.type === 'ping' || r.type === 'beacon';
      out.push({ check: isBeacon ? 'TS-COM-02' : 'TS-COM-01', detail: `許可リスト外への${isBeacon ? 'ビーコン' : '通信'}（${r.type}）: ${r.url}` });
    }
    for (const url of this.blocked) {
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ check: 'TS-COM-01', detail: `許可リスト外への通信（中止した）: ${url}` });
    }
    // ページを離れるとき（pagehide）の送信は要求として見えないので、ページに書き留めた記録を読む（M-1）
    for (const e of journal) {
      if (isAllowedUrl(e.url, this.allowedOrigins) || seen.has(e.url)) continue;
      seen.add(e.url);
      out.push(
        e.kind === 'beacon'
          ? { check: 'TS-COM-02', detail: `許可リスト外へのビーコン（ページの記録。ページを離れるときを含む）: ${e.url}` }
          : { check: 'TS-COM-01', detail: `許可リスト外への通信（ページの記録。${e.kind === 'keepalive' ? 'fetch の keepalive' : '画像の読み込み'}。ページを離れるときを含む）: ${e.url}` },
      );
    }
    for (const url of this.websockets) out.push({ check: 'TS-COM-02', detail: `WebSocket の接続: ${url}` });

    const cookies = await this.context.cookies();
    if (cookies.length > 0) out.push({ check: 'TS-COM-03', detail: `context.cookies() が空でない: ${cookies.map((c) => `${c.name}@${c.domain}`).join(', ')}` });
    for (const p of this.context.pages()) {
      if (p.isClosed()) continue;
      const dc = await p.evaluate(() => document.cookie).catch(() => '');
      if (dc) out.push({ check: 'TS-COM-03', detail: `document.cookie が空でない（${p.url()}）: ${dc}` });
    }

    for (const { origin, name } of await localStorageKeys(this.context)) {
      if (name.startsWith(STORAGE_PREFIX) || this.foreignKeys.has(name)) continue;
      out.push({ check: 'TS-COM-04', detail: `${origin} の localStorage のキー "${name}" が ${STORAGE_PREFIX} で始まらない` });
    }
    return out;
  }
}

/** context の localStorage のキー（ページのスクリプトによる上書きの影響を受けない storageState で読む） */
export async function localStorageKeys(context: BrowserContext): Promise<{ origin: string; name: string }[]> {
  const st = await context.storageState();
  return st.origins.flatMap((o) => o.localStorage.map((e) => ({ origin: o.origin, name: e.name })));
}
