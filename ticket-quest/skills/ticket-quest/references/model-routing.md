# Model routing

The engineer agent defaults to Sonnet; you set the model per dispatch (the Agent tool's `model`
parameter, which overrides the agent's default). Pick the first row that fits:

| Task | Model |
|---|---|
| A few lines in one file, nothing risky on its impact list | You, directly. Delegating costs more than the edit. |
| Find files, symbols, callers; run a build or tests and relay the output | `ticket-quest:scout` (Haiku) |
| Feature, bug fix, refactor, tests, review of a diff | Engineer on Sonnet |
| Architectural change, shared code, concurrency, a bug whose cause is still unclear, or the Sonnet engineer's second attempt after one corrective attempt failed | Engineer on Opus |
| A change touching auth, permissions, certificates, secrets or other security-sensitive code, and its review | Engineer on Opus |
| An escalation trigger from SKILL.md's "When to consult the advisor" | Advisor (Fable) |

A scout reports; it does not decide. Every claim it relays still goes through the Iron Law.

At most one Sonnet attempt and one corrective attempt per task, then Opus or the advisor: a third
variation on the same model is the loop this routing exists to prevent.

Note the model, the usage the Agent result reports and the outcome of each delegation as you go,
and give the totals at close-out, so the routing can be tuned on what it cost per finished task.
