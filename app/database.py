import sqlite3
import os
import hashlib
import secrets
from datetime import datetime, timezone, timedelta
from contextlib import contextmanager

import shutil
import threading

_ACTIVE_DB_PATH = None
_PERSISTENT_STORAGE_PATH = None
_sync_timer = None
_sync_lock = threading.Lock()

def get_db_path():
    global _ACTIVE_DB_PATH, _PERSISTENT_STORAGE_PATH
    if _ACTIVE_DB_PATH:
        return _ACTIVE_DB_PATH

    raw_path = os.environ.get("PROJECT_PULSE_DB")
    if raw_path:
        try:
            d = os.path.dirname(os.path.abspath(raw_path))
            if d:
                os.makedirs(d, exist_ok=True)
            _PERSISTENT_STORAGE_PATH = os.path.abspath(raw_path)
        except Exception as e:
            print(f"[ProjectPulse DB Warning] Configured path '{raw_path}' not accessible: {e}")

    # For Linux/Docker/Cloud Run containers with network mounts (e.g. GCS FUSE /app/data),
    # run the active DB on high-speed local NVMe/RAM (/tmp) for sub-millisecond query execution,
    # and sync to persistent cloud storage in a non-blocking background thread.
    if _PERSISTENT_STORAGE_PATH:
        if os.path.exists("/tmp") and "/tmp" not in _PERSISTENT_STORAGE_PATH:
            _ACTIVE_DB_PATH = "/tmp/project_pulse.db"
            if os.path.exists(_PERSISTENT_STORAGE_PATH) and os.path.getsize(_PERSISTENT_STORAGE_PATH) > 0:
                if not os.path.exists(_ACTIVE_DB_PATH) or os.path.getsize(_ACTIVE_DB_PATH) == 0:
                    try:
                        shutil.copy2(_PERSISTENT_STORAGE_PATH, _ACTIVE_DB_PATH)
                        print(f"[ProjectPulse DB] Restored active local database from persistent storage ({_PERSISTENT_STORAGE_PATH})")
                    except Exception as ex:
                        print(f"[ProjectPulse DB Warning] Could not copy from storage: {ex}")
            return _ACTIVE_DB_PATH
        else:
            _ACTIVE_DB_PATH = _PERSISTENT_STORAGE_PATH
            return _ACTIVE_DB_PATH

    # Fallback 1: Project root directory
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    local_path = os.path.join(base_dir, "project_pulse.db")
    try:
        d = os.path.dirname(os.path.abspath(local_path))
        if d:
            os.makedirs(d, exist_ok=True)
        _ACTIVE_DB_PATH = local_path
        _PERSISTENT_STORAGE_PATH = local_path
        return _ACTIVE_DB_PATH
    except Exception:
        pass

    # Fallback 2: System /tmp directory
    tmp_dir = "/tmp" if os.path.exists("/tmp") else os.environ.get("TEMP", os.getcwd())
    _ACTIVE_DB_PATH = os.path.join(tmp_dir, "project_pulse.db")
    _PERSISTENT_STORAGE_PATH = _ACTIVE_DB_PATH
    return _ACTIVE_DB_PATH

DB_PATH = get_db_path()

def _perform_storage_sync():
    global _PERSISTENT_STORAGE_PATH, _ACTIVE_DB_PATH
    if not _PERSISTENT_STORAGE_PATH or not _ACTIVE_DB_PATH or _ACTIVE_DB_PATH == _PERSISTENT_STORAGE_PATH:
        return
    if not os.path.exists(_ACTIVE_DB_PATH):
        return
    try:
        src_conn = sqlite3.connect(_ACTIVE_DB_PATH, timeout=5.0)
        dst_conn = sqlite3.connect(_PERSISTENT_STORAGE_PATH, timeout=10.0)
        with dst_conn:
            src_conn.backup(dst_conn)
        dst_conn.close()
        src_conn.close()
    except Exception as e:
        print(f"[ProjectPulse DB Sync Error] Could not backup to persistent storage: {e}")

def schedule_storage_sync():
    global _sync_timer, _PERSISTENT_STORAGE_PATH, _ACTIVE_DB_PATH
    if not _PERSISTENT_STORAGE_PATH or not _ACTIVE_DB_PATH or _ACTIVE_DB_PATH == _PERSISTENT_STORAGE_PATH:
        return
    with _sync_lock:
        if _sync_timer and _sync_timer.is_alive():
            return
        _sync_timer = threading.Timer(0.5, _perform_storage_sync)
        _sync_timer.daemon = True
        _sync_timer.start()

def dict_factory(cursor, row):
    d = {}
    for idx, col in enumerate(cursor.description):
        d[col[0]] = row[idx]
    return d

@contextmanager
def get_db():
    target_path = get_db_path()
    try:
        conn = sqlite3.connect(target_path, timeout=5.0)
    except Exception:
        tmp_dir = "/tmp" if os.path.exists("/tmp") else os.getcwd()
        fallback_path = os.path.join(tmp_dir, "project_pulse.db")
        conn = sqlite3.connect(fallback_path, timeout=5.0)
    conn.row_factory = dict_factory
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
        conn.execute("PRAGMA temp_store = MEMORY")
        conn.execute("PRAGMA cache_size = -64000")
        conn.execute("PRAGMA mmap_size = 268435456")
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 5000")
    except Exception:
        pass
    try:
        yield conn
        conn.commit()
        schedule_storage_sync()
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
    now_str = datetime.now(timezone.utc).isoformat()
    default_users = [
        ("admin", "admin@company.internal", "admin123", "System Administrator", "admin", "#3B82F6"),
        ("pm", "pm@company.internal", "pm123", "Project Manager", "PM", "#6366F1"),
        ("lead", "lead@company.internal", "lead123", "Project Lead", "Lead", "#8B5CF6"),
        ("assignee", "assignee@company.internal", "assignee123", "Task Assignee", "Assignee", "#10B981"),
        ("vishnu", "srivishnu@chemtatva.com", "chemtatva123", "Sri Vishnu", "PM", "#6366F1"),
        ("alex", "alex.morgan@company.internal", "alex123", "Alex Morgan", "Assignee", "#10B981")
    ]
    for username, email, pwd, full_name, role, color in default_users:
        existing = cursor.execute("SELECT id FROM users WHERE LOWER(username) = ?", (username.lower(),)).fetchone()
        if not existing:
            cursor.execute("""
                INSERT INTO users (username, email, password_hash, full_name, role, avatar_color, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (username, email, hash_password(pwd), full_name, role, color, now_str))

def init_db():
    with get_db() as conn:
        try:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA synchronous = NORMAL")
        except Exception:
            pass
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

        # Central Resource Management & Library
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS resources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            resource_code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            type TEXT NOT NULL, -- 'Employee', 'Contractor', 'Equipment', 'Laboratory Equipment', 'Software', 'Vendor', 'External Resource', 'Material', 'Other'
            category TEXT DEFAULT 'General', -- 'R&D', 'QC/QA', 'Engineering', 'Operations', 'IT & Systems', 'Procurement', etc.
            department TEXT DEFAULT 'General',
            role TEXT DEFAULT 'Resource',
            skills TEXT DEFAULT '[]', -- JSON array of tags/skills
            description TEXT,
            availability TEXT DEFAULT 'available', -- 'available', 'partially_allocated', 'fully_allocated', 'unavailable'
            status TEXT DEFAULT 'active', -- 'active', 'inactive', 'archived'
            contact_email TEXT,
            contact_phone TEXT,
            location TEXT,
            cost_rate REAL DEFAULT 0.0,
            cost_unit TEXT DEFAULT 'hr', -- 'hr', 'day', 'month', 'fixed'
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """)

        # Project Resource Mapping
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS project_resources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            resource_id INTEGER NOT NULL,
            role TEXT DEFAULT 'Member',
            allocation_pct REAL DEFAULT 100.0,
            start_date TEXT,
            end_date TEXT,
            responsibility TEXT,
            status TEXT DEFAULT 'active', -- 'active', 'planned', 'completed', 'released'
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
            FOREIGN KEY (resource_id) REFERENCES resources (id) ON DELETE CASCADE,
            UNIQUE(project_id, resource_id)
        )
        """)

        # Task/Activity Resource Mapping
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS task_resources (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id INTEGER NOT NULL,
            resource_id INTEGER NOT NULL,
            project_id INTEGER NOT NULL,
            role TEXT,
            responsibility TEXT,
            allocation_pct REAL DEFAULT 100.0,
            notes TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (task_id) REFERENCES tasks (id) ON DELETE CASCADE,
            FOREIGN KEY (resource_id) REFERENCES resources (id) ON DELETE CASCADE,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
            UNIQUE(task_id, resource_id)
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
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_project_status ON tasks(project_id, status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_project_due ON tasks(project_id, due_date)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_sprint ON tasks(sprint_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_subtasks_task ON subtasks(task_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_subtasks_task_completed ON subtasks(task_id, completed)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_timelogs_task ON timelogs(task_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_timelogs_task_hours ON timelogs(task_id, hours)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_activity_project ON activity_logs(project_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_email_logs_project ON email_logs(project_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_email_logs_task ON email_logs(task_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_email_logs_sent ON email_logs(sent_at)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_dispatches_lookup ON notification_dispatches(task_id, trigger_type, dispatch_date)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_resources_code ON resources(resource_code)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(type)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_resources_status ON resources(status)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_resources_dept ON resources(department)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_proj_res_proj ON project_resources(project_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_proj_res_res ON project_resources(resource_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_task_res_task ON task_resources(task_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_task_res_res ON task_resources(resource_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_task_res_proj ON task_resources(project_id)")
    
    # Immediately flush initial database structure to persistent storage if needed
    _perform_storage_sync()
