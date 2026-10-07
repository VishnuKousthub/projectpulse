# ProjectPulse – Simple mode (Dashboard + Project Charter)

Built on the **main** branch. Everything is additive: no existing column, table or API was changed or removed.

## What you get
- **Sidebar: 4 views** – Dashboard, Gantt & Timeline, Table Grid, Project Charter.
  Kanban, Calendar, Resource Mapping and the old Analytics page are hidden, not deleted.
  Turn them back on with `advancedViews: true` at the top of `static/js/simple.js`.
- **"Reset Demo Data" button hidden** (it wipes the database).
- **Dashboard** (landing page): tiles (projects, overdue, due this week, overall %, open high risks),
  project table (manager, delivery date + days left, progress, overdue, next due, health),
  most-overdue tasks, deliverables due, open tasks per person, open high-impact risks.
- **Project Charter** (per project): code, CAS no., project manager, received date, delivery date,
  tech pack (link or text), scope · Deliverables (quality, quantity, due, status) ·
  Milestones split Technical / Non-technical · Risks (ID, description, impact, mitigation, owner, status).
- **Project Report** now prints the real charter fields, deliverables and risks (the hard-coded
  "Reactor Facility A, Hyderabad" / "Basel" text is gone).

## Technical / Non-technical milestones
No new table. Each task gets a `Technical` or `Non-technical` **tag** (set from the Type column on the
Charter page). The tag also shows in Table Grid. Untagged activities are listed under "not classified yet".

## Database changes (run automatically at start-up)
- `projects`: new nullable columns `project_code, cas_no, project_manager, received_date, delivery_date, tech_pack`
- new tables `deliverables`, `project_risks`
- nothing is auto-filled with sample text.
- A database already migrated by the *test* branch also works (existing `deliverables` / `project_risks`
  tables are upgraded in place).

## Files
| File | Change |
|---|---|
| `app/charter.py` | **new** – charter + dashboard endpoints |
| `app/database.py` | additive migrations |
| `app/main.py` | registers `charter.py`; project update accepts charter fields; report returns charter data |
| `static/js/simple.js` | **new** – Dashboard, Charter, simple-mode switch |
| `static/js/app.js`, `static/index.html` | 2 nav items + 2 panels, landing view, report text |
| `tests/test_charter.py` | **new** – 7 tests |

## Apply it
1. Unzip next to your current folder (do not overwrite it).
2. Copy your database file in (`project_pulse.db`) – the zip contains no database.
3. `run.bat`, open http://127.0.0.1:8000.
4. Cloud Run: the database lives in the bucket mounted at `/app/data`. Download a copy of
   `project_pulse.db` from the bucket **before** deploying; the migration runs on first start.
