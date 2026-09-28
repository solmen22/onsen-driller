// build:web の最後に deploy/web/_headers を dist/web/ へコピーする（他のビルドには入れない。infra.md 付録 B-2）
import { copyFileSync } from 'node:fs';
copyFileSync('deploy/web/_headers', 'dist/web/_headers');
console.log('copied deploy/web/_headers -> dist/web/_headers');
