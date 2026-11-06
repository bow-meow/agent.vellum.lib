# Approach

Is there a simpler or better way to reach what the change is for? Every other checklist judges the
code the change wrote; this one judges the design it chose. Your unit is the whole change, not a hunk.

## Steps (in order, once for the whole change)
1. **Goal**: one line, from the ticket and the PR description: what must be true when this merges.
   Separate the acceptance criteria from the author's or estimator's suggested approach ("reuse the
   existing dialog", "add a command for it"): only the criteria bind the design.
2. **Mechanisms**: list each mechanism the change adds (a protocol or message exchange, a wait or
   loop, a state machine, a new service, a cache, a background job, a filter or hook, a fallback
   path, a new table or column) with what it costs in code (files, rough lines) and what it is for.
3. **Driving decision**: for each mechanism, ask what forced it. When several trace back to one
   decision ("the answer must come from the page's dialog", "the write must be synchronous", "every
   client is notified"), that decision is the candidate. Check whether the goal needs it, or only the
   suggested approach does.
4. **Alternative**: look first at what the change or the repo already has: a value the change already
   pushes or stores, a fallback it already builds, a framework or OS facility (a real modal, a
   transaction, an existing queue or helper), a peer feature solving the same problem. Then write it
   down concretely: the code it would be (a sketch of at most ~10 lines), what of the change it
   deletes, and which of the change's failure modes and edge-case handling go with it.
5. **Trade-off**: what the alternative gives up (a look, a behaviour, a case it handles worse). If it
   gives up an acceptance criterion, it is not an alternative: drop it.
6. **Signals**: review threads (other reviewers' comments, in the comments file) that each patch a
   different symptom of the same mechanism are evidence the mechanism is the problem; name them.

## Raise it only when
- The alternative meets every acceptance criterion and you can name the code in this change or the
  repo it builds on, as `path:line`.
- It removes a mechanism, not just moves it: fewer moving parts, fewer failure modes, or a failure
  class gone (re-entrancy, a timeout race, a second source of truth), and you can name them.
- At most two findings per change, best first. One alternative with the trade-off stated is the
  finding; a list of options is not.

## Not this checklist
- Local design smells (duplication, wrong layer, naming, god methods): design-quality has them.
- A different style or library that is no simpler, "could be refactored", or a rewrite of code the
  change didn't add.
- A design the ticket's comments already chose over the alternative you'd raise, with a reason that
  still holds: name the comment instead of raising it.

## Writing it
- Anchor on the line where the driving decision is made (the call that starts the mechanism, the
  method the alternative would replace), in the changed code.
- `issue`: the driving decision and what it costs ("Showing the page's dialog from a synchronous
  close needs a nested message loop, an input filter and a four-message handshake").
- `impact`: the failure modes or upkeep that go away with the alternative, concretely.
- `fix`: the alternative as a short sketch, then what it deletes and what it gives up.
- `claim` names the alternative in one line; `failure` names one concrete failure the current
  mechanism has that the alternative cannot have, when there is one.

## Severity hints
- Medium: the alternative removes a failure you can trace in the current mechanism (an input that
  slips past it, a wait that can hang, state two places must keep in step), or deletes most of the
  change's code at no cost to the acceptance criteria.
- Low: simpler with nothing broken today; the author's call.
- Info: a better approach that is out of reach for this ticket (needs another team's change, a
  migration): worth recording, not blocking.
