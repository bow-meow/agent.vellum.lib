# Correctness and contracts

## Look for
- Logic errors: inverted conditions, wrong operator, off-by-one, wrong variable, early return that skips
  cleanup, state updates or setup a later step relies on (logging started only after the checks whose
  failures it should record), switch/if chains missing a case the change introduced.
- Null / empty / default handling on new inputs and on values from DB, NATS, config and files.
- "Unknown" outcomes: a lookup that times out, a read caught by `catch`, an empty result. Find what the
  code falls back to, follow that value to the final output (the URL, message or row it ends up in) and
  check it does what the comment on the fallback promises. "Treat it as X when unsure" is a common
  comment whose downstream still emits the not-X value because a later step needed data the failed
  read never produced. When the value guards a destructive action (stop, kill, drop, delete,
  overwrite), "couldn't check" must refuse or ask: a probe that returns empty on failure reads as
  "nothing in the way", a classifying lookup that fails drops items into the harsher branch, and a
  success that records nothing leaves the next unattended run choosing the destructive default.
  Compare with sibling probes in the change that do report "not checked".
- Error handling: swallowed exceptions, broad `catch` that hides a real failure, errors that leave state
  half-written (DB row written, cache not; message acked, work not done; an in-memory copy updated
  before the write it mirrors, so a failed write leaves memory claiming saved), missing rollback, error paths
  that surface as an unhandled 500 or crash a service. A wrapper that acts on a thrown error (retry,
  reclassify, interrupt detection) never fires around a call that returns its failure as a value
  (`{ error }`, `undefined`, a status code): check what the wrapped call does on failure, and that
  every step of the protected sequence goes through the wrapper.
- A new mode or kind of work run through existing shared code (a run that can't be resumed, a
  different job shown in an existing progress view): list every message, hint, label and summary that
  code prints and check each still reads right for the new kind. Sibling hint paths often get the new
  flag in one place and keep the old advice in another.
- A confirmation before a destructive or hard-to-undo action: its default should be the safe answer,
  and keystrokes buffered while earlier work ran must not answer it. Compare with the change's other
  prompts.
- A retry or resend that is only safe because the receiver drops duplicates (a dedupe window, an
  idempotency key's retention, a unique key): check the retry's bound is read from that setting as
  configured, not a constant copied from its default. Shortened elsewhere, it lets a late resend be
  applied twice, usually as silent corruption rather than an error.
- Code that reads a library's state flag (`isClosed()`, `isConnected`, `readyState`) inside a callback
  or `catch` for that library's own event: check when the library sets the flag relative to firing the
  event. Many update it only after rejecting pending calls or notifying listeners, so the handler sees
  the old value and takes the wrong branch. Classify from the error or event itself where it can. If
  only its message text identifies it (no type, code or cause), check that a test against the real
  library pins that text or the versions it was checked on are recorded: a release inside the declared
  dependency range can reword it, and the case silently falls through to the generic branch.
- A draft or edit copy assigned into the committed state by reference (`saved.x = draft`) rather than
  copied: anything that later writes to the draft, including events firing after the commit, silently
  changes what counts as saved, and the next unrelated save persists it.
- State recorded from per-item events (the item the user dragged, the rows an event lists as changed)
  when the action also moves other items as a side effect, or read while a responsive view shows a
  reduced form (single column, collapsed, scaled) and written back into the full-size model. Check what
  is saved for items the event didn't name, and what the model holds after an edit in the reduced view.
- Contract compatibility:
  - NATS messages / DTOs / generated API types: renamed or removed fields, changed types, enum values
    reordered or renumbered, changed defaults. Check old panel ↔ new server and new panel ↔ old server.
  - DB schema: columns renamed/removed while old code or procs still use them; upgrade path from an
    existing customer install.
  - Public method signatures or behaviour relied on by other callers (grep callers in the worktree).
  - Config keys and file formats read by other components.
- A change that makes a stop or shutdown path take longer (a drain, a flush, a join): check the host's
  stop contract, such as a Windows service's wait hint and checkpoint, systemd's stop timeout or a
  container's grace period. The new worst case must fit it and keep reporting progress, or tools and
  installers report a failed stop even though the process exits cleanly.
- A time limit checked only between iterations, where one iteration can block without limit (a query
  with no timeout, a blocking call): the iteration in flight runs past the limit. Name what bounds a
  single iteration, and what happens to the work and its log line if a harder cut follows.
- Units and conversions: time zones, UTC vs local, milliseconds vs seconds, signed/unsigned.
- Culture and case: string comparisons that should be ordinal / case-insensitive, parsing that depends
  on the current culture.
- Loops over a reader that fetches rows in batches (bulk/multi-row recordsets, paged result iterators):
  check the advance call moves one row, not one batch. A base-class "next" can skip the rest of the
  fetched batch, so only the first row of each batch is processed. Open the reader type to confirm.
- Work done per row while a result set is still open, through a helper that runs its own query on the
  same connection: without multiple active result sets the connection is still busy with the outer
  results, so the inner query fails, or a reconnect-and-retry layer re-runs the outer query and the
  remaining rows are silently lost. Open the helper to see whether it queries; collect the rows and
  close the reader first.
- A safety net (a reconcile, sweep or orphan check) for what a primary step can miss, skipped when that
  step fails: the failure is often exactly when it's needed, such as a step with no transaction that
  commits part of its work and then errors. Check the gate's premise ("a failure means the database is
  down") against what the failure path really does, retries and reconnects included.
- An orphan check or reconcile that only asks whether a record still exists: also check it still
  belongs to this owner (machine, tenant, shard, worker). A record moved elsewhere often notifies only
  its new owner, so the old owner's copy is the same orphan.
- Newer release branches: the forward-scan file's `drift` lists files this change touches that a
  release branch it will be rebased into has also changed, with those commits and a `diffFile` of that
  branch's change. Read it for a member the PR calls or a behaviour it relies on that the branch
  renamed, removed or changed. A concrete break after the rebase is Info with the commit named; overlap
  alone isn't a finding. Where nothing merges the destination forward into that branch (its history
  shows no earlier merge from it), also read the branch's copy for the old behaviour this change
  fixes: a fix the newer line doesn't carry regresses for anyone upgrading, so Info naming the branch
  and the code still needing the change. A file the branch moved (`renamedTo`) isn't a finding: git follows the move
  on a rebase or merge, and only content changed alongside it (`pureRename: false`) can need a look.

## Severity hints
- Breaking an existing caller's contract, data loss/corruption → High.
- Defect on a normal code path → Medium.
- Defect only on a rare, recoverable path → Low unless you can name the failure concretely.

## Team history
- In-memory caches in Symmetry services (SymmetryUserCache, cached nodes in NodeStateManager/HealthStatusManager): updated on the real write path and not only on the no-change path; the refresh listener started (SymmetryUserCache.Instance.Initialize / UserFactory.Initialize) in every service that reads the cache; the service account allowed to subscribe to the refresh notification. Prefer the existing cache lookup to a new ad-hoc query.
- JetStream consumers that ack in `finally` (e.g. MultimaxSupportService AuditCommandsHandler): any new call that can throw before the write, such as a DB lookup evaluated as an argument, loses the message for good. Make such lookups best-effort.
- License "degraded" checks: use the single ILicenseValidation.IsInDegradedModeAsync definition (DegradedMode or not Active). Don't add callers to the weaker per-service variant that ignores Active.
- Values that mean both "unset" and "error": an empty connection string that silently resolves to the installed Symmetry DB, zero-initialised tick timestamps read as "just now", register/status reads that return 0 on SPI or mutex failure. Ask for an explicit flag or a bool result plus out-param.
- WiX installer (UI__MainSymmetryUI.wxs, CustomActions_*): SQL-dependent checks must sit in both OverInstall paths (the OIW* fast path on WelcomeDialog and the OIS* chain in SqlServerSelectionDialog), cover V9Install (major) and AnUpgrade (minor), and run only after the SQL login is verified. Also check Publish Order numbers per dialog, and that properties are declared Secure with a default that matches how conditions test them (= "n" vs IS NOT NULL).
- Sentinel monitor points (MonitorPointStatus): a disabled point snapshots its state at Disable and reports return-to-normal once; tamper states count as alarm states; 6-state supervision polarity is respected; no redundant Tr/Po event pairs on transitions that don't move the contact.
- esg-ng-ipc sbc codec messages: inserting a message must not renumber later message IDs (check ipc_command_router), and field types must match the D-Bus Introspect.xml signature (e.g. int32).
- Addresses a server hands clients to call back on: the path a server routes out by isn't the one a NAT or load balancer forwards in on, a cluster's floating address lives on one interface while a node's own address dies on failover, and one interface can hold several addresses. Check the address given against the one the client actually reached.
- Cert/key rotation in certManager.go: the CA and server cert saves are sequential, so a failed second write leaves a new CA with a server cert signed by the old one, and nothing ever fixes it. Look for a chain check at startup that forces renewal.
