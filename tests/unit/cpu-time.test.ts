// BL-118: tests/support/cpu-time.ts の自己テスト（QA の記録 2026-10-05_pr36-record-and-timing.md §2 の条件 1〜3。偽の緑を防ぐ）
import { describe, expect, it } from 'vitest';
import { defaultCpuReader, measure, measureOnce, medianOf, type CpuReader } from '../support/cpu-time.ts';

/** 呼ばれるたびに決まった値を返す CPU の読み取り（ms） */
const fakeReader = (values: number[]): CpuReader => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
};
/** 実時間で約 ms だけ回る（CPU を使う） */
const spin = (ms: number): void => {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // 何もしない
  }
};

describe('BL-118 CPU 時間で測る共通の関数', () => {
  it('CPU の差 ÷ 回数で判定する（条件 1）', () => {
    const t = measure('self-test cpu', 5, () => undefined, fakeReader([100, 350]));
    expect(t).toMatchObject({ method: 'cpu', ms: 50, cpuMeanMs: 50 });
  });
  it('CPU の合計が 0 なら CPU では合格にせず、実時間の中央値で判定する（条件 2）', () => {
    const t = measure('self-test zero', 3, () => spin(20), fakeReader([7, 7]));
    expect(t.method).toBe('wall');
    expect(t.cpuMeanMs).toBe(0);
    expect(t.ms).toBe(t.wallMedianMs);
    expect(t.ms).toBeGreaterThanOrEqual(19);
  });
  it('threadCpuUsage がない（読み取りが null）なら実時間の中央値で判定する（条件 2）', () => {
    const t = measure('self-test none', 3, () => spin(5), null);
    expect(t).toMatchObject({ method: 'wall', cpuMeanMs: null });
    expect(t.ms).toBe(t.wallMedianMs);
  });
  // 中央値は純粋な関数で数値を確かめる（実時間で回すと、強い負荷の下で OS の待ちが入って揺れる。PR #44 のレビューの Nit 1。BL-129）
  it('実時間の中央値は真ん中の回（5 回なら 3 番目。偶数個は真ん中の 2 つの小さいほう。空は +∞）', () => {
    expect(medianOf([1, 30, 2, 25, 3])).toBe(3);
    expect(medianOf([9])).toBe(9);
    expect(medianOf([4, 1, 3, 2])).toBe(2);
    expect(medianOf([])).toBe(Number.POSITIVE_INFINITY);
    const input = [5, 1, 4];
    medianOf(input);
    expect(input, '入力の配列を並べ替えない').toEqual([5, 1, 4]);
  });
  it('measure の実時間の中央値は medianOf で求める（読み取りなし → 実時間で判定）', () => {
    const t = measure('self-test median', 3, () => undefined, null);
    expect(t.wallMedianMs).toBeGreaterThanOrEqual(0);
    expect(t.ms).toBe(t.wallMedianMs);
  });
  it('measure・measureOnce に Promise（thenable）を返す関数を渡すと例外で止まる（最初の await までしか測らない偽の緑を防ぐ。BL-129）', async () => {
    const asyncBody = async (): Promise<void> => {
      await Promise.resolve();
      spin(60);
    };
    expect(() => measure('self-test async', 5, asyncBody, fakeReader([0, 1]))).toThrow(/Promise（thenable）/);
    expect(() => measureOnce('self-test async once', () => asyncBody(), fakeReader([0, 1]))).toThrow(/Promise（thenable）/);
    // then を持つだけのもの（thenable）も止める。ふつうの値・null・関数は止めない
    expect(() => measureOnce('self-test thenable', () => ({ then: () => undefined }), fakeReader([0, 1]))).toThrow(TypeError);
    expect(measureOnce('self-test object', () => ({ ok: 1 }), fakeReader([0, 1])).value).toEqual({ ok: 1 });
    expect(measureOnce('self-test null', () => null, fakeReader([0, 1])).value).toBeNull();
  });
  it('measureOnce は戻り値を返す', () => {
    const { value, timing } = measureOnce('self-test once', () => 42, fakeReader([0, 16]));
    expect(value).toBe(42);
    expect(timing).toMatchObject({ method: 'cpu', ms: 16 });
  });
  it('この Node では threadCpuUsage で測れ、CPU を 60ms 使い切る処理は CPU の方式で 50ms を超える（PC の負荷に左右されない）', () => {
    const read = defaultCpuReader;
    expect(read, 'Node 24 には process.threadCpuUsage がある（.nvmrc）').not.toBeNull();
    if (!read) return;
    const t = measure('self-test spin', 1, () => {
      const start = read();
      while (read() - start < 60) {
        // このスレッドの CPU 時間で 60ms 使うまで回る
      }
    });
    expect(t.method).toBe('cpu');
    expect(t.ms).toBeGreaterThan(50);
  });
});
