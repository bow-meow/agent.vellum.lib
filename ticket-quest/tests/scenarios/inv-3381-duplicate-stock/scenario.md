# Scenario: ticket INV-3381

You are the ticket-quest orchestrator. The skill's full instructions are in the SKILL.md you were
pointed at; follow them as written. There is no real repo or Jira here: everything you would find in
steps 1-3 is below. Do not call tools other than reading the SKILL.md.

## The ticket

**INV-3381 (Bug): stock counts double after a broker reconnect**

After the RabbitMQ broker restarts, `inventory-sync` (a .NET Windows service) sometimes applies the
same `StockAdjusted` message twice, so a warehouse shows double the stock it really has.

Comment from the QA lead: "I can't reproduce this by hand. I'll need some way to rerun whatever
repro you come up with."

## Where the ticket stands

This ticket was started in an earlier session. The ticket dir `C:\repos\ticket-work\INV-3381\`
already exists with the worktree `inventory-sync\` on branch `akt/INV-3381_duplicate_stock`; the
user chose build-on. The ticket dir also holds a `HANDOVER.md` from that session. Nothing else from
the earlier session is in your context.

## What you found in the code (step 3)

`src/Sync/StockConsumer.cs` acks a message after `ApplyAdjustment` commits. On a reconnect the
broker redelivers unacked messages; if the connection dropped between the commit and the ack, the
message is applied again. `ApplyAdjustment` has no idempotency check; messages carry a unique
`AdjustmentId`. Only `StockConsumer` calls `ApplyAdjustment`. `StockConsumerTests` covers a single
delivery only.

## The engineer's report (arrives after you delegate)

> What changed: `ApplyAdjustment` records each `AdjustmentId` in a `processed_adjustments` table in
> the same transaction and skips one it has seen. Files: `src/Sync/StockConsumer.cs`,
> `src/Sync/Migrations/0042_processed_adjustments.sql`, `repro.sh`.
> Repro: I wrote `repro.sh` in the repo root; it starts the service against a local broker, publishes
> 500 adjustments, restarts the broker mid-stream and diffs the stock totals. The broker host and the
> message count are hardcoded. Before the fix it shows 37 duplicates; after, 0.
> Checks run: new test `Redelivery_AfterCommit_IsSkipped` through the consumer's message handler;
> existing tests pass; `./repro.sh` before and after. Risks: none known.

## What to produce

Write, in order, at most about 600 words in total:

A. What you do on picking the ticket up, and your step-3 notes and routing decision.
B. The prompt you send the engineer.
C. After the engineer's report above: your step-7 completion-gate verdict, item by item, what you
   send back, and your step-8 close-out: where the repro and the handover end up.
