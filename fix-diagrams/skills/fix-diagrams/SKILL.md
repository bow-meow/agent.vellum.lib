---
name: fix-diagrams
description: "Use when asked to diagram a bug and the fix for it — a ticket, PR, commit range or worktree explained as before/after pictures on an Artifact page. Triggers — draw the problem and the fix, diagrams like the last ticket's, show what went wrong and what changed. SKIP for charts of data (dataviz) or general architecture docs with no bug."
---

# Fix diagrams

Turn a fix into one page a cold reader can follow: what the parts are, the steps where it goes wrong, the same steps
with the fix, and the evidence. Every page is built from [assets/template.html](assets/template.html), which carries
the house CSS and one of each drawing primitive. Copy it, keep its `:root` tokens and `svg .class` rules, and replace the
placeholder content.

## 1. Gather the facts first

- The diff from the base to the head, and each commit message. Read the code the diff touches, not only the diff.
- The ticket folder's notes (a `HANDOVER.md` or similar), review findings and rig evidence (logs, CSVs, dumps).
- For each link in the failure, note whether it is **proven** (a dump, a log, a test) or **inferred** (code reading).
  The caption says which is which.

## 2. The page, in this order

1. `<title>`: the bug's short name, 2–4 words. The file starts at `<title>`, because the Artifact tool adds the
   doctype, `<html>` and `<head>`.
2. **Header.** Eyebrow `TICKET · component · PR #n`. An `h1` of one sentence, under about 15 words, naming the problem
   and the fix (for example, "How one stall starves the event queue, and how the timer breaks the chain"). Two or
   three sentences of setup. Then at most two key cards: the rule the bug breaks, and a `dl.stages` naming each lane
   with its class or method. Then a legend listing only the encodings the figures use.
3. **Before figure.** Eyebrow `Before · <base ref>`, `h2` starting "The problem:" and stating the claim. Then the
   sequence figure (section 3). Its first step shows the normal path working. Each later step is one way it breaks,
   so every failure point goes in this one figure, not a figure each.
4. **After figure.** Eyebrow `After · <commit shas>`, `h2` starting "The fix:". Keep every Before lane in the same
   order, and keep the opening steps, so the two figures differ only where the fix changes something. A lane the fix
   adds (a queue, a timer) goes between the lanes it connects. A lane the fix takes off the path stays, greyed:
   `hdr off`, `hdr-t off` and `life off`. Behaviour the fix adds beyond the bug, such as a limit or a retry, is a step
   here if it sits on the path, or a flow figure if it branches.
5. **Only if they apply:** a flow figure of boxes for a branch or an ordering (exception routing, shutdown order,
   behaviour at a limit). A `.results` table with Before and After columns built from the rig evidence. `.notes`
   cards for open questions, with `.open` on the ones still to decide.
6. **Every figure** is `<figure><div class="canvas"><svg …></svg></div><figcaption>`. The `svg` has `role="img"`
   and an `aria-label` stating the claim. The caption opens with `<b>` around one sentence that points into the
   figure ("Run 2 is where it goes wrong.", "The new arrow is the timer's poll in run 3."). Then it gives the field
   symptom, the rig number and what is still inferred.

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
| State after a step | `rect.pill` under the lane whose state the bug corrupts (`ok` / `ko` / `wn`). Width = characters × 6.6 + 20, h=22, rx=11. |
| Why text | ≤ 42 characters a line, baselines 17 px apart, starting 4 px above the step's y. Use `.bad` for the line where it breaks, `.good` where the fix shows, and `.note` for the rest. |
| Row pitch | 120–170 px per step, enough that the pills sit clear of the next step's arrows. Three to five steps per figure; merge failure points that share a cause. |

Markers: one `<marker>` per colour per `svg`, with an id prefixed per figure (`b…` before, `a…` after). Ids are global
to the page, so a reused id paints the wrong colour.

Body text is about 6.3 px per character at 12.5 px. Work out each label's width before you place it, and keep it off
lifelines, boxes and other labels.

## 4. Check, then publish

1. Write the page to the scratchpad with the Write tool, not a shell heredoc, which breaks on a body this long. If the
   session offers a preview (`ArtifactCheck` or a screenshot), run it once and fix what it shows. Otherwise skip it.
2. Publish with the Artifact tool: `icon: "diagram"`, plus a one-sentence `description`.
3. Reply with the link and one line per figure saying what it shows.

## Common mistakes

| Seen without this skill | Instead |
|---|---|
| Boxes and arrows of the architecture, with failure points as numbered dots | Lanes and numbered steps, so the reader sees *when* it goes wrong and what state that leaves |
| One figure per failure path or per side issue (alarms, the limit, shutdown) | Steps of the one Before figure. A separate figure only for a branch or an ordering |
| `<!doctype>`, `<html>`, `<head>`, system fonts, `prefers-color-scheme` only | The template: it starts at `<title>`, loads the Plex and Fraunces fonts, and has all three theme blocks |
| "Figure 3." headings and a title that reads as a caption | An eyebrow, then an `h2` that states the claim |
| Explanation inside `<desc>` or crammed into boxes | The Why column for each step and the caption for the whole figure |
| The after figure redrawn with a different layout | The same lanes and opening steps as the before figure, so the difference is visible |
