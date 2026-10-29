---
id: gtm
name: Go-to-market
summary: Find and qualify leads, send personal first messages, answer replies, follow up and book meetings.
workflows:
  - id: outbound
    skill: ostack-outbound
    summary: Find, qualify and research leads, then write and send first messages.
    schedule: { days: weekdays, at: "08:40" }
  - id: follow-ups
    skill: ostack-follow-ups
    summary: Read replies, answer them, send due follow-ups and book meetings.
    schedule: { days: weekdays, every_minutes: 30, from: "08:00", to: "18:00", offset: 7 }
---
The first ostack module. Its ledger (`.ostack/gtm.db`) records every lead, message, reply and opt-out, so nobody is contacted twice.
