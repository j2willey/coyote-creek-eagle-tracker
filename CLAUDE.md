# Agent notes: ccac-eagle-tracker

## HARD RULE: no real people's data in this repo

Records are about **minors**. Never put real Scout, parent, guardian, unit leader, committee member or other real
person's data (names, nicknames / preferred names, emails, phones, birth dates, BSA IDs, addresses, project or
beneficiary details that identify a Scout) into code, comments, tests, fixtures, docs or commit messages, not even
as an example of a bug a real Scout hit. Use clearly fictional examples (Theodore "Teddy" Sample, Owen Patrick
Fairbanks, Scout_1, Pat Q, `@example.org` addresses, units like T999). Commit messages must not name Scouts:
describe the case ("a duplicate submission with a different preferred name"), not the person. Before committing,
check the diff for real names. Dev and staging sheets hold fake data only.

Read `README.md` first (layout, sheet conventions, setup), then `docs/overview.md` and `docs/glossary.md`.

- Every email goes through `sendMail_` (test mode can't be bypassed). Sign-in links (`kind: 'signin'`) are never copied to the Committee Group.
- Put logic in `apps-script/src/lib/` as pure functions with vitest tests; keep `src/*.js` adapters thin. Run `npm test` before `clasp push`.
- One shared global scope in Apps Script: no load-time references to other files' globals.
- Find rows by Record ID / section key (hidden `_key` column), never by row number or column letter. Wrap writes in `withLock_`.
- Design decisions live in design notes kept outside the repo (solution options, proof-of-concept plan, state model, backend decision note, and the `CONTEXT.md` glossary). Use the glossary terms (Candidate Record, Intake Queue, Pre-Review Call, Proposal Review, Scout Update).
- Stage files by name when committing (never `git add -A`: editor swap files and the local `pub` script have slipped in before).
- The schedule row is the source of truth for who/when; tracking Date/Who columns are copies.
