// UI・描画用の派生値（arch §5: view が import してよい core の入口）。状態を読むだけで、書き換えない
import { temperatureAt } from './formulas.ts';
import type { GameState } from './state.ts';

export { bandOfDepth, temperatureAt } from './formulas.ts';

/** 今の深さの地温（表示用の ℃ の整数。HUD の深さの横） */
export const temperatureOf = (s: Readonly<GameState>): number => temperatureAt(s.run.depth);
