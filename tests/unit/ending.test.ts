// BL-023: 伝説の源泉とエンディング（gdd §5-8）。CEO 決定 2026-11-15（D1〜D6）:
// D1 まだエンディングを見ていないまま、周回の深さが 500m 以上になったら（掘って届く・近道の坑道の始め、どちらでも）その時に 1 回だけ
// D2 読み込みでは出さない（補正しない） D3 伝説の源泉はポンプの源泉ではない D4 テスト用フックの深さの付与では黙る
import { describe, expect, it } from 'vitest';
import { PARAMS } from '../../src/content/params.ts';
import { TERRAIN_IDS, type TerrainId } from '../../src/content/terrains.ts';
import { saveReasonForEvents } from '../../src/app/autosave.ts';
import { isHappyMoment } from '../../src/app/happy-time.ts';
import { applyGrant, createInitialState, dispatch, num, step, type GameEvent, type GameState } from '../../src/core/index.ts';
import { decodeSave, encodeSave } from '../../src/save/codec.ts';
import { parseGame } from '../../src/save/schema.ts';
import { MilestoneRecorder } from '../../tools/sim/milestones.ts';
import { stateWith } from '../support/states.ts';

const E = PARAMS.ending.depth;

/** depth m の手前まで掘った強い状態（1 打で数ブロック進む） */
function digger(depth: number, terrain: TerrainId = 'mountain'): GameState {
  const s = stateWith({ seed: 7, depth, drill: 300, tool: 7, pumps: { simple: 1, co2: 1, salt: 1, sulfur: 1, iron: 1 } });
  s.run.terrain = terrain;
  strong(s);
  return s;
}

/** 深いブロックも数打で壊せるように、累計の湯の華を大きくする（全生産 +2%/個） */
function strong(s: GameState): void {
  s.meta.yunohana.lifetime = num('1e14');
  s.run.drill = { level: 300, tool: 7 };
}

/** 深さが target 以上になるまでタップとステップを繰り返し、出来事を集める */
function digTo(s: GameState, target: number): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < 10_000 && s.run.depth < target; i++) {
    out.push(...dispatch(s, { type: 'tap' }).events);
    step(s, 200, out);
  }
  return out;
}

const endings = (evs: readonly GameEvent[]) => evs.filter((e) => e.type === 'EndingReached');

describe('BL-023 掘って 500m に届いたらエンディング（セーブ全体で 1 回）', () => {
  it('TS-023-01 伝説の源泉の深さはどの地形でも 500m', () => {
    expect(E).toBe(500);
    for (const t of TERRAIN_IDS) {
      const s = digger(495, t);
      const evs = digTo(s, E + 3);
      expect(endings(evs)).toEqual([{ type: 'EndingReached', depth: E }]);
      expect(s.meta.endingSeen).toBe(true);
    }
  });

  it('TS-023-02 (a)(b) 499m では出ない。500m に届いた（500 番目のブロックを壊した）ときに出る', () => {
    // 1 打で何ブロックも進むので、出来事の並びで見る: EndingReached の直前に壊したブロックは 499m（壊すと深さ 500）
    const s = digger(490);
    const evs = digTo(s, E + 5);
    const at = evs.findIndex((e) => e.type === 'EndingReached');
    const before = evs.slice(0, at).filter((e) => e.type === 'BlockBroken');
    expect(before.at(-1)).toMatchObject({ type: 'BlockBroken', depth: E - 1 });
    expect(endings(evs)).toEqual([{ type: 'EndingReached', depth: E }]);
    // 499m に置いただけ（ブロックを壊していない）では出ない
    const t = digger(490);
    t.run.depth = E - 1;
    step(t, 1, []);
    expect(t.meta.endingSeen).toBe(false);
  });

  it('TS-023-04 2 回目以降（エンディング済み）は、500m を越えても、次の周回で届いても出ない', () => {
    const s = digger(495);
    digTo(s, 510);
    expect(endings(digTo(s, 530))).toEqual([]);
    const r = dispatch(s, { type: 'prestige' });
    expect(r.ok).toBe(true);
    expect(endings(r.events)).toEqual([]);
    strong(s);
    expect(endings(digTo(s, 505))).toEqual([]);
    expect(s.meta.endingSeen).toBe(true);
  });

  it('TS-023-08 エンディングの後も掘り続けられる（500m 以降も深さが進み、転生できる）', () => {
    const s = digger(495);
    digTo(s, 520);
    expect(s.run.depth).toBeGreaterThanOrEqual(520);
    expect(dispatch(s, { type: 'prestige' }).ok).toBe(true);
  });

  it('TS-023-07 伝説の源泉はポンプの源泉ではない（源泉・枠・入湯料を変えない。D3）', () => {
    const s = digger(495);
    const springs = JSON.stringify(s.run.springs);
    const slots = JSON.stringify(s.run.bath.slots);
    digTo(s, E + 1);
    expect(JSON.stringify(s.run.springs)).toBe(springs);
    expect(JSON.stringify(s.run.bath.slots)).toBe(slots);
  });
});

describe('BL-023 近道の坑道で 500m 以上から始まる周回（D1）', () => {
  /** 前の周回の最深 prevMax・近道の坑道を取った状態で転生する */
  function shortcutPrestige(prevMax: number, endingSeen: boolean): ReturnType<typeof dispatch> & { s: GameState } {
    const s = stateWith({ seed: 3, depth: 200 });
    s.run.maxDepth = prevMax;
    s.meta.endingSeen = endingSeen;
    s.meta.yunohana.lifetime = s.meta.yunohana.lifetime.add(1000);
    for (const p of ['sharpBlade', 'nightDig', 'shortcut'] as const) expect(dispatch(s, { type: 'takePerk', perk: p }).ok).toBe(true);
    return { ...dispatch(s, { type: 'prestige' }), s };
  }

  it('TS-023-03 (b) まだ見ていなければ、周回の始めに 1 回だけ出す（始めの深さで。M1 の機会の前＝UI は M1 の後にカード）', () => {
    const { ok, events, s } = shortcutPrestige(2400, false); // 2400 × 25% = 600m から
    expect(ok).toBe(true);
    expect(s.run.depth).toBe(600);
    expect(endings(events)).toEqual([{ type: 'EndingReached', depth: 600 }]);
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('PrestigeDone');
    expect(types.indexOf('EndingReached')).toBeLessThan(types.indexOf('BreakOpportunity'));
    expect(types.at(-1)).toBe('BreakOpportunity');
    expect(s.meta.endingSeen).toBe(true);
    expect(saveReasonForEvents(events)).toBe('prestige'); // 転生と同じ保存で印も残る
  });

  it('TS-023-03 (a) 始めの深さがちょうど 500m（前の最深 2000m）でも出す', () => {
    const { events, s } = shortcutPrestige(2000, false);
    expect(s.run.depth).toBe(500);
    expect(endings(events)).toEqual([{ type: 'EndingReached', depth: 500 }]);
  });

  it('TS-023-04 見ていれば出さない（ほかの源泉と同じく黙って届いた扱い）', () => {
    const { ok, events } = shortcutPrestige(2400, true);
    expect(ok).toBe(true);
    expect(endings(events)).toEqual([]);
  });

  it('TS-023-03 (c) 始めの深さが 499m（前の最深 1996m）なら出さず、500m に届いたときに出す', () => {
    const { events, s } = shortcutPrestige(1996, false);
    expect(s.run.depth).toBe(499);
    expect(endings(events)).toEqual([]);
    strong(s);
    expect(endings(digTo(s, E))).toEqual([{ type: 'EndingReached', depth: E }]);
  });
});

describe('BL-023 読み込み・テスト用フックでは出さない（D2・D4）', () => {
  it('TS-023-05 (a) 最深 500m 以上でエンディング未見のセーブ（BL-023 より前）: 補正なしで読め、印は立てない。次に周回で届いたときに出る', () => {
    const s = createInitialState(4);
    s.stats.bestDepth = 640;
    const r = decodeSave(encodeSave(s, 1, 1_790_000_000_000, 'test'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.corrected).toEqual([]);
    expect(r.state.meta.endingSeen).toBe(false);
  });

  it('TS-023-05 (b) 周回の途中で 500m を越えている（520m）未見のセーブ: 読み込みでは出さず、次の 1 ブロックで出す（Q-55 (b)）', () => {
    const s = createInitialState(4);
    s.run.depth = 520;
    s.run.maxDepth = 520;
    s.stats.bestDepth = 520;
    const r = decodeSave(encodeSave(s, 1, 1_790_000_000_000, 'test'));
    expect(r.ok && r.corrected).toEqual([]);
    if (!r.ok) return;
    expect(r.state.meta.endingSeen).toBe(false);
    strong(r.state);
    expect(endings(digTo(r.state, 521))).toEqual([{ type: 'EndingReached', depth: 521 }]);
  });

  it('TS-023-18 セーブの endingSeen が型違い・欄なしなら false。true と浅い最深の組は、そのまま読む（例外なし）', () => {
    for (const v of ['yes', 1, null, undefined]) {
      const s = createInitialState(4);
      const raw = JSON.parse(encodeSave(s, 1, 1_790_000_000_000, 'test')) as { game: { meta: Record<string, unknown> } };
      if (v === undefined) delete raw.game.meta.endingSeen;
      else raw.game.meta.endingSeen = v;
      const r = parseGame(raw.game); // 書き換えた game を検証・補正で読む（封筒の checksum は見ない）
      expect(r.ok && r.state.meta.endingSeen, String(v)).toBe(false);
    }
    const s = createInitialState(4);
    s.meta.endingSeen = true;
    s.stats.bestDepth = 120;
    const r = decodeSave(encodeSave(s, 1, 1_790_000_000_000, 'test'));
    expect(r.ok && [r.corrected, r.state.meta.endingSeen]).toEqual([[], true]);
  });

  it('TS-023-06 applyGrant で 600m にしても出さない。次の 1 ブロックを壊したときに出る（E2E は「付与して 1 打」で出せる）', () => {
    const s = createInitialState(9);
    const out = applyGrant(s, { depth: 600 });
    expect(endings(out)).toEqual([]);
    expect(s.meta.endingSeen).toBe(false);
    strong(s);
    const evs = digTo(s, 601);
    expect(endings(evs)).toEqual([{ type: 'EndingReached', depth: 601 }]);
  });
});

describe('BL-023 app 側: すぐ保存・祝いの合図・シミュレーターの #13', () => {
  it('TS-023-13 (a) EndingReached はすぐ保存する（理由 ending）。転生と一緒なら prestige', () => {
    expect(saveReasonForEvents([{ type: 'EndingReached', depth: 500 }])).toBe('ending');
    expect(saveReasonForEvents([{ type: 'PrestigeDone', gained: '9e0' }, { type: 'EndingReached', depth: 600 }])).toBe('prestige');
    expect(saveReasonForEvents([{ type: 'BlockBroken', depth: 499, ore: null, coins: '1e0' }])).toBeNull();
  });

  it('TS-023-15 (a) EndingReached は祝いの合図（happytime）を送る場面', () => {
    expect(isHappyMoment({ type: 'EndingReached', depth: 500 }, createInitialState(1))).toBe(true);
  });

  it('TS-023-17 #13 はエンディングの出来事の時刻（最深 500m の状態ではなく）', () => {
    const rec = new MilestoneRecorder();
    const s = createInitialState(1);
    s.stats.bestDepth = 600; // 状態だけでは記録しない
    rec.observeState(s);
    expect(rec.at.ending).toBeUndefined();
    rec.observe([{ type: 'EndingReached', depth: 500 }], 12_345);
    expect(rec.at.ending).toBe(12_345);
  });
});
