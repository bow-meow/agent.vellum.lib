# Posted comments

What verify and recheck need on top of severity.md: how a finding becomes a PR comment. Reviewers
don't read this file; scripts build every header and footer.

## Status and threads

Severity is internal. It drives verify's gate, recheck, ordering and the incremental rules, but the
author only sees whether a change is needed. Every change is expected to be addressed, by a fix or a
reply saying why not, so raise a Low/nit only when it's worth that round trip.

`scripts/factcheck.mjs` builds every posted body from the severity, `issue`, `impact` and `fix`; nobody types the
header or footer. We only write in a thread to disagree: a fix that holds or a push-back we accept
is a silent resolve (choosing.md). A follow-up (`scripts/comment.mjs followup`) has no header: one
sentence opening with what happened, then the same footer. `**Still applies** at L<n>.` when the code
changed and the finding stands, `**Still a problem:** <verify's reply>` answering a push-back.
Comments posted before this layout used a dot header (`🔵 **note**`), a
`🤖 AI:<model>` header, a `[status, AI:model]` prefix, a plain `**status** · AI:model` header, or one
of the retired statuses (`critical`, `blocking`, `suggestion`, `nit`, `info`); all are recognised as
ours. A header or opening without our footer is not.
The in-progress notice (`comment.mjs progress`) is `⏳ **Review in progress**`, a start timestamp, a
`🃏` joke line when SKILL.md step 2 wrote one, and the footer; it isn't a finding, and `split-comments` keeps it out of both comment lists.

## Header

A posted comment is the header, then the labelled lines from severity.md's Comment text, one per
part, each label beside its text (`formatComment` puts a blank line between them), then the footer
`_AI review · <MODEL>_`. A note or a follow-up reply is one unlabelled sentence between header and
footer.

Header line: `<icon> **<area> · <change needed | note>**`. The area comes from the finding's
`dimension` when it names a checklist (correctness 🐛, tests-history 🧪, design-quality 🏗️,
security 🔒, concurrency-races 🧵, resources-performance ⚡, sql 🗄️, docs 📄, styles 🎨,
ticket-fit 🎫, regression 🔁, claims 📝), else from the first reviewer that raised it, else `🔎 Review`. Reviewer names,
confidence and tokens aren't posted. The terminal table shows them, and the run log
(`runlog.mjs`, under `C:\repos\ai-review\.log`) keeps them with every finding for tuning.
A finding's tokens are its share of the run: each reviewer's tokens split over the findings it
raised, plus an even share of verify, recheck and any reviewer with no finding.

```
🧪 **Tests · change needed**

**Issue:** `Find` drops an import whose expanded path doesn't exist, and no import test uses `$(ProjectDir)` or `$(Configuration)`.

**Impact:** edits to a property sheet imported that way never rebuild the row, so the build keeps stale output.

**Fix:** add a test importing `$(ProjectDir)$(Configuration).$(Platform).props` and assert the file is returned.

_AI review · Opus 5.5_
```
