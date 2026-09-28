// zzfx 1.3.2 には型定義がないので、使う部分だけを宣言する
declare module 'zzfx' {
  export function zzfx(...params: number[]): AudioBufferSourceNode;
  export const ZZFX: { volume: number; audioContext: AudioContext };
}
