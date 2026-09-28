// 道具の見た目（arch §14。BL-036）。段ごとに違うテクスチャのキー。ToolEvolved で差し替える。Phaser に依存しない

/** 段 0〜7 のテクスチャのキー（アトラスの id。content/tools.ts の順番） */
export const TOOL_FRAMES = [
  'tool-shovel',
  'tool-pickaxe',
  'tool-yagura',
  'tool-boring',
  'tool-bigdrill',
  'tool-geodrill',
  'tool-giantdrill',
  'tool-legenddrill',
] as const;

/** 道具の段 → テクスチャのキー（範囲外は端に丸める） */
export function toolTexture(tool: number): string {
  const i = Number.isFinite(tool) ? Math.min(TOOL_FRAMES.length - 1, Math.max(0, Math.floor(tool))) : 0;
  return TOOL_FRAMES[i] ?? TOOL_FRAMES[0];
}

/** 振って掘る道具（スコップ・ツルハシ・手掘りやぐら）か。ドリルは振らずに震わせる */
export const toolSwings = (tool: number): boolean => tool <= 2;

/** ToolEvolved を受けて道具のスプライトのテクスチャを差し替える（同じなら何もしない） */
export function applyToolTexture(sprite: { frame: { name: string }; setFrame(f: string): unknown }, tool: number): boolean {
  const f = toolTexture(tool);
  if (sprite.frame.name === f) return false;
  sprite.setFrame(f);
  return true;
}
