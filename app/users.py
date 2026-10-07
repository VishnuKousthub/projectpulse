"""
User management endpoints (Admin only).
Handles listing users, creating accounts, modifying roles/status,
and resetting passwords with strict admin-only authorization and safeguards.
"""
from app.database import hash_password

ALLOWED_ROLES = ("admin", "pm", "lead", "assignee")


def register(app, *, get_db, json_response, request, get_current_user,
             clean_text, get_now_iso):

    def require_admin():
        user = get_current_user()
        if not user:
            return None, json_response({"error": "Authentication required"}, status=401)
        role = str(user.get("role", "")).strip().lower()
        if role != "admin":
            return None, json_response({"error": "Forbidden: Admin access required"}, status=403)
        return user, None

    @app.get("/api/users")
    def list_users():
        user, err = require_admin()
        if err:
            return err
        with get_db() as conn:
            rows = conn.execute("""
                SELECT id, username, full_name, email, role,
                       COALESCE(is_active, 1) AS is_active,
                       last_login, created_at
                FROM users
                ORDER BY id ASC
            """).fetchall()
            return json_response([dict(r) for r in rows])

    @app.post("/api/users")
    def create_user():
        user, err = require_admin()
        if err:
            return err
        data = request.json or {}
        full_name = clean_text(data.get("full_name"))
        username = (data.get("username") or "").strip().lower()
        email = (data.get("email") or "").strip().lower()
        password = data.get("password") or ""
        role = (data.get("role") or "").strip().lower()

        if not full_name:
            return json_response({"error": "Full name is required"}, status=400)
        if not username or len(username) < 3:
            return json_response({"error": "Username must be at least 3 characters"}, status=400)
        if not email or "@" not in email:
            return json_response({"error": "Please provide a valid email address"}, status=400)
        if not password or len(password) < 8:
            return json_response({"error": "Password must be at least 8 characters"}, status=400)
        if role not in ALLOWED_ROLES:
            return json_response({"error": f"Invalid role. Role must be one of: {', '.join(ALLOWED_ROLES)}"}, status=400)

        avatar_colors = ["#3B82F6", "#8B5CF6", "#EC4899", "#10B981", "#F59E0B", "#06B6D4", "#6366F1"]
        avatar_color = avatar_colors[len(username) % len(avatar_colors)]
        pwd_hash = hash_password(password)
        now_str = get_now_iso()

        with get_db() as conn:
            existing = conn.execute("""
                SELECT username, email FROM users
                WHERE LOWER(username) = ? OR LOWER(email) = ?
            """, (username, email)).fetchone()

            if existing:
                if existing["username"].lower() == username:
                    return json_response({"error": "This username is already registered"}, status=400)
                else:
                    return json_response({"error": "An account with this email already exists"}, status=400)

            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO users (username, email, password_hash, full_name, role, avatar_color, is_active, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 1, ?)
            """, (username, email, pwd_hash, full_name, role, avatar_color, now_str))
            new_id = cursor.lastrowid

            created = conn.execute("""
                SELECT id, username, full_name, email, role,
                       COALESCE(is_active, 1) AS is_active,
                       last_login, created_at
                FROM users WHERE id = ?
            """, (new_id,)).fetchone()
            return json_response(dict(created), status=201)

    @app.put("/api/users/<user_id:int>")
    def update_user(user_id):
        current_admin, err = require_admin()
        if err:
            return err
        data = request.json or {}

        with get_db() as conn:
            target = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not target:
                return json_response({"error": "User not found"}, status=404)

            current_admin_id = current_admin["user_id"]
            target_id = target["id"]
            current_target_role = target["role"].lower()
            current_target_active = target["is_active"] if "is_active" in target.keys() and target["is_active"] is not None else 1

            new_role = str(data["role"]).strip().lower() if "role" in data else current_target_role
            new_active = int(data["is_active"]) if "is_active" in data else current_target_active

            # Safeguard 1: an admin cannot change their own role or disable their own account
            if target_id == current_admin_id:
                if "role" in data and new_role != current_target_role:
                    return json_response({"error": "Administrators cannot change their own role"}, status=400)
                if "is_active" in data and new_active == 0:
                    return json_response({"error": "Administrators cannot disable their own account"}, status=400)

            # Safeguard 2: the last remaining active admin can never be demoted or disabled
            is_active_admin = (current_target_role == "admin" and current_target_active == 1)
            is_being_demoted = (new_role != "admin")
            is_being_disabled = (new_active == 0)
            if is_active_admin and (is_being_demoted or is_being_disabled):
                active_admins_count = conn.execute("""
                    SELECT COUNT(*) AS count FROM users
                    WHERE LOWER(role) = 'admin' AND COALESCE(is_active, 1) = 1
                """).fetchone()["count"]
                if active_admins_count <= 1:
                    return json_response({"error": "Cannot demote or disable the last remaining active administrator"}, status=400)

            # Safeguard 3: invalid role values are rejected
            if "role" in data and new_role not in ALLOWED_ROLES:
                return json_response({"error": f"Invalid role. Role must be one of: {', '.join(ALLOWED_ROLES)}"}, status=400)

            # Validate email if updated
            new_email = target["email"]
            if "email" in data:
                new_email = str(data["email"]).strip().lower()
                if not new_email or "@" not in new_email:
                    return json_response({"error": "Please provide a valid email address"}, status=400)
                dup = conn.execute("SELECT id FROM users WHERE LOWER(email) = ? AND id != ?", (new_email, user_id)).fetchone()
                if dup:
                    return json_response({"error": "An account with this email already exists"}, status=400)

            # Validate full name if updated
            new_full_name = target["full_name"]
            if "full_name" in data:
                new_full_name = clean_text(data["full_name"])
                if not new_full_name:
                    return json_response({"error": "Full name cannot be empty"}, status=400)

            # Execute update
            conn.execute("""
                UPDATE users
                SET role = ?, full_name = ?, email = ?, is_active = ?
                WHERE id = ?
            """, (new_role, new_full_name, new_email, new_active, user_id))

            # Invalidate sessions if role changed or account disabled
            role_changed = (new_role != current_target_role)
            account_disabled = (new_active == 0)
            if role_changed or account_disabled:
                conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))

            updated = conn.execute("""
                SELECT id, username, full_name, email, role,
                       COALESCE(is_active, 1) AS is_active,
                       last_login, created_at
                FROM users WHERE id = ?
            """, (user_id,)).fetchone()
            return json_response(dict(updated))

    @app.post("/api/users/<user_id:int>/reset_password")
    def reset_password(user_id):
        current_admin, err = require_admin()
        if err:
            return err
        data = request.json or {}
        new_password = data.get("new_password") or ""

        if not new_password or len(new_password) < 8:
            return json_response({"error": "New password must be at least 8 characters"}, status=400)

        with get_db() as conn:
            target = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if not target:
                return json_response({"error": "User not found"}, status=404)

            pwd_hash = hash_password(new_password)
            conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (pwd_hash, user_id))

            # Invalidate sessions immediately
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))

            return json_response({"success": True, "message": "Password reset successfully"})
