"""
Unit Tests for:
1. Due Date Immutability Lock (once set on a task, cannot be changed or cleared).
2. Admin-Only Audit Log Dashboard API (/api/admin/audit-logs & /api/admin/audit-logs/export).
"""

import io
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

os.environ["PROJECT_PULSE_DB"] = os.path.abspath(
    os.path.join(os.path.dirname(__file__), 'test_audit_lock.db')
)

from app.database import init_db, get_db
from app.seed import seed_database
from app.main import app


def wsgi_call(path, method="GET", body=None, token=None, query_string=""):
    body_bytes = json.dumps(body).encode("utf-8") if body is not None else b""
    env = {
        "REQUEST_METHOD": method,
        "PATH_INFO": path,
        "SCRIPT_NAME": "",
        "SERVER_NAME": "localhost",
        "SERVER_PORT": "8000",
        "wsgi.version": (1, 0),
        "wsgi.url_scheme": "http",
        "wsgi.input": io.BytesIO(body_bytes),
        "CONTENT_LENGTH": str(len(body_bytes)),
        "CONTENT_TYPE": "application/json",
        "QUERY_STRING": query_string,
        "wsgi.errors": io.StringIO(),
        "wsgi.multithread": False,
        "wsgi.multiprocess": False,
        "wsgi.run_once": False,
    }
    if token:
        env["HTTP_AUTHORIZATION"] = f"Bearer {token}"

    status_holder = []
    headers_holder = []

    def start_response(status, headers, exc_info=None):
        status_holder.append(status)
        headers_holder.append(headers)

    chunks = app(env, start_response)
    raw = b"".join(chunks)
    code = int(status_holder[0].split()[0])
    ct = dict(headers_holder[0]).get("Content-Type", "")
    if "application/json" in ct:
        try:
            return code, json.loads(raw.decode("utf-8"))
        except Exception:
            pass
    return code, raw.decode("utf-8", errors="replace")


def login(username, password):
    code, data = wsgi_call("/api/auth/login", "POST", {"username": username, "password": password})
    assert code == 200, f"Login failed for {username}: {data}"
    return data["token"]


class TestDueDateLockAndAuditDashboard(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db_path = os.environ["PROJECT_PULSE_DB"]
        if os.path.exists(db_path):
            os.remove(db_path)
        init_db()
        seed_database()
        cls.admin_token = login("admin", "admin123")
        cls.pm_token = login("pm", "pm123")
        cls.lead_token = login("lead", "lead123")
        cls.assignee_token = login("assignee", "assignee123")

    @classmethod
    def tearDownClass(cls):
        db_path = os.environ["PROJECT_PULSE_DB"]
        if os.path.exists(db_path):
            try:
                os.remove(db_path)
            except Exception:
                pass

    def test_01_due_date_locked_once_set(self):
        # 1. Create a task WITHOUT a due date
        code, created = wsgi_call("/api/projects/1/tasks", "POST", {
            "title": "Immutable Due Date Task",
            "status": "todo",
            "start_date": "2026-11-01",
        }, token=self.lead_token)
        self.assertEqual(code, 200)
        tid = created["id"]
        self.assertIsNone(created["due_date"])

        # 2. Setting initial due_date succeeds
        code_set, updated = wsgi_call(f"/api/tasks/{tid}", "PUT", {
            "due_date": "2026-11-20",
        }, token=self.lead_token)
        self.assertEqual(code_set, 200)
        self.assertEqual(updated["due_date"], "2026-11-20")

        # 3. Updating other fields while passing unchanged due_date still succeeds
        code_same, updated2 = wsgi_call(f"/api/tasks/{tid}", "PUT", {
            "due_date": "2026-11-20",
            "progress_pct": 50,
            "status": "in_progress",
        }, token=self.assignee_token)
        self.assertEqual(code_same, 200)
        self.assertEqual(updated2["progress_pct"], 50)
        self.assertEqual(updated2["due_date"], "2026-11-20")

        # 4. Changing or clearing due_date is blocked (403 Forbidden) for Lead and Assignee
        for tok, rname in [
            (self.lead_token, "Lead"),
            (self.assignee_token, "Assignee"),
        ]:
            c1, r1 = wsgi_call(f"/api/tasks/{tid}", "PUT", {"due_date": "2026-11-28"}, token=tok)
            self.assertEqual(c1, 403, f"{rname} should not be able to change due_date: {r1}")
            c2, r2 = wsgi_call(f"/api/tasks/{tid}", "PUT", {"end_date": "2026-11-29"}, token=tok)
            self.assertEqual(c2, 403, f"{rname} should not be able to change end_date: {r2}")
            c3, r3 = wsgi_call(f"/api/tasks/{tid}", "PUT", {"due_date": ""}, token=tok)
            self.assertEqual(c3, 403, f"{rname} should not be able to clear due_date: {r3}")

        # 5. PM and Admin CAN still edit and clear due_date freely (200 OK)
        c_pm, r_pm = wsgi_call(f"/api/tasks/{tid}", "PUT", {"due_date": "2026-11-26"}, token=self.pm_token)
        self.assertEqual(c_pm, 200, f"PM should be allowed to edit due_date: {r_pm}")
        self.assertEqual(r_pm["due_date"], "2026-11-26")

        c_adm, r_adm = wsgi_call(f"/api/tasks/{tid}", "PUT", {"due_date": "2026-11-30"}, token=self.admin_token)
        self.assertEqual(c_adm, 200, f"Admin should be allowed to edit due_date: {r_adm}")
        self.assertEqual(r_adm["due_date"], "2026-11-30")

        c_clr, r_clr = wsgi_call(f"/api/tasks/{tid}", "PUT", {"due_date": ""}, token=self.pm_token)
        self.assertEqual(c_clr, 200, f"PM should be allowed to clear due_date: {r_clr}")
        self.assertIsNone(r_clr["due_date"])

    def test_02_audit_endpoint_admin_only(self):
        # Unauthenticated -> 401
        c_anon, _ = wsgi_call("/api/admin/audit-logs", "GET")
        self.assertEqual(c_anon, 401)

        # PM, Lead, Assignee -> 403 Forbidden
        for tok, rname in [
            (self.pm_token, "PM"),
            (self.lead_token, "Lead"),
            (self.assignee_token, "Assignee"),
        ]:
            c_den, res = wsgi_call("/api/admin/audit-logs", "GET", token=tok)
            self.assertEqual(c_den, 403, f"{rname} must be denied audit logs: {res}")
            c_exp, _ = wsgi_call("/api/admin/audit-logs/export", "GET", token=tok)
            self.assertEqual(c_exp, 403, f"{rname} must be denied audit log export")

        # Admin -> 200 OK
        c_ok, data = wsgi_call("/api/admin/audit-logs", "GET", token=self.admin_token)
        self.assertEqual(c_ok, 200)
        self.assertIn("logs", data)
        self.assertIn("kpis", data)
        self.assertIn("filters", data)

    def test_03_audit_tracks_adds_updates_field_values_and_deletes(self):
        # Lead creates a task
        c1, task = wsgi_call("/api/projects/1/tasks", "POST", {
            "title": "Audit Tracked Synthesis Task",
            "status": "todo",
            "priority": "medium",
            "estimated_hours": 10.0,
        }, token=self.lead_token)
        self.assertEqual(c1, 200)
        tid = task["id"]

        # Assignee updates progress_pct and actual_hours
        c2, _ = wsgi_call(f"/api/tasks/{tid}", "PUT", {
            "progress_pct": 65,
            "actual_hours": 6.5,
            "status": "in_progress",
        }, token=self.assignee_token)
        self.assertEqual(c2, 200)

        # Lead edits title and adds a subtask
        c3, _ = wsgi_call(f"/api/tasks/{tid}", "PUT", {
            "title": "Audit Tracked Synthesis Task v2",
            "priority": "high",
        }, token=self.lead_token)
        self.assertEqual(c3, 200)

        c4, sub = wsgi_call(f"/api/tasks/{tid}/subtasks", "POST", {
            "title": "Audit Subtask Item",
        }, token=self.lead_token)
        self.assertEqual(c4, 201)

        # PM updates Project Charter po_number
        c5, _ = wsgi_call("/api/projects/1", "PUT", {
            "po_number": "PO-AUDIT-777",
        }, token=self.pm_token)
        self.assertEqual(c5, 200)

        # PM deletes the task
        c6, _ = wsgi_call(f"/api/tasks/{tid}", "DELETE", token=self.pm_token)
        self.assertEqual(c6, 200)

        # Fetch all audit logs as Admin
        code, audit = wsgi_call("/api/admin/audit-logs", "GET", token=self.admin_token, query_string="limit=200")
        self.assertEqual(code, 200)
        logs = audit["logs"]
        self.assertGreater(len(logs), 0)

        # Verify Assignee field-level diffs were recorded accurately
        assignee_updates = [l for l in logs if l["username"] == "assignee" and l["action_type"] == "UPDATE" and l["task_id"] == tid]
        self.assertTrue(len(assignee_updates) >= 1)
        prog_diffs = [ch for ch in assignee_updates[0]["changes"] if ch["field"] == "Progress %"]
        self.assertTrue(prog_diffs and prog_diffs[0]["old"] == "0%" and prog_diffs[0]["new"] == "65%")

        # Verify Lead title/priority update recorded
        lead_updates = [l for l in logs if l["username"] == "lead" and l["action_type"] == "UPDATE" and l["entity_type"] == "task" and l["task_id"] == tid]
        self.assertTrue(any(
            any(ch["field"] == "Title" and ch["new"] == "Audit Tracked Synthesis Task v2" for ch in l["changes"])
            for l in lead_updates
        ))

        # Verify Subtask creation recorded
        self.assertTrue(any(l["entity_type"] == "subtask" and l["action_type"] == "CREATE" and l["entity_name"] == "Audit Subtask Item" for l in logs))

        # Verify Project Charter field diff recorded
        pm_proj_updates = [l for l in logs if l["username"] == "pm" and l["entity_type"] == "project" and l["action_type"] == "UPDATE"]
        self.assertTrue(any(
            any(ch["field"] == "Po Number" and ch["new"] == "PO-AUDIT-777" for ch in l["changes"])
            for l in pm_proj_updates
        ))

        # Verify Task Deletion recorded permanently even after task deletion
        del_logs = [l for l in logs if l["action_type"] == "DELETE" and l["entity_type"] == "task" and l["entity_id"] == tid]
        self.assertEqual(len(del_logs), 1)
        self.assertEqual(del_logs[0]["username"], "pm")

        # Verify filter by username & action_type works
        code_f, f_data = wsgi_call("/api/admin/audit-logs", "GET", token=self.admin_token, query_string="username=assignee&action_type=UPDATE")
        self.assertEqual(code_f, 200)
        self.assertTrue(all(l["username"] == "assignee" and l["action_type"] == "UPDATE" for l in f_data["logs"]))

        # Verify CSV export works for Admin
        code_csv, csv_body = wsgi_call("/api/admin/audit-logs/export", "GET", token=self.admin_token)
        self.assertEqual(code_csv, 200)
        self.assertIn("Timestamp,Username,Full Name", csv_body)
        self.assertIn("Audit Tracked Synthesis Task v2", csv_body)


if __name__ == "__main__":
    unittest.main()
