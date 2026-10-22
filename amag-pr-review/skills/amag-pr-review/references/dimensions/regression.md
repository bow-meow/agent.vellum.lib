# Regression

The other dimensions ask whether the new code is right. This one asks what the changed code did before
for everything that depends on it, and what it does now. For each changed unit, write down the old
behaviour first (from the base side of the diff and the code around it), then compare.

You get no ticket and no PR description, on purpose: they are the author's account of what changed,
and this review is the account the code gives. Report every behaviour change you find; verify
decides which ones the ticket asked for.

## Look for
- **Callers and their threads**: grep every caller of a changed unit. For each, name the thread, loop
  or request it runs on and what else that thread must keep doing (handling requests or events, a
  watchdog or heartbeat, a message pump, a UI). A call that now waits (a lock, a full queue, synchronous
  I/O, a retry loop) holds all of that for as long as it waits: check what the wait does when the thing
  it waits on never returns, not only when it is slow.
- **Every build and mode that runs the file**: a shared library, a file compiled into several
  binaries, a service that can also run as a console app or under a test harness, a CLI tool that uses
  the same class. A change written for one of them runs in all; check each one's path through it.
- **Inputs and config**: list the kinds of value a changed input or setting can hold (empty, the
  default, each format it accepts, values that point at this system vs somewhere else) and compare
  what the base branch produced for each with what the change produces. A changed default in a config
  file other components also load changes them too. Any kind whose output changed without the ticket
  asking is a finding, Medium when a client stores what it was given and can't recover on its own.
- **Failure paths**: for each error the changed code can meet (unreachable dependency, timeout,
  exception, empty result), what the old code did (deny, throw, retry, log, give up) and what it does
  now. A path that used to refuse and now proceeds on old or default data (fail-closed to fail-open) is
  High when it guards access or a destructive action.
- **Host and external contracts**: start and stop paths against the host's limits (a service manager's
  stop timeout and progress reporting, a container's grace period, a supervisor's restart rule). Check
  the platform's own tools and installers, not only the product's own stop helper: a helper that
  waits forever proves nothing about the standard tools that time out. Also check
  behaviour promised outside the code (docs, UI labels such as "now" or "immediately", API
  descriptions, a release note). The change must still meet each one, including in its new worst case.
- **Timing and resources**: latency added to a per-request or per-event path, something held or kept
  alive longer (connections, locks, memory, threads), a pool size, limit or timeout lowered in shared
  config.
- **Observability**: log lines, metrics or error messages removed, reworded, or moved to a level
  nothing collects, that support or monitoring rely on to see the behaviour the change touches.
- **Replaced or removed code**: list what the old branch, option or command did besides its main job
  (cleared a saved record, reset a flag, released something, logged) and check the replacement still
  does it, or that dropping it was intended.

- **"The old worst case was just as bad" is not a reason to skip.** Compare how often each case is
  reached, not only its worst form: a change that turns a rare path into the normal one (a long stop
  that now happens on every stop with a backlog) owns its effects. So does a change that adds a promise
  (a deadline, a cap, "the rest is logged") whose worst case breaks it, even where the old code made
  no promise and did no better.

## Don't flag
- A difference only in code paths the base branch couldn't reach either.

## Severity hints
- Breaking an existing caller's contract, or a fail-closed path that now fails open on access or a
  destructive action → High.
- A behaviour change no one asked for, on a path that runs in production → Medium.
- Lost or reworded logging that support relies on → Low.
