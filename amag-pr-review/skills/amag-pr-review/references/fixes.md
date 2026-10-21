# Suggested fixes

A `fix` is code the author pastes in, so a wrong one ships as a new defect under the review's name.
Reviewers and verify read this file before writing any `fix`; the fix-review pass reads it before
judging an applied one. Each line below comes from a fix of ours that later turned out wrong.

## Before writing a fix

- Hold the fix to the same checklists as the diff: it is new code.
- For each API, overload or helper the fix starts using, check what it does beyond what the finding
  needs (other options it sets, when it registers, what it overrides). The finding names one problem;
  the call you suggest brings everything it does.

## Don't suggest

- A default set through a convenience overload that also pins a value configuration is meant to
  choose (one that registers a formatter, provider or endpoint after configuration has bound): the
  configured choice is silently replaced. Suggest the form that fills the default only while the option
  is unset, and leaves the selection to configuration.
- A query hint that forces an access method without naming the index (a bare seek hint) as the fix
  for an unstable plan, when another index shares the predicate's leading key: the optimizer can
  still seek the non-covering one and add a lookup. Name the covering index, once you've checked that
  the fresh schema and every upgrade path create it under that name.
