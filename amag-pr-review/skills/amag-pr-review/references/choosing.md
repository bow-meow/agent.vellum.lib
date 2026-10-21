# PR mode: the user chooses what to post

Read from SKILL.md step 7. None of it runs on `--dry-run`. The in-progress notice is the only thing
posted without asking; it stays up until cleanup.

## 1. The pick list

Number every item that would write to the PR, in this order:

1. Findings: confirmed `new` with an anchor, and `reply`, in table order (change needed and notes).
2. Follow-ups on previous findings, from verify's re-check:
   - `fixed`: a "Fixed in" reply, plus resolve when it's our own thread and not `authorResolved`.
   - `still-applies` with `codeChanged: true`: a "Still applies" reply.
   - `authorResolved` and `still-applies`: reopen, plus a reply.

Not numbered, because nothing would be posted: `already-raised`, `ours-previous`, terminal-only, and
previous findings that are `still-applies` with `codeChanged: false` and their thread still open:
nothing moved, so a reply would only repeat the comment. List those under the table as "Still open
from the last review".

Show the step 11 table with these numbers, its Post as column filled (`new`, `reply`, `fixed`,
`still applies`, `reopen`), then the decision posting everything would lead to, then ask:

`Which should I post? ("post 1,3", "post all", "post all but 2", "edit 2: <what to change>", "none")`

**Then stop and end the turn.** Don't post, reply, resolve, reopen, approve or request changes until
the user answers. No answer this session means nothing more happens to the PR.

## 2. On an answer

- `edit N`: rewrite `$W/body-<id>.txt` as asked, keeping the header and the humanize rules in
  severity.md. Show the new body and ask again.
- Anything you can't map to numbers: ask. Don't guess.
- Post the chosen items in parallel (independent calls), each from its body file:
  - `new`: `node $S/scripts/bb.mjs comment $WS $REPO $PR "<path>" <side> <line> < $W/body-<id>.txt`
  - `reply`: `node $S/scripts/bb.mjs reply $WS $REPO $PR <parent_id> < $W/body-<id>.txt`
  - `fixed`: `node $S/scripts/comment.mjs followup fixed $HEAD_SHA > $W/body-fixed-<comment_id>.txt`,
    reply it to its comment id; then, **only if the finding has no `parentId`** (it started its own
    thread) and isn't `authorResolved`, `node $S/scripts/bb.mjs resolve $WS $REPO $PR <comment_id>`.
    A finding that was a reply in someone else's thread is never resolved.
  - `still-applies`: `node $S/scripts/comment.mjs followup still-applies "<its severity>" <line> > $W/body-still-<comment_id>.txt`,
    reply it to its comment id.
  - `reopen`: `node $S/scripts/bb.mjs reopen $WS $REPO $PR <thread root id>` (its `parentId`, else its
    comment id), then the `still-applies` reply above at verify's `line`, or
    `needs-reply` in its place for a Low or Low/nit.
- Record each post's returned `id`/`link`. A failed post goes in the failures list; don't retry it
  into a duplicate.

## 3. The decision

Only when the PR is open and not mine. Open findings = the `change` findings just posted, the
`still-applies` and `reopen` follow-ups just posted, and the "Still open from the last review" ones.
Notes, anything declined and step 2's closed findings don't count.

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
- `fixed` → saved as `status: 'fixed'` all the same: the code is fixed.
- `still-applies` → stays `open`: its thread is still on the PR.
- `reopen` → not saved, like a thread a human closed: the user accepted the author's resolve.

`reviewedCommit` = `HEAD_SHA` as usual: the review is complete even when some of it wasn't posted.
