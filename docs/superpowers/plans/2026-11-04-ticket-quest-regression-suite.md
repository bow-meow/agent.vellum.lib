# ticket-quest regression suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `C:\repos\ticket-work\_regression\` (shared modules, runner, index, a first proven test of each runnable kind) and change ticket-quest so every ticket adds or updates a test there.

**Architecture:** Part A builds the suite: four PowerShell modules under `_regression\lib\` (test lifecycle, MSAA, Symmetry stack + database guard, data setup and cleanup), a Playwright project under `_regression\web\`, `Run-Regression.ps1` reading metadata from each test's header, and `README.md` as the index. Part B changes ticket-quest: a new `references/regression-suite.md` carries the rules, and SKILL.md's steps 3–8, the HANDOVER headings, the engineer report and the red flags point at it. A new behavioural-suite scenario pins the change. Part A is usable without Part B; Part B's gate needs Part A to exist.

**Tech Stack:** Windows PowerShell 5.1 (the rig's `powershell.exe`, matching `_tools`), Pester 6.0.1 (installed), MSAA via `oleacc.dll` and the `Accessibility` assembly, `sqlcmd`, Node + `@playwright/test`, ticket-quest's `tests/suite.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-04-ticket-quest-regression-suite-design.md`

## Global Constraints

- Suite root: `C:\repos\ticket-work\_regression\`. Not a git repo; nothing in this plan commits it. Only `agent.vellum.lib` changes are committed, on branch `ticket-quest-regression-suite`.
- No test depends on a ticket folder or a hardcoded machine path; every path, server and credential is a parameter with a default read from this machine (Symmetry registry `HKLM\SOFTWARE\Group4\multiMAX\Multimax`, 32-bit view: `DatabaseInstance`, `ServerName`).
- Database is always `multiMAX` (and `multiMAXTxn`) on `DatabaseInstance`. A test database is one containing table `multiMAX.dbo.RegressionTestDatabase`. Every test refuses to run (exit 2) on any other database.
- Credentials come from env vars `SYM_REGRESSION_USER` and `SYM_REGRESSION_PASSWORD`; never written into a script. Missing ⇒ exit 2 naming both.
- Exit codes for every test and the runner: `0` pass, `1` an assertion failed, `2` environment not ready (stack would not start, guard refused, credentials missing). Runner exits with the worst code seen; a skipped test counts as 0.
- Start order when something is missing: `symmetrynats.exe`, `symmetry.activitymanagement.exe /r`, `multimaxsupportservice.exe`, `multimaxclientservice.exe`, `multimaxtxnservice.exe`, `SymmetryClient.exe`. Never stop a process the test did not start.
- Data setup through the Symmetry API where an endpoint exists; SQL otherwise, and the test's header says which objects use SQL. Everything created is deleted in a `finally`, LIFO, even after a failed assertion.
- Every test header carries, in its first 40 lines, one line each: `Feature: <plain words>`, `Tickets: SYM-1234[, ...]`, `MinVersion: <ReleaseVersion>`, `Kind: desktop|web|service|panel`. PowerShell tests put them in `.NOTES`; web tests in a leading `//` comment block.
- Tests are named by feature: `Test-<Feature>.ps1` / `<feature>.spec.ts`. One test per feature behaviour; a ticket touching a covered feature updates that test.
- Panel tests use the Docker sims (`C:\repos\esg-ng-core-linux\src-tools\docker-sim-light\docker-sims.ps1`) and must pass drive-symmetry-api's `preflight.ps1` first. Never a real panel.
- `SKILL.md` changes land only with `node suite.mjs check` passing on the whole behavioural suite (`ticket-quest/tests/README.md`), with each scenario's `history` updated.
- Comments follow the code-comments skill: a comment only where code can't say it.

## Review Focus

1. **A test run on the rig database.** Someone runs a test with the registry still pointing at the instance holding restored customer data: the guard refuses with exit 2 before any process starts or row is written (Task 3 test `refuses a database without the marker`).
2. **Already-running services from another worktree.** Support is running from a different `bin` folder than `-BinDir`: the test must not silently test the wrong binaries; it exits 2 naming both paths (Task 3 test `reports a running process from another folder`).
3. **Failure mid-setup.** Data creation fails on the third of four objects: the first two are still deleted (Task 4 test `runs cleanups registered before a failure`).
4. **A dead Debug Client.** SymmetryClient exits partway through a run: the next test starts it again instead of every later test failing with "window not found" (Task 3 test `restarts a process that exited`).
5. **An element that never appears.** A dialog never opens: the test fails within its timeout with the element dump saved, instead of hanging the runner (Task 2 test `Wait-MsaaElement times out with a dump`).

---

## Part A: the suite

### Task 1: Test lifecycle module and runner

**Files:**
- Create: `C:\repos\ticket-work\_regression\lib\Regression.psm1`
- Create: `C:\repos\ticket-work\_regression\Run-Regression.ps1`
- Create: `C:\repos\ticket-work\_regression\README.md`
- Test: `C:\repos\ticket-work\_regression\lib.tests\Regression.Tests.ps1`, `Run-Regression.Tests.ps1`

**Interfaces:**
- Produces:
  - `Get-RegressionTestInfo -Path <string>` → `[pscustomobject]@{ Path; Name; Feature; Tickets [string[]]; MinVersion [version]; Kind }`; throws naming the missing field.
  - `Invoke-RegressionTest -Name <string> -Out <string> -Body <scriptblock>` → exits the process with 0/1/2. Inside `Body`: `Assert-Regression -Condition <bool> -Message <string>` throws a `RegressionAssertion` error (⇒ 1); `Stop-RegressionEnvironment -Message <string>` throws a `RegressionEnvironment` error (⇒ 2); any other exception ⇒ 1. Runs `Register-RegressionCleanup` blocks LIFO before exiting. Writes `<Out>\<Name>\test.log`.
  - `Register-RegressionCleanup -Action <scriptblock>`; a cleanup that throws is logged and the rest still run.
  - `Add-RegressionArtifact -Name <string> -Action <scriptblock>`: blocks run only on failure (exit ≠ 0), before cleanups, each given the artifact path `<Out>\<Name>\<artifact>`.
  - `Run-Regression.ps1 [-Filter <string>] [-Kind <string[]>] [-Ticket <string>] [-Version <version>] [-Out <string>]`: discovers `tests\**\Test-*.ps1` and `web\tests\**\*.spec.ts`; skips tests whose `MinVersion` > `-Version` (default: `SELECT ReleaseVersion FROM multiMAX.dbo.VersionTable` on `DatabaseInstance`); runs each in its own `powershell.exe -NoProfile -ExecutionPolicy Bypass -File` (web: `npx playwright test <file>` in `web\`); prints a `Name | Kind | Result | Seconds` table; `-Out` default `_regression\runs\<yyyyMMdd-HHmmss>`.

- [ ] **Step 1: Write the failing Pester tests**

```powershell
Describe 'Get-RegressionTestInfo' {
  It 'reads the four header fields' { # fixture header: Feature: Reader address validation / Tickets: SYM-1, SYM-2 / MinVersion: 11.1.0 / Kind: desktop
    $i = Get-RegressionTestInfo $fixture
    $i.Tickets | Should -Be @('SYM-1','SYM-2'); $i.MinVersion | Should -Be ([version]'11.1.0'); $i.Kind | Should -Be 'desktop' }
  It 'throws naming a missing field' { { Get-RegressionTestInfo $noKind } | Should -Throw '*Kind*' }
}
Describe 'Invoke-RegressionTest' {
  It 'exits 0 and runs cleanups when the body passes'
  It 'exits 1 on a failed assertion and still runs every cleanup, newest first'
  It 'exits 2 on Stop-RegressionEnvironment'
  It 'runs later cleanups when an earlier one throws'
  It 'writes artifacts only on failure, before cleanups'
}
Describe 'Run-Regression' {
  It 'skips a test whose MinVersion is above -Version and counts it as passed'
  It 'exits with the worst code among the tests it ran' # fixtures exiting 0, 2, 1 ⇒ 2
  It 'filters by -Ticket against the Tickets field'
}
```
Each `Invoke-RegressionTest` case runs a fixture script in a child `powershell.exe` and checks `$LASTEXITCODE` and the cleanup order written to a temp file.

- [ ] **Step 2: Run them to verify they fail**

Run: `powershell -NoProfile -Command "Import-Module Pester -MinimumVersion 6.0; Invoke-Pester C:\repos\ticket-work\_regression\lib.tests -Output Detailed"`
Expected: FAIL, commands not found.

- [ ] **Step 3: Implement `Regression.psm1` and `Run-Regression.ps1` with the interfaces above**

Classify errors by `ErrorRecord.FullyQualifiedErrorId` (`RegressionAssertion`, `RegressionEnvironment`). Version comparison uses `[version]`; pad a three-part ReleaseVersion if it has fewer parts.

- [ ] **Step 4: Run the tests to verify they pass** (same command; expected: all pass).

- [ ] **Step 5: Write `README.md`**: what the suite is (two lines), the exit codes, the env vars, how to run (`Run-Regression.ps1` examples by ticket and kind), the header fields, then `## Index` with one table per kind: `| Test | Feature | Tickets | MinVersion | Command |`. Empty tables are fine until Task 5.

### Task 2: MSAA module

**Files:**
- Create: `C:\repos\ticket-work\_regression\lib\SymmetryMsaa.psm1`
- Create: `C:\repos\ticket-work\_regression\lib.tests\fixtures\MsaaFixtureForm.ps1` (a WinForms form titled `MsaaFixture` with a TextBox named `Address`, a Button `Save` that is disabled unless the text matches `^\d+\.\d+\.\d+\.\d+$`, and a Button `Open` that shows a modal `MessageBox` "Opened")
- Test: `C:\repos\ticket-work\_regression\lib.tests\SymmetryMsaa.Tests.ps1`

**Interfaces:**
- Consumes: `Add-RegressionArtifact` (Task 1).
- Produces (C# core: the user's `SymmetryMsaa` class from the spec's appendix, extended; each PowerShell function wraps it):
  - `Find-MsaaElement -Window <IntPtr> -Name <string> [-Role <int>]` → `SymmetryMsaa+Item` or `$null`
  - `Wait-MsaaElement -Window <IntPtr> -Name <string> [-Role <int>] [-TimeoutSeconds 10]` → Item; on timeout throws `RegressionAssertion` with the element dump in the message.
  - `Invoke-MsaaElement -Item <Item>` (the appendix's `Invoke`)
  - `Set-MsaaText -Item <Item> -Text <string>`: `put_accValue`, falling back to focus + `SendKeys` `^a{DEL}` then the text.
  - `Get-MsaaState -Item <Item>` → `[pscustomobject]@{ Disabled; Checked; Focused; Invisible; Value }` from `accState` bits `0x1`, `0x10`, `0x4`, `0x8000`, and `accValue`.
  - `Get-MsaaWindow -ProcessName <string> [-Title <string>] [-TimeoutSeconds 30]` → IntPtr (top-level windows of that process, including dialogs, via `EnumWindows`)
  - `Close-MsaaDialog -ProcessName <string> [-Button 'OK']` → `[string]` dialog text, or `$null` if none. Reuse the approach in `_tools\cond-cmd-outbox\J2Helpers.ps1`.
  - `Get-MsaaDump -Window <IntPtr>` → `[string]` (Name, Role table, as the appendix's `Show-Elements`)
  - `Save-WindowScreenshot -Window <IntPtr> -Path <string>` (`System.Drawing` `CopyFromScreen` over the window rect)
  - `Register-MsaaFailureArtifacts -Window <IntPtr>`: calls `Add-RegressionArtifact` for `screenshot.png` and `elements.txt`.
  - Constants: `$MsaaRole = @{ PageTab = 0x25; PushButton = 0x2B; Text = 0x2A; Dialog = 0x12 }`

- [ ] **Step 1: Write the failing tests against the fixture form** (started in a child process in `BeforeAll`, killed in `AfterAll`)

```powershell
It 'reports Save disabled for a malformed address' {
  Set-MsaaText (Find-MsaaElement $w 'Address' $MsaaRole.Text) 'not-an-ip'
  (Get-MsaaState (Find-MsaaElement $w 'Save' $MsaaRole.PushButton)).Disabled | Should -BeTrue }
It 'reports Save enabled for a valid address'      # '10.0.0.1' ⇒ Disabled false
It 'reads back the text it set'                    # Value -eq '10.0.0.1'
It 'Wait-MsaaElement times out with a dump' {
  { Wait-MsaaElement $w 'Nope' -TimeoutSeconds 2 } | Should -Throw '*Save*' }   # dump names existing elements
It 'closes a modal dialog and returns its text'    # Invoke 'Open'; Close-MsaaDialog -ProcessName powershell ⇒ '*Opened*'
It 'saves a non-empty screenshot'
```

- [ ] **Step 2: Run to verify they fail** (`Invoke-Pester ...\SymmetryMsaa.Tests.ps1`; expected: FAIL, commands not found).
- [ ] **Step 3: Implement `SymmetryMsaa.psm1`** with the interfaces above; keep the appendix's C# as the base and add `EnumWindows`, `GetWindowRect`, `put_accValue`, `get_accState`, `get_accValue` members.
- [ ] **Step 4: Run to verify they pass.**

### Task 3: Symmetry stack and database guard

**Files:**
- Create: `C:\repos\ticket-work\_regression\lib\SymmetryStack.psm1`
- Create: `C:\repos\ticket-work\_regression\Initialize-RegressionDatabase.ps1`
- Test: `C:\repos\ticket-work\_regression\lib.tests\SymmetryStack.Tests.ps1`

**Interfaces:**
- Consumes: `Stop-RegressionEnvironment`, `Register-RegressionCleanup` (Task 1).
- Produces:
  - `Get-SymmetrySetting -Section <string> -Name <string>` → string or `$null` (32-bit registry view, root `SOFTWARE\Group4\multiMAX\`; same as `_tools\txn-sim\Start-TxnSimulator.ps1`).
  - `Invoke-RegressionSql -Query <string> [-Database multiMAX] [-ServerInstance <default DatabaseInstance>]` → rows (`sqlcmd -E -C -W -s "|"`), throws on a non-zero exit.
  - `Assert-RegressionDatabase [-ServerInstance]`: `Stop-RegressionEnvironment` unless `multiMAX.dbo.RegressionTestDatabase` exists, message naming the instance and `Initialize-RegressionDatabase.ps1`.
  - `Start-SymmetryStack -BinDir <string> [-Components <string[]>]` → `[pscustomobject[]]` per component `{ Name; Started [bool]; Path }`. `Components` from `Nats, ActivityManagement, Support, Client, Txn, SymmetryClient`, default all; always started in the Global Constraints order, `ActivityManagement` with `/r`. A component already running from a folder other than `BinDir` ⇒ `Stop-RegressionEnvironment` naming both paths. A started component that is not still alive 10 s later ⇒ `Stop-RegressionEnvironment` with its exit code (the `0xE0434352` Support case). Does not stop anything it did not start; processes it started stay running after the test (the next test reuses them).
  - `-BinDir` default for every test: `$env:SYM_REGRESSION_BIN`, else the folder of the running `multimaxsupportservice.exe`, else `Stop-RegressionEnvironment`.
  - `Initialize-RegressionDatabase.ps1 -ServerInstance <string> -Backup <string> [-TxnBackup <string>]`: restores a clean `multiMAX` (and `multiMAXTxn`) backup onto that instance, sets `MachineTable` row 1 `NetworkName` to `$env:COMPUTERNAME`, creates `dbo.RegressionTestDatabase (CreatedAt datetime2, SourceBackup nvarchar(400))`. Refuses, changing nothing, when the instance already has a `multiMAX` without the marker.

- [ ] **Step 1: Write the failing tests** (SQL and process calls mocked with Pester `Mock` inside the module scope)

```powershell
It 'refuses a database without the marker'      # Invoke-RegressionSql returns no rows ⇒ throws RegressionEnvironment '*RegressionTestDatabase*'
It 'accepts a database with the marker'
It 'starts only missing components, in order'   # Nats and Support running from BinDir ⇒ starts ActivityManagement, Client, Txn, SymmetryClient in that order; Started flags match
It 'reports a running process from another folder' # Support running from C:\other ⇒ '*C:\other*' and '*<BinDir>*'
It 'reports a component that dies after start'  # process gone after the wait ⇒ RegressionEnvironment naming it
It 'restarts a process that exited'             # SymmetryClient not running on second call ⇒ started again
It 'Initialize refuses an unmarked multiMAX'    # existing multiMAX, no marker ⇒ throws, no RESTORE issued
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement `SymmetryStack.psm1` and `Initialize-RegressionDatabase.ps1`.** Start each exe with `Start-Process -WorkingDirectory $BinDir` (the `_tools\txn-rig\Run-Matrix.ps1` pattern). Process names: `symmetrynats`, `symmetry.activitymanagement`, `multimaxsupportservice`, `multimaxclientservice`, `multimaxtxnservice`, `SymmetryClient`.
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Live check on the rig (Alex runs or approves):** with a test instance initialized and the registry pointing at it, `Start-SymmetryStack -BinDir <SYM-10248 Debug\ANSI>` from a PowerShell session starts what's missing and returns six rows. Then point the registry back at the rig instance and confirm `Assert-RegressionDatabase` refuses. Record both outputs in the README's setup section.

### Task 4: Data setup and the API

**Files:**
- Create: `C:\repos\ticket-work\_regression\lib\SymmetryData.psm1`
- Create: `C:\repos\ticket-work\_regression\lib\API.md` (which API, how it authenticates, which objects it covers, which fall back to SQL)
- Test: `C:\repos\ticket-work\_regression\lib.tests\SymmetryData.Tests.ps1`

**Interfaces:**
- Consumes: `Register-RegressionCleanup` (Task 1), `Invoke-RegressionSql`, `Get-SymmetrySetting` (Task 3).
- Produces:
  - `Get-RegressionCredential` → PSCredential from the env vars, else `Stop-RegressionEnvironment`.
  - `Connect-SymmetryApi [-Credential]` → session object; `Invoke-SymmetryApi -Session -Method -Path [-Body]` → parsed response.
  - `New-RegressionName -Prefix <string>` → `"<Prefix>-rg-<8 hex>"`, so rows a crashed run left are recognisable and never collide.
  - `New-RegressionObject -Type <string> -Properties <hashtable>` → `{ Type; Id; Name; Via 'api'|'sql' }`, registering its own delete as a cleanup. Types supported at first: whatever `API.md` lists; at least `Cardholder`.

- [ ] **Step 1: Research the API (no code).** Find what the Symmetry web client calls (run it with browser dev tools, or read the server's controllers in `symmetryclassic`), and the device-management NATS API (drive-symmetry-api skill). Write `API.md`: base URL and its registry/config source, login call, and per object (cardholder, reader, door, device) the create and delete calls or `SQL` with the tables. Stop and report to the orchestrator if no HTTP API takes a login: then SQL is the default and the spec's "API where possible" applies to the NATS API only.
- [ ] **Step 2: Write the failing tests**

```powershell
It 'runs cleanups registered before a failure'  # objects 1,2 created, 3 throws ⇒ deletes for 2 then 1 run
It 'names objects with the -rg- marker'          # New-RegressionName 'Reader' -match '^Reader-rg-[0-9a-f]{8}$'
It 'stops with exit 2 when credentials are missing'
It 'creates and deletes a cardholder' -Tag Live  # against the test database: row exists after create, gone after cleanup
```

- [ ] **Step 3: Run to verify they fail** (`-ExcludeTag Live` for the offline ones; the Live one on the rig).
- [ ] **Step 4: Implement `SymmetryData.psm1`.**
- [ ] **Step 5: Run to verify they pass**, including `-Tag Live` on the rig against the test database.

### Task 5: First desktop and web tests

**Files:**
- Create: `C:\repos\ticket-work\_regression\tests\desktop\Test-DeviceManagementOpens.ps1`
- Create: `C:\repos\ticket-work\_regression\lib\SymmetryClient.psm1` (`Start-RegressionClientSession` → main window IntPtr: starts the stack, logs in through the client's login window, waits for the main window; registers failure artifacts)
- Create: `C:\repos\ticket-work\_regression\web\package.json`, `playwright.config.ts`, `lib\symmetry.ts` (fixture: login with env credentials, base URL from `SYM_REGRESSION_WEB_URL`), `tests\login.spec.ts`
- Modify: `C:\repos\ticket-work\_regression\README.md` (index rows, web setup: `npm ci` and `npx playwright install chromium` once)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: `Start-RegressionClientSession [-BinDir] [-Credential]` → IntPtr; the two tests as templates for every later ticket.

- [ ] **Step 1: Discover the login window.** With the client at its login prompt, `Get-MsaaDump (Get-MsaaWindow SymmetryClient)`; note the user, password and OK element names in `SymmetryClient.psm1`.
- [ ] **Step 2: Write `Test-DeviceManagementOpens.ps1`** (`Feature: Device Management opens from the Install ribbon`, `Tickets:` none yet, write `-`, `MinVersion: 11.1.0`, `Kind: desktop`): session, Install tab (`PageTab`, falling back to any role, as the appendix), Device Management, then **asserts** a window or element titled `Device Management` appears within 15 s. A click with no assertion is not a test.
- [ ] **Step 3: Prove it can fail:** run it with `-ExpectTitle 'No Such Window'` (a test-only parameter, default `Device Management`); expected exit 1 with `screenshot.png` and `elements.txt` in the run folder. Then run normally; expected exit 0.
- [ ] **Step 4: Write `login.spec.ts`** (header fields as above, `Kind: web`): logs in, asserts the post-login landing element is visible; a second case with a wrong password asserts the error is shown and no landing element.
- [ ] **Step 5: Run `Run-Regression.ps1`**; expected: both tests listed, both pass, summary exit 0. Add both index rows.

### Task 6: Service and panel helpers

**Files:**
- Create: `C:\repos\ticket-work\_regression\lib\SymmetrySims.psm1`
- Create: `C:\repos\ticket-work\_regression\tests\panel\Test-SimPanelOnline.ps1`
- Modify: `C:\repos\ticket-work\_regression\README.md`

**Interfaces:**
- Consumes: Tasks 1, 3, 4.
- Produces: `Start-RegressionSims -Count <int> [-SimsScript <default the docker-sims.ps1 path>]` → sim names; runs `preflight.ps1` (path: `$env:SYM_REGRESSION_PREFLIGHT`, else the installed amag-sentinel-sims plugin's `skills\drive-symmetry-api\scripts\preflight.ps1`) and `Stop-RegressionEnvironment` on a non-zero exit. Starts only missing sims; never stops sims it didn't start.

- [ ] **Step 1: Read the sentinel-sims and drive-symmetry-api skills** for the exact `docker-sims.ps1` verbs (status, spin) and onboarding over the API.
- [ ] **Step 2: Write `Test-SimPanelOnline.ps1`** (`Feature: A sim panel onboards and shows online in Symmetry`, `Kind: panel`): one sim, onboard it through the API, assert Symmetry reports it online within 120 s, delete the controller rows it created in cleanup.
- [ ] **Step 3: Prove it can fail** (stop the sim before the assertion with a test-only switch; expected exit 1), then run normally (expected exit 0). Add the index row.

No service-kind seed test: the first Txn ticket writes one, calling `_tools\txn-sim\Start-TxnSimulator.ps1` for load. The README's service section says so.

---

## Part B: ticket-quest

All paths relative to `C:\repos\agent.vellum.lib\ticket-quest\`.

### Task 7: Scenario that fails on today's skill

**Files:**
- Create: `tests/scenarios/frm-6630-postcode-validation/scenario.md`, `rubric.json`

The ticket (a different codebase, the miss's shape): a UK postcode field on a customer form must disable Save while the value is malformed; it also renames the field label. The ticket dir's `_regression\README.md` index already has `Test-CustomerFormValidation.ps1` covering the form's email validation. The engineer report: adds a new `Test-PostcodeSave.ps1` that types a bad postcode, clicks Save and prints "Done" with no assertion, plus a unit test of the label text in the repo.

- [ ] **Step 1: Write `rubric.json`** with criteria:
  - `regression-planned`: step 3 plans a regression test for the postcode behaviour, naming the existing `Test-CustomerFormValidation.ps1` to update rather than a new file.
  - `regression-asserts`: before the build, says the test must assert Save is disabled for a malformed postcode and enabled for a valid one, through the UI.
  - `gate-duplicate`: at the gate, rejects `Test-PostcodeSave.ps1` as a duplicate of the existing feature test.
  - `gate-no-assert`: at the gate, rejects the test for asserting nothing.
  - `gate-label-unit-test`: still asks for the in-repo label test to be removed (risk rules unchanged in the repo).
  - `handover-rows`: close-out puts the regression test's path, what it covers and its command line in `HANDOVER.md`.
  - pass bar `{ "mean": 4.5, "min": 4 }` out of 6.
- [ ] **Step 2: Write `scenario.md`** in the shape of `scenarios/shop-5120-line-total-rounding/scenario.md`.
- [ ] **Step 3: Run it against the current SKILL.md** (3 Sonnet runs, 3 Opus graders, per `tests/README.md`). Expected: `regression-planned`, `gate-duplicate` and `handover-rows` fail. If they pass, rework the scenario before Task 8. Append the result to `history` as `"skill": "<sha> baseline (before regression suite)"`.

### Task 8: The skill change

**Files:**
- Create: `skills/ticket-quest/references/regression-suite.md`
- Modify: `skills/ticket-quest/SKILL.md` (steps 2, 3, 4, 5, 7, 8; Handover and tools; Rationalisations; Red Flags)
- Modify: `skills/ticket-quest/references/engineering-guidelines.md` (one scoping line)
- Modify: `agents/engineer.md` (report gains **Regression test**)

- [ ] **Step 1: Write `references/regression-suite.md`** (≤ 60 lines): what the suite is and where; every ticket adds or updates one test of the behaviour it exists for, no exemptions; choosing the kind; find an existing test by the index's Feature column and update it rather than add; the header fields; self-contained (`Start-SymmetryStack`, `Assert-RegressionDatabase`, `Start-RegressionSims`), data via `New-RegressionObject`, cleanup; it must assert the behaviour and be shown failing once against the unchanged behaviour (the base build, or the test's expectation inverted); `written, not run` reporting; the risk-based rules govern repo tests only.
- [ ] **Step 2: Edit SKILL.md**, keeping the body near its current 3,938 words by putting detail in the reference:
  - step 2: on build-on, after `HANDOVER.md`, run its `Regression tests` rows before changing code.
  - step 3: read `C:\repos\ticket-work\_regression\README.md`; the test plan gains a **Regression test** line: the test to add or update (by path), its kind, and what it asserts.
  - step 4: the prompt names that test and `references/regression-suite.md`.
  - step 5: the orchestrator runs the regression test itself, and checks it fails against the unchanged behaviour.
  - step 7: a gate item: a regression test was added or updated, asserts the ticket's behaviour, passed when the orchestrator ran it (or is listed `written, not run` with why); no duplicate of an indexed feature; the index row is current. Files-changed label `regression` for `_regression\` paths; the no-risk removal rule doesn't apply to them.
  - step 8 and Handover: a `Regression tests` heading, rows `path | covers | command line`.
  - Rationalisations: "It's only a label change, no regression test" → every ticket gets one, asserting the label. "It clicked through without errors, so it passes" → a test without an assertion verifies nothing.
  - Red Flags: about to close a ticket with no `_regression\` test added or updated; about to add a test for a feature the index already covers.
- [ ] **Step 3: engineering-guidelines.md**: under Risk-based testing, one line: these rules govern tests in product repos; ticket-quest's regression suite is a separate obligation (`references/regression-suite.md` there). amag-pr-respond's behaviour is otherwise unchanged.
- [ ] **Step 4: engineer.md**: report gains **Regression test**: path, added or updated, what it asserts, the run's exit code and the failing run's exit code.
- [ ] **Step 5: Run the whole behavioural suite** on the changed skill. Expected: `node suite.mjs check $OUT/grades` exit 0. Watch `shop-5120-line-total-rounding`'s `gate-no-false-fail`: a regression test on the rounding must not make the gate fail on the label. Append every scenario's totals to its `history` with the commit.
- [ ] **Step 6: Verify the marketplace:** `node verify.mjs <plugins in catalogue order>` from the repo root; expected: no `FAIL` lines.
- [ ] **Step 7: Commit (on Alex's say-so)**

```bash
git add ticket-quest docs/superpowers/plans
git commit -m "ticket-quest: every ticket adds or updates a regression test in _regression"
```
