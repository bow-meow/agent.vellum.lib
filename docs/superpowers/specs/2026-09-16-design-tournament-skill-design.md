# design-tournament — a judged, multi-agent design skill

**Date:** 2026-09-16
**Status:** approved, ready for implementation planning
**Home:** `agent.vellum.lib`, as a fifth plugin alongside the four in
`2026-09-16-vellum-skill-marketplace-design.md`

## Context

For a design decision with a wide solution space, a single agent produces a single
plausible answer and no way to tell whether it is a good one. The obvious fix — have
several agents design, review each other, and vote — fails in a specific way: when the
same model both generates and judges, it exhibits **self-preference bias** and rates its
own output higher. Two companion biases make it worse. **Verbosity bias** rewards longer,
more elaborate designs regardless of merit, which selects for over-engineering — the
opposite of what a design process should produce. **Position bias** rewards whichever
design is seen first or last.

A naive tournament therefore crowns the loudest entrant, not the best design. This skill
is the corrected form: designers and judges are different agents, the rubric is fixed
before any design exists, and the output is a synthesis rather than a winner.

## Goals

- Produce one design that is better than any single agent would have written alone.
- Make the judgement resistant to self-preference, verbosity, and position bias.
- Surface dissent as a durable artifact rather than discarding it with the losing designs.
- Fail honestly — report "no adequate design" rather than crowning the least-bad entry.
- Fire rarely, and only where the cost is justified.

## Non-goals

- Replacing `superpowers:brainstorming`'s lightweight "propose 2–3 approaches" step. That
  remains the default for ordinary design decisions; this is the rare escalation.
- Auto-proceeding to implementation. The skill ends by handing a decision to the user.
- Deciding anything the user has already decided. The tournament explores; it does not
  relitigate settled choices.
- Guaranteeing diversity through parallelism alone. Diversity is engineered via assigned
  stances, not hoped for.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Output | Winner as spine + grafted ideas + minority report | A pure vote discards the good ideas in losing designs |
| Invocation | Standalone, explicit | `superpowers` is an installed plugin (`claude-plugins-official` v6.3.0); auto-escalation would mean forking it and re-merging on every upgrade |
| Topology | 3 designers, 3 fresh judges | Separating the roles removes self-preference bias at the root instead of mitigating it |
| Rubric timing | Fixed and user-confirmed **before** any design exists | Otherwise criteria get retrofitted to justify a favourite |
| Mechanism | `Workflow` tool, judge-panel pattern | Purpose-built for independent attempts → parallel judges → synthesis |
| Human gates | Two — rubric confirmation, and final decision | Matches the plan-approval discipline already in `ticket-quest` |

## Pipeline

```
 rubric drafted from the problem ──▶ USER CONFIRMS          ◀ gate 1
                 │                   (before any design exists)
                 ▼
   3 designers, forced-distinct stances, each reads real code
                 │
                 ▼
   anonymized · shuffled per judge · stance labels stripped
                 │
                 ▼
   3 fresh judges score against the rubric, and each names the
   best idea in the designs they did NOT rank first
                 │
                 ▼
   synthesis: winner as spine + grafted ideas + minority report
                 │
                 ▼
            USER DECIDES                                     ◀ gate 2
```

## The three stances

Assigned before designing, one per designer. Defaults, overridable per run:

| Stance | Brief |
|---|---|
| **Minimal** | The smallest change that solves the stated problem. YAGNI pushed hard. Prefer deleting an option to adding one. |
| **Conventional** | Follow the existing codebase's patterns as closely as possible, even at some cost in elegance. Consistency over cleverness. |
| **Structural** | Willing to restructure for clarity or extensibility where it demonstrably pays. Must justify the restructuring cost. |

Three agents given only "design this" converge on near-identical answers. These three pull
apart on most real problems, which is what makes the comparison informative.

## Grounding rule

Every design must cite real `file:line` references from the codebase it will live in.
**A design citing nothing is disqualified before judging.** Ungrounded designs are the most
common failure of agent design work: three elegant proposals that do not fit the repo.

## The rubric

Drafted by the orchestrator from the actual problem, then confirmed by the user before
designers start. Default criteria, each scored 1–5 with written justification:

| Criterion | Question |
|---|---|
| **Correctness** | Does it actually solve the stated problem, including the edge cases named in the brief? |
| **Fit** | Does it look like the surrounding code, or does it import a foreign idiom? |
| **Blast radius** | How much existing code must change, and how much of it is code nobody wants to touch? |
| **Reversibility** | If this turns out wrong in three months, what does undoing it cost? |
| **Testability** | Can it be verified, and does the design say how? |
| **Complexity cost** | What new concepts, indirection, or configuration must be maintained forever? |

The orchestrator may add problem-specific criteria and may propose weights. Both go through
gate 1. Criteria may not be added, removed, or reweighted after designs exist.

## Bias mitigations

Listed with an honest note on how much each actually buys:

| Bias | Mitigation | Strength |
|---|---|---|
| Self-preference | Judges are fresh agents that wrote nothing | **Strong** — removes the cause |
| Self-preference (residual) | Identity and stance labels stripped before review | Partial — models still partly recognise their own reasoning style |
| Verbosity | Fixed design template with a hard length cap; over-length designs are returned for compression, not judged long | **Strong** — structural, not advisory |
| Position | Designs shuffled independently per judge | Strong |
| Criteria drift | Rubric fixed and user-confirmed before designs exist | **Strong** |

The length cap matters more than it looks: without it, "more thorough" and "longer" become
indistinguishable to a judge, and the tournament reliably selects for over-engineering.

## Judging protocol

Each judge receives all three anonymized designs in an independently shuffled order, plus
the confirmed rubric, and returns:

1. A 1–5 score per criterion per design, each with a one-sentence justification.
2. A ranking of the three. The scores inform the ranking but do not mechanically determine
   it — a judge may rank a lower-scoring design first if it says why, since a single
   disqualifying flaw should outweigh a better average.
3. **The strongest idea in the designs they did not rank first.** This is what makes
   synthesis possible — it surfaces grafting material explicitly rather than leaving the
   synthesiser to infer it.
4. An adequacy verdict: does the top-ranked design clear the bar, yes or no?

### Determining the winner

The winner is the design ranked first by the most judges. With three judges and three
designs the possibilities are:

| Outcome | Result |
|---|---|
| 3–0 or 2–1 for one design | That design wins |
| 1–1–1, all three ranked first once | **Tie** — surfaced to the user, not broken automatically |

Scores are never summed across judges to break a tie. Averaging independent judges' scales
invents precision that is not there; a genuine three-way split is information about the
decision, and flattening it into a number hides that.

## Synthesis

One agent receives the winning design, every judge's grafting nomination, and all dissent,
and produces:

- **The synthesised design** — the winner as spine, with nominated ideas grafted in where
  they do not conflict with it. Conflicts are resolved in favour of the spine and recorded.
- **The minority report** — surviving objections, including the judges' concerns about the
  winner. "Design B lost, but a judge flagged that the winner cannot handle concurrent
  writes" is frequently the single most valuable output of the run.

## Failure modes

| Condition | Behaviour |
|---|---|
| ≥2 of 3 judges return "not adequate" | Report failure with what was learned. Do **not** crown the least-bad entry. |
| Tie in the ranking | Surface both to the user with their trade-offs. No coin flip, no tiebreak agent. |
| Designs converge anyway | Say so plainly: the tournament added nothing and the decision was not actually contested. |
| A design cites no `file:line` | Disqualified before judging; the run continues with the remainder. |
| Fewer than 2 designs survive disqualification | Abort — a tournament of one is not a tournament. |

## Human gates

**Gate 1 — rubric confirmation.** Before any design work, the user sees the drafted rubric
and the three stances, plus the agent count and its cost, and confirms or edits. This is
also where the run can be cancelled cheaply.

**Gate 2 — the decision.** The user receives the synthesised design, the ranking with
scores, and the minority report. The skill never proceeds to implementation on its own.

## Cost

**7 dispatched agents per run** — 3 designers, 3 judges, 1 synthesiser — orchestrated from
the main session, which is not itself an extra agent. A run that disqualifies a design and
re-dispatches, or that needs a second synthesis pass, reaches 9–10. The skill states the
figure at gate 1 and waits for a nod.

## Invocation and SKIP clause

Standalone and explicit. The description's SKIP clause is the line that decides whether the
skill is useful or merely noisy:

> **SKIP for:** ordinary approach choices — `superpowers:brainstorming` already proposes
> 2–3 with trade-offs; bounded changes; anything a single paragraph of trade-offs settles.
> Use only when the solution space is genuinely wide, the blast radius is high, and reversal
> is expensive.

## Output artifact

A design document written to `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`,
matching the format `superpowers:writing-plans` consumes, so a tournament result feeds the
existing spec → plan → implementation chain without translation. The minority report is a
section of that document, not a separate file — it must travel with the design.

## Placement and sequencing

The skill belongs in `agent.vellum.lib` as a fifth plugin, `design-tournament`, following
the layout in the marketplace spec: `.claude-plugin/plugin.json` plus
`skills/design-tournament/SKILL.md`.

**That marketplace is designed and planned but not built** — the repo currently holds only
these two spec documents and a plan. The marketplace implementation (eight tasks) should
land first; this skill then appends one entry to `marketplace.json` and one README section,
exactly as Tasks 2–4 of that plan do for the existing skills.

## Authoring constraints

The `SKILL.md` is written under `amag-claude-authoring:writing-skills-` and
`superpowers:writing-skills`. The `amag-claude-authoring` plugin ships a PreToolUse hook
that gates `SKILL.md` edits behind the matching skill, so this is enforced rather than
merely intended. (`amag-claude-authoring:writing-claude` governs rules in `CLAUDE.md` and
does not apply here.)

## Risks

| Risk | Mitigation |
|---|---|
| The skill fires too often and burns ~10 agents on trivial choices | Hard SKIP clause in the description; cost stated at gate 1 |
| Anonymization is weaker than it appears | Fresh judges are the real mitigation; anonymization is defence in depth, and the spec says so rather than overclaiming |
| Three stances still converge | Detected and reported honestly as "not actually contested" rather than dressed up as a result |
| Synthesis produces an incoherent chimera | Conflicts resolve in favour of the winning spine, and are recorded rather than silently dropped |
| The rubric is drafted badly | Gate 1 puts it in front of the user before any cost is incurred |

## Verification

A skill cannot be unit-tested, so it is verified by dry runs against decisions whose
outcome is already known:

- Run it on a design decision from this repo's own history — the marketplace packaging
  choice (one plugin per skill vs. themed bundles). A sound run should surface the
  granularity argument that actually decided it.
- Confirm a disqualification: give a designer no codebase access and check the design is
  rejected for missing `file:line` citations rather than judged on its prose.
- Confirm the escape hatch: run it on a decision with one obviously correct answer and
  check it reports "not actually contested" instead of manufacturing a ranking.
- Confirm gate 1 blocks: verify no designer agent is dispatched before the rubric is
  confirmed.
