"""Tests for the Project Charter (deliverables, risks, header fields) and the Dashboard."""
import io
import json
import os
import sys
import unittest
from datetime import date, timedelta

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
os.environ.setdefault("PROJECT_PULSE_DB", os.path.join(os.path.dirname(os.path.abspath(__file__)), "test_charter.db"))

from app.database import init_db, get_db
from app.seed import seed_database
from app.main import app


def call(path, method="GET", body=None, token=None):
    data = json.dumps(body).encode() if body is not None else b""
    env = {
        "REQUEST_METHOD": method, "PATH_INFO": path, "SCRIPT_NAME": "", "SERVER_NAME": "localhost",
        "SERVER_PORT": "8000", "wsgi.version": (1, 0), "wsgi.url_scheme": "http",
        "wsgi.input": io.BytesIO(data), "CONTENT_LENGTH": str(len(data)), "CONTENT_TYPE": "application/json",
        "QUERY_STRING": "", "wsgi.errors": io.StringIO(), "wsgi.multithread": False,
        "wsgi.multiprocess": False, "wsgi.run_once": False,
    }
    if token:
        env["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    holder = []
    out = b"".join(app(env, lambda s, h, e=None: holder.append(s)))
    return int(holder[0].split()[0]), json.loads(out.decode() or "null")


def login(user, pwd):
    code, data = call("/api/auth/login", "POST", {"identifier": user, "username": user, "password": pwd})
    assert code == 200, data
    return data.get("token") or data.get("access_token")


class TestCharter(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        seed_database()
        _, projects = call("/api/projects")
        cls.pid = projects[0]["id"]
        cls.pm = login("pm", "pm123")
        cls.assignee = login("assignee", "assignee123")

    def test_01_header_fields_round_trip(self):
        code, _ = call(f"/api/projects/{self.pid}", "PUT", {
            "project_code": "CCS079", "cas_no": "123-45-6", "project_manager": "Rajagopal",
            "received_date": "2026-04-09", "delivery_date": "2026-12-15", "tech_pack": "TP-1"}, self.pm)
        self.assertEqual(code, 200)
        _, c = call(f"/api/projects/{self.pid}/charter")
        p = c["project"]
        self.assertEqual((p["project_code"], p["cas_no"], p["project_manager"]), ("CCS079", "123-45-6", "Rajagopal"))
        self.assertEqual((p["received_date"], p["delivery_date"], p["tech_pack"]), ("2026-04-09", "2026-12-15", "TP-1"))

    def test_02_update_without_charter_fields_keeps_them(self):
        call(f"/api/projects/{self.pid}", "PUT", {"description": "new scope"}, self.pm)
        _, c = call(f"/api/projects/{self.pid}/charter")
        self.assertEqual(c["project"]["project_code"], "CCS079")
        self.assertEqual(c["project"]["description"], "new scope")

    def test_03_deliverable_crud(self):
        code, d = call(f"/api/projects/{self.pid}/deliverables", "POST",
                       {"title": "AZADOL 1 kg", "quantity": "1 kg", "quality": "99%", "dispatch_date": "2026-12-10"}, self.pm)
        self.assertEqual(code, 201)
        self.assertEqual(d["dispatch_date"], "2026-12-10")
        self.assertEqual(d["quantity"], "1 kg")
        self.assertEqual(d["quality"], "99%")
        code, d2 = call(f"/api/deliverables/{d['id']}", "PUT", {"quantity": "2 kg", "dispatch_date": "2026-12-15"}, self.pm)
        self.assertEqual((code, d2["quantity"], d2["dispatch_date"]), (200, "2 kg", "2026-12-15"))
        code, _ = call(f"/api/projects/{self.pid}/deliverables", "POST", {"title": "  "}, self.pm)
        self.assertEqual(code, 400)
        _, c = call(f"/api/projects/{self.pid}/charter")
        self.assertTrue(any(x["id"] == d["id"] for x in c["deliverables"]))
        self.assertEqual(call(f"/api/deliverables/{d['id']}", "DELETE", None, self.pm)[0], 200)

    def test_04_risk_crud_and_auto_code(self):
        code, r1 = call(f"/api/projects/{self.pid}/risks", "POST", {"description": "Raw material delay", "impact": "high"}, self.pm)
        self.assertEqual(code, 201)
        self.assertEqual(r1["status"], "todo")
        _, r2 = call(f"/api/projects/{self.pid}/risks", "POST", {"description": "Low yield", "impact": "bogus"}, self.pm)
        self.assertNotEqual(r1["risk_code"], r2["risk_code"])
        self.assertEqual(r2["impact"], "medium")           # invalid impact falls back
        _, upd = call(f"/api/risks/{r1['id']}", "PUT", {"status": "done"}, self.pm)
        self.assertEqual(upd["status"], "done")
        _, upd2 = call(f"/api/risks/{r1['id']}", "PUT", {"status": "in_review"}, self.pm)
        self.assertEqual(upd2["status"], "in_review")
        self.assertEqual(call(f"/api/projects/{self.pid}/risks", "POST", {"description": ""}, self.pm)[0], 400)

    def test_05_restricted_roles_cannot_access_charter(self):
        self.assertEqual(call(f"/api/projects/{self.pid}/deliverables", "POST", {"title": "x"}, self.assignee)[0], 403)
        self.assertEqual(call(f"/api/projects/{self.pid}/risks", "POST", {"description": "x"}, self.assignee)[0], 403)
        self.assertEqual(call(f"/api/projects/{self.pid}/charter", "GET", None, self.assignee)[0], 403)
        self.assertEqual(call("/api/dashboard", "GET", None, self.assignee)[0], 200)

    def test_06_task_type_comes_from_tags(self):
        _, tasks = call(f"/api/projects/{self.pid}/tasks")
        tid = tasks[0]["id"]
        call(f"/api/tasks/{tid}", "PUT", {"tags": ["pm", "Technical"]}, self.pm)
        _, c = call(f"/api/projects/{self.pid}/charter")
        self.assertEqual(next(t for t in c["milestones"] if t["id"] == tid)["type"], "technical")
        call(f"/api/tasks/{tid}", "PUT", {"tags": ["Both"]}, self.pm)
        _, c = call(f"/api/projects/{self.pid}/charter")
        self.assertEqual(next(t for t in c["milestones"] if t["id"] == tid)["type"], "both")
        call(f"/api/tasks/{tid}", "PUT", {"tags": ["Non-technical"]}, self.pm)
        _, c = call(f"/api/projects/{self.pid}/charter")
        self.assertEqual(next(t for t in c["milestones"] if t["id"] == tid)["type"], "nontechnical")

    def test_07_dashboard_shape_and_counts(self):
        _, tasks = call(f"/api/projects/{self.pid}/tasks")
        tid = tasks[0]["id"]
        call(f"/api/tasks/{tid}/risks", "POST", {"description": "Equipment down", "impact": "high"}, self.pm)
        code, d = call("/api/dashboard")
        self.assertEqual(code, 200)
        for key in ("kpis", "projects", "overdue", "deliverables", "high_risks", "workload"):
            self.assertIn(key, d)
        row = next(p for p in d["projects"] if p["id"] == self.pid)
        self.assertEqual(row["project_code"], "CCS079")
        self.assertIsNotNone(row["days_left"])
        self.assertGreaterEqual(d["kpis"]["open_high_risks"], 1)
        self.assertEqual(d["kpis"]["projects"], len(d["projects"]))
        self.assertTrue(any(r.get("task_id") == tid for r in d.get("high_risks", [])))

    def test_08_migration_converts_old_statuses(self):
        with get_db() as conn:
            conn.execute("INSERT INTO deliverables (project_id, title, due_date, status, created_at) VALUES (?, 'Old Due Date', '2026-11-20', 'pending', '2026-01-01')", (self.pid,))
            conn.execute("INSERT INTO deliverables (project_id, title, status, created_at) VALUES (?, 'Old Completed', 'completed', '2026-01-01')", (self.pid,))
            conn.execute("INSERT INTO project_risks (project_id, description, status, created_at) VALUES (?, 'Old Open', 'open', '2026-01-01')", (self.pid,))
            conn.execute("INSERT INTO project_risks (project_id, description, status, created_at) VALUES (?, 'Old Closed', 'closed', '2026-01-01')", (self.pid,))
        init_db()
        with get_db() as conn:
            d_p = conn.execute("SELECT status, dispatch_date FROM deliverables WHERE title = 'Old Due Date'").fetchone()
            d_c = conn.execute("SELECT status FROM deliverables WHERE title = 'Old Completed'").fetchone()["status"]
            r_o = conn.execute("SELECT status FROM project_risks WHERE description = 'Old Open'").fetchone()["status"]
            r_c = conn.execute("SELECT status FROM project_risks WHERE description = 'Old Closed'").fetchone()["status"]
        self.assertEqual(d_p["status"], "todo")
        self.assertEqual(d_p["dispatch_date"], "2026-11-20")
        self.assertEqual(d_c, "done")
        self.assertEqual(r_o, "todo")
        self.assertEqual(r_c, "done")

    def test_09_chemists_endpoints_and_permissions(self):
        # pm can list chemists
        code, chemists = call("/api/chemists", "GET", None, self.pm)
        self.assertEqual(code, 200)
        names = [c["name"] for c in chemists]
        self.assertIn("Dr. A. Sharma", names)
        self.assertIn("R. Patel", names)

        # assignee is forbidden
        code, _ = call("/api/chemists", "GET", None, self.assignee)
        self.assertEqual(code, 403)
        code, _ = call("/api/chemists", "POST", {"name": "Test Chemist"}, self.assignee)
        self.assertEqual(code, 403)

        # pm can create chemist
        code, created = call("/api/chemists", "POST", {"name": "Dr. Marie Curie"}, self.pm)
        self.assertEqual(code, 201)
        self.assertEqual(created["name"], "Dr. Marie Curie")

        # duplicate name rejected
        code, err = call("/api/chemists", "POST", {"name": "dr. marie curie"}, self.pm)
        self.assertEqual(code, 400)

        # empty name rejected
        code, err = call("/api/chemists", "POST", {"name": "   "}, self.pm)
        self.assertEqual(code, 400)

    def test_10_new_charter_fields_and_validation(self):
        # valid update with customer, chemist, qty, and budget
        code, _ = call(f"/api/projects/{self.pid}", "PUT", {
            "customer_name": "Acme Pharma",
            "chemist_name": "Dr. Marie Curie",
            "total_deliverable_quantity": "50 kg",
            "project_budget": 1250000,
            "received_date": "2026-05-01",
            "delivery_date": "2026-10-01"
        }, self.pm)
        self.assertEqual(code, 200)

        _, c = call(f"/api/projects/{self.pid}/charter")
        p = c["project"]
        self.assertEqual(p["customer_name"], "Acme Pharma")
        self.assertEqual(p["chemist_name"], "Dr. Marie Curie")
        self.assertEqual(p["total_deliverable_quantity"], "50 kg")
        self.assertEqual(p["project_budget"], 1250000.0)

        # negative budget rejected
        code, _ = call(f"/api/projects/{self.pid}", "PUT", {"project_budget": -100}, self.pm)
        self.assertEqual(code, 400)

        # delivery date earlier than received date rejected
        code, _ = call(f"/api/projects/{self.pid}", "PUT", {
            "received_date": "2026-06-01",
            "delivery_date": "2026-05-01"
        }, self.pm)
        self.assertEqual(code, 400)

    def test_11_upcoming_dispatches_on_dashboard(self):
        # add deliverable with future dispatch date and past dispatch date
        future_date = (date.today() + timedelta(days=5)).isoformat()
        past_date = (date.today() - timedelta(days=5)).isoformat()
        code, d_fut = call(f"/api/projects/{self.pid}/deliverables", "POST",
                           {"title": "Future Batch", "quantity": "10 kg", "dispatch_date": future_date}, self.pm)
        self.assertEqual(code, 201)
        code, d_past = call(f"/api/projects/{self.pid}/deliverables", "POST",
                            {"title": "Past Batch", "quantity": "5 kg", "dispatch_date": past_date}, self.pm)
        self.assertEqual(code, 201)

        code, dash = call("/api/dashboard", "GET", None, self.pm)
        self.assertEqual(code, 200)
        upcoming = dash.get("deliverables", [])
        # upcoming should contain the future deliverable but not the past one
        fut_ids = [x["id"] for x in upcoming]
        self.assertIn(d_fut["id"], fut_ids)
        self.assertNotIn(d_past["id"], fut_ids)
        # verify quantity and dispatch_date are returned
        fut_item = next(x for x in upcoming if x["id"] == d_fut["id"])
        self.assertEqual(fut_item["quantity"], "10 kg")
        self.assertEqual(fut_item["dispatch_date"], future_date)

    def test_12_task_risks(self):
        _, tasks = call(f"/api/projects/{self.pid}/tasks")
        tid = tasks[0]["id"]

        # PM creates task risk
        code, r1 = call(f"/api/tasks/{tid}/risks", "POST", {
            "description": "High temperature reaction", "impact": "high", "mitigation": "Cooling jacket",
            "owner": "Alice", "status": "todo"
        }, self.pm)
        self.assertEqual(code, 201)
        self.assertEqual(r1["task_id"], tid)
        self.assertEqual(r1["impact"], "high")

        # Assignee creates task risk
        code, r2 = call(f"/api/tasks/{tid}/risks", "POST", {
            "description": "Low reagent purity", "impact": "medium", "status": "in_progress"
        }, self.assignee)
        self.assertEqual(code, 201)
        self.assertEqual(r2["task_id"], tid)

        # GET /api/tasks/<id>/risks
        code, t_risks = call(f"/api/tasks/{tid}/risks", "GET", None, self.assignee)
        self.assertEqual(code, 200)
        self.assertGreaterEqual(len(t_risks), 2)

        # GET /api/projects/<pid>/tasks includes risk_count and has_high_risk
        _, p_tasks = call(f"/api/projects/{self.pid}/tasks")
        task_row = next(t for t in p_tasks if t["id"] == tid)
        self.assertGreaterEqual(task_row["risk_count"], 2)
        self.assertTrue(task_row["has_high_risk"])

        # Assignee can update risk
        code, upd = call(f"/api/risks/{r1['id']}", "PUT", {"status": "done"}, self.assignee)
        self.assertEqual(code, 200)
        self.assertEqual(upd["status"], "done")

        # Assignee CANNOT delete risk (403)
        code, _ = call(f"/api/risks/{r1['id']}", "DELETE", None, self.assignee)
        self.assertEqual(code, 403)

        # PM CAN delete risk (200)
        code, _ = call(f"/api/risks/{r1['id']}", "DELETE", None, self.pm)
        self.assertEqual(code, 200)

        # Delete task cascades to its risks
        with get_db() as conn:
            conn.execute("INSERT INTO project_risks (project_id, task_id, description, created_at) VALUES (?, ?, 'Cascade Risk', '2026-01-01')", (self.pid, tid))
        call(f"/api/tasks/{tid}", "DELETE", None, self.pm)
        with get_db() as conn:
            remaining = conn.execute("SELECT COUNT(*) AS c FROM project_risks WHERE task_id = ?", (tid,)).fetchone()["c"]
        self.assertEqual(remaining, 0)

    @classmethod
    def tearDownClass(cls):
        p = os.environ.get("PROJECT_PULSE_DB", "")
        if p.endswith("test_charter.db") and os.path.exists(p):
            os.remove(p)


if __name__ == "__main__":
    unittest.main()

