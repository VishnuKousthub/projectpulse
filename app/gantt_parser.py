import csv
import io
import re
from datetime import datetime, date, timedelta
import openpyxl

AVATAR_COLORS = [
    "#3B82F6", "#8B5CF6", "#EC4899", "#10B981",
    "#F59E0B", "#06B6D4", "#6366F1", "#14B8A6", "#F97316"
]

HEADER_MAPPINGS = {
    "task_no": [
        "task", "task no", "s.no", "task id", "item no", "no"
    ],
    "title": [
        "activity / process step", "activity name", "process step", "activity",
        "task name", "tasks", "title", "action item", "item", "name", "work item", "task title", "task_name"
    ],
    "assignee": [
        "task owner", "owner", "assignee", "assigned to", "assigned_to", "resource",
        "resource name", "member", "person", "who", "lead", "assigned"
    ],
    "department": [
        "responsible", "department", "dept", "team", "function", "group"
    ],
    "start_date": [
        "start", "start date", "start_date", "begin", "begin date",
        "from", "start time", "startdate", "planned start"
    ],
    "due_date": [
        "end", "end date", "end_date", "due date", "due_date", "finish",
        "finish date", "to", "deadline", "target date", "duedate", "enddate", "planned finish"
    ],
    "status": [
        "status", "state", "progress", "stage", "% complete", "percent complete",
        "progress %", "completion", "task status"
    ],
    "priority": [
        "priority", "severity", "urgency", "importance", "level"
    ],
    "estimated_hours": [
        "estimated hours", "est hours", "est_hours", "estimated time",
        "duration (hours)", "duration", "hours", "work", "days", "work (hours)", "effort"
    ],
    "sprint": [
        "sprint", "phase", "milestone", "category", "wbs", "epic", "stream"
    ],
    "description": [
        "remark", "remarks", "description", "notes", "details", "comments", "summary", "scope"
    ],
    "tags": [
        "tags", "tag", "labels", "keywords"
    ]
}

def normalize_header(header_str):
    if not header_str:
        return ""
    return re.sub(r"[^a-z0-9% /_]+", " ", str(header_str).lower()).strip()

def match_column_name(clean_header):
    # Priority for title
    for alias in HEADER_MAPPINGS["title"]:
        if clean_header == alias or clean_header.startswith(alias):
            return "title"
    
    # Priority for assignee
    for alias in HEADER_MAPPINGS["assignee"]:
        if clean_header == alias or clean_header.startswith(alias):
            return "assignee"

    # Other mappings
    for canonical_field, aliases in HEADER_MAPPINGS.items():
        if canonical_field in ("title", "assignee"):
            continue
        for alias in aliases:
            if clean_header == alias or clean_header.startswith(alias):
                return canonical_field
    return None

def parse_date_value(val):
    if not val:
        return None
    if isinstance(val, (datetime, date)):
        return val.strftime("%Y-%m-%d")
    
    val_str = str(val).strip()
    if not val_str or val_str.lower() in ("none", "null", "n/a", "-"):
        return None

    # Handle DD/MM/YYYY or DD-MM-YYYY
    m = re.search(r"(\d{1,2})[/-]+(\d{1,2})[/-]+(\d{4})", val_str)
    if m:
        d, mo, y = m.groups()
        return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"

    # Handle YYYY-MM-DD
    m2 = re.search(r"(\d{4})[/-]+(\d{1,2})[/-]+(\d{1,2})", val_str)
    if m2:
        y, mo, d = m2.groups()
        return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"

    return None

def normalize_status(val):
    if val is None:
        return "todo"
    
    if isinstance(val, (int, float)):
        if val >= 1.0 or val == 100:
            return "done"
        elif val > 0:
            return "in_progress"
        return "todo"

    s = str(val).lower().strip()
    if s.endswith("%"):
        try:
            num = float(s[:-1])
            if num >= 100: return "done"
            elif num > 0: return "in_progress"
            return "todo"
        except Exception:
            pass

    if any(k in s for k in ["done", "complete", "finish", "closed"]):
        return "done"
    elif any(k in s for k in ["delay", "in progress", "progress", "active", "working", "ongoing", "started", "doing"]):
        return "in_progress"
    elif any(k in s for k in ["review", "testing", "qa", "verify", "audit"]):
        return "in_review"
    elif any(k in s for k in ["backlog", "future", "icebox"]):
        return "backlog"
    return "todo"

def normalize_priority(val, status="todo", remark=""):
    if status == "in_progress" and "delay" in str(val or "").lower():
        return "urgent"
    if remark and ("risk" in remark.lower() or "critical" in remark.lower() or "breakdown" in remark.lower()):
        return "urgent"

    if not val:
        return "medium"
    s = str(val).lower().strip()
    if any(k in s for k in ["urgent", "critical", "blocker", "p0", "p1", "highest", "immediate", "delay"]):
        return "urgent"
    elif any(k in s for k in ["high", "major", "p2", "important"]):
        return "high"
    elif any(k in s for k in ["low", "minor", "trivial", "p4", "lowest"]):
        return "low"
    return "medium"

def normalize_estimated_hours(val):
    if val is None:
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    
    s = str(val).lower().strip()
    if not s:
        return 0.0

    days_match = re.search(r"([\d\.]+)\s*(d|day|days)", s)
    if days_match:
        try:
            return round(float(days_match.group(1)) * 8.0, 1)
        except Exception:
            pass

    hrs_match = re.search(r"([\d\.]+)", s)
    if hrs_match:
        try:
            return round(float(hrs_match.group(1)), 1)
        except Exception:
            pass

    return 0.0

def parse_gantt_file(file_bytes, filename=""):
    is_excel = filename.lower().endswith((".xlsx", ".xlsm", ".xltx")) or file_bytes[:4] == b"PK\x03\x04"
    
    if is_excel:
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        target_sheet = None
        for sname in wb.sheetnames:
            if any(k in sname.lower() for k in ["gantt", "production", "schedule", "plan"]):
                target_sheet = wb[sname]
                break
        if target_sheet is None:
            target_sheet = wb.active

        return _parse_excel_sheet(target_sheet, wb)
    else:
        return _parse_csv_text(file_bytes)

def _parse_excel_sheet(ws, wb=None):
    rows_raw = []
    for row in ws.iter_rows(values_only=True):
        rows_raw.append(list(row))

    if not rows_raw:
        raise ValueError("The uploaded Excel sheet is empty.")

    # 1. Extract Project Metadata
    project_metadata = {
        "project_name": None,
        "project_code": None,
        "customer": None,
        "product": None,
        "suggested_title": None
    }
    
    for r in range(min(12, len(rows_raw))):
        row = rows_raw[r]
        for c in range(len(row) - 1):
            k = row[c]
            if k and isinstance(k, str):
                k_clean = k.strip().lower().rstrip(":")
                v = row[c+1]
                if v is not None and str(v).strip():
                    if "project name" in k_clean or k_clean == "project":
                        project_metadata["project_name"] = str(v).strip()
                    elif "project code" in k_clean or k_clean == "code":
                        project_metadata["project_code"] = str(v).strip()
                    elif "customer" in k_clean:
                        project_metadata["customer"] = str(v).strip()
                    elif "product" in k_clean or "target qty" in k_clean:
                        project_metadata["product"] = str(v).strip()

    title_parts = []
    if project_metadata["project_name"]:
        title_parts.append(project_metadata["project_name"])
    if project_metadata["project_code"]:
        title_parts.append(f"({project_metadata['project_code']})")
    if project_metadata["product"]:
        title_parts.append(f"- {project_metadata['product']}")
    
    if title_parts:
        project_metadata["suggested_title"] = " ".join(title_parts)

    # 2. Search for Header Row
    best_header_idx = -1
    best_header_map = {}
    
    for idx in range(min(30, len(rows_raw))):
        row = rows_raw[idx]
        mapping = {}
        for col_idx, cell in enumerate(row):
            norm = normalize_header(cell)
            field = match_column_name(norm)
            if field and field not in mapping.values():
                mapping[col_idx] = field
        
        if ("title" in mapping.values() or "assignee" in mapping.values()) and len(mapping) >= 2:
            if len(mapping) > len(best_header_map):
                best_header_idx = idx
                best_header_map = mapping

    if best_header_idx == -1 or not best_header_map:
        best_header_idx = 0
        best_header_map = {0: "title", 1: "assignee", 2: "start_date", 3: "due_date", 4: "status", 5: "priority"}

    # 3. Detect Weekly Date Ranges
    week_ranges = {}
    date_row_candidates = [best_header_idx - 1, best_header_idx - 2, best_header_idx + 1]
    for d_idx in date_row_candidates:
        if 0 <= d_idx < len(rows_raw):
            row_d = rows_raw[d_idx]
            for col_idx, cell in enumerate(row_d):
                if cell and isinstance(cell, str) and "to" in cell.lower():
                    parts = re.split(r"\s*to\s*", cell, flags=re.IGNORECASE)
                    if len(parts) == 2:
                        s_d = parse_date_value(parts[0])
                        e_d = parse_date_value(parts[1])
                        if s_d and e_d:
                            week_ranges[col_idx] = (s_d, e_d)

    tasks = []
    members_set = set()
    sprints_set = set()
    data_rows = rows_raw[best_header_idx + 1:]

    now = datetime.now()
    default_start = now.strftime("%Y-%m-%d")
    default_due = (now + timedelta(days=7)).strftime("%Y-%m-%d")

    title_col = None
    assignee_col = None
    dept_col = None
    status_col = None
    priority_col = None
    desc_col = None
    est_col = None
    sprint_col = None
    start_col = None
    due_col = None

    for col_idx, field in best_header_map.items():
        if field == "title": title_col = col_idx
        elif field == "assignee": assignee_col = col_idx
        elif field == "department": dept_col = col_idx
        elif field == "status": status_col = col_idx
        elif field == "priority": priority_col = col_idx
        elif field == "description": desc_col = col_idx
        elif field == "estimated_hours": est_col = col_idx
        elif field == "sprint": sprint_col = col_idx
        elif field == "start_date": start_col = col_idx
        elif field == "due_date": due_col = col_idx

    for order_idx, row in enumerate(data_rows):
        if not row:
            continue

        raw_title = row[title_col] if title_col is not None and title_col < len(row) else None
        if not raw_title or str(raw_title).strip() == "" or str(raw_title).strip().lower() in ("total time", "summary", "kpi"):
            continue

        title_str = str(raw_title).strip()

        # Assignee
        raw_assignee = row[assignee_col] if assignee_col is not None and assignee_col < len(row) else None
        assignee_str = str(raw_assignee).strip() if raw_assignee is not None else None
        if assignee_str and assignee_str.lower() in ("unassigned", "n/a", "none", "-"):
            assignee_str = None

        if assignee_str:
            sub_members = [m.strip() for m in re.split(r"[,&/]+", assignee_str) if m.strip() and m.strip().lower() not in ("pm team", "scm team", "qa", "qc")]
            for sm in sub_members:
                members_set.add(sm)
            members_set.add(assignee_str)

        # Department / Role
        raw_dept = row[dept_col] if dept_col is not None and dept_col < len(row) else ""
        dept_str = str(raw_dept).strip() if raw_dept else ""

        # Status & Remarks
        raw_status = row[status_col] if status_col is not None and status_col < len(row) else "todo"
        raw_desc = row[desc_col] if desc_col is not None and desc_col < len(row) else ""
        desc_str = str(raw_desc).strip() if raw_desc else ""

        norm_status = normalize_status(raw_status)
        norm_priority = normalize_priority(
            row[priority_col] if priority_col is not None and priority_col < len(row) else None,
            status=raw_status,
            remark=desc_str
        )

        # Dates from cells or weekly columns
        start_date = parse_date_value(row[start_col]) if start_col is not None and start_col < len(row) else None
        due_date = parse_date_value(row[due_col]) if due_col is not None and due_col < len(row) else None

        for c_idx in range(len(row)):
            if c_idx in (title_col, assignee_col, dept_col, status_col, desc_col):
                continue
            cell_val = row[c_idx]
            if cell_val is not None and str(cell_val).strip() != "":
                if isinstance(cell_val, (datetime, date)):
                    d_str = cell_val.strftime("%Y-%m-%d")
                    if not start_date or d_str < start_date: start_date = d_str
                    if not due_date or d_str > due_date: due_date = d_str
                elif isinstance(cell_val, str):
                    d_str = parse_date_value(cell_val)
                    if d_str:
                        if not start_date or d_str < start_date: start_date = d_str
                        if not due_date or d_str > due_date: due_date = d_str
                    elif c_idx in week_ranges:
                        s_d, e_d = week_ranges[c_idx]
                        if not start_date or s_d < start_date: start_date = s_d
                        if not due_date or e_d > due_date: due_date = e_d
                elif c_idx in week_ranges:
                    s_d, e_d = week_ranges[c_idx]
                    if not start_date or s_d < start_date: start_date = s_d
                    if not due_date or e_d > due_date: due_date = e_d

        if not start_date and not due_date:
            start_date = default_start
            due_date = default_due
        elif start_date and not due_date:
            try:
                s_dt = datetime.strptime(start_date, "%Y-%m-%d")
                due_date = (s_dt + timedelta(days=5)).strftime("%Y-%m-%d")
            except Exception:
                due_date = default_due
        elif due_date and not start_date:
            try:
                d_dt = datetime.strptime(due_date, "%Y-%m-%d")
                start_date = (d_dt - timedelta(days=5)).strftime("%Y-%m-%d")
            except Exception:
                start_date = default_start

        # Tags
        tags = []
        if dept_str:
            tags.append(dept_str.lower())
        if project_metadata["project_code"]:
            tags.append(project_metadata["project_code"].lower())

        # Sprint / Phase
        sprint_name = None
        if sprint_col is not None and sprint_col < len(row) and row[sprint_col]:
            sprint_name = str(row[sprint_col]).strip()
        else:
            if start_date:
                try:
                    s_dt = datetime.strptime(start_date, "%Y-%m-%d")
                    # Group into phases
                    if s_dt.month == 8:
                        sprint_name = "Sprint 1: Procurement & SCM (Aug 2026)"
                    elif s_dt.month == 9 and s_dt.day <= 15:
                        sprint_name = "Sprint 2: Production & Reaction Steps (Sep 2026)"
                    else:
                        sprint_name = "Sprint 3: QC Analysis, QA & Batch Release (Sep-Oct 2026)"
                except Exception:
                    sprint_name = "Phase 1: Batch Execution"
        
        if sprint_name:
            sprints_set.add(sprint_name)

        # Estimated Hours
        est_hours = 8.0
        if est_col is not None and est_col < len(row):
            est_hours = normalize_estimated_hours(row[est_col]) or 8.0

        tasks.append({
            "title": title_str,
            "assignee_name": assignee_str,
            "department": dept_str,
            "start_date": start_date,
            "due_date": due_date,
            "status": norm_status,
            "priority": norm_priority,
            "estimated_hours": est_hours,
            "sprint_name": sprint_name,
            "description": desc_str,
            "tags": tags,
            "order_index": order_idx
        })

    return {
        "tasks": tasks,
        "members_found": sorted(list(members_set)),
        "sprints_found": sorted(list(sprints_set)),
        "total_rows": len(tasks),
        "columns_detected": {v: k for k, v in best_header_map.items()},
        "metadata": project_metadata
    }

def _parse_csv_text(file_bytes):
    text = file_bytes.decode("utf-8-sig", errors="replace")
    sample = text[:2048]
    delimiter = "\t" if "\t" in sample and "," not in sample else ","
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    rows_raw = [row for row in reader if any(c.strip() for c in row)]

    if not rows_raw:
        raise ValueError("The uploaded CSV is empty.")

    best_header_idx = -1
    best_header_map = {}
    
    for idx, row in enumerate(rows_raw[:15]):
        mapping = {}
        for col_idx, cell in enumerate(row):
            norm = normalize_header(cell)
            field = match_column_name(norm)
            if field and field not in mapping.values():
                mapping[col_idx] = field
        
        if ("title" in mapping.values() or "assignee" in mapping.values()) and len(mapping) >= 2:
            if len(mapping) > len(best_header_map):
                best_header_idx = idx
                best_header_map = mapping

    if best_header_idx == -1 or not best_header_map:
        best_header_idx = 0
        best_header_map = {0: "title", 1: "assignee", 2: "start_date", 3: "due_date", 4: "status", 5: "priority"}

    tasks = []
    members_set = set()
    sprints_set = set()
    data_rows = rows_raw[best_header_idx + 1:]
    
    now = datetime.now()
    default_start = now.strftime("%Y-%m-%d")
    default_due = (now + timedelta(days=7)).strftime("%Y-%m-%d")

    for order_idx, row in enumerate(data_rows):
        task_data = {
            "title": "", "description": "", "assignee_name": None,
            "start_date": default_start, "due_date": default_due,
            "status": "todo", "priority": "medium", "estimated_hours": 8.0,
            "sprint_name": None, "tags": [], "order_index": order_idx
        }

        for col_idx, field in best_header_map.items():
            if col_idx < len(row):
                cell_val = row[col_idx]
                if field == "title": task_data["title"] = str(cell_val).strip()
                elif field == "assignee":
                    raw_a = str(cell_val).strip()
                    if raw_a and raw_a.lower() not in ("unassigned", "none", "-"):
                        task_data["assignee_name"] = raw_a
                        members_set.add(raw_a)
                elif field == "start_date": task_data["start_date"] = parse_date_value(cell_val) or default_start
                elif field == "due_date": task_data["due_date"] = parse_date_value(cell_val) or default_due
                elif field == "status": task_data["status"] = normalize_status(cell_val)
                elif field == "priority": task_data["priority"] = normalize_priority(cell_val)
                elif field == "estimated_hours": task_data["estimated_hours"] = normalize_estimated_hours(cell_val) or 8.0
                elif field == "sprint":
                    s_name = str(cell_val).strip()
                    if s_name:
                        task_data["sprint_name"] = s_name
                        sprints_set.add(s_name)
                elif field == "description": task_data["description"] = str(cell_val).strip()

        if task_data["title"]:
            tasks.append(task_data)

    return {
        "tasks": tasks,
        "members_found": sorted(list(members_set)),
        "sprints_found": sorted(list(sprints_set)),
        "total_rows": len(tasks),
        "columns_detected": {v: k for k, v in best_header_map.items()},
        "metadata": {}
    }

def generate_sample_gantt_csv():
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Task Name", "Assignee", "Start Date", "Due Date",
        "Status", "Priority", "Estimated Hours", "Sprint / Phase", "Description", "Tags"
    ])
    now = datetime.now()
    d = lambda offset: (now + timedelta(days=offset)).strftime("%Y-%m-%d")
    sample_rows = [
        ["Project Discovery & Scope Alignment", "Alex Morgan", d(-5), d(-2), "Done", "High", "12", "Phase 1: Foundation", "Define architecture and sprint goals", "planning,arch"],
        ["Database Schema & Indices Migration", "Sophia Chen", d(-3), d(3), "In Progress", "Urgent", "16", "Phase 1: Foundation", "SQLite indexing and foreign key audit", "database,backend"],
        ["Interactive Gantt Chart & Kanban UI", "David Kim", d(-1), d(6), "In Progress", "High", "20", "Phase 2: Core Development", "Timeline visualization and drag-and-drop cards", "frontend,ui"],
        ["REST API Authentication Guard", "Alex Morgan", d(2), d(8), "To Do", "Medium", "8", "Phase 2: Core Development", "JWT token and route guard rules", "security,auth"],
        ["Automated End-to-End Test Suite", "Elena Rostova", d(5), d(11), "To Do", "High", "14", "Phase 3: QA & Verification", "Unit test runners and CI verification", "qa,ci"],
        ["Production Staging Deployment", "Marcus Vance", d(9), d(14), "Backlog", "Urgent", "10", "Phase 3: QA & Launch", "Final stage rollout and sanity check", "release,ops"]
    ]
    for r in sample_rows:
        writer.writerow(r)
    return output.getvalue()

def generate_sample_gantt_excel():
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Gantt Schedule"
    headers = [
        "Task Name", "Assignee", "Start Date", "Due Date",
        "Status", "Priority", "Estimated Hours", "Sprint / Phase", "Description", "Tags"
    ]
    ws.append(headers)
    now = datetime.now()
    d = lambda offset: (now + timedelta(days=offset)).strftime("%Y-%m-%d")
    sample_rows = [
        ["Project Discovery & Scope Alignment", "Alex Morgan", d(-5), d(-2), "Done", "High", 12, "Phase 1: Foundation", "Define architecture and sprint goals", "planning,arch"],
        ["Database Schema & Indices Migration", "Sophia Chen", d(-3), d(3), "In Progress", "Urgent", 16, "Phase 1: Foundation", "SQLite indexing and foreign key audit", "database,backend"],
        ["Interactive Gantt Chart & Kanban UI", "David Kim", d(-1), d(6), "In Progress", "High", 20, "Phase 2: Core Development", "Timeline visualization and drag-and-drop cards", "frontend,ui"],
        ["REST API Authentication Guard", "Alex Morgan", d(2), d(8), "To Do", "Medium", 8, "Phase 2: Core Development", "JWT token and route guard rules", "security,auth"],
        ["Automated End-to-End Test Suite", "Elena Rostova", d(5), d(11), "To Do", "High", 14, "Phase 3: QA & Verification", "Unit test runners and CI verification", "qa,ci"],
        ["Production Staging Deployment", "Marcus Vance", d(9), d(14), "Backlog", "Urgent", 10, "Phase 3: QA & Launch", "Final stage rollout and sanity check", "release,ops"]
    ]
    for row in sample_rows:
        ws.append(row)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
