# Design and quality

## First: peer survey (required, before the list below)
1. List every mechanism the change adds: a helper, service, storage or config access, initializer or
   startup hook, retry loop, cache, event wiring, error-handling or logging shape.
2. For each one, grep the whole repo (not just the file or the diff) for code doing the same job under
   any name, and check the repo's CLAUDE.md for a ratified way. Count the sites using each shape.
3. Each mechanism whose peer works differently gets a verdict, weighing: a case one handles that the
   other misses, the documented convention, the number of sites, framework direction (deprecated
   APIs), simplicity. The verdict is one of:
   - **the new code should adopt the peer**: a finding at the new code naming the peer as `path:line`;
   - **the new shape is better**: an Info finding at the new code listing the older sites to migrate;
   - **no clear winner** (evenly split, equally good): no finding.

## Look for
- Wrong layer: UI calling the DB directly, business rules in controllers or stored procs when the module
  keeps them in services, transport types leaking into domain code.
- Duplication: the change reimplements a helper that already exists. Grep the repo for the key logic
  before flagging, and name the existing helper.
- One decision made in two places: when a change splits a choice across components (which item is
  picked in one, what is done with it in another), check both key on the same value. One reading the
  raw input and the other a resolved or normalised form agree only for the inputs that need no
  resolving.
- Premature abstraction: interfaces, factories or generics with one implementation and no second use.
- God methods: a change that pushes a method well past what fits on a screen with mixed concerns.
- Misplaced logic: code the change adds that belongs on another type. A method that mostly reads or
  writes another class's fields (feature envy), or a rule about a domain type (validation, defaults,
  sanitizing, derived values) coded in a manager, controller or caller when that type or an existing
  peer already owns rules of that kind. Name the class or method it should move to as `path:line`.
- God classes: the change gives a class a responsibility unrelated to the ones it has (a manager that
  now also parses files, a DTO that now also talks to the DB), or adds a cluster of members that only
  use each other. Name the new class or file to split out and the members that go with it.
- Primitive obsession: the change passes the same group of loose values (ids, flags, strings that
  are really an enum) through several signatures when a small type, record or enum would carry them.
- Only flag these when the change itself adds the misplaced code or the extra responsibility; a class
  that was already too big or already in the wrong place is out of scope. Don't suggest a split that
  would leave a class or interface with a single use (see premature abstraction).
- Dead code: unused parameters, unreachable branches, commented-out code, leftover debug output.
- AI slop: verbose wrappers that add nothing, defensive checks for impossible states, boilerplate
  comments.
- Naming, for every function, method, variable, parameter, field, class and file the change adds or
  renames. Read each name cold, without its body, and ask what a reader would assume it does or holds:
  - **Misleading**: the name promises something the code doesn't do. `isValid` that returns a count,
    `getUser` that also writes, `userList` that is a map, `tempFile` that persists, a `retryCount`
    holding milliseconds, a boolean whose true case means the opposite (`disabled` set when enabled).
  - **Vague**: the reader has to open the body to learn anything. `HandleData`, `ProcessItem`,
    `DoWork`, `Manager`/`Helper`/`Util` classes, `data`, `info`, `obj`, `result2`, `flag`, `temp` at
    wider than a few lines of scope.
  - **Missing unit or kind**: `timeout`, `delay`, `size`, `interval` with no unit where the type
    doesn't carry one (`int`, `number`); `id` where two kinds of id are in play.
  - **Inconsistent**: the same concept under two names in the change (`badgeId` here, `cardNumber`
    there), or a name that breaks the file's or module's existing term for it.
  - The comment names the replacement (`countValidRows`, `timeoutMs`), not just the problem.
- Comment noise: comments that restate the code, narrate the change ("added to fix X"), or describe
  what instead of why. Missing "why" comments on genuinely non-obvious constraints.
- Logging: wrong level (errors at Info, noise at Warning, a failure that retries itself logged as an
  error), missing context (ids) on error logs, sensitive data in logs. An existing function reused on a
  new, more frequent path brings its logs and toasts along: check each is still true and not noise there.

## Severity hints
- Mostly Low / nit. Duplication of non-trivial logic that will drift → Low. Wrong layer that breaks an
  established boundary → Low, Medium only with a concrete consequence.
- Misplaced logic, god class, primitive obsession → Low. Medium only with a concrete consequence, such
  as two copies of a rule that already disagree, or a path that skips the rule because it lives in the
  wrong place.
- Divergent pattern: new code should adopt the peer → Low; Medium only when the peer handles a
  failure case the new code misses, with that failure. Older sites should migrate to the new shape →
  Info, naming them; it never blocks this PR.
- Naming: misleading → Low (a caller will misuse it); vague, missing unit, or inconsistent → nit.
  Misleading on a public API, NATS subject/DTO field or DB column → Low and say it's hard to rename
  later.
- Don't flag names that follow the file's or framework's convention (`i`/`j` loop indices, `e`/`ex`
  for exceptions, `ctx`, `x => x.Id` lambdas, `ngOnInit`), names the diff doesn't add or rename,
  generated code, or a choice between two equally clear names.

## Team history
- Comments citing ticket keys (SYM-/ESG-), design-doc or plan references ("Decision #7", "Task 2"), or how a test came about ("used to render"). AI-written comments that record a tool's decision rather than a constraint of the code. The commit message carries that; source comments state the rule.
- Product-specific rules hardcoded in shared tooling: NatsCodeGen must not special-case Symmetry concepts (a literal "SystemId" subject token). Derive them from the [Subject] tokens so other consumers (IDM, GovPass) get the same contract.
- Behaviour decided by a naming convention (a class name ending in "Response" skips validation) when the code model already gives the structural answer (reachable from a service request).
