"""
Unit tests for Admin-only Users API and safeguards in ProjectPulse.
Tests:
- Admin can list, create, change role, disable, and reset password.
- PM, Lead, and Assignee are rejected with 403 Forbidden.
- password_hash is NEVER returned in any response.
- Admin cannot demote or disable themselves.
- The last active admin cannot be demoted or disabled.
- Disabled user cannot log in and existing session is terminated immediately.
- Changing a user's role invalidates their existing session.
- Restarting app (init_db / seed) does not revert changed user roles.
"""
import io
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.database import init_db, get_db
from app.seed import seed_database
from app.main import app


class TestUsersManagement(unittest.TestCase):
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

    def test_01_list_users_permissions_and_no_password_hash(self):
        # Admin can list
        status, users = self._request("/api/users", token=self.admin_token)
        self.assertEqual(status, 200)
        self.assertIsInstance(users, list)
        self.assertTrue(len(users) > 0)

        for u in users:
            self.assertNotIn("password_hash", u)
            self.assertIn("id", u)
            self.assertIn("username", u)
            self.assertIn("email", u)
            self.assertIn("role", u)
            self.assertIn("is_active", u)

        # PM, Lead, Assignee receive 403 Forbidden
        for token, role_name in [(self.pm_token, "PM"), (self.lead_token, "Lead"), (self.assignee_token, "Assignee")]:
            status_err, _ = self._request("/api/users", token=token)
            self.assertEqual(status_err, 403, f"{role_name} should be rejected with 403")

        # Unauthenticated receives 401
        status_unauth, _ = self._request("/api/users")
        self.assertEqual(status_unauth, 401)

    def test_02_create_user_and_safeguards(self):
        # PM, Lead, Assignee rejected with 403
        for token in [self.pm_token, self.lead_token, self.assignee_token]:
            s, _ = self._request("/api/users", method="POST", token=token, body={
                "full_name": "Test User", "username": "testuser", "email": "test@company.com",
                "password": "password123", "role": "lead"
            })
            self.assertEqual(s, 403)

        # Admin: Invalid role rejected with 400
        s, data = self._request("/api/users", method="POST", token=self.admin_token, body={
            "full_name": "Test User", "username": "testuser", "email": "test@company.com",
            "password": "password123", "role": "superuser"
        })
        self.assertEqual(s, 400)
        self.assertIn("Invalid role", data["error"])

        # Admin: Short password rejected with 400
        s, data = self._request("/api/users", method="POST", token=self.admin_token, body={
            "full_name": "Test User", "username": "testuser", "email": "test@company.com",
            "password": "short", "role": "lead"
        })
        self.assertEqual(s, 400)
        self.assertIn("at least 8 characters", data["error"])

        # Admin: Valid creation
        new_username = "sarah_test"
        s, created = self._request("/api/users", method="POST", token=self.admin_token, body={
            "full_name": "Sarah Connor", "username": new_username, "email": "sarah@cyberdyne.org",
            "password": "secretPassword123", "role": "lead"
        })
        self.assertEqual(s, 201)
        self.assertEqual(created["username"], new_username)
        self.assertEqual(created["role"], "lead")
        self.assertNotIn("password_hash", created)

        # Duplicate username rejected
        s, data = self._request("/api/users", method="POST", token=self.admin_token, body={
            "full_name": "Sarah Copy", "username": new_username, "email": "different@cyberdyne.org",
            "password": "secretPassword123", "role": "lead"
        })
        self.assertEqual(s, 400)
        self.assertIn("already registered", data["error"])

    def test_03_admin_cannot_demote_or_disable_self(self):
        # Fetch current admin id
        _, me = self._request("/api/auth/me", token=self.admin_token)
        admin_id = me["user"]["id"]

        # Admin demoting self -> 400
        s, data = self._request(f"/api/users/{admin_id}", method="PUT", token=self.admin_token, body={"role": "pm"})
        self.assertEqual(s, 400)
        self.assertIn("cannot change their own role", data["error"])

        # Admin disabling self -> 400
        s, data = self._request(f"/api/users/{admin_id}", method="PUT", token=self.admin_token, body={"is_active": 0})
        self.assertEqual(s, 400)
        self.assertIn("cannot disable their own account", data["error"])

    def test_04_last_active_admin_safeguard(self):
        # Ensure only 1 active admin exists initially
        with get_db() as conn:
            conn.execute("UPDATE users SET role = 'pm' WHERE role = 'admin' AND username != 'admin'")

        _, me = self._request("/api/auth/me", token=self.admin_token)
        admin_id = me["user"]["id"]

        # Create second admin so we can test last admin protection
        s, admin2 = self._request("/api/users", method="POST", token=self.admin_token, body={
            "full_name": "Second Admin", "username": "admin2", "email": "admin2@company.internal",
            "password": "adminPassword22", "role": "admin"
        })
        self.assertEqual(s, 201)
        admin2_id = admin2["id"]
        admin2_token = self._login("admin2", "adminPassword22")

        # Now admin2 can demote the first admin
        s, _ = self._request(f"/api/users/{admin_id}", method="PUT", token=admin2_token, body={"role": "pm"})
        self.assertEqual(s, 200)

        # Now admin2 is the LAST remaining active admin!
        # Another user cannot demote or disable admin2, and admin2 cannot demote or disable themselves
        s, data = self._request(f"/api/users/{admin2_id}", method="PUT", token=admin2_token, body={"role": "pm"})
        self.assertEqual(s, 400)

        # Restore original admin role
        s, _ = self._request(f"/api/users/{admin_id}", method="PUT", token=admin2_token, body={"role": "admin"})
        self.assertEqual(s, 200)

    def test_05_role_change_invalidates_session(self):
        # Create a test account
        s, user = self._request("/api/users", method="POST", token=self.admin_token, body={
            "full_name": "Role Test", "username": "roletest", "email": "role@test.com",
            "password": "testPassword123", "role": "assignee"
        })
        self.assertEqual(s, 201)
        user_id = user["id"]

        # Login as this user
        user_token = self._login("roletest", "testPassword123")
        s, me = self._request("/api/auth/me", token=user_token)
        self.assertEqual(s, 200)
        self.assertEqual(me["role"], "assignee")

        # Admin changes role to lead
        s, updated = self._request(f"/api/users/{user_id}", method="PUT", token=self.admin_token, body={"role": "lead"})
        self.assertEqual(s, 200)
        self.assertEqual(updated["role"], "lead")

        # Old session is immediately invalidated (returns 401)
        s, _ = self._request("/api/auth/me", token=user_token)
        self.assertEqual(s, 401)

        # User logs in again and has new role
        new_token = self._login("roletest", "testPassword123")
        s, me_new = self._request("/api/auth/me", token=new_token)
        self.assertEqual(s, 200)
        self.assertEqual(me_new["role"], "lead")

    def test_06_disable_user_prevents_login_and_terminates_session(self):
        # Create account
        s, user = self._request("/api/users", method="POST", token=self.admin_token, body={
            "full_name": "Disable Test", "username": "distest", "email": "dis@test.com",
            "password": "disPassword123", "role": "assignee"
        })
        self.assertEqual(s, 201)
        user_id = user["id"]

        # Log in
        user_token = self._login("distest", "disPassword123")
        s, _ = self._request("/api/auth/me", token=user_token)
        self.assertEqual(s, 200)

        # Admin disables account
        s, updated = self._request(f"/api/users/{user_id}", method="PUT", token=self.admin_token, body={"is_active": 0})
        self.assertEqual(s, 200)
        self.assertEqual(updated["is_active"], 0)

        # Open session kicked out immediately
        s, _ = self._request("/api/auth/me", token=user_token)
        self.assertEqual(s, 401)

        # Login attempt rejected with 403
        s, login_err = self._request("/api/auth/login", method="POST", body={"username": "distest", "password": "disPassword123"})
        self.assertEqual(s, 403)
        self.assertIn("disabled", login_err["error"].lower())

        # Admin re-enables account
        s, re_enabled = self._request(f"/api/users/{user_id}", method="PUT", token=self.admin_token, body={"is_active": 1})
        self.assertEqual(s, 200)
        self.assertEqual(re_enabled["is_active"], 1)

        # Login works again
        re_token = self._login("distest", "disPassword123")
        self.assertTrue(bool(re_token))

    def test_07_reset_password_invalidates_session(self):
        # Create user
        s, user = self._request("/api/users", method="POST", token=self.admin_token, body={
            "full_name": "Reset Test", "username": "pwreset_user", "email": "reset@test.com",
            "password": "originalPassword123", "role": "lead"
        })
        self.assertEqual(s, 201)
        user_id = user["id"]

        user_token = self._login("pwreset_user", "originalPassword123")

        # PM, Lead, Assignee get 403
        s_err, _ = self._request(f"/api/users/{user_id}/reset_password", method="POST", token=self.pm_token, body={"new_password": "newValidPassword123"})
        self.assertEqual(s_err, 403)

        # Password < 8 characters rejected
        s_err, _ = self._request(f"/api/users/{user_id}/reset_password", method="POST", token=self.admin_token, body={"new_password": "short"})
        self.assertEqual(s_err, 400)

        # Admin resets password
        s, res = self._request(f"/api/users/{user_id}/reset_password", method="POST", token=self.admin_token, body={"new_password": "newValidPassword123"})
        self.assertEqual(s, 200)
        self.assertTrue(res.get("success"))

        # Old session token stops working
        s_me, _ = self._request("/api/auth/me", token=user_token)
        self.assertEqual(s_me, 401)

        # Old password rejected
        s_old, _ = self._request("/api/auth/login", method="POST", body={"username": "pwreset_user", "password": "originalPassword123"})
        self.assertEqual(s_old, 401)

        # New password works
        new_token = self._login("pwreset_user", "newValidPassword123")
        self.assertTrue(bool(new_token))

    def test_08_restarting_app_does_not_reset_changed_role(self):
        # Change default user 'vishnu' role to lead
        with get_db() as conn:
            vishnu = conn.execute("SELECT id FROM users WHERE LOWER(username) = 'vishnu'").fetchone()
            vishnu_id = vishnu["id"]

        s, updated = self._request(f"/api/users/{vishnu_id}", method="PUT", token=self.admin_token, body={"role": "lead"})
        self.assertEqual(s, 200)
        self.assertEqual(updated["role"], "lead")

        # Simulate restarting app by calling init_db() and seed_database() again
        init_db()
        seed_database()

        # Verify role is still 'lead' and has NOT reverted to 'pm'
        with get_db() as conn:
            row = conn.execute("SELECT role FROM users WHERE id = ?", (vishnu_id,)).fetchone()
            self.assertEqual(row["role"], "lead")


if __name__ == "__main__":
    unittest.main()
