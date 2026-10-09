# C++ (embedded Linux on i.MX93, and Windows services)

## Look for
- Raw `new`/`delete`, `malloc`/`free` where `unique_ptr`/containers fit; resources (FDs, sockets,
  D-Bus messages/refs, handles) not released on every error path.
- Data races between D-Bus/NATS callbacks and worker threads; missing locks around shared members.
- Undefined behaviour: signed overflow, out-of-bounds indexing, use-after-move, dangling references to
  temporaries, uninitialised members.
- Blocking calls in callbacks or on the main loop; unbounded buffers or queues.
- Integer width and endianness in protocol/firmware structs; `sizeof` on pointers.
- ABI: changing a struct or class layout used across shared libraries or IPC without rebuilding every
  consumer.
- Exceptions thrown across C APIs or thread boundaries.

## Team history
- Firmware C style (esg-ng-core-m33, esg-ng-ipc): m_ prefix for module-scope variables (not s_), parenthesised return values, brackets around each operand of compound conditions, C-style comments, (void) in parameterless definitions, _t suffix on types, stdint types, camelCase variables and PascalCase functions, continuation lines indented parent+8.
- Magic numbers: UPPER_SNAKE_CASE #defines with a `u` suffix, or enums (classic C++ too, e.g. transaction-processor state values that collide). Use EL_COUNT() or MAX_*_8DC rather than raw sizeof arithmetic, sizeof(struct) rather than a parallel size constant, and PRINT_PORT() rather than `+ 1u`.
- Discarded return values: cast bool_t PAL/driver calls to (void) when ignored on purpose. In Windows services, check WaitForMultipleObjects for WAIT_TIMEOUT/WAIT_FAILED and log GetLastError().
- No dynamic allocation in FreeRTOS firmware or the IPC library: use fixed buffers or pools, and check shared storage is thread safe.
- Error paths that disabled something must restore it: a GPIO IRQ disabled before an SPI mutex take and never re-enabled on timeout; a level-triggered IRQ re-enabled only in the "pending" branch; txInProgress never cleared when the interrupt enable fails.
- ISR paths: keep debug output out of or minimal in ISRs; variables shared with an ISR must be volatile.
- SC16IS752 registers: the enhanced set is mapped while LCR=0xBF, so restore LCR before writing MCR/TCR/TLR, and don't rely on two register names sharing an address.
- esg-ng-core-linux events: fromArea/toArea belong in event->where (read back with Where()), not event->meta. Guard map lookups for required meta keys against end().
- Shared field-length constants (e.g. BulkRecordsetFieldLengths.h in the classic MFC plugin): check every field that uses a constant before widening it.
