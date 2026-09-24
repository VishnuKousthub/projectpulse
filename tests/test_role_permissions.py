"""
Unit Tests for Role-Based Access Control (RBAC) in ProjectPulse
Validates permissions for:
- Admin (Full Access)
- Project Manager (Full Access)
- Team Lead (Restricted - Progress update only)
- Assignee (Restricted - Progress update only)
"""

import io
import json
import os
import unittest
import sys

# Ensure scratch root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.database import init_db, get_db
from app.seed import seed_database
from app.main import app


class TestRolePermissions(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        seed_database()

    def setUp(self):
        self.admin_token = self._login('admin', 'admin123')
        self.pm_token = self._login('pm', 'pm123')
        self.lead_token = self._login('lead', 'lead123')
        self.assignee_token = self._login('assignee', 'assignee123')

    def _request(self, path, method="GET", body=None, token=None):
        if body is not None:
            body_bytes = json.dumps(body).encode("utf-8")
        else:
            body_bytes = b""

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
            "QUERY_STRING": "",
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

        response_body_chunks = app(env, start_response)
        response_body = b"".join(response_body_chunks)
        status_code = int(status_holder[0].split()[0])

        try:
            json_data = json.loads(response_body.decode("utf-8"))
        except Exception:
            json_data = response_body.decode("utf-8", errors="replace")

        return status_code, json_data

    def _login(self, username, password):
        status, data = self._request("/api/auth/login", method="POST", body={"username": username, "password": password})
        self.assertEqual(status, 200, f"Login failed for {username}: {data}")
        self.assertIn("token", data)
        return data["token"]

    # 1. Test Auth info and roles
    def test_01_auth_roles_metadata(self):
        for role, token, expected_full, expected_prog in [
            ("admin", self.admin_token, True, False),
            ("pm", self.pm_token, True, False),
            ("lead", self.lead_token, False, True),
            ("assignee", self.assignee_token, False, True),
        ]:
            status, data = self._request("/api/auth/me", token=token)
            self.assertEqual(status, 200)
            self.assertEqual(data["role"], role)
            self.assertEqual(data["is_full_access"], expected_full)
            self.assertEqual(data["is_progress_only"], expected_prog)

    # 2. Test Lead/Assignee can update progress_pct and actual_hours
    def test_02_lead_and_assignee_can_update_progress(self):
        # First get existing tasks
        status, tasks = self._request("/api/projects/1/tasks", token=self.lead_token)
        self.assertEqual(status, 200)
        self.assertTrue(len(tasks) > 0)
        target_task = tasks[0]
        task_id = target_task["id"]

        # Lead updates progress_pct to 45% and actual_hours to 12.5
        status_lead, data_lead = self._request(
            f"/api/tasks/{task_id}",
            method="PUT",
            token=self.lead_token,
            body={"progress_pct": 45, "actual_hours": 12.5}
        )
        self.assertEqual(status_lead, 200, f"Lead update progress failed: {data_lead}")
        self.assertEqual(data_lead["progress_pct"], 45)
        self.assertEqual(data_lead["actual_hours"], 12.5)

        # Assignee updates progress_pct to 80% and actual_hours to 18.0
        status_ass, data_ass = self._request(
            f"/api/tasks/{task_id}",
            method="PUT",
            token=self.assignee_token,
            body={"progress_pct": 80, "actual_hours": 18.0}
        )
        self.assertEqual(status_ass, 200, f"Assignee update progress failed: {data_ass}")
        self.assertEqual(data_ass["progress_pct"], 80)
        self.assertEqual(data_ass["actual_hours"], 18.0)

    # 3. Test Lead/Assignee CANNOT change status (Returns 403 Forbidden)
    def test_03_lead_and_assignee_forbidden_status_change(self):
        status, tasks = self._request("/api/projects/1/tasks", token=self.lead_token)
        target_task = tasks[0]
        task_id = target_task["id"]
        current_status = target_task["status"]
        new_status = "done" if current_status != "done" else "in_progress"

        # Lead attempt to change status
        status_lead, data_lead = self._request(
            f"/api/tasks/{task_id}",
            method="PUT",
            token=self.lead_token,
            body={"status": new_status, "progress_pct": 90}
        )
        self.assertEqual(status_lead, 403)
        self.assertIn("Permission Denied", data_lead["error"])

        # Assignee attempt to change status
        status_ass, data_ass = self._request(
            f"/api/tasks/{task_id}",
            method="PUT",
            token=self.assignee_token,
            body={"status": new_status, "progress_pct": 90}
        )
        self.assertEqual(status_ass, 403)
        self.assertIn("Permission Denied", data_ass["error"])

    # 4. Test Lead/Assignee CANNOT create or delete tasks (403 Forbidden)
    def test_04_lead_and_assignee_forbidden_task_create_delete(self):
        # Attempt task creation by Lead
        status_l_create, _ = self._request(
            "/api/projects/1/tasks",
            method="POST",
            token=self.lead_token,
            body={"title": "Unauthorized Task by Lead", "status": "todo"}
        )
        self.assertEqual(status_l_create, 403)

        # Attempt task creation by Assignee
        status_a_create, _ = self._request(
            "/api/projects/1/tasks",
            method="POST",
            token=self.assignee_token,
            body={"title": "Unauthorized Task by Assignee", "status": "todo"}
        )
        self.assertEqual(status_a_create, 403)

        # Attempt task deletion by Lead
        status_l_del, _ = self._request("/api/tasks/1", method="DELETE", token=self.lead_token)
        self.assertEqual(status_l_del, 403)

        # Attempt task deletion by Assignee
        status_a_del, _ = self._request("/api/tasks/1", method="DELETE", token=self.assignee_token)
        self.assertEqual(status_a_del, 403)

    # 5. Test Lead/Assignee CANNOT manage resources or project settings (403 Forbidden)
    def test_05_lead_and_assignee_forbidden_resource_and_project_management(self):
        for token, role_name in [(self.lead_token, "Lead"), (self.assignee_token, "Assignee")]:
            # Create project
            status_p, _ = self._request("/api/projects", method="POST", token=token, body={"name": "Forbidden Proj"})
            self.assertEqual(status_p, 403, f"{role_name} should be blocked from project creation")

            # Create resource
            status_r, _ = self._request("/api/resources", method="POST", token=token, body={"name": "Forbidden Res", "type": "Manager"})
            self.assertEqual(status_r, 403, f"{role_name} should be blocked from resource creation")

            # Map project resource
            status_map, _ = self._request("/api/projects/1/resources", method="POST", token=token, body={"resource_id": 1, "allocation_pct": 50})
            self.assertEqual(status_map, 403, f"{role_name} should be blocked from resource mapping")

            # Unmap project resource
            status_unmap, _ = self._request("/api/projects/1/resources/1", method="DELETE", token=token)
            self.assertEqual(status_unmap, 403, f"{role_name} should be blocked from unmapping resources")

    # 6. Test Admin & PM have full access control
    def test_06_admin_and_pm_full_access(self):
        for token, role_name in [(self.admin_token, "Admin"), (self.pm_token, "PM")]:
            # Can create task
            status_c, t_data = self._request(
                "/api/projects/1/tasks",
                method="POST",
                token=token,
                body={
                    "title": f"Task by {role_name}",
                    "status": "todo",
                    "priority": "high",
                    "estimated_hours": 10
                }
            )
            self.assertIn(status_c, [200, 201], f"{role_name} failed to create task: {t_data}")
            new_task_id = t_data["id"]

            # Can change status
            status_u, u_data = self._request(
                f"/api/tasks/{new_task_id}",
                method="PUT",
                token=token,
                body={
                    "status": "in_progress",
                    "progress_pct": 50,
                    "title": f"Task by {role_name} (Updated)"
                }
            )
            self.assertEqual(status_u, 200, f"{role_name} failed to update status: {u_data}")
            self.assertEqual(u_data["status"], "in_progress")
            self.assertEqual(u_data["progress_pct"], 50)

            # Can delete task
            status_d, _ = self._request(f"/api/tasks/{new_task_id}", method="DELETE", token=token)
            self.assertEqual(status_d, 200, f"{role_name} failed to delete task")


if __name__ == "__main__":
    unittest.main()
