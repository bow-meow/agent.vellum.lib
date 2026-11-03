# PR mode: the user chooses what to post

Read from SKILL.md step 7. None of it runs on a dry run. The in-progress notice is the only thing
posted without asking; it stays up until cleanup.

`pick.mjs build` has numbered everything that would write to the PR and ended its output with the
question. We write only when we disagree: agreeing with the author, whether their fix holds or their
push-back does, is a silent resolve, never a "fixed" or "fair point" reply. Items in the "Outside this
round's changes" group are code an earlier review passed: "post all" and ranges leave them out.

**Stop and end the turn after the question.** Don't post, reply, resolve, reopen, approve or request
changes until the user answers. No answer this session means nothing more happens to the PR.

## On an answer

```bash
node $S/scripts/post.mjs parse $W "<the user's answer>"   # → {post, edit, flip, rules, voice, none, unclear}
```

`unclear` set: ask the user, quoting it. Don't guess. Otherwise, in this order:

- `rules`: add each `R` line to the don't-flag list in `references/severity.md`, as "Rules that always
  apply" says for a finding the user calls wrong.
- `flip`: `node $S/scripts/post.mjs flip $W <n>` (the user overrules verify). A conceded item becomes
  an answer, and its `R` suggestion is withdrawn: verify's note backs the author, so the argument has
  to come from the user. Ask them what still fails rather than inventing one, write the reply from that
  to `$W/pushback-<commentId>.txt` by the rules in verify.md step 5, show it and ask again for that
  item. A disputed item becomes a resolve, or nothing to post if the thread isn't ours.
- `edit`: rewrite that item's body file (`body` in `picks.json`, or `$W/pushback-<commentId>.txt` for
  an answer) as asked, keeping the header and the humanize rules in severity.md. Run
  `node $S/scripts/post.mjs edited $W <n>`, show the new text and ask again for that item.
- `voice`: rewrite the bodies of the `post` items in that voice by [voices.md](voices.md) first.
- `post`: `node $S/scripts/post.mjs run $W <n...>`. Edited and flipped items wait for their own yes,
  then post the same way. Show each returned link, and failures (never re-post a failure).

When the user's answers are final (everything they'll post is posted, or they said none):
`node $S/scripts/post.mjs close $W` marks the rest declined. Then the decision.

## The decision

```bash
node $S/scripts/post.mjs decide $W     # → {action, why, open, myState}
```

- `hold`: a tooling problem (a failed post, an uncovered dimension, verify or recheck failing), or a
  low-level review with nothing open. Say which, from `why`. Don't ask; nothing changes my approval
  state.
- Otherwise propose, with my current state: `Request changes: <open> open findings. Go ahead? (y/n)` or
  `Approve: nothing open. Go ahead? (y/n)`. **Stop and wait again.**
- On yes: `node $S/scripts/post.mjs apply-decision $W`. On no: leave it, and say `Left as <state>: you said no`.

Then SKILL.md step 9.
