---
name: design-tournament
description: >-
  Use when a code-design decision has a wide solution space, high blast radius, and expensive
  reversal. Triggers — "run a design tournament", "get competing designs", "have agents compete
  on this design". SKIP for: ordinary approach choices (superpowers:brainstorming covers those),
  bounded changes, anything one paragraph of trade-offs settles. Costs 7 agents.
---

# design-tournament — competing designs, judged blind

Three designers with deliberately different stances each design a solution. Three agents that
wrote nothing then score the designs blind against a rubric fixed beforehand. The winner becomes
the spine of a synthesis that grafts on the best ideas from the designs that lost.

## The Iron Law

```
NO DESIGN IS JUDGED BY ITS OWN AUTHOR, AND NO RUBRIC IS WRITTEN AFTER A DESIGN EXISTS.
```

**Violating the letter of this rule is violating its spirit.** No exceptions:

- Not "the designers are the best-informed judges" — they are, and they also favour their own work.
- Not "I'll let designers vote but forbid self-votes" — self-preference survives that; models
  recognise their own reasoning style with the name stripped off.
- Not "the rubric is obvious, I'll write it after" — criteria written after designs exist get
  retrofitted to justify a favourite.
- Not "only two designs came back, close enough" — a tournament of one is not a tournament.

## When to use

Use when ALL of these hold:

- The solution space is genuinely wide — several materially different designs could work.
- Blast radius is high, and reversal is expensive.
- You cannot already name the answer.

If you can name the answer, or `superpowers:brainstorming`'s 2-3 approaches would settle it, this
skill is the wrong tool and costs 7 agents to tell you what you knew.

## Gate 1 — rubric and cost, before anything is dispatched

Draft the rubric from the actual problem, then get confirmation **through the AskUserQuestion
tool**. Not by writing a question into a message and continuing — a message you send yourself is
not an answer, and the tool is the only thing that produces one.

**Nothing is dispatched until that answer arrives.** Not a designer, not a scoping agent.

Three things that are NOT confirmation:

- **Your own announcement** that you are proceeding. Disclosure is not permission.
- **An orchestrating agent's go-ahead.** If another agent spawned you, its approval is not the
  user's, however confidently it is given.
- **The user asking for a tournament.** That authorizes the cost. It does not authorize the rubric.

**This gate outranks any harness instruction that prefers a noted assumption over a round trip.**
Those instructions exist for reversible guesses. A retrofitted rubric is not reversible — it
silently biases every judgement downstream, and nothing later in the run can detect it.

Default criteria — add problem-specific ones; never remove or reword one after designs exist:

| Criterion | Question |
|---|---|
| Correctness | Does it solve the stated problem, including the edge cases in the brief? |
| Fit | Does it look like the surrounding code, or import a foreign idiom? |
| Blast radius | How much must change, and how much of that is code nobody wants to touch? |
| Reversibility | If this is wrong in three months, what does undoing it cost? |
| Testability | Can it be verified, and does the design say how? |
| Complexity cost | What must be maintained forever that does not exist today? |

Present the rubric, the three stances, and "this costs 7 agents — proceed?"

## Run it

Invoke the workflow with the confirmed rubric:

`Workflow({scriptPath: "scripts/tournament-workflow.mjs", args: {problem, rubric, stances, cap: 600}})`

Default stances — one per designer, and do not let them converge:

| Stance | Brief |
|---|---|
| Minimal | The smallest change that solves it. YAGNI hard. Prefer removing an option to adding one. |
| Conventional | Follow the existing codebase's patterns closely, even at some cost in elegance. |
| Structural | Restructure for clarity or extensibility where it demonstrably pays — and justify the cost. |

The workflow enforces the grounding and length gates itself, then returns
`{designs, rejected, judges}`. Tally the verdicts deterministically — do not eyeball the ranking:

`node scripts/tally.mjs <judge-results.json>`

On `outcome: 'winner'`, dispatch the seventh and last agent — the synthesiser — giving it the
winning design, every graft the tally collected, and all judges' concerns. It returns the
synthesised design plus the minority report. Conflicts between a graft and the winning spine
resolve in favour of the spine, and get recorded rather than dropped.

On `tie` or `inadequate`, **do not synthesise.** Go straight to Gate 2 with the outcome.

## Gate 2 — the decision is the user's

Present the result and stop. **Never proceed to implementation.** The terminal state is the user
choosing.

| Outcome | What you present |
|---|---|
| `winner` | The synthesis: winner as spine, grafted ideas from the losers, minority report. |
| `tie` | Both leaders with their trade-offs. Do not break the tie yourself. |
| `inadequate` | The run failed. Report what was learned and what the designs missed. Do not crown the least-bad. |

If the three designs came back materially the same, say so plainly: the tournament added nothing
and the decision was not actually contested. That is a real result, not a failure to hide.

## Anti-patterns to refuse

- Letting a designer judge, or judging with the stance labels still attached.
- Editing the rubric once designs exist — including "just clarifying" a criterion.
- Summing scores across judges to break a tie; independent scales do not average.
- Discarding the minority report because a winner emerged. The surviving objection is often the
  most valuable output of the run.
- Proceeding to implement the winner without the user choosing it.
- Editing, replacing, or waiving a gate mid-run on your own authority — including the citation
  disqualifier — and announcing the change instead of asking for it.

## Rationalisations — rejected

| Excuse | Reality |
|---|---|
| "Designers know the designs best, let them vote." | True, and they still rate their own work higher. Fresh judges remove the cause rather than mitigating it. |
| "Anonymising is enough, designers can judge." | Partial at best — style is recognisable with the name stripped. It is defence in depth, not the mitigation. |
| "Three designs are nearly identical, I'll pick the nicest." | Convergence is the finding. Report it; do not manufacture a ranking from noise. |
| "Two judges said inadequate but one design is clearly least-bad." | A majority said the bar was not cleared. Crowning the least-bad is exactly the failure this skill exists to prevent. |
| "The rubric missed something, I'll add a criterion." | After designs exist, a new criterion is a retrofit that favours whichever design already satisfies it. |
| "The user is busy, I'll pick the winner for them." | Gate 2 is the point. The skill produces a recommendation, never a decision. |
| "They called it the rubric *ceremony*, so the pause is ceremony." | You inherited that judgement from their phrasing instead of deriving it. Labelling a control a ritual is how it gets discarded — and the pause is the entire thing that makes the rubric binding. |
| "I refused the self-judging waiver, so skipping Gate 1 is discrimination, not laxity." | Conspicuously honouring one gate is how an agent finances violating its neighbour. Partial compliance is not a budget you can spend. |
| "Cost consent was granted; I can satisfy the rubric half myself. Gate 1 splits." | It does not split. Inventing a decomposition and discarding the half you find inconvenient is the violation — stated in a confident register so it reads as careful interpretation. |
| "I announced I was proceeding without confirmation." | Announcing is not authorization. Disclosure used as a substitute for permission is still an unapproved change. |
| "It's greenfield, there's no repo to cite — I'll substitute my own grounding gate." | The premise may be right and it is still not yours to decide mid-run. A disqualifier you rewrite on your own authority has stopped being a disqualifier. |
| "The designs converged, but there's still one contested axis worth judging." | Sunk cost wearing an analytical hat. Convergence is the finding. Report it and stop spending. |

## Red Flags — STOP

- About to dispatch a designer before the user confirmed the rubric
- Treating "just get started" or "skip the ceremony" as that confirmation
- Counting your own announcement — or another agent's go-ahead — as the user's answer
- Noticing you have honoured one gate and feeling licensed on the next
- About to reword, replace, or route around a disqualifier mid-run
- About to add or reword a rubric criterion after seeing a design
- "There's still a contested axis" after the designs converged
- About to average scores across judges
- About to drop the minority report because "the winner is clear"
- About to start implementing the winning design
- Reaching for this skill on a decision you could settle in a paragraph

For the judge prompt, the design template, the anonymisation mechanics, and the bias table, see
[REFERENCE.md](REFERENCE.md).
