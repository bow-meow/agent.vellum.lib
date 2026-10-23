# PR mode: save state

Read from SKILL.md step 9, after the user's last answer.

The last answer is the approval y/n, or the pick on a hold. Declined items: choosing.md step 4.
For every posted finding and every still-open previous finding: `commentId`, `parentId` (the thread
root for a `reply`, else `null`), `path`, `line`, `side`, `severity`, `status: 'open'`, `pushbackSeen`, and
`fingerprint` from `node $S/scripts/state.mjs fingerprint "$WT/<path>" <line>` (new side only; `null`
for old side). Previous `fixed` → `status: 'fixed'`. `reviewedCommit` = `HEAD_SHA`, except when any
post failed: then keep the previous `reviewedCommit` (or omit it on a first run) so the failed
findings are found and posted next time. Write
`dropped` = every `verified.json` finding with verdict `dropped` (`path`, `line`, `claim`, `reason`),
plus the previous state's `dropped` entries still in `dropped-previous.json`. Write
`{reviewedCommit, reviewedAt: <ISO now>, findings: [...], dropped: [...]}` to `$W/state.json` with the Write tool, then
`node $S/scripts/state.mjs save $WS $REPO $PR < $W/state.json`.
