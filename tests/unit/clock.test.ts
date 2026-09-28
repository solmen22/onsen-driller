// BL-009: 時計の注入（TS-009-14・16）。core は時刻と乱数を自分で読まない
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClock, systemClock } from '../../src/app/clock.ts';
import { advance, createInitialState, dispatch, step, stateHash } from '../../src/core/index.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TS-009-14 core は Date.now・performance.now・Math.random を呼ばない', () => {
  it('呼ばれたら例外を投げる状態で、step・dispatch・advance を 10 分ぶん動かしても例外が出ない', () => {
    const s = createInitialState(7);
    vi.spyOn(Date, 'now').mockImplementation(() => {
      throw new Error('Date.now called');
    });
    vi.spyOn(performance, 'now').mockImplementation(() => {
      throw new Error('performance.now called');
    });
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random called');
    });
    expect(() => {
      dispatch(s, { type: 'hold', on: true });
      for (let i = 0; i < 600; i++) {
        dispatch(s, { type: 'tap', count: 1 });
        dispatch(s, { type: 'buy', item: 'drill', qty: 'max' });
        dispatch(s, { type: 'buy', item: 'tool', qty: 1 });
        dispatch(s, { type: 'setAutoDig', on: true });
        step(s, 100);
        advance(s, 900);
      }
    }).not.toThrow();
    expect(s.run.depth).toBeGreaterThan(0);
  });

  it('偽の時計の値を変えても、同じシード・同じ入力なら同じ結果（TS-009-15。S1 の範囲）', () => {
    const run = (wall: number): string => {
      const clock = createFakeClock(wall, 0);
      const s = createInitialState(3);
      for (let i = 0; i < 100; i++) {
        clock.advance(100);
        dispatch(s, { type: 'tap', count: 1 });
        step(s, 100);
      }
      return stateHash(s);
    };
    expect(run(Date.UTC(2026, 0, 1))).toBe(run(Date.UTC(2030, 5, 1)));
  });
});

describe('TS-009-16 本番の時計と偽の時計', () => {
  it('systemClock は Date.now と performance.now を返し、monoNow は減らない', () => {
    const a = systemClock.monoNow();
    const w = systemClock.wallNow();
    expect(Math.abs(w - Date.now())).toBeLessThan(1000);
    expect(systemClock.monoNow()).toBeGreaterThanOrEqual(a);
  });
  it('偽の時計は advance で両方が進み、setWall で壁時計だけが変わる', () => {
    const c = createFakeClock(1000, 5);
    c.advance(250);
    expect([c.wallNow(), c.monoNow()]).toEqual([1250, 255]);
    c.setWall(99);
    expect([c.wallNow(), c.monoNow()]).toEqual([99, 255]);
    c.advance(-5);
    expect(c.monoNow()).toBe(255);
  });
});
