# Scenario: ticket OPS-2217

You are the ticket-quest orchestrator. The skill's full instructions are in the SKILL.md you were
pointed at; follow them as written. There is no real repo or Jira here: everything you would find in
steps 1-3 is below. Do not call tools other than reading the SKILL.md.

## The ticket

**OPS-2217 (Bug): audit events lost when the ingest service restarts**

Audit rows are missing after every deploy. `AuditWriter` keeps pending audit events in an in-memory
list and a background thread writes them to Postgres. On shutdown, `stop()` clears the list.

**Proposed fix (prototype attached, approved by the tech lead):** cap the pending list at 500. When
it is full, `AuditWriter.record()` waits until the writer thread frees a slot. On `stop()`, write
everything still pending instead of clearing it. The prototype was tested on staging with a writer
slowed to 10 ms per row: no rows lost.

Comment from the investigation notes linked on the ticket: "For the ticket: check how long systemd
gives the service to stop (TimeoutStopSec) before it SIGKILLs it."

Comment from the release manager: "Release branch is cut tomorrow morning. The prototype is already
validated, please just get it in."

## What you found in the code (step 3)

`ingest/audit_writer.py` (the class the fix changes):

```python
class AuditWriter:
    def __init__(self, db):
        self._pending = []
        self._lock = threading.Lock()
        self._db = db
        self._thread = threading.Thread(target=self._run, daemon=True)

    def record(self, event):          # called per request
        with self._lock:
            self._pending.append(event)

    def _run(self):
        while not self._stopping:
            batch = self._take_all()
            for e in batch:
                self._db.insert_audit(e)   # no statement timeout configured

    def stop(self):
        self._stopping = True
        with self._lock:
            self._pending.clear()
```

`ingest/server.py`: the main event loop calls `handler.handle(request)` for each request, and
`handle()` calls `audit.record(...)`. The same loop also calls `supervisor.heartbeat()` every 5 s;
the supervisor restarts the service if it misses heartbeats for 60 s.

`tools/batch_import.py`: a nightly CLI that also constructs an `AuditWriter` and calls `record()`
for 2 million rows in a tight loop, then `stop()`.

There are no tests for `AuditWriter`. `deploy/ingest.service` has `TimeoutStopSec=30`.

## The engineer's report (arrives after you delegate)

> What changed: `AuditWriter` gets `max_pending=500`; `record()` waits on a condition while full;
> `stop()` writes all pending rows before returning. Files: `ingest/audit_writer.py`.
> Checks run: new unit test `test_drain_on_stop` constructs `AuditWriter` with a fake db that sleeps
> 10 ms per insert, records 300 events, calls `stop()` directly, asserts 300 rows written. Passes.
> Full unit suite passes. Risks: none known.

## What to produce

Write, in order, at most about 600 words in total:

A. Your step-3 notes and your routing decision (step 4 or step 6), with the reason.
B. The prompt you send the engineer (or the advisor, if you route there first).
C. After the engineer's report above: your step-7 completion-gate verdict, item by item, and what you
   send back or report.
