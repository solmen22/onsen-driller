// セーブの見本を書く（BL-028）。使い方: node tools/fixtures/make-save-fixtures.ts
// ない見本だけを書く（見本は消さない・上書きしない。gdd §10）。版を上げたら、新しい版のディレクトリが増える。
// 上書きしないことは tests/unit/save-fixtures.test.ts が、一時のディレクトリで writeFixtures を流して確かめる（PR #87 のレビュー S-2）
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SAVE_SCHEMA_VERSION } from '../../src/save/schema.ts';
import { envelopeNewer, envelopeV1, envelopeV2, FIXTURE_KINDS, fixtureStates, type FixtureKind } from './save-fixtures.ts';

/** root（tests/fixtures/saves）の下に、ない見本だけを書く。書いたファイルのパスを返す（あるファイルには触れない） */
export function writeFixtures(root: string): string[] {
  const states = fixtureStates();
  const writers: Record<number, (kind: FixtureKind, seq: number) => string> = {
    1: (k, seq) => envelopeV1(states[k], seq),
    2: (k, seq) => envelopeV2(states[k], seq),
  };
  if (!writers[SAVE_SCHEMA_VERSION]) throw new Error(`版 ${SAVE_SCHEMA_VERSION} の見本の書き方がない（writers に足す）`);
  const wrote: string[] = [];
  const put = (path: string, text: string): void => {
    if (existsSync(path)) return; // 見本は上書きしない（gdd §10）
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${text}\n`);
    wrote.push(path);
  };
  for (const [v, write] of Object.entries(writers))
    FIXTURE_KINDS.forEach((k, i) => {
      put(resolve(root, `v${v}`, `${k}.json`), write(k, i + 1));
    });
  put(resolve(root, 'newer', `schema-${SAVE_SCHEMA_VERSION + 1}.json`), envelopeNewer(states['post-prestige'], SAVE_SCHEMA_VERSION + 1));
  return wrote;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const wrote = writeFixtures(resolve(dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/saves'));
  for (const p of wrote) console.log(`wrote ${p}`);
  console.log(`save fixtures: ${wrote.length} written (existing files kept)`);
}
