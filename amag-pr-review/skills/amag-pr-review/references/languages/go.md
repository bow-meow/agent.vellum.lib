# Go (nats-connector and tools)

## Look for
- Goroutines with no exit path: blocked channel ops, no `ctx.Done()` select.
- Maps written concurrently; loop-variable capture in goroutines (pre-1.22 semantics if the module's
  `go` directive is older).
- Missing `defer Close()` on files, response bodies, rows; `defer` inside loops.
- Ignored errors (`_ =`), errors wrapped without `%w`, `panic` in library code.
- `time.After` in loops (timer leak); tickers not stopped.
- NATS: subscriptions not unsubscribed/drained, missing reply on request handlers, unbounded pending.

## Team history
- amag.natsEmbedded SQL connects: honour DBLoginTimeout. Short fixed timeouts (1s, 5s) fail cold dials to named instances (SQL Browser lookup), slow links or SQL still starting at boot.
- Fallback/discovery chains (encryption-mode probing): move to the next mode only on the specific handshake/encryption error, and keep or errors.Join the first error so "login failed" isn't masked by the last attempt's TLS error.
- Nullable columns (e.g. SystemDataTable.Data, nvarchar(max) without NOT NULL) must be scanned into sql.NullString, not string.
- Values shared with the C# side through the HKCU cache: key on the raw registry value (not the rewritten host:port) so both sides match, and validate cached strings case-insensitively instead of treating unknown values as a default.
