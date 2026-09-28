// BL-043: 購入ボタンの表示（ui/panels/buy-view.ts）と実際の購入の一致（TS-043-09。QA §3-2(c)）。
// ランダムなコイン・レベルで、表示の数とコストが、実際に買える数と差し引かれる額に一致することを確かめる（表示と購入は同じ buyQuote）
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dispatch, num, stateHash, sub, type ItemId, type Qty } from '../../src/core/index.ts';
import { buyView } from '../../src/ui/panels/buy-view.ts';
import { stateWith } from '../support/states.ts';

const levelOf = (s: ReturnType<typeof stateWith>, item: ItemId): number =>
  item === 'drill' ? s.run.drill.level : item === 'autoDigger' ? s.run.autoDig.level : s.run.drill.tool;

describe('表示と購入の一致（TS-043-09）', () => {
  it('ドリル・自動掘削機・道具 × ×1・×10・最大: 買えると表示したら表示の数だけ上がり表示のコストだけ減る。買えないと表示したら状態は変わらない', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ItemId>('drill', 'autoDigger', 'tool'),
        fc.constantFrom<Qty>(1, 10, 'max'),
        fc.double({ min: 0, max: 1e12, noNaN: true }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 0, max: 7 }),
        fc.integer({ min: 0, max: 450 }),
        (item, qty, coins, level, tool, maxDepth) => {
          const s = stateWith({ coins, drill: level, digger: level, tool, maxDepth });
          const v = buyView(s, item, qty, 'en');
          const before = s.run.coins;
          const lv0 = levelOf(s, item);
          const h0 = stateHash(s);
          const r = dispatch(s, { type: 'buy', item, qty });
          if (v.state === 'affordable') {
            expect(r.ok).toBe(true);
            expect(levelOf(s, item) - lv0).toBe(item === 'tool' ? 1 : v.n);
            // 購入後の所持金 ＝ 購入前 − 表示のコスト（同じ Decimal。所持金は負にならない）
            expect(s.run.coins.eq(sub(before, num(v.cost)))).toBe(true);
            expect(s.run.coins.gte(0)).toBe(true);
          } else {
            expect(r.ok).toBe(false);
            expect(r.reason).toBe(v.state);
            expect(stateHash(s)).toBe(h0);
          }
          // 表示の決まりごと: 「×0」は出さない・足りないときだけ目安・未解放のときだけ条件
          expect(v.showQty ? v.n > 0 : true).toBe(true);
          expect(v.eta !== null).toBe(v.state === 'insufficient');
          expect(v.unlockDepth !== null).toBe(v.state === 'locked');
        },
      ),
      { numRuns: 400 },
    );
  });
});
