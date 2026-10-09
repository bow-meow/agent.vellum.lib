# Correctness and contracts

## Look for
- Logic errors: inverted conditions, wrong operator, off-by-one, wrong variable, early return that skips
  cleanup or state updates, switch/if chains missing a case the change introduced.
- Null / empty / default handling on new inputs and on values from DB, NATS, config and files.
- "Unknown" outcomes: a lookup that times out, a read caught by `catch`, an empty result. Find what the
  code falls back to, follow that value to the final output (the URL, message or row it ends up in) and
  check it does what the comment on the fallback promises. "Treat it as X when unsure" is a common
  comment whose downstream still emits the not-X value because a later step needed data the failed
  read never produced.
- An input the change now handles differently (a setting, preference or request field): list the
  kinds of value it can hold (empty, the default, each format it accepts, values that point at this
  system vs somewhere else) and compare what the base branch produced for each with what the change
  produces. Any kind whose output changed without the ticket asking is a finding, Medium when a client
  stores what it was given and can't recover on its own.
- Error handling: swallowed exceptions, broad `catch` that hides a real failure, errors that leave state
  half-written (DB row written, cache not; message acked, work not done), missing rollback, error paths
  that surface as an unhandled 500 or crash a service. A wrapper that acts on a thrown error (retry,
  reclassify, interrupt detection) never fires around a call that returns its failure as a value
  (`{ error }`, `undefined`, a status code): check what the wrapped call does on failure, and that
  every step of the protected sequence goes through the wrapper.
- Contract compatibility:
  - NATS messages / DTOs / generated API types: renamed or removed fields, changed types, enum values
    reordered or renumbered, changed defaults. Check old panel ↔ new server and new panel ↔ old server.
  - DB schema: columns renamed/removed while old code or procs still use them; upgrade path from an
    existing customer install.
  - Public method signatures or behaviour relied on by other callers (grep callers in the worktree).
  - Config keys and file formats read by other components.
- Units and conversions: time zones, UTC vs local, milliseconds vs seconds, signed/unsigned.
- Culture and case: string comparisons that should be ordinal / case-insensitive, parsing that depends
  on the current culture.
- Loops over a reader that fetches rows in batches (bulk/multi-row recordsets, paged result iterators):
  check the advance call moves one row, not one batch. A base-class "next" can skip the rest of the
  fetched batch, so only the first row of each batch is processed. Open the reader type to confirm.
- Newer release branches: the forward-scan file's `drift` lists files this change touches that a
  release branch it will be rebased into has also changed, with those commits and a `diffFile` of that
  branch's change. Read it for a member the PR calls or a behaviour it relies on that the branch
  renamed, removed or changed. A concrete break after the rebase is Info with the commit named; overlap
  alone isn't a finding. A file the branch moved (`renamedTo`) isn't a finding: git follows the move
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
