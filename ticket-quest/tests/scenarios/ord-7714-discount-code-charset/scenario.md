# Scenario: ticket ORD-7714

You are the ticket-quest orchestrator. The skill's full instructions are in the SKILL.md you were
pointed at; follow them as written. There is no real repo or Jira here: everything you would find in
steps 1-3 and at close-out is below. Do not call tools other than reading files.

## The ticket

**ORD-7714 (Story): Discount codes limited to letters, digits and hyphens**

In `orderdesk`, the store admin dashboard (an Angular app shown inside the desktop client's web view)
has a Checkout settings page whose Pricing tab holds a "Discount code" box. A code may contain only
`A-Z`, `a-z`, `0-9` and `-` (e.g. `SUMMER-25`). While the box holds any other character (`SUMMER!`,
`10%OFF`, `CAFÉ`), it shows the inline error "is not allowed in this field" and the page's Save
button is disabled; both clear once the value is valid again.

## What you found in the code (step 3)

- `web/src/app/checkout/pricing-tab.component.ts`: the form; Save is bound to `form.valid`.
- `web/src/app/shared/validation/charset.ts`: the charset validators other fields use; this one
  gets a new pattern. Nothing outside the dashboard shares it.
- `web/src/app/checkout/pricing-tab.component.spec.ts`: unit tests for the existing fields.

## The ticket root (beside the worktrees)

`<root>\` holds `_tools\`, `_regression\` and `ORD-7714\`. From `_regression\README.md`, as it
stands:

> Each test's header has `Feature`, `Area`, `Tickets`, `MinVersion`, `Kind` and optionally
> `Requires`. `Area` is a path, broad to narrow (`<product area> > <page> > <tab or part>`), reusing
> an existing branch's exact spelling; the regression page groups tests by it. `Requires` names
> shared setup steps a test needs, which `Invoke-RegressionTest` runs before the body and passes in
> as `$Setup`: `ClientSession` (logged-in desktop client), `StoreAdminView` (the dashboard open,
> web view attached), `SampleStore` (a store with one product, made through the API). The profile
> `StoreAdmin` is all three. A test never starts the apps or logs in itself.
>
> Tests run through `.\Run-Regression.ps1 -BinDir <worktree>\bin` (it installs that build's database
> and restores yours afterwards); `.\Start-RegressionUi.ps1` opens the page that shows the run.
> One run works at a time on the machine: a second waits, queued, behind a lock. A fail proof is a
> run of one test with arguments that should make it fail: `-Name <test> -TestArgs '<test-only args>'`.
>
> | Test | Feature | Area | Requires | Tickets | MinVersion |
> |---|---|---|---|---|---|
> | `tests\web\Test-ShippingRateRounding.ps1` | Checkout shipping rates round to the nearest penny | Store admin > Checkout settings > Shipping tab | StoreAdmin | ORD-6610 | 5.1 |
> | `tests\desktop\Test-StoreAdminOpens.ps1` | The store admin dashboard opens from the ribbon | Desktop client > Ribbon | ClientSession | - | 5.0 |

## The engineer's report (arrives after you delegate)

> What changed: the discount code box uses a new `discountCodeCharset` validator (`^[A-Za-z0-9-]+$`);
> its error and Save's disabled state follow the existing charset fields.
> Files: `web/src/app/shared/validation/charset.ts`, `web/src/app/checkout/pricing-tab.component.ts`,
> `web/src/app/checkout/pricing-tab.component.spec.ts`, `_regression\tests\web\Test-DiscountCodeCharset.ps1`.
> Tests added: `pricing-tab.component.spec.ts` covers the pattern; `Test-DiscountCodeCharset.ps1`
> calls `Start-AppStack`, logs in as `admin`, opens Checkout settings, types `SUMMER!` into the box
> and asserts the inline error is shown and Save is disabled. Its header has `Feature`, `Tickets`,
> `MinVersion` and `Kind: web`.
> Checks run: `npm test`, all green; ran `powershell -File tests\web\Test-DiscountCodeCharset.ps1`
> on my machine, exit 0.
> Risks: none known.

## What to produce

Write, in order, at most about 750 words in total (the close-out in C may be terse):

A. Your step-3 notes (open items, behaviour baseline, impact list), the test plan, and your routing
   decision.
B. The prompt you send the engineer.
C. After the engineer's report above: your step-7 completion-gate verdict, item by item, and what
   you send back; then your step-8 close-out: what goes into `HANDOVER.md`, as the rows and headings
   you would write.
