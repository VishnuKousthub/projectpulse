"""Tests for the Project Charter (deliverables, risks, header fields) and the Dashboard."""
import io
import json
import os
import sys
import unittest

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
                       {"title": "AZADOL 1 kg", "quality": "99%", "quantity": "1 kg", "due_date": "2026-12-10"}, self.pm)
        self.assertEqual(code, 201)
        code, d2 = call(f"/api/deliverables/{d['id']}", "PUT", {"status": "in_progress"}, self.pm)
        self.assertEqual((code, d2["status"], d2["quantity"]), (200, "in_progress", "1 kg"))
        code, _ = call(f"/api/projects/{self.pid}/deliverables", "POST", {"title": "  "}, self.pm)
        self.assertEqual(code, 400)
        _, c = call(f"/api/projects/{self.pid}/charter")
        self.assertTrue(any(x["id"] == d["id"] for x in c["deliverables"]))
        self.assertEqual(call(f"/api/deliverables/{d['id']}", "DELETE", None, self.pm)[0], 200)

    def test_04_risk_crud_and_auto_code(self):
        code, r1 = call(f"/api/projects/{self.pid}/risks", "POST", {"description": "Raw material delay", "impact": "high"}, self.pm)
        self.assertEqual(code, 201)
        _, r2 = call(f"/api/projects/{self.pid}/risks", "POST", {"description": "Low yield", "impact": "bogus"}, self.pm)
        self.assertNotEqual(r1["risk_code"], r2["risk_code"])
        self.assertEqual(r2["impact"], "medium")           # invalid impact falls back
        _, upd = call(f"/api/risks/{r1['id']}", "PUT", {"status": "closed"}, self.pm)
        self.assertEqual(upd["status"], "closed")
        self.assertEqual(call(f"/api/projects/{self.pid}/risks", "POST", {"description": ""}, self.pm)[0], 400)

    def test_05_restricted_roles_cannot_edit_but_can_read(self):
        self.assertEqual(call(f"/api/projects/{self.pid}/deliverables", "POST", {"title": "x"}, self.assignee)[0], 403)
        self.assertEqual(call(f"/api/projects/{self.pid}/risks", "POST", {"description": "x"}, self.assignee)[0], 403)
        self.assertEqual(call(f"/api/projects/{self.pid}/charter", "GET", None, self.assignee)[0], 200)
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
        call(f"/api/projects/{self.pid}/risks", "POST", {"description": "Equipment down", "impact": "high"}, self.pm)
        code, d = call("/api/dashboard")
        self.assertEqual(code, 200)
        for key in ("kpis", "projects", "overdue", "deliverables", "high_risks", "workload"):
            self.assertIn(key, d)
        row = next(p for p in d["projects"] if p["id"] == self.pid)
        self.assertEqual(row["project_code"], "CCS079")
        self.assertIsNotNone(row["days_left"])
        self.assertGreaterEqual(d["kpis"]["open_high_risks"], 1)
        self.assertEqual(d["kpis"]["projects"], len(d["projects"]))

    @classmethod
    def tearDownClass(cls):
        p = os.environ.get("PROJECT_PULSE_DB", "")
        if p.endswith("test_charter.db") and os.path.exists(p):
            os.remove(p)


if __name__ == "__main__":
    unittest.main()
