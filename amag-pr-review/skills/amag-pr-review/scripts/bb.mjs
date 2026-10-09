#!/usr/bin/env node
// Bitbucket Cloud 2.0 client with zero dependencies: this machine has no jq.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const API = 'https://api.bitbucket.org/2.0/';

export class BbError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} ${url}\n${body}`);
    this.status = status;
  }
}

export function findCreds(env = process.env) {
  if (env.BITBUCKET_USERNAME && env.BITBUCKET_PASSWORD)
    return { u: env.BITBUCKET_USERNAME, p: env.BITBUCKET_PASSWORD };
  const cfg = env.CLAUDE_CONFIG || join(homedir(), '.claude.json');
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
  } catch {}
  return null;
}

export function findAccountId(env = process.env) {
  if (env.BITBUCKET_ACCOUNT_ID) return env.BITBUCKET_ACCOUNT_ID;
  try {
    return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'config.json'), 'utf8')).accountId ?? null;
  } catch { return null; }
}

export function makeClient({ creds, fetchImpl = fetch, accountId = null }) {
  const auth = 'Basic ' + Buffer.from(`${creds.u}:${creds.p}`).toString('base64');
  const url = p => (p.startsWith('https://') ? p : API + p.replace(/^\//, ''));
  const prUrl = (ws, repo, id) => `${API}repositories/${ws}/${repo}/pullrequests/${id}`;

  async function call(target, { method = 'GET', json, raw = false } = {}) {
    const headers = { Authorization: auth };
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetchImpl(target, {
      method,
      headers,
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const text = await res.text();
    if (!res.ok) throw new BbError(res.status, target, text);
    if (raw) return text;
    return text ? JSON.parse(text) : {};
  }

  async function get(pathOrUrl, { max = Infinity } = {}) {
    const first = await call(url(pathOrUrl));
    if (!Array.isArray(first.values)) return first;
    const values = [...first.values];
    let next = first.next;
    while (next && values.length < max) {
      const page = await call(next);
      values.push(...page.values);
      next = page.next;
    }
    return { ...first, values: values.slice(0, max), next: undefined };
  }

  return {
    get,
    // API tokens often lack read:user; the account id can come from config instead.
    me: () => call(url('user')).catch(e => {
      if (e instanceof BbError && e.status === 403 && accountId) return { account_id: accountId, source: 'config' };
      throw e;
    }),
    diff: (ws, repo, id) => call(`${prUrl(ws, repo, id)}/diff`, { raw: true }),
    comment: (ws, repo, id, { raw, path, side, line }) =>
      call(`${prUrl(ws, repo, id)}/comments`, {
        method: 'POST',
        json: { content: { raw }, inline: { path, [side === 'old' ? 'from' : 'to']: line } },
      }),
    general: (ws, repo, id, raw) =>
      call(`${prUrl(ws, repo, id)}/comments`, { method: 'POST', json: { content: { raw } } }),
    remove: (ws, repo, id, commentId) =>
      call(`${prUrl(ws, repo, id)}/comments/${commentId}`, { method: 'DELETE' }),
    reply: (ws, repo, id, parentId, raw) =>
      call(`${prUrl(ws, repo, id)}/comments`, {
        method: 'POST',
        json: { content: { raw }, parent: { id: parentId } },
      }),
    edit: (ws, repo, id, commentId, raw) =>
      call(`${prUrl(ws, repo, id)}/comments/${commentId}`, { method: 'PUT', json: { content: { raw } } }),
    resolve: (ws, repo, id, commentId) =>
      call(`${prUrl(ws, repo, id)}/comments/${commentId}/resolve`, { method: 'POST' }),
    reopen: (ws, repo, id, commentId) =>
      call(`${prUrl(ws, repo, id)}/comments/${commentId}/resolve`, { method: 'DELETE' }),
    approve: (ws, repo, id) => call(`${prUrl(ws, repo, id)}/approve`, { method: 'POST' }),
    unapprove: (ws, repo, id) => call(`${prUrl(ws, repo, id)}/approve`, { method: 'DELETE' }),
    requestChanges: (ws, repo, id) => call(`${prUrl(ws, repo, id)}/request-changes`, { method: 'POST' }),
    unrequestChanges: (ws, repo, id) => call(`${prUrl(ws, repo, id)}/request-changes`, { method: 'DELETE' }),
    searchPrs: (ws, repo, needle, states = ['OPEN', 'MERGED']) => {
      const q = encodeURIComponent(`source.branch.name ~ "${needle}"`);
      return get(`repositories/${ws}/${repo}/pullrequests?q=${q}${states.map(s => `&state=${s}`).join('')}`);
    },
  };
}

const USAGE = `usage:
  bb.mjs get <path-or-url> [--max N]                          (follows pagination; --max stops early)
  bb.mjs me
  bb.mjs diff <ws> <repo> <pr>
  bb.mjs comment <ws> <repo> <pr> <path> <new|old> <line>   (body on stdin)
  bb.mjs general <ws> <repo> <pr>                            (body on stdin; the in-progress notice only)
  bb.mjs delete <ws> <repo> <pr> <comment_id>                (the in-progress notice only)
  bb.mjs reply <ws> <repo> <pr> <parent_comment_id>          (body on stdin)
  bb.mjs edit <ws> <repo> <pr> <comment_id>                  (new body on stdin; our own comments only)
  bb.mjs resolve|reopen <ws> <repo> <pr> <comment_id>
  bb.mjs approve|unapprove <ws> <repo> <pr>
  bb.mjs request-changes|unrequest-changes <ws> <repo> <pr>
  bb.mjs search-prs <ws> <repo> <branch-or-ticket-key> [OPEN,MERGED,...]`;

function usage(msg) {
  if (msg) console.error(`bb.mjs: ${msg}`);
  console.error(USAGE);
  process.exit(2);
}
const num = (v, name) => (/^\d+$/.test(v ?? '') ? Number(v) : usage(`${name} must be numeric`));
function stdinBody() {
  const raw = readFileSync(0, 'utf8').trim();
  return raw || usage('empty body on stdin');
}

async function dispatch(bb, cmd, a) {
  switch (`${cmd}/${a.length}`) {
    case 'get/1': return bb.get(a[0]);
    case 'get/3': if (a[1] !== '--max') usage(); return bb.get(a[0], { max: num(a[2], 'max') });
    case 'me/0': return bb.me();
    case 'diff/3': return bb.diff(a[0], a[1], num(a[2], 'pr'));
    case 'comment/6': {
      if (!['new', 'old'].includes(a[4])) usage('side must be new or old');
      const r = await bb.comment(a[0], a[1], num(a[2], 'pr'), { raw: stdinBody(), path: a[3], side: a[4], line: num(a[5], 'line') });
      return { id: r.id, link: r.links?.html?.href };
    }
    case 'general/3': {
      const r = await bb.general(a[0], a[1], num(a[2], 'pr'), stdinBody());
      return { id: r.id, link: r.links?.html?.href };
    }
    case 'delete/4':
      await bb.remove(a[0], a[1], num(a[2], 'pr'), num(a[3], 'comment_id'));
      return { deleted: Number(a[3]) };
    case 'reply/4': {
      const r = await bb.reply(a[0], a[1], num(a[2], 'pr'), num(a[3], 'parent_comment_id'), stdinBody());
      return { id: r.id, link: r.links?.html?.href };
    }
    case 'edit/4': {
      const r = await bb.edit(a[0], a[1], num(a[2], 'pr'), num(a[3], 'comment_id'), stdinBody());
      return { id: r.id, link: r.links?.html?.href };
    }
    case 'resolve/4':
      await bb.resolve(a[0], a[1], num(a[2], 'pr'), num(a[3], 'comment_id'));
      return { resolved: Number(a[3]) };
    case 'reopen/4':
      await bb.reopen(a[0], a[1], num(a[2], 'pr'), num(a[3], 'comment_id'));
      return { reopened: Number(a[3]) };
    case 'approve/3':
      await bb.approve(a[0], a[1], num(a[2], 'pr'));
      return { approved: true };
    case 'unapprove/3':
      await bb.unapprove(a[0], a[1], num(a[2], 'pr'));
      return { approved: false };
    case 'request-changes/3':
      await bb.requestChanges(a[0], a[1], num(a[2], 'pr'));
      return { changesRequested: true };
    case 'unrequest-changes/3':
      await bb.unrequestChanges(a[0], a[1], num(a[2], 'pr'));
      return { changesRequested: false };
    case 'search-prs/3':
    case 'search-prs/4': {
      const r = await bb.searchPrs(a[0], a[1], a[2], a[3]?.split(','));
      return r.values.map(p => ({
        id: p.id, title: p.title, state: p.state,
        source: p.source?.branch?.name, destination: p.destination?.branch?.name,
        link: p.links?.html?.href,
      }));
    }
    default: return usage();
  }
}

export async function run(argv) {
  const creds = findCreds();
  if (!creds) {
    console.error('bb.mjs: set BITBUCKET_USERNAME and BITBUCKET_PASSWORD (or configure the bitbucket MCP in ~/.claude.json)');
    process.exit(1);
  }
  try {
    const out = await dispatch(makeClient({ creds, accountId: findAccountId() }), argv[0], argv.slice(1));
    process.stdout.write(typeof out === 'string' ? out : JSON.stringify(out, null, 2) + '\n');
  } catch (e) {
    if (e instanceof BbError && e.status === 401)
      console.error('bb.mjs: 401 Unauthorized, check BITBUCKET_USERNAME / BITBUCKET_PASSWORD');
    if (e instanceof BbError && e.status === 403 && argv[0] === 'me')
      console.error('bb.mjs: token lacks read:user; set BITBUCKET_ACCOUNT_ID to your Bitbucket account id');
    console.error(`bb.mjs: ${e.message}`);
    process.exit(1);
  }
}

const invoked = process.argv[1] && resolve(process.argv[1]).toLowerCase();
if (invoked === fileURLToPath(import.meta.url).toLowerCase()) await run(process.argv.slice(2));
