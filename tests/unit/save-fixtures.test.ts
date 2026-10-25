// BL-028: セーブの見本（tests/fixtures/saves/v{N}/。序盤・転生前・転生後・最大状態）を今の版で読む・移行の連鎖・新しい版のセーブの保護・大きさ。
// 見本は tools/fixtures/make-save-fixtures.ts が書き、消さない（gdd §10）。TS-ID は BL-021 のシナリオ（TS-021-27・29・30・32）と、BL-028 のシナリオが出たら付ける
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERK_BY_ID } from '../../src/content/perks.ts';
import { PARAMS } from '../../src/content/params.ts';
import { checksumOf, stateHash, toSaveGame, type GameState } from '../../src/core/index.ts';
import type { KeyValueStore } from '../../src/platform/types.ts';
import { decodeSave, encodeSave } from '../../src/save/codec.ts';
import { migrateGame, STEPS, type MigrationStep } from '../../src/save/migrate.ts';
import { SAVE_SCHEMA_VERSION } from '../../src/save/schema.ts';
import { SAVE_KEYS, SaveSlots } from '../../src/save/slots.ts';
import { FIXTURE_KINDS } from '../../tools/fixtures/save-fixtures.ts';
import { writeFixtures } from '../../tools/fixtures/make-save-fixtures.ts';

const ROOT = join('tests', 'fixtures', 'saves');
const read = (...p: string[]): string => readFileSync(join(ROOT, ...p), 'utf8').trim();
const versions = readdirSync(ROOT)
  .filter((d) => /^v\d+$/.test(d))
  .map((d) => Number(d.slice(1)))
  .sort((a, b) => a - b);
type Rec = Record<string, unknown>;

const decodeOk = (raw: string): { state: GameState; corrected: string[] } => {
  const r = decodeSave(raw);
  if (!r.ok) throw new Error(r.reason);
  return { state: r.state, corrected: r.corrected };
};

/** 読み込んだ状態の不変条件（形を越えた整合。arch §11 の補正の規則） */
function invariants(s: GameState): void {
  const r = s.run;
  expect(s.schema).toBe(SAVE_SCHEMA_VERSION);
  expect(s.stats.bestDepth).toBeGreaterThanOrEqual(r.maxDepth);
  expect(r.maxDepth).toBeGreaterThanOrEqual(r.depth);
  expect(r.startDepth).toBeLessThanOrEqual(r.maxDepth);
  expect(s.meta.tickets).toBeGreaterThanOrEqual(0);
  expect(s.meta.tickets).toBeLessThanOrEqual(PARAMS.tickets.max);
  expect(s.meta.yunohana.spent.toNumber()).toBe(s.meta.perks.reduce((a, id) => a + PERK_BY_ID[id].cost, 0));
  expect(s.meta.yunohana.lifetime.gte(s.meta.yunohana.spent)).toBe(true);
  for (const v of [r.coins, s.stats.totalCoins, s.meta.yunohana.lifetime, s.meta.lastPrestigeGain]) expect(Number.isFinite(v.mantissa) && v.gte(0)).toBe(true);
  // 保存して読み直しても同じ
  expect(stateHash(decodeOk(encodeSave(s, 1, 1, 'x')).state)).toBe(stateHash(s));
}

describe('BL-028 見本の置き場所（見本は消さない）', () => {
  it('版 1 から今の版まで、どの版にも 4 種（序盤・転生前・転生後・最大状態）がある', () => {
    expect(versions).toEqual(Array.from({ length: SAVE_SCHEMA_VERSION }, (_, i) => i + 1));
    for (const v of versions) expect(readdirSync(join(ROOT, `v${v}`)).sort()).toEqual(FIXTURE_KINDS.map((k) => `${k}.json`).sort());
  });

  it('見本の封筒の schema と game の schema は、その版の番号', () => {
    for (const v of versions)
      for (const k of FIXTURE_KINDS) {
        const env = JSON.parse(read(`v${v}`, `${k}.json`)) as { schema: number; game: { schema: number } };
        expect([env.schema, env.game.schema], `v${v}/${k}`).toEqual([v, v]);
      }
  });
});

describe('BL-028 見本は上書きしない（PR #87 のレビュー S-2）', () => {
  /**
   * 見本ごとの内容のハッシュ（sha256 の先頭 16 桁。前後の空白を除いた文字列）。**行を足すのはよいが、既存の行を変えてはいけない**
   * （見本が今のコードの出力に黙って置き換わると、古いセーブを読めることの網が消える。gdd §10）
   */
  const PINNED: readonly (readonly [string, string])[] = [
    ['v1/early.json', '6bea38ab8b07d482'],
    ['v1/max.json', '90bb6e327b313865'],
    ['v1/post-prestige.json', '1f422df8fed9e759'],
    ['v1/pre-prestige.json', 'e6be8938b48d1381'],
    ['v2/early.json', 'a861803e7af4c8bd'],
    ['v2/max.json', 'a8fbe2bb7995c0a1'],
    ['v2/post-prestige.json', 'ba06b1a31398efda'],
    ['v2/pre-prestige.json', 'a6e2fd4f25e50123'],
    ['newer/schema-3.json', 'dd064f91bfbaff0e'],
  ];
  const sha = (t: string): string => createHash('sha256').update(t).digest('hex').slice(0, 16);

  it('どの見本も、固定したハッシュのとおり（置き場所にある見本はすべて表にある）', () => {
    const files = ['newer', ...versions.map((v) => `v${v}`)].flatMap((d) => readdirSync(join(ROOT, d)).map((f) => `${d}/${f}`)).sort();
    expect(files).toEqual(PINNED.map(([f]) => f).sort());
    for (const [f, h] of PINNED) expect(sha(read(...f.split('/'))), f).toBe(h);
  });

  it('道具（writeFixtures）は、ある見本に触れず、ない見本だけを書く', () => {
    const dir = mkdtempSync(join(tmpdir(), 'odr-fixtures-'));
    try {
      mkdirSync(join(dir, 'v1'), { recursive: true });
      writeFileSync(join(dir, 'v1', 'early.json'), 'SENTINEL');
      const wrote = writeFixtures(dir);
      expect(readFileSync(join(dir, 'v1', 'early.json'), 'utf8')).toBe('SENTINEL');
      expect(wrote.length).toBe(versions.length * FIXTURE_KINDS.length); // v1/early 以外の見本 ＋ newer の 1 つ
      expect(writeFixtures(dir)).toEqual([]); // 2 回目は何も書かない
      // 書いた見本は、置き場所の見本と同じ（道具の出力が今のコードで変わっていない。変わったら新しい版の見本として足すこと）
      for (const v of versions) for (const k of FIXTURE_KINDS) if (!(v === 1 && k === 'early')) expect(readFileSync(join(dir, `v${v}`, `${k}.json`), 'utf8').trim(), `v${v}/${k}`).toBe(read(`v${v}`, `${k}.json`));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('BL-028・TS-021-27・32 どの版の見本も今の版で読める', () => {
  for (const v of versions)
    for (const k of FIXTURE_KINDS)
      it(`v${v}/${k}: 補正なしで読め、不変条件を満たす`, () => {
        const { state, corrected } = decodeOk(read(`v${v}`, `${k}.json`));
        expect(corrected).toEqual([]);
        invariants(state);
      });

  it('版 1 の見本: どれにも run.pendingOffline の欄があり、少なくとも 1 つは受け取り待ち（BL-058 が版 1 のまま足した欄）。前回の獲得・始めの深さの欄はない', () => {
    const games = FIXTURE_KINDS.map((k) => (JSON.parse(read('v1', `${k}.json`)) as { game: { run: Rec; meta: Rec } }).game);
    for (const g of games) {
      expect(Object.hasOwn(g.run, 'pendingOffline')).toBe(true);
      expect(Object.hasOwn(g.meta, 'lastPrestigeGain')).toBe(false);
      expect(Object.hasOwn(g.run, 'startDepth')).toBe(false);
    }
    expect(games.some((g) => g.run.pendingOffline !== null)).toBe(true);
  });

  it('版 1 の見本を読むと、同じ状態から書いた版 2 の見本と、前回の獲得・始めの深さ・木を除いて同じ（移行は足すだけ）', () => {
    for (const k of FIXTURE_KINDS) {
      const a = toSaveGame(decodeOk(read('v1', `${k}.json`)).state) as unknown as { run: Rec; meta: Rec & { yunohana: Rec } };
      const b = toSaveGame(decodeOk(read('v2', `${k}.json`)).state) as unknown as { run: Rec; meta: Rec & { yunohana: Rec } };
      expect([a.meta.lastPrestigeGain, a.run.startDepth, a.meta.perks]).toEqual(['0', 0, []]);
      for (const g of [a, b]) {
        delete g.meta.lastPrestigeGain;
        delete g.run.startDepth;
        delete g.meta.perks;
        delete g.meta.yunohana.spent;
      }
      expect(a, k).toEqual(b);
    }
  });

  it('TS-021-32: 版 2 の転生後の見本は、前回の獲得が 0 でなく、木を取っている', () => {
    const s = decodeOk(read('v2', 'post-prestige.json')).state;
    expect(s.meta.prestiges).toBeGreaterThanOrEqual(1);
    expect(s.meta.lastPrestigeGain.gt(0)).toBe(true);
    expect(s.meta.perks.length).toBeGreaterThan(0);
  });

  it('最大状態の見本は、保存すると 200KB 以下（gdd §10）', () => {
    for (const v of versions) {
      expect(read(`v${v}`, 'max.json').length, `v${v}`).toBeLessThanOrEqual(200 * 1024);
      const s = decodeOk(read(`v${v}`, 'max.json')).state;
      expect(encodeSave(s, 1, 1, 'x').length).toBeLessThanOrEqual(200 * 1024);
    }
  });
});

describe('BL-028 移行の連鎖（版ごとの関数を順に当て、各段階で形を確かめる）', () => {
  /** 架空の版 3・4 の移行（テスト用）: 3 で meta.note を足し、4 で run.extra を足す。どの段階が当たったかを記録する */
  const calls: number[] = [];
  const fake: Record<number, MigrationStep> = {
    ...STEPS,
    2: (g) => (calls.push(2), { ...g, schema: 3, meta: { ...(g.meta as Rec), note: 'v3' } }),
    3: (g) => (calls.push(3), { ...g, schema: 4, run: { ...(g.run as Rec), extra: (g.meta as Rec).note === 'v3' ? 'from-v3' : 'missing' } }),
  };
  const v1 = (): Rec => (JSON.parse(read('v1', 'early.json')) as { game: Rec }).game;

  it('版 1 → 4: 1 → 2 → 3 → 4 の順に 1 回ずつ当たり、前の段階の結果を次が使う。入力は書き換えない', () => {
    calls.length = 0;
    const g = v1();
    const before = JSON.stringify(g);
    const out = migrateGame(g, { steps: fake, target: 4 })!;
    expect(calls).toEqual([2, 3]);
    expect([out.schema, (out.meta as Rec).lastPrestigeGain, (out.meta as Rec).note, (out.run as Rec).extra, (out.run as Rec).startDepth]).toEqual([4, '0', 'v3', 'from-v3', 0]);
    expect(JSON.stringify(g)).toBe(before);
  });

  it('途中の版から始めると、その版からだけ当たる（版 3 → 4 は 1 段）', () => {
    calls.length = 0;
    const g = { ...v1(), schema: 3, meta: { ...(v1().meta as Rec), note: 'v3' } };
    expect((migrateGame(g, { steps: fake, target: 4 })!.run as Rec).extra).toBe('from-v3');
    expect(calls).toEqual([3]);
  });

  it('段階の確かめ: 次の版の番号にならない・run や meta を壊す・例外を出す・途中の関数がない → null（読み込みは migrateFailed で読み取り専用。tests/unit/save-migrate-fail.test.ts）', () => {
    const broken: Record<string, Record<number, MigrationStep>> = {
      wrongVersion: { ...STEPS, 2: (g) => ({ ...g, schema: 2 }) },
      dropsRun: { ...STEPS, 2: (g) => ({ ...g, schema: 3, run: null }) },
      throws: {
        ...STEPS,
        2: () => {
          throw new Error('boom');
        },
      },
      gap: { ...STEPS },
    };
    for (const [name, steps] of Object.entries(broken)) expect(migrateGame(v1(), { steps, target: 3 }), name).toBeNull();
  });

  it('今の版の表（STEPS）は、版 1 から今の版まで途切れずにある', () => {
    for (let v = 1; v < SAVE_SCHEMA_VERSION; v++) expect(typeof STEPS[v], `v${v} → v${v + 1}`).toBe('function');
  });
});

describe('BL-028・TS-021-30 新しい版のセーブ（見本 tests/fixtures/saves/newer/）は上書きしない', () => {
  const newer = readdirSync(join(ROOT, 'newer'))
    .map((f) => ({ f, raw: read('newer', f) }))
    .filter(({ raw }) => (JSON.parse(raw) as { schema: number }).schema > SAVE_SCHEMA_VERSION);

  it('今の版より新しい見本がある（版を上げたら make-save-fixtures で次の版の見本が足される）', () => {
    expect(newer.length).toBeGreaterThan(0);
  });

  /** 書き込みを数える偽のストレージ */
  class CountingStore implements KeyValueStore {
    readonly kind = 'local' as const;
    readonly map = new Map<string, string>();
    sets = 0;
    get(k: string): string | null {
      return this.map.get(k) ?? null;
    }
    set(k: string, v: string): boolean {
      this.sets++;
      this.map.set(k, v);
      return true;
    }
    remove(k: string): void {
      this.map.delete(k);
    }
  }

  for (const slot of ['a', 'b'] as const)
    it(`新しい版の見本が枠 ${slot} にある: 読み取り専用で起動し、そのセッションはどの枠にも書かない（もう一方の版 2 の見本から始める）`, () => {
      for (const { f, raw } of newer) {
        const st = new CountingStore();
        st.map.set(SAVE_KEYS[slot], raw);
        st.map.set(SAVE_KEYS[slot === 'a' ? 'b' : 'a'], read('v2', 'pre-prestige.json'));
        const slots = new SaveSlots(st, { appVersion: 'x', now: () => 1 });
        const loaded = slots.load();
        expect([loaded.readOnly, loaded.slots[slot]], f).toEqual([true, 'newer']);
        expect(loaded.state?.run.maxDepth).toBeGreaterThan(0);
        for (let i = 0; i < 3; i++) expect(slots.save(loaded.state!)).toBe(false);
        expect(st.sets).toBe(0);
        expect(st.map.get(SAVE_KEYS[slot])).toBe(raw);
      }
    });

  it('新しい版の見本は、今の版から見て checksum が合わなくても newer（壊れた枠ではなく新しい版として扱い、上書きしない。M-1）', () => {
    for (const { raw } of newer) {
      const env = JSON.parse(raw) as { checksum: string; game: unknown };
      expect(env.checksum).not.toBe(checksumOf(env.game)); // game に将来の欄を足したので checksum は合わない（将来の版は計算も変えうる）
      expect(decodeSave(raw)).toEqual({ ok: false, reason: 'newer' }); // それでも newer（checksum より先に版を見る。M-1）
    }
  });
});
