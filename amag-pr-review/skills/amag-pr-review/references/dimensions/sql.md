# SQL (static)

You get an index map: for each table the diff touches, its indexes, primary keys and unique constraints
found in the repo's schema scripts (the index map file listed in your material). There is no live
database.

## Look for
- **Index coverage**: for each new or changed query/proc, take the `WHERE`, `JOIN ... ON` and
  `ORDER BY` columns per table. If no index or key in the map leads with those columns, flag it.
  Functions on indexed columns (`WHERE CONVERT(date, EVTTIME) = ...`), leading wildcards
  (`LIKE '%x'`), and implicit conversions (nvarchar parameter vs varchar column) defeat indexes too.
- A table listed in `noIndexFound` may be defined outside this repo (symmetryclassic keeps its schema
  under `Database/DatabaseSchema/Databases/*/Tables/`; other repos may not): say so in the finding
  rather than claiming it has no index, and keep the severity at Low unless the query shape alone is
  the problem.
- **Injection**: SQL built by string concatenation or interpolation with any non-constant value.
- **Upgrade scripts**: not idempotent (no `IF NOT EXISTS` / `IF COL_LENGTH(...) IS NULL`), schema
  change with no matching upgrade script, data migration that updates a large table in one transaction
  (lock escalation, log growth), dropping/renaming columns still used by procs or code.
- **Procs**: `SELECT *` in procs consumed by code that maps by position; missing `SET NOCOUNT ON` where
  the caller counts rows; cursors where a set-based update works; transactions without error handling.

## Severity hints
- Missing index: at most Medium, unless the table is obviously hot (audit, events, transactions) and
  the query runs per event or per request, then Medium is the floor and High is possible with a
  concrete failure (timeouts, blocking).
- Injection → High.
- Width a newer release branch has moved away from (below) → Info.

## Newer release branches
The forward-scan file (if listed in your material) holds, per release branch this change will be
rebased into, the declarations that branch widened (`widened`) and the PR's declarations still at the
old width (`leads`). A lead means the code matches its own branch but will be out of step after the
rebase. Raise one Info finding per proc or file, not per line, naming the branch, the widths and an
example commit, and say to keep the current width here and widen it when it's rebased (matching the
other procs on this branch), unless the ticket says otherwise. Judge a lead by the kind of value, not
the entity: a node, reader or device name is the same kind of value as a group name, and widenings
roll out entity by entity, so one not yet widened is the case the lead exists for. Drop it only when
the value isn't the same kind (a name lead on a code, a GUID or a fixed-format string).

## Team history
- A proc changed under Database/DatabaseSchema/Databases/.../StoredProcedures needs a matching script under Database/DatabaseSchema/Updates/<current release>/ (e.g. 11.1.0). Putting it in an already-shipped version's folder means upgrades never run it.
- Lookups of the Sentinel network machine port by chain type must accept both ChainType 71 and 78 (HSE), or HSE databases get a second port.
- Removing a plan-stability hint (`OPTION (RECOMPILE)`, `FORCESEEK`, an index hint) from a proc: every query that loses it needs a replacement guard or a reason its plan can't go bad (equality on a unique key). Check each query on its own rather than assuming one proc's guard covers its siblings, and `git log -S` the hint to find the scenario it was added for.
