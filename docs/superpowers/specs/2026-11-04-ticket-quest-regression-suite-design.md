# ticket-quest: a regression suite every ticket adds to

## Intent

Features and fixes delivered through ticket-quest regress silently: a field that should block a bad
value stops blocking it, a button that should be disabled is enabled again, and nobody notices until a
customer does. Each ticket's verification today is thrown away once the ticket closes (or survives
only as a ticket-specific `tools\` script).

The change: every ticket ticket-quest works leaves behind at least one automated regression test of
the behaviour it delivered, in one shared suite that an agent or a person can run cold, and that a
build system can run later. When a bug comes back on that work, the ticket's `HANDOVER.md` points straight at the tests
covering it, so the revisit starts by rerunning them.

Motivating example (the user's): client-side validation. A test enters a wrongly formatted value and
asserts the button that would act on it is disabled.

## Goals

- One suite folder, `C:\repos\ticket-work\_regression\`, beside `_tools\` (not inside it, not in a
  product repo). *Location is Claude's call; the user decided "not in the repo" and "separate from
  `_tools`".*
- Every ticket adds a regression test, or updates the existing one when a test already covers the
  behaviour the ticket changes. No duplicate tests for one behaviour. **No ticket is exempt** (the
  user's words): a label change gets a test asserting the label; a logging-only or diagnostics
  deliverable gets a test asserting the record appears; a hardware-only bug gets a test against a
  sim. A test written but not runnable in this session is reported at the gate as written and not
  run, with why; a missing test fails the gate.
- Three test kinds, chosen by what the ticket touched:
  - **Desktop UI** (SymmetryClient and other C# WinForms UI): PowerShell, driving the UI through MSAA
    (the approach in the user's example script, below).
  - **Web UI** (the Symmetry web client): Playwright. Node is installed on the machines that run it.
  - **Service** (no UI, e.g. a Txn service fix): PowerShell that drives the service and checks the
    database, in the same folder.
  - **Panel** (ESG / Sentinel tickets): PowerShell that runs the simulated panels in Docker
    (`docker-sims.ps1`, `src-tools/docker-sim-light` in `esg-ng-core-linux`; the sentinel-sims skill),
    brings up whichever sims it needs the way the other kinds start missing services, drives them
    against Symmetry, and checks the result on the panel or in Symmetry. Before acting on a sim it
    runs the drive-symmetry-api `preflight.ps1` checks (app set, the build under test is the running
    API, database clean). Tests never target a real panel.
- Each test is self-contained: checks that Symmetry and every service it needs (Activity Management,
  Support, Client, Txn, NATS, as the test requires) are running and starts whichever is not, in the
  required order; logs in; creates its own data; runs its checks; deletes everything it created; and
  exits non-zero on failure. It does not stop services that were already running. Server,
  credentials and the binaries under test are parameters, defaulting to this machine's debug system.
- Data is set up behind the UI: the Symmetry API where possible, SQL only where no API call exists.
- An index, `_regression\README.md`, one row per test: the feature it covers in plain words, the SYM
  ticket(s) that created or last changed it, and the exact command line.
- Traceability both ways: the index names tickets; each ticket's `HANDOVER.md` names its tests and
  their command lines.

## Non-goals

- Replacing in-repo unit/integration tests. The existing risk-based testing rules still govern tests
  committed to product repos.
- Changing what `_tools\` is for. It stays the place for local helpers (drivers, probes, rig tests)
  under its current rules. A regression test may *call* a `_tools\` script (e.g.
  `txn-sim\Start-TxnSimulator.ps1` for load).
- Sharing or distributing the suite. For now it is local to this machine, not a git repo, and only
  the user and their agents run it; it moves into a build system later. Tests are still written as
  if another machine will run them (no hardcoded paths, no ticket-folder dependencies), so that move
  needs no rewrite. Nothing in the workflow commits the suite.

## Anti-goals (would make this a failure even if it works)

- Tests that click and report "Done!" without asserting anything. Every test asserts the behaviour
  the ticket delivered (a state, a value, a row), not that a button was clickable.
- Tests that only pass on the machine or in the conversation that wrote them: hardcoded paths,
  ticket-folder dependencies, data assumed to exist, a client assumed to be already running.
- Tests that leave data behind, so the suite degrades run by run.
- A pile of near-duplicate tests per ticket instead of one test per feature, kept current.

## Constraints

- **The skill's behavioural suite.** `ticket-quest/tests/README.md`: no change to `SKILL.md` lands
  unless the scenario suite passes on it, and a change adds a scenario for the behaviour it
  introduces. This change needs at least one new scenario (a ticket that finishes without a
  regression test, or adds a duplicate instead of updating one, must be graded down).
- **`references/engineering-guidelines.md` is shared with amag-pr-respond.** Its "not a risk, so no
  test" list (UI text, layout, UI-only default) conflicts with "every ticket gets a regression test".
  Resolve it by scoping, not by deleting the list: the risk rules govern tests in the product repo;
  the regression suite is a separate obligation owned by ticket-quest's workflow. amag-pr-respond's
  behaviour must not change. The completion gate's "a test for a no-risk behaviour is removed from the
  diff" must not fire on `_regression\` paths.
- **Existing helper rules.** SKILL.md's helper table and completion gate fail any `helper` path in a
  worktree and route reusable scripts to `_tools\`. `_regression\` is a new destination with its own
  label (e.g. `regression`) in the step-7 files-changed rows; it is not a `helper`.
- **The orchestrator doesn't build.** Writing the regression test is an engineer task like any other;
  the orchestrator verifies it by running it.
- **Known environment gotchas** in `_tools\README.md` apply: the Debug Client leaks and dies on long
  runs; binaries must match the database; startup order (Activity Management `/r`, Support, Client,
  Txn).

## Decided by the user

- Tests live outside product repos, in one suite folder separate from `_tools\`.
- Every ticket adds or updates a test; UI tickets get UI tests, others get service-and-database tests.
- Each test sets up its own data and login; data via API where possible; each test deletes what it
  created.
- The suite's index describes what each test covers, by feature and SYM ticket.
- Runners: an agent or a person now; a build system later. Kept local until then.
- Tests check that Symmetry and its services are running and start what isn't.
- No ticket is exempt.
- ESG tickets are tested against the Docker sim panels.
- Tests run only against a dedicated test database, never the rig database holding restored
  customer data. A test refuses to start when the running system points at any other database.
  How the test database is created, identified and selected is left to the builder.
- A revisited ticket's worktree/handover points to its regression tests.
- PowerShell + MSAA for C# UI; Playwright for the Symmetry web client.

## The desktop UI starting point

The user's working example (verbatim in the appendix) finds SymmetryClient's main window, walks every child window's MSAA tree
(`AccessibleObjectFromWindow` + `AccessibleChildren`, depth ≤15), finds an element by name and
optional role, and invokes it with `accDoDefaultAction`, falling back to a mouse click at its
`accLocation` centre. On a miss it dumps every named element and its role. That block becomes the
core of a shared module that each desktop test imports, never pastes. It needs, at least:

- set an edit field's text (`accValue`, or focus plus keystrokes where `put_accValue` isn't supported);
- read an element's state (`accState`: `STATE_SYSTEM_UNAVAILABLE` 0x1 = disabled, also checked,
  focused, invisible) and value;
- wait for an element/window to appear, with a timeout, instead of fixed sleeps;
- find and dismiss dialogs (reuse what `_tools\cond-cmd-outbox\J2Helpers.ps1` already does);
- assertions that fail with the element dump attached.

## Claude's calls (check these)

- Location `C:\repos\ticket-work\_regression\`.
- Tests named by feature (`Test-ReaderAddressValidation.ps1`), not ticket; tickets go in the index
  and the help block, because several tickets touch one feature over time.
- Cleanup in `try/finally` so a failed check still deletes its data.
- On failure, save a screenshot (desktop and web) and the MSAA element dump beside the test's log.
- One runner, `Run-Regression.ps1`, runs all tests or a filter (by ticket, feature area or kind) and
  prints a pass/fail summary with a non-zero exit if any failed; it's what a build machine calls.
- SQL fallback for setup is named in the test's help block, so it can move to the API later.
- The test a ticket adds covers the behaviour the ticket exists for, with its edge cases where they
  are risks; when that behaviour is a label, the test asserts the label.
- Each test declares the minimum Symmetry version it applies to (an index column and a help-block
  field); the runner skips tests newer than the build under test. A release-branch ticket updates
  the same test, widening or narrowing its range, rather than forking it.
- Setup API: the builder establishes which API (REST, the NATS device-management API, COM) covers
  the objects the first tests need, and records in the shared setup module where SQL stands in.

## Left to the builder

- Suite folder layout beneath `_regression\` (by product area, by kind, or flat), and where the
  shared MSAA module and the Playwright project/config sit.
- How login and API calls are wrapped (one shared module is expected), and how credentials are passed
  without being written into scripts.
- Exactly where in the SKILL.md workflow the regression test is planned (step 3's test plan is the
  natural place), delegated (step 4), verified (step 5: the orchestrator runs it), gated (step 7) and
  recorded (step 8 and `HANDOVER.md`'s headings).
- On build-on of an existing ticket, reading its `HANDOVER.md` regression rows and running them before
  changing code.
- The new behavioural-suite scenario(s) and rubric.
- Seeding the suite: whether to write a first desktop test from the user's Device Management example
  to prove the module before any ticket depends on it.
- How a test starts each missing service (start order and gotchas are in `_tools\README.md`), and
  how it restarts the Debug Client when it dies mid-run.

## Appendix: the user's working MSAA example

Opens the Install ribbon tab, then Device Management, in a running SymmetryClient.

```powershell
if (-not ([System.Management.Automation.PSTypeName]'SymmetryMsaa').Type) {
    Add-Type -ReferencedAssemblies Accessibility -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Accessibility;

public static class SymmetryMsaa {
    [DllImport("oleacc.dll")]
    static extern int AccessibleObjectFromWindow(IntPtr hwnd, uint id, ref Guid iid,
        [MarshalAs(UnmanagedType.IUnknown)] out object obj);
    [DllImport("oleacc.dll")]
    static extern int AccessibleChildren(IAccessible parent, int start, int count,
        [Out] object[] children, out int obtained);
    delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] static extern void mouse_event(uint f, uint x, uint y, uint d, UIntPtr e);

    static Guid IID_IAccessible = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
    const uint OBJID_CLIENT = 0xFFFFFFFC;
    const int CHILDID_SELF = 0;

    public class Item {
        public IAccessible Parent; public int ChildId; public string Name; public int Role;
        public override string ToString() { return Name + " (role 0x" + Role.ToString("X") + ")"; }
    }

    static List<IntPtr> Windows(IntPtr top) {
        var list = new List<IntPtr> { top };
        EnumChildWindows(top, delegate(IntPtr h, IntPtr l) { list.Add(h); return true; }, IntPtr.Zero);
        return list;
    }

    static IEnumerable<Item> Walk(IAccessible acc, int depth) {
        if (acc == null || depth > 15) yield break;
        int count = 0;
        try { count = acc.accChildCount; } catch { }
        if (count <= 0) yield break;
        var children = new object[count];
        int got;
        if (AccessibleChildren(acc, 0, count, children, out got) != 0) yield break;
        for (int i = 0; i < got; i++) {
            var childAcc = children[i] as IAccessible;
            Item item;
            if (childAcc != null) item = Describe(childAcc, CHILDID_SELF);
            else if (children[i] is int) item = Describe(acc, (int)children[i]);
            else continue;
            yield return item;
            if (childAcc != null)
                foreach (var d in Walk(childAcc, depth + 1)) yield return d;
        }
    }

    static Item Describe(IAccessible acc, int id) {
        var item = new Item { Parent = acc, ChildId = id };
        try { item.Name = acc.get_accName(id); } catch { }
        try { item.Role = Convert.ToInt32(acc.get_accRole(id)); } catch { }
        return item;
    }

    public static List<Item> All(IntPtr top) {
        var result = new List<Item>();
        foreach (var hwnd in Windows(top)) {
            object o;
            if (AccessibleObjectFromWindow(hwnd, OBJID_CLIENT, ref IID_IAccessible, out o) != 0) continue;
            result.AddRange(Walk(o as IAccessible, 0));
        }
        return result;
    }

    public static Item Find(IntPtr top, string name, int role) {
        foreach (var item in All(top))
            if (item.Name == name && (role == 0 || item.Role == role)) return item;
        return null;
    }

    public static void Invoke(Item item) {
        try { item.Parent.accDoDefaultAction(item.ChildId); return; } catch { }
        int x, y, w, h;
        item.Parent.accLocation(out x, out y, out w, out h, item.ChildId);
        if (w <= 0 || h <= 0) throw new InvalidOperationException("'" + item.Name + "' has no clickable bounds");
        SetCursorPos(x + w / 2, y + h / 2);
        mouse_event(2, 0, 0, 0, UIntPtr.Zero);
        mouse_event(4, 0, 0, 0, UIntPtr.Zero);
    }
}
'@
}

$ROLE_PAGETAB = 0x25

function Show-Elements($hwnd) {
    Write-Host "`nMSAA elements:" -ForegroundColor Yellow
    [SymmetryMsaa]::All($hwnd) | Where-Object Name |
        Select-Object Name, @{ n = 'Role'; e = { '0x{0:X}' -f $_.Role } } | Format-Table -AutoSize
}

$proc = Get-Process SymmetryClient -ErrorAction Stop |
    Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } |
    Select-Object -First 1
if (-not $proc) { throw "SymmetryClient window not found" }
$hwnd = $proc.MainWindowHandle
Write-Host "Found SymmetryClient (PID $($proc.Id))"

[SymmetryMsaa]::ShowWindow($hwnd, 9) | Out-Null
[SymmetryMsaa]::SetForegroundWindow($hwnd) | Out-Null
Start-Sleep -Milliseconds 500

Write-Host "Selecting Install tab..."
$tab = [SymmetryMsaa]::Find($hwnd, "Install", $ROLE_PAGETAB)
if (-not $tab) { $tab = [SymmetryMsaa]::Find($hwnd, "Install", 0) }
if (-not $tab) { Show-Elements $hwnd; throw "Install ribbon tab not found" }
[SymmetryMsaa]::Invoke($tab)
Start-Sleep -Milliseconds 700

Write-Host "Opening Device Management..."
$button = [SymmetryMsaa]::Find($hwnd, "Device Management", 0)
if (-not $button) { Show-Elements $hwnd; throw "Device Management button not found" }
[SymmetryMsaa]::Invoke($button)

Write-Host "Done!" -ForegroundColor Green
```
