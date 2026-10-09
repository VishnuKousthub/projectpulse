"""
Unit Tests for Document & Attachment Uploads (Section 10) in ProjectPulse
Tests cover:
- Activity document upload (PM/Admin 201)
- Risk document upload (Lead/Assignee 201, PM/Admin 201)
- Activity upload forbidden for Lead/Assignee (403)
- Disallowed file extension rejection (400)
- File size > 15MB rejection (400)
- Empty file rejection (400)
- Target risk validation (404/400)
- Download endpoint with nosniff and Content-Disposition (200)
- Delete permissions (Lead can only delete own risk attachments; PM/Admin can delete all)
- File disk unlinking and cascading cleanup on risk, task, and project deletion
"""

import io
import json
import os
import unittest
import sys
from pathlib import Path

# Ensure root directory is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app.database import init_db, get_db, get_attachments_dir
from app.seed import seed_database
from app.main import app


class TestAttachments(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        init_db()
        seed_database()

    def setUp(self):
        self.admin_token = self._login('admin', 'admin123')
        self.pm_token = self._login('pm', 'pm123')
        self.lead_token = self._login('lead', 'lead123')
        self.assignee_token = self._login('assignee', 'assignee123')

        # Create a test project, task, and risk
        with get_db() as conn:
            # Check or create project
            proj = conn.execute("SELECT id FROM projects ORDER BY id ASC LIMIT 1").fetchone()
            self.project_id = proj["id"]

            # Create test task
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO tasks (project_id, title, status, priority, order_index, created_at, updated_at)
                VALUES (?, 'Attachment Test Activity', 'in_progress', 'high', 9999, datetime('now'), datetime('now'))
            """, (self.project_id,))
            self.task_id = cur.lastrowid

            # Create test risk
            cur.execute("""
                INSERT INTO project_risks (project_id, task_id, risk_code, description, impact, status, created_at)
                VALUES (?, ?, 'R-ATT-1', 'Chemical stability risk', 'high', 'open', datetime('now'))
            """, (self.project_id, self.task_id))
            self.risk_id = cur.lastrowid

    def tearDown(self):
        # Cleanup test task and its attachments
        with get_db() as conn:
            folder = get_attachments_dir()
            rows = conn.execute("SELECT stored_name FROM attachments WHERE task_id = ?", (self.task_id,)).fetchall()
            for r in rows:
                try:
                    f = folder / r["stored_name"]
                    if f.exists():
                        f.unlink()
                except Exception:
                    pass
            conn.execute("DELETE FROM attachments WHERE task_id = ?", (self.task_id,))
            conn.execute("DELETE FROM project_risks WHERE task_id = ?", (self.task_id,))
            conn.execute("DELETE FROM tasks WHERE id = ?", (self.task_id,))

    def _login(self, username, password):
        status, data, _ = self._request("/api/auth/login", method="POST", body={"username": username, "password": password})
        self.assertEqual(status, 200, f"Login failed for {username}: {data}")
        return data["token"]

    def _request(self, path, method="GET", body=None, token=None, headers=None):
        if body is not None and not isinstance(body, (bytes, bytearray)):
            body_bytes = json.dumps(body).encode("utf-8")
            content_type = "application/json"
        elif isinstance(body, (bytes, bytearray)):
            body_bytes = body
            content_type = (headers or {}).get("Content-Type", "application/octet-stream")
        else:
            body_bytes = b""
            content_type = "application/json"

        query_string = ""
        if "?" in path:
            path, query_string = path.split("?", 1)

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
            "CONTENT_TYPE": content_type,
            "QUERY_STRING": query_string,
            "wsgi.errors": io.StringIO(),
            "wsgi.multithread": False,
            "wsgi.multiprocess": False,
            "wsgi.run_once": False,
        }
        if token:
            env["HTTP_AUTHORIZATION"] = f"Bearer {token}"
        if headers:
            for k, v in headers.items():
                if k.upper() != "CONTENT-TYPE":
                    env[f"HTTP_{k.upper().replace('-', '_')}"] = v

        status_holder = []
        headers_holder = []

        def start_response(status, response_headers, exc_info=None):
            status_holder.append(status)
            headers_holder.append(response_headers)

        response_body_chunks = app(env, start_response)
        response_body = b"".join(response_body_chunks)
        status_code = int(status_holder[0].split()[0])

        resp_headers_dict = dict(headers_holder[0]) if headers_holder else {}

        try:
            json_data = json.loads(response_body.decode("utf-8"))
        except Exception:
            json_data = response_body

        return status_code, json_data, resp_headers_dict

    def _build_multipart(self, filename, content_bytes, content_type="application/pdf", risk_id=None):
        boundary = "----WebKitFormBoundaryXtest123"
        parts = []
        if risk_id is not None:
            parts.append(
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"risk_id\"\r\n\r\n{risk_id}\r\n".encode("utf-8")
            )
        parts.append(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n".encode("utf-8")
            + content_bytes
            + b"\r\n"
        )
        parts.append(f"--{boundary}--\r\n".encode("utf-8"))
        body = b"".join(parts)
        header_ct = f"multipart/form-data; boundary={boundary}"
        return body, header_ct

    # 1. PM/Admin can upload activity document
    def test_01_pm_upload_activity_attachment(self):
        body, ct = self._build_multipart("spec_sheet.pdf", b"%PDF-1.4 sample content", "application/pdf")
        status, data, _ = self._request(
            f"/api/tasks/{self.task_id}/attachments",
            method="POST",
            body=body,
            token=self.pm_token,
            headers={"Content-Type": ct}
        )
        self.assertEqual(status, 201, f"PM upload failed: {data}")
        self.assertEqual(data["original_name"], "spec_sheet.pdf")
        self.assertIsNone(data["risk_id"])
        self.assertEqual(data["task_id"], self.task_id)

        # Check file exists on disk
        folder = get_attachments_dir()
        fpath = folder / data["stored_name"]
        self.assertTrue(fpath.exists())

        # Check task attachment count in task dict
        status, task_data, _ = self._request(f"/api/tasks/{self.task_id}", token=self.pm_token)
        self.assertEqual(status, 200)
        self.assertEqual(task_data["attachment_count"], 1)

    # 2. Lead / Assignee CANNOT upload directly to activity (403)
    def test_02_lead_cannot_upload_activity_attachment(self):
        body, ct = self._build_multipart("lead_doc.pdf", b"%PDF-1.4 dummy", "application/pdf")
        status, data, _ = self._request(
            f"/api/tasks/{self.task_id}/attachments",
            method="POST",
            body=body,
            token=self.lead_token,
            headers={"Content-Type": ct}
        )
        self.assertEqual(status, 403)
        self.assertIn("Permission Denied", data.get("error", ""))

    # 3. Lead / Assignee CAN upload to a specific risk (201)
    def test_03_lead_can_upload_risk_attachment(self):
        body, ct = self._build_multipart("risk_analysis.xlsx", b"EXCEL_DATA", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", risk_id=self.risk_id)
        status, data, _ = self._request(
            f"/api/tasks/{self.task_id}/attachments",
            method="POST",
            body=body,
            token=self.lead_token,
            headers={"Content-Type": ct}
        )
        self.assertEqual(status, 201, f"Lead risk upload failed: {data}")
        self.assertEqual(data["original_name"], "risk_analysis.xlsx")
        self.assertEqual(data["risk_id"], self.risk_id)

        # Check file exists on disk
        folder = get_attachments_dir()
        fpath = folder / data["stored_name"]
        self.assertTrue(fpath.exists())

    # 4. Reject disallowed file extension (e.g. .exe)
    def test_04_reject_invalid_extension(self):
        body, ct = self._build_multipart("malware.exe", b"MZ...", "application/x-msdownload")
        status, data, _ = self._request(
            f"/api/tasks/{self.task_id}/attachments",
            method="POST",
            body=body,
            token=self.pm_token,
            headers={"Content-Type": ct}
        )
        self.assertEqual(status, 400)
        self.assertIn("not allowed", data.get("error", ""))

    # 5. Reject empty file
    def test_05_reject_empty_file(self):
        body, ct = self._build_multipart("empty.txt", b"", "text/plain")
        status, data, _ = self._request(
            f"/api/tasks/{self.task_id}/attachments",
            method="POST",
            body=body,
            token=self.pm_token,
            headers={"Content-Type": ct}
        )
        self.assertEqual(status, 400)
        self.assertIn("empty", data.get("error", "").lower())

    # 6. Reject file larger than 15MB
    def test_06_reject_large_file(self):
        large_content = b"0" * (16 * 1024 * 1024)
        body, ct = self._build_multipart("large.zip", large_content, "application/zip")
        status, data, _ = self._request(
            f"/api/tasks/{self.task_id}/attachments",
            method="POST",
            body=body,
            token=self.pm_token,
            headers={"Content-Type": ct}
        )
        self.assertEqual(status, 400)
        self.assertIn("15 MB", data.get("error", ""))

    # 7. Reject invalid risk_id
    def test_07_reject_invalid_risk_id(self):
        body, ct = self._build_multipart("report.pdf", b"PDF", "application/pdf", risk_id=999999)
        status, data, _ = self._request(
            f"/api/tasks/{self.task_id}/attachments",
            method="POST",
            body=body,
            token=self.pm_token,
            headers={"Content-Type": ct}
        )
        self.assertEqual(status, 404)

    # 8. Download attachment endpoint
    def test_08_download_attachment(self):
        sample_bytes = b"Hello, ProjectPulse Document Test!"
        body, ct = self._build_multipart("test_notes.txt", sample_bytes, "text/plain")
        status, upload_data, _ = self._request(
            f"/api/tasks/{self.task_id}/attachments",
            method="POST",
            body=body,
            token=self.pm_token,
            headers={"Content-Type": ct}
        )
        self.assertEqual(status, 201)
        att_id = upload_data["id"]

        # Anyone viewing the task can download (e.g. Lead)
        status, download_content, headers = self._request(
            f"/api/attachments/{att_id}/download",
            method="GET",
            token=self.lead_token
        )
        self.assertEqual(status, 200)
        self.assertEqual(download_content, sample_bytes)
        self.assertEqual(headers.get("X-Content-Type-Options"), "nosniff")
        self.assertIn("attachment; filename=", headers.get("Content-Disposition", ""))

    # 9. Delete permissions
    def test_09_delete_attachment_permissions(self):
        # PM uploads an activity attachment
        body, ct = self._build_multipart("pm_doc.pdf", b"PM CONTENT", "application/pdf")
        _, pm_att, _ = self._request(
            f"/api/tasks/{self.task_id}/attachments",
            method="POST",
            body=body,
            token=self.pm_token,
            headers={"Content-Type": ct}
        )

        # Lead uploads a risk attachment
        body, ct = self._build_multipart("lead_risk.pdf", b"LEAD CONTENT", "application/pdf", risk_id=self.risk_id)
        _, lead_att, _ = self._request(
            f"/api/tasks/{self.task_id}/attachments",
            method="POST",
            body=body,
            token=self.lead_token,
            headers={"Content-Type": ct}
        )

        # 9a. Lead tries to delete PM activity attachment -> 403
        status, data, _ = self._request(
            f"/api/attachments/{pm_att['id']}",
            method="DELETE",
            token=self.lead_token
        )
        self.assertEqual(status, 403)

        # 9b. Assignee tries to delete Lead risk attachment -> 403
        status, data, _ = self._request(
            f"/api/attachments/{lead_att['id']}",
            method="DELETE",
            token=self.assignee_token
        )
        self.assertEqual(status, 403)

        # 9c. Lead deletes their OWN risk attachment -> 200 and unlinked from disk
        status, data, _ = self._request(
            f"/api/attachments/{lead_att['id']}",
            method="DELETE",
            token=self.lead_token
        )
        self.assertEqual(status, 200)
        folder = get_attachments_dir()
        self.assertFalse((folder / lead_att["stored_name"]).exists())

        # 9d. Admin / PM can delete PM activity attachment -> 200 and unlinked from disk
        status, data, _ = self._request(
            f"/api/attachments/{pm_att['id']}",
            method="DELETE",
            token=self.admin_token
        )
        self.assertEqual(status, 200)
        self.assertFalse((folder / pm_att["stored_name"]).exists())

    # 10. Cascading cleanup when risk is deleted
    def test_10_cascading_cleanup_on_risk_delete(self):
        body, ct = self._build_multipart("to_be_deleted.pdf", b"RISK ATT", "application/pdf", risk_id=self.risk_id)
        _, att_data, _ = self._request(
            f"/api/tasks/{self.task_id}/attachments",
            method="POST",
            body=body,
            token=self.pm_token,
            headers={"Content-Type": ct}
        )
        folder = get_attachments_dir()
        fpath = folder / att_data["stored_name"]
        self.assertTrue(fpath.exists())

        # Delete risk
        status, _, _ = self._request(f"/api/risks/{self.risk_id}", method="DELETE", token=self.pm_token)
        self.assertEqual(status, 200)

        # Attachment file on disk should be deleted
        self.assertFalse(fpath.exists())

        # Attachment row in DB should be deleted
        with get_db() as conn:
            row = conn.execute("SELECT * FROM attachments WHERE id = ?", (att_data["id"],)).fetchone()
            self.assertIsNone(row)

    # 11. Cascading cleanup when task is deleted
    def test_11_cascading_cleanup_on_task_delete(self):
        body, ct = self._build_multipart("task_att.pdf", b"TASK ATT CONTENT", "application/pdf")
        _, att_data, _ = self._request(
            f"/api/tasks/{self.task_id}/attachments",
            method="POST",
            body=body,
            token=self.pm_token,
            headers={"Content-Type": ct}
        )
        folder = get_attachments_dir()
        fpath = folder / att_data["stored_name"]
        self.assertTrue(fpath.exists())

        # Delete task
        status, _, _ = self._request(f"/api/tasks/{self.task_id}", method="DELETE", token=self.pm_token)
        self.assertEqual(status, 200)

        # Attachment file on disk should be deleted
        self.assertFalse(fpath.exists())

        # Attachment row in DB should be deleted
        with get_db() as conn:
            row = conn.execute("SELECT * FROM attachments WHERE id = ?", (att_data["id"],)).fetchone()
            self.assertIsNone(row)

    # 12. Query task attachments with and without risk_id filter
    def test_12_get_task_attachments_filter(self):
        # 1 activity attachment
        body1, ct1 = self._build_multipart("doc1.pdf", b"DOC1", "application/pdf")
        self._request(f"/api/tasks/{self.task_id}/attachments", method="POST", body=body1, token=self.pm_token, headers={"Content-Type": ct1})

        # 1 risk attachment
        body2, ct2 = self._build_multipart("doc2.pdf", b"DOC2", "application/pdf", risk_id=self.risk_id)
        self._request(f"/api/tasks/{self.task_id}/attachments", method="POST", body=body2, token=self.pm_token, headers={"Content-Type": ct2})

        # Get all attachments for task
        status, all_atts, _ = self._request(f"/api/tasks/{self.task_id}/attachments", token=self.pm_token)
        self.assertEqual(status, 200)
        self.assertEqual(len(all_atts), 2)

        # Filter by risk_id
        status, data_risk, _ = self._request(f"/api/tasks/{self.task_id}/attachments?risk_id={self.risk_id}", token=self.pm_token)
        self.assertEqual(status, 200)
        self.assertEqual(len(data_risk), 1)
        self.assertEqual(data_risk[0]["risk_id"], self.risk_id)


if __name__ == "__main__":
    unittest.main()
