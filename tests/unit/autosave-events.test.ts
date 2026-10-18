// BL-021: 転生の完了ですぐ保存する（src/app/autosave.ts の saveReasonForEvents。main.ts が store.onEvents で saveNow に渡す）
import { describe, expect, it } from 'vitest';
import { saveReasonForEvents, startAutosave, type SaveReason } from '../../src/app/autosave.ts';
import { dispatch, type GameState } from '../../src/core/index.ts';
import { stateWith } from '../support/states.ts';

describe('BL-021 転生の後の保存', () => {
  it('PrestigeDone を含む出来事の列は prestige、含まなければ null', () => {
    const s = stateWith({ depth: 160 });
    const r = dispatch(s, { type: 'prestige' });
    expect(r.ok).toBe(true);
    expect(saveReasonForEvents(r.events)).toBe('prestige');
    expect(saveReasonForEvents([])).toBeNull();
    expect(saveReasonForEvents(dispatch(stateWith({ coins: 100 }), { type: 'buy', item: 'drill', qty: 1 }).events)).toBeNull();
  });

  it('saveNow(prestige) は転生した後の状態を書く（録画モードなどで止めているときは書かない）', () => {
    const s = stateWith({ depth: 160 });
    const saved: GameState[] = [];
    const reasons: SaveReason[] = [];
    let suppressed = false;
    const timers = { setInterval: () => 0, clearInterval: () => undefined };
    const auto = startAutosave({
      slots: { save: (st) => (saved.push(structuredClone(st)), true), status: 'ok' },
      getState: () => s,
      win: new EventTarget(),
      doc: new EventTarget(),
      timers,
      isSuppressed: () => suppressed,
      onSave: (r) => reasons.push(r),
    });
    const r = dispatch(s, { type: 'prestige' });
    const reason = saveReasonForEvents(r.events);
    expect(reason).toBe('prestige');
    expect(auto.saveNow(reason!)).toBe(true);
    expect(reasons).toEqual(['prestige']);
    expect(saved[0]?.meta.prestiges).toBe(1);
    expect(saved[0]?.run.maxDepth).toBe(0);
    suppressed = true;
    expect(auto.saveNow('prestige')).toBe(false);
    expect(saved).toHaveLength(1);
    auto.dispose();
  });
});
