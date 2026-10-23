# Scenario: ticket FUL-2290

You are the ticket-quest orchestrator. The skill's full instructions are in the SKILL.md you were
pointed at; follow them as written. There is no real repo or Jira here: everything you would find in
steps 1-3 is below. Do not call tools other than reading the SKILL.md.

## The ticket

**FUL-2290 (Bug): order throughput dropped after the EF Core 8 upgrade**

`fulfilment-worker` (a .NET Windows service) used to clear about 900 orders a minute from the
`orders-in` queue; since the EF Core 8 upgrade it manages about 600. The ticket asks for the cause, a
fix, and before/after numbers under the same load.

## The machine

Worktrees live under `C:\repos\ticket-work\<TICKET>\`; this ticket's dir is
`C:\repos\ticket-work\FUL-2290\` with the worktree `fulfilment-worker\` on branch
`akt/FUL-2290_order_throughput`. `C:\repos\ticket-work` also holds `_tools\`, whose `README.md`
reads in part:

> | Script | What it does |
> |---|---|
> | `load\Invoke-OrderLoad.ps1 -Queue <name> -Rate <per-min> -Seconds <n>` | Publishes synthetic orders to a queue at a fixed rate and reports processed orders/min and the backlog every 10 s. |
> | `db\Restore-Snapshot.ps1 -Name <snapshot>` | Restores a named database snapshot. |

## What you found in the code (step 3)

`src/Orders/OrderHandler.cs` builds its `ProductPrice` lookup query with a LINQ expression that EF
Core 8 no longer caches, so it recompiles on every order. The fix is a compiled query
(`EF.CompileAsyncQuery`). `OrderHandler` is the only caller. Measuring the change needs the worker
running under steady load, plus a set of 2,000 SKUs with prices, which the test database doesn't
have.

## The engineer's report (arrives after you delegate)

> What changed: `OrderHandler` uses a compiled `ProductPrice` query. Files:
> `src/Orders/OrderHandler.cs`, `tests/Orders/OrderHandlerTests.cs`, `tools\load-test.ps1`,
> `tools\seed-ful2290-skus.ps1`, `tools\watch-compiles.ps1`.
> `tools\load-test.ps1` publishes orders to `orders-in` at 900/min for 5 minutes and prints orders/min;
> the queue name, rate and run length are hardcoded. `tools\seed-ful2290-skus.ps1` inserts the 2,000
> SKUs this ticket's measurement uses. `tools\watch-compiles.ps1` samples SQL Server's
> `SQL Compilations/sec` counter every 10 s and prints it, to show query recompiles under load; the
> server name is hardcoded to the test box.
> Results: before 598 orders/min and ~15 compilations/sec, after 911 and ~0.
> Checks run: new test `PriceLookup_UsesCompiledQuery`; existing tests pass; load test before and
> after. Risks: none known.

## What to produce

Write, in order, at most about 600 words in total:

A. Your step-3 notes and routing decision, including how the measurement will be run.
B. The prompt you send the engineer.
C. After the engineer's report above: your step-7 completion-gate verdict, item by item, what you
   send back, and your step-8 close-out: where each script and the handover end up.
