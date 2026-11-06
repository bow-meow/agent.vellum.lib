---
name: change-diagrams
description: "Use when asked to diagram a code change as before/after pictures on an Artifact page — a bug and its fix, a feature that changes an existing flow, or a refactor or perf change — from a ticket, PR, commit range or worktree. Triggers — draw the problem and the fix, diagram this feature, show what changed, diagrams like the last ticket's. SKIP for charts of data (dataviz), or architecture docs and brand-new features with no existing flow to compare."
---

# Change diagrams

Turn a change to an existing flow into one page a cold reader can follow: what the parts are, the steps as they run
today, the same steps after the change, and the evidence. Every page is built from
[assets/template.html](assets/template.html), which carries the house CSS and one of each drawing primitive. Copy it,
keep its `:root` tokens and `svg .class` rules, and replace the placeholder content.

## Kinds of change

Pick the row first. It sets the headings, what the Before steps show, and the first key card.

| Kind | Before `h2` | After `h2` | Later Before steps show | First key card |
|---|---|---|---|---|
| Bug fix | "The problem: …" | "The fix: …" | each way it breaks | the rule the bug breaks |
| Feature | "Today: …" | "With <feature>: …" | each thing the flow can't do yet | the gap the feature fills |
| Refactor or perf | "Today: …" | "After: …" | where the cost lands | the cost the change removes |

A change that does more than one (a fix that adds a limit) takes the row of its main purpose; the rest are After steps.
A feature with no existing flow to compare has no Before figure, so it is not this skill.

## 1. Gather the facts first

- The diff from the base to the head, and each commit message. Read the code the diff touches, not only the diff.
- The ticket folder's notes (a `HANDOVER.md` or similar), the ticket or spec, review findings and rig evidence (logs,
  CSVs, dumps, timings).
- For each link in the failure, limitation or cost, note whether it is **proven** (a dump, a log, a test, a
  measurement) or **inferred** (code reading). The caption says which is which.

## 2. The page, in this order

1. `<title>`: the change's short name, 2–4 words. The file starts at `<title>`, because the Artifact tool adds the
   doctype, `<html>` and `<head>`.
2. **Header.** Eyebrow `TICKET · component · PR #n`. An `h1` of one sentence, under about 15 words, naming what was
   wrong or missing and what the change does (for example, "How one stall starves the event queue, and how the timer
   breaks the chain"). Two or three sentences of setup. Then at most two key cards: the one from the Kinds table, and
   a `dl.stages` naming each lane with its class or method. Then a legend listing only the encodings the figures use.
3. **Before figure.** Eyebrow `Before · <base ref>`, `h2` from the Kinds table, stating the claim. Then the sequence
   figure (section 3). Its first step shows the normal path working. Each later step is one failure, limitation or
   cost, so all of them go in this one figure, not a figure each.
4. **After figure.** Eyebrow `After · <commit shas>`, `h2` from the Kinds table. Keep every Before lane in the same
   order, and keep the opening steps, so the two figures differ only where the change does something. A lane the
   change adds (a queue, a timer, a new service) goes between the lanes it connects. A lane the change takes off the
   path stays, greyed: `hdr off`, `hdr-t off` and `life off`. Behaviour the change adds beyond its main purpose, such
   as a limit or a retry, is a step here if it sits on the path, or a flow figure if it branches.
5. **Only if they apply:** a flow figure of boxes for a branch or an ordering (exception routing, shutdown order,
   behaviour at a limit). A `.results` table with Before and After columns built from the rig evidence or
   measurements. `.notes` cards for open questions, with `.open` on the ones still to decide.
   A change to SQL (an index, a procedure's `WHERE`, how the client reads a result) also gets one query figure per
   cause (section 3a), after the After figure.
6. **Every figure** is `<figure><div class="canvas"><svg …></svg></div><figcaption>`. The `svg` has `role="img"`
   and an `aria-label` stating the claim. The caption opens with `<b>` around one sentence that points into the
   figure ("Run 2 is where it goes wrong.", "The new arrow is the timer's poll in run 3."). Then it gives the field
   symptom or user-visible effect, the rig number and what is still inferred.

## 3. The sequence figure

Lanes run across the top. Steps run down the page, each numbered in a circle at x=22. A **Why** column on the right
explains each step.

| Element | Recipe |
|---|---|
| Canvas | `viewBox="0 0 1000 H"`. Drawing in x ≤ 700, Why column at x=712. |
| Lane | `rect.hdr` at y=18, h=36, centred on the lane's x. `line.life` from y=54 to H−10. Centres ≥ 120 apart. Colour the header by role (`ev`, `al`, `tm`, `off`). |
| Actor with stages | `rect.run` 260×64. Stage chips 44×26 every 50 px: `st-ev` / `st-al` done, `st-fail` threw (✕ in the label), `st-skip` not run. |
| Message | `line.msg.<colour>` from the source lane's x to the target x − 1, with `marker-end`. `text.lbl` 6 px above, centred, and off any lifeline it crosses; the label's halo covers the crossing. A route back uses a `path` elbow (`M x,y V y2 H x3`). |
| Lost hand-off | A line with no marker, ended by `text.xmark` (✕), and a red word or pill naming the loss. |
| Blocked actor | A `rect.blk` box on its lane: `blk-t` says what blocks it, and `blk-s` (mono) gives the code-level reason. |
| Limitation or cost | A `wn` pill under the lane that lacks the capability or pays the cost, naming it ("no retry", "3 round trips"). |
| State after a step | `rect.pill` under the lane whose state the step changes (`ok` / `ko` / `wn`). Width = characters × 6.6 + 20, h=22, rx=11. |
| Why text | ≤ 42 characters a line, baselines 17 px apart, starting 4 px above the step's y. Use `.bad` for the line where it breaks or falls short, `.good` where the change shows, and `.note` for the rest. |
| Row pitch | 120–170 px per step, enough that the pills sit clear of the next step's arrows. Three to five steps per figure; merge steps that share a cause. |

Markers: one `<marker>` per colour per `svg`, with an id prefixed per figure (`b…` before, `a…` after). Ids are global
to the page, so a reused id paints the wrong colour.

Body text is about 6.3 px per character at 12.5 px. Work out each label's width before you place it, and keep it off
lifelines, boxes and other labels.

## 3a. The query figure (SQL changes)

In the sequence figures the database is one lane, and a pill under it says what a query costs ("2 full scans · 201
reads"). That shows *that* the cost dropped. The query figure shows *why* the database now does less. It is one `svg`
split at x=500 by a `line.divider`: Before on the left, After on the right, each headed by a `text.panel-t`.

| Cause | What each panel draws |
|---|---|
| Missing index | The table as a `rect.strip` with row lines, in its stored order (name the clustered key), all of it under `rect.read-bad`, the matching rows as scattered `rect.hit` bars, and one red arrow per scan. After: the new index as a strip banded by its key columns, only the matching range as `rect.read-good`, and a seek arrow into it. |
| Filter that rules out the index (a `CASE`, function or `OR` on the key column) | The `WHERE` text in `.mono`, the offending line in `.bad`. Under it the plan as a row of boxes: scan, join, sort, then the rows returned. After: the rewritten statement with its key comparison in `.good`, and the same boxes with a seek in place of the scan. |
| Client read pattern (dynamic or server cursor, one query per row) | Two mini sequences with Client and SQL Server lanes: every open, fetch and close as an arrow, a `wn` pill at the server for each repeated piece of work, and sends drawn where they happen in the loop. After: execute, one stream back, close, then the work done from memory. |

- Each panel ends with pills of the measured numbers (logical reads, CPU, rows or round trips): `ko` on the left,
  `ok` on the right.
- Operator names (scan, seek, key lookup, sort) come from a saved plan. With only reads and timings as evidence, draw
  them from the query text and say in the caption that they are inferred, not from a plan.
- One figure per cause, not per object: five procedures with the same `CASE` filter get one figure, and the caption
  names all five.
- The caption says whether result rows were compared before and after, and what a new index costs on writes.
- The classes `strip`, `row`, `read-bad`, `read-good`, `hit`, `panel-t`, `divider` and `band-t` are not in the
  template; add them to its `<style>`:
  `svg .strip { fill: var(--bg); stroke: var(--muted); stroke-width: 1.2; }`,
  `svg .row { stroke: var(--line); }`, `svg .read-bad { fill: var(--bad); fill-opacity: 0.12; }`,
  `svg .read-good { fill: var(--good); fill-opacity: 0.22; stroke: var(--good); }`, `svg .hit { fill: var(--good); }`,
  `svg .panel-t { font-family: var(--display); font-weight: 600; font-size: 15px; fill: currentColor; }`,
  `svg .divider { stroke: var(--line); }`,
  `svg .band-t { fill: var(--muted); font-family: var(--mono); font-size: 10.5px; }`.

## 4. Check, then publish

1. Write the page to the scratchpad with the Write tool, not a shell heredoc, which breaks on a body this long. If the
   session offers a preview (`ArtifactCheck` or a screenshot), run it once and fix what it shows. Otherwise skip it.
2. Publish with the Artifact tool: `icon: "diagram"`, plus a one-sentence `description`.
3. Reply with the link and one line per figure saying what it shows.

## Common mistakes

| Seen without this skill | Instead |
|---|---|
| Boxes and arrows of the architecture, with failure points as numbered dots | Lanes and numbered steps, so the reader sees *when* it goes wrong or falls short and what state that leaves |
| One figure per failure path or per side issue (alarms, the limit, shutdown) | Steps of the one Before figure. A separate figure only for a branch or an ordering |
| A feature drawn as the new design alone | A Before figure of today's flow on the same lanes, so the reader sees what the feature adds |
| `<!doctype>`, `<html>`, `<head>`, system fonts, `prefers-color-scheme` only | The template: it starts at `<title>`, loads the Plex and Fraunces fonts, and has all three theme blocks |
| "Figure 3." headings and a title that reads as a caption | An eyebrow, then an `h2` that states the claim |
| Explanation inside `<desc>` or crammed into boxes | The Why column for each step and the caption for the whole figure |
| An SQL change shown only as "201 → 42 reads" on the database lane | A query figure that draws what the database reads before and after, and why |
| The after figure redrawn with a different layout | The same lanes and opening steps as the before figure, so the difference is visible |
