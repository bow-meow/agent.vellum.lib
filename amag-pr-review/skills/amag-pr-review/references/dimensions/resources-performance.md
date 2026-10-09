# Resources and performance

## Look for
- **Leaks**
  - C#: `IDisposable` created without `using` (connections, commands, readers, streams, timers,
    `HttpClient` per call, `CancellationTokenSource`); event handlers subscribed without unsubscribe on
    long-lived publishers; static caches/dictionaries that only grow; closures capturing large objects.
  - C++: raw `new`/`malloc` without RAII; FDs, sockets or D-Bus refs not released on error paths;
    `shared_ptr` cycles.
  - Go: goroutines with no exit path (blocked send/receive, no `ctx.Done()`); missing `defer Close()`
    on bodies/files/rows; tickers not stopped.
- **Performance**
  - N+1: a DB call, NATS request or file read inside a loop over records.
  - Loading whole tables or large result sets to filter in memory.
  - Work added to a hot path (per event, per message, per badge swipe): allocations, reflection,
    regex construction, string formatting, logging at Info or above.
  - Blocking calls on UI threads or async contexts.
  - Unbounded retries, queues or buffers.
  - A new call to a dependency after an earlier call to it in the same pass has already failed: if
    the client retries or times out internally, each extra call repeats that stall. Check the failure
    skips the follow-up calls.
  - A cache of finished results on a per-request path: concurrent misses (cold start, expiry,
    invalidation) each run the expensive work. Cache the in-flight task, created lazily so a caller
    that loses the swap doesn't start its own.

## Severity hints
- A leak on a normal path in a long-running service → Medium.
- N+1 or full scans on tables that grow with site size (events, audit, badges, cardholders) → Medium.
- Micro-optimisations → Low/nit, or don't report.

## Team history
- amag.natsEmbedded startup: DB calls that run before the databaseErrors retry loop must be time-capped (newSqlStorageContext with a timeout, not context.Background). Don't do the same lookup twice before the listener starts. Per-attempt timeouts multiply across the ~15 newSqlStorage call sites.
- OSDP task loop: a healthy port must get back to the event-group wait at OSDP_TICK_INTERVAL. Chained transmit/retry loops that never reach it free-run at the inter-command floor, multiplied by 8 readers on one RX task. Retry loops should also check the teardown and SBCQ events before vTaskDelay.
- SC16IS752 SPI traffic: per-byte mutexed transactions with FIFOs disabled, read-modify-write of IER on every enable/disable, and logging inside a mutex-held window or ISR.
- Firmware memory budgets (m33, esg-ng-ipc): oversized fixed buffers for short values, and stack-size increases not backed by a measured high-water mark (FreeRTOS reports unused words, so a low figure is the bad one).
- Endpoints the dashboard polls (e.g. every 30s): removing a short-circuit gate makes the DB query and the NATS reachability probe run on every poll for every install.
