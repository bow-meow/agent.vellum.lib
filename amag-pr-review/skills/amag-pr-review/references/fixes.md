# Suggested fixes

A `fix` is code the author pastes in, so a wrong one ships as a new defect under the review's name.
Reviewers and verify read this file before writing any `fix`; the fix-review pass reads it before
judging an applied one. Each line below comes from a fix of ours that later turned out wrong.

## Before writing a fix

- Hold the fix to the same checklists as the diff: it is new code.
- For each API, overload or helper the fix starts using, check what it does beyond what the finding
  needs (other options it sets, when it registers, what it overrides). The finding names one problem;
  the call you suggest brings everything it does.

## Don't suggest

- A default set through a convenience overload that also pins a value configuration is meant to
  choose (one that registers a formatter, provider or endpoint after configuration has bound): the
  configured choice is silently replaced. Suggest the form that fills the default only while the option
  is unset, and leaves the selection to configuration.
- A deadline checked between units of work as the cap for a drain or loop whose single unit can block
  without limit (a query with no timeout, a blocking call): the unit in flight runs past it, and a
  harder cut that follows (a process kill, a host timeout) ends it before the summary the deadline was
  meant to log. Pair it with a per-call timeout, or report from a timer that fires while the process
  is still alive.
- A total of work done or dropped (a shutdown summary, a discard or progress count) taken by walking
  the batch or container at hand: work can also sit in an earlier batch, be mid-run, or arrive after
  the walk, so the log misreports. Count where the work runs or is dropped, or use a counter the code
  already keeps exactly.
- One long wait on a handle split into a loop of short waits (to report progress in between) when
  the party waited on closes or frees that handle as it finishes: a wait started after the close uses a
  dead or reused handle. Take a duplicate or reference before telling it to finish, wait on that, and
  release it afterwards.
- Progress reporting (a heartbeat, checkpoint or keep-alive) added inside cleanup that every exit
  path shares: a failure path that already reported a final state keeps reporting after it. Gate it
  on the in-progress state.
- A comment stating a worst case for a per-instance limit (at most N%, at most N items) as the
  caller's worst case: one caller can drive several instances, and its real cost is their sum.
- A catch-and-continue around work on a loop or timer that also feeds a watchdog or liveness signal,
  when the work that threw stays stuck afterwards: the loop keeps the watchdog fed, so the restart that
  would have recovered the stuck work never comes. Stop feeding the watchdog once that work has failed,
  or leave the restart to fire.
