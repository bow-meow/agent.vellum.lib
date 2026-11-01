# Quiz mode

Read when the user asked to be quizzed on the approach. It replaces step 3's "establish context
yourself" read with a scan agent, and puts the decisions the code leaves open to the user before
anything is built. Everything else in step 3 (open items, baseline, impact list, test plan, routing)
still happens; the scan feeds it. Per ticket, after step 2:

1. **Scan.** Dispatch one read-only `Explore` agent (thoroughness "very thorough") with the ticket
   text and worktree path(s). Ask it to return:
   - the files and lines that implement the area, and their callers;
   - nearby conventions and every `CLAUDE.md` on the way to those files;
   - the paths no test covers;
   - each decision point the code and ticket leave open: 2–4 options, each with file:line or config
     evidence for and against.

   The scan is a lead, not a fact: open every line it cites yourself before using it, and correct
   what doesn't match before it reaches the quiz.
2. **Quiz** with `AskUserQuestion`: up to 4 questions per call, at most 2 calls per ticket.
   - Ask only a decision the code leaves open. Drop one a convention, a module `CLAUDE.md`, the
     ticket or this skill already settles, and tell the user which settles it. Repos, base and slug
     are step 1's questions, not the quiz's.
   - Each option states what it changes and its trade-off, with file:line or config evidence and
     its impact-list effects (a wait that can outrun a timeout, a contract that changes).
   - Your recommendation is the first option, its label ending "(Recommended)".
3. **Answers are constraints.** Record them in the step-3 notes and `HANDOVER.md` (`Goal and
   repos`), and put them in every engineer and advisor prompt for the ticket. An answer the evidence
   contradicts, a free-text one especially: tell the user once, with the evidence and its
   consequence, then follow their call. Routing still applies: an answer picks a design, it doesn't
   make a contract change, shared code or a new wait routine.

**Only the build waits.** The characterization task tests today's code, which no answer changes:
send it as soon as the scan is verified. In a batch, quiz each ticket as its scan returns; other
lanes keep moving.
