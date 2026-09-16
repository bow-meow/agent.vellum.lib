---
name: code-comments
description: >-
  Use when writing or editing code comments in any language, or sweeping comment noise out of
  changed code — before a commit, while fixing PR feedback, "clean up these comments", "too many
  comments", "is this comment needed". SKIP for: prose docs, READMEs, changelogs.
---

# code-comments — what earns a comment, what gets deleted

Code shows *how*; a comment exists only to carry what the code cannot say — a non-obvious
constraint, an external gotcha, a genuine *why*. When writing new code the default is **no
comment**. When touching existing code, every comment in the changed region runs the gauntlet
below, in order; first match decides.

## The gauntlet

1. **Narration** — restates what the line does, restates a name/type/signature, marks a block end
   ("end of loop"). → Delete.

2. **Change narration** — addressed to the reviewer of a diff, not a reader of the file: "updated
   to use the v2 client", "removed the old fallback", "null check added per review". Test: does
   the sentence read correctly to someone seeing the file fresh in a year, who never saw any PR?
   → Delete.

3. **Issue numbers and review references** — no ticket IDs (SYM-1234), no PR or thread links, no
   "per review comment". Git blame and the PR already carry that trail; the comment must encode
   the substance itself. House rule — deliberately stricter than most public guides, which allow
   ticket breadcrumbs. → Delete the reference; whatever substance remains re-enters at rule 4.

4. **Bloated or misplaced why** — a real *why* worded three times too long, or one restating a
   decision the code already reflects. Keep the single non-obvious fact a reader needs at that
   line, in the fewest words; sometimes the honest count is zero. System-level architecture
   narrative belongs in a maintained doc, not an inline block.

5. **Stale** — describes code or behavior that no longer exists. → Delete, or correct it if the
   point still holds and still earns its place.

6. **Keep** — a non-obvious constraint; a surprising-but-essential line; a contract the signature
   can't show (units, ranges, side effects, failure modes); an edge case; the source of a copied
   algorithm; a "keep in sync with X" cross-file link (the link itself is the why); data-literal
   semantics ("pence, not pounds", "(width, height) in portrait"). **Do not reword comments that
   are already fine** — churn on good comments is itself noise.

## Register

Match the surrounding file: its comment density, language, and idiom. A one-line summary on a
public function or endpoint is fine; inline restatement of a single clear line never is. TODOs
are allowed without issue IDs, but a TODO is a marker, not a substitute for doing in-scope work.
