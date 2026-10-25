// BL-021・Q-47 (j): 転生の確認の画面を開いている間は止める（app が購読してループと 'prestige' の理由を決める）。ここでは開閉の数え方を確かめる
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dismissPrestigeConfirm, isPrestigeConfirmOpen, onPrestigeConfirmChange, openPrestigeConfirm } from '../../src/ui/overlay/prestige-confirm.ts';

describe('BL-021 転生の確認の画面の開閉（Q-47 (j)）', () => {
  it('開くと true、閉じると false を 1 回ずつ知らせる。閉じる関数を 2 回呼んでも 1 回と数える。重ねて開いたら最後に閉じたときだけ false', () => {
    const seen: boolean[] = [];
    const off = onPrestigeConfirmChange((o) => seen.push(o));
    try {
      expect(isPrestigeConfirmOpen()).toBe(false);
      const close = openPrestigeConfirm();
      expect(isPrestigeConfirmOpen()).toBe(true);
      close();
      close();
      expect(isPrestigeConfirmOpen()).toBe(false);
      expect(seen).toEqual([true, false]);
      const a = openPrestigeConfirm();
      const b = openPrestigeConfirm();
      a();
      expect(isPrestigeConfirmOpen()).toBe(true);
      b();
      expect(seen).toEqual([true, false, true, false]);
    } finally {
      off();
    }
    openPrestigeConfirm()(); // 購読をやめた後は知らせない
    expect(seen).toHaveLength(4);
  });

  it('タブが隠れたら（dismissPrestigeConfirm）開いている確認の画面をすべて閉じ、UI に onDismiss で知らせる（決定 0010 の 14 (b)）。閉じた後の閉じる関数は何もしない', () => {
    const seen: boolean[] = [];
    const off = onPrestigeConfirmChange((o) => seen.push(o));
    const dismissed: string[] = [];
    try {
      const closeA = openPrestigeConfirm(() => dismissed.push('a'));
      openPrestigeConfirm(() => dismissed.push('b'));
      dismissPrestigeConfirm();
      expect(isPrestigeConfirmOpen()).toBe(false);
      expect(dismissed).toEqual(['a', 'b']);
      expect(seen).toEqual([true, false]);
      closeA();
      dismissPrestigeConfirm(); // 開いていなければ何もしない
      expect(seen).toEqual([true, false]);
      expect(dismissed).toEqual(['a', 'b']);
    } finally {
      off();
    }
  });
});

/** src の下の .ts・.tsx をすべて読む */
function srcFiles(dir = 'src'): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...srcFiles(p));
    else if (/\.tsx?$/.test(e.name)) out.push({ path: p.replaceAll('\\', '/'), text: readFileSync(p, 'utf8') });
  }
  return out;
}

describe('TS-021-39（確認の画面の分）: 止まる理由の書き手は 1 か所', () => {
  it("setPaused('prestige', …) を書くのは app/ad-flow.ts だけ。ほかの理由も決まった 1 ファイル（hidden・interlude は main.ts、ad・break は ad-flow.ts）", () => {
    const writers = (reason: string): string[] =>
      srcFiles()
        .filter((f) => f.path !== 'src/app/lifecycle.ts' && new RegExp(`setPaused\\(\\s*'${reason}'`).test(f.text))
        .map((f) => f.path);
    expect(writers('prestige')).toEqual(['src/app/ad-flow.ts']);
    expect(writers('ad')).toEqual(['src/app/ad-flow.ts']);
    expect(writers('break')).toEqual(['src/app/ad-flow.ts']);
    expect(writers('hidden')).toEqual(['src/app/main.ts']);
    expect(writers('interlude')).toEqual(['src/app/main.ts']);
  });
});
