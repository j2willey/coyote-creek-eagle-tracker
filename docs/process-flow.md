# Process flow: Coyote Creek Eagle Tracker

How a Life Scout's Eagle Project Proposal moves through the committee, **as the code works today** (API 0.61, 2026-11-10).
Terms are defined in the [glossary](glossary.md); the stages are the sections of the tracking sheet described in the
[overview](overview.md). (The `.drawio` files are early sketches from 2026-10-16 of the process before the tool; they are not kept up to date.)

**Legend:** 🟦 Scout / parent · 🟨 Committee member · 🟩 Tool (automatic) · ⬜ Sheet section (status) · dashed = later

## 1. Intake → Pre-Review Call (detail)

```mermaid
flowchart TD
  classDef scout fill:#dbeafe,stroke:#1d4ed8,color:#111
  classDef committee fill:#fef3c7,stroke:#b45309,color:#111
  classDef tool fill:#dcfce7,stroke:#15803d,color:#111
  classDef state fill:#f3f4f6,stroke:#111827,stroke-width:2px,color:#111
  classDef future fill:#ffffff,stroke:#6b7280,stroke-dasharray:6 4,color:#374151

  S0["Scout enters their own email<br/>(/signin or /intake)"]:::scout
  D0{"Address on file?"}:::tool
  SI["Sign-in link: Scout page<br/>(status, updates, booking)"]:::tool
  T0["'Start your Proposal' link emailed<br/>(proves the address; 6 h)"]:::tool
  S1["Scout submits Proposal on the intake page<br/>details + files; Scout email = the proven address"]:::scout
  T1["Files go to the _Intake Queue folder<br/>Intake Queue row; Finish = Confirmed at once"]:::tool
  D2{"Duplicate check"}:::tool
  A1["Exact match on one record (email / BSA ID), and the<br/>proven address is on that record:<br/>files attached as new versions"]:::tool
  H1["Held as Possible duplicate (email, BSA ID, or<br/>first + last name + unit)<br/>Scout told; committee emailed"]:::tool
  C0["Committee: Intake Queue Action<br/>Promote or Mark as spam"]:::committee
  T2["Promote: Scout folder, standard file names,<br/>row at the top of Proposal Received, log started,<br/>receipt listing everything entered"]:::tool

  ST1(["Proposal Received"]):::state
  C1{"Committee checks it"}:::committee
  ST1b(["Proposal Incomplete"]):::state
  C2["Row action 'Incomplete: ask for changes…'<br/>note → 'Proposal incomplete' email (Outbox draft)"]:::committee
  F2["LATER: precheck + Submission Verification checklist"]:::future
  S2["Scout sends an update on their page<br/>new version; older file to Archive"]:::scout

  T3["Action = Intake Review: To Book<br/>row moves; booking-link email (template, Automatic)"]:::tool
  ST2(["Intake Review: To Book"]):::state
  S3["Scout signs in, picks an open slot ≥ 48 h out,<br/>confirms an adult 21+ will be present"]:::scout
  C3["OR a member agrees a time with the family and<br/>books it on the committee page (create and book, no cutoff)"]:::committee
  T4["Calendar invite + Meet link to Scout, parent, members<br/>Date / Who filled, log line, confirmation email<br/>(member-caused + Mode: Review → Outbox)"]:::tool
  ST3(["Intake Review: Booked"]):::state

  R1["Scout cancels ≥ 24 h ahead and rebooks"]:::scout
  R2["Member changes members or cancels on the committee page,<br/>or edits / clears the slot on the schedule sheet"]:::committee
  T5["Invite updated both ways (members added/removed),<br/>Scout emailed when moved or cancelled"]:::tool

  C4["After the call: Action =<br/>In-Person Review: To Book (or Revisions Requested)"]:::committee
  T6["Proposal Review booking link emailed<br/>→ section 2"]:::tool

  S0 --> D0
  D0 -- yes --> SI
  D0 -- no --> T0 --> S1 --> T1 --> D2
  D2 -- same Scout --> A1
  D2 -- possible duplicate --> H1 --> C0
  C0 -- promote --> T2
  D2 -- new --> T2
  T2 --> ST1 --> C1
  C1 -- something missing --> ST1b --> C2 --> S2 --> C1
  F2 -.-> C2
  C1 -- ready --> T3 --> ST2
  ST2 --> S3 --> T4
  ST2 --> C3 --> T4
  T4 --> ST3
  ST3 --> R1 --> S3
  ST3 --> R2 --> T5
  ST3 --> C4 --> T6
```

## 2. Whole pipeline (sections)

**Action** = a committee member picks the next section from the row's Action dropdown; **Booking** = the tool moves
the row when a booking is made (by the Scout or a member); cancelling moves it back to To Book.

```mermaid
flowchart TD
  classDef state fill:#f3f4f6,stroke:#111827,stroke-width:2px,color:#111
  classDef side fill:#fee2e2,stroke:#b91c1c,color:#111

  IN(["Intake: submitted, confirmed, promoted"]) --> PRC
  PRC(["Proposal Received"]):::state -- "Action" --> PI
  PI(["Proposal Incomplete"]):::state -- "Scout update, Action" --> ITB
  PRC -- "Action<br/>emails Pre-Review booking link" --> ITB
  ITB(["Intake Review: To Book"]):::state -- "Booking ≥ 48 h (Scout)<br/>or any time (member)" --> IB
  IB(["Intake Review: Booked"]):::state -- "Action after the call" --> RTB
  IB -- "Action" --> IR
  IR(["Revisions Requested for Review"]):::state -- "Scout update, Action" --> RTB
  RTB(["In-Person Review: To Book"]):::state -- "Booking ≥ 48 h<br/>in person, panel not shown" --> RB
  RB(["In-Person Review: Booked"]):::state -- "Review outcome: approved<br/>(Sign Workshop or signed copy;<br/>more signers may follow)" --> AP
  RB -- "Review outcome: revisions" --> PR
  PR(["Proposal Revisions Requested"]):::state -- "Scout update, Action" --> RTB
  AP(["Proposal Approved"]):::state -- "Action: application submitted,<br/>or Council's Formsite email (matched Scout)" --> AS
  AS(["Application Submitted"]):::state -- "Action: Council verified<br/>emails EBoR booking link" --> AV
  AV(["Application Verified"]):::state -- "Booking ≥ 2 weeks<br/>unit contacts notified" --> EB
  EB(["EBoR Booked"]):::state -- "Action" --> EE(["Eagle Earned"]):::state
  EB -- "Action" --> EP(["EBoR Paused"]):::state
  EP -- "member books a new date" --> EB
  EB -- "Action" --> EN(["Eagle Not Awarded"]):::state

  NA(["Proposal Not Approved"]):::side
  BA(["Beyond Age: Special Needs"]):::side
  RB -. "Review outcome: not approved" .-> NA
  NA -. "new project title on an update" .-> PRC
  PRC -. "Action" .-> BA
```

Online booking per type follows Settings → `onlineBooking` (production: `all` since 2026-10-26); a type not online
would be scheduled by the committee (committee page or schedule sheet) and the Scout's page says so. The committee can
always book a Scout itself (create and book), and a session may carry its own lead time.

## 3. Emails along the way

Emails about a Scout go **To the Scout, Cc the parent/guardian** and the committee group.

| Moment | Email | Class |
|---|---|---|
| Submit / confirm / update | Confirm link, receipt (everything entered), update receipt | A automatic |
| Row moved to a To Book stage | "Book your <session>" | B (template Mode decides) |
| Still not booked after Settings `pleaseBookDays` (default 7 / 14 days; EBoR 7) | 6.2.c Please book | Outbox draft |
| Status + page link (Action) | Status email | B (Mode: Review → Outbox) |
| Committee adds sessions | Open-times email: one email To all Scouts ready to book that type, Cc parents + committee | Outbox draft |
| Booked / moved / cancelled | Confirmation + Calendar invite / update / cancellation | A when the Scout did it; B when a member did (Outbox if the tab says Review) |
| The day before a session | 6.2.b Session briefing to the members on the slot | automatic |
| Approved with more signatures to come | The signed-so-far copy to the next signer(s), now or as an Outbox draft | B |
| Review outcome / dashboard row actions | Approved, revisions, not approved, application acknowledgement, EBoR next steps, EBoR paused, not awarded, Council paperwork, New Eagle Scout | Outbox draft |
| EBoR booked / moved / cancelled | One email To the Scout **and** the unit contacts (4.1.a / b / c), Cc parent + committee | A when the Scout did it; B when a member did |
| EBoR in 7 days, no Unit Board Members | 4.1.h to the unit contacts | Outbox draft |
| 3 days before an EBoR | 4.3.c one reminder to the Scout and the board (Cc parent + committee) | Outbox draft (Send later) |
| Daily | Committee digest (Awaiting action, next 7 days, changes); health check to the admin | C system |

Full list: Admin → Templates: rebuild catalog (the "Eagle Tracker email catalog" Sheet); every email can be previewed
and test-sent to yourself on the Admin page. Design note (kept outside the repo).
