# TypeScript / Angular

## Look for
- Subscriptions without `takeUntil`/`async` pipe/`DestroyRef` → leaks on component destroy. A
  `providedIn: 'root'` service that subscribes in its constructor holds the subscription for the
  whole session: every page that injects the service starts the stream's load, and a source that
  refreshes only while observed keeps refreshing on every page. Subscribe in the component that needs it.
- `any` or non-null assertions `!` hiding real nulls.
- A test reaching a class's private members by `as unknown as` a hand-written interface: a renamed
  member still compiles and fails only at runtime. Bracket access (`obj['_field']`) is type-checked.
- Change detection: mutating inputs in `OnPush` components; heavy work in templates or getters.
- An `effect()` that writes a signal or form value to keep it consistent with another (forcing one
  field when a second takes some value): the rule holds only while that component exists, and every
  other writer of the same model (a save, a copy, a collapsed or unrendered view) skips it. Apply it
  where the value is written (the change handler, the load, the save), or derive it with `computed`.
- Race between overlapping HTTP requests (use `switchMap` for search-as-you-type).
- An `async ngOnInit` (or other lifecycle hook) that sets fields after an `await`: Angular doesn't
  wait for it, so the template, its submit button and Enter act on the unset values first. Check what
  a submit handler or enabling getter reads before the await resolves; pass the data in already
  loaded, or gate the action on a loaded flag.
- `innerHTML` / `bypassSecurityTrust*` with untrusted data.
- Unhandled promise rejections, including one an added `await` now passes up to a caller with no
  `catch` (follow it to the event handler: what the user sees, what state is left), and an added
  `await` whose callers still don't await, which changes nothing; errors swallowed in `catchError`
  without user feedback.
- `routerLinkActive` with exact path matching on a list's nav link whose create and edit pages are
  child routes: the item loses its highlight on those pages. Check the route config, and match on the
  subset, leaving out child routes that have nav items of their own.

## Team history
- Busy state that blocks a second operation must live where the operation runs. A field on a routed component resets when the operator navigates away and back, while the `providedIn: 'root'` service doing the work keeps going, so a second run can start beside the first (the firmware upload's `uploadingFileName` on `ManageFirmwareComponent` vs `FirmwareDataService.upload`).
- UI flags derived from a lazily fetched observable (e.g. license degraded status gating the firmware download button) must default to the fail-safe state until the first emission, not to "enabled".
