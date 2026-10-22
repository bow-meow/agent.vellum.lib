# Claims

Your material is the PR description and the ticket. They are the author's and the reporter's account
of the change, and each fact in them is unproven until the code proves it. Other reviewers read the
diff; you check what the text says the diff does.

## Look for
- **List every concrete fact** the texts state about behaviour: limits, deadlines, timeouts and sizes;
  what happens when something fails, blocks, stops or restarts; what is logged, kept, discarded or
  retried; what is unchanged or behaves "as before"; test and measurement results, with the
  conditions they were measured under; "known limits" and accepted trade-offs.
- **Trace each one to its worst case.** Open the code that decides it and find the input, timing or
  failure the text wasn't written about: a call that never returns, a stop at the worst moment, the
  other callers, modes and products that run the code. A fact holds only if it holds there.
- **Known limits and accepted trade-offs**: check the text describes the limit in full. When the
  limit is hit, what else happens (work lost, nothing logged, another component affected, a promise
  elsewhere in the text broken)? The part it leaves out is a finding, however clearly the rest is
  stated.
- **Test and measurement results**: check the run exercised the case the claim is about, through the
  entry point the field uses and at the failure's worst form, not a milder or internal one.
- **Two facts in the texts that can't both hold** in one case: a finding at the code that decides
  which one wins.

## Don't flag
- Statements of intent or plans with no claim about behaviour.
- Facts about code the change neither touches nor reaches.

## Severity hints
- A wrong or partial fact about data loss, whether loss is logged, safety, access, or a limit the
  change exists to enforce → Medium; High when it guards access or a destructive action.
- A wrong fact about an incidental detail → Low.
