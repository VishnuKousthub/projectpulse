"""
Project Charter + Dashboard endpoints.

Kept in its own module so the main application stays readable.
Everything here is additive: it reads existing tables and uses the new
`deliverables` / `project_risks` tables and the new optional project columns.
"""
import json
from datetime import date, datetime

CHARTER_FIELDS = (
    "project_code", "cas_no", "customer_name", "chemist_name", "project_manager",
    "received_date", "delivery_date", "total_deliverable_quantity", "project_budget", "tech_pack"
)

IMPACTS = ("low", "medium", "high")
DELIVERABLE_STATUSES = ("backlog", "todo", "in_progress", "in_review", "done")
DONE_STATUSES = ("done", "completed")      # 'completed' comes from older builds
RISK_STATUSES = ("backlog", "todo", "in_progress", "in_review", "done")

ITEM_STATUS_MAP = {
    "backlog": "backlog",
    "todo": "todo",
    "in_progress": "in_progress",
    "in_review": "in_review",
    "done": "done",
    "pending": "todo",
    "open": "todo",
    "completed": "done",
    "closed": "done",
    "mitigated": "done",
}


def normalize_item_status(raw):
    """Map status string to one of: backlog, todo, in_progress, in_review, done."""
    s = str(raw or "").strip().lower()
    if s == "in progress":
        return "in_progress"
    if s == "in review":
        return "in_review"
    return ITEM_STATUS_MAP.get(s, "todo")


def _d(value):
    """Parse 'YYYY-MM-DD...' into a date, or None."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value)[:10]).date()
    except Exception:
        return None


def clean_assignee(name):
    """Imported sheets sometimes leave a date in the owner column; treat that as unassigned."""
    name = (name or "").strip()
    if not name or name[:4].isdigit() and name[4:5] == "-":
        return "Unassigned"
    return name


def task_type(tags_json):
    """'technical' | 'nontechnical' | 'both' | None, derived from the task's tags."""
    try:
        tags = json.loads(tags_json) if isinstance(tags_json, str) else (tags_json or [])
    except Exception:
        tags = []
    lowered = [str(t).strip().lower() for t in tags]
    if "both" in lowered:
        return "both"
    if "non-technical" in lowered or "nontechnical" in lowered:
        return "nontechnical"
    if "technical" in lowered:
        return "technical"
    return None


def table_columns(conn, table):
    return {r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def register(app, *, get_db, json_response, request, get_current_user,
             is_full_access, get_now_iso, record_activity, clean_text,
             sanitize_projects_for_user=None):

    def deny_if_not_pm():
        user = get_current_user()
        if user and not is_full_access(user):
            return json_response(
                {"error": "Permission Denied: only PM and Admin can access the project charter."},
                status=403)
        return None

    def project_exists(conn, project_id):
        return conn.execute("SELECT id FROM projects WHERE id = ?", (project_id,)).fetchone()

    # ------------------------------------------------------------------ charter
    @app.get("/api/projects/<project_id:int>/charter")
    def get_charter(project_id):
        denied = deny_if_not_pm()
        if denied:
            return denied
        with get_db() as conn:
            p = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
            if not p:
                return json_response({"error": "Project not found"}, status=404)
            deliverables = conn.execute(
                "SELECT * FROM deliverables WHERE project_id = ? ORDER BY COALESCE(due_date, '9999'), id",
                (project_id,)).fetchall()
            risks = conn.execute(
                "SELECT * FROM project_risks WHERE project_id = ? ORDER BY id", (project_id,)).fetchall()
            tasks = conn.execute("""
                SELECT t.id, t.title, t.start_date, t.due_date, t.status, t.tags,
                       m.name AS assignee_name
                FROM tasks t LEFT JOIN members m ON t.assignee_id = m.id
                WHERE t.project_id = ? ORDER BY t.order_index ASC, t.id ASC
            """, (project_id,)).fetchall()
            members = conn.execute(
                "SELECT name FROM members WHERE project_id = ? ORDER BY name", (project_id,)).fetchall()

            milestones = []
            for t in tasks:
                td = dict(t)
                td["type"] = task_type(td.pop("tags", None))
                milestones.append(td)

            deliv_list = []
            for r in deliverables:
                d = dict(r)
                if not d.get("dispatch_date"):
                    d["dispatch_date"] = d.get("due_date")
                deliv_list.append(d)

            return json_response({
                "project": {k: p[k] for k in ("id", "name", "description", "color") if k in p.keys()} |
                           {f: (p[f] if f in p.keys() else None) for f in CHARTER_FIELDS},
                "deliverables": deliv_list,
                "risks": [dict(r) for r in risks],
                "milestones": milestones,
                "members": [r["name"] for r in members],
            })

    # ----------------------------------------------------------------- chemists
    @app.get("/api/chemists")
    def list_chemists():
        denied = deny_if_not_pm()
        if denied:
            return denied
        with get_db() as conn:
            rows = conn.execute("SELECT id, name, created_at FROM chemists ORDER BY name COLLATE NOCASE").fetchall()
            return json_response([dict(r) for r in rows])

    @app.post("/api/chemists")
    def create_chemist():
        denied = deny_if_not_pm()
        if denied:
            return denied
        data = request.json or {}
        name = clean_text(data.get("name"))
        if not name:
            return json_response({"error": "Chemist name is required"}, status=400)
        with get_db() as conn:
            existing = conn.execute("SELECT id, name FROM chemists WHERE name = ? COLLATE NOCASE", (name,)).fetchone()
            if existing:
                return json_response({"error": f"Chemist '{name}' already exists"}, status=400)
            now_iso = get_now_iso()
            cur = conn.execute("INSERT INTO chemists (name, created_at) VALUES (?, ?)", (name, now_iso))
            created_row = conn.execute("SELECT id, name, created_at FROM chemists WHERE id = ?", (cur.lastrowid,)).fetchone()
            return json_response(dict(created_row), status=201)

    # -------------------------------------------------------------- deliverables
    @app.get("/api/projects/<project_id:int>/deliverables")
    def get_deliverables(project_id):
        denied = deny_if_not_pm()
        if denied:
            return denied
        with get_db() as conn:
            if not project_exists(conn, project_id):
                return json_response({"error": "Project not found"}, status=404)
            rows = conn.execute(
                "SELECT * FROM deliverables WHERE project_id = ? ORDER BY COALESCE(dispatch_date, due_date, '9999'), id",
                (project_id,)).fetchall()
            result = []
            for r in rows:
                d = dict(r)
                if not d.get("dispatch_date"):
                    d["dispatch_date"] = d.get("due_date")
                result.append(d)
            return json_response(result)

    @app.post("/api/projects/<project_id:int>/deliverables")
    def add_deliverable(project_id):
        denied = deny_if_not_pm()
        if denied:
            return denied
        data = request.json or {}
        title = clean_text(data.get("title"))
        if not title:
            return json_response({"error": "Deliverable name is required"}, status=400)
        disp_date = clean_text(data.get("dispatch_date")) or clean_text(data.get("due_date")) or None
        with get_db() as conn:
            if not project_exists(conn, project_id):
                return json_response({"error": "Project not found"}, status=404)
            cols = ["project_id", "title", "quantity", "quality", "dispatch_date", "due_date", "created_at"]
            vals = [project_id, title, clean_text(data.get("quantity")), clean_text(data.get("quality")),
                    disp_date, disp_date, get_now_iso()]
            if "updated_at" in table_columns(conn, "deliverables"):   # present in some older builds
                cols.append("updated_at")
                vals.append(get_now_iso())
            cur = conn.execute(
                f"INSERT INTO deliverables ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", vals)
            record_activity(conn, project_id, "User", "Deliverable Added", f'Added deliverable "{title}"')
            row = dict(conn.execute("SELECT * FROM deliverables WHERE id = ?", (cur.lastrowid,)).fetchone())
            if not row.get("dispatch_date"):
                row["dispatch_date"] = row.get("due_date")
            return json_response(row, status=201)

    @app.put("/api/deliverables/<deliverable_id:int>")
    def update_deliverable(deliverable_id):
        denied = deny_if_not_pm()
        if denied:
            return denied
        data = request.json or {}
        with get_db() as conn:
            row = conn.execute("SELECT * FROM deliverables WHERE id = ?", (deliverable_id,)).fetchone()
            if not row:
                return json_response({"error": "Deliverable not found"}, status=404)
            title = clean_text(data["title"]) if "title" in data else row["title"]
            if not title:
                return json_response({"error": "Deliverable name is required"}, status=400)
            disp_date = row["dispatch_date"] if "dispatch_date" in row.keys() else row["due_date"]
            if "dispatch_date" in data:
                disp_date = clean_text(data["dispatch_date"]) or None
            elif "due_date" in data:
                disp_date = clean_text(data["due_date"]) or None
            conn.execute("""
                UPDATE deliverables SET title = ?, quantity = ?, quality = ?, dispatch_date = ?, due_date = ?
                WHERE id = ?
            """, (title,
                  clean_text(data["quantity"]) if "quantity" in data else row["quantity"],
                  clean_text(data["quality"]) if "quality" in data else row["quality"],
                  disp_date, disp_date, deliverable_id))
            updated_row = dict(conn.execute(
                "SELECT * FROM deliverables WHERE id = ?", (deliverable_id,)).fetchone())
            if not updated_row.get("dispatch_date"):
                updated_row["dispatch_date"] = updated_row.get("due_date")
            return json_response(updated_row)

    @app.delete("/api/deliverables/<deliverable_id:int>")
    def delete_deliverable(deliverable_id):
        denied = deny_if_not_pm()
        if denied:
            return denied
        with get_db() as conn:
            conn.execute("DELETE FROM deliverables WHERE id = ?", (deliverable_id,))
            return json_response({"success": True})

    # --------------------------------------------------------------------- risks
    @app.get("/api/tasks/<task_id:int>/risks")
    def get_task_risks(task_id):
        user = get_current_user()
        if not user:
            return json_response({"error": "Unauthorized"}, status=401)
        with get_db() as conn:
            task = conn.execute("SELECT id, project_id FROM tasks WHERE id = ?", (task_id,)).fetchone()
            if not task:
                return json_response({"error": "Task not found"}, status=404)
            rows = conn.execute("SELECT * FROM project_risks WHERE task_id = ? ORDER BY id", (task_id,)).fetchall()
            return json_response([dict(r) for r in rows])

    @app.post("/api/tasks/<task_id:int>/risks")
    def add_task_risk(task_id):
        user = get_current_user()
        if not user:
            return json_response({"error": "Unauthorized"}, status=401)
        data = request.json or {}
        desc = clean_text(data.get("description"))
        if not desc:
            return json_response({"error": "Risk description is required"}, status=400)
        impact = str(data.get("impact", "medium")).lower()
        impact = impact if impact in IMPACTS else "medium"
        with get_db() as conn:
            task = conn.execute("SELECT id, project_id FROM tasks WHERE id = ?", (task_id,)).fetchone()
            if not task:
                return json_response({"error": "Task not found"}, status=404)
            project_id = task["project_id"]
            code = clean_text(data.get("risk_code"))
            if not code:
                n = conn.execute("SELECT COUNT(*) AS c FROM project_risks WHERE project_id = ?",
                                 (project_id,)).fetchone()["c"]
                code = f"R{n + 1}"
            status = data.get("status") if data.get("status") in RISK_STATUSES else "todo"
            cur = conn.execute("""
                INSERT INTO project_risks (project_id, task_id, risk_code, description, impact, mitigation, owner, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (project_id, task_id, code, desc, impact, clean_text(data.get("mitigation")),
                  clean_text(data.get("owner")), status, get_now_iso()))
            record_activity(conn, project_id, user.get("username", "User"), "Risk Added", f'Added risk {code} for activity #{task_id}')
            return json_response(dict(conn.execute(
                "SELECT * FROM project_risks WHERE id = ?", (cur.lastrowid,)).fetchone()), status=201)

    @app.get("/api/projects/<project_id:int>/risks")
    def get_risks(project_id):
        denied = deny_if_not_pm()
        if denied:
            return denied
        with get_db() as conn:
            if not project_exists(conn, project_id):
                return json_response({"error": "Project not found"}, status=404)
            rows = conn.execute("SELECT * FROM project_risks WHERE project_id = ? ORDER BY id", (project_id,)).fetchall()
            return json_response([dict(r) for r in rows])

    @app.post("/api/projects/<project_id:int>/risks")
    def add_risk(project_id):
        denied = deny_if_not_pm()
        if denied:
            return denied
        data = request.json or {}
        desc = clean_text(data.get("description"))
        if not desc:
            return json_response({"error": "Risk description is required"}, status=400)
        impact = str(data.get("impact", "medium")).lower()
        impact = impact if impact in IMPACTS else "medium"
        with get_db() as conn:
            if not project_exists(conn, project_id):
                return json_response({"error": "Project not found"}, status=404)
            code = clean_text(data.get("risk_code"))
            if not code:
                n = conn.execute("SELECT COUNT(*) AS c FROM project_risks WHERE project_id = ?",
                                 (project_id,)).fetchone()["c"]
                code = f"R{n + 1}"
            status = data.get("status") if data.get("status") in RISK_STATUSES else "todo"
            cur = conn.execute("""
                INSERT INTO project_risks (project_id, risk_code, description, impact, mitigation, owner, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (project_id, code, desc, impact, clean_text(data.get("mitigation")),
                  clean_text(data.get("owner")), status, get_now_iso()))
            record_activity(conn, project_id, "User", "Risk Added", f'Added risk {code}')
            return json_response(dict(conn.execute(
                "SELECT * FROM project_risks WHERE id = ?", (cur.lastrowid,)).fetchone()), status=201)

    @app.put("/api/risks/<risk_id:int>")
    def update_risk(risk_id):
        user = get_current_user()
        if not user:
            return json_response({"error": "Unauthorized"}, status=401)
        data = request.json or {}
        with get_db() as conn:
            row = conn.execute("SELECT * FROM project_risks WHERE id = ?", (risk_id,)).fetchone()
            if not row:
                return json_response({"error": "Risk not found"}, status=404)
            desc = clean_text(data["description"]) if "description" in data else row["description"]
            if not desc:
                return json_response({"error": "Risk description is required"}, status=400)
            impact = str(data.get("impact", row["impact"])).lower()
            impact = impact if impact in IMPACTS else row["impact"]
            status = data.get("status", row["status"])
            status = status if status in RISK_STATUSES else row["status"]
            conn.execute("""
                UPDATE project_risks SET risk_code = ?, description = ?, impact = ?, mitigation = ?, owner = ?, status = ?
                WHERE id = ?
            """, (clean_text(data["risk_code"]) if "risk_code" in data else row["risk_code"],
                  desc, impact,
                  clean_text(data["mitigation"]) if "mitigation" in data else row["mitigation"],
                  clean_text(data["owner"]) if "owner" in data else row["owner"],
                  status, risk_id))
            return json_response(dict(conn.execute(
                "SELECT * FROM project_risks WHERE id = ?", (risk_id,)).fetchone()))

    @app.delete("/api/risks/<risk_id:int>")
    def delete_risk(risk_id):
        denied = deny_if_not_pm()
        if denied:
            return denied
        with get_db() as conn:
            conn.execute("DELETE FROM project_risks WHERE id = ?", (risk_id,))
            return json_response({"success": True})

    # ----------------------------------------------------------------- dashboard
    @app.get("/api/dashboard")
    def get_dashboard():
        today = date.today()
        with get_db() as conn:
            projects = conn.execute("SELECT * FROM projects ORDER BY name COLLATE NOCASE").fetchall()
            tasks = conn.execute("""
                SELECT t.id, t.project_id, t.title, t.status, t.priority, t.due_date, t.progress_pct,
                       m.name AS assignee_name
                FROM tasks t LEFT JOIN members m ON t.assignee_id = m.id
            """).fetchall()
            risks = conn.execute("""
                SELECT r.*, p.name AS project_name, t.title AS task_title FROM project_risks r
                JOIN projects p ON p.id = r.project_id
                JOIN tasks t ON t.id = r.task_id
                WHERE r.task_id IS NOT NULL AND r.status != 'done'
            """).fetchall()
            deliverables = conn.execute("""
                SELECT d.*, p.name AS project_name FROM deliverables d
                JOIN projects p ON p.id = d.project_id
                WHERE d.status != 'done'
            """).fetchall()

        by_project = {}
        for t in tasks:
            by_project.setdefault(t["project_id"], []).append(t)
        risks_by_project = {}
        for r in risks:
            risks_by_project.setdefault(r["project_id"], []).append(r)

        project_rows = []
        overdue_list = []
        workload = {}
        due_this_week = 0
        tot_tasks = tot_done = tot_overdue = 0

        for p in projects:
            pts = by_project.get(p["id"], [])
            total = len(pts)
            done = 0
            overdue = 0
            in_progress = 0
            todo = 0
            next_due = None
            for t in pts:
                st = (t["status"] or "todo").lower()
                dd = _d(t["due_date"])
                if st in ("done", "completed"):
                    done += 1
                    continue
                name = clean_assignee(t["assignee_name"])
                w = workload.setdefault(name, {"name": name, "open": 0, "overdue": 0})
                w["open"] += 1
                if dd is not None and dd < today:
                    overdue += 1
                    w["overdue"] += 1
                    overdue_list.append({
                        "task_id": t["id"], "project_id": p["id"], "project_name": p["name"],
                        "title": t["title"], "assignee": name,
                        "due_date": str(t["due_date"])[:10], "days_late": (today - dd).days,
                    })
                else:
                    if st in ("in_progress", "in progress", "doing"):
                        in_progress += 1
                    else:
                        todo += 1
                    if dd is not None:
                        if (dd - today).days <= 7:
                            due_this_week += 1
                        if next_due is None or dd < next_due[0]:
                            next_due = (dd, t["title"])

            pct = round(done / total * 100) if total else 0
            delivery = _d(p["delivery_date"])
            days_left = (delivery - today).days if delivery else None
            open_high = sum(1 for r in risks_by_project.get(p["id"], []) if r["impact"] in ("high", "critical"))

            if total and done == total:
                health = "done"
            elif overdue > 0 or (days_left is not None and days_left < 0):
                health = "delayed"
            elif open_high > 0 or (days_left is not None and days_left <= 14 and pct < 80):
                health = "at_risk"
            else:
                health = "on_track"

            tot_tasks += total
            tot_done += done
            tot_overdue += overdue
            project_rows.append({
                "id": p["id"], "name": p["name"], "color": p["color"],
                "project_code": p["project_code"], "project_manager": p["project_manager"],
                "delivery_date": p["delivery_date"], "days_left": days_left,
                "total_tasks": total, "done_tasks": done, "progress": pct,
                "overdue_tasks": overdue,
                "status_counts": {
                    "done": done,
                    "in_progress": in_progress,
                    "todo": todo,
                    "overdue": overdue,
                },
                "next_due": ({"date": next_due[0].isoformat(), "title": next_due[1]} if next_due else None),
                "open_risks": len(risks_by_project.get(p["id"], [])), "open_high_risks": open_high,
                "health": health,
            })

        overdue_list.sort(key=lambda x: -x["days_late"])

        upcoming = []
        for d in deliverables:
            disp = d["dispatch_date"] if ("dispatch_date" in d.keys() and d["dispatch_date"]) else d.get("due_date")
            dd = _d(disp)
            if dd is not None and dd >= today:
                upcoming.append({
                    "id": d["id"], "project_id": d["project_id"], "project_name": d["project_name"],
                    "title": d["title"], "quantity": d["quantity"], "quality": d["quality"],
                    "dispatch_date": str(disp)[:10],
                    "due_date": str(disp)[:10],
                    "days_left": (dd - today).days,
                })
        upcoming.sort(key=lambda x: (x["dispatch_date"] is None, x["dispatch_date"] or ""))

        high_risks = [{
            "id": r["id"], "project_id": r["project_id"], "project_name": r["project_name"],
            "task_id": r["task_id"], "task_title": r["task_title"],
            "risk_code": r["risk_code"], "description": r["description"],
            "mitigation": r["mitigation"], "owner": r["owner"],
        } for r in risks if r["impact"] in ("high", "critical")]

        workload_rows = sorted(workload.values(), key=lambda w: (-w["open"], w["name"]))

        user = get_current_user()
        if sanitize_projects_for_user:
            project_rows = sanitize_projects_for_user(project_rows, user)
        elif user and not is_full_access(user):
            for row in project_rows:
                for k in ("project_code", "cas_no", "customer_name", "chemist_name",
                          "project_manager", "received_date", "delivery_date",
                          "total_deliverable_quantity", "project_budget", "tech_pack"):
                    row.pop(k, None)

        return json_response({
            "today": today.isoformat(),
            "kpis": {
                "projects": len(project_rows),
                "overdue_tasks": tot_overdue,
                "due_this_week": due_this_week,
                "completion_pct": round(tot_done / tot_tasks * 100) if tot_tasks else 0,
                "open_high_risks": len(high_risks),
                "total_tasks": tot_tasks,
            },
            "projects": project_rows,
            "overdue": overdue_list[:10],
            "overdue_total": len(overdue_list),
            "deliverables": upcoming[:8],
            "high_risks": high_risks[:6],
            "workload": workload_rows[:8],
        })
