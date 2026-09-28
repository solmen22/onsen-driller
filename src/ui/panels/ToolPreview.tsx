// 道具の見た目のプレビュー（gdd §11-2 の T1「見た目のプレビュー」。BL-043）: 描画と同じアトラスの 1 コマを DOM で整数倍に拡大して出す。
// コマの名前は描画（view/tools.ts）と同じ規則 tool-<ID の英小文字>（例 bigDrill → tool-bigdrill）
import atlasPng from '../../generated/atlas.png?url';
import atlasJson from '../../generated/atlas.json';

interface Frame {
  frame: { x: number; y: number; w: number; h: number };
}
const FRAMES = atlasJson.frames as Record<string, Frame | undefined>;
const SHEET = atlasJson.meta.size;

/** 道具の ID → アトラスのコマの名前 */
export const toolFrameName = (toolId: string): string => `tool-${toolId.toLowerCase()}`;

export function ToolPreview({ toolId, scale = 2 }: { toolId: string; scale?: number }) {
  const f = FRAMES[toolFrameName(toolId)]?.frame;
  if (!f) return null;
  return (
    <span
      class="tool-preview"
      data-tool={toolId}
      aria-hidden="true"
      style={{
        width: `${f.w * scale}px`,
        height: `${f.h * scale}px`,
        backgroundImage: `url(${atlasPng})`,
        backgroundSize: `${SHEET.w * scale}px ${SHEET.h * scale}px`,
        backgroundPosition: `${-f.x * scale}px ${-f.y * scale}px`,
      }}
    />
  );
}
