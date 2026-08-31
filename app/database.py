import sqlite3
import os
import hashlib
import secrets
from datetime import datetime, timezone, timedelta
from contextlib import contextmanager

DB_PATH = os.environ.get("PROJECT_PULSE_DB", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "project_pulse.db"))

def dict_factory(cursor, row):
    d = {}
    for idx, col in enumerate(cursor.description):
        d[col[0]] = row[idx]
    return d

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = dict_factory
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def hash_password(password: str, salt: str = None) -> str:
    if not salt:
        salt = secrets.token_hex(16)
    pw_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000).hex()
    return f"{salt}${pw_hash}"

def verify_password(password: str, stored_hash: str) -> bool:
    if not stored_hash or "$" not in stored_hash:
        return False
    salt, hash_val = stored_hash.split("$", 1)
    computed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100000).hex()
    return secrets.compare_digest(computed, hash_val)

def seed_default_users(cursor):
    cursor.execute("SELECT COUNT(*) as cnt FROM users")
    if cursor.fetchone()["cnt"] == 0:
        now_str = datetime.now(timezone.utc).isoformat()
        default_users = [
            ("admin", "admin@company.internal", "admin123", "System Administrator", "admin", "#3B82F6"),
            ("vishnu", "srivishnu@chemtatva.com", "chemtatva123", "Sri Vishnu", "manager", "#6366F1"),
            ("alex", "alex.morgan@company.internal", "alex123", "Alex Morgan", "member", "#10B981")
        ]
        for username, email, pwd, full_name, role, color in default_users:
            cursor.execute("""
                INSERT INTO users (username, email, password_hash, full_name, role, avatar_color, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (username, email, hash_password(pwd), full_name, role, color, now_str))

def init_db():
    with get_db() as conn:
        cursor = conn.cursor()
        
        # User accounts table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            full_name TEXT NOT NULL,
            role TEXT DEFAULT 'manager', -- 'admin', 'manager', 'member', 'viewer'
            avatar_color TEXT DEFAULT '#3B82F6',
            created_at TEXT NOT NULL,
            last_login TEXT
        )
        """)

        # User sessions table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        )
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS projects (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            color TEXT DEFAULT '#3B82F6',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            email TEXT,
            role TEXT DEFAULT 'Member',
            avatar_color TEXT DEFAULT '#6366F1',
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
        )
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS sprints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            goal TEXT,
            start_date TEXT,
            end_date TEXT,
            status TEXT DEFAULT 'planning', -- 'planning', 'active', 'completed'
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
        )
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS milestones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            due_date TEXT NOT NULL,
            status TEXT DEFAULT 'pending', -- 'pending', 'completed'
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
        )
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            sprint_id INTEGER,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'todo', -- 'backlog', 'todo', 'in_progress', 'in_review', 'done'
            priority TEXT DEFAULT 'medium', -- 'low', 'medium', 'high', 'urgent'
            order_index INTEGER DEFAULT 0,
            start_date TEXT,
            due_date TEXT,
            estimated_hours REAL DEFAULT 0,
            actual_hours REAL DEFAULT 0,
            assignee_id INTEGER,
            tags TEXT DEFAULT '[]', -- JSON string array of tags
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
            FOREIGN KEY (sprint_id) REFERENCES sprints (id) ON DELETE SET NULL,
            FOREIGN KEY (assignee_id) REFERENCES members (id) ON DELETE SET NULL
        )
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS subtasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            completed INTEGER DEFAULT 0,
            order_index INTEGER DEFAULT 0,
            FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
        )
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS timelogs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            member_id INTEGER NOT NULL,
            hours REAL NOT NULL,
            description TEXT,
            logged_date TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
            FOREIGN KEY (member_id) REFERENCES members (id) ON DELETE CASCADE
        )
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            task_id INTEGER,
            user_name TEXT NOT NULL,
            action TEXT NOT NULL,
            details TEXT,
            timestamp TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
            FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE SET NULL
        )
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS email_settings (
            id INTEGER PRIMARY KEY,
            smtp_provider TEXT DEFAULT 'outlook',
            smtp_host TEXT DEFAULT 'smtp.office365.com',
            smtp_port INTEGER DEFAULT 587,
            smtp_user TEXT DEFAULT '',
            smtp_pass TEXT DEFAULT '',
            sender_name TEXT DEFAULT 'ProjectPulse Notifications',
            use_tls INTEGER DEFAULT 1,
            is_enabled INTEGER DEFAULT 1,
            simulation_mode INTEGER DEFAULT 1,
            notify_due_soon INTEGER DEFAULT 1,
            notify_due_today INTEGER DEFAULT 1,
            notify_overdue INTEGER DEFAULT 1,
            recurring_day TEXT DEFAULT 'monday',
            notify_assigned INTEGER DEFAULT 1,
            notify_completed INTEGER DEFAULT 1,
            updated_at TEXT NOT NULL
        )
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS email_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER,
            task_id INTEGER,
            recipient_email TEXT NOT NULL,
            recipient_name TEXT,
            subject TEXT NOT NULL,
            body_html TEXT NOT NULL,
            trigger_type TEXT NOT NULL,
            status TEXT NOT NULL,
            error_message TEXT,
            sent_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE SET NULL,
            FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE SET NULL
        )
        """)

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS notification_dispatches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            trigger_type TEXT NOT NULL,
            dispatch_date TEXT NOT NULL,
            recipient_email TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE
        )
        """)

        # Ensure default settings row exists
        existing_settings = cursor.execute("SELECT id FROM email_settings WHERE id = 1").fetchone()
        if not existing_settings:
            cursor.execute("""
                INSERT INTO email_settings (
                    id, smtp_provider, smtp_host, smtp_port, smtp_user, smtp_pass,
                    sender_name, use_tls, is_enabled, simulation_mode,
                    notify_due_soon, notify_due_today, notify_overdue, recurring_day,
                    notify_assigned, notify_completed, updated_at
                )
                VALUES (
                    1, 'outlook', 'smtp.office365.com', 587, '', '',
                    'ProjectPulse Notifications', 1, 1, 1,
                    1, 1, 1, 'monday', 1, 1, datetime('now')
                )
            """)

        # Seed default users
        seed_default_users(cursor)

        # Indexes for fast querying
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_sprint ON tasks(sprint_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_timelogs_task ON timelogs(task_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_activity_project ON activity_logs(project_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_email_logs_project ON email_logs(project_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_email_logs_task ON email_logs(task_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_email_logs_sent ON email_logs(sent_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_dispatches_lookup ON notification_dispatches(task_id, trigger_type, dispatch_date)")
