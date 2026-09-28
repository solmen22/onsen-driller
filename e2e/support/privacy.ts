// 共通の検査（e2e_common_privacy-checks.md。QA テスト戦略 §4-3「プライバシーと規約の自動検査」）
//
// - TS-COM-01 通信: context 全体（ページ・iframe・Worker）の要求を記録し、許可リスト外は context.route で中止しつつ記録する
//   （CI は外に出られないので、中止した要求も「送ろうとした」として数える）
// - TS-COM-02 WebSocket・ビーコン: page.on('request') では WebSocket を拾えないので、context.routeWebSocket で
//   すべての WebSocket を捕まえて記録し、つながせない。ビーコン（sendBeacon）は要求として記録される
// - TS-COM-03 Cookie: context.cookies() と、開いているページの document.cookie
// - TS-COM-04 キー名: localStorage のキーがすべて `onsen-driller:` で始まる（テストが自分で入れた他のゲームのキーは除く）
import type { BrowserContext, Page } from '@playwright/test';

export const STORAGE_PREFIX = 'onsen-driller:';

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
 */
function pageProbe(): void {
  const w = window as unknown as { __fsCalls: number; __keys: KeyboardEvent[] };
  w.__fsCalls = 0;
  w.__keys = [];
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

/** pageProbe がためた keydown（コード・自動リピートか・preventDefault されたか） */
export async function recordedKeydowns(page: Page): Promise<{ code: string; repeat: boolean; prevented: boolean }[]> {
  return page.evaluate(() =>
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

/** 1 つの browser context を見張る */
export class ContextMonitor {
  readonly requests: { url: string; type: string }[] = [];
  readonly blocked: string[] = [];
  readonly websockets: string[] = [];
  readonly pageErrors: string[] = [];
  readonly consoleErrors: string[] = [];
  readonly context: BrowserContext;
  readonly allowedOrigins: readonly string[];
  readonly foreignKeys: ReadonlySet<string>;

  constructor(context: BrowserContext, allowedOrigins: readonly string[], foreignKeys: ReadonlySet<string>) {
    this.context = context;
    this.allowedOrigins = allowedOrigins;
    this.foreignKeys = foreignKeys;
  }

  async attach(): Promise<void> {
    await this.context.addInitScript(pageProbe);
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
        if (m.type() === 'error') this.consoleErrors.push(m.text());
      });
      // routeWebSocket を通らなかったもの（Worker など）の保険
      p.on('websocket', (ws) => {
        if (!this.websockets.includes(ws.url())) this.websockets.push(ws.url());
      });
    };
    for (const p of this.context.pages()) watch(p);
    this.context.on('page', watch);
  }

  /** 共通の検査の違反を集める（context が開いている間に呼ぶ） */
  async violations(): Promise<Violation[]> {
    const out: Violation[] = [];
    const seen = new Set<string>();
    for (const r of this.requests) {
      if (isAllowedUrl(r.url, this.allowedOrigins) || seen.has(r.url)) continue;
      seen.add(r.url);
      const isBeacon = r.type === 'ping' || r.type === 'beacon';
      out.push({ check: isBeacon ? 'TS-COM-02' : 'TS-COM-01', detail: `許可リスト外への${isBeacon ? 'ビーコン' : '通信'}（${r.type}）: ${r.url}` });
    }
    for (const url of this.blocked) {
      if (seen.has(url)) continue;
      seen.add(url);
      out.push({ check: 'TS-COM-01', detail: `許可リスト外への通信（中止した）: ${url}` });
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
