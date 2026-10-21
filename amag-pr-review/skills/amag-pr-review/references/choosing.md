# PR mode: the user chooses what to post

Read from SKILL.md step 7. None of it runs on `--dry-run`. The in-progress notice is the only thing
posted without asking; it stays up until cleanup.

## 1. The pick list

Number every item that would write to the PR, in this order:

We write only when we disagree. Agreeing with the author, whether their fix holds or their push-back
does, is shown by resolving the thread and nothing else: a "fixed" or "fair point" reply tells them
what they already know. (Bitbucket Cloud's API has no likes or reactions, so a resolve is the only
silent signal.)

1. Findings: confirmed `new` with an anchor, and `reply`, in table order (change needed and notes).
2. Follow-ups on previous findings, from verify's re-check:
   - `still-applies` with `codeChanged: true`: a "Still applies" reply.
   - `authorResolved` and `still-applies`, with no author reply: reopen, plus a reply.
3. Push-backs the re-check disputes (Post as `answer`), with the author's point in a line and verify's
   draft `reply` under the table: our reply answering their point, plus reopen when it's
   `authorResolved`. The finding stays open.
4. Agreements (Post as `resolve`): a `fixed` or `conceded` finding whose thread is our own (no
   `parentId`) and still open. Resolve it, no reply. A conceded one is withdrawn.

Not numbered, because nothing would be posted: `already-raised`, `ours-previous`, terminal-only,
previous findings that are `still-applies` with `codeChanged: false` and their thread still open
(nothing moved, so a reply would only repeat the comment; list them under the table as "Still open
from the last review"), and agreements whose thread is already resolved or isn't ours to resolve.
List those as "Settled, nothing to post": fixed ones by count, conceded ones one line each with the
author's reason. `flip N` works on a conceded one by its listed number, to answer it instead.

Each group is numbered in table order, continuing from the one before. Under the push-backs, list
each conceded one's `pattern` as a suggestion for the don't-flag list, `R1. <line> (from 4)`, when
verify gave one.

Show the step 11 table with these numbers, its Post as column filled (`new`, `reply`,
`still applies`, `reopen`, `answer`, `resolve`), then the decision posting everything would lead to,
then ask:

`Which should I post? ("post 1,3", "post all", "post all but 2", "edit 2: <what to change>", "flip 4", "rule R1", "none")`

**Then stop and end the turn.** Don't post, reply, resolve, reopen, approve or request changes until
the user answers. No answer this session means nothing more happens to the PR.

## 2. On an answer

- `edit N`: rewrite `$W/body-<id>.txt` as asked, keeping the header and the humanize rules in
  severity.md. Show the new body and ask again.
- `flip N` on a push-back: the user overrules verify. A conceded one becomes `answer`, and its `R`
  suggestion is withdrawn with it: verify's note backs the author, so the argument has to come from
  the user. Ask them what still fails rather than inventing one, draft the reply from that by the rules
  in verify.md step 5, show it and ask again for that item. A disputed one becomes an agreement:
  `resolve` if it's our own open thread, else nothing to post.
- `rule R1`: add that line to the don't-flag list in `references/severity.md`, as the rule in
  SKILL.md's "Rules that always apply" says for a finding the user calls wrong. Only for a conceded
  item left conceded.
- Anything you can't map to numbers, or that contradicts another part of the answer: ask. Don't guess.
- Items picked plainly post now; an `edit` or `flip` item waits for its own confirmation.
- Post the chosen items in parallel (independent calls), each from its body file:
  - `new`: `node $S/scripts/bb.mjs comment $WS $REPO $PR "<path>" <side> <line> < $W/body-<id>.txt`
  - `reply`: `node $S/scripts/bb.mjs reply $WS $REPO $PR <parent_id> < $W/body-<id>.txt`
  - `still-applies`: `node $S/scripts/comment.mjs followup still-applies <line> > $W/body-still-<comment_id>.txt`,
    reply it to its comment id.
  - `reopen`: `node $S/scripts/bb.mjs reopen $WS $REPO $PR <thread root id>` (its `parentId`, else its
    comment id), then the `still-applies` reply above at verify's `line`, or
    `needs-reply` in its place for a Low or Low/nit.
  - `answer`: write the reply text to `$W/pushback-<comment_id>.txt` with the Write tool, then
    `node $S/scripts/comment.mjs followup disputed < $W/pushback-<comment_id>.txt > $W/body-pushback-<comment_id>.txt`
    and reply it to its comment id; on an `authorResolved` one, reopen first, as for `reopen`.
  - `resolve`: `node $S/scripts/bb.mjs resolve $WS $REPO $PR <comment_id>`. Never on a thread we
    didn't start: a finding that was a reply in someone else's thread is never resolved.
- Record each post's returned `id`/`link`. A failed post goes in the failures list; don't retry it
  into a duplicate.

## 3. The decision

Only when the PR is open and not mine. Open findings = the `change` findings just posted, the
`still-applies`, `reopen` and `answer` follow-ups just posted, push-backs kept open (step 4), and the
"Still open from the last review" ones. Notes, withdrawn findings, anything else declined and step
2's closed findings don't count.

- **Tooling problem** (a failed post, an uncovered dimension, verify or recheck failing): hold and say
  which step failed. Don't ask; it never approves, requests changes or withdraws an approval.
- Otherwise propose, with my current state (`approved`, `changes_requested` or none):
  `Request changes: <n> open findings. Go ahead? (y/n)` or `Approve: nothing open. Go ahead? (y/n)`.
  **Stop and wait again.** On no, leave the approval state as it is.
- On yes, to request changes: if my state is `approved`, first `node $S/scripts/bb.mjs unapprove $WS $REPO $PR`;
  then, unless it's already `changes_requested`, `node $S/scripts/bb.mjs request-changes $WS $REPO $PR`.
- On yes, to approve: if my state is `changes_requested`, first
  `node $S/scripts/bb.mjs unrequest-changes $WS $REPO $PR`; then, unless it's already `approved`,
  `node $S/scripts/bb.mjs approve $WS $REPO $PR`.

## 4. What a declined item means for state (SKILL.md step 9)

- New finding → `dropped`, reason `User chose not to post`, plus their reason if they gave one, so
  verify keeps that verdict next time unless the code it rests on changes.
- `fixed`, resolved or not → saved as `status: 'fixed'`: the code is fixed.
- `still-applies` → stays `open`: its thread is still on the PR.
- `reopen` → not saved, like a thread a human closed: the user accepted the author's resolve.
- A conceded finding, resolved or settled without a post → not saved as open. It goes to `dropped`,
  reason `Conceded to the author:` plus verify's `note`, so the same finding isn't raised again on
  this PR. Its `resolve` declined → the user keeps the finding: it stays `open`.
- `answer`, posted or declined → stays `open`.

Every push-back that stays open is saved with `pushbackSeen` = the id of the author's latest reply,
so the next run doesn't ask about the same push-back again, only about a newer reply.

For the run log (SKILL.md step 10), a previous finding's id is `c<comment_id>`: posted and declined
as for findings, `--flipped` for a push-back the user flipped either way.

`reviewedCommit` = `HEAD_SHA` as usual: the review is complete even when some of it wasn't posted.
