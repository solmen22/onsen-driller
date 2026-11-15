// BL-071: 直近のエラーの記録（app/errors.ts。フックの errors()）。ブラウザの代わりに Node の EventTarget で確かめる（TS-071-19 の Node 版）
import { describe, expect, it } from 'vitest';
import { GameStore } from '../../src/app/store.ts';
import { captureErrors, createErrorLog, describeError, ERROR_TEXT_MAX, ERRORS_KEEP, storeErrorHandler } from '../../src/app/errors.ts';
import { createInitialState } from '../../src/core/index.ts';

/** window の error・unhandledrejection に似たイベント */
function errorEvent(error: unknown, message = ''): Event {
  const e = new Event('error');
  Object.defineProperties(e, { error: { value: error }, message: { value: message } });
  return e;
}
function rejectionEvent(reason: unknown): Event {
  const e = new Event('unhandledrejection');
  Object.defineProperty(e, 'reason', { value: reason });
  return e;
}

describe('describeError', () => {
  it('Error は「名前: メッセージ」、文字列はそのまま、ほかは String()', () => {
    expect(describeError(new TypeError('bad'))).toBe('TypeError: bad');
    expect(describeError('plain')).toBe('plain');
    expect(describeError(42)).toBe('42');
    expect(describeError(null)).toBe('null');
  });
  it('String() が例外を投げる値でも落ちない。長い文字列は切り詰める', () => {
    const evil = {
      toString() {
        throw new Error('no');
      },
    };
    expect(describeError(evil)).toBe('(unprintable error)');
    expect(describeError('x'.repeat(ERROR_TEXT_MAX * 2)).length).toBe(ERROR_TEXT_MAX);
  });
});

describe('createErrorLog', () => {
  it(`直近の ${ERRORS_KEEP} 件だけを古い順に残し、list は複製を返す`, () => {
    const log = createErrorLog();
    for (let i = 0; i < 25; i++) log.push(new Error(`e${i}`));
    const list = log.list();
    expect(list).toHaveLength(ERRORS_KEEP);
    expect(list[0]).toBe('Error: e5');
    expect(list.at(-1)).toBe('Error: e24');
    list.length = 0;
    expect(log.list()).toHaveLength(ERRORS_KEEP);
  });
});

describe('captureErrors', () => {
  it('error（捕まえなかった例外）と unhandledrejection を記録し、解除すると記録しない', () => {
    const win = new EventTarget();
    const log = createErrorLog();
    const off = captureErrors(win, log);
    win.dispatchEvent(errorEvent(new Error('x1')));
    win.dispatchEvent(rejectionEvent(new Error('x2')));
    win.dispatchEvent(errorEvent(null, 'Script error.')); // 別オリジンのスクリプトは message だけ
    expect(log.list()).toEqual(['Error: x1', 'Error: x2', 'Script error.']);
    off();
    win.dispatchEvent(errorEvent(new Error('x3')));
    expect(log.list()).toHaveLength(3);
  });
});

describe('storeErrorHandler（BL-092 の Q-29。TS-010-11）', () => {
  it('購読者が投げた例外を errors() に 1 件残し、console 側（out）にも出す。ほかの購読者には通知が届く', () => {
    const log = createErrorLog();
    const out: unknown[] = [];
    const store = new GameStore(createInitialState(1), { onError: storeErrorHandler(log, (e) => out.push(e)) });
    let other = 0;
    store.subscribe(() => {
      throw new Error('boom');
    });
    store.subscribe(() => {
      other++;
    });
    store.notify();
    expect(log.list()).toEqual(['Error: boom']);
    expect(out).toHaveLength(1);
    expect(other).toBe(1);
  });
});
