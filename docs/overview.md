# Overview: Coyote Creek Eagle Tracker

A tool for the **Coyote Creek District Advancement Committee** to follow each Life Scout from the first Eagle Project
Proposal through the Eagle Board of Review (EBoR), built on the committee's existing Google Sheet and district
Google Drive. Terms in this document are defined in the [glossary](glossary.md).

**Status (2026-11-10):** live in production at **https://ccac.svmbc.org** since 2026-10-22, running as the Council
account (`cc-advancement@…`) on the real tracking sheet. Proposals come in only through the website, and Scouts
book every session online (Pre-Review Call, Proposal Review, EBoR) since 2026-10-26. Committee members sign Proposals
in the browser, Council's Eagle applications are filed automatically, and the committee is shaping review checklists
for the three Proposal steps. A staging copy with anonymized Scouts is open to committee members for practice.

## The problem

The committee tracks every Life Scout in a shared tracking spreadsheet where a row's **section** is its status, and
schedules reviews on a separate signup sheet. Before the tool:

- **One volunteer was the bottleneck.** Proposals arrived by email; one person read each one, saved the attachments
  into the district drive, created and moved rows, and answered the Scout.
- **Scheduling was open to the world.** The signup sheet was link-editable by anyone and exposed Scout names and adult
  contact information.
- **History got lost.** Notes lived in one growing spreadsheet cell.
- **Files arrived with inconsistent names** and several copies.

## What it does

Each stage is a section of the tracking sheet. The committee still works in the sheet; the tool does the filing,
emailing and scheduling around it.

| Stage (sheet section) | Scout / parent | Committee | Tool |
|---|---|---|---|
| **Proposal Received** / **Proposal Incomplete** | Enters their own email, gets a link to the web form, submits the Proposal; sends updates | Checks it | Files the documents with standard names, adds the row at the top, sends a receipt listing what was entered |
| **Intake Review: To Book → Booked** | Books a ~20-minute Google Meet Pre-Review Call (help preparing for the full review); confirms an adult 21+ will be present | Runs the call; may book the Scout directly on the committee page | Invite with Meet link; row moves to Booked; a nudge if not booked after 7 and 14 days (Settings `pleaseBookDays`) |
| **In-Person Review: To Book → Booked** | Books a Proposal Review (in person) | Members put themselves on sessions | Invite with location; members added later are invited; panel names not shown to the Scout |
| **Revisions / Approved / Not Approved** | Sends updated files and details | Record the outcome on the Review page; approval = sign the Proposal in the browser (**Sign Workshop**) or upload a signed copy; more signers can follow | Renames and files the signed copy, archives older versions, fills the dates, moves the row, passes the copy to the next signer, drafts the approval email in the Outbox after the last |
| **Application Submitted → Verified** (Council verifies) | Submits the Eagle application on Council's form; books the EBoR; can add others to invite | Records the dates from the dashboard | Files Council's application email and its uploads into the Scout's folder and moves a matched Scout to Application Submitted; acknowledgement and next-steps emails; notifies the unit's contacts; unit adults enter Unit Board Members (or ask to host the board) |
| **EBoR Booked / Paused → Eagle Earned / Not Awarded** | — | Hold the board (3 to 6 members); record the outcome with the signed scans and photos | Invite to Scout, parent, district reps and unit board members; reminders 3 days before; files the scans, emails Council and the congratulations; keeps EBoR Booked in date order |

Committee members move a Scout by picking the next stage from the row's **Action** dropdown. They schedule sessions on
a **committee calendar page**: click a day to add a Pre-Review Call, Proposal Review, EBoR or blocked time, pick the
members from checkboxes, and optionally book a Scout into it on the spot (the usual path for ad-hoc Pre-Review Calls).

Every action, typed note and email is recorded at the top of a per-Scout **Life to Eagle Log** (a Google Doc in the
Scout's folder). A **daily digest** emails the committee what is **awaiting action** (new files, Outbox drafts, boards
short of members, held submissions, unit requests, Scouts waiting to book …), the next 7 days of sessions, and
everything that changed.

On the web, committee members have a **dashboard** (tabs of Scouts by stage, row actions, a detail window), the
**schedule**, the **Outbox**, **Review outcome** (the Scout's files and the Sign Workshop), **Units** (contacts, meetings,
Eagles to Date), **Stats** (this year live, past years from a history tab) and an
**Admin** page (held web submissions, unit requests, email preview, the January archive). Unit leaders see their
Scouts' stages and sessions, enter board members and can ask to host a board.

**Emails** use wording from a Google Doc the committee edits (one tab per email, with formatting), and go **To the
Scout, Cc the parent/guardian** and the committee (empowering the Scout, two-deep coverage). Emails a committee
member's action would send can be set to wait in an **Outbox** on the committee page, where a member can edit, send,
send later, have replies come to themselves, send from their own email, or discard them.

## How it is built

```
 Scouts, parents, unit adults,           Committee members
 committee members (web browser)         (Google Sheets, as today)
        │                                       │
        ▼                                       ▼
 Firebase Hosting                      Tracking spreadsheet ──── Apps Script project
 static pages                          (sections = status)        (one project)
 no data, no server ── JSON calls ──►  Schedule sheet               │
                                       District Google Drive ◄──────┤ files, logs, template Doc
                                       Gmail / Google Calendar ◄────┘ emails, invites (Meet)
```

- **One Google Apps Script project**, attached to the tracking spreadsheet, reads and writes the sheets, files
  documents, sends email, creates Calendar invites, and adds the **Eagle Tracker** menu. It runs as the Council account.
- **Static web pages** on Firebase Hosting: landing, submit, confirm, proposal guide, sign in, the Scout's page,
  the unit page, and the committee pages (dashboard, schedule, Outbox, Review outcome, Units, Stats, Admin). They hold no data
  and no credentials.
- **No database, no servers to run, no passwords.** The spreadsheets, the drive and the template Doc remain the record.
- **PDF signing happens in the browser** (pdf.js and pdf-lib, loaded only when the Sign Workshop opens): the Proposal
  never goes to a third-party service, and only the signed result is uploaded.
- The logic that matters is plain JavaScript with **over 400 automated tests** that run without Google.

## Data, privacy and safety

Records are about minors, so the design keeps data where it already lives and shows each person the least possible.

**Where data lives**

| Data | Where |
|---|---|
| Scout records, schedule, unit contacts, committee list | The committee's Google Sheets (tabs added: Settings, Intake Queue, Uploads Log, Committee, Unit Info, Unit Contacts, Key 3, Activity, Digest Log, Outbox, Unit Requests, Stats History) |
| Proposals and other files, Life to Eagle Logs | The district Google Drive, in each Scout's folder |
| Email wording | A Google Doc, one tab per email |
| Sign-in sessions | A hidden sheet tab, stored only as salted hashes |
| Short-lived tokens, cached settings | Apps Script cache (expire automatically) |
| Web pages | Firebase Hosting: static files only, no Scout data |
| A member's saved signature (optional) | That member's own browser (local storage), never the server |

**Who sees what**

- **Scouts and parents** sign in with a one-time link emailed to an address already on file and see only their own
  status, file names and bookings. The sign-in page gives the same answer whether or not an address is on file.
- **Unit leaders** (Key 3 or Unit Contacts) see only Scout name, unit, date and place of their units' EBoRs, and enter
  board members. Units under review get the notice without the ability to edit.
- **Committee members** (on the Committee tab) also sign in this way and get the committee schedule (Scout names,
  units, sessions), the Outbox and the Scout's files on the Review page. Internal notes are never shown to Scouts.

**Safeguards**

- **No passwords.** Sign-in links work once and expire in about an hour; sessions expire after 14 days (30 for
  committee members) and can be signed out.
- **Rate limits and spam guards:** one sign-in request per address per 5 minutes, a cap on intake submissions per hour,
  a bot trap field, file type and size limits.
- **Email first:** the form opens only from a link emailed to the Scout's address, so every submission comes from a proven
  address. Only the Scout's own address signs in; parents are copied on every email (Settings `parentsSignIn`).
- **Test mode** (on by default, and on if the setting is unreadable): every email and invite goes only to a test
  address, marked `[TEST]`, listing who would have received it.
- **Sign-in links are never copied to the committee's group mailbox.** All mail comes from the Council account with
  replies going to the committee group.
- **Youth protection:** booking a Pre-Review Call or Proposal Review requires confirming that a parent or another adult
  21+ will be present.
- **Concurrent edits** are serialized with a script lock; rows are found by a hidden ID, never by row number.
- **Menu items need the Council account**, so mail and invites never come from a volunteer's personal account.
- **The staging playground** uses fake Scouts (`Scout_1`…) and never touches production files.

**Web app access.** The script's web endpoint is deployed with access *Anyone*, because Scouts and parents don't have
Council accounts. Every request is checked against the sign-in session and role, and only returns or changes what
that page is allowed to.

## If the tool stops

The committee keeps working exactly as before: edit cells, insert rows, drag rows between sections. Nothing is lost.
Switching off the pages returns Scouts to emailing the committee.

## What it needs from Council

1. **The Council account** (`cc-advancement@…`): in place (2-Step Verification on; owns the scripts, the
   Firebase projects, the calendar and the template Doc). Asked of Council: a longer Google session length, so the
   developer's command-line tools don't need re-signing every day.
2. **DNS:** `ccac.svmbc.org → cc-eagle-tracker.web.app`: **in place (2026-10-23)**; Settings → `webOrigin` = `https://ccac.svmbc.org`.

## Decisions and alternatives

Options considered: hardening the sheets only; a Google-only Apps Script web app; a thin Firebase front end with the
sheet as the record (**chosen**); a full Firebase app with its own database; and AppSheet. The chosen option keeps the
spreadsheet as the source of truth, keeps all data in Council's Google Workspace, adds no servers, and stays
maintainable by one volunteer. A real backend (database) is a later option once adoption is proven. Scoutbook remains
the official advancement record.

## Later

- Sign Workshop page tools: insert supporting pages before the approval page, keep/delete, reorder, merge PDFs and
  photos, save as a new Proposal version; then compression.
- Review checklists: a copy of the committee's checklist template (Submission Verification, Intake Review, In-Person
  Review) in the Scout's folder for each review step.
- Age alerts for Scouts nearing 18 (on hold); whether EBoR reminders may send automatically (committee to decide).
- Repeating sessions (weekly × N) on the committee page; search on the dashboard.
- Proposal precheck (missing signatures, contact page, approval representative), human in the loop.
- An Admin role (everyone on the committee sees the Admin page for now).
- A database backend (Firestore as the record, Apps Script kept for Gmail / Drive / Calendar) once the committee works
  on the web pages day to day; to be decided with timing measurements (2026-10-29: staying on the sheet for now).
- Other districts: whether and how the tool could serve them.
