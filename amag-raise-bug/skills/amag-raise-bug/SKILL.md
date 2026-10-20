---
name: amag-raise-bug
description: >-
  Use when raising bug or task tickets in AMAG's Symmetry Jira (SYM project) for defects or tech
  debt found in code review, testing, or a rig session. Triggers — "raise tickets for these",
  "file a bug for this", "raise a task for this", "log this as tech debt", "make it like SYM-1234".
  SKIP for: working an existing ticket (ticket-quest), only commenting on one, or IDM project
  tickets (amag-jira-ticket).
---

# amag-raise-bug — raise Symmetry bug and task tickets

Turn a list of findings into SYM Bug or Task tickets that match the team's existing ones, checked
against the code, written in plain prose, and created only after the user has seen the drafts.

**REQUIRED SUB-SKILL:** humanizer, for every summary, description and custom-field text.

<HARD-GATE>
**Create nothing until the user has seen the drafts and said go.** Tickets are visible to the team
the moment they exist, and the issue type can't be changed afterwards.
</HARD-GATE>

## Workflow

1. **Read the reference ticket** the user names (`getJiraIssue`, fields `*all`). It sets the issue
   type, the summary style, the versions and the Project Charge. With no reference ticket, use the
   defaults in the table below.
2. **Pick the type for each finding.** Bug when something behaves wrong. Task when nothing is broken
   and the work is cleanup: tech debt, duplicated code, a refactor, removing dead code.
3. **Pick the parent.** If the user named one, use it. Otherwise ask, with `AskUserQuestion` (one
   question per ticket, in a single call), offering:
   - **SYM-985 Technical Debt**: recommend it for a Task
   - **The epic of the ticket being worked**, when there is one: the `SYM-XXXX` in the branch name,
     then its `parent`. Name the epic in the option, and recommend it for a Bug
   - **No parent**
   - Any other key the user types

   Check the chosen key with `getJiraIssue`: it must be an Epic that isn't Done or Closed.
4. **Look for duplicates.** Search SYM for each finding by file name, function or subject (JQL
   `project = SYM AND text ~ "..."`, plus the user's own tickets from the last few days). An
   existing ticket gets updated, not raised again. Report what you found.
5. **Check every claim against the code** before writing it down. The notes you're given are a lead,
   not a fact: earlier runs found a "SQL 2016" minimum that was really 2017, and a role grant the
   note missed. Record file paths and line numbers as you go.
6. **Draft each ticket** in the shape below, through humanizer.
7. **Show the drafts** — summary, type, parent, priority with a one-line reason, every field value,
   description, links — and wait for go.
8. **Create, then link.** `createJiraIssue` with the parent in `additional_fields`, then
   `createIssueLink` (type `Relates`) to every related ticket you cited. Report the keys with links.

## The ticket

| Part | Content |
|---|---|
| Issue type | `Bug` or `Task`, from step 2. The user or the reference ticket can override |
| Parent | From step 3. Never copied from the reference ticket |
| Summary | The reference ticket's style. Default for a Bug `Area - what is wrong, and the consequence`; for a Task `Area - what to change` |
| Description (Bug) | Impact first, then why (paths and lines), then a suggested direction. Say how it was found: "Found in code review; not reproduced on a rig" or the rig and build |
| Description (Task) | What the code does now and what leaving it costs, then where (paths and lines), then the suggested change. Say how it was found |
| Steps to Reproduce | Bug only, always filled. The steps someone ran, or, for a code-review find, the path the code shows triggers it, ending with the line "From code review; not reproduced on a rig." |
| Actual Result | Bug only, always filled. What was observed, or what the code does on that path, ending with the same line. Never present a code reading as an observation |
| Expected Result | Bug only, always filled: what correct behaviour looks like |
| Environment | Bug only. The build and rig, when there was one. Empty otherwise |
| Assignee | "me" means the caller: `atlassianUserInfo` gives the account ID |
| Priority | Proposed with a reason in step 7. The user decides |
| Project Charge | Tech debt (any ticket parented to SYM-985) is always `21462` TD103ER/04 Symmetry Software Tech Debt, whatever the reference ticket uses. Otherwise the reference ticket's, or the release's |

Copy from the reference ticket only what describes the kind of ticket: type, versions, Project
Charge (except on tech debt), summary style. Its parent epic, estimate, RAG status and team fields
describe its own work, so leave them off.

## Field reference (SYM)

| Field | ID | Format | Value |
|---|---|---|---|
| Site | `amagsymmetry.atlassian.net` | cloudId | |
| Issue type | `1` = Bug, `3` = Task | | |
| Parent | `parent` | `{"key": "SYM-985"}` | `SYM-985` = Technical Debt (Epic) |
| Fix versions / Affects versions | `fixVersions` / `versions` | `[{"id": "..."}]` | `32939` = Symmetry 11.1.0, `33603` = Symmetry 11.2.0 |
| Project Charge (required) | `customfield_13521` | `{"id": "..."}` | `21030` = TD103EL/01 - Development Symmetry v11.1, `21064` = TD103EN/01 - Development Symmetry v11.2, `21462` = TD103ER/04 Symmetry Software Tech Debt |
| Steps to Reproduce | `customfield_12800` | plain string on a Bug | |
| Actual Result | `customfield_12804` | plain string on a Bug | |
| Expected Result | `customfield_12805` | plain string on a Bug | |
| Environment | `environment` | plain string on a Bug | |
| Priority | `priority` | `{"name": "High"}` / `Medium` / `Low` | |

Pass the description as markdown with `contentFormat: "markdown"`. For another release, read the
version and Project Charge IDs off a recent ticket for that release. Tasks under SYM-985 usually
have no fix version. Older ones carry assorted release charges; don't copy them.

## Common mistakes

- **Wrong issue type.** It can't be edited afterwards: Jira rejects the change because the types use
  different workflows. Fixing it means a Move in the UI, or a new ticket. Settle the type in step 7.
- **Bug fields on a Task.** A Task has no Steps to Reproduce, Actual Result, Expected Result or
  Environment field, and the create fails if you send them. Put what matters in the description.
- **Rich-text fields on other types.** On an Internal Enhancement the result fields need ADF, not a
  string. Read the error and wrap the text in a minimal ADF doc.
- **Closing a ticket you replaced.** The Closed transition sets resolution Fixed. Set
  `resolution: {"name": "Duplicate"}` with `editJiraIssue` afterwards and comment with the new key.
- **Results in the description.** On a Bug, Steps, Actual and Expected have their own fields; use
  them.
