#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const shellQuote = v => `'${String(v ?? '').replace(/'/g, `'\\''`)}'`;

// Branch and repo names come from the PR author, so they are single-quoted for sourcing, never
// spliced into a command line.
export function prEnv(pr, { ws, repo, pr: id, ar, skill }) {
  const vars = {
    S: skill,
    AR: ar,
    WS: ws,
    REPO: repo,
    PR: id,
    W: `${ar}/.work/${ws}-${repo}-PR${id}`,
    WT: `${ar}/${repo}-PR${id}`,
    STATE: pr.state,
    AUTHOR_ID: pr.author?.account_id,
    SRC_FULL_NAME: pr.source?.repository?.full_name,
    SRC_BRANCH: pr.source?.branch?.name,
    SRC_HASH: pr.source?.commit?.hash,
    DEST: pr.destination?.branch?.name,
  };
  return Object.entries(vars).map(([k, v]) => `${k}=${shellQuote(v)}`).join('\n') + '\n';
}

// A quoted "~" never expands when sourced, so the default is this script's own skill folder, written
// the way Git Bash spells Windows paths.
export const posixPath = p => p.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
const ownSkillDir = () => posixPath(dirname(dirname(fileURLToPath(import.meta.url))));

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) {
  const [cmd, prFile, ws, repo, id, ar = '/c/repos/ai-review', skill = ownSkillDir()] = process.argv.slice(2);
  if (cmd !== 'pr' || !prFile || !ws || !repo || !/^\d+$/.test(id ?? '')) {
    console.error('usage: env.mjs pr <pr.json> <ws> <repo> <pr_id> [ai-review-root] [skill-dir]   (prints shell assignments)');
    process.exit(2);
  }
  process.stdout.write(prEnv(JSON.parse(readFileSync(prFile, 'utf8')), { ws, repo, pr: Number(id), ar, skill }));
}
