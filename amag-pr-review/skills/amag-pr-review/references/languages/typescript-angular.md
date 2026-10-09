# TypeScript / Angular

## Look for
- Subscriptions without `takeUntil`/`async` pipe/`DestroyRef` → leaks on component destroy.
- `any` or non-null assertions `!` hiding real nulls.
- Change detection: mutating inputs in `OnPush` components; heavy work in templates or getters.
- Race between overlapping HTTP requests (use `switchMap` for search-as-you-type).
- `innerHTML` / `bypassSecurityTrust*` with untrusted data.
- Unhandled promise rejections; errors swallowed in `catchError` without user feedback.

## Team history
- Busy state that blocks a second operation must live where the operation runs. A field on a routed component resets when the operator navigates away and back, while the `providedIn: 'root'` service doing the work keeps going, so a second run can start beside the first (the firmware upload's `uploadingFileName` on `ManageFirmwareComponent` vs `FirmwareDataService.upload`).
- UI flags derived from a lazily fetched observable (e.g. license degraded status gating the firmware download button) must default to the fail-safe state until the first emission, not to "enabled".
