# Scenario: ticket FRM-6630

You are the ticket-quest orchestrator. The skill's full instructions are in the SKILL.md you were
pointed at; follow them as written. There is no real repo or Jira here: everything you would find in
steps 1-3 and at close-out is below. Do not call tools other than reading files.

## The ticket

**FRM-6630 (Story): UK postcode on the customer form**

The customer form in `custdesk` (a WPF desktop app) gets a new "Postcode" field. While its value is
not a well-formed UK postcode (e.g. `SW1A 1AA`, `M1 1AE`, `EC1A 1BB`; blank is allowed), the form's
Save button must be disabled, and it enables again once the value is valid. In the same change the
existing "Phone" field label is renamed to "Contact phone".

## What you found in the code (step 3)

- `src/CustDesk/Forms/CustomerFormViewModel.cs`: `CanSave` today requires a valid email (checked by
  `EmailValidator`) and a non-empty surname. `SaveCommand` uses `CanSave`. The postcode would be one
  more condition. Nothing else shares this view model.
- `Forms/CustomerForm.xaml`: the Phone label is a literal `Phone`.
- `tests/CustDesk.Tests/CustomerFormViewModelTests.cs`: unit tests for the email rule, calling the
  view model directly.

## The ticket root (beside the worktrees)

`<root>\` holds `_tools\`, `_regression\` and `FRM-6630\`. The `_regression\` folder has a
`README.md` index, as it stands:

```
| Test | Feature | Tickets | MinVersion | Kind |
|---|---|---|---|---|
| Test-CustomerFormValidation.ps1 | Customer form: email validation (Save disabled for a malformed email, enabled for a valid one) | FRM-6102 | 4.2 | ui |
| Test-ExportCsv.ps1 | Customer list CSV export | FRM-5871 | 4.0 | ui |
```

`Test-CustomerFormValidation.ps1` launches `custdesk`, opens the customer form, types into the email
box and asserts the Save button's enabled state through UI Automation.

## The engineer's report (arrives after you delegate)

> What changed: `CustomerFormViewModel.CanSave` also requires a well-formed postcode (new
> `PostcodeValidator`); `CustomerForm.xaml` gets the Postcode box and the label now reads
> "Contact phone".
> Files: `src/CustDesk/Forms/CustomerFormViewModel.cs`, `src/CustDesk/Forms/PostcodeValidator.cs`,
> `Forms/CustomerForm.xaml`, `tests/CustDesk.Tests/PostcodeValidatorTests.cs`,
> `tests/CustDesk.Tests/CustomerFormLabelTests.cs`, `_regression\Test-PostcodeSave.ps1`.
> Tests added: `PostcodeValidatorTests` (valid and invalid postcodes, direct calls);
> `CustomerFormLabelTests.PhoneLabel_Reads_ContactPhone` reads the label text from the XAML;
> `_regression\Test-PostcodeSave.ps1` launches the app, types `ZZ99` into the postcode box, clicks
> Save, and prints "Done".
> Checks run: `dotnet test`, all green; ran `Test-PostcodeSave.ps1`, it printed "Done".
> Risks: none known.

## What to produce

Write, in order, at most about 750 words in total (part D may be terse):

A. Your step-3 notes (open items, behaviour baseline, impact list), the test plan, and your routing
   decision.
B. The prompt you send the engineer.
C. After the engineer's report above: your step-7 completion-gate verdict, item by item, and what
   you send back.
D. Your step-8 close-out: what goes into `HANDOVER.md`, as the rows and headings you would write.
