# History

How the Coyote Creek Eagle Tracker was built, from the first commit on 2026-10-10 to 2026-11-10.

**Why this repository has no history.** The tool was built in a private repository. Its records are about minors, and
the work followed a hard rule: no real people's data in code, tests, docs or commit messages. Despite a conscious and
deliberate effort, a few real names, including from the author's own family, slipped into that repository's commit
history. History can't be cleaned reliably once it exists, so to protect personal information the code was published
as a new repository starting from a single commit. This file records what the earlier log showed: the dates, the
phases and the decisions.

Terms are in the [glossary](glossary.md). What the tool does today is in the [overview](overview.md).

## At a glance

| | |
|---|---|
| First commit | 2026-10-10 |
| Last commit before this file | 2026-11-10 |
| Commits | 205 |
| Days with commits | 29 of 32 |
| Busiest day | 2026-10-24, 23 commits |
| API version | 0.1.0 (2026-10-10) to 0.61.0 (2026-11-10) |
| Automated tests | about 24 at the first commit, about 90 on 2026-10-13, about 250 on 2026-10-24, about 340 on 2026-10-31, about 430 now |
| Tracked files | 185 |
| Production | https://ccac.svmbc.org, live since 2026-10-22 |

Lines of code now (about, by `wc -l` over tracked files):

| Area | Lines |
|---|---|
| Apps Script adapters (`apps-script/src/*.js`) | 8,500 |
| Apps Script pure logic (`apps-script/src/lib/`) | 6,600 |
| Web pages and scripts (`web/`) | 8,100 |
| Tests (`test/`) | 4,500 |
| README and docs | 1,400 |

Nearly all rules sit in `lib/`. The adapters are larger because they hold the Google calls (Sheets, Drive, Calendar, Gmail, Docs).

## How it was built

One volunteer developer, Jim W., built it for the Coyote Creek District Advancement Committee. He directed AI coding agents:

- **Claude Code** wrote most of the Apps Script, the web pages and the tests.
- **Gemini (in Antigravity)** worked on the PDF Sign Workshop.
- **A claude.ai Advisor session** reviewed designs and diffs, wrote briefs for the coding agents and kept the docs current.

Working rules that held through the whole period:

- **Tests first for logic.** Rules are pure functions in `apps-script/src/lib/` with vitest tests. Adapters stay thin.
  `npm test` runs before every deploy.
- **Fake data only for development.** Development and staging use fictional Scouts. A staging sheet can be re-anonymized
  from the Admin menu. Test mode cannot be bypassed: every email goes through one send function.
- **Human review of mail.** Emails that a committee action would send can wait in the Outbox until a member reads them.
- **Small steps.** Most commits are one feature or one fix, with the README updated in the same change.
- **Design notes kept outside the repo.** Interview notes, options, state models and the cutover checklist were written
  before and during the build. Decisions that matter are summarized below.

## Timeline

### 1. Design (before 2026-10-10)

The current process was mapped first. The result was a list of what breaks (one person as the bottleneck, an open
signup sheet, lost notes, inconsistent file names) and five candidate designs. The chosen one keeps the committee's
tracking sheet as the record and puts web pages in front of it.

### 2. Proof of concept, 2026-10-10 to 2026-10-13 (API 0.1.0 to about 0.10)

- Scaffold: Apps Script back end, Firebase Hosting front end, test mode, a records layer.
- Hidden `_key` column so rows are found by Record ID, never by row number. Record IDs look like `R-yymmddhhmm-XXX`.
- Emailed sign-in links and sessions.
- Web intake, Intake Queue, confirm, promotion to the tracking sheet. Duplicate handling.
- Scout Update page, Archive versions, unit type picker.
- Booking for Pre-Review Call, Proposal Review and EBoR, with calendar invitations. The Action column, a Notes document.
- `npm run deploy`: push, new version, update the deployment, publish pages.
- First README rewrite, overview and glossary for reviewers (2026-10-13).

### 3. Staging and cutover preparation, 2026-10-16 to 2026-10-20

- Separate dev, staging and production environments. A staging copy of the Council workspace with a test sheet and folders.
- Setup and repair tools that add missing columns and Settings keys.
- Unit contacts imported from a Council export, plus the Proposal guide page and landing page.
- Committee digest email and an Activity tab.
- Phased scheduling: a Settings key says which session types Scouts may book online. Booking cutoffs per type.
- New sections for stages (New Submissions, Eagle Rank Not Awarded, EBoR Paused). Section keys follow stage names.
- Committee actions run as the Council-owned account. The menu requires that account.
- Production tracking sheet migrated on 2026-10-20.
- Process-flow docs for the current implementation.

### 4. Production go-live, 2026-10-21 to 2026-10-23

- Committee demo on 2026-10-21. **Phase 1 live on 2026-10-22**: web submission and Pre-Review Call booking.
- Committee schedule page: month and week calendar, create, edit and delete slots, blocked times, booked sessions with
  two-way invite sync, create-and-book.
- Shadow bookings: session types not yet booked online are recorded without invites, mirroring the old schedule.
- Email templates from a Google Doc, one tab per email. Fallback to built-in wording.
- Outbox page with Outbox, Sent and Discarded tabs.
- Speed work: one read per tab per request, a short cache for Settings and lists. Later fixes never cache a failed read.
- Schedule check against the tracking sheet.
- Committee dashboard, Review outcome page, row actions for every stage. Production domain ccac.svmbc.org.

### 5. All session types online, 2026-10-24 to 2026-10-26 (API 0.25.0 to 0.35.0)

- 2026-10-24 was the busiest day (23 commits). Dashboard tabs by stage, sort and date bands, Scout detail window with
  history, "Eagle earned" in one step (scans, photos, emails to Council and the Scout), a derived "Waiting on Council" flag.
- Permanent email IDs (phase.state.letter) and a generated email catalog.
- EBoR reminders drafted three days ahead. Outbox "Send later".
- Admin page: held submissions, unit requests, the January 1 Eagle archive, email preview with test sends only to the user.
- Stats page: this year live, earlier years from a history tab.
- Scout emails go **To the Scout, Cc the parent or guardian** and the committee. Board size 3 to 6 on the dashboard and digest.
- **2026-10-26: Scouts book every session type online.** Council addresses moved into Settings.
- Outbox restore, "Email..." to draft a stage-appropriate email again, bulk drafts from the Admin page.
- Units page, unit contact editing, Key 3 role matching, "Email the units" in Bcc batches.
- Old-way bookings turned into real calendar invitations from the next day on.

### 6. Email-first intake, 2026-10-27 to 2026-10-31 (API 0.36.0 to 0.42.0)

- Online (Google Meet) option for In-Person Reviews and EBoRs. Life to Eagle Log panel on the dashboard.
- **Email-first intake (0.38.0):** one front door. A Scout enters an email address. If it is on file, a sign-in link is sent.
  If not, a "Start your Proposal" link is sent. Only the Scout's own address signs in. Duplicate submissions with the
  same name and unit are held for the committee. Same-name Scouts with different BSA IDs are not held.
- Reserved slots, and "staffed before bookable": a session with no committee member is not offered (0.37.0).
- EBoR emails go in one message to Scout and unit. Moved sessions say what changed.
- Sign-in hardening: same-browser check, links used up under a lock, a fresh-link button (0.40.0).
  A six-digit code option, off by default (0.41.0).
- Several sessions created at once, lead time per session, an open-times email to Scouts ready to book (0.42.0).

### 7. Committee and unit pages, 2026-11-01 to 2026-11-05 (API 0.43.0 to 0.55.0)

- Unit meetings (day, time, place) on the unit page. One contact list, with only the committee editing Unit Leader and
  Committee Chair. "Updated By" on every edit from the web.
- A Scout in several units (0.44.0). Eagles to Date per unit, with a count that rises when an Eagle is earned (0.45.0).
- Scout emails with no parent address on file Cc the committee group, so an adult is always copied.
- Outbox attachments, up to about 18 MB per email, with a warning near the Google Groups limit.
- Dashboard: Session column, links to the booked session, a "Formsite" tag.
- **Council Eagle applications from Formsite (0.49.0 to 0.50.0):** the hourly job files the uploads into the Scout's
  folder, matches the Scout on a best-effort basis, records it on a Council Applications tab and moves a matched Scout to
  Application Submitted. Filed and no-match emails are archived.
- Admin: compare a web submission with the tracking row field by field and take what the user ticks (0.51.0).
- Renames: a new name or unit also renames the Scout's folder, log and tool files (0.53.0 to 0.54.0).
- Preferred Name, optional, used in greetings and matching (0.55.0).
- One menu bar for views on committee pages.

### 8. Privacy work, 2026-11-07 and 2026-11-10

Records are about minors. Before publishing, real people's data was removed from tests, comments, docs and fixtures.

- 2026-11-07: fictional names and test addresses in tests, comments and docs.
- 2026-11-10: fictional unit numbers and test addresses in code and tests. A local script that held private details was
  removed from tracking and ignored. Docs use fictional unit examples.
- A hard rule in `CLAUDE.md`: no real person's data in this repo, including in commit messages.
- The public repository starts from one clean commit, because the earlier commits cannot be fully cleaned.

### 9. Approval and the Sign Workshop, 2026-11-05 to 2026-11-10 (API 0.56.0 to 0.61.0)

- "Please book" reminders: days per session type in Settings (0.56.0).
- The parent or guardian address is never the Scout's own. The Scout Update page asks for it when it is missing (0.57.0).
- **Multi-signer approval (0.58.0):** approving a Proposal can leave "Signatures pending". The signed copy passes to the next
  signer, and the approval email is drafted after the last one. A Setup step adds the column (0.58.1).
- Review page lists and opens files in the Scout's folder (0.59.0).
- **Sign Workshop:** the committee signs and flattens a Proposal PDF in the browser, with no upload to a third party.
  It decrypts the BSA workbook PDF, places a typed or drawn signature, and flattens form fields.
  Libraries are pinned to exact versions, with known-answer tests for the crypto. Ten script fonts, resize, and a target
  on the last approval page. Later fixes made field flatten safe, parsed hex `/Encrypt` entries, and made the code limits
  match the UI ranges (signature 50 to 140%, text 7 to 16 pt).
- Committee members can add files to a Scout's folder (0.60.0).
- Council applications now fetch files that Formsite links instead of attaching them (0.61.0).
- Staging anonymizer extended to Preferred Name, folders, logs and newer tabs.
- Subresource Integrity on every CDN script; a test checks the two PDF libraries' hashes against the installed packages.
- Docs brought up to 0.61.0.

## Decisions worth keeping

- **The sheet stays the record.** The committee still works in the tracking sheet. The tool files, emails and schedules
  around it. See the [overview](overview.md).
- **Firebase pages in front, Apps Script behind.** No server to run and no passwords. Hosting is static. Data stays in the
  committee's Google workspace.
- **A database later, if needed.** A move to Firestore as master, with Apps Script as the Google worker, was written up
  as a possible later step. It was not started.
- **Scoutbook stays the official record.** The tracker does not read or write it.
- **The Scout signs in; the parent is copied.** Emails go To the Scout, Cc the parent or guardian. If no parent address
  exists, the committee group is copied.
- **Outbox review.** Mail from committee actions can wait for a human to read it. Sign-in links are never copied to the
  committee group.
- **Staffed before bookable.** A session is offered to Scouts only when a committee member is on it.
- **Phased rollout.** Submissions and Pre-Review Calls first, other session types later, controlled by one Settings key.
  Old-way bookings were mirrored as shadow bookings until the cutover.
- **Rows by key.** Rows are found by Record ID or section key, never by row number or column letter.
- **Pure logic with tests.** Rules go in `lib/`. Adapters stay thin.

## Where it stands (2026-11-10)

- API 0.61.0, live in production, test mode off, all session types bookable online.
- Staging with anonymized Scouts is open to committee members for practice.
- Open: committee-shaped review checklists for the three Proposal steps, page tools for the Sign Workshop, and
  committee feedback on the Outbox redraft and dashboard tag layout.
