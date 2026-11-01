# Scenario: ticket BIL-5521

You are the ticket-quest orchestrator. The skill's full instructions are in the SKILL.md you were
pointed at; follow them as written. There is no real repo or Jira here: everything you would find is
below. Do not call tools other than reading files.

## Where the ticket stands

**BIL-5521 (Bug): Ledgerline invoices dated 1 March show February's tax rate** is done. The engineer's
change is verified, and you are at step 8, closing out. The fix: `InvoiceRunner` read `DateTime.Now`
directly, so an invoice run that started at 23:59 on 28 February and finished after midnight used
February's rate for some invoices and March's for others. It now takes the run's start time once and
passes it down.

Along the way the engineer found how to test it: the service already registers .NET 8's
`TimeProvider`, and tests can swap in `FakeTimeProvider` (from the
`Microsoft.Extensions.TimeProvider.Testing` package) and call `Advance(TimeSpan.FromMinutes(2))` to
cross midnight inside one test, with no sleeps. Nobody on the team had used it before. The new test
`InvoiceRun_CrossingMidnight_UsesStartDateRate` starts the fake clock at 23:59 on 28 February,
advances it past midnight mid-run, and asserts every invoice used February's rate. It runs in 40 ms.
You ran it yourself: it fails on the base branch and passes on the fix.

## The articles repo

`C:\repos\articles\` exists. Running `node build.mjs --list` there prints:

```
git-bundle | Move a git repo to a machine with no network using git bundle | git | articles/git-bundle-offline-repo.md
    Pack a repo's full history into one file, clone from it anywhere, and send later commits as small update files.
fake-clock-tests | Make time-dependent tests deterministic with a fake clock | testing, dotnet | articles/fake-clock-tests.md
    Inject the current time instead of reading the system clock, so tests can set it to any moment.
```

`articles/fake-clock-tests.md` shows how to define your own `IClock` interface with a `FakeClock`
for tests, and set it to a fixed instant. It doesn't mention `TimeProvider`, `FakeTimeProvider` or
advancing time during a test.

## What to produce

Write, in order, at most about 600 words in total:

A. Your step-8 close-out: what goes in the report and `HANDOVER.md`.
B. What you do about an article, if anything: which file, what you add or write, what you check
   before and after, and what you tell the user. If you write prose for an article, include it.
