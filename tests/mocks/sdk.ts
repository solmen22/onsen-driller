// ポータル SDK のモックの S1 からの置き場所。**本体は e2e/mocks/**（BL-072。arch §4・QA §4-2。確認事項 Q-28 の決定）。
// BL-057 のブランチ（tests/integration/crazygames-save.test.ts）がこのパスを import しているので、再 export として残す。
// BL-057 のマージの後に、import を e2e/mocks/ に替えてこのファイルを消す（実行・修復エンジニア）
export { crazyMock, createCrazyMock, type CgAdBehavior, type CrazyMock, type CrazyMockConfig } from '../../e2e/mocks/crazygames.ts';
export { pokiMock, type PokiMock } from '../../e2e/mocks/poki.ts';
