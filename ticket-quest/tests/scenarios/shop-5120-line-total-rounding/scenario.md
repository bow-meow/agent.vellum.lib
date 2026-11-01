# Scenario: ticket SHOP-5120

You are the ticket-quest orchestrator. The skill's full instructions are in the SKILL.md you were
pointed at; follow them as written. There is no real repo or Jira here: everything you would find in
steps 1-3 is below. Do not call tools other than reading the SKILL.md.

## The ticket

**SHOP-5120 (Bug): order summary totals are a cent off the invoice**

Customers report the order summary page in `storefront` (an ASP.NET Core web app) sometimes shows a
line total one cent lower than the PDF invoice they are emailed. Finance says the invoice is right:
line totals round half away from zero to 2 decimal places, refunds (negative lines) included.

While you're in there, from the same customer call:

- the summary page's export button reads "Exprt"; it should read "Export";
- the summary page's pager shows 20 lines per page; make the default 50;
- support asked for an Information log line when the summary page loads, with the order id.

## What you found in the code (step 3)

- `src/Orders/OrderTotals.cs`: `LineTotal(decimal unitPrice, int qty)` computes
  `Math.Floor(unitPrice * qty * 100) / 100`, truncating. Its only caller is
  `OrderSummaryViewModel.Build`, which the `OrderSummary` page's `OnGet` calls. The invoice PDF is a
  separate service with its own rounding; nothing in `storefront` shares this code.
  `OrderTotalsTests` has two tests, both on whole-cent amounts.
- `Pages/OrderSummary.cshtml`: the button text is a literal `Exprt`.
- `Components/Pager.razor`: `const int DefaultPageSize = 20;`, used only by the summary page. No tests.
- `Pages/OrderSummary.cshtml.cs`: `OnGet` has no logging; `ILogger<OrderSummaryModel>` is already
  injected.

## The engineer's report (arrives after you delegate)

> What changed: `LineTotal` now returns `Math.Round(unitPrice * qty, 2)`; button text fixed; pager
> default 50; `OnGet` logs `"Order summary loaded for {OrderId}"` at Information.
> Files: `src/Orders/OrderTotals.cs`, `Pages/OrderSummary.cshtml`, `Components/Pager.razor`,
> `Pages/OrderSummary.cshtml.cs`, `tests/OrderTotalsTests.cs`, `tests/OrderSummaryPageTests.cs`,
> `tests/PagerTests.cs`.
> Tests added: `LineTotal_RoundsUp` (1.003 x 1 → 1.00, 2.346 x 1 → 2.35) calling `OrderTotals`
> directly; `ExportButton_Text_IsExport` renders the page and asserts the button text;
> `Pager_DefaultPageSize_Is50` asserts `Pager.DefaultPageSize == 50`; `OnGet_LogsOrderId` mocks the
> logger and verifies the call. Characterization: `Pager_ShowsTwentyRows` and
> `ExportButton_Text_IsExprt` were written against the old code first, then updated.
> Checks run: `dotnet test` on the test project, all green. Risks: none known.

## What to produce

Write, in order, at most about 600 words in total:

A. Your step-3 notes (open items, behaviour baseline, impact list), which behaviours get tests and
   which don't, and your routing decision.
B. The prompt you send the engineer.
C. After the engineer's report above: your step-7 completion-gate verdict, item by item, and what
   you send back.
