// nightly.yml の gate ジョブ: 毎晩の E2E を、この回に流すかを決める（DevOps。決定 0010 の 12・QA 2026-10-18 §2-1 の条件 1〜3）
//
// 決め方（schedule のときだけ。手動実行〔workflow_dispatch〕は常に流す）
//   1. 頻度: schedule は 2 本の cron（CRON_TWICE_WEEKLY＝月・木、CRON_OTHER_DAYS＝それ以外の 5 日）。github.event.schedule が
//      CRON_OTHER_DAYS の回は、リポジトリが**公開のときだけ**流す。非公開（または可視性が分からない）なら流さない。
//      → 公開中は毎日、非公開の間は月・木だけ。可視性はこの回の実行時に API（GET /repos/{repo} の private）で読む。読めなければ
//        github.event.repository.private（EVENT_PRIVATE）、それもなければ非公開として扱う（分数を使わない側に倒す）。手作業は要らない。
//        ただし schedule のイベントにはペイロードがない（公式の文書で「Not applicable」）ので、schedule の回の EVENT_PRIVATE は空の
//        見込み。そのときは API が読めなければ非公開として扱う（2 段目のイベントの値が効くのは手動実行のときだけ。PR #66 のレビュー N-1）。
//   2. 変更: この回の SHA（main の先頭）で、毎晩の E2E が**成功済み**なら流さない。`head_sha=<この SHA>` で絞った成功した run を
//      全ページ（最大 MAX_PAGES）読み、古い順に jobs を見る。成功は「e2e-nightly ジョブが success で、E2E の step〔E2E_STEP_RE〕が
//      success」の run だけ（gate だけの回〔E2E が skip〕・赤の回は数えない）。SHA で絞るので、gate だけの回が何件積み上がっても・
//      別のブランチの手動実行が後から入っても、判定が変わらない（PR #66 のレビュー S-1）。古い順に見るのは、同じ SHA の成功は
//      ふつう最初の数件にあり、後は gate だけの回が続くため（jobs の呼び出しを少なくする）。
//      読めないとき・見つからないときは流す（証拠を欠かない側に倒す）。
//
// 出力: GITHUB_OUTPUT に run=true|false。理由は標準出力と GITHUB_STEP_SUMMARY。決められないときも終了コードは 0（gate の赤で
// 毎晩全体を赤にしない）。読めなかったことは ::warning:: で残す。
// 依存は node: の組み込みだけ（npm ci をしないジョブで、トークンつきで動くため。test:checks が検査する）。
//
// 環境変数: GITHUB_API_URL・GITHUB_REPOSITORY・GITHUB_EVENT_NAME・GITHUB_SHA・GITHUB_OUTPUT・GITHUB_STEP_SUMMARY（Actions が渡す）、
//   GH_TOKEN（github.token。actions: read）、EVENT_SCHEDULE（github.event.schedule）、EVENT_PRIVATE（github.event.repository.private）
// 自己テスト: npm run test:checks（scripts/check-selftest.mjs。偽の API サーバーにこのスクリプトを子プロセスでつなぐ）
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** 月・木の 03:17 JST（UTC の日・水 18:17）。公開・非公開にかかわらず「前回から変更があれば」流す */
export const CRON_TWICE_WEEKLY = '17 18 * * 0,3';
/** それ以外の 5 日の 03:17 JST（UTC の月・火・木・金・土 18:17）。公開中だけ流す */
export const CRON_OTHER_DAYS = '17 18 * * 1,2,4,5,6';
export const WORKFLOW_FILE = 'nightly.yml';
export const E2E_JOB = 'e2e-nightly';
/** 成功の証拠として数える step の名前（nightly.yml の「E2E（…）」と「e2e-full（…）」。test:checks が nightly.yml と突き合わせる） */
export const E2E_STEP_RE = /^(?:E2E|e2e-full)（/;
export const RUNS_PER_PAGE = 100;
/** 同じ SHA の成功した run を読むページの上限（100 件 × 10＝1,000 件。毎日 1 回なら約 2.7 年分。超えたら見つからないとして流す） */
export const MAX_PAGES = 10;

/**
 * 流すかを決める（純粋な関数）。
 * @param {{ event: string, schedule: string, isPrivate: boolean | null, headSha: string, lastGreen: { sha: string, runId: number } | null | undefined }} p
 *   isPrivate: null は「分からない」。lastGreen: undefined は「まだ調べていない」、null は「見つからない・読めない」
 * @returns {{ run: boolean, reason: string, needLastGreen: boolean }}
 */
export function decide({ event, schedule, isPrivate, headSha, lastGreen }) {
  if (event !== 'schedule') return { run: true, reason: `手動実行（${event}）は常に流す`, needLastGreen: false };
  if (schedule === CRON_OTHER_DAYS && isPrivate !== false)
    return {
      run: false,
      reason: isPrivate === null ? '可視性が分からないので非公開として扱い、月・木以外は流さない' : '非公開の間は月・木だけ流す（今日は月・木以外）',
      needLastGreen: false,
    };
  if (lastGreen === undefined) return { run: true, reason: '', needLastGreen: true };
  if (lastGreen === null) return { run: true, reason: 'この SHA で成功した nightly が見つからない（または読めない）ので流す', needLastGreen: false };
  if (lastGreen.sha === headSha)
    return { run: false, reason: `前回の成功した nightly（run ${lastGreen.runId}）と同じ SHA ${headSha.slice(0, 7)} なので省略する`, needLastGreen: false };
  return {
    run: true,
    reason: `前回の成功した nightly（run ${lastGreen.runId}・${lastGreen.sha.slice(0, 7)}）から main が変わった（${headSha.slice(0, 7)}）`,
    needLastGreen: false,
  };
}

/** run の jobs から「E2E まで成功した回」かを判定する */
export function isGreenE2E(jobs) {
  return jobs.some(
    (j) => j.name === E2E_JOB && j.conclusion === 'success' && (j.steps ?? []).some((s) => E2E_STEP_RE.test(s.name) && s.conclusion === 'success'),
  );
}

async function api(path) {
  const base = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
  const res = await fetch(`${base}${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${process.env.GH_TOKEN ?? ''}`,
      'x-github-api-version': '2022-11-28',
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json();
}

async function readPrivate(repo) {
  try {
    const r = await api(`/repos/${repo}`);
    if (typeof r.private === 'boolean') return { value: r.private, from: 'API' };
    throw new Error('private がない');
  } catch (e) {
    const ev = process.env.EVENT_PRIVATE;
    if (ev === 'true' || ev === 'false') {
      console.log(`::warning::リポジトリの可視性を API で読めない（${e.message}）。イベントの値（${ev}）を使う`);
      return { value: ev === 'true', from: 'イベント' };
    }
    console.log(`::warning::リポジトリの可視性が分からない（${e.message}）。非公開として扱う`);
    return { value: null, from: 'なし' };
  }
}

/** この SHA で E2E まで成功した nightly の run（なければ null） */
async function findLastGreen(repo, headSha) {
  if (!/^[0-9a-f]{40}$/.test(headSha)) {
    console.log(`::warning::この回の SHA が読めない（'${headSha}'）。流す`);
    return null;
  }
  try {
    const runs = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const q = `status=success&head_sha=${headSha}&per_page=${RUNS_PER_PAGE}&page=${page}`;
      const { workflow_runs: got = [] } = await api(`/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?${q}`);
      runs.push(...got);
      if (got.length < RUNS_PER_PAGE) break;
    }
    // API が絞り込みを無視しても取り違えないよう、SHA と結論をここでも確かめる。古い順（API は新しい順に返す）に見る
    for (const r of runs.filter((x) => x.head_sha === headSha && x.conclusion === 'success').reverse()) {
      const { jobs = [] } = await api(`/repos/${repo}/actions/runs/${r.id}/jobs?filter=latest`);
      if (isGreenE2E(jobs)) return { sha: r.head_sha, runId: r.id };
    }
    return null;
  } catch (e) {
    console.log(`::warning::この SHA の成功した nightly を読めない（${e.message}）。流す`);
    return null;
  }
}

export async function main() {
  const env = process.env;
  const repo = env.GITHUB_REPOSITORY ?? '';
  const event = env.GITHUB_EVENT_NAME ?? '';
  const schedule = env.EVENT_SCHEDULE ?? '';
  const headSha = env.GITHUB_SHA ?? '';
  const lines = [`- きっかけ: ${event}${schedule ? `（cron '${schedule}'）` : ''}`, `- SHA: ${headSha}`];
  if (event === 'schedule' && schedule !== CRON_TWICE_WEEKLY && schedule !== CRON_OTHER_DAYS)
    console.log(`::warning::知らない cron（'${schedule}'）。月・木の回として扱う（nightly.yml と scripts/nightly-gate.mjs の cron を合わせる）`);
  let isPrivate = null;
  if (event === 'schedule') {
    const p = await readPrivate(repo);
    isPrivate = p.value;
    lines.push(`- 可視性: ${isPrivate === null ? '不明' : isPrivate ? '非公開' : '公開'}（${p.from}）`);
  }
  let d = decide({ event, schedule, isPrivate, headSha, lastGreen: undefined });
  if (d.needLastGreen) d = decide({ event, schedule, isPrivate, headSha, lastGreen: await findLastGreen(repo, headSha) });
  lines.push(`- 判定: ${d.run ? '流す' : '流さない'} — ${d.reason}`);
  console.log(lines.join('\n'));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `run=${d.run}\n`);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `### nightly の gate\n${lines.join('\n')}\n`);
  return d;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
