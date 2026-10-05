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
        ("pm", "pm@company.internal", "pm123", "Project Manager", "pm", "#6366F1"),
        ("lead", "lead@company.internal", "lead123", "Project Lead", "lead", "#8B5CF6"),
        ("assignee", "assignee@company.internal", "assignee123", "Task Assignee", "assignee", "#10B981"),
        ("vishnu", "srivishnu@chemtatva.com", "chemtatva123", "Sri Vishnu", "pm", "#6366F1"),
        ("alex", "alex.morgan@company.internal", "alex123", "Alex Morgan", "assignee", "#10B981")
    ]
    for username, email, pwd, full_name, role, color in default_users:
        existing = cursor.execute("SELECT id FROM users WHERE LOWER(username) = ?", (username.lower(),)).fetchone()
        if not existing:
            cursor.execute("""
                INSERT INTO users (username, email, password_hash, full_name, role, avatar_color, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (username, email, hash_password(pwd), full_name, role, color, now_str))
        else:
            # Keep roles synchronized with standard definitions
            cursor.execute("UPDATE users SET role = ?, full_name = ? WHERE id = ?", (role, full_name, existing["id"]))

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
            project_code TEXT,
            manager_id INTEGER,
            manager_name TEXT,
            department TEXT DEFAULT 'Engineering',
            start_date TEXT,
            target_end_date TEXT,
            status TEXT DEFAULT 'active',
            priority TEXT DEFAULT 'medium',
            sponsor TEXT,
            in_scope TEXT,
            out_of_scope TEXT,
            assumptions TEXT,
            constraints TEXT,
            approval_status TEXT DEFAULT 'draft',
            approved_by TEXT,
            approved_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """)

        # Migration: Add new project columns if upgrading existing projects table
        project_migrations = [
            ("project_code", "TEXT"),
            ("manager_id", "INTEGER"),
            ("manager_name", "TEXT"),
            ("department", "TEXT DEFAULT 'Engineering'"),
            ("start_date", "TEXT"),
            ("target_end_date", "TEXT"),
            ("status", "TEXT DEFAULT 'active'"),
            ("priority", "TEXT DEFAULT 'medium'"),
            ("sponsor", "TEXT"),
            ("in_scope", "TEXT"),
            ("out_of_scope", "TEXT"),
            ("assumptions", "TEXT"),
            ("constraints", "TEXT"),
            ("approval_status", "TEXT DEFAULT 'draft'"),
            ("approved_by", "TEXT"),
            ("approved_at", "TEXT")
        ]
        for col, col_def in project_migrations:
            try:
                cursor.execute(f"ALTER TABLE projects ADD COLUMN {col} {col_def}")
            except Exception:
                pass

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

        # Deliverables table (major project outcomes)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS deliverables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            owner_name TEXT,
            owner_id INTEGER,
            due_date TEXT,
            status TEXT DEFAULT 'pending', -- 'pending', 'in_progress', 'completed'
            progress_pct INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
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
            deliverable_id INTEGER,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
            FOREIGN KEY (deliverable_id) REFERENCES deliverables (id) ON DELETE SET NULL
        )
        """)

        # Migration: ensure deliverable_id exists on milestones
        try:
            cursor.execute("ALTER TABLE milestones ADD COLUMN deliverable_id INTEGER")
        except Exception:
            pass

        try:
            cursor.execute("ALTER TABLE milestones ADD COLUMN description TEXT")
        except Exception:
            pass

        cursor.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            sprint_id INTEGER,
            deliverable_id INTEGER,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT DEFAULT 'todo', -- 'backlog', 'todo', 'in_progress', 'in_review', 'done'
            priority TEXT DEFAULT 'medium', -- 'low', 'medium', 'high', 'urgent'
            order_index INTEGER DEFAULT 0,
            start_date TEXT,
            due_date TEXT,
            estimated_hours REAL DEFAULT 0,
            actual_hours REAL DEFAULT 0,
            progress_pct INTEGER DEFAULT 0,
            assignee_id INTEGER,
            tags TEXT DEFAULT '[]', -- JSON string array of tags
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
            FOREIGN KEY (sprint_id) REFERENCES sprints (id) ON DELETE SET NULL,
            FOREIGN KEY (assignee_id) REFERENCES members (id) ON DELETE SET NULL,
            FOREIGN KEY (deliverable_id) REFERENCES deliverables (id) ON DELETE SET NULL
        )
        """)

        # Migration: ensure progress_pct and deliverable_id exist on tasks
        try:
            cursor.execute("ALTER TABLE tasks ADD COLUMN progress_pct INTEGER DEFAULT 0")
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE tasks ADD COLUMN deliverable_id INTEGER")
        except Exception:
            pass

        # Project Objectives table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS project_objectives (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            objective TEXT NOT NULL,
            success_criteria TEXT,
            status TEXT DEFAULT 'in_progress', -- 'not_started', 'in_progress', 'achieved', 'at_risk'
            order_index INTEGER DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
        )
        """)

        # Project Risks table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS project_risks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            risk_code TEXT,
            description TEXT NOT NULL,
            impact TEXT DEFAULT 'medium', -- 'low', 'medium', 'high', 'critical'
            probability TEXT DEFAULT 'medium', -- 'low', 'medium', 'high'
            mitigation TEXT,
            owner TEXT,
            status TEXT DEFAULT 'open', -- 'open', 'mitigated', 'closed'
            created_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
        )
        """)

        # Project Budget categories table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS project_budgets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            category TEXT NOT NULL,
            estimated_cost REAL DEFAULT 0.0,
            actual_cost REAL DEFAULT 0.0,
            notes TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
        )
        """)

        # Project Documents table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS project_documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            doc_type TEXT DEFAULT 'document',
            file_url TEXT,
            notes TEXT,
            uploaded_by TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
        )
        """)

        # Project Approvals / Sign-off table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS project_approvals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id INTEGER NOT NULL,
            role_title TEXT NOT NULL,
            approver_name TEXT NOT NULL,
            approver_email TEXT,
            status TEXT DEFAULT 'pending', -- 'pending', 'approved', 'rejected'
            comments TEXT,
            signed_at TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
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
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_project_order ON tasks(project_id, order_index)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_tasks_deliverable ON tasks(deliverable_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_deliverables_proj ON deliverables(project_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_objectives_proj ON project_objectives(project_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_risks_proj ON project_risks(project_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_budgets_proj ON project_budgets(project_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_documents_proj ON project_documents(project_id)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_approvals_proj ON project_approvals(project_id)")

        # Normalize task sequence ordering across all existing projects to ensure clean 0, 1, ..., N-1 ordering
        normalize_all_projects_task_order(conn)

        # Migrate and populate default charter fields, budget categories, and approvals
        migrate_charter_data(conn)
    
    # Immediately flush initial database structure to persistent storage if needed
    _perform_storage_sync()

def normalize_project_task_order(conn, project_id: int):
    """
    Guarantees that every task in the project has a strictly unique,
    gapless sequence index: 0, 1, 2, ..., N-1.
    Sorts by (order_index ASC, id ASC) to establish the canonical sequence,
    then updates order_index = 0, 1, 2, ...
    """
    tasks = conn.execute(
        "SELECT id, order_index FROM tasks WHERE project_id = ? ORDER BY order_index ASC, id ASC",
        (project_id,)
    ).fetchall()
    now_str = datetime.now().isoformat()
    for idx, t in enumerate(tasks):
        if t["order_index"] != idx:
            conn.execute(
                "UPDATE tasks SET order_index = ?, updated_at = ? WHERE id = ?",
                (idx, now_str, t["id"])
            )

def normalize_all_projects_task_order(conn):
    try:
        projects = conn.execute("SELECT id FROM projects").fetchall()
        for p in projects:
            normalize_project_task_order(conn, p["id"])
    except Exception as e:
        print(f"[Database] Notice: skipped task order normalization: {e}")

DEFAULT_BUDGET_CATEGORIES = [
    "Raw Materials / Consumables",
    "Manpower / Labor",
    "Analytical Testing / External Services",
    "Equipment / Facility Utilization",
    "Miscellaneous / Contingency"
]

DEFAULT_APPROVAL_ROLES = [
    ("Project Sponsor", "Executive Sponsor"),
    ("Project Manager", "Project Manager"),
    ("Technical Lead", "Technical Lead"),
    ("Quality / Reviewer", "QA / Compliance Lead")
]

def migrate_charter_data(conn):
    """
    Ensures every existing project has valid Project Charter metadata,
    default budget categories, and approval sign-off slots.
    """
    try:
        projects = conn.execute("SELECT * FROM projects").fetchall()
        now_str = datetime.now(timezone.utc).isoformat()
        
        for p in projects:
            pid = p["id"]
            p_code = p.get("project_code")
            if not p_code:
                p_code = f"PRJ-{pid:03d}"
            
            department = p.get("department") or "Engineering"
            status = p.get("status") or "active"
            priority = p.get("priority") or "medium"
            sponsor = p.get("sponsor") or "Executive Committee"
            approval_status = p.get("approval_status") or "draft"

            # Determine manager name if missing
            manager_name = p.get("manager_name")
            if not manager_name:
                first_lead = conn.execute("""
                    SELECT name FROM members 
                    WHERE project_id = ? 
                    ORDER BY CASE WHEN role IN ('Owner', 'Lead', 'PM', 'Project Manager') THEN 0 ELSE 1 END, id ASC 
                    LIMIT 1
                """, (pid,)).fetchone()
                manager_name = first_lead["name"] if first_lead else "Project Manager"

            # Determine start_date and target_end_date if missing
            start_date = p.get("start_date")
            target_end_date = p.get("target_end_date")
            if not start_date:
                min_t = conn.execute("SELECT MIN(start_date) as min_s FROM tasks WHERE project_id = ? AND start_date IS NOT NULL AND start_date != ''", (pid,)).fetchone()
                start_date = min_t["min_s"] if min_t and min_t["min_s"] else (p.get("created_at") or now_str)[:10]

            if not target_end_date:
                max_t = conn.execute("SELECT MAX(due_date) as max_d FROM tasks WHERE project_id = ? AND due_date IS NOT NULL AND due_date != ''", (pid,)).fetchone()
                if max_t and max_t["max_d"]:
                    target_end_date = max_t["max_d"]
                else:
                    try:
                        s_dt = datetime.fromisoformat(start_date)
                        target_end_date = (s_dt + timedelta(days=90)).strftime("%Y-%m-%d")
                    except Exception:
                        target_end_date = (datetime.now() + timedelta(days=90)).strftime("%Y-%m-%d")

            in_scope = p.get("in_scope")
            if in_scope is None or in_scope == "":
                in_scope = "• Core system implementation and requirement verification\n• End-to-end testing and quality validation\n• Production readiness and deployment documentation"

            out_of_scope = p.get("out_of_scope")
            if out_of_scope is None or out_of_scope == "":
                out_of_scope = "• Unplanned downstream feature extensions outside project baseline\n• External third-party infrastructure hosting and non-contracted services"

            assumptions = p.get("assumptions")
            if assumptions is None or assumptions == "":
                assumptions = "• Key project personnel and lab/equipment resources remain allocated as planned.\n• External material supply lead times meet scheduled dates."

            constraints = p.get("constraints")
            if constraints is None or constraints == "":
                constraints = "• All development must adhere to organizational quality, compliance, and budget limits.\n• Milestones must meet target regulatory standards."

            conn.execute("""
                UPDATE projects SET
                    project_code = ?,
                    manager_name = ?,
                    department = ?,
                    start_date = ?,
                    target_end_date = ?,
                    status = ?,
                    priority = ?,
                    sponsor = ?,
                    in_scope = ?,
                    out_of_scope = ?,
                    assumptions = ?,
                    constraints = ?,
                    approval_status = ?
                WHERE id = ?
            """, (p_code, manager_name, department, start_date, target_end_date, status, priority, sponsor, in_scope, out_of_scope, assumptions, constraints, approval_status, pid))

            # Ensure default budget categories exist
            existing_budgets = conn.execute("SELECT COUNT(*) as cnt FROM project_budgets WHERE project_id = ?", (pid,)).fetchone()
            if existing_budgets["cnt"] == 0:
                for cat in DEFAULT_BUDGET_CATEGORIES:
                    conn.execute("""
                        INSERT INTO project_budgets (project_id, category, estimated_cost, actual_cost, notes, created_at, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, (pid, cat, 0.0, 0.0, "", now_str, now_str))

            # Ensure default approval slots exist
            existing_approvals = conn.execute("SELECT COUNT(*) as cnt FROM project_approvals WHERE project_id = ?", (pid,)).fetchone()
            if existing_approvals["cnt"] == 0:
                for role_title, default_name in DEFAULT_APPROVAL_ROLES:
                    approver_name = default_name
                    if role_title == "Project Manager" and manager_name:
                        approver_name = manager_name
                    elif role_title == "Project Sponsor" and sponsor:
                        approver_name = sponsor
                    conn.execute("""
                        INSERT INTO project_approvals (project_id, role_title, approver_name, approver_email, status, created_at)
                        VALUES (?, ?, ?, ?, 'pending', ?)
                    """, (pid, role_title, approver_name, f"{approver_name.lower().replace(' ', '.')}@company.internal", now_str))

            # Ensure at least 1-2 objectives exist if empty
            existing_objs = conn.execute("SELECT COUNT(*) as cnt FROM project_objectives WHERE project_id = ?", (pid,)).fetchone()
            if existing_objs["cnt"] == 0:
                conn.execute("""
                    INSERT INTO project_objectives (project_id, objective, success_criteria, status, order_index, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (pid, f"Deliver {p['name']} according to defined project requirements and specifications", ">= 95% test criteria pass rate", "in_progress", 0, now_str))
                conn.execute("""
                    INSERT INTO project_objectives (project_id, objective, success_criteria, status, order_index, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (pid, "Complete all deliverables within planned schedule and allocated budget", "<= 5% variance from baseline schedule & budget", "in_progress", 1, now_str))

    except Exception as e:
        print(f"[Database] Notice: skipped charter data migration: {e}")


