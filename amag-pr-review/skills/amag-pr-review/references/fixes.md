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
- Prose written as a fix (a release note, doc, event or log text) that states a guarantee or a cause
  ("nothing is lost", "a growing backlog means the reader stopped") without tracing each fact through
  the code that decides it: support acts on it. List each fact with the code that makes it true,
  including the settings and failure paths that make it false, before proposing the text.
- A dirty-read hint (`NOLOCK`, `READ UNCOMMITTED`) added to a query because its sibling queries carry
  one: it trades blocking for uncommitted reads and, when a scan meets concurrent page splits, skipped
  or doubled rows. Suggest it only after naming a writer to that table that holds wide or long locks,
  and only where a wrong result is harmless.
- A log call at Warning or Info to make a silent failure visible, without reading the shipped logging
  configuration: a default level or switch above it filters the line out, and the failure stays as
  invisible as before. Check the level the shipped config passes, or write to a sink it doesn't filter.
- A scope guard (RAII object, `finally`, `defer`) replaced by a manual set on entry, to change what
  the exception path leaves behind: the reset on the normal path leaves with the guard, so the flag
  stays set after the first clean run and every later call returns early. Write the normal-path reset
  back in the same fix, or keep the guard and handle the exception path on its own.
- A catch-all fault handler (`catch (...)`, SEH `__except`, a top-level recover) put around a whole
  callback so an unexpected fault becomes fatal or visible: it also takes every recoverable error from
  the callback's other work, which then gets the fatal treatment (a stopped timer, a restart). Catch the
  recoverable types around each step that can raise them, and leave the outer handler for real faults.
- A value, reason code or flag renamed to name one case when the condition that produces it still
  covers more: every other case now reports under the narrower name. Narrow the condition in the same
  fix, giving the other cases their own value, or keep a name as broad as the condition.
- Several kinds of message sent through one shared rate limit (a once-a-minute log throttle) to stop
  a frequent one flooding: the frequent kind uses up the window and hides a rarer, more important one,
  and a suppressed count written only when the next message gets through is lost if none follows.
  Throttle per kind, and write the count when the window closes.
- A match, lookup or exemption narrowed to the right unit (per item, per form, per caller) on the one
  path the finding named, while sibling paths that gather the same kind of evidence (another branch,
  an exemption set, a second lookup) keep the old, wider unit: the stand-in the finding caught
  survives one branch over. Find every path that collects that evidence and give each the new unit.
- A guard added to the one value the finding named when sibling values beside it are fed and fail
  the same way (several counts or flags read from sources that each emit an empty result on a failed
  load): the siblings keep the defect, and the finding reads as closed. List every value fed by that
  kind of source and guard each, or say why one differs.
- A field (a location, an owner) added to the key of some writes into a map or set used to report or
  dedupe, while other writes to it keep the old key: entries that differ only in that field overwrite
  each other, and all but the last report disappear. Give every write the same full key.
- A client-side recount or re-query to get around a value the server serves stale from a cache
  (paging the full list to count it, re-reading it at the point of use): every other reader of the
  cached value stays stale, the client now holds two sources that can disagree, and the workaround
  brings failure paths of its own. Find the change path that skips the refresh and refresh it there.
- Teardown steps gathered into one run-once function (a flag set at the top, then each step in turn)
  with a step that must happen (a restore, an unlock, a stop) after steps that can throw: one throw
  skips it, and every later call returns at the flag. Guard each earlier step, or run the one that
  must happen in its own `finally`.
- A safety check before a destructive action (drop, restore over, delete, overwrite) that inspects one
  of the objects the action destroys: the others go unchecked. List what the action destroys, from the
  code that does it, and check each.
- A conversion of a stored value (a default, a value derived from other fields) put in the one caller
  the finding names, when the repo's docs or a sibling rule put that kind of conversion in the server's
  mapping layer: every other caller still stores the raw value. Put it where the docs and siblings put
  it, and keep a caller-side change only for a reason of its own.
- A new rule for a case an older, narrower rule already handles part of (a clamp, a filter, a reset on
  change), with the older one left in place: two rules for one value, which drift apart. Remove or
  narrow the older one in the same fix.
- A sweep, or a rename so a sweep can find it, for a test that puts its rows onto data it didn't
  create (a borrowed record, the first row a query returns): until the sweep runs the borrowed record
  carries them, and the sweep removes only what it can name. Give the test a record of its own to
  use, created and removed by the fixture.
- A priority eviction for a full queue (evict the expendable kind first, keep the protected kind)
  whose fallback, when nothing expendable is queued, evicts the oldest item of any kind: an arriving
  expendable item then pushes out a protected one, the case the rule exists for. In that fallback,
  drop the arriving item when it is the expendable kind.
- A stop-and-join moved earlier in a teardown sequence (so the thread finishes before what it uses
  is torn down) without reading what the join does on timeout: its forced kill (`TerminateThread`, a
  thread abort) now lands before the rest of teardown, which can hang on a heap, loader or runtime
  lock the dead thread held; leaving the thread running instead lets it call into objects freed
  later. Signal and wait early, and keep any forced kill where the old sequence had it.
- A missing-test finding answered by extracting part of the logic into a small helper and testing
  only the helper: the unit the finding named (the handler that calls it, the state it keeps, the
  merge with data loaded later) stays untested, and the helper's tests still pass with the call
  removed. Drive the unit the finding names, or leave the finding open.
- A fix that brings a risky behaviour of its own (ordering between overlapping requests, a queue held
  and replayed after a reply, a retry, a generation or state flag) with no test beside it: once
  applied nothing reviews it again, and a slip fails silently. Name, as part of the fix, the test that
  fails without it, or say in one line why the behaviour is not a risk.
- A function's failure result changed from a fallback (a cached copy, a default) to `undefined` or
  `null` to fix the one caller the finding named: a caller that coalesces it to an empty value
  (`?? []`, `?? {}`, `or []`) now reads a failure as "there are none", and a count or confirmation
  built on it tells the user nothing is affected while the action still runs. List every caller and
  what each does with the new failure result, and fix them in the same change.
- Work moved into a shared, application-lifetime object (a singleton, a root-provided service) by
  subscribing in its constructor to a stream that loads data: every consumer of that object now
  starts the load and waits on it, and the subscription never ends, so a source that refreshes only
  while it has subscribers keeps refreshing everywhere. Keep the subscription in the consumer that
  needs the data, scoped to its lifetime, and pass the result in.
