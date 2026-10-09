# Tests and history

## Look for
- **Coverage**: each behaviour the change adds or alters has a test change. Name the untested behaviour.
- **Do the tests prove it works?** Read them:
  - Does each new test assert the changed behaviour, or only that nothing throws?
  - Would it still pass against the old code? (If yes, it proves nothing about the fix.)
  - Are the edge cases in the change covered: empty, null, boundary values, the error path, the
    concurrent case for race fixes?
  - Over-mocking: the mock returns exactly what the code under test needs, so the test can't fail.
  - Tests changed to match new behaviour without the ticket asking for that change.
  - A test that asserts a value equals the constant or literal it is defined from only restates the
    code: it fails only on a deliberate edit. Don't count it as coverage of the behaviour.
  - A test or fixture that re-derives what the code under test computes (its own query for which
    records qualify, its own formula for an expected value) instead of calling it: compare the two on
    the inputs they treat differently (several matching rows, nulls, values past a length limit). A
    copy that disagrees fails on some data, or picks inputs the real code would reject.
- **Shared fixture setup** (a base class, an assembly-wide setup): a requirement the change adds there
  (a seeded record, a permission level, a running service) now fails every fixture that inherits it,
  including ones that never use it. Move the requirement to the fixtures that need it.
- **Tests that change data they didn't create** (an existing role's permission, a seeded user's enabled
  flag) and restore it in `finally`: a killed run leaves it changed, and later runs pass or skip for the
  wrong reason. Create throwaway records under a per-run prefix, pre-cleaned by that prefix in setup.
- **History**: the history file in your material lists, per changed file, recent commits whose
  message mentions fix/revert/regress. If one touched the code this change alters, read the current
  code around it and check the change doesn't undo that fix. Name the commit. You have no shell, so
  keep this to what the file and the worktree show.

## Severity hints
- A bug fix with no test that fails on the old code → Low (Medium if the ticket is a regression).
- A repro from the ticket or its QA comments (each input or step it names) with no test that would
  fail if that bug came back → Medium (severity.md). Check the test runs where the bug lives: a
  model/view desync needs the binding, so a handler test on a bare element can't catch it. The fix
  must name a test that would fail on the reported bug, not more cases for a test that can't.
- A change that reverts an earlier fix → Medium or High depending on what the fix protected.

## Team history
- Go unit tests in amag.natsEmbedded must not touch the real HKCU key (Software\Group4\Multimax\Multimax) or the installed Symmetry DB (an empty connection string resolves to it). Put them behind the integration build tag, or use a value that can't connect.
- Tests that pass for the wrong reason or pin a known bug: broker-denial tests that accept any non-404 error (including no-responder when the server is down); "cold start" tests where a cache still hits; assertions that hold whether the cache hit or a probe ran; tests asserting a broken state is correct, which the eventual fixer has to invert.
- Tests against real OS behaviour (sockets, loopback, file system, clocks): the OS often fills in what the code under test was meant to do (it picks a source address by route, loops a host's own sends back, creates a missing directory), so the assertion holds with that code removed. Assert something only the code under test produces, and check each of several sends separately rather than "any arrived".
- Integration fixtures must follow the production path: Sentinel machine ports created encrypted with AES keys, per-run GUID prefixes plus cleanup instead of fixed names, databases left clean for a re-run.
- esg-ng-core-m33: when a driver or PAL signature changes (e.g. to return bool_t), the mocks (drv_uartMock etc.) and test names must follow, and the unit tests must still build. Ask whether hardware-dependent changes were run on the modified board.
- NatsCodeGen behaviour changes get a golden-output fixture (test/golden definitions + verify.sh). Validation conformance vectors should cover the case between neighbouring vectors (e.g. a digit string that matches the pattern but overflows long).
