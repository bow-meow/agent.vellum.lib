# Concurrency and races

Races are subtle: name the exact interleaving (thread/request/message A does X, B does Y, result Z).

## Look for
- **In-process**
  - Shared fields, statics, singletons or collections mutated from more than one thread without a lock
    or a concurrent type; check-then-act on shared state (`if (!dict.ContainsKey(k)) dict[k] = ...`).
  - `async` code: state read before an `await` and used after it while another caller can change it;
    `async void` outside event handlers; `.Result` / `.Wait()` / `GetAwaiter().GetResult()` on a
    context that can deadlock; fire-and-forget tasks whose exceptions vanish.
  - Set-then-clear brackets on one shared slot (`set(x)` … `finally set(null)`, a single "current
    operation" field, telling a host "busy" then "idle"): two overlapping runs let the first to finish
    clear the second's state. Needs a count, a per-run key, or proof the runs can't overlap. This
    applies to single-threaded JS too, where overlapping `async` calls interleave at every `await`.
  - A gate, lock or busy flag that orders work against a disruptive action (a reconnect, a flush, a
    reload): check every path that performs the action goes through it, not only the one the change was
    written for (a timer, a deferred callback, a retry). Work skipped because the moment was wrong
    (disconnected, busy, not ready) must be re-run when that clears, not silently dropped.
  - Lazy initialisation without `Lazy<T>` / lock / `sync.Once`; double-checked locking without volatile.
  - Lock ordering: two locks taken in different orders on different paths.
  - Timers and event handlers firing during or after teardown/dispose.
  - C++: data races on members touched from D-Bus/NATS callbacks and a worker thread; `std::atomic`
    used for one field but not the invariant it protects. Go: maps written from goroutines, loop
    variable capture, unsynchronised struct fields.
- **Database**
  - Check-then-insert / check-then-update without a unique constraint, `UPDLOCK/HOLDLOCK`, or suitable
    isolation → duplicates or lost updates.
  - Read-modify-write of a counter or status without a conditional update.
  - Cache refreshed from the DB while a write is in flight → stale cache that never corrects.
- **Distributed (server ↔ panel over NATS)**
  - Messages arriving out of order or twice: is the handler idempotent? Does it rely on order?
  - Request/reply timeouts: the reply arriving after the caller gave up and moved on.
  - State changes racing a panel reconnect, re-onboard, or controller refresh.
- **Filesystem / process**: TOCTOU (exists-then-open), two service instances starting at once, temp
  files with fixed names.

## Severity hints
- A race with a concrete, reachable interleaving that corrupts data or duplicates records → High/Medium.
- A race that needs an unrealistic timing window, or only affects logging → Low.

## Team history
- 8DC reader pairs share one SC16IS752 channel and the muxA1 select: interrupt-enable caches and IER state must be keyed per (chip, channel), not per port; the IRQ routing table (m_pairSelectedReader) must be updated before the mux pin flips; check the pairing table entries (READER7/8) and odd-port routing.
- Pair lock / pair search mutex (Pal8_ReaderLock, Pal_PairSearchMutexTake/Give): a false return must mean "not held", so owner and semaphore are released when the mux write fails. The lock is released on every early return (no-key/install-disabled branch, sweep wrap, follower-lock transition, OsdpTeardown). Blocking portMAX_DELAY acquires must not have their result discarded.
- FreeRTOS teardown ordering in the OSDP/MCLP reader tasks: stop the UART and ISR sources before deleting the task's event group or context, including on the notify-timeout branch. A peer left marked active after a failed teardown can make both ports skip the real UART deinit.
- Shared UART hardware initialised or deinitialised from two reader tasks at boot (InitHardware outside the pair mutex, peer session state read without a lock) can stomp registers mid-transmit.
