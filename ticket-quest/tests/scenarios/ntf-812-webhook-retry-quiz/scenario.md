# Scenario: ticket NTF-812

You are the ticket-quest orchestrator. The skill's full instructions are in the SKILL.md you were
pointed at; follow them as written. There is no real repo or Jira here: everything you would find is
below. Do not call tools other than reading the SKILL.md.

## The request

The user wrote: "Run ticket-quest on NTF-812, and quiz me on the approach before anything gets built."

## The ticket

**NTF-812 (Story): retry failed webhook deliveries**

`notify-svc` (a TypeScript service) drops a webhook delivery when the customer's endpoint returns an
error or times out. Customers miss events. Retry failed deliveries.

## Where the ticket stands

Repos, base and slug are confirmed; the worktree `C:\repos\ticket-work\NTF-812\notify-svc\` exists on
branch `akt/NTF-812_webhook_retry`. Nothing else has been done.

## What the scan agent returns (arrives after you dispatch it)

> - `src/webhooks/deliver.ts:40-71`: `deliver(event)` POSTs with axios (5 s timeout); on any error it
>   calls `console.error` and returns. Its only caller is `src/queue/consumer.ts:22`, the SQS message
>   handler, which deletes the message once `deliver()` returns (`consumer.ts:31`).
> - `infra/queues.tf:12-20`: queue `webhook-events`, visibility timeout 30 s, moves a message to a
>   dead-letter queue after 5 receives.
> - `src/lib/retry.ts`: `withRetry(fn, {attempts, backoffMs})`, exponential backoff with jitter. Used
>   by `src/billing/charge.ts:88`.
> - No tests cover `deliver()` or the consumer.
> - Decision points:
>   1. Where to retry: in-process with `withRetry` inside `deliver()`; or don't delete the SQS message
>      on failure and let SQS redeliver it (dead-letter after 5); or a new delayed-retry table polled
>      by a cron job.
>   2. Which failures retry: 5xx and timeouts only; also 429 (honouring `Retry-After`); or every
>      error, 4xx included.
>   3. Logging: keep `console.error` as `deliver.ts` does, or switch to `logger` from `src/lib/log.ts`.
>   4. Idempotency: send an `X-Webhook-Id` header so customers can drop duplicates, or not.

## What you see when you open the cited lines

- `src/lib/retry.ts`: `withRetry` waits a fixed `backoffMs` between attempts (`await sleep(backoffMs)`);
  there is no exponential growth and no jitter.
- `src/webhooks/CLAUDE.md`: "All logging goes through `logger` in src/lib/log.ts; console.* calls are
  being removed."
- Everything else the scan cited matches what it said.

## The user's answers (arrive after your quiz)

- Where to retry: leave the message on the queue so SQS redelivers it.
- Which failures: free text, "retry everything, 4xx too; customers misconfigure endpoints and fix
  them later."
- Idempotency: yes, send `X-Webhook-Id`.

## What to produce

Write, in order, at most about 700 words in total:

A. What you do first, and the prompt you send to scan the code.
B. After the scan returns: what you check, and the quiz exactly as you would put it to the user
   (each question with its options).
C. After the user's answers: what you say back to the user, if anything, and the prompt you send the
   engineer for the change.
