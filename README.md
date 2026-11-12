# Coyote Creek Eagle Tracker

A tool for the **Coyote Creek District Advancement Committee** (Silicon Valley Monterey Bay Council) that follows each
Life Scout from the first Eagle Project Proposal through the Eagle Board of Review. Scouts submit their Proposal and
book their Pre-Review Call, Proposal Review and Eagle Board of Review online; unit leaders enter their board members;
committee members schedule sessions on a calendar page and keep working in the tracking spreadsheet they already use.

> **Status (2026-11-10, API 0.63.0):** **production** runs as the Council account (`cc-advancement@…`) on the
> real tracking sheet at **https://ccac.svmbc.org**, **live since 2026-10-22**, all booking online since 2026-10-26
> (test mode off, `onlineBooking` = `all`): Proposals come in only through the website (email first), and Scouts book
> their Pre-Review Call, Proposal Review and EBoR online. Committee members work on the web pages (dashboard, schedule,
> Outbox, Review outcome with the in-browser **Sign Workshop**, Units, Stats, Admin) and in the sheet. Council's Formsite
> Eagle applications are filed into the Scouts' folders automatically. A **staging** copy with anonymized Scouts is the
> committee's playground.

**Start here:** [docs/overview.md](docs/overview.md) (what it does, how it's built, data and privacy), the
[glossary](docs/glossary.md) of committee terms, the [process flow](docs/process-flow.md), and the
[history](docs/history.md) of how it was built (205 commits, October 10 to November 10, 2026).

> **About this repository.** The tool was built for one district and runs in that district's Google Workspace: this
> code holds no Scout data, and every example in it is fictional (Scout_1, Theodore "Teddy" Sample, units like T910).
> It is published as a portfolio piece and for other districts or councils who want a starting point; Settings,
> section names and email wording are meant to be adapted, but expect to read the code. This repository starts from
> one commit. Despite a conscious and deliberate effort, a few real names, including from the author's own family,
> slipped into the earlier private repository's commit history. To protect personal information, especially that of
> minors, the code was published as a new repository without that history; [docs/history.md](docs/history.md)
> records what the history showed. MIT License ([LICENSE](LICENSE)).

## At a glance

- **One Google Apps Script project** attached to the tracking spreadsheet does all the work: sheets, district Drive,
  Gmail, Calendar (with Meet), the **Eagle Tracker** menu and installable triggers.
- **Static pages** on Firebase Hosting (`web/`): landing, submit a Proposal, confirm, proposal guide, sign in,
  the Scout's page, the unit page, and the **committee pages**: dashboard (`/committee`), schedule, Outbox,
  Review outcome, Units, Stats and Admin (`/committee/*`). No data and no credentials in them; they call the script. One shared header
  (`js/header.js`).
- **No database, no servers, no passwords.** Sign-in is a one-time link emailed to an address already on file.
- **Data stays where it is:** the tracking and schedule sheets, the district Google Drive, and one Google Doc of email
  templates.
- **If it's switched off,** the committee keeps working in the same spreadsheet by hand, with nothing lost.
- **Tested:** the rules are plain JavaScript in `apps-script/src/lib/` and the browser-side PDF rules in `web/js/pdf*.js`, with
  over 400 tests that run without Google (`npm test` = a TypeScript check of `web/js/pdf*.js`, then vitest).

## Stages (tracking-sheet sections)

Section names and order live in Settings (columns D:G); keys never change.

| Key | Section | What happens |
|---|---|---|
| `proposal_received` | Proposal Received | Scout submitted on `/intake` and confirmed; files filed and renamed; row lands at the top |
| `proposal_incomplete` | Proposal Incomplete | Something is missing; Scout sends an update |
| `intake_to_book` | Intake Review: To Book | Scout books a ~20-min Google Meet Pre-Review Call (adult 21+ confirmed) |
| `intake_booked` | Intake Review: Booked | Call booked (booking moves the row; cancelling moves it back) |
| `intake_revisions` | Revisions Requested for Review | Changes needed before the in-person review |
| `review_to_book` | In-Person Review: To Book | Scout books a Proposal Review (in person, panel not named) |
| `review_booked` | In-Person Review: Booked | Review booked |
| `proposal_revisions` | Proposal Revisions Requested | Changes after the review |
| `proposal_approved` | Proposal Approved | Status only |
| `app_submitted` | Application Submitted | Status only |
| `app_verified` | Application Verified | Scout books the EBoR; unit contacts notified and enter Unit Board Members on `/unit` |
| `ebor_booked` / `ebor_paused` | EBoR Booked / EBoR Paused | Invite to Scout, parent, reps and unit board members |
| `eagle_earned` / `eagle_not_awarded` | Eagle Earned / Eagle Not Awarded | Outcome |
| `beyond_age`, `proposal_not_approved` | Beyond Age: Special Needs, Proposal Not Approved | Side sections (bottom of the tab) |
| `closed` | Closed | Terminal side section (last): withdrew, aged out, extension denied, moved away, duplicate. Status only; Scout's page: "Your record is closed. Questions? Reply to the committee." No email, folder stays put. Closed in a past year: archived each January (see Admin page) |

Committee members move Scouts with the row's **Action** dropdown (rows land at the **top** of the new section).
Every event and typed note is kept in a per-Scout **Life to Eagle Log** (Google Doc), linked from the Notes cell.

---

# Maintainer manual

## Repository layout

```
apps-script/              clasp rootDir (pushed to Apps Script)
  appsscript.json         scopes, Advanced Calendar + Docs services, web app = execute as deployer, access Anyone
  src/lib/                PURE logic, unit-tested in Node (no Google services)
    settingsModel.js      Settings tab → object; sections (keys, labels, aliases), Scout status text, Action options
    sheetModel.js         machine header row, _key column, sections, Record IDs, auto-keying
    sheetKind.js          production vs STAGING/Test Copy (by file name); council-account check for menu items
    migrationPlan.js      adding the structure to an existing tracking tab
    identity.js           sign-in links and sessions
    mailPlan.js           test mode; sign-in links never copied to the group; staging pass-through for committee sign-in
    intake.js             intake validation, units (T/C/S), file names + versions, duplicate check, receipt text
    scoutFiles.js         standard names, Archive plan, field diffs, log lines
    booking.js            slot types and rules, open slots, blocked times, keys, invite sync (add/remove), email text
    committeeSchedule.js  committee page: calendar entries, slot checks (past, overlaps, cutoff, batches), Scout dropdowns, row order
    units.js              unit tabs combined (Key 3 + Unit Contacts + Unit Info), Unit Board Members, unit emails
    key3.js               reads Council's Key 3 export (CSV / Sheet) by header names
    folderMatch.js        matching existing 202x folders to Scouts (cutover)
    digest.js             digest schedule, selection and email
    templates.js          email template tabs → subject + HTML + text (placeholders, lists, formatting)
    templateCatalog.js    every templated email: tab name, placeholders, starting wording, How-to text
    pending.js            new files waiting on the committee (_pending_since): raise/keep oldest, age, waiting list
    outbox.js             Outbox helpers (addresses, HTML ↔ text, cleaning edited HTML, attachments, log lines)
    board.js              dashboard tabs (sections → tabs, ages, last note)
    scoutDetail.js        detail window: column → tab by group heading, cell types, edit validation, log lines
    scoutLog.js           log panel: new-note prefix (date, [initials]), text clean-up, edit checks
    eagleDone.js          Eagle earned in one step (file names, recipients, unit names) + folder placement rule
    stageActions.js       dashboard row actions per stage (dates recorded, row move, email, column filled when sent)
    proposalOutcome.js    Review outcome: initials (AB, CD → AB&CD), signed file name, Archive plan, dates, dashboard counts
    reminders.js          EBoR reminder (4.3.c): which boards are due, board list text
    closing.js            Closed records: reasons, close / reopen plans, the _closed cell, "Close?" suggestions, January archive rows (no contact details), closures by reason
    nudges.js             hourly nudges (4.1.h, 6.2.b, 6.2.c), _stage_since, the digest's "Awaiting action" list
    adminRules.js         Admin page: held web submissions and their actions; January archive (years, rows to delete)
    sectionSort.js        EBoR Booked in EBoR Date order (latest at the top): wanted order + row moves
    stats.js              Stats page: this year live (months, ages, female, pipeline, speed, units, sessions); history rows
    templateSamples.js    email preview: sample values for every placeholder, TEST banners
    emailMenu.js          "Email…" action: which emails fit a stage, what each needs, recently sent
    eborPaperwork.js      EBoR paperwork: field map, MM/DD/YY, signer rules, Verified file picking, archive plan
    unitDirectory.js      unit contacts on the web: Key 3 rows vs unit-provided, directory, validation
    unitBroadcast.js      "Email the units": recipients by unit type and role, unique, Bcc batches
    openTimes.js          open-times email: Scouts ready to book a type, one To/Cc list, the times to list
    shadowInvites.js      old-way ("shadow") bookings from tomorrow on that can get a Calendar invitation
    unitCalendar.js       unit page calendar (the unit's Scouts' sessions, open times)
    scheduleCheck.js      schedule sheet vs tracking dates (transition helper)
    anonymize.js          staging playground: fake Scouts, scrubbing names/emails/phones
    councilApp.js         Council Formsite Eagle application emails: which Scout (graded match), which file is which, names
    eagleCount.js         Eagles to Date per unit: the number to announce, "+1" on Eagle earned, {eagleNumberLine}
  src/*.js                thin adapters over SpreadsheetApp / DriveApp / MailApp / Calendar / Docs / LockService
    router.js             doPost → actions (sign-in, intake, update, booking, units, committee, Outbox); timing log
    records.js            Candidate Records (one read per request); withLock_
    cache.js              per-request memos + 5-minute script cache (Settings, Committee, units, sessions, templates)
    auth.js               request / redeem sign-in link, whoami (roles), sign out
    intakeQueue.js        intake, confirmation, promotion, duplicate handling, Intake Queue actions
    scoutUpdate.js        Scout folders, the Scout's page, Scout Update, Life to Eagle Log lines
    bookingActions.js     schedule sheet, Calendar invites, booking/cancel, invite sync, unit notices, menus
    committeeActions.js   committee page: schedule, create/edit/delete slots, members on booked slots, cancel, create-and-book
    outboxActions.js      Outbox queue and actions (attach / remove / download files; Send includes them)
    pendingActions.js     raise/clear _pending_since, amber Action colour (conditional format), Admin → flag selected rows
    scoutDetailActions.js scoutDetail / scoutSave / scoutMove (detail window: tabs, edits, correction moves)
    scoutLogActions.js    scoutLog / scoutLogAdd / scoutLogEdit (log panel)
    folderPlace.js        folder placement (202x / EBoR year / Exceptions), Admin → Folders: place by stage
    rowActions.js         rowAction / uploadRowFile / rowFinish: dates, move, log, Outbox draft (unit contacts included)
    reviewActions.js      committee dashboard counts and rows; Review outcome (upload signed Proposal, dates, move, log, email draft)
    committeeUploadActions.js  Scout detail → Add files…: a member files a Scout's files (same naming / versions as a Scout upload)
    remindersActions.js   hourly EBoR reminder → Outbox
    closingActions.js     Close record… / Reopen… / Keep open row actions, "Close?" suggestions, January archive of Closed records
    nudgesActions.js      hourly nudges, digest "Awaiting action" data, daily health check (6.9.e)
    adminActions.js       Admin page: held submissions (attach / promote / resend / spam), January archive
    unitRequests.js       unit "host a board" requests (Unit Requests tab)
    sectionSortActions.js keeps EBoR Booked sorted; Admin → Sort EBoR Booked by EBoR date
    statsActions.js       Stats page; Stats History tab
    templatePreviewActions.js  Admin page email preview / send a test copy to yourself
    emailActions.js       "Email…" action: (re)draft a stage's emails into the Outbox
    unitDirectoryActions.js  Units page / unit page contacts: list, edit, add, remove
    broadcastActions.js   Admin → Email the units (preview, test, send in Bcc batches)
    openTimesActions.js   committee page: several sessions at once (saveSlots), open-times email draft
    shadowInviteActions.js  Admin → Old-way bookings: send calendar invitations
    scheduleCheckActions.js    Admin → Schedule: check against the tracking sheet
    templateMail.js       mailFromTemplate_ (template Doc → email, or built-in wording), template Doc setup
    unitActions.js        unit contacts' page (EBoRs, board members, calendar, Eagle candidates)
    unitContacts.js       unit tabs, Key 3 import
    digest.js             Activity tab, digest trigger, Digest Log
    notes.js              Life to Eagle Log
    triggers.js           installable edit/change triggers (Action column, notes, names, Intake Queue, cache clearing)
    folders.js            cutover: folder report + apply, mock folders
    anonymizeStaging.js   Admin → Anonymize this STAGING sheet
    councilAppActions.js  hourly: file Council Formsite application emails into Scout folders; Council Applications tab
    eagleCountActions.js  Unit Info → Eagles to Date (unit page / Units page edits; +1 on Eagle earned)
    tabs.js settings.js mail.js menu.js setup.js
  src/tools/              migrate.js, fakeSchedule.js
web/                      Firebase Hosting: index, intake, confirm, proposal-guide, signin, update, unit,
                          committee.html (dashboard), committee/{schedule,outbox,review,units,stats,admin,ebor-paperwork}.html (absolute /css /js paths)
  js/                     api.js (fetch), config.js (API URL per host), header.js (shared header), files.js (uploads),
                          committee.js (session, committee nav), outbox.js (Outbox UI, page + schedule popup),
                          boardSort.js (dashboard sorting inside a stage), photos.js (EBoR photo resize + EXIF date),
                          calendarView.js (FullCalendar, loaded on demand: Scout and unit pages),
                          unitContacts.js (unit contacts panel: committee Units page + unit page),
                          pdfPlan.js (pure: Scout folder file roles, workbook edition, which page is ours, placement math),
                          pdfEngine.js (pdf.js inspection, BSA workbook decryption, sign + flatten with pdf-lib),
                          pdfWorkshop.js (Sign Workshop dialog on the Review page; libraries and fonts loaded on demand),
                          pdfInk.js (signature image helpers), pdfDraw.js (touch / stylus draw pad), pdfView.js (page viewer with draggable marks),
                          pdfPaperwork.js (EBoR paperwork: Requirement 7 page and date boxes, form fill), pdfPaperworkPage.js (that page),
                          pdfStrokes.js (pen strokes as data, pure), pdfDraw.js (pad engine), pdfSignPad.js (the signing overlay)
test/                     vitest (+ tsconfig.json: type check of web/js/pdf*.js)
tools/deploy-api.mjs      npm run deploy:api[:staging|:prod]
docs/                     overview, glossary, process flow
```

Apps Script has no modules: every file shares one global scope. Lib files are IIFEs that export one global
(`SheetModel`, ...) and also `module.exports` for Node. **Don't reference another file's globals at load time**, only
inside functions (`test/gas-load.test.js` checks this and that every entry point exists).

## Sheet conventions

- **A Scout in several units** (Jim W. 2026-11-01): list them in the Unit cell, **primary first** ("C967 T911",
  "T910 / C917"; space, slash, comma or a line break between). The primary unit is the one on the Eagle application:
  its contacts get the EBoR emails, only it sets Unit Board Members, and files, folders and the Stats page use it.
  Every listed unit sees the Scout on its unit page (Eagle candidates, EBoR list, calendar); the others see the board
  read-only. `Units.codes` / `Units.primary` / `Units.primaryText`; `Units.find` uses the primary.

- A **hidden machine header row** directly above the visible header row holds unique column names (`scout_name`,
  `parent_email`, `proposal_review.date`, ...). Scripts use these names, never column letters, so columns can be
  added and moved. After adding a column, **Admin → Name new columns**.
- A **hidden `_key` column** (column A) holds `S:<section key>` on section label rows and a Record ID
  (`R-yymmddhhmm-XXX`) on each Scout row. A Scout's status is the nearest `S:` above it (position = status).
- **Hidden columns at the far right:** `_folder_id`, `_log_id`, `_cc`, `_pending_since`, `_request` (the committee's
  last request, shown on the Scout's page), `_stage_since` (`<section> <date>`: when the Scout reached the stage; reset
  by the hourly run whenever the section differs, so hand-dragged rows count too), `_closed` (Closed records: JSON
  `{r: reason, d: date, by: initials, from: stage key, n: note}`, so Reopen knows where it came from) and `_close_snooze`
  (a "Keep open" decision hides the "Close?" suggestion until that date). They travel with the row.
- **Tabs the tool adds:** Settings, Intake Queue, Uploads Log, Committee (Name | Initials | Email | Active), Unit Info
  (Unit | Under Review | … ; any mark in a column titled "Under Review" / "…restrict…" = under review), Unit Contacts,
  Key 3, Activity, Digest Log, Outbox, Unit Requests, Stats History (past years for the Stats page), Closed Archive (January archive of Closed records), `_Sessions` (hidden). The **Eagle Archive** tab (past years' Eagles) is not made by Setup / repair: it began as a copy of the tracking tab, and the January archive creates it from the tracking tab's header rows when it is missing. Setup / repair tabs adds missing tabs,
  columns, Settings keys and sections, and never deletes anything.
- **Schedule sheet** (separate file, Settings → `scheduleSheetId`): one row per session, hidden machine row with
  `date, day, time, scout_name, unit, reps, board_members, slot_type, location, address, duration_min, record_id,
  event_id, _key`. Rows are kept in date order.
- **The schedule row is the source of truth** for who and when: the Calendar invitation and the tracking row's
  Date/Who columns (Pre-Review Call, Proposal Review, EBoR → `ebor_ccac_reps`) are copied from it on every sync
  (schedule edits, committee page changes, hourly). Nothing flows back from the tracking tab.
- **EBoR Booked stays sorted** by EBoR Date (latest at the top, the next board at the bottom; no date first): after a
  move in, a tool-written or typed EBoR Date, and Admin → Sort EBoR Booked by EBoR date. Whole rows move.
- **Test mode** (Settings → `testMode`) is ON by default and fails safe.

## Environments

| | dev | staging | prod |
|---|---|---|---|
| Google account | Jim's Gmail | the Council account (`cc-advancement@…`) | the Council account (`cc-advancement@…`) |
| Sheet | `Test Copy of …` in Jim's My Drive | `STAGING …` in the Council shared drive (fake Scouts) | `Coyote_Creek_Life_to_Eagle_Tracker`, tab `Eagle Tracker` |
| clasp | `.clasp.json`, user `default` | `.clasp.staging.json`, user `cc` | `.clasp.prod.json`, user `cc` |
| Firebase | `ccac-eagle-tracker-dev` | `cc-eagle-tracker-staging` | `cc-eagle-tracker` |
| Pages | `ccac-eagle-tracker-dev.web.app` | `cc-eagle-tracker-staging.web.app` | **`https://ccac.svmbc.org`** (Council DNS, live 2026-10-23; also `cc-eagle-tracker.web.app`). Settings → `webOrigin` = `https://ccac.svmbc.org` |
| Commands | `npm run deploy` | `npm run deploy:staging` (`:api:staging`, `:web:staging`) | `npm run deploy:prod` (`:api:prod`, `:web:prod`) |

`web/js/config.js` holds one `/exec` URL per environment; a page picks it by the host it is served from (unknown host =
no API). Non-production pages show a "test site" note. The file name decides how the scripts treat a sheet
(`lib/sheetKind.js`): `Test Copy …` / `STAGING …` = non-production, anything else = production.

## Deploying

```
npm test
clasp -u cc -P .clasp.<env>.json push --force     # sheet code (menus, triggers) runs this at once
npm run deploy:api:<env>                          # web app (/exec) runs a frozen version until redeployed
npm run deploy:web:<env>                          # pages
```

Jim keeps these steps (plus `git push`, refusing to run with uncommitted changes) in a local, untracked `pub`
script. If the landing page's API version differs from **Admin → Self-check**, run `deploy:api` again. Google Workspace
session control may expire the cc logins (`invalid_rapt`): `clasp -u cc login --no-localhost`,
`firebase login:add --no-localhost`. The Firebase deploy commands use the account set for this folder: run
`firebase login:use <the Council account>` once (no account names are kept in the repo). After a deploy that adds Settings keys or tabs, run **Admin → Setup / repair tabs**.

### First-time setup (staging or prod, as cc-advancement)

1. The sheet (staging: a copy named `STAGING …`; prod: the real one). **Extensions → Apps Script** → Script ID into
   `.clasp.<env>.json`; `clasp -u cc -P .clasp.<env>.json push --force`.
2. Reload → **Admin → Setup / repair tabs** (approve permissions as cc-advancement).
3. **Settings:** `webOrigin`, `testMode` TRUE, `testRecipient`, `adminEmail`, `trackingTab`, `intakeFolderId`,
   `scoutsFolderId`, `scheduleSheetId`, `committeeGroupEmail`, `councilDomain`, `councilEaglesEmail`, `onlineBooking`. Prod only: `allowProduction` TRUE for
   the migration, FALSE after.
4. **Admin → Migration: dry run**, name a version in File → Version history, **Migration: apply + set up**.
5. `node tools/deploy-api.mjs --env <env> --create "<env> first deploy"` → URL into `API_URLS.<env>` in `config.js`.
6. `npm run deploy:<env>`; **Admin → Install sheet triggers**; **Admin → Templates: create Doc / add missing tabs**;
   **Self-check**.

The production cutover steps (folders, logs, Unit Info highlight, protections) are in the cutover checklist (a design note kept outside the repo).

## Settings reference (Settings tab, A:B; kept A → Z by Setup / repair tabs, sections in D:G untouched)

| Key | Default | Meaning |
|---|---|---|
| `testMode` | TRUE | All mail and invites only to `testRecipient`, `[TEST]` subject |
| `testRecipient`, `adminEmail` | | Test inbox; error reports |
| `testDeliverToCommittee` | FALSE | Staging: mail addressed only to Committee tab members (their sign-in links) is delivered |
| `committeeGroupEmail`, `replyTo` | | Group copied on Scout emails; Reply-To on every email (blank = the group) |
| `templatesDocId` | | Email template Doc; blank = built-in wording |
| `trackingTab`, `scheduleSheetId`, `scheduleTab` | Eagle Tracker, , Schedule | Where the data is |
| `intakeFolderId`, `scoutsFolderId`, `inProgressFolder`, `folderReportFolders` | , , 202x, | Drive folders |
| `webOrigin` | | Base URL of the pages (links in emails) |
| `onlineBooking` | Pre-Review Call | Types Scouts book online (`all`, `none`, or a list) |
| `bookingLeadHours`, `reviewLeadHours`, `eborLeadHours`, `cancelCutoffHours` | 48, 48, 336, 24 | Online booking/cancel cutoffs (a session's own Lead (h) replaces the booking cutoff) |
| `intakeMinutes`, `reviewMinutes`, `eborMinutes`, `followupMinutes` | 20, 60, 90, 30 | Default session lengths (committee page); `followupMinutes` is the Follow-Up / Consult |
| `defaultStartTime`, `defaultLocation`, `defaultAddress` | 7:00 PM | Committee page defaults |
| `linkMinutes`, `sessionDays`, `committeeSessionDays` | 60, 14, 30 | Sign-in link and session lifetimes |
| `signinCode` | FALSE | TRUE: the sign-in email also carries a 6-digit code, typed on the page that asked (5 tries; one waiting code per browser; using the link or the code uses up both). For iPhone email apps that open links in their own browser |
| `linkBrowserCheck` | log | Sign-in link opened in a different browser than the one that asked: `off`, `log` (record in `_SignIns` only), `enforce` (blocked, with a "Send a fresh link to this browser" button) |
| `intakeLinkHours` | 6 | "Start your Proposal" link lifetime (max 6) |
| `parentsSignIn` | FALSE | TRUE lets parent/guardian addresses sign in to the Scout's record |
| `digestHours`, `digestTo` | 6 PM, | Committee digest schedule and recipients |
| `intakeConfirmDays`, `intakePurgeDays`, `maxUploadMB` | 7, 14, 20 | Intake |
| `stampsFolderId` | | Drive folder of stamp PNGs for the Sign Workshop (blank = no Stamp button) |
| `councilDomain`, `allowProduction` | (blank), FALSE | Menu items need a Council account; migration guard |
| `approvalRep*` | | Council/District Project Approval Representative (proposal precheck, later) |
| `*DateColumn`, `*WhoColumn`, `calendarId` | | Tracking columns filled on booking; calendar |
| `approvedDateColumn` | (blank) | Approved Date column for the Review page; blank = the column whose machine name ends in `approved_date` |
| `appSubmittedColumn`, `appVerifiedColumn`, `eborEmailedColumn` | (blank) | Row-action date columns; blank = found by name (Self-check shows them) |
| `eborWhoColumn` | `ebor_ccac_reps` | EBoR board initials copied from the schedule (type it on the Settings tab: a blank cell there overrides the default) |
| `femaleColumn` | (blank) | Female column for the Stats page; blank = the column whose machine name is/ends in `female` |
| `pleaseBookDays` | `Intake 7,14; ESSPPR 7,14; EBoR 7` | "Please book" reminders: days in the To Book stage per session type (code or label); a type with no days = none |
| `signingNudgeDays` | 3 | Proposal signatures in progress: listed in the digest after this many days waiting on a signer |
| `councilAppFrom` | (blank = off) | Council Formsite application emails filed into Scout folders from this date |
| `eborReminderDays`, `dayOfContact` | 3, | EBoR reminders drafted this many days before; "Running late?" line |
| `councilAckDays`, `svmbcReceivedMark`, `councilEaglesEmail` | 7, `*`, (blank) | Waiting on Council; Council Eagle Services address (Self-check flags it when empty) |
| `advancementReportTemplateId`, `districtName`, `advancementTitle` | (blank), Coyote Creek, Coyote Creek Advancement | EBoR paperwork page: Drive file id of the blank Advancement Report (form 34403, kept in Drive, never in this repo); the District and Title fields |
| `eborDoneColor`, `exceptionsFolder`, `unitPipeline` | #93c47d, Exceptions, TRUE | Eagle earned paint; folder; unit page candidate list |
| `closeReviewDays` | 180 | Proposal Not Approved / EBoR Paused with no log line or update for this many days: amber "Close?" tag and digest line (also at 18 or older). Beyond Age is never suggested |
| `closeSnoozeDays` | 90 | "Keep open" hides the "Close?" suggestion for this many days |
| `eagleArchiveTab` | Eagle Archive | January archive: a past year's Eagles go to the top of this tab, in the tracking spreadsheet |
| `closedFolder` | Archive/Closed | January archive: Closed Scouts' folders move to `<Scouts folder>/<this path>` (created when missing) |
| `eborSignupUrl`, `reviewSignupUrl` | | `{scheduleLink}` while those types aren't booked online |

## Features in detail

### Committee menu (Eagle Tracker)

Menu items run as whoever clicks them, so on staging/production they require an `@svmbc.org` account. Committee
members use the Action column, the schedule sheet and the committee page instead (all run as cc-advancement).

- **Intake OK / Resend booking link / Book a slot / Cancel booking / Sync invites now** (select a Scout's row).
- **Intake Queue:** promote, mark as spam, purge old unconfirmed submissions.
- **Admin:** setup / repair tabs, self-check (also lists units under review), name new columns, test email,
  **Templates: create Doc / add missing tabs / number the tabs / rebuild catalog**, migration, fake schedule, key new
  slots, schedule check, install sheet triggers, digest now, folder report / apply / mock folders / place by stage,
  **Anonymize this STAGING sheet**, start Life to Eagle Logs, new files: flag rows, **Sort EBoR Booked by EBoR date**,
  import Key 3.

| Task (committee member) | How |
|---|---|
| Move a Scout | Action column → section (moving to a To Book stage emails the booking link) |
| New files looked at, nothing to change | Action column → "✓ Checked: nothing to do" (clears the amber) |
| Email the Scout their status + page link | Action column → "✉ Email status + page link" |
| Sort a section by age | Action column on the section's header row |
| Create, change, delete sessions; book a Scout; manage members; cancel | `/committee/schedule` |
| Record a Proposal Review outcome (upload the signed Proposal) | `/committee/review` |
| Check / send emails waiting for review | `/committee/outbox` (also a popup on the schedule) |
| Held web submissions, unit requests, January archive, email preview | `/committee/admin` |
| Sign the Verified Application + Advancement Report at the board | `/committee/ebor-paperwork` (link on Admin) |
| Statistics | `/committee/stats` |
| Book / cancel on the sheet | Schedule sheet: type / clear the Scout's name in a slot |
| Promote / spam a submission | Intake Queue → Action column |

### Sign-in and roles

One sign-in page for everyone (`/signin`, emailed one-time link). The email decides what the signed-in page offers:
Scout record(s), unit contact (`/unit`), committee member (Committee tab Email → `/committee`, 30-day sessions). Several
roles at once are fine. Every action re-checks the role on the server.
- **Only the Scout's own address signs in** for a Scout record (`scout_email`). Parent/guardian addresses are copied on
  every email but don't sign in (Settings `parentsSignIn` = FALSE; TRUE restores parent sign-in). Jim W. 2026-10-28.
- **Sign-in links are single use** (the check and the use-up run under the script lock) and, with Settings
  `linkBrowserCheck`, tied to the browser that asked (Jim W. 2026-10-29): the page sends a random per-browser id
  (`eagleBrowserId` in local storage) with the request and again when the link is opened. `log` (default) records
  every opened link in the hidden **_SignIns** tab (result: match / mismatch / no-id / old-link, device + browser
  asked on and opened on); `enforce` blocks a mismatch and offers **Send a fresh link to this browser**, which mails a
  new link to the address on file (never one the visitor types), so a forwarded link is useless. Watch `_SignIns` for
  a couple of weeks (iPhone email apps open links in their own browser) before switching to `enforce`.
- **Sign-in code** (Settings `signinCode`, off until switched on): the email also says "Or type this code on the page
  where you asked for the link: 482 913", and `/signin` shows a code box after "Email me a link". The code is kept for
  the asking browser only, so a forwarded code is as useless as a forwarded link. Template 0.1.a's `{code}` line drops
  out while it's off. Logged in `_SignIns` as result `code`.
- **Email first** (design note kept outside the repo): an address not on file gets the same on-screen reply and a
  **"Start your Proposal"** email (template 0.1.b) with a link to `/intake?t=…` (Settings `intakeLinkHours`, max 6).
  An address with an old-style Unconfirmed submission gets that confirmation link again instead.

### Committee pages: menu bar and page actions (2026-11-05)

One bar on every committee page (`renderNav` in `web/js/committee.js`): the **views** as tabs (Dashboard, Schedule,
Outbox with its count, Units, Stats, Admin) and the member's menu (name, test mode, Sign out). **Actions** sit next
to each page's title (`actionButton`): Dashboard: **Record outcomes** (count of reviews waiting) and **Email open
times** (opens the Schedule page's dialog: `/committee/schedule?ot=1`); Schedule: **New session**, **Email open
times**, **Record outcomes**. Review outcome has no tab (it is an action; its page stays). Counts are remembered in
the browser (`ccacOutboxN`, `ccacReviewN`) so every page shows them at once.

### Committee dashboard (`/committee`)

A strip of counts linking to the other committee pages (outcomes to record, new files waiting, Outbox, items on the
Admin page, sessions booked in the next 14 days), then **tabs of Scouts** (`lib/board.js`, one read of the tracking tab), grouped by stage in sheet
order (= order of arrival):

| Tab | Sections | Columns (+ Candidate, Unit, Age, last note) |
|---|---|---|
| Proposals (default) | Proposal Received … Proposal Revisions Requested | "New files" marker |
| Underway | Proposal Approved | Approved |
| EBoRs | Application Submitted, Application Verified, EBoR Booked | EBoR |
| Eagles | Eagle Earned (archived to the Eagle Archive tab each Jan 1) | EBoR; **age fixed at the EBoR date** |
| Exceptions | EBoR Paused, Eagle Not Awarded, Beyond Age, Proposal Not Approved | Approved, EBoR |

Age = birth date to today (one decimal, rounded down; amber from 17.0, red from 17.5). Last note = first line of the
Notes cell, a link to the **log panel** (below). A name opens the Scout's Drive folder. **Sorting** (`web/js/boardSort.js`, browser only, never the
sheet): click a column heading to sort *inside each stage*, again to reverse: Candidate = arrival in the stage
(sheet order, newest first / oldest first), Unit (type, then number), Age (first click: oldest first), Approved,
EBoR (empty values last); "Back to sheet order" resets. Every page load starts in sheet order. Later: search.
Tags come **after** the name.
- **EBoR dates like the sheet:** this month bold, next month light blue, past (no outcome yet) red; the EBoR Booked
  heading says "3 left in Oct · 8 in Nov · 3 later".
- **Board n/3 · n/6 · n:** every booked EBoR shows its board size (district/council members on the Scout's next EBoR
  slot + Unit Board Members): pink under 3, green 3–6, grey over 6 (guests on the invitation?). The tag and the EBoR
  date (EBoR Booked rows with a booked board) are links to that board on the schedule page; the date shown is still
  the sheet's EBoR Date, the tooltip gives the session's.
- **Session column (Proposals tab; 2026-11-03):** Pre-Review Call / In-Person Review Booked rows show the Scout's next
  session of that type ("Wed 11/4 7:00 PM") as a link, plus the committee members' initials (full names on hover) or a
  pink **No member**. Sortable. A session that started under 12 hours ago still shows (`Board.nextSessions`).
- **Deep link:** `/committee/schedule?s=<slot key>` opens that session's details (time, place, members, Unit Board
  Members, ✎) once the fresh schedule is loaded; a session no longer on the schedule says so on the page.
- **Unit under review:** the Unit cell is yellow in every stage (Unit Info → Under Review).
Sign-in lands here; `ccacNext` returns a member to the committee page they asked for.

### Waiting on Council (derived)

No column of its own: **signed paperwork sent (date) and SVMBC Received empty** (any mark counts as received). Shown as
a **Council?** label on the dashboard row (amber after Settings `councilAckDays`, default 7), a count in the strip
and the Eagles tab label, and an "EBoR paperwork not yet acknowledged by Council" list (overdue ones) at the top of
the digest. "Send signed paperwork to Council…" is hidden once a sent date exists. Works on older rows too.

### EBoR photos (`web/js/photos.js`)

Prepared in the browser before upload (Apps Script can't resize): HEIC decoded with heic2any (loaded only when
needed), turned upright, long edge ≤ 2048 px, JPEG quality 0.85, EXIF DateTimeOriginal = the board's date with the
photo's own time of day (piexifjs). If a helper can't load, the photo still goes, without the EXIF date (said so).

### EBoR reminders and Send later (`lib/reminders.js`, `remindersActions.js`)

Settings `eborReminderDays` (3) before each booked EBoR (shadow bookings included), the hourly trigger drafts ONE
**4.3.c EBoR reminder** To the Scout, the district reps on the slot and the Unit Board Members, Cc the parent/guardian
and the committee: when, where, who is on the board, how the Scout prepares (uniform, workbook, arrive early), what a
Board Member does if they can't come; optional "Running late?" line from Settings `dayOfContact`. (Until 2026-11-02
these were two emails, 4.3.a to the Scout and 4.3.b to the board; both retired. New ID so an old 4.3.a tab isn't used.)
Tab in Review mode → Outbox; once per board (Script Properties `rem:<slot>:<start>`; a moved board gets
new reminders). In the Outbox a member edits a draft and either sends it or uses **Send later**: "2 days before" /
"1 day before" the session (when still ahead) or any date and time. The hourly trigger sends scheduled emails within
the hour (`outboxSendDue_`; logged "sent as scheduled"; a failure goes back to the Outbox with the reason).
**Unschedule** puts it back. Outbox columns `Event at`, `Send at`, `Scheduled by`.

### Council Eagle applications from Formsite (`lib/councilApp.js`, `councilAppActions.js`)

When a Scout submits the Eagle application on the Council's Formsite form, Formsite emails cc-advancement (from
`noreply@fs10.formsite.com`, subject `Eagle Project Result: <name>`) with the uploads attached. The hourly trigger
(and Admin menu → **Council applications: file new Formsite emails now**) files them:
- **Which Scout, best effort, graded:** **Matched** = same first and last name (middle names ignored on both sides) in
  the unit (`Unit Type` + `Unit #`). Anything looser is **Check**: the schedule sheet's name matching (short forms,
  certificate name, no unit on the form), same unit + same last name, same unit + same first name, the Scout's email,
  the parent's email + same last name (each only when exactly one Scout fits; never a guess between two).
- **Which question:** read from the email's answer table (each upload row links to the attachment's file name);
  Formsite field numbers (25 application, 26 workbook, 63 statement, 15 project pictures) only as a fallback.
- **Files, all at the top of the Scout's folder** (no subfolder; nothing else moves): `<Name>-<Unit>-Application_RankApplication`,
  `_AdvancementReport`, `_Workbook`, `_Statement`, `_ProjectPhoto-01…`, `_UniformPhoto-01…`, `_File-01…` (unknown
  question), plus `_FormsiteEmail.pdf` (the answers; no images, no IP/browser rows). `-Application` sorts them together,
  apart from the Proposal files. A resubmission moves the earlier `-Application_` files to `Archive/`.
- **Log:** "[Council] Eagle application submitted on Formsite (#ref): n files filed" (Life to Eagle Log + the
  digest's changes); a Check match says "CHECK the match (how, what the form says)"; files linked in the email but
  not attached are named there ("get from Formsite").
- **Promotion (2026-11-04): only a Matched Scout in Proposal Approved** moves to Application Submitted, through the
  "Application submitted…" row action as "Council" (date = the email's; fills Application Submitted; 3.1.a
  acknowledgement drafted into the Outbox like a member's click). A close match in any other stage stays put:
  Match = **Stage?** (Stage column says where they are). A **Check** match never moves.
- **No match:** files + PDF go to the intake folder → `Council applications (no match)/#ref <name> (<unit>)`.
- **Council Applications tab:** one row per email (Received, Ref, name/unit on the form, Match, Scout, How, Files,
  Not attached, Folder, Email link, **Checked**, Stage). No committee email: **Check**, **Stage?** and **No match** rows are in the
  digest's Awaiting action ("Council applications to check") until a member ticks **Checked** (Matched rows start ticked).
  The dashboard shows a red **Formsite** tag on the Scout's row (Check / Stage?) until then: hover for why, click for
  the folder. A lookup on the tab by Record ID (`CouncilApp.flags`), no tracking-tab column.
- **Once per email:** Gmail labels `Eagle Tracker/Filed`, `…/No match`, `…/Error` (admin emailed; remove the label to retry).
  Filed and No match are archived (out of the inbox, under their label); Error stays in the inbox.
- **Off until** Settings `councilAppFrom` = a date (YYYY-MM-DD): only emails from that day on.
- Needs the `https://mail.google.com/` scope (Apps Script's Gmail service): cc-advancement approves it once.

### Emails with attachments

Sent from the Outbox **with** the files (signed Proposal, EBoR scans, photos; about 18 MB of files per email: Gmail's 25 MB counts the base64-encoded size), Cc the committee;
**Reply to: Me only** starts ticked, so Council's "please rescan" reaches the member who sends it. Download / Copy formatted / I
sent it remain for sending by hand.

**Google Groups' 8 MB (2026-11-04):** the committee group (`committee-group@googlegroups.com`, a free Google
Group) rejects messages over 8 MB, counted encoded (files + about a third): the group's copy bounces, everyone else
gets it. The Outbox shows each file's size and the total, and warns when a Google Group (the committee group or any
`@googlegroups.com` address) is in To / Cc and the email is near (80%) or over 8 MB, updating as To / Cc are edited;
Send asks first when it is over (`Outbox.groupSize`; same rule in `web/js/outbox.js`). In practice: under ~6 MB of
files when the group is copied.

**Adding files to any waiting email** (the committee chair, 2026-11-02; e.g. a denial letter from the Council Advancement Chair):
**📎 Attach a file** on the email (PDF, DOCX, PPTX, JPG, PNG, HEIC; up to `maxUploadMB` per file, about 18 MB of files per email).
The file is stored in the Scout's folder → `Email attachments` (no Scout or no folder yet: intake folder → `Outbox attachments`)
and listed on the email; the Scout's log gets "attached <file>". **✕** takes a file off the email (the Drive file stays).
Only emails waiting in the Outbox (Unschedule a scheduled one first). Actions `outboxAttach`, `outboxDetach`.

### Folder placement (`folderPlace.js`, `EagleDone.placeFor`)

Scouts folder children: **202x** (active), **the EBoR year** (`2026`, … created when missing; moved again if the board
moves to another year) once an EBoR date is set, **Exceptions** (Settings `exceptionsFolder`) for Eagle Not Awarded /
Proposal Not Approved; EBoR Paused stays until booked again; EBoR Booked without a date stays. Year folders hold
Eagles (or Scouts about to be). Runs on every `Records.move` and on EBoR Date changes; only linked folders
(`_folder_id`) move; each move is logged. **Admin → Folders: place by stage…** reports every Scout, then applies.

### Preferred Name (2026-11-04)

Optional tracking column **Preferred Name** (`preferred_name`; Setup / repair adds it after the email columns): the
name a Scout goes by when it differs from the legal name (Theodore Sample → "Teddy"). A `;`-list: the **first** entry is
what he is called, every entry helps matching. The legal name stays the Scout's name (paperwork, certificate, folder
and file names).
- **Set by:** the Scout (intake form "Preferred name", optional; their own page) or a committee member (Scout detail).
- **Greetings:** `{firstName}` / `{firstNames}` use it (`EagleDone.firstName(name, preferred)`).
- **Shown as** `Theodore Sample ("Teddy")` on the dashboard, in the Scout detail window and in the digest (changes,
  awaiting action, next 7 days; the changes list uses the Scout's current Preferred Name) (`EagleDone.display`).
- **Matching:** names typed on the schedule sheet (`Booking.matchScout`; a one-word entry gets the last name) and
  Council Formsite applications (`CouncilApp.matchRecord`: a form filled as "Teddy Sample" is a close match).

### Scout detail window (`lib/scoutDetail.js`, `scoutDetailActions.js`)

Click a Scout's name on the dashboard. Header: name (unit), stage, **📁 Folder**, and the latest log line, which opens
the log panel. Three tabs: **Scout Info**, **Proposal**, **Eagle / EBoR**. A column's tab comes from
its **group heading** on the tracking tab (the row above the hidden machine row; merged headings carry right), so a
column added to the sheet shows up without a code change (unknown groups → Scout Info; `_` columns, Action and
Notes hidden).
- Read-only until **✎ Edit**: then any field can be changed (formula columns such as Age never); Save shows the list
  of changes to confirm; every change is logged `Label: "old" → "new"`. A new name keeps the cell's link to the
  folder; a new name or unit renames the folder and the log (`<Name> - <Unit>`) and the tool's own files in it and its
  subfolders (`<Name>-<Unit>_…`, `<Name>-<Unit>-Application_…`; `ScoutFiles.renamePlan`; other files keep their names).
  The same happens when the Name or Unit is typed straight into the tracking sheet (edit trigger; logged "[sheet] Name
  changed …"), and a row with no folder link finds its folder by its uploads or old name (`renameForChange_`). Emails are checked; dates/times
  use date pickers.
- **Advanced: move to another stage…** (collapsed, bottom of Scout Info): any stage, reason required, confirmed,
  logged; **no emails, no invitations** (corrections only; normal steps are the row's Action menu).

### Dashboard row actions (`lib/stageActions.js`, `rowActions.js`)

Each dashboard row has an **Action** dropdown (⋯) with the actions allowed for its stage, from one table:

| Action | Offered in | Records | Moves to | Email |
|---|---|---|---|---|
| Complete: invite to book a Pre-Review Call | Proposal Received, Proposal Incomplete | | Intake Review: To Book | "Book: Pre-Review Call" (online: like the sheet's Action, template Mode decides) |
| Incomplete: ask for changes… | Proposal Received, Proposal Incomplete | | Proposal Incomplete (stays) | "Proposal incomplete" with the note, Outbox draft |
| Resend booking link · Book (schedule page) | Intake Review: To Book | | | "Book: Pre-Review Call" |
| Ready for in-person review | Intake Review: Booked, Revisions Requested for Review | | In-Person Review: To Book | "Book: Proposal Review" (not online yet: Outbox draft with `{scheduleLink}` = Settings `reviewSignupUrl`, else `eborSignupUrl`) |
| Changes needed before review… | Intake Review: Booked, Revisions Requested for Review | | Revisions Requested for Review | "Revisions before review" with the note, Outbox draft |
| Resend booking info · Book (schedule page) | In-Person Review: To Book | | | "Book: Proposal Review" |
| Not approved… | Proposal Received … Revisions Requested for Review | | Proposal Not Approved | "Proposal not approved" with the note, Outbox draft |
| Record review outcome… | In-Person Review: Booked, Proposal Revisions Requested | (opens `/committee/review?r=<id>`) | | |
| Application submitted… | Proposal Approved | Application Submitted date | Application Submitted | "3.1.a Application submitted: acknowledgement" (Outbox draft) |
| Application verified… | Application Submitted, Proposal Approved | Application Verified = date of Council's email (+ Submitted, if empty) | Application Verified | **"Book: Eagle Board of Review"** tab to Scout, parent and the unit's contacts (Key 3 Unit Leader + Committee Chair + Unit Contacts), Cc the group, Outbox draft; **"Emailed to set up EBoR" is filled when it is sent** (Outbox Send / I sent it) |
| Book an EBoR (schedule)… | Application Verified, EBoR Paused | (opens the schedule page: create-and-book) | | |
| Schedule a follow-up / consult… | **Every stage except Eagle Earned** (side sections and Closed too) | (opens the schedule page's new-session dialog: `/committee/schedule?r=<id>&new=Followup`; see Committee schedule page) | | none from here; the booking sends its own (see Follow-Up / Consult) |
| Resend EBoR next-steps email | Application Verified | | | "Book: Eagle Board of Review" again (Outbox draft; fills Emailed to set up EBoR when sent) |
| **Eagle earned…** (one step) | EBoR Booked | EBoR Date = the board's date (default the row's EBoR date), cell painted green (Settings `eborDoneColor`) | Eagle Earned | Uploads: signed application + Advancement Report (PDF scans, both or neither) → `<Name>-<Unit>_EagleApplication-Signed.pdf` / `_AdvancementReport-Signed.pdf` in the folder; photos → `EBoR Photos/<Name>-<Unit>_EBoR-<yyyymmdd>-NN.jpg`. Drafts **"Council: Eagle paperwork"** (to `councilEaglesEmail`, Cc group + unit contacts, both scans attached; fills "signed paperwork sent" when sent) and **"New Eagle Scout"** (Scout, family, unit contacts, the board: district reps + Unit Board Members from the last EBoR slot, others to invite; Cc group; photos attached) |
| Send signed paperwork to Council… | Eagle Earned | | | Both scans required; "Council: Eagle paperwork" as above |
| Council received the paperwork | Eagle Earned, **only rows waiting on Council** | SVMBC Received = `*` (Settings `svmbcReceivedMark`, the sheet's mark) | | none |
| EBoR paused… | EBoR Booked | EBoR Date | EBoR Paused | "EBoR paused" with what must be completed (Outbox draft) |
| Eagle not awarded… | EBoR Booked | EBoR Date | Eagle Not Awarded | "Eagle not awarded" with the stated reasons (Outbox draft) |
| Eagle not awarded (no reconvening)… | EBoR Paused | (EBoR Date unchanged) | Eagle Not Awarded | "Eagle not awarded" with the stated reasons (Outbox draft) |
| **Close record…** | EBoR Paused, Eagle Not Awarded, Beyond Age, Proposal Not Approved | Reason (required: Withdrew, Aged out (no extension), Extension denied, Moved out of district, Duplicate or error, Other + text), date (default today, not future), optional note → hidden `_closed`; clears "new files" | Closed | none (Email… still works). Log line "Closed: <reason> (<note>)". The folder does not move |
| **Reopen…** | Closed | Reason (required, logged); `_closed` cleared | where it came from (`_closed`), or a stage you pick | none |
| Keep open | Proposal Not Approved, EBoR Paused, **only rows with a "Close?" tag** | `_close_snooze` = today + `closeSnoozeDays`; logged | | none |
| ✓ Checked: nothing to do | any proposal/EBoR stage, **only rows with new files** | | | none (stops the new-files clock) |

Any committee member. Dates default to today, editable, never in the future; a changed date or an odd order is a
warning first. The action is logged, moves the row and clears "new files". Columns are found by name
(`application_submitted`, `application_verified`, `emailed_to_set_up_ebor`; Settings `appSubmittedColumn`,
`appVerifiedColumn`, `eborEmailedColumn` override; Self-check shows what was found). `{scheduleLink}` in the email =
Settings → `eborSignupUrl` (today the old EBoR schedule; later the web booking). Outbox rows carry `On sent`
(`{column, label}`) for the "when sent" date.

### Review outcome (`/committee/review`)

Design: Jim W., 2026-10-23. A member picks a Scout (In-Person Review: Booked / Proposal Revisions Requested; held
reviews first) and records **Approved**, **Revisions requested** or **Not approved**.
- **Initials**: pre-filled from the row's Proposal Review Who (else the member's own); `AB, CD` / `AB CD` / `ab&cd` → `AB&CD`.
  Unknown initials are a warning. Who is filled when empty (`AB/CD`).
- **Date**: default today, or the Approved Date already on the row; editable, not in the future. A missing or later
  Proposal Review date is warned about, then set to that date.
- **Approved**: upload the signed PDF → renamed `<Scout_Name>-<Unit>_ESSPP-ApprovedAndSignedBy-AB&CD.pdf`, filed in the
  Scout's folder; every `ESSPP-V<n>` (and an earlier signed copy) moves to `Archive/`. Approved Date filled, row → Proposal
  Approved. No more versions after approval.
- **Revisions requested** → Proposal Revisions Requested; **Not approved** → Proposal Not Approved.
- The **note** goes into the Notes cell and the Life to Eagle Log (and into the Revisions / Not approved email draft).
- The email (template tabs *Proposal approved*, *Revisions requested*, *Proposal not approved*) is **always a draft in the
  Outbox** (Scout + parent, Cc the group); the page opens the Outbox on it. The approval draft carries the signed PDF:
  **Send is off**; the member uses Copy formatted / Open in Gmail, **Download**s the PDF, attaches it, sends from their own
  email and clicks **I sent it**.
- **More signatures to come** (Jim W., 2026-11-08; Approved only): tick it and pick the next signer(s). The copy signed so
  far is filed (`…SignedBy-AB.pdf`), the row moves to Proposal Approved, but there is no email to
  the Scout; their page says *Proposal approved; committee signatures in progress*. The copy goes to the next signer(s)
  with a link back to this page, **now** (from the tool, Reply-To the member) or, unticked, as an Outbox draft. State is
  the **Signatures pending** column (`signing`, added on first use): `Waiting on CD since 2026-11-08; signed AB`.
- **Add a signature**: the Scout is listed here (and the dashboard shows an amber **Signing: CD** tag on Underway). The next
  signer uploads their signed copy → `…SignedBy-AB&CD.pdf` (the earlier copy goes to Archive). Last signer: the approval
  email is drafted as above. Otherwise tick More signatures again for a third signer. **Finish with the signatures we
  have** drafts the approval email with the copy on file. The digest lists signatures waiting `signingNudgeDays` (3).

### EBoR paperwork page (`/committee/ebor-paperwork`, `lib/eborPaperwork.js`, `eborPaperworkActions.js`, `web/js/pdfPaperwork*.js`)

For the Board of Review itself, on one device passed around the room. Pick a Scout at EBoR Booked or Paused (the next
board on the schedule is preselected; the board's date can be changed on the page). Two documents, one tab each:

1. **Verified Eagle Application**, Requirement 7: the file with "verified" in its name in the Scout's folder (newest;
   or pick another, or choose one from the computer). The page finds Requirement 7 by its text (else page 2) and puts the
   board date as three boxes **MM, DD, YY** (drag them together onto the form's boxes). Two signatures: the board chair
   and a District Advancement Committee / Council representative.
2. **Advancement Report** (BSA form 34403): the blank is fetched from Drive (Settings `advancementReportTemplateId`) and
   prefilled: Scout's number, District and Title (Settings), Unit Leader name and address (Key 3), the date forwarded,
   Board of Review date (MM/DD/YYYY), "Eagle Scout", and the unit type. Three signatures, each placed in its form field's box.

Each signer **types their name** (suggestions from the board on the schedule and the committee), ticks whether they are a
District Advancement Committee / Council representative (at least one per document), and signs **typed or drawn** in a
dialog (ink palette: black, dark blue, blue, purple, dark green, brown, rust, dark red). Signatures live in the page
only; nothing leaves the browser until **Save both**. Saving files `<Name>-<Unit>_EagleApplication-Signed.pdf` and
`_AdvancementReport-Signed.pdf` in the Scout's folder, moves the Verified Application and earlier versions to Archive,
drafts "Council: Eagle paperwork" in the Outbox (the existing path), and logs it. **The row does not move**: use
*Eagle earned…* afterwards; it (and *Send signed paperwork to Council…*) now find files already filed this way instead of asking
for scans again. Actions: `eborPaperworkChoices`, `Scout`, `Template`, `Start`, `Upload`, `Finish`.

After deploying: set `advancementReportTemplateId` (upload the blank form to Drive, outside this repo), check `districtName` and
`advancementTitle`, run Setup / repair tabs (adds the Key 3 address headers).

### Signing with a pen tablet or touchscreen (`web/js/pdfStrokes.js`, `pdfDraw.js`, `pdfSignPad.js`; Task 13)

**✍ Sign with pen…** (in the Sign Workshop's signature section and on each signer slot of the EBoR paperwork page) opens a
nearly full-screen pad: a screenless USB pen tablet maps to the whole screen, so a big area lines up with the tablet; a
phone or tablet gets the whole screen too. It has a baseline, **Undo** (last stroke), **Clear**, **Cancel**, **Done**, an
ink palette, and Esc cancels. The page does not scroll or select text while it is open, one pointer draws at a time and a
resting palm or a second finger is ignored. **Done** crops to the ink: in the Workshop it becomes the current signature
(Draw) and **✍ Signature** drops it; on the paperwork page it fills that signer's slot.
- **Pressure:** a pen's pressure thickens and thins the line; a mouse or finger (which report no pressure, or a fixed 0.5)
  draws a constant width. For pressure on a pen tablet **enable Windows Ink in the tablet's driver** (XP-Pen: "Use Windows
  Ink" in the driver's settings; without it the browser sees the tablet as a mouse and the line is constant).
- **Strokes are data:** points `{x, y, p, t}` normalised to the pad width, drawn as smoothed curves. The picture is rendered
  from the strokes for the ink colour and for the size it is placed at (3x the box in points, between 600 and 3000 px), so
  changing the colour or resizing a placed signature re-draws it sharply, and the PDF gets the high-resolution picture. A
  typed or uploaded signature keeps its own picture.
- **Remember my signature** keeps a pen signature as strokes (JSON, thinned to fit about 50 KB) instead of a PNG.

### Review page: the Scout's files and the Sign Workshop (`web/js/pdfPlan.js`, `pdfEngine.js`, `pdfWorkshop.js`)

**Files in the Scout's folder** (2026-11-09; `scoutReviewFiles`, `fetchScoutFile` in `reviewActions.js`): picking a
Scout lists the top-level files of their folder with a role badge (Signed copy, Proposal V<n>, Signatures, Photo,
Slides, other; `planFolderFiles`), newest Proposal first; while signatures are in progress the latest signed copy is the
primary file. **Open** shows a file in a new tab (up to `maxUploadMB`, 20 MB: larger ones open in Drive).

**Sign Workshop** (**Sign in browser…** on a PDF in that list, or on a PDF chosen from the computer): the member signs
the Proposal without leaving the page; nothing leaves the browser until **Save**, which uploads the result through the
normal Approved path above.
- **Placing the marks** (v2, 2026-11-11): the preview is a scrollable view of every page (pages render as they come into
  view); the page numbers above it jump. The Workshop opens scrolled to the **last Proposal Approval page** (2026
  page 11, 2023a Page H; several copies = the last), else the last **scanned page**: an image-only page (no text, no
  form fields) **anywhere in the file**, even after a blank Plan page the Scout left in, that is not itself a Plan /
  Fundraising / Report page. With only a scan found the info line says "Page 10 looks like a scanned signature page",
  and placing on it never asks a confirm. If neither is found a banner says "Couldn't find the Proposal Approval page
  (Page H): scroll to it" and **no page is preselected**; it never falls back to an ordinary Proposal page. Toolbar: **✍
  Signature**, **Printed name**, **Date**, **🔖 Stamp ▾**. Click a button, then click on a page: the mark drops there,
  centered on the click (Esc cancels). On a detected approval page a button without a click drops the workbook's own
  box (signer 2 and later go below signer 1's line); a second press of the same button on that page waits for a click.
  Marks can be dragged, resized from the corner and removed with ✕, on any Proposal page. **Nothing is applied until
  Sign & Attach PDF**; a signature is required, a missing printed name or date only warns.
- **Guardrail (per page):** a page is locked only if **it** is identified as Project Plan, Fundraising Application or
  Project Report (`canPlaceOnPage`); locked pages are striped and refuse marks, with the reason shown as a toast next to
  the click as well as in the side panel. Any other page takes marks; one that sits after a locked page (and is not an
  approval page or a scan) asks once, naming the page that triggered it ("Page 9 looks like Project Plan Page A (it may
  be a blank template page left in). Place on page 12 anyway?"). **Page H wins:** a page with the "Proposal Page H" footer, or the
  "Council or District Approval" heading with "Candidate's Promise", is an approval page even when it follows Plan
  pages and carries a Candidate's Promise date field (that field alone no longer marks a Plan Reviews page).
- **Stamps:** PNG files (up to 2 MB, transparent background) in one Drive folder named by the Settings key
  `stampsFolderId` (blank = no Stamp button; Setup adds the key). The button places the last stamp used (its Drive file
  id is remembered in this browser), the arrow lists them with thumbnails. A stamp is placed 1.6 in (115 pt) wide with its aspect kept (any placed image is capped at 40% of the page width,
  resizable afterwards), drawn under the
  signature, name and date so they can sit on its lines; a PNG with no transparency warns that it covers the page under
  it. Actions `stampList` / `stampFetch` (committee only). No stamp images are kept in the repo.
- **Rotated pages** (task 9.2): a page with `/Rotate` 90 / 180 / 270 (typically a scan: a landscape page shown
  upright) is handled in two coordinate systems. Marks are placed and kept in **viewer space** (the page as pdf.js
  shows it); `pdfEngine.js` reads each page's `/Rotate` and crop box and converts to PDF user space (`viewerToUserPoint`
  and friends in `pdfPlan.js`), drawing images and text with pdf-lib `rotate: degrees(rotation)` from the matching
  corner, so they appear upright and exactly where they were placed. Tests check the result against pdf.js's own
  viewport for 0 / 90 / 180 / 270. Flattening is unchanged.
- **Signature:** typed (10 OFL script fonts from Google Fonts, loaded when the Workshop opens), drawn, or an uploaded
  image; typed, drawn and uploaded PNGs are **trimmed** to their ink (plus about 4 px) so the box hugs the signature.
  An image mark (signature or stamp) **keeps its aspect ratio**: dragging the corner scales it proportionally, and the
  image fills its box exactly, in the preview and in the PDF (no centering, no CSS scaling). The **Signature size**
  control (100% = 1.75 in wide) sets the size of the next signature and resizes the selected one (a mark you just
  placed or clicked is selected); printed name and date go into the workbook's own fields for the
  first signer when the marks sit at the workbook's boxes on an approval page whose field has a single widget (else
  drawn as text). "Remember my signature" keeps it in this browser's local storage.
- **Result:** the marks are drawn as images/text, and form fields are flattened **only on the page(s) that received a
  mark**. The checkbox "Also flatten the pages before the signature page" (default off) adds the pages before the first
  marked page. Never on Plan, Fundraising or Report pages (they stay fillable for the Scout). Transparent images show a
  checkerboard on screen only (stamp list, signature preview, placed marks), never in the PDF. The BSA
  workbooks' permissions encryption (empty user password, AES-256) is removed in the browser so pdf-lib can edit them
  (the committee's existing practice also inserts pages and flattens; Jim W. 2026-11-09).
- **Libraries:** pdf-lib 1.17.1 and pdf.js 3.11.174 from jsDelivr, loaded only when the Workshop opens; the exact
  versions are pinned in `package.json` (dev dependencies, used by the tests) and `pdfPlan.js`, and a test keeps them in
  step. Each script is loaded with a Subresource Integrity hash (`web/js/cdnIntegrity.js`; a test checks pdf-lib and
  pdf.js against `node_modules`). Known gap: the pdf.js worker and the Google Fonts stylesheet can't carry SRI.
- **Ink and Draw** (2026-11-11): signatures, typed text and the date use an ink colour (palette of eight, black by default,
  remembered with the signature settings; `INK_COLORS` in `pdfPlan.js`, same palette on the EBoR paperwork page). The Draw
  pad (`pdfDraw.js`) is pointer-event based: `touch-action: none`, one active pointer, a resting palm is ignored while a
  pen is in use (`acceptPadPointer`), smoothed strokes, pressure sets width for pens, **Undo** and Clear; changing the ink
  recolours the drawing.
- **Coming:** page tools (insert supporting pages before the approval page, keep/delete, reorder, merge PDFs and
  photos, save as a new Proposal version), then compression.

### Committee schedule page (`/committee/schedule`)

Design note (kept outside the repo).
- Month view (default), week and list (FullCalendar 6). Colour per type; **open = outline, booked = solid**, Blocked grey.
- **Click a day** → new session: type (Pre-Review Call default, Proposal Review, EBoR, Blocked), date, start (7 PM),
  length and location from Settings, **members as checkboxes** (you ticked; occasional helpers under an expander).
  Refused: past times, unknown initials, no location, booking a Scout into a slot with no member. Warned (save
  anyway): **no committee member** (allowed, but not bookable until one signs up), same member twice, overlap with
  a Blocked time, inside the online booking cutoff, a Scout from another unit in a slot reserved for a unit.
- **Optional Scout dropdown = create and book**: Pre-Review Call / Proposal Review list Scouts not yet approved; EBoR
  lists Application Verified / EBoR Booked / EBoR Paused. No cutoff. A Scout already booked for that type is moved
  (old slot reopens).
- **Click an open slot** to change or delete it; **click a booked slot** to add/remove members (the invite follows,
  both ways) or **Cancel booking**. A booked **EBoR** also lists the **Unit Board Members** and the board size;
  **✎ Edit** changes them (same cell the unit page writes; logged; invitation updated).
- **Move a booked session** (Jim W. 2026-10-29): **Change date, time or place…** on a booked slot, or **drag** any
  future session to another day or time (week view: another time). The form opens at the new time; nothing is saved
  until **Save** (Close puts it back). A booked move changes only date, time, place and members (type, Scout and length
  stay); the invite moves and **one** "Moved" email goes out (EBoR: to the Scout and the unit together), instead of
  cancel + rebook. Warned: less than 24 hours away, a member double-booked. Uses the same path as editing the row on
  the schedule sheet (`syncBookedRow_`). `CommitteeSchedule.checkMove`.
- **Online (Google Meet)** tick box on In-Person Reviews and EBoRs (the exception: a Scout who lives too far, a
  follow-up look): the place becomes "Online (Google Meet)" and booking it creates the invitation with a Meet link,
  like a Pre-Review Call (`Booking.isVirtual`: Pre-Review Calls, or any slot whose place starts with "Online"; typing
  that in the schedule sheet's Location works too). Emails and the invitation say online and use the online adult rule.
- **Blocked** entries (meetings, holidays): description + date, time optional (= whole day); never offered to Scouts.
- **Follow-Up / Consult** (Jim W., 2026-11-11; slot type code `Followup`): a meeting a member and a Scout agreed on outside
  the normal steps (a consult on the Proposal, a follow-up after a review, help with the plan or paperwork).
  - **Made by the committee only, for a Scout, after the time is agreed.** It is never open for booking (`Booking.openSlots`
    returns nothing for it unless a committee member is booking a Scout into that very row), so it is not in any open-times
    list, the unit page's open times, an open-times email or `onlineBooking`, and never in "Scouts waiting to book",
    please-book reminders or "staffed before bookable". No unbooked follow-ups: the dialog needs a Scout and a member.
  - **Where:** the dashboard Action **Schedule a follow-up / consult…** (every stage but Eagle Earned) opens
    `/committee/schedule?r=<record id>&new=Followup`: the new-session dialog with type Follow-Up / Consult, that Scout
    chosen, length **30 min** (Settings `followupMinutes`), you ticked as the member, date and time empty. It is also a
    type in the page's own **New session** dialog (then pick a Scout; "several times at once" is not offered).
  - **Online (Google Meet) by default**; untick the box and a place is required (Settings `defaultLocation` is offered).
  - **Booking it** writes the schedule row, the Calendar invitation (Scout, parent, members; Meet link when online), a log
    line ("Follow-up / consult booked Thu 11/12 5:00 PM with MA") and Activity, and queues the "Booked: Follow-Up / Consult"
    email (6.2.d). It **does not move the tracking row and fills no tracking Date/Who column**. A Scout may have several;
    creating one never releases another.
  - **Move, add or remove members, cancel:** the same paths as other booked sessions (this page, the schedule sheet).
    Moves send "Moved: Follow-Up / Consult" (6.2.e); cancelling sends "Cancelled: …" (6.2.f) and **removes the schedule
    row** (it is never left open).
  - **Seen by:** the Scout on their own page ("Your follow-up / consult": time, members, place or Meet link; the Scout cannot
    change or cancel it), the Scout's unit on the unit calendar (like the Scout's other sessions, never as an open time),
    the digest's Next 7 days, and the day-before Session briefing (6.2.b). It is **not** counted as a Pre-Review Call,
    Proposal Review or EBoR: not the dashboard Session column, not Stats "sessions held", not "Reviews with no outcome yet".
  - Own calendar colour (orange). Rules: `Booking` (`Followup` rules, `isCommitteeOnly`, `upcomingBookings`, `bookingAt`),
    `CommitteeSchedule` (`FOLLOWUP_SECTIONS`, `typeDefaults`, `check`), `StageActions` (`followup`, a page action with
    `pageQuery`). Tests: `test/followup.test.js`.
- **Staffed before bookable** (design note kept outside the repo, Jim W. 2026-10-28): a slot with no committee member
  (a place secured, or the availability pattern to keep) is saved but never offered to Scouts or units
  (`Booking.openSlots` requires a member). Shown with ⚠ and listed in the digest until a member signs up.
- **Reserved** tick box (+ optional **Unit**): the committee holds the time, e.g. a board at a unit's meeting place.
  Never offered to Scouts or units (dashed + striped on the calendar). Assign a Scout later: click it, pick the Scout
  (the unit's Scouts first, ★) → Save = normal booking; the Reserved mark is cleared. Unticking it releases the slot to
  online booking (confirm). Schedule column **Reserved** (`reserved`; TRUE / x / yes) is added by Setup / repair or the
  first reserved slot. Settings `reservedForUnits` (Off; See / Assign later) is not used yet: units see nothing.
- **Several sessions at once** (Jim W. 2026-10-31): on a new session, **＋ Another time, right after** (starts when the
  previous one ends: back-to-back Pre-Review Calls) or **＋ Same time, next day** adds rows with their own date and
  start. Type, length, members (you by default), place, reservation and lead time are the same for all; nobody is
  booked from a batch (the Scout dropdown hides). Up to 20; Blocked one at a time. All or nothing: every time is
  checked like a single session, and against the other new times (`CommitteeSchedule.checkBatch`, `saveSlots`).
  Each booking still gets its own invitation and Meet link (created when a Scout books, not when the slot is made).
- **Lead time per session** (Jim W. 2026-10-31): optional **Lead time, hours** on a session = how close to the start
  Scouts (and units) can still book it online; blank = the type's Settings value (`bookingLeadHours` etc.). For
  short-notice sessions the member staffing them is willing to take (e.g. 2 hours on a weekend morning). Schedule
  column **Lead (h)** (`lead_hours`), added on first use. `Booking.leadOf` / `openSlots` (committee views ignore lead
  times: `{committee}` / `{noLead}`).
- **Open-times email** (Jim W. 2026-10-31): after saving several sessions (and from the **✉ Open times** button for
  any type) a dialog lists the new times Scouts can book now (those inside their lead time are left out and counted;
  optionally the other open times too) and the Scouts ready to book that type (its To Book stage, no booking yet; all
  ticked). **Draft the email** puts ONE email in the Outbox: **To all the ticked Scouts** (a Scout with no email: the
  parent), **Cc their parents/guardians + the committee group**, listing the times; check it, then Send. Jim's call: a
  small group seeing each other in To is fine (some urgency, and one copy for the committee instead of one per Scout).
  Template tabs **1.4.d / 2.2.d / 4.1.i "Open times: …"** (`firstNames`, `type`, `times`, `pageLink`; Review). `lib/openTimes.js`,
  `openTimesActions.js`.
- Rows are written to the schedule sheet in date order; each change is logged on the Activity tab ("Schedule").
- **Highlight my sessions** (legend switch, on by default, remembered per browser): a gold ring around every session
  you're on (your initials in its committee members). The border keeps meaning type / reserved / unstaffed.
- **Committee tab → Active** unticked = occasional helper: listed under "Occasional helpers", still invited when on a slot.

### Emails: templates and Outbox

Design note (kept outside the repo); list of every email: **Admin → Templates: rebuild catalog** (below).
- **Classes:** A automatic (a Scout, parent or unit acted), B committee-caused (reviewable), C system (Calendar
  invites/updates, digest, alerts).
- **Template Doc** (Settings → `templatesDocId`, created by Admin → Templates: create Doc): one tab per email
  (`lib/templateCatalog.js`), header `Subject:` / `Mode: Automatic | Review | Off` / `Cc: group | none`, `----`, then
  the body with `{placeholders}`. Sent as HTML (bold, colour, links, lists) plus plain text. A missing or broken tab
  falls back to the built-in wording and alerts the admin. Changes show within ~5 minutes (Self-check reloads).
- **IDs:** every template has a permanent ID `<phase>.<source state>.<letter>` (phases 0 Sign-in, 1 Intake,
  2 Proposal review, 3 Project underway, 4 EBoR, 5 Eagle, 6 Committee/misc; `lib/templateCatalog.js` META). Tab
  titles start with it (`2.3.a Proposal approved`); the tool finds a tab **by its ID**, so the rest of the title can
  be reworded. Never renumber or reuse an ID. **Admin → Templates: number the tabs** renames old tabs once.
- **Catalog:** **Admin → Templates: rebuild catalog** writes the "Eagle Tracker email catalog" Sheet next to the Doc
  (Settings `templatesCatalogId`), generated from the code + the Doc: ID, email (links to its tab), phase, from →
  to, when sent, To, Cc, Status (from the tab's Mode: Automatic / Review / Off; or Planned / Built in). Only
  "Committee notes" is typed by hand (kept by ID). The Doc gets a "Catalog (map of every email)" tab with the link.
- **Outbox:** an email caused by a committee member whose tab says `Mode: Review` (or a Review outcome email, always)
  waits on the Outbox tab and on `/committee/outbox`: edit and **Send** (from cc-advancement), **Send later**,
  **Open in Gmail** / **Copy formatted** then **I sent it**, or **Discard**. Each outcome goes into the Scout's log. A
  Scout's own actions are never held. **Reply to: ☐ Me only** sends the Scout's reply to the member (e.g. to settle a
  Pre-Review Call time) instead of the committee group (Outbox column `Reply to`; Send later keeps it).
- **✉ Email… (draft again)** on every dashboard row and in the Scout detail window (`lib/emailMenu.js`,
  `emailActions.js`): the emails that fit the Scout's stage (status + page link, Book: …, Booked: … confirmations,
  please book, Proposal incomplete / Revisions / EBoR paused with a note (prefilled from the committee's last request),
  application acknowledgement, EBoR next steps, unit EBoR notice, Unit Board Members missing, EBoR reminders, session briefing),
  each **drafted into the Outbox** with the same code the stage change / booking / hourly run uses (`FORCE_OUTBOX_`).
  Says what's missing (no EBoR on the schedule, unit under review), asks first when the same email is waiting in the
  Outbox or went out in the last 14 days, and logs the draft. For Scouts who reached their stage before the new system.
- **Undo / again:** a **Discarded** email has **Restore to Outbox** (same draft back); a sent one has **Draft again**
  (a copy in the Outbox to edit and send; "On sent" dates are not repeated). Each list item shows the session it is
  about ("Session Tue 10/27 7:00 PM") and when it was drafted.
- **Who gets an email about a Scout:** To the Scout, Cc the parent/guardian (two-deep coverage), plus the committee
  group and, where it applies, unit contacts and the board (`MailPlan.family`; no Scout email = To the parent). The
  parent stays on Cc even when a tab says `Cc: none`. Sign-in and confirmation links go to each address alone.
- All mail is sent as cc-advancement with **Reply-To** the committee group (unless "Me only").
- **Header lines** (`Subject:` / `Mode:` / `Cc:`) may share one paragraph split with Shift+Enter.
- **Preview:** the Admin page lists every catalog email: **Preview** (the Doc's current wording with sample data,
  where the wording came from, Mode, Cc, problems) and **Send me a test** (only to you, `[PREVIEW <id>]`, TEST
  banners top and bottom, no Cc).

### Intake, folders, Scout updates

- **Email first** (2026-10-28): `/intake` without a link asks for the Scout's email (→ `requestLink`). The emailed link
  opens the form (`startIntake` → form token, kept in the tab's sessionStorage for reloads); the **Scout email is the
  proven address** (read-only). Finish = Confirmed at once (no confirmation email) → duplicate check →
  promoted to **Proposal Received** (folder `<scoutsFolderId>/202x/<Name> - <Unit>/`, files
  `<Scout_Name>-<Unit>_<TAG>-V<n>`, receipt listing everything entered), attached to the Scout's own record, or held
  as Possible duplicate. Held on: same Scout email or BSA ID, or (email-first) same **first + last name and unit** with the
  same or no birth date on the record (old-system rows; "Owen Fairbanks" = "Owen Patrick Fairbanks"). A promoted Scout is
  signed in on that browser. `/confirm` stays for submissions made before email-first (Unconfirmed rows).
  Intake Queue Action column: Promote / Mark as spam.
- Folders keep only the latest file of each type at the top; older versions go to `Archive/`.
- **Parent/guardian email (2026-11-08):** required on the first-time form and must differ from the Scout's own address
  (an adult is copied on every email). A row without one of its own (old-system, hand-made) makes the Scout Update page
  ask for it: editable and required there before any update goes in. Self-check counts Scouts in progress without one.
- **Scout Update** (`/update`): files and the editable details (phone, BSA ID, project title, beneficiary, address,
  coach, fundraising). A **"Briefly describe what you changed"** box (500 characters, counter; required when a
  file is sent) goes into the log as `10/26 Scout description of updates: "…"` (one line, on top) and into the
  receipt (`{description}` in 1.5.a). A new project title on a Proposal Not Approved row restarts the review (→ Proposal Received).

### Scout and unit pages (2026-10-24)

- **The committee's request** on the Scout's page: the note from Incomplete / Changes needed / Revisions requested /
  EBoR paused / Not approved (the one that went into the email) is kept in the hidden `_request` column
  (`{s: section, t: text, d: date}`) and shown ("The committee asked for (10/23): …") while the row is in that stage.
- **Change time** (one step, `changeBooking`): books the new time first, then withdraws the old invitation; if the
  new booking fails the old time is taken back. Same rules as cancel (not shadow, 24 h cutoff) and booking (lead
  time, adult 21+). "No open times" now says the committee adds times regularly.
- **Your unit's Eagle candidates** on the unit page: read-only name, stage, age (amber from 17, red from 17.5),
  approval date; active stages only; never notes. Settings `unitPipeline` FALSE hides it.

### Calendars on the Scout and unit pages (`web/js/calendarView.js`, `lib/unitCalendar.js`)

- **Scout page:** List / Calendar switch on the booking card (booking and Change time); the calendar shows only open
  times of the Scout's own type; clicking one selects it (the radio list stays the source of truth). Choice remembered
  per browser.
- **Unit page:** read-only calendar, default **Your Scouts** (the unit's Scouts' Pre-Review Calls, Proposal Reviews,
  EBoRs and Follow-Ups / Consults, online or the old way; click for type, time, place), switch to **Open times** (types booked online now, no
  names) to advise Scouts. Never other units' Scouts. FullCalendar 6 loaded only when a calendar is shown; month view,
  list view on phones.

### Booking and units

- The Scout's page offers the booking for its stage when that type is online (`onlineBooking`); adult-21+
  confirmation for Pre-Review Calls and Proposal Reviews; cutoffs from Settings.
- On booking: schedule row filled, Calendar invite (Pre-Review: Meet link, guests visible; Review/EBoR: location,
  guests hidden), tracking Date/Who filled, row moved to the Booked section (from the stages before it), log line,
  confirmation email. Cancel reverses it.
- **Invite sync** (on schedule edits, hourly, committee page): members added → invited; removed → taken off (Google
  sends a cancellation); moved row → invite moved and the Scout emailed.
- **EBoR:** Booked / Moved / Cancelled is **one email** (4.1.a / b / c, Jim W. 2026-10-29): To the Scout **and** the
  unit contacts (Key 3 Unit Leader + Committee Chair + Unit Contacts tab), Cc parent/guardian + committee
  (`eborMail_`). The unit-only emails 4.1.d–g are retired. The Booked email asks the unit for Unit Board Members only
  when the unit is not under review (`{boardLink}` empty otherwise, so that paragraph drops out). The Moved email
  says what changed (`Booking.changeWords`: "new place", "new date and time", …) and shows only the previous time
  and/or previous place that changed. Units not under
  review enter Unit Board Members on `/unit`; the family can add "others to invite". A board has **3 to 6** members
  (district/council + unit): the unit page, the dashboard tag and the digest warn under 3 and note over 6.
- **Unit requests:** on `/unit`, "Hold a board at your unit" (Scout, date, time, place, note) → Unit Requests tab,
  the Scout's log and a committee email; listed on the Admin page (Done) and in the digest until done.
- **Slot Type codes:** `Intake`, `ESSPPR`, `EBoR`, `Followup` (Follow-Up / Consult: committee-made, never open for booking), `Blocked` (also `CCAC`). Slot keys `SL_yymmdd_XXX` never change.

### New files waiting on the committee (`_pending_since`)

Design note (kept outside the repo). Sections say *where* a Scout is; the hidden `_pending_since` column says *whose
move it is*. It holds the time of the oldest Scout file submission no member has acted on.
- **Raised** whenever files reach a Scout folder (`attachFiles_`: first submission, matched duplicate, Scout Update),
  in any stage, Booked included. Detail-only updates don't raise it. An existing time is kept (oldest wins).
- **Cleared** by a committee decision: Action-column move, Action → **✓ Checked: nothing to do**, a Review outcome.
  Not by the Scout's own booking, a status email or a page view. The clear goes into the log.
- **Shown** as an **amber Action cell** (conditional format `=LEN($<col><row>)>0`, made by Setup / repair; works with
  triggers off), a dashboard tile (count, oldest first), "new files" on the Review page list, and the top of the digest.
- Existing rows start empty: **Admin → New files: flag selected rows** sets the time from the Scout's latest upload.

### Life to Eagle Log, Activity, digest

- One Doc per Scout in their folder, newest line on top; the Notes cell shows the latest line and links to it. Typed
  notes are dated and added automatically.
- **Log panel** (`lib/scoutLog.js`, `scoutLogActions.js`): click a Last note on the dashboard (or in the detail
  window). One-line **Add a note** box on top ("10/27 [JW]" goes in front unless the member typed a date or
  [initials]); below, the whole log, read-only and scrollable, with a **Google Doc ↗** link. **✎ Edit** corrects the
  full text (one line per paragraph, plain text: formatting in the Doc is lost); refused if someone added a line
  since the panel opened. The Doc's version history keeps the old text; the Activity tab records "Corrected the
  Life to Eagle Log".
- Every log line also goes to the **Activity** tab; the **digest** (Settings → `digestHours`, default 6 PM) emails
  the group and writes one **Digest Log** row per slot. It opens with **AWAITING ACTION** (repeated until done, most
  urgent first: new files, Outbox drafts, EBoRs short of members, reviews held with no outcome, held web
  submissions, unit requests, Council overdue, sessions with no committee member (30 days, booked first), reserved
  slots with no Scout (14 days), Scouts waiting to book (one heading each: Pre-Review Call, Proposal Review, EBoR) with days, open times), then **Next 7 days**,
  then everything that changed. Sent when something changed **or** something is waiting.

### Hourly nudges and health check (`lib/nudges.js`, `nudgesActions.js`)

Run by `digestHourly`; each fires once (Script Properties `bm:` / `pb:` / `br:`).
- **4.1.h Unit Board Members missing:** EBoR within 7 days, unit not under review, none entered → Outbox draft to the
  unit contacts.
- **6.2.c Please book:** days in a To Book stage of a type booked online, per type: Settings `pleaseBookDays`
  (default `Intake 7,14; ESSPPR 7,14; EBoR 7`: an EBoR may be held up to 24 months after the requirements are done, so one
  reminder; a type with no days = none) → Outbox draft to the Scout. None from a week after the last mark (the digest lists them).
- **6.2.b Session briefing:** the day before (within 24 h) → sent to the members on the slot (folder and log links); a Follow-Up / Consult too.
- **6.9.e Health check** (once a day, also from `syncInvitesHourly`): a missing trigger or a Digest Log silent for
  2 days → adminEmail.

### Admin page (`/committee/admin`, every committee member)

- **Web submissions that need a person** (Intake Queue): never confirmed (link expired), possible duplicates, errors,
  stuck. Attach to an existing Scout (likely matches first), add as a new Scout, resend the confirmation link,
  remove (spam / test). Confirmed first; logged on Activity.
- **Attach compares first (2026-11-04):** a table *Field / On the sheet / On the form / Use form* (only fields the form
  filled; same values greyed), a switch per differing field, All / None. Ticked fields go through the Scout detail
  Save (validation, folder rename on a name/unit change, Life to Eagle Log line); no "details differ" email then.
- **Attached; form differs:** submissions attached without that choice (e.g. by the tool, or before 0.51) whose form
  differed show "Compare with the sheet…" for 60 days (`AdminRules.toReview`); the Intake Queue Note gets
  "Reviewed <date> by <who>: took … / kept the sheet", which ends it.
- **Unit requests** with Done.
- **Old-way bookings: send calendar invitations** (`lib/shadowInvites.js`, `shadowInviteActions.js`; switch-over
  helper): booked "shadow" sessions from tomorrow on, each with its Scout, members, place and any problem (no Scout or
  parent email, no member with an email; unknown initials are listed and not invited). Ticked ones get a Calendar
  invitation as if booked in the tool (Scout, parent, members; EBoR also the Unit Board Members and others to invite),
  the event ID replaces "shadow", logged. No other email. From then on the invite follows changes like any booking;
  Scouts still can't cancel a type that isn't booked online.
- **Email the units** (`lib/unitBroadcast.js`, `broadcastActions.js`): Packs / Troops / Crews / Ships × Committee
  Chairs / Unit Leaders / Unit Contacts (never Chartered Org Reps; "Exclude" honoured) → unique addresses (expand to
  untick), Reply-To (default the committee group), subject, formatted message. **Send me a test** (only to you), then
  **Send…**: To the committee group, the units in **Bcc**, in emails of up to 48 (Apps Script allows 50 recipients per
  email and 1,500 per day on Workspace; the page shows today's allowance). Logged on Activity.
- **Draft an email for several Scouts:** stage → email → tick Scouts (those with it waiting or sent in the last 14
  days start unticked; ones that can't get it say why) → one Outbox draft per Scout (max 40 per run).
- **Email templates: preview and test** (see Emails).
- **January archive of Closed records** (2026-11-10; `lib/closing.js`, `closingActions.js`): Closed rows **closed in a past year**
  are listed first (a dry run: names, closed date, reason; rows with no closed date, moved to Closed by hand, are never
  archived). **Archive** then, for each: the Scout's folder moves to `<Scouts folder>/Archive/Closed` (Settings
  `closedFolder`, created when missing; logged in the Scout's log), a row goes to the **Closed Archive** tab (Record ID,
  Scout, Unit, Closed, Reason, Note, Closed by, Stage before closing, Proposal approved, EBoR date, Folder link, Archived on;
  **no contact details**), and the row is deleted from the tracking tab (same safe delete as below). A record whose folder
  can't be moved stays put and is reported; the tab and its columns are checked before anything moves; the year's numbers
  (closures by reason too) go to Stats History first. Logged on Activity.
- **Closed records, review:** "Close?" tags and the digest's "Exceptions to review (n)" are suggestions for a person
  (see Settings `closeReviewDays`, `closeSnoozeDays`); the dashboard's Exceptions tab hides Closed behind "Show closed (n)".
- **January archive of Eagles** (`lib/eagleArchive.js`, `eagleArchiveActions.js`): a past year's Eagle Earned rows go to the **top of the
  Eagle Archive tab** (Settings `eagleArchiveTab`) of the tracking spreadsheet, as a new **"<year> Eagles"** section (label row,
  hidden key `S:eagles_<year>`) above the older years; an existing label of that year, with the key or just its text, is reused.
  The page lists the Scouts, the label and the columns first (dry run), then **Archive** applies it. The archive's columns are
  matched to the tracking tab's **by hidden machine name** (row 2; case and spaces ignored), so its order and set can differ: a
  tracking column the archive lacks is added at its right end (group heading, machine name, header and formatting copied; hidden
  columns stay hidden), archive-only columns stay blank. Each column is copied with `Range.copyTo` (values, formats, notes, links
  such as the name's folder link), in runs of contiguous rows, rows in EBoR date order (latest first). Formula cells (Age) arrive
  as their displayed values; the Action column is not copied and the rows carry no dropdowns. Folders stay where they are.
  Then the Record IDs are read back from the archive, the year goes to Stats History, and the rows are deleted from the tracking
  tab by Record ID. Nothing leaves the tracking tab unless every row is on the archive; a failure while writing removes the rows
  it inserted. A Record ID already on the archive is not added again. If the tab doesn't exist yet, the first Archive creates it
  from a copy of the tracking tab's header rows and stops (nothing moves) so you can check it. Logged on Activity.

### Units page (`/committee/units`) and unit contacts on the unit page (`lib/unitDirectory.js`, `unitDirectoryActions.js`, `web/js/unitContacts.js`)

Key 3 roles that count as unit contacts: **Unit Leader, Cubmaster, Scoutmaster, (Venturing) Crew Advisor** (and Skipper) → the
unit leader; **Committee Chair**. Chartered Org Rep, assistants and associate advisors are ignored (`Units.key3Role`,
Role then Position; Self-check lists which titles were used and ignored). "Pack 910" = P910, "Crew 967" = C967.
**Unit meetings** (Jim W. 2026-11-01): one record per unit, every field always shown (— when empty), **✎ Edit** → Save
(never added or deleted). On the unit page it is its own card at the top ("Your unit's meetings"); on the Units page it
heads the unit's panel. Fields: day, time, how often, location, address
(links to Google Maps) and meeting notes, from the **Unit Info** tab (`Meeting Day`, `Meeting Time`, `Meeting
Frequency`, `Meeting Location`, `Meeting Address`, `Meeting Notes`). The committee and the unit's own contacts can edit
them (`unitMeetingSave`); a unit with no Unit Info row gets one. Saving writes **Last Updated** / **Updated By**
(initials or email; not shown) and logs to Activity. Read as the sheet displays it and written as plain text, so
"7:00 PM" stays as typed. Columns are added on first save or by Setup / repair, matched without regard to case (a
hand-typed "Last updated" is reused). `Unit Notes` stays committee-only (sheet). `UnitDirectory.meetingFor` etc.
**Eagles to Date** (Jim W. 2026-11-01; `lib/eagleCount.js`, `eagleCountActions.js`): Unit Info column, its own ✎ Edit /
Save under the meetings (`unitEaglesSave`; committee or the unit). Blank = unknown (never guessed), 0 is a count.
**Eagle earned** adds 1 for every unit the Scout is listed in that has a count (Activity: old → new), and the "New
Eagle Scout" email gets `{eagleNumberLine}`: "You are the 110th Eagle Scout of Troop 910!" (several units: each; no count:
the line drops out). Before the board, the number to announce (count + 1, + 1 per earlier pending board of the same
unit; a best guess when two boards are pending: the member corrects the email in the Outbox) shows on the dashboard
(EBoR Booked: 🦅 tag; the Eagle earned dialog), the schedule's EBoR info window and the Session briefing
(`{eagleNumber}`). This calendar year's count is computed from the tracking tab (Eagle Earned, EBoR date this year).
Unit Contacts rows with nothing but a unit (placeholders) are not shown and are deleted by Setup / repair
(`UnitDirectory.blankContactRows`, `removeBlankUnitContacts_`). Unit Contacts **Updated By** (2026-11-01): filled with the
member's initials or the unit contact's email on every add/edit from the web, beside **Updated**; added on first use.
A list of units (under review marked; units without a Unit Leader / Committee Chair email flagged) → the unit's
contacts: **one list** (2026-11-01). **Key 3 rows** (Unit Leader, Committee Chair) first, looking like the others: only the
committee can correct them (never add or delete; the next Key 3 import, about once a year, replaces them: these edits only bridge an
early change of leadership). The Unit Leader row also has an optional **address** (Key 3 columns `Leader Address`, `Leader City`, `Leader State`, `Leader Zip`; found by the machine key if the tab has a machine row, else by header text, case and spaces ignored). It feeds the Advancement Report, is shown and edited here for the committee only, and the Key 3 import carries it over for the same unit and the same Unit Leader name. Not matched automatically beyond that: a renamed header leaves the column empty. **Unit Contacts rows** below: edit, remove, add (role,
name, email, phone, note; `Exclude` stops a Key 3 address from getting unit emails). The **unit page** has the same
panel for the contact's own units, Key 3 rows read-only; a unit contact can't remove themselves. Rows are checked
against what the page showed before a write; every change goes on the Activity tab ("Unit T964"). The Unit Contacts tab is kept
in unit order (T41 before T964), then role, then name, whenever a contact is added and by Setup / repair tabs.

### Stats page (`/committee/stats`)

The web version of the "Eagle Comparisons" tab. **This year is live** (`lib/stats.js`): Eagles by month (+ average and
running total), annual summary (total, female from the Female column, average / youngest / oldest age at the EBoR,
projects approved), right now (stage counts, open approvals by year), coming up (EBoRs by month, Scouts 17½+ not yet
Eagle), how long things take (approval → Eagle, submitted → verified), Eagles by unit, committee sessions held by
month and member. **Past years** come from the **Stats History** tab (seeded from Eagle Comparisons; edit a number
there and the page shows it; the January archive adds each finished year).
**Closed records** (2026-11-10): a card with this year's closures by reason (live, from the Closed rows on the tracking
tab) and, for past years, the Stats History columns `Closed` and `Closed Reasons` (filled by the January archive).

### Speed

Each request reads each tab once (memos, cleared by writes and the script lock); Settings, Committee, unit contacts,
sessions and templates are cached for ~5 minutes and cleared when someone edits those tabs. The committee page shows
the last schedule it saw at once and refreshes it. Every request logs `timing <action> NNN ms` (Apps Script → Executions).

### Staging playground

**Admin → Anonymize this STAGING sheet** (STAGING/Test Copy files only, test mode on): Scouts → `Scout_n`, emails →
plus-addresses of one test inbox, phones → 408-555-1212, notes scrubbed, Drive links removed (never renames Drive
files), schedule names updated, Activity / Intake Queue / Uploads Log emptied. With `testDeliverToCommittee` TRUE,
committee members can sign in on the staging site; everything else they trigger goes to the test inbox.

### Cutover and repair tools

Migration (dry run / apply), folder report / apply, mock folders (staging), start logs, Key 3 import, name new
columns, key new slots. Hand-inserted rows get a Record ID the next time the scripts read the tab. If the triggers are
off, the sheet works by hand as before; an Action value that stays in its cell is the visible sign.

## Not committed

`.clasp*.json`, `.firebaserc`, `~/.clasprc.json` (tokens), any real data (`*.xlsx`, `*.csv`).
