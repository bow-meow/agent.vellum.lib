# C# / .NET

## Look for
- `async void` outside event handlers; `.Result`/`.Wait()` in code with a sync context (WinForms/WPF,
  old ASP.NET); missing `ConfigureAwait(false)` in library code that is called synchronously.
- `Task.WaitAsync(timeout)` or `Task.WhenAny` with a delay used as a timeout: it stops waiting, the
  operation runs on unobserved. Pass a `CancellationToken` where the API takes one
  (`Dns.GetHostAddressesAsync`, `HttpClient`, `SqlCommand`), keeping `WaitAsync` only as a backstop.
- `IDisposable` without `using`: `SqlConnection`, `SqlCommand`, `SqlDataReader`, streams, `Timer`,
  `CancellationTokenSource`; `new HttpClient()` per call.
- Event subscriptions (`+=`) on long-lived objects without `-=`.
- `string.Equals`/`==` where the domain needs `StringComparison.OrdinalIgnoreCase`; culture-sensitive
  `ToUpper()`/`ToLower()`/`Parse` on protocol or DB values.
- LINQ multiple enumeration of a lazy query hitting the DB; `.Count() > 0` instead of `.Any()` on
  queryables.
- `DateTime.Now` where UTC is stored; `DateTime` vs `DateTimeOffset` mixing.
- Exceptions: `catch (Exception)` that swallows; `throw ex;` losing the stack.
- Nullable reference annotations ignored with `!` on values that can be null, or on values that can't only
  because of a separate check the compiler can't see (a `(T?, Error?)` tuple whose error half was checked,
  then `value!` at each call site): a result type with `[MemberNotNullWhen]` makes the compiler prove it.
- WinForms: UI updated from a background thread without `Invoke`.

## Team history
- NatsCodeGen (1.6.4) has no Dictionary/map support: a map field in a message definition breaks codegen; use an array of key/value entries. Nested refs are generated as Partial<T>.
- Version pins in Source/SymmetryApi/build.ps1 (tool branch version, template version) must move with released artifacts: natscodegen releases/* branches carry rebuilt binaries with a matching cli/version.txt, and the templates' manifest minToolVersion must be met. Two PRs on one release branch conflict on the binaries. A stale pin shows up as unrelated CI errors (e.g. CS0104 duplicate enum namespace).
- NatsCodeGen: definition errors throw DefinitionValidationException (clean message, exit 1, watch mode keeps running), not InvalidOperationException, a bare Exception or Environment.Exit.
- NatsCodeGen: an attribute that is misapplied, malformed or doesn't bind (unresolved DataAnnotations such as [EmailAddress], [Required], [RangeIf] on a non-numeric field, [NotEmptyGuid] on a non-Guid) must fail generation, not silently emit no rule.
- NatsCodeGen CodeGenerator: never delete existing output on a blank render. Templates gated on a param (GenerateValidators) render blank when the flag is forgotten, and a removed delete-on-blank branch has been reintroduced before.
- NatsCodeGen Helpers.cs: a rule consumed by server validators, client FieldRules and the docs (e.g. requiredness) must come from one shared predicate, or the three drift.
- Regex emitted into C# validators: .NET `$` also matches before a trailing newline, so emit `\z`; wrap the whole pattern so a top-level alternation is anchored at both ends.
- Symmetry client close prompts: `IMessageBox.ShowConfirmationWarning` and `ShowConfirmation` show OK/Cancel, not Yes/No. Auto-logoff (`LogoffReason.AutoLogoff`) closes every view through `ViewManager.CloseAll` without `CloseWithConfirmation`, and locked home-screen views close through `UnlockAndClose`, so a close warning never reaches either. Translator notes and "shown when" lists have to match that.
- Tool build scripts (build.ps1) keep output in bin/ like the other tools; don't change output paths per platform.
