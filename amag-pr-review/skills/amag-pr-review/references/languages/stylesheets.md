# Stylesheets (SCSS / CSS / Less)

## First: sweep (required, before the list below)
1. For every selector, class or custom property the change adds, removes or stops using, grep the
   whole repo's templates, components and stylesheets for it. A rule nothing matches is dead; a
   class a template sets that no stylesheet or code reads is dead. Include rules elsewhere in the
   repo that the change makes dead (it removed the last element, class or host they targeted).
2. For every selector list or declaration block the change adds, grep the changed stylesheets for the
   same list or the same set of declarations. Count the copies.
3. If you were given a stylesheet facts file, take every entry in turn: it becomes a finding, joins
   another finding as a further instance, or you can state why it is not a problem. For
   `long-comment` entries, read the repo's CLAUDE.md for its comment rules first.

## Look for
- Repetition that will drift: the same selector list, `:not()`/`:where()` fence or declaration block
  pasted in several places, or copied into several component stylesheets. Name the copies and the
  single home (mixin, placeholder, one shared rule, a custom property).
- Rules fighting each other: a property set by a general rule, raised by a more specific one, then
  reset by a third, or a `:not()` added to one rule only to escape another. One variable set per
  context and read by one rule usually replaces the layers.
- Redundant declarations: a property set to the same value for the same elements by two rules.
- Computed literals: fractional or measured px values (`25.59375px`) copied from a rendered box, which
  drift with zoom, font or theme changes. Ask for the source token or a relative unit.
- Direction: physical `left`/`right`/`margin-right`/`padding-left` where the app supports RTL; ask for
  the logical property (`inset-inline-end`, `padding-inline-start`). Report every instance in the diff.
- `!important` or deep selectors (`::ng-deep`, long descendant chains) added to win a specificity
  fight the file could avoid.
- A partial, mixin or block whose name no longer describes what is left in it after the change.
- Comments in stylesheets: the same rules as code (why, not what; no change narration), plus the
  repo's own comment rules if its CLAUDE.md states any.

## Severity hints
- Mostly Low / nit. Repetition that will drift, or rules fighting across screens → Low. A dead rule
  the change creates → Low. Naming and comment length → nit.
- Medium only with a concrete visible breakage: a screen outside the change's stated scope that
  renders differently, a focus or disabled state that disappears, text that becomes unreadable.
- A removed rule is only a regression if it rendered at the base: check that the asset, variable or
  selector target it used existed there (`git ls-tree` / grep at the merge base) before claiming
  something stopped showing.
