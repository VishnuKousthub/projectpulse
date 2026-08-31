import json
import os
import sqlite3
from datetime import datetime, timezone, timedelta
from bottle import Bottle, request, response, static_file, run

from app.database import get_db, init_db
from app.seed import seed_database
from app.gantt_parser import (
    parse_gantt_file, generate_sample_gantt_csv, generate_sample_gantt_excel, AVATAR_COLORS
)
from app.notifier import (
    notify_task_assigned, notify_task_completed, run_all_due_date_checks,
    send_test_email, get_settings, start_background_scheduler
)

app = Bottle()

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "static")

def get_now_iso():
    return datetime.now(timezone.utc).isoformat()

def json_response(data, status=200):
    response.status = status
    response.content_type = "application/json"
    return json.dumps(data)

def record_activity(conn, project_id, user_name, action, details, task_id=None):
    now_str = get_now_iso()
    conn.execute("""
        INSERT INTO activity_logs (project_id, task_id, user_name, action, details, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (project_id, task_id, user_name, action, details, now_str))

@app.hook("after_request")
def enable_cors():
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Origin, Accept, Content-Type, X-Requested-With, X-CSRF-Token"

@app.route("/<:re:.*>", method="OPTIONS")
def enable_cors_generic_route():
    return ""

# ==================== STATIC FILES ====================

@app.get("/")
def serve_index():
    return static_file("index.html", root=STATIC_DIR)

@app.get("/static/<filepath:path>")
def serve_static(filepath):
    return static_file(filepath, root=STATIC_DIR)

@app.get("/favicon.ico")
def serve_favicon():
    return ""

# ==================== PROJECTS ====================

@app.get("/api/projects")
def get_projects():
    with get_db() as conn:
        projects = conn.execute("""
            SELECT p.*,
                (SELECT COUNT(*) FROM tasks WHERE project_id = p.id) as total_tasks,
                (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status = 'done') as completed_tasks,
                (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status != 'done' AND due_date < date('now') AND due_date IS NOT NULL) as overdue_tasks,
                (SELECT COALESCE(SUM(actual_hours), 0) FROM tasks WHERE project_id = p.id) as total_actual_hours,
                (SELECT COALESCE(SUM(estimated_hours), 0) FROM tasks WHERE project_id = p.id) as total_estimated_hours
            FROM projects p
            ORDER BY p.updated_at DESC
        """).fetchall()
        return json_response(projects)

@app.post("/api/projects")
def create_project():
    data = request.json or {}
    name = data.get("name", "").strip()
    if not name:
        return json_response({"error": "Project name is required"}, status=400)
    
    desc = data.get("description", "")
    color = data.get("color", "#3B82F6")
    now_str = get_now_iso()

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO projects (name, description, color, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
        """, (name, desc, color, now_str, now_str))
        p_id = cursor.lastrowid

        cursor.execute("""
            INSERT INTO members (project_id, name, email, role, avatar_color)
            VALUES (?, ?, ?, ?, ?)
        """, (p_id, "Project Lead", "lead@company.internal", "Owner", color))

        record_activity(conn, p_id, "System", "Project Created", f'Created project "{name}"')
        project = conn.execute("SELECT * FROM projects WHERE id = ?", (p_id,)).fetchone()
        return json_response(project, status=201)

@app.get("/api/projects/<project_id:int>")
def get_project(project_id):
    with get_db() as conn:
        project = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            return json_response({"error": "Project not found"}, status=404)
        
        members = conn.execute("SELECT * FROM members WHERE project_id = ? ORDER BY name", (project_id,)).fetchall()
        sprints = conn.execute("SELECT * FROM sprints WHERE project_id = ? ORDER BY start_date DESC", (project_id,)).fetchall()
        milestones = conn.execute("SELECT * FROM milestones WHERE project_id = ? ORDER BY due_date ASC", (project_id,)).fetchall()
        
        result = dict(project)
        result["members"] = members
        result["sprints"] = sprints
        result["milestones"] = milestones
        return json_response(result)

@app.put("/api/projects/<project_id:int>")
def update_project(project_id):
    data = request.json or {}
    with get_db() as conn:
        project = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            return json_response({"error": "Project not found"}, status=404)
        
        name = data.get("name", project["name"])
        desc = data.get("description", project["description"])
        color = data.get("color", project["color"])
        now_str = get_now_iso()

        conn.execute("""
            UPDATE projects SET name = ?, description = ?, color = ?, updated_at = ?
            WHERE id = ?
        """, (name, desc, color, now_str, project_id))
        
        record_activity(conn, project_id, "User", "Project Updated", "Updated project settings")
        updated = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        return json_response(updated)

@app.delete("/api/projects/<project_id:int>")
def delete_project(project_id):
    with get_db() as conn:
        project = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            return json_response({"error": "Project not found"}, status=404)
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        return json_response({"success": True, "message": "Project deleted"})

# ==================== MEMBERS ====================

@app.get("/api/projects/<project_id:int>/members")
def get_members(project_id):
    with get_db() as conn:
        members = conn.execute("SELECT * FROM members WHERE project_id = ? ORDER BY name", (project_id,)).fetchall()
        return json_response(members)

@app.post("/api/projects/<project_id:int>/members")
def add_member(project_id):
    data = request.json or {}
    name = data.get("name", "").strip()
    if not name:
        return json_response({"error": "Name is required"}, status=400)
    
    email = data.get("email", "")
    role = data.get("role", "Member")
    avatar_color = data.get("avatar_color", "#6366F1")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO members (project_id, name, email, role, avatar_color)
            VALUES (?, ?, ?, ?, ?)
        """, (project_id, name, email, role, avatar_color))
        m_id = cursor.lastrowid
        record_activity(conn, project_id, "Admin", "Member Added", f'Added member "{name}" ({role})')
        member = conn.execute("SELECT * FROM members WHERE id = ?", (m_id,)).fetchone()
        return json_response(member, status=201)

@app.delete("/api/projects/<project_id:int>/members/<member_id:int>")
def delete_member(project_id, member_id):
    with get_db() as conn:
        conn.execute("DELETE FROM members WHERE id = ? AND project_id = ?", (member_id, project_id))
        return json_response({"success": True})

# ==================== SPRINTS ====================

@app.get("/api/projects/<project_id:int>/sprints")
def get_sprints(project_id):
    with get_db() as conn:
        sprints = conn.execute("""
            SELECT s.*,
                (SELECT COUNT(*) FROM tasks WHERE sprint_id = s.id) as total_tasks,
                (SELECT COUNT(*) FROM tasks WHERE sprint_id = s.id AND status = 'done') as completed_tasks,
                (SELECT COALESCE(SUM(estimated_hours), 0) FROM tasks WHERE sprint_id = s.id) as total_estimated_hours,
                (SELECT COALESCE(SUM(actual_hours), 0) FROM tasks WHERE sprint_id = s.id) as total_actual_hours
            FROM sprints s
            WHERE s.project_id = ?
            ORDER BY s.start_date DESC
        """, (project_id,)).fetchall()
        return json_response(sprints)

@app.post("/api/projects/<project_id:int>/sprints")
def create_sprint(project_id):
    data = request.json or {}
    name = data.get("name", "").strip()
    if not name:
        return json_response({"error": "Sprint name is required"}, status=400)
    
    goal = data.get("goal", "")
    start_date = data.get("start_date")
    end_date = data.get("end_date")
    status = data.get("status", "planning")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO sprints (project_id, name, goal, start_date, end_date, status)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (project_id, name, goal, start_date, end_date, status))
        s_id = cursor.lastrowid
        record_activity(conn, project_id, "Manager", "Sprint Created", f'Created sprint "{name}"')
        sprint = conn.execute("SELECT * FROM sprints WHERE id = ?", (s_id,)).fetchone()
        return json_response(sprint, status=201)

@app.put("/api/projects/<project_id:int>/sprints/<sprint_id:int>")
def update_sprint(project_id, sprint_id):
    data = request.json or {}
    with get_db() as conn:
        sprint = conn.execute("SELECT * FROM sprints WHERE id = ? AND project_id = ?", (sprint_id, project_id)).fetchone()
        if not sprint:
            return json_response({"error": "Sprint not found"}, status=404)
        
        name = data.get("name", sprint["name"])
        goal = data.get("goal", sprint["goal"])
        start_date = data.get("start_date", sprint["start_date"])
        end_date = data.get("end_date", sprint["end_date"])
        status = data.get("status", sprint["status"])

        if status == "active" and sprint["status"] != "active":
            conn.execute("UPDATE sprints SET status = 'planning' WHERE project_id = ? AND status = 'active'", (project_id,))

        conn.execute("""
            UPDATE sprints SET name = ?, goal = ?, start_date = ?, end_date = ?, status = ?
            WHERE id = ?
        """, (name, goal, start_date, end_date, status, sprint_id))

        record_activity(conn, project_id, "Manager", "Sprint Updated", f'Updated sprint "{name}" ({status})')
        updated = conn.execute("SELECT * FROM sprints WHERE id = ?", (sprint_id,)).fetchone()
        return json_response(updated)

@app.delete("/api/projects/<project_id:int>/sprints/<sprint_id:int>")
def delete_sprint(project_id, sprint_id):
    with get_db() as conn:
        conn.execute("DELETE FROM sprints WHERE id = ? AND project_id = ?", (sprint_id, project_id))
        return json_response({"success": True})

# ==================== MILESTONES ====================

@app.get("/api/projects/<project_id:int>/milestones")
def get_milestones(project_id):
    with get_db() as conn:
        milestones = conn.execute("SELECT * FROM milestones WHERE project_id = ? ORDER BY due_date ASC", (project_id,)).fetchall()
        return json_response(milestones)

@app.post("/api/projects/<project_id:int>/milestones")
def create_milestone(project_id):
    data = request.json or {}
    title = data.get("title", "").strip()
    due_date = data.get("due_date", "").strip()
    if not title or not due_date:
        return json_response({"error": "Title and due date are required"}, status=400)
    
    status = data.get("status", "pending")
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO milestones (project_id, title, due_date, status)
            VALUES (?, ?, ?, ?)
        """, (project_id, title, due_date, status))
        m_id = cursor.lastrowid
        record_activity(conn, project_id, "Lead", "Milestone Added", f'Added milestone "{title}"')
        m = conn.execute("SELECT * FROM milestones WHERE id = ?", (m_id,)).fetchone()
        return json_response(m, status=201)

@app.put("/api/projects/<project_id:int>/milestones/<milestone_id:int>")
def update_milestone(project_id, milestone_id):
    data = request.json or {}
    with get_db() as conn:
        m = conn.execute("SELECT * FROM milestones WHERE id = ? AND project_id = ?", (milestone_id, project_id)).fetchone()
        if not m:
            return json_response({"error": "Milestone not found"}, status=404)
        
        title = data.get("title", m["title"])
        due_date = data.get("due_date", m["due_date"])
        status = data.get("status", m["status"])

        conn.execute("UPDATE milestones SET title = ?, due_date = ?, status = ? WHERE id = ?", (title, due_date, status, milestone_id))
        updated = conn.execute("SELECT * FROM milestones WHERE id = ?", (milestone_id,)).fetchone()
        return json_response(updated)

@app.delete("/api/projects/<project_id:int>/milestones/<milestone_id:int>")
def delete_milestone(project_id, milestone_id):
    with get_db() as conn:
        conn.execute("DELETE FROM milestones WHERE id = ? AND project_id = ?", (milestone_id, project_id))
        return json_response({"success": True})

# ==================== TASKS ====================

@app.get("/api/projects/<project_id:int>/tasks")
def get_tasks(project_id):
    sprint_id = request.query.get("sprint_id")
    status = request.query.get("status")
    priority = request.query.get("priority")
    assignee_id = request.query.get("assignee_id")
    search = request.query.get("search")

    with get_db() as conn:
        query = """
            SELECT t.*,
                m.name as assignee_name, m.avatar_color as assignee_avatar, m.role as assignee_role,
                s.name as sprint_name,
                (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id) as subtask_count,
                (SELECT COUNT(*) FROM subtasks WHERE task_id = t.id AND completed = 1) as subtask_completed_count,
                (SELECT COALESCE(SUM(hours), 0) FROM timelogs WHERE task_id = t.id) as logged_hours_sum
            FROM tasks t
            LEFT JOIN members m ON t.assignee_id = m.id
            LEFT JOIN sprints s ON t.sprint_id = s.id
            WHERE t.project_id = ?
        """
        params = [project_id]

        if sprint_id:
            if sprint_id == "backlog":
                query += " AND t.sprint_id IS NULL"
            elif sprint_id.isdigit():
                query += " AND t.sprint_id = ?"
                params.append(int(sprint_id))

        if status:
            query += " AND t.status = ?"
            params.append(status)

        if priority:
            query += " AND t.priority = ?"
            params.append(priority)

        if assignee_id and assignee_id.isdigit():
            query += " AND t.assignee_id = ?"
            params.append(int(assignee_id))

        if search:
            query += " AND (t.title LIKE ? OR t.description LIKE ? OR t.tags LIKE ?)"
            s_param = f"%{search}%"
            params.extend([s_param, s_param, s_param])

        query += " ORDER BY t.order_index ASC, t.id ASC"
        tasks = conn.execute(query, params).fetchall()

        result = []
        for t in tasks:
            t_dict = dict(t)
            try:
                t_dict["tags"] = json.loads(t_dict["tags"]) if t_dict["tags"] else []
            except Exception:
                t_dict["tags"] = []
            
            subtasks = conn.execute("SELECT * FROM subtasks WHERE task_id = ? ORDER BY order_index ASC", (t["id"],)).fetchall()
            t_dict["subtasks_list"] = subtasks
            result.append(t_dict)

        return json_response(result)

@app.post("/api/projects/<project_id:int>/tasks")
def create_task(project_id):
    data = request.json or {}
    title = data.get("title", "").strip()
    if not title:
        return json_response({"error": "Task title is required"}, status=400)
    
    desc = data.get("description", "")
    status = data.get("status", "todo")
    priority = data.get("priority", "medium")
    sprint_id = data.get("sprint_id")
    assignee_id = data.get("assignee_id")
    start_date = data.get("start_date")
    due_date = data.get("due_date")
    est_hours = float(data.get("estimated_hours") or 0.0)
    tags = data.get("tags", [])
    tags_json = json.dumps(tags if isinstance(tags, list) else [])
    subtasks = data.get("subtasks", [])
    now_str = get_now_iso()

    with get_db() as conn:
        cursor = conn.cursor()
        max_order = conn.execute(
            "SELECT COALESCE(MAX(order_index), -1) as max_idx FROM tasks WHERE project_id = ? AND status = ?",
            (project_id, status)
        ).fetchone()["max_idx"]
        next_order = max_order + 1

        cursor.execute("""
            INSERT INTO tasks (
                project_id, sprint_id, title, description, status, priority,
                order_index, start_date, due_date, estimated_hours, actual_hours,
                assignee_id, tags, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            project_id, sprint_id, title, desc, status, priority,
            next_order, start_date, due_date, est_hours, 0.0,
            assignee_id, tags_json, now_str, now_str
        ))
        t_id = cursor.lastrowid

        if isinstance(subtasks, list):
            for idx, sub_title in enumerate(subtasks):
                if isinstance(sub_title, str) and sub_title.strip():
                    cursor.execute("""
                        INSERT INTO subtasks (task_id, title, completed, order_index)
                        VALUES (?, ?, 0, ?)
                    """, (t_id, sub_title.strip(), idx))

        record_activity(conn, project_id, "User", "Task Created", f'Created task "{title}"', task_id=t_id)

        if assignee_id:
            try:
                notify_task_assigned(conn, t_id)
            except Exception as e:
                print(f"[Notifier] Error sending assignment notification: {e}")

    return get_task(t_id)

@app.get("/api/tasks/<task_id:int>")
def get_task(task_id):
    with get_db() as conn:
        task = conn.execute("""
            SELECT t.*,
                m.name as assignee_name, m.avatar_color as assignee_avatar, m.role as assignee_role,
                s.name as sprint_name,
                p.name as project_name, p.color as project_color
            FROM tasks t
            LEFT JOIN members m ON t.assignee_id = m.id
            LEFT JOIN sprints s ON t.sprint_id = s.id
            JOIN projects p ON t.project_id = p.id
            WHERE t.id = ?
        """, (task_id,)).fetchone()

        if not task:
            return json_response({"error": "Task not found"}, status=404)

        t_dict = dict(task)
        try:
            t_dict["tags"] = json.loads(t_dict["tags"]) if t_dict["tags"] else []
        except Exception:
            t_dict["tags"] = []

        t_dict["subtasks"] = conn.execute("SELECT * FROM subtasks WHERE task_id = ? ORDER BY order_index ASC", (task_id,)).fetchall()
        t_dict["timelogs"] = conn.execute("""
            SELECT tl.*, m.name as member_name, m.avatar_color as member_avatar
            FROM timelogs tl
            LEFT JOIN members m ON tl.member_id = m.id
            WHERE tl.task_id = ?
            ORDER BY tl.logged_date DESC, tl.id DESC
        """, (task_id,)).fetchall()
        t_dict["activities"] = conn.execute("SELECT * FROM activity_logs WHERE task_id = ? ORDER BY timestamp DESC LIMIT 20", (task_id,)).fetchall()

        return json_response(t_dict)

@app.put("/api/tasks/<task_id:int>")
def update_task(task_id):
    data = request.json or {}
    with get_db() as conn:
        task = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not task:
            return json_response({"error": "Task not found"}, status=404)

        project_id = task["project_id"]
        
        title = data["title"].strip() if "title" in data and data["title"] else task["title"]
        desc = data["description"] if "description" in data else task["description"]
        status = data["status"] if "status" in data else task["status"]
        priority = data["priority"] if "priority" in data else task["priority"]
        
        sprint_val = data["sprint_id"] if "sprint_id" in data else task["sprint_id"]
        sprint_id = int(sprint_val) if sprint_val and str(sprint_val).isdigit() else None
        
        assignee_val = data["assignee_id"] if "assignee_id" in data else task["assignee_id"]
        assignee_id = int(assignee_val) if assignee_val and str(assignee_val).isdigit() else None
        
        order_index = int(data["order_index"]) if "order_index" in data else task["order_index"]
        
        start_date = data["start_date"] if "start_date" in data else task["start_date"]
        if start_date == "":
            start_date = None
            
        due_date = data["due_date"] if "due_date" in data else task["due_date"]
        if due_date == "":
            due_date = None
            
        est_hours = float(data["estimated_hours"]) if "estimated_hours" in data and data["estimated_hours"] is not None else float(task["estimated_hours"] or 0)
        act_hours = float(data["actual_hours"]) if "actual_hours" in data and data["actual_hours"] is not None else float(task["actual_hours"] or 0)
        
        tags_json = json.dumps(data["tags"] if isinstance(data.get("tags"), list) else []) if "tags" in data else task["tags"]
        now_str = get_now_iso()

        conn.execute("""
            UPDATE tasks SET
                title = ?, description = ?, status = ?, priority = ?, sprint_id = ?,
                assignee_id = ?, order_index = ?, start_date = ?, due_date = ?,
                estimated_hours = ?, actual_hours = ?, tags = ?, updated_at = ?
            WHERE id = ?
        """, (
            title, desc, status, priority, sprint_id,
            assignee_id, order_index, start_date, due_date,
            est_hours, act_hours, tags_json, now_str, task_id
        ))

        changes = []
        if status != task["status"]:
            changes.append(f'status: {task["status"]} -> {status}')
        if priority != task["priority"]:
            changes.append(f'priority: {task["priority"]} -> {priority}')
        if start_date != task["start_date"]:
            changes.append(f'start_date: {task["start_date"]} -> {start_date}')
        if due_date != task["due_date"]:
            changes.append(f'due_date: {task["due_date"]} -> {due_date}')
        
        details = ", ".join(changes) if changes else "Updated task fields"
        record_activity(conn, project_id, "User", "Task Updated", f'Task "{title}": {details}', task_id=task_id)

        # Trigger Action 4 (Task Assignment) if assignee changed
        if assignee_id and assignee_id != task["assignee_id"]:
            try:
                notify_task_assigned(conn, task_id, previous_assignee_id=task["assignee_id"])
            except Exception as e:
                print(f"[Notifier] Error sending assignment notification: {e}")

        # Trigger Action 5 (Task Completed) if status changed to done
        if status == "done" and task["status"] != "done":
            try:
                notify_task_completed(conn, task_id, actor_name="User")
            except Exception as e:
                print(f"[Notifier] Error sending completion notification: {e}")

    return get_task(task_id)

@app.post("/api/tasks/reorder")
def reorder_tasks():
    items = request.json or []
    if not isinstance(items, list):
        return json_response({"error": "Expected array of items"}, status=400)
    
    with get_db() as conn:
        for item in items:
            t_id = item.get("task_id")
            status = item.get("status")
            order_idx = item.get("new_order_index", 0)
            if t_id and status:
                prev_task = conn.execute("SELECT status FROM tasks WHERE id = ?", (t_id,)).fetchone()
                conn.execute("""
                    UPDATE tasks SET status = ?, order_index = ?, updated_at = ?
                    WHERE id = ?
                """, (status, order_idx, get_now_iso(), t_id))
                if status == "done" and prev_task and prev_task["status"] != "done":
                    try:
                        notify_task_completed(conn, t_id, actor_name="User")
                    except Exception as e:
                        print(f"[Notifier] Error sending completion notification: {e}")
        return json_response({"success": True})

@app.delete("/api/tasks/<task_id:int>")
def delete_task(task_id):
    with get_db() as conn:
        task = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not task:
            return json_response({"error": "Task not found"}, status=404)
        record_activity(conn, task["project_id"], "User", "Task Deleted", f'Deleted task "{task["title"]}"')
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        return json_response({"success": True})

# ==================== SUBTASKS ====================

@app.post("/api/tasks/<task_id:int>/subtasks")
def add_subtask(task_id):
    data = request.json or {}
    title = data.get("title", "").strip()
    if not title:
        return json_response({"error": "Subtask title is required"}, status=400)
    
    completed = 1 if data.get("completed") else 0
    with get_db() as conn:
        task = conn.execute("SELECT project_id FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not task:
            return json_response({"error": "Task not found"}, status=404)
        
        max_idx = conn.execute("SELECT COALESCE(MAX(order_index), -1) as m FROM subtasks WHERE task_id = ?", (task_id,)).fetchone()["m"]
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO subtasks (task_id, title, completed, order_index)
            VALUES (?, ?, ?, ?)
        """, (task_id, title, completed, max_idx + 1))
        s_id = cursor.lastrowid
        subtask = conn.execute("SELECT * FROM subtasks WHERE id = ?", (s_id,)).fetchone()
        return json_response(subtask, status=201)

@app.put("/api/subtasks/<subtask_id:int>")
def update_subtask(subtask_id):
    data = request.json or {}
    with get_db() as conn:
        sub = conn.execute("SELECT * FROM subtasks WHERE id = ?", (subtask_id,)).fetchone()
        if not sub:
            return json_response({"error": "Subtask not found"}, status=404)
        
        title = data.get("title", sub["title"])
        completed = (1 if data.get("completed") else 0) if "completed" in data else sub["completed"]

        conn.execute("UPDATE subtasks SET title = ?, completed = ? WHERE id = ?", (title, completed, subtask_id))
        updated = conn.execute("SELECT * FROM subtasks WHERE id = ?", (subtask_id,)).fetchone()
        return json_response(updated)

@app.delete("/api/subtasks/<subtask_id:int>")
def delete_subtask(subtask_id):
    with get_db() as conn:
        conn.execute("DELETE FROM subtasks WHERE id = ?", (subtask_id,))
        return json_response({"success": True})

# ==================== TIME LOGS ====================

@app.post("/api/tasks/<task_id:int>/timelogs")
def add_timelog(task_id):
    data = request.json or {}
    hours = float(data.get("hours") or 0.0)
    if hours <= 0:
        return json_response({"error": "Valid hours required"}, status=400)
    
    member_id = data.get("member_id")
    desc = data.get("description", "")
    logged_date = data.get("logged_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    now_str = get_now_iso()

    with get_db() as conn:
        task = conn.execute("SELECT project_id, title FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not task:
            return json_response({"error": "Task not found"}, status=404)
        
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO timelogs (task_id, member_id, hours, description, logged_date, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (task_id, member_id, hours, desc, logged_date, now_str))
        log_id = cursor.lastrowid

        total_hours = conn.execute("SELECT COALESCE(SUM(hours), 0) as s FROM timelogs WHERE task_id = ?", (task_id,)).fetchone()["s"]
        conn.execute("UPDATE tasks SET actual_hours = ?, updated_at = ? WHERE id = ?", (total_hours, now_str, task_id))

        record_activity(conn, task["project_id"], "User", "Time Logged", f'Logged {hours}h on "{task["title"]}"', task_id=task_id)

        log_row = conn.execute("""
            SELECT tl.*, m.name as member_name, m.avatar_color as member_avatar
            FROM timelogs tl
            LEFT JOIN members m ON tl.member_id = m.id
            WHERE tl.id = ?
        """, (log_id,)).fetchone()
        return json_response(log_row, status=201)

@app.delete("/api/timelogs/<log_id:int>")
def delete_timelog(log_id):
    with get_db() as conn:
        log = conn.execute("SELECT * FROM timelogs WHERE id = ?", (log_id,)).fetchone()
        if not log:
            return json_response({"error": "Time log not found"}, status=404)
        
        task_id = log["task_id"]
        conn.execute("DELETE FROM timelogs WHERE id = ?", (log_id,))
        
        total_hours = conn.execute("SELECT COALESCE(SUM(hours), 0) as s FROM timelogs WHERE task_id = ?", (task_id,)).fetchone()["s"]
        conn.execute("UPDATE tasks SET actual_hours = ?, updated_at = ? WHERE id = ?", (total_hours, get_now_iso(), task_id))
        return json_response({"success": True})

@app.get("/api/projects/<project_id:int>/timelogs")
def get_project_timelogs(project_id):
    with get_db() as conn:
        logs = conn.execute("""
            SELECT tl.*, t.title as task_title, t.priority as task_priority, m.name as member_name, m.avatar_color as member_avatar
            FROM timelogs tl
            JOIN tasks t ON tl.task_id = t.id
            LEFT JOIN members m ON tl.member_id = m.id
            WHERE t.project_id = ?
            ORDER BY tl.logged_date DESC, tl.id DESC
        """, (project_id,)).fetchall()
        return json_response(logs)

# ==================== ANALYTICS ====================

@app.get("/api/projects/<project_id:int>/analytics")
def get_analytics(project_id):
    sprint_id = request.query.get("sprint_id")
    with get_db() as conn:
        if sprint_id and sprint_id.isdigit():
            sprint = conn.execute("SELECT * FROM sprints WHERE id = ? AND project_id = ?", (int(sprint_id), project_id)).fetchone()
        else:
            sprint = conn.execute("SELECT * FROM sprints WHERE project_id = ? AND status = 'active' ORDER BY start_date DESC LIMIT 1", (project_id,)).fetchone()
            if not sprint:
                sprint = conn.execute("SELECT * FROM sprints WHERE project_id = ? ORDER BY start_date DESC LIMIT 1", (project_id,)).fetchone()

        status_counts = conn.execute("""
            SELECT status, COUNT(*) as count, COALESCE(SUM(estimated_hours), 0) as est_hours, COALESCE(SUM(actual_hours), 0) as act_hours
            FROM tasks
            WHERE project_id = ?
            GROUP BY status
        """, (project_id,)).fetchall()

        priority_counts = conn.execute("""
            SELECT priority, COUNT(*) as count
            FROM tasks
            WHERE project_id = ?
            GROUP BY priority
        """, (project_id,)).fetchall()

        workload = conn.execute("""
            SELECT m.id, m.name, m.role, m.avatar_color,
                COUNT(t.id) as assigned_tasks,
                COUNT(CASE WHEN t.status = 'done' THEN 1 END) as completed_tasks,
                COALESCE(SUM(t.estimated_hours), 0) as total_est_hours,
                COALESCE(SUM(t.actual_hours), 0) as total_act_hours
            FROM members m
            LEFT JOIN tasks t ON m.id = t.assignee_id AND t.project_id = ?
            WHERE m.project_id = ?
            GROUP BY m.id
            ORDER BY assigned_tasks DESC
        """, (project_id, project_id)).fetchall()

        kpi_row = conn.execute("""
            SELECT
                COUNT(*) as total_tasks,
                COUNT(CASE WHEN status = 'done' THEN 1 END) as done_tasks,
                COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_tasks,
                COUNT(CASE WHEN status != 'done' AND due_date < date('now') AND due_date IS NOT NULL THEN 1 END) as overdue_tasks,
                COALESCE(SUM(estimated_hours), 0) as total_est_hours,
                COALESCE(SUM(actual_hours), 0) as total_act_hours
            FROM tasks
            WHERE project_id = ?
        """, (project_id,)).fetchone()

        total = kpi_row["total_tasks"] or 0
        done = kpi_row["done_tasks"] or 0
        completion_rate = round((done / total * 100), 1) if total > 0 else 0

        burndown_data = {"labels": [], "ideal": [], "actual": [], "sprint_name": sprint["name"] if sprint else "No active sprint"}

        if sprint and sprint["start_date"] and sprint["end_date"]:
            try:
                start = datetime.strptime(sprint["start_date"], "%Y-%m-%d")
                end = datetime.strptime(sprint["end_date"], "%Y-%m-%d")
                days_total = max((end - start).days, 1)
                
                sprint_tasks_total_est = conn.execute(
                    "SELECT COALESCE(SUM(estimated_hours), 0) as s FROM tasks WHERE sprint_id = ?",
                    (sprint["id"],)
                ).fetchone()["s"] or 40.0

                labels = []
                ideal = []
                actual = []
                today = datetime.now()

                for i in range(days_total + 1):
                    day_dt = start + timedelta(days=i)
                    labels.append(day_dt.strftime("%b %d"))
                    
                    ideal_val = round(sprint_tasks_total_est * (1 - (i / days_total)), 1)
                    ideal.append(max(ideal_val, 0))

                    if day_dt.date() <= (today + timedelta(days=1)).date():
                        completed_by_day = conn.execute("""
                            SELECT COALESCE(SUM(hours), 0) as s FROM timelogs tl
                            JOIN tasks t ON tl.task_id = t.id
                            WHERE t.sprint_id = ? AND tl.logged_date <= ?
                        """, (sprint["id"], day_dt.strftime("%Y-%m-%d"))).fetchone()["s"]
                        actual_val = max(round(sprint_tasks_total_est - completed_by_day, 1), 0)
                        actual.append(actual_val)

                burndown_data = {
                    "labels": labels,
                    "ideal": ideal,
                    "actual": actual,
                    "sprint_name": sprint["name"]
                }
            except Exception:
                pass

        result = {
            "kpis": {
                **dict(kpi_row),
                "completion_rate": completion_rate,
                "sprint_name": sprint["name"] if sprint else "No active sprint"
            },
            "status_distribution": status_counts,
            "priority_distribution": priority_counts,
            "workload": workload,
            "burndown": burndown_data
        }
        return json_response(result)

@app.get("/api/projects/<project_id:int>/activity")
def get_activity(project_id):
    with get_db() as conn:
        acts = conn.execute("""
            SELECT a.*, t.title as task_title
            FROM activity_logs a
            LEFT JOIN tasks t ON a.task_id = t.id
            WHERE a.project_id = ?
            ORDER BY a.timestamp DESC
            LIMIT 40
        """, (project_id,)).fetchall()
        return json_response(acts)

# ==================== EXPORT & IMPORT ====================

@app.get("/api/projects/<project_id:int>/export")
def export_project(project_id):
    with get_db() as conn:
        project = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        if not project:
            return json_response({"error": "Project not found"}, status=404)
        
        members = conn.execute("SELECT * FROM members WHERE project_id = ?", (project_id,)).fetchall()
        sprints = conn.execute("SELECT * FROM sprints WHERE project_id = ?", (project_id,)).fetchall()
        milestones = conn.execute("SELECT * FROM milestones WHERE project_id = ?", (project_id,)).fetchall()
        tasks = conn.execute("SELECT * FROM tasks WHERE project_id = ?", (project_id,)).fetchall()

        all_tasks = []
        for t in tasks:
            t_dict = dict(t)
            t_dict["subtasks"] = conn.execute("SELECT * FROM subtasks WHERE task_id = ?", (t["id"],)).fetchall()
            t_dict["timelogs"] = conn.execute("SELECT * FROM timelogs WHERE task_id = ?", (t["id"],)).fetchall()
            all_tasks.append(t_dict)

        export_data = {
            "version": "1.0",
            "exported_at": get_now_iso(),
            "project": project,
            "members": members,
            "sprints": sprints,
            "milestones": milestones,
            "tasks": all_tasks
        }
        return json_response(export_data)

@app.post("/api/projects/import")
def import_project():
    data = request.json or {}
    p_data = data.get("project", {})
    if not p_data or "name" not in p_data:
        return json_response({"error": "Invalid project import structure"}, status=400)

    now_str = get_now_iso()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO projects (name, description, color, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
        """, (
            p_data.get("name") + " (Imported)",
            p_data.get("description", ""),
            p_data.get("color", "#3B82F6"),
            now_str,
            now_str
        ))
        new_p_id = cursor.lastrowid

        member_map = {}
        for m in data.get("members", []):
            cursor.execute("""
                INSERT INTO members (project_id, name, email, role, avatar_color)
                VALUES (?, ?, ?, ?, ?)
            """, (new_p_id, m["name"], m.get("email", ""), m.get("role", "Member"), m.get("avatar_color", "#6366F1")))
            member_map[m["id"]] = cursor.lastrowid

        sprint_map = {}
        for s in data.get("sprints", []):
            cursor.execute("""
                INSERT INTO sprints (project_id, name, goal, start_date, end_date, status)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (new_p_id, s["name"], s.get("goal", ""), s.get("start_date"), s.get("end_date"), s.get("status", "planning")))
            sprint_map[s["id"]] = cursor.lastrowid

        for m in data.get("milestones", []):
            cursor.execute("""
                INSERT INTO milestones (project_id, title, due_date, status)
                VALUES (?, ?, ?, ?)
            """, (new_p_id, m["title"], m["due_date"], m.get("status", "pending")))

        for t in data.get("tasks", []):
            new_sprint_id = sprint_map.get(t.get("sprint_id"))
            new_assignee_id = member_map.get(t.get("assignee_id"))
            cursor.execute("""
                INSERT INTO tasks (
                    project_id, sprint_id, title, description, status, priority,
                    order_index, start_date, due_date, estimated_hours, actual_hours,
                    assignee_id, tags, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                new_p_id, new_sprint_id, t["title"], t.get("description", ""),
                t.get("status", "todo"), t.get("priority", "medium"), t.get("order_index", 0),
                t.get("start_date"), t.get("due_date"), t.get("estimated_hours", 0.0),
                t.get("actual_hours", 0.0), new_assignee_id, json.dumps(t.get("tags", [])),
                now_str, now_str
            ))
            new_t_id = cursor.lastrowid

            for sub in t.get("subtasks", []):
                cursor.execute("""
                    INSERT INTO subtasks (task_id, title, completed, order_index)
                    VALUES (?, ?, ?, ?)
                """, (new_t_id, sub["title"], sub.get("completed", 0), sub.get("order_index", 0)))

            for tl in t.get("timelogs", []):
                new_m_id = member_map.get(tl.get("member_id"))
                cursor.execute("""
                    INSERT INTO timelogs (task_id, member_id, hours, description, logged_date, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (new_t_id, new_m_id, tl["hours"], tl.get("description", ""), tl.get("logged_date", now_str[:10]), now_str))

        record_activity(conn, new_p_id, "System", "Project Imported", "Imported project backup")
        return json_response({"success": True, "project_id": new_p_id})

# ==================== GANTT EXCEL / CSV UPLOAD ====================

@app.get("/api/gantt/sample_csv")
def get_sample_gantt_csv():
    response.content_type = "text/csv; charset=utf-8"
    response.headers["Content-Disposition"] = "attachment; filename=\"sample_gantt_schedule.csv\""
    return generate_sample_gantt_csv()

@app.get("/api/gantt/sample_xlsx")
def get_sample_gantt_xlsx():
    response.content_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    response.headers["Content-Disposition"] = "attachment; filename=\"sample_gantt_schedule.xlsx\""
    return generate_sample_gantt_excel()

@app.post("/api/projects/<project_id:int>/upload_gantt")
def upload_gantt_file(project_id):
    upload = request.files.get("file")
    if not upload:
        return json_response({"error": "No file uploaded"}, status=400)

    filename = upload.filename or "gantt.xlsx"
    file_bytes = upload.file.read()
    
    new_project_name = request.forms.get("new_project_name", "").strip()
    mode = request.forms.get("mode", "append")

    try:
        parsed = parse_gantt_file(file_bytes, filename)
    except Exception as err:
        return json_response({"error": f"Failed to parse Gantt file: {str(err)}"}, status=400)

    tasks_data = parsed["tasks"]
    if not tasks_data:
        return json_response({"error": "No valid task rows found in uploaded file"}, status=400)

    now_str = get_now_iso()

    with get_db() as conn:
        cursor = conn.cursor()
        
        target_p_id = project_id
        if new_project_name:
            cursor.execute("""
                INSERT INTO projects (name, description, color, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
            """, (new_project_name, f"Imported from {filename}", "#3B82F6", now_str, now_str))
            target_p_id = cursor.lastrowid
        else:
            project = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
            if not project:
                return json_response({"error": "Project not found"}, status=404)
            if mode == "replace":
                conn.execute("DELETE FROM tasks WHERE project_id = ?", (project_id,))

        # Match or create members
        existing_members = conn.execute("SELECT id, name FROM members WHERE project_id = ?", (target_p_id,)).fetchall()
        member_map = {m["name"].lower(): m["id"] for m in existing_members}
        new_members_count = 0

        for idx, m_name in enumerate(parsed["members_found"]):
            if m_name.lower() not in member_map:
                color = AVATAR_COLORS[idx % len(AVATAR_COLORS)]
                cursor.execute("""
                    INSERT INTO members (project_id, name, email, role, avatar_color)
                    VALUES (?, ?, ?, ?, ?)
                """, (target_p_id, m_name, f"{m_name.lower().replace(' ', '.')}@company.internal", "Contributor", color))
                new_m_id = cursor.lastrowid
                member_map[m_name.lower()] = new_m_id
                new_members_count += 1

        # Match or create sprints / phases
        existing_sprints = conn.execute("SELECT id, name FROM sprints WHERE project_id = ?", (target_p_id,)).fetchall()
        sprint_map = {s["name"].lower(): s["id"] for s in existing_sprints}
        new_sprints_count = 0

        for s_name in parsed["sprints_found"]:
            if s_name.lower() not in sprint_map:
                s_tasks = [t for t in tasks_data if t.get("sprint_name") == s_name]
                starts = [t["start_date"] for t in s_tasks if t.get("start_date")]
                ends = [t["due_date"] for t in s_tasks if t.get("due_date")]
                min_s = min(starts) if starts else now_str[:10]
                max_e = max(ends) if ends else (datetime.now() + timedelta(days=14)).strftime("%Y-%m-%d")

                cursor.execute("""
                    INSERT INTO sprints (project_id, name, goal, start_date, end_date, status)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (target_p_id, s_name, f"Phase goals for {s_name}", min_s, max_e, "active" if new_sprints_count == 0 else "planning"))
                new_s_id = cursor.lastrowid
                sprint_map[s_name.lower()] = new_s_id
                new_sprints_count += 1

        # Insert tasks
        max_order = conn.execute(
            "SELECT COALESCE(MAX(order_index), -1) as m FROM tasks WHERE project_id = ?",
            (target_p_id,)
        ).fetchone()["m"]

        for idx, t in enumerate(tasks_data):
            assignee_id = member_map.get(t["assignee_name"].lower()) if t.get("assignee_name") else None
            sprint_id = sprint_map.get(t["sprint_name"].lower()) if t.get("sprint_name") else None
            tags_json = json.dumps(t.get("tags") or [])

            cursor.execute("""
                INSERT INTO tasks (
                    project_id, sprint_id, title, description, status, priority,
                    order_index, start_date, due_date, estimated_hours, actual_hours,
                    assignee_id, tags, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                target_p_id, sprint_id, t["title"], t.get("description", ""),
                t.get("status", "todo"), t.get("priority", "medium"),
                max_order + idx + 1, t.get("start_date"), t.get("due_date"),
                float(t.get("estimated_hours") or 0.0), 0.0,
                assignee_id, tags_json, now_str, now_str
            ))

        record_activity(
            conn, target_p_id, "User", "Gantt Upload",
            f"Imported {len(tasks_data)} tasks with {len(parsed['members_found'])} assigned members from '{filename}'"
        )

        return json_response({
            "success": True,
            "tasks_imported": len(tasks_data),
            "members_added": new_members_count,
            "sprints_added": new_sprints_count,
            "project_id": target_p_id,
            "message": f"Successfully imported {len(tasks_data)} tasks with assigned members!"
        })

@app.post("/api/seed/reset")
def reset_database():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DROP TABLE IF EXISTS activity_logs")
        cursor.execute("DROP TABLE IF EXISTS timelogs")
        cursor.execute("DROP TABLE IF EXISTS subtasks")
        cursor.execute("DROP TABLE IF EXISTS tasks")
        cursor.execute("DROP TABLE IF EXISTS milestones")
        cursor.execute("DROP TABLE IF EXISTS sprints")
        cursor.execute("DROP TABLE IF EXISTS members")
        cursor.execute("DROP TABLE IF EXISTS projects")
        cursor.execute("DROP TABLE IF EXISTS notification_dispatches")
        cursor.execute("DROP TABLE IF EXISTS email_logs")
        cursor.execute("DROP TABLE IF EXISTS email_settings")
    init_db()
    seed_database()
    return json_response({"success": True, "message": "Database reset and demo data loaded"})

# ==================== NOTIFICATIONS & OUTLOOK INTEGRATION ====================

@app.get("/api/notifications/settings")
def get_notification_settings():
    with get_db() as conn:
        settings = get_settings(conn)
        masked = dict(settings)
        if masked.get("smtp_pass"):
            masked["has_password"] = True
            masked["smtp_pass"] = "••••••••"
        else:
            masked["has_password"] = False
        return json_response(masked)

@app.put("/api/notifications/settings")
def update_notification_settings():
    data = request.json or {}
    with get_db() as conn:
        current = get_settings(conn)
        
        provider = data.get("smtp_provider", current.get("smtp_provider", "outlook"))
        host = data.get("smtp_host", current.get("smtp_host", "smtp.office365.com"))
        port = int(data.get("smtp_port", current.get("smtp_port", 587)))
        user = data.get("smtp_user", current.get("smtp_user", ""))
        
        new_pass = data.get("smtp_pass")
        if new_pass is None or new_pass == "••••••••" or new_pass == "":
            password = current.get("smtp_pass", "")
        else:
            password = new_pass
            
        sender_name = data.get("sender_name", current.get("sender_name", "ProjectPulse Notifications"))
        use_tls = int(data.get("use_tls", current.get("use_tls", 1)))
        is_enabled = int(data.get("is_enabled", current.get("is_enabled", 1)))
        simulation_mode = int(data.get("simulation_mode", current.get("simulation_mode", 1)))
        notify_due_soon = int(data.get("notify_due_soon", current.get("notify_due_soon", 1)))
        notify_due_today = int(data.get("notify_due_today", current.get("notify_due_today", 1)))
        notify_overdue = int(data.get("notify_overdue", current.get("notify_overdue", 1)))
        recurring_day = data.get("recurring_day", current.get("recurring_day", "monday")).lower()
        notify_assigned = int(data.get("notify_assigned", current.get("notify_assigned", 1)))
        notify_completed = int(data.get("notify_completed", current.get("notify_completed", 1)))
        now_str = get_now_iso()

        conn.execute("""
            UPDATE email_settings SET
                smtp_provider = ?, smtp_host = ?, smtp_port = ?, smtp_user = ?,
                smtp_pass = ?, sender_name = ?, use_tls = ?, is_enabled = ?,
                simulation_mode = ?, notify_due_soon = ?, notify_due_today = ?,
                notify_overdue = ?, recurring_day = ?, notify_assigned = ?,
                notify_completed = ?, updated_at = ?
            WHERE id = 1
        """, (
            provider, host, port, user, password, sender_name, use_tls,
            is_enabled, simulation_mode, notify_due_soon, notify_due_today,
            notify_overdue, recurring_day, notify_assigned, notify_completed, now_str
        ))

        updated = get_settings(conn)
        masked = dict(updated)
        if masked.get("smtp_pass"):
            masked["has_password"] = True
            masked["smtp_pass"] = "••••••••"
        else:
            masked["has_password"] = False
        return json_response(masked)

@app.post("/api/notifications/test_email")
def test_email_endpoint():
    data = request.json or {}
    email = data.get("email", "").strip()
    if not email or "@" not in email:
        return json_response({"error": "Valid email address is required"}, status=400)

    with get_db() as conn:
        result = send_test_email(conn, email)
        return json_response(result)

@app.post("/api/notifications/run_checks")
def run_due_date_checks_endpoint():
    data = request.json or {}
    ref_date = data.get("reference_date")
    with get_db() as conn:
        dispatched = run_all_due_date_checks(conn, reference_date_str=ref_date)
        return json_response({
            "success": True,
            "checks_run_at": get_now_iso(),
            "notifications_dispatched": len(dispatched),
            "details": dispatched
        })

@app.get("/api/notifications/logs")
def get_notification_logs():
    limit = int(request.query.get("limit", 50))
    with get_db() as conn:
        logs = conn.execute("""
            SELECT l.id, l.project_id, l.task_id, l.recipient_email, l.recipient_name,
                   l.subject, l.trigger_type, l.status, l.error_message, l.sent_at,
                   p.name as project_name, t.title as task_title
            FROM email_logs l
            LEFT JOIN projects p ON l.project_id = p.id
            LEFT JOIN tasks t ON l.task_id = t.id
            ORDER BY l.sent_at DESC, l.id DESC
            LIMIT ?
        """, (limit,)).fetchall()
        return json_response(logs)

@app.get("/api/notifications/logs/<log_id:int>")
def get_notification_log_detail(log_id):
    with get_db() as conn:
        log = conn.execute("""
            SELECT l.*, p.name as project_name, t.title as task_title
            FROM email_logs l
            LEFT JOIN projects p ON l.project_id = p.id
            LEFT JOIN tasks t ON l.task_id = t.id
            WHERE l.id = ?
        """, (log_id,)).fetchone()
        if not log:
            return json_response({"error": "Log not found"}, status=404)
        return json_response(dict(log))

def init_app():
    init_db()
    seed_database()
    start_background_scheduler()

# Auto-initialize on module load (WSGI / Gunicorn / Bottle)
_initialized = False
if not _initialized:
    init_app()
    _initialized = True

def main():
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"============================================================")
    print(f"  ProjectPulse High-Availability Server (Multi-threaded)")
    print(f"  Listening on: http://{host}:{port}")
    print(f"  -> Local access: http://localhost:{port}")
    print(f"  -> Network access: http://<YOUR_WIFI_IP>:{port}")
    print(f"============================================================")
    try:
        from waitress import serve
        serve(app, host=host, port=port, threads=8)
    except ImportError:
        run(app, host=host, port=port, reloader=False)

if __name__ == "__main__":
    main()

