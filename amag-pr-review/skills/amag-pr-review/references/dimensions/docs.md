# Docs and prose against the code

You read the whole change. Prose and the behaviour it describes often sit in different files, so
check each claim against the code wherever it lives, not only the code next to it.

## Look for
- Reference tables (exit codes, options, accepted input forms, error lists, state transitions): for
  each value the change adds, returns, accepts or throws, find every site that produces it and compare
  with the table in both directions. A new path returning an existing code under a new cause, or a
  parser accepting a form the table and help text leave out, is a finding.
- One fact kept in several places (command-line help, README table, doc comment, parser or
  validation): they must agree with each other and with the code.
- Unchanged sentences the change makes false: absolute claims ("never asks without the flag", "X is
  unchanged", "is always an error", "never writes Y") in the docs files the change touches and the
  README of each changed project, and code comments in or next to a changed hunk that justify what the
  change removed or replaced (a comment explaining a hint, guard or workaround that is now gone, or
  pointing at another comment that is). Test each against the new code, including code in a shared
  library the claim's subject also uses.
- Doc comments promising a property the body doesn't provide: de-duplicated, ordered, thread-safe,
  "only for diagnostics" on a helper whose result now gates an action, an overload's exception list
  shorter than the one it delegates to.
- Lifecycle descriptions (what is recorded or cleaned up on success, failure, cancel): trace each
  write path for each outcome and compare.

## Severity hints
- Mostly Low / nit. Medium when someone would act on the wrong text with a real cost: a script reading
  an exit code, a doc saying a destructive option asks first when it doesn't.
