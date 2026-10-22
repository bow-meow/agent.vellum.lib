# Docs and prose against the code

You read the whole change. Prose and the behaviour it describes often sit in different files, so
check each claim against the code wherever it lives, not only the code next to it.

## Look for
- **The PR description and the ticket are prose too.** Write one ledger entry for each (path
  `PR description` or `ticket`, `from`/`to` 0) whose `checked` lists every concrete fact it states
  about behaviour: limits and deadlines, what is logged or kept, timings and test results, "known
  limits", what is unchanged or out of scope. Open the code that decides each fact and trace its worst
  case, not the case the text was written about. A fact the code contradicts, or one true only in
  part (a limit stated without what else happens when it is hit), is a finding at the code that
  decides it. "Known limit" or "accepted" in the text doesn't make the description of the limit true.
- Reference tables (exit codes, options, accepted input forms, error lists, state transitions): for
  each value the change adds, returns, accepts or throws, find every site that produces it and compare
  with the table in both directions. A new path returning an existing code under a new cause, or a
  parser accepting a form the table and help text leave out, is a finding.
- One fact kept in several places (command-line help, README table, doc comment, parser or
  validation): they must agree with each other and with the code.
- Unchanged sentences the change makes false: absolute claims ("never asks without the flag", "X is
  unchanged", "is always an error", "never writes Y") in the docs files the change touches and the
  README of each changed project. Test each against the new code, including code in a shared library
  the claim's subject also uses.
- Doc comments promising a property the body doesn't provide: de-duplicated, ordered, thread-safe,
  "only for diagnostics" on a helper whose result now gates an action, an overload's exception list
  shorter than the one it delegates to.
- Lifecycle descriptions (what is recorded or cleaned up on success, failure, cancel): trace each
  write path for each outcome and compare.

## Severity hints
- Mostly Low / nit. Medium when someone would act on the wrong text with a real cost: a script reading
  an exit code, a doc saying a destructive option asks first when it doesn't.
