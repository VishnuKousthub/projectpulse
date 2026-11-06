"""
Unit Tests for Project Owner-Based Access Control in ProjectPulse
Validates:
1. Case-insensitive and whitespace-insensitive matching between Project Charter owner and user database.
2. Dynamic project-level access control & isolation between different users.
3. Administrator unrestricted access across all projects.
4. Backend API protection against unauthorized direct access (returns 403 Forbidden).
5. Comma-separated multi-owner lists.
6. Ownership assignment on project creation.
"""

import io
import json
import os
import unittest
import sys

# Ensure project root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.database import init_db, get_db, hash_password
from app.seed import seed_database
from app.main import app


def wsgi_call(path, method="GET", body=None, token=None):
    data = json.dumps(body).encode("utf-8") if body is not None else b""
    env = {
        "REQUEST_METHOD": method,
        "PATH_INFO": path,
        "SCRIPT_NAME": "",
        "SERVER_NAME": "localhost",
        "SERVER_PORT": "8000",
        "wsgi.version": (1, 0),
        "wsgi.url_scheme": "http",
        "wsgi.input": io.BytesIO(data),
        "CONTENT_LENGTH": str(len(data)),
        "CONTENT_TYPE": "application/json",
        "QUERY_STRING": "",
        "wsgi.errors": io.StringIO(),
        "wsgi.multithread": False,
        "wsgi.multiprocess": False,
        "wsgi.run_once": False,
    }
    if token:
        env["HTTP_AUTHORIZATION"] = f"Bearer {token}"
    holder = []
    out = b"".join(app(env, lambda s, h, e=None: holder.append(s)))
    status_code = int(holder[0].split()[0])
    resp_body = json.loads(out.decode("utf-8") or "null") if out else None
    return status_code, resp_body


def login(user, pwd):
    code, data = wsgi_call("/api/auth/login", "POST", {"identifier": user, "username": user, "password": pwd})
    assert code == 200, f"Login failed for {user}: {data}"
    return data.get("token") or data.get("access_token")


class TestProjectOwnerAccessControl(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        seed_database()

        # Seed PM users and assigned lead users
        now_str = "2026-11-06T10:00:00"
        with get_db() as conn:
            for u, e, p, r, fn in [
                ('amit', 'amit@example.com', 'amit123', 'pm', 'Amit Kumar'),
                ('priya', 'priya@example.com', 'priya123', 'pm', 'Priya Sharma'),
                ('owner_amit', 'owner_amit@example.com', 'amit123', 'lead', 'Amit Lead Owner'),
                ('owner_priya', 'owner_priya@example.com', 'priya123', 'lead', 'Priya Lead Owner'),
                ('unassigned_lead', 'unassigned_lead@example.com', 'lead123', 'lead', 'Unassigned Lead'),
                ('unassigned_assignee', 'unassigned_assignee@example.com', 'assignee123', 'assignee', 'Unassigned Assignee'),
                ('assigned_lead', 'assigned_lead@example.com', 'lead123', 'lead', 'Assigned Lead'),
            ]:
                conn.execute("DELETE FROM users WHERE username = ?", (u,))
                conn.execute("""
                    INSERT INTO users (username, email, password_hash, role, full_name, created_at, must_reset_password)
                    VALUES (?, ?, ?, ?, ?, ?, 0)
                """, (u, e, hash_password(p), r, fn, now_str))

        cls.admin_token = login("admin", "admin123")
        cls.amit_token = login("amit", "amit123")
        cls.priya_token = login("priya", "priya123")
        cls.owner_amit_token = login("owner_amit", "amit123")
        cls.owner_priya_token = login("owner_priya", "priya123")
        cls.unassigned_lead_token = login("unassigned_lead", "lead123")
        cls.unassigned_assignee_token = login("unassigned_assignee", "assignee123")
        cls.assigned_lead_token = login("assigned_lead", "lead123")

    def test_01_case_insensitive_and_whitespace_matching(self):
        """Verify Owner_Amit, owner_amit, OWNER_AMIT, and '  owner_amit  ' all match user 'owner_amit'."""
        with get_db() as conn:
            # Create three projects with varying casing and whitespace
            c1 = conn.execute("""
                INSERT INTO projects (name, project_owner, project_manager, color, created_at, updated_at)
                VALUES ('Project TitleCase', 'Owner_Amit', 'Owner_Amit', '#3B82F6', '2026-11-06', '2026-11-06')
            """)
            p1_id = c1.lastrowid

            c2 = conn.execute("""
                INSERT INTO projects (name, project_owner, project_manager, color, created_at, updated_at)
                VALUES ('Project UpperCase', 'OWNER_AMIT', 'OWNER_AMIT', '#10B981', '2026-11-06', '2026-11-06')
            """)
            p2_id = c2.lastrowid

            c3 = conn.execute("""
                INSERT INTO projects (name, project_owner, project_manager, color, created_at, updated_at)
                VALUES ('Project PaddedWhitespace', '   owner_amit   ', '   owner_amit   ', '#F59E0B', '2026-11-06', '2026-11-06')
            """)
            p3_id = c3.lastrowid

        code, projects = wsgi_call("/api/projects", "GET", token=self.owner_amit_token)
        self.assertEqual(code, 200)
        returned_ids = {p["id"] for p in projects}

        # All 3 projects must be visible to user 'owner_amit'
        self.assertIn(p1_id, returned_ids)
        self.assertIn(p2_id, returned_ids)
        self.assertIn(p3_id, returned_ids)

        # Backend direct project access must also succeed
        code1, _ = wsgi_call(f"/api/projects/{p1_id}", "GET", token=self.owner_amit_token)
        code2, _ = wsgi_call(f"/api/projects/{p2_id}", "GET", token=self.owner_amit_token)
        code3, _ = wsgi_call(f"/api/projects/{p3_id}", "GET", token=self.owner_amit_token)
        self.assertEqual(code1, 200)
        self.assertEqual(code2, 200)
        self.assertEqual(code3, 200)

    def test_02_project_isolation_between_assigned_users(self):
        """Assigned user Owner Amit should only see Owner Amit projects. User Owner Priya should only see Owner Priya projects."""
        with get_db() as conn:
            c_amit = conn.execute("""
                INSERT INTO projects (name, project_owner, project_manager, color, created_at, updated_at)
                VALUES ('Amit Dedicated Project', 'owner_amit', 'owner_amit', '#3B82F6', '2026-11-06', '2026-11-06')
            """)
            amit_pid = c_amit.lastrowid

            c_priya = conn.execute("""
                INSERT INTO projects (name, project_owner, project_manager, color, created_at, updated_at)
                VALUES ('Priya Dedicated Project', 'owner_priya', 'owner_priya', '#EC4899', '2026-11-06', '2026-11-06')
            """)
            priya_pid = c_priya.lastrowid

        # 1. Check GET /api/projects for Owner Amit
        _, amit_projects = wsgi_call("/api/projects", "GET", token=self.owner_amit_token)
        amit_ids = {p["id"] for p in amit_projects}
        self.assertIn(amit_pid, amit_ids)
        self.assertNotIn(priya_pid, amit_ids)

        # 2. Check GET /api/projects for Owner Priya
        _, priya_projects = wsgi_call("/api/projects", "GET", token=self.owner_priya_token)
        priya_ids = {p["id"] for p in priya_projects}
        self.assertIn(priya_pid, priya_ids)
        self.assertNotIn(amit_pid, priya_ids)

        # 3. Check GET /api/bootstrap for Owner Amit
        code, boot_amit = wsgi_call("/api/bootstrap", "GET", token=self.owner_amit_token)
        self.assertEqual(code, 200)
        boot_amit_ids = {p["id"] for p in boot_amit.get("projects", [])}
        self.assertIn(amit_pid, boot_amit_ids)
        self.assertNotIn(priya_pid, boot_amit_ids)

    def test_02b_pm_unrestricted_access_across_all_projects(self):
        """Project Managers (PM) must have unrestricted access across all projects, just like Admin."""
        with get_db() as conn:
            c_p1 = conn.execute("INSERT INTO projects (name, project_owner, color, created_at, updated_at) VALUES ('PM Test Proj 1', 'owner_amit', '#123456', '2026-11-06', '2026-11-06')")
            p1_id = c_p1.lastrowid
            c_p2 = conn.execute("INSERT INTO projects (name, project_owner, color, created_at, updated_at) VALUES ('PM Test Proj 2', 'owner_priya', '#654321', '2026-11-06', '2026-11-06')")
            p2_id = c_p2.lastrowid

        for token, pm_name in [(self.amit_token, "Amit"), (self.priya_token, "Priya")]:
            # PM sees all projects in listing
            code, projs = wsgi_call("/api/projects", "GET", token=token)
            self.assertEqual(code, 200)
            proj_ids = {p["id"] for p in projs}
            self.assertIn(p1_id, proj_ids, f"PM {pm_name} must see project 1")
            self.assertIn(p2_id, proj_ids, f"PM {pm_name} must see project 2")

            # PM gets direct access to any project
            c1, _ = wsgi_call(f"/api/projects/{p1_id}", "GET", token=token)
            c2, _ = wsgi_call(f"/api/projects/{p2_id}", "GET", token=token)
            self.assertEqual(c1, 200, f"PM {pm_name} must have direct access to project 1")
            self.assertEqual(c2, 200, f"PM {pm_name} must have direct access to project 2")

            # PM gets bootstrap with all projects
            cb, boot = wsgi_call("/api/bootstrap", "GET", token=token)
            self.assertEqual(cb, 200)
            b_ids = {p["id"] for p in boot.get("projects", [])}
            self.assertIn(p1_id, b_ids)
            self.assertIn(p2_id, b_ids)

            # PM gets portfolio dashboard with all projects
            cd, dash = wsgi_call("/api/dashboard", "GET", token=token)
            self.assertEqual(cd, 200)
            d_ids = {p["id"] for p in dash.get("projects", [])}
            self.assertIn(p1_id, d_ids)
            self.assertIn(p2_id, d_ids)

    def test_03_admin_unrestricted_access(self):
        """Admin user must see and access all projects regardless of Project Owner."""
        with get_db() as conn:
            c1 = conn.execute("INSERT INTO projects (name, project_owner, color, created_at, updated_at) VALUES ('Admin Test Project', 'amit', '#123456', '2026-11-06', '2026-11-06')")
            pid = c1.lastrowid
            c2 = conn.execute("INSERT INTO tasks (project_id, title, status, created_at, updated_at) VALUES (?, 'Admin Task', 'todo', '2026-11-06', '2026-11-06')", (pid,))
            tid = c2.lastrowid

        # Admin sees project in listing
        _, admin_projects = wsgi_call("/api/projects", "GET", token=self.admin_token)
        admin_pids = {p["id"] for p in admin_projects}
        self.assertIn(pid, admin_pids)

        # Admin gets direct project details
        code, proj = wsgi_call(f"/api/projects/{pid}", "GET", token=self.admin_token)
        self.assertEqual(code, 200)

        # Admin gets direct task details
        code, task = wsgi_call(f"/api/tasks/{tid}", "GET", token=self.admin_token)
        self.assertEqual(code, 200)

        # Admin gets charter
        code, charter = wsgi_call(f"/api/projects/{pid}/charter", "GET", token=self.admin_token)
        self.assertEqual(code, 200)

        # Admin dashboard includes this project
        code, dash = wsgi_call("/api/dashboard", "GET", token=self.admin_token)
        self.assertEqual(code, 200)
        dash_pids = {p["id"] for p in dash.get("projects", [])}
        self.assertIn(pid, dash_pids)

    def test_04_backend_blocks_unauthorized_direct_api_access(self):
        """Direct API requests to another user's project or project resources must return 403 Forbidden."""
        with get_db() as conn:
            # Create project strictly owned by Owner Amit with tasks, deliverables, risks, sprints, milestones
            c = conn.execute("INSERT INTO projects (name, project_owner, project_manager, color, created_at, updated_at) VALUES ('Amit Secret Project', 'owner_amit', 'owner_amit', '#000000', '2026-11-06', '2026-11-06')")
            pid = c.lastrowid
            t_cur = conn.execute("INSERT INTO tasks (project_id, title, status, created_at, updated_at) VALUES (?, 'Secret Task', 'todo', '2026-11-06', '2026-11-06')", (pid,))
            tid = t_cur.lastrowid
            d_cur = conn.execute("INSERT INTO deliverables (project_id, title, quantity, created_at) VALUES (?, 'Secret Deliverable', '10kg', '2026-11-06')", (pid,))
            did = d_cur.lastrowid
            r_cur = conn.execute("INSERT INTO project_risks (project_id, risk_code, description, created_at) VALUES (?, 'R1', 'Secret Risk', '2026-11-06')", (pid,))
            rid = r_cur.lastrowid
            s_cur = conn.execute("INSERT INTO sprints (project_id, name) VALUES (?, 'Sprint 1')", (pid,))
            sid = s_cur.lastrowid
            m_cur = conn.execute("INSERT INTO milestones (project_id, title, due_date) VALUES (?, 'Milestone 1', '2026-12-31')", (pid,))
            mid = m_cur.lastrowid

        # Owner Priya attempts direct access to Owner Amit's project and sub-resources
        unauthorized_token = self.owner_priya_token

        endpoints = [
            (f"/api/projects/{pid}", "GET", None),
            (f"/api/projects/{pid}", "PUT", {"name": "Hacked Name"}),
            (f"/api/projects/{pid}", "DELETE", None),
            (f"/api/projects/{pid}/tasks", "GET", None),
            (f"/api/projects/{pid}/tasks", "POST", {"title": "Intruder Task"}),
            (f"/api/tasks/{tid}", "GET", None),
            (f"/api/tasks/{tid}", "PUT", {"title": "Modified Task"}),
            (f"/api/tasks/{tid}", "DELETE", None),
            (f"/api/tasks/{tid}/subtasks", "POST", {"title": "Intruder Subtask"}),
            (f"/api/tasks/{tid}/timelogs", "POST", {"hours": 2, "description": "Intruder Log"}),
            (f"/api/projects/{pid}/charter", "GET", None),
            (f"/api/projects/{pid}/deliverables", "GET", None),
            (f"/api/projects/{pid}/deliverables", "POST", {"title": "Intruder Deliverable", "quantity": "5kg"}),
            (f"/api/deliverables/{did}", "PUT", {"title": "Tampered Deliverable"}),
            (f"/api/deliverables/{did}", "DELETE", None),
            (f"/api/projects/{pid}/risks", "GET", None),
            (f"/api/projects/{pid}/risks", "POST", {"description": "Intruder Risk"}),
            (f"/api/risks/{rid}", "PUT", {"description": "Tampered Risk"}),
            (f"/api/risks/{rid}", "DELETE", None),
            (f"/api/projects/{pid}/sprints", "GET", None),
            (f"/api/projects/{pid}/sprints", "POST", {"name": "Intruder Sprint"}),
            (f"/api/projects/{pid}/sprints/{sid}", "PUT", {"name": "Tampered Sprint"}),
            (f"/api/projects/{pid}/sprints/{sid}", "DELETE", None),
            (f"/api/projects/{pid}/milestones", "GET", None),
            (f"/api/projects/{pid}/milestones", "POST", {"title": "Intruder Milestone", "due_date": "2026-12-31"}),
            (f"/api/projects/{pid}/milestones/{mid}", "PUT", {"title": "Tampered Milestone"}),
            (f"/api/projects/{pid}/milestones/{mid}", "DELETE", None),
            (f"/api/projects/{pid}/members", "GET", None),
            (f"/api/projects/{pid}/analytics", "GET", None),
            (f"/api/projects/{pid}/activity", "GET", None),
            (f"/api/projects/{pid}/export", "GET", None),
            (f"/api/projects/{pid}/cumulative-report", "GET", None),
        ]

        for path, method, payload in endpoints:
            code, resp = wsgi_call(path, method, body=payload, token=unauthorized_token)
            self.assertEqual(code, 403, f"Expected 403 for {method} {path}, got {code}: {resp}")
            self.assertIn("error", resp)

    def test_05_multi_owner_comma_separated_list(self):
        """A project with comma-separated owners ('owner_amit, owner_priya') should be accessible to both."""
        with get_db() as conn:
            c = conn.execute("""
                INSERT INTO projects (name, project_owner, project_manager, color, created_at, updated_at)
                VALUES ('Shared Innovation Lab', 'owner_amit, owner_priya', 'owner_amit, owner_priya', '#6366F1', '2026-11-06', '2026-11-06')
            """)
            shared_pid = c.lastrowid

        # Owner Amit can see and access
        _, amit_projects = wsgi_call("/api/projects", "GET", token=self.owner_amit_token)
        self.assertIn(shared_pid, {p["id"] for p in amit_projects})
        code_amit, _ = wsgi_call(f"/api/projects/{shared_pid}", "GET", token=self.owner_amit_token)
        self.assertEqual(code_amit, 200)

        # Owner Priya can see and access
        _, priya_projects = wsgi_call("/api/projects", "GET", token=self.owner_priya_token)
        self.assertIn(shared_pid, {p["id"] for p in priya_projects})
        code_priya, _ = wsgi_call(f"/api/projects/{shared_pid}", "GET", token=self.owner_priya_token)
        self.assertEqual(code_priya, 200)

    def test_06_project_creation_sets_owner(self):
        """When a user creates a new project without specifying owner, it defaults to them."""
        code, created_proj = wsgi_call("/api/projects", "POST", {
            "name": "Amit New Project",
            "description": "Created by Amit"
        }, token=self.amit_token)
        self.assertEqual(code, 201)
        new_id = created_proj["id"]

        # Owner should be amit
        self.assertEqual(created_proj.get("project_owner"), "amit")

        # Creator (Amit) can access it
        c_amit, _ = wsgi_call(f"/api/projects/{new_id}", "GET", token=self.amit_token)
        self.assertEqual(c_amit, 200)

        # Other PM (Priya) can access it because PM has unrestricted access
        c_priya, _ = wsgi_call(f"/api/projects/{new_id}", "GET", token=self.priya_token)
        self.assertEqual(c_priya, 200)

        # Non-PM assigned user (Owner Priya) cannot access it
        c_other, _ = wsgi_call(f"/api/projects/{new_id}", "GET", token=self.owner_priya_token)
        self.assertEqual(c_other, 403)

    def test_07_unassigned_lead_and_assignee_see_all_projects(self):
        """Lead users or assignees not assigned to any project should access all projects as usual."""
        code, all_projects = wsgi_call("/api/projects", "GET", token=self.admin_token)
        self.assertEqual(code, 200)
        all_ids = {p["id"] for p in all_projects}
        self.assertGreater(len(all_ids), 0)

        # 1. Unassigned Lead sees all projects
        code_lead, lead_projects = wsgi_call("/api/projects", "GET", token=self.unassigned_lead_token)
        self.assertEqual(code_lead, 200)
        lead_ids = {p["id"] for p in lead_projects}
        self.assertEqual(lead_ids, all_ids)

        # Unassigned Lead can fetch direct project details and tasks
        for pid in list(all_ids)[:3]:
            c_p, _ = wsgi_call(f"/api/projects/{pid}", "GET", token=self.unassigned_lead_token)
            self.assertEqual(c_p, 200)
            c_t, _ = wsgi_call(f"/api/projects/{pid}/tasks", "GET", token=self.unassigned_lead_token)
            self.assertEqual(c_t, 200)

        # 2. Unassigned Assignee sees all projects
        code_asg, asg_projects = wsgi_call("/api/projects", "GET", token=self.unassigned_assignee_token)
        self.assertEqual(code_asg, 200)
        asg_ids = {p["id"] for p in asg_projects}
        self.assertEqual(asg_ids, all_ids)

        # Unassigned Assignee can fetch direct project details and tasks
        for pid in list(all_ids)[:3]:
            c_p, _ = wsgi_call(f"/api/projects/{pid}", "GET", token=self.unassigned_assignee_token)
            self.assertEqual(c_p, 200)
            c_t, _ = wsgi_call(f"/api/projects/{pid}/tasks", "GET", token=self.unassigned_assignee_token)
            self.assertEqual(c_t, 200)

        # 3. Unassigned Lead and Assignee see all projects in bootstrap
        code_b_lead, b_lead = wsgi_call("/api/bootstrap", "GET", token=self.unassigned_lead_token)
        self.assertEqual(code_b_lead, 200)
        self.assertEqual({p["id"] for p in b_lead.get("projects", [])}, all_ids)

    def test_08_assigned_lead_restricted_to_assigned_project(self):
        """If a lead user IS assigned to a project, they should only see their assigned project."""
        with get_db() as conn:
            conn.execute("DELETE FROM projects WHERE project_owner = 'assigned_lead' OR name = 'Lead Dedicated Project'")
            c = conn.execute("""
                INSERT INTO projects (name, project_owner, project_manager, color, created_at, updated_at)
                VALUES ('Lead Dedicated Project', 'assigned_lead', 'assigned_lead', '#14B8A6', '2026-11-06', '2026-11-06')
            """)
            lead_pid = c.lastrowid

        code, lead_projects = wsgi_call("/api/projects", "GET", token=self.assigned_lead_token)
        self.assertEqual(code, 200)
        lead_ids = {p["id"] for p in lead_projects}

        # Must only see the dedicated project
        self.assertEqual(lead_ids, {lead_pid})

        # Can access their dedicated project
        c_ok, _ = wsgi_call(f"/api/projects/{lead_pid}", "GET", token=self.assigned_lead_token)
        self.assertEqual(c_ok, 200)

        # Blocked from accessing other projects
        code, all_projects = wsgi_call("/api/projects", "GET", token=self.admin_token)
        other_pids = [p["id"] for p in all_projects if p["id"] != lead_pid]
        if other_pids:
            c_blocked, _ = wsgi_call(f"/api/projects/{other_pids[0]}", "GET", token=self.assigned_lead_token)
            self.assertEqual(c_blocked, 403)


if __name__ == '__main__':
    unittest.main()
