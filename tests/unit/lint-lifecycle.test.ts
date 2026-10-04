// BL-057（PR #16 のレビュー Nit 1）: ポータルへの loading・gameplay の合図を呼ぶのは app/lifecycle.ts だけ、の lint の規則が効くこと。
// lint-rules.test.ts と同じく ESLint の Node API に仮のパスを渡す（型情報の規則は仮のファイルでは動かないので外す）
import { ESLint } from 'eslint';
import tseslint from 'typescript-eslint';
import { beforeAll, describe, expect, it } from 'vitest';

let eslint: ESLint;
beforeAll(() => {
  eslint = new ESLint({
    cwd: process.cwd(),
    overrideConfig: [{ files: ['**/*.{ts,tsx}'], ...tseslint.configs.disableTypeChecked }],
  });
});

async function ruleIds(filePath: string, code: string): Promise<string[]> {
  const [r] = await eslint.lintText(code, { filePath });
  if (!r) throw new Error('no result');
  return r.messages.map((m) => m.ruleId ?? `fatal:${m.message}`);
}

const SIGNALS = ['loadingStart', 'loadingStop', 'gameplayStart', 'gameplayStop'];

describe('合図の直接の呼び出しを止める（src/app・ui・view）', () => {
  for (const file of ['src/app/__fixture__.ts', 'src/ui/__fixture__.tsx', 'src/view/__fixture__.ts'])
    for (const name of SIGNALS)
      for (const code of [`declare const platform: Record<string, () => void>;\nplatform.${name}();`, `declare const ctx: { platform: Record<string, () => void> };\nctx.platform.${name}();`])
        it(`${file}: ${code.split('\n')[1]}`, async () => {
          expect(await ruleIds(file, code)).toContain('no-restricted-syntax');
        });
});

describe('許すもの（誤検出がない）', () => {
  it('main.ts の life.loadingStart()・life.loadingStop()（ライフサイクルそのもの）', async () => {
    const code = 'declare const life: Record<string, (...a: unknown[]) => void>;\nlife.loadingStart();\nlife.loadingStop();\nlife.setPaused("ad", true);';
    expect(await ruleIds('src/app/__fixture__.ts', code)).toEqual([]);
  });
  it('app/lifecycle.ts と platform の中（アダプタ）', async () => {
    const code = 'declare const p: Record<string, () => void>;\np.gameplayStart();\np.loadingStart();';
    expect(await ruleIds('src/app/lifecycle.ts', code)).toEqual([]);
    expect(await ruleIds('src/platform/__fixture__.ts', code)).toEqual([]);
  });
  it('core・save の決定論の規則（同じ no-restricted-syntax）は上書きされず、今までどおり効く', async () => {
    expect(await ruleIds('src/core/__fixture__.ts', "export const a = Math['random']();")).toContain('no-restricted-syntax');
    expect(await ruleIds('src/save/__fixture__.ts', 'const m = Math;\nexport const a = m.floor(1);')).toContain('no-restricted-syntax');
  });
});
