# amag-pr-respond local mode — findings a local amag-pr-review left

The source is `<ticketDir>\review-findings.json`, written by amag-pr-review's local mode
(`amag-pr-review <TICKET>`). Nothing here talks to Bitbucket: no credentials, no push, no replies. These
steps replace SKILL.md steps 1–4 and 6–10; step 5 applies as written, with the changes in L4.

The file holds `ticketKey`, `reviewedAt`, `repos: [{name, path, dest, head, dirty}]` and
`findings: [{n, id, repo, path, line, severity, status, reviewers, confidence, terminalOnly, text,
state, resolution}]`. `n` is the number the review's terminal table showed; `text` is the issue and
`**Fix:**` exactly as the review wrote them; `state` is `open`, `fixed` or `dismissed`.

### L1. Load

- Ticket dir: a path argument as given, else the folder under `C:\repos\ticket-work` whose name
  matches the key (any case).
- No `review-findings.json` there → stop: "No saved review for <KEY>; run `amag-pr-review <KEY>` first."
- Actionable = findings with `state: "open"`, narrowed to the numbers the user gave ("1,3",
  "the blocking ones"). None → say so and stop.

### L2. Is the review still current?

Per repo in `repos`, compare `git -C <path> rev-parse HEAD` and `git status --porcelain` (empty or
not) with the recorded `head` and `dirty`. Anything changed → line numbers may have moved: find each
finding's code by what `text` names, not by `line`. If the code it describes is already gone or
fixed, the verdict is **fix** with nothing left to do, resolution "already changed since the review".

### L3. Worktrees

Use the `path` of each repo. A dirty tree is expected here (the review covered uncommitted changes),
so don't stop on it, and never stash, reset, fetch or fast-forward: it's the user's working branch.
Before the first edit, snapshot each repo so the pause can show only this run's changes:
`git -C <path> stash create` (writes an object, touches no ref or file; empty output = clean tree,
use `HEAD`). Keep the hash per repo.

### L4. Investigate — SKILL.md step 5, with these changes

- Intent context: the branch's commit subjects (`git log --format=%s origin/<dest>..HEAD`) and the
  Jira ticket's summary and acceptance criteria when the Atlassian MCP is available. There's no PR
  description.
- The findings come from amag-pr-review's own agents and went through its verify pass. That earns them
  no trust: judge each like any reviewer's comment, against the code.
- Verdicts mean: **fix** (finding is right), **push-back** (finding is wrong; it becomes
  `dismissed`), **clarify** (it turns on a decision only the user can make; it stays `open` and the
  question goes in the pause table).
- No token counts: nothing is posted, so there's no header to put them in.

### L5. Fix — SKILL.md step 6's code rules, but never commit

The code-comments skill and the narrowest build/tests still apply, and what was and wasn't verified
still goes in the pause table. **Never commit**: the worktree usually holds the user's uncommitted
work, and a commit would sweep it in. Record which files each fix touched.

### L6. Retro — misses and noise, before the pause

Both halves follow SKILL.md step 7's location rules (never the plugin cache, grep for an existing
line to sharpen first, never commit) and its rule that **every line written into amag-pr-review is
generic**.

**Misses.** A local review that is run again on the same ticket finds what earlier rounds didn't.
The previous round's record is `review-findings.prev.json` next to `review-findings.json` (amag-pr-review
keeps one generation). For each **fix** verdict, run step 7's miss analysis against that record:

1. **Did the earlier round see this code?** Check the cited code against the earlier `head`
   (`git show <head>:<path>`, `git log -L` on the lines). When the earlier record has
   `dirty: true`, its uncommitted code isn't in `head`: judge from the finding's text and the
   branch's later commits, and record "uncertain" when you can't tell. Code that arrived after it,
   including this run's own earlier fixes, isn't a miss.
2. **Was it raised then and lost?** A finding in the earlier record on the same code that it
   dismissed, or that its verify dropped or downgraded (say so in the summary if the dropped
   candidates aren't on record), points at the verify or recheck rule that let it go.
3. **Otherwise** pick step 7's table row and make that change now; it's a local edit, shown at the
   pause like any other.

No `review-findings.prev.json` (first local review) → no miss analysis; say so in the summary.

**Noise.** A **push-back** is amag-pr-review noise. For each one, draft one line for the `## Don't flag`
list in amag-pr-review's `references/severity.md`, naming the class of false positive in generic terms.
Draft it now so the pause shows it; it's added only on the user's yes.

### L7. The pause

Show, then wait for the user:

- a table: `n` | file:line | gist | verdict | confidence | files changed | verification | resolution
  (one line: what changed, the evidence for a push-back, or the question for a clarify)
- the diff of this run's changes only: `git -C <path> diff <snapshot> -- <touched files>` per repo. A
  touched file that was untracked has no snapshot; list it instead of diffing it.
- the L6 miss table and each amag-pr-review line it added or rewrote, quoted with its file.
- each drafted don't-flag line from L6, with the finding it came from.

The user may amend verdicts, undo fixes or reject a don't-flag line; apply that and re-present
anything that changed.

### L8. On approval — record

Edit `review-findings.json` (Edit tool), only the `state` and `resolution` of handled findings:
fix → `fixed`; push-back → `dismissed`; clarify → stays `open` unless the user decided at the pause.
Add the don't-flag lines the user accepted. Nothing else is written, and the code edits stay
uncommitted.

### L9. Summary

Fixed / dismissed / still-open counts, files changed per repo (uncommitted), verification gaps, the
findings still open with their `n`, the miss table with each amag-pr-review line changed, and any
don't-flag line added, each quoted with its file.
