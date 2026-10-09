---
name: amag-raise-bug
description: >-
  Use when raising bug tickets in AMAG's Symmetry Jira (SYM project) for defects found in code
  review, testing, or a rig session. Triggers — "raise tickets for these", "file a bug for this",
  "log this in Jira", "make it like SYM-1234". SKIP for: working an existing ticket (ticket-quest),
  only commenting on one, or IDM project tickets (amag-jira-ticket).
---

# amag-raise-bug — raise Symmetry bug tickets

Turn a list of findings into SYM Bug tickets that match the team's existing ones, checked against
the code, written in plain prose, and created only after the user has seen the drafts.

**REQUIRED SUB-SKILL:** humanizer, for every summary, description and custom-field text.

<HARD-GATE>
**Create nothing until the user has seen the drafts and said go.** Tickets are visible to the team
the moment they exist, and the issue type can't be changed afterwards.
</HARD-GATE>

## Workflow

1. **Read the reference ticket** the user names (`getJiraIssue`, fields `*all`). It sets the issue
   type, the summary style, the versions and the Project Charge. With no reference ticket, use the
   defaults in the table below.
2. **Look for duplicates.** Search SYM for each finding by file name, function or subject (JQL
   `project = SYM AND text ~ "..."`, plus the user's own tickets from the last few days). An
   existing ticket gets updated, not raised again. Report what you found.
3. **Check every claim against the code** before writing it down. The notes you're given are a lead,
   not a fact: earlier runs found a "SQL 2016" minimum that was really 2017, and a role grant the
   note missed. Record file paths and line numbers as you go.
4. **Draft each ticket** in the shape below, through humanizer.
5. **Show the drafts** — summary, type, priority with a one-line reason, every field value,
   description, links — and wait for go.
6. **Create, then link.** `createJiraIssue`, then `createIssueLink` (type `Relates`) to every related
   ticket you cited. Report the keys with links.

## The ticket

| Part | Content |
|---|---|
| Issue type | `Bug`, unless the user or the reference ticket says otherwise |
| Summary | The reference ticket's style. Default `Area - what is wrong, and the consequence` |
| Description | Impact first, then why (paths and lines), then a suggested direction. Say how it was found: "Found in code review; not reproduced on a rig" or the rig and build |
| Steps to Reproduce | Always filled. The steps someone ran, or, for a code-review find, the path the code shows triggers it, ending with the line "From code review; not reproduced on a rig." |
| Actual Result | Always filled. What was observed, or what the code does on that path, ending with the same line. Never present a code reading as an observation |
| Expected Result | Always filled: what correct behaviour looks like |
| Environment | The build and rig, when there was one. Empty otherwise |
| Assignee | "me" means the caller: `atlassianUserInfo` gives the account ID |
| Priority | Proposed with a reason in step 5. The user decides |

Copy from the reference ticket only what describes the kind of ticket: type, versions, Project
Charge, summary style. Its parent epic, estimate, RAG status and team fields describe its own work,
so leave them off.

## Field reference (SYM)

| Field | ID | Format | 11.1 value |
|---|---|---|---|
| Site | `amagsymmetry.atlassian.net` | cloudId | |
| Issue type Bug | `1` | | |
| Fix versions / Affects versions | `fixVersions` / `versions` | `[{"id": "..."}]` | `32939` = Symmetry 11.1.0 |
| Project Charge (required) | `customfield_13521` | `{"id": "..."}` | `21030` = TD103EL/01 - Development Symmetry v11.1 |
| Steps to Reproduce | `customfield_12800` | plain string on a Bug | |
| Actual Result | `customfield_12804` | plain string on a Bug | |
| Expected Result | `customfield_12805` | plain string on a Bug | |
| Environment | `environment` | plain string | |
| Priority | `priority` | `{"name": "High"}` / `Medium` / `Low` | |

Pass the description as markdown with `contentFormat: "markdown"`. For another release, read the
version and Project Charge IDs off a recent ticket for that release.

## Common mistakes

- **Wrong issue type.** It can't be edited afterwards: Jira rejects the change because the types use
  different workflows. Fixing it means a Move in the UI, or a new ticket. Settle the type in step 5.
- **Rich-text fields on other types.** On an Internal Enhancement the result fields need ADF, not a
  string. Read the error and wrap the text in a minimal ADF doc.
- **Closing a ticket you replaced.** The Closed transition sets resolution Fixed. Set
  `resolution: {"name": "Duplicate"}` with `editJiraIssue` afterwards and comment with the new key.
- **Results in the description.** Steps, Actual and Expected have their own fields; use them.
