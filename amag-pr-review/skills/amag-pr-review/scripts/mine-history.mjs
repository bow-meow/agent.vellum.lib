#!/usr/bin/env node
import { findCreds, makeClient } from './bb.mjs';
import { isOurs } from './comment.mjs';

const [ws, repo, max = '100'] = process.argv.slice(2);
if (!ws || !repo) { console.error('usage: mine-history.mjs <ws> <repo> [maxPrs]'); process.exit(2); }
const creds = findCreds();
if (!creds) { console.error('mine-history.mjs: no Bitbucket credentials'); process.exit(1); }
const bb = makeClient({ creds });

const { values: prs } = await bb.get(
  `repositories/${ws}/${repo}/pullrequests?state=MERGED&pagelen=50&sort=-updated_on`,
  { max: Number(max) },
);
for (const pr of prs) {
  const { values } = await bb.get(`repositories/${ws}/${repo}/pullrequests/${pr.id}/comments?pagelen=100`);
  for (const c of values) {
    const raw = c.content?.raw?.trim();
    if (!raw || c.deleted || isOurs(raw)) continue;
    if (c.user?.account_id === pr.author?.account_id) continue;
    console.log(JSON.stringify({ pr: pr.id, path: c.inline?.path ?? null, author: c.user?.display_name, raw }));
  }
}
