#!/usr/bin/env node
// Bitbucket Cloud 2.0 API helper — zero dependencies (this machine has no jq, so the
// bash+jq approach used by amag-pr-review's bb-comment-reply.sh is not portable here).
// Credentials: BITBUCKET_USERNAME/BITBUCKET_PASSWORD env vars, else deep-searched from
// ~/.claude.json (the same place the bitbucket MCP server keeps them). Never stored here.
//
// Usage:
//   node bb.mjs get <path-or-url>
//       GET, following Bitbucket's `next` pagination and merging `values` arrays.
//       <path> is relative to https://api.bitbucket.org/2.0/ unless it starts with https://
//   node bb.mjs reply <workspace> <repo_slug> <pr_id> <parent_comment_id>
//       Threaded reply to a PR comment (markdown body on stdin). The bitbucket MCP's
//       addPullRequestComment has no `parent` field, so it cannot thread — this can.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const API = 'https://api.bitbucket.org/2.0/';

function findCreds() {
  let u = process.env.BITBUCKET_USERNAME, p = process.env.BITBUCKET_PASSWORD;
  if (u && p) return { u, p };
  const cfg = process.env.CLAUDE_CONFIG || join(homedir(), '.claude.json');
  try {
    const stack = [JSON.parse(readFileSync(cfg, 'utf8'))];
    while (stack.length) {
      const o = stack.pop();
      if (o && typeof o === 'object') {
        if (o.BITBUCKET_USERNAME && o.BITBUCKET_PASSWORD)
          return { u: o.BITBUCKET_USERNAME, p: o.BITBUCKET_PASSWORD };
        stack.push(...Object.values(o));
      }
    }
  } catch { /* fall through to the error below */ }
  console.error(`bb.mjs: no BITBUCKET_USERNAME/BITBUCKET_PASSWORD in env or ${cfg}`);
  process.exit(1);
}

async function call(url, opts = {}) {
  const { u, p } = findCreds();
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64'),
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...opts.headers,
    },
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(`bb.mjs: HTTP ${res.status} ${url}\n${text}`);
    process.exit(1);
  }
  return text ? JSON.parse(text) : {};
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'get' && args.length === 1) {
  let url = args[0].startsWith('https://') ? args[0] : API + args[0].replace(/^\//, '');
  const first = await call(url);
  if (Array.isArray(first.values)) {
    const values = first.values;
    let next = first.next;
    while (next) {
      const page = await call(next);
      values.push(...page.values);
      next = page.next;
    }
    console.log(JSON.stringify({ ...first, values, next: undefined }, null, 2));
  } else {
    console.log(JSON.stringify(first, null, 2));
  }
} else if (cmd === 'reply' && args.length === 4) {
  const [ws, repo, pr, parent] = args;
  if (!/^\d+$/.test(pr) || !/^\d+$/.test(parent)) {
    console.error('bb.mjs: <pr_id> and <parent_comment_id> must be numeric');
    process.exit(2);
  }
  const raw = readFileSync(0, 'utf8').trim();
  if (!raw) { console.error('bb.mjs: empty reply body on stdin'); process.exit(2); }
  const out = await call(
    `${API}repositories/${ws}/${repo}/pullrequests/${pr}/comments`,
    { method: 'POST', body: JSON.stringify({ content: { raw }, parent: { id: Number(parent) } }) },
  );
  console.log(JSON.stringify({ id: out.id, links: out.links?.html }, null, 2));
} else {
  console.error('usage: bb.mjs get <path-or-url> | bb.mjs reply <workspace> <repo_slug> <pr_id> <parent_comment_id>  (body on stdin)');
  process.exit(2);
}
