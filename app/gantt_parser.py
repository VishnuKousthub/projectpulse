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
        "task no", "task_no", "s.no", "sno", "s no", "sl no", "sl.no", "task id", "item no", "item_no", "no", "#", "id"
    ],
    "title": [
        "activity / process step", "activity name", "process step", "process", "activity",
        "task name", "task_name", "tasks", "task", "action item", "action items", "action", "actions",
        "work item", "work items", "work", "item name", "items", "item",
        "title", "name", "deliverable", "deliverables", "step name", "steps", "step",
        "scope", "feature", "features", "todo", "to-do", "to do", "topic", "job",
        "milestone", "plan", "story", "user story", "requirement", "requirements",
        "content", "objective", "objectives", "description"
    ],
    "assignee": [
        "task owner", "owner", "assignee", "assigned to", "assigned_to", "resource",
        "resource name", "member", "person", "who", "lead", "assigned", "responsible person"
    ],
    "department": [
        "responsible", "department", "dept", "team", "function", "group", "division"
    ],
    "start_date": [
        "start", "start date", "start_date", "begin", "begin date",
        "from", "start time", "startdate", "planned start", "commence"
    ],
    "due_date": [
        "end", "end date", "end_date", "due date", "due_date", "finish",
        "finish date", "to", "deadline", "target date", "duedate", "enddate", "planned finish", "target"
    ],
    "status": [
        "status", "state", "progress", "stage", "% complete", "percent complete",
        "progress %", "completion", "task status", "condition"
    ],
    "priority": [
        "priority", "severity", "urgency", "importance", "level", "rank"
    ],
    "estimated_hours": [
        "estimated hours", "est hours", "est_hours", "estimated time",
        "duration (hours)", "duration", "hours", "work", "days", "work (hours)", "effort", "time (hrs)"
    ],
    "sprint": [
        "sprint", "phase", "milestone", "category", "wbs", "epic", "stream", "stage name"
    ],
    "description": [
        "remark", "remarks", "description", "notes", "details", "comments", "summary", "scope notes"
    ],
    "tags": [
        "tags", "tag", "labels", "keywords"
    ]
}

def normalize_header(header_str):
    if not header_str:
        return ""
    return re.sub(r"[^a-z0-9% /_#]+", " ", str(header_str).lower()).strip()

def match_column_name(clean_header):
    if not clean_header:
        return None
    
    # Check exact task_no / id first
    if clean_header in HEADER_MAPPINGS["task_no"]:
        return "task_no"

    # Priority check for title / activity name
    for alias in HEADER_MAPPINGS["title"]:
        if clean_header == alias or clean_header.startswith(alias):
            return "title"
    
    # Priority check for assignee / owner
    for alias in HEADER_MAPPINGS["assignee"]:
        if clean_header == alias or clean_header.startswith(alias):
            return "assignee"

    # Check other mappings
    for canonical_field, aliases in HEADER_MAPPINGS.items():
        if canonical_field in ("title", "assignee", "task_no"):
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
    if not val_str or val_str.lower() in ("none", "null", "n/a", "-", "tbd", "undeclared", "not declared"):
        return None

    # Handle DD/MM/YYYY or DD-MM-YYYY
    m = re.search(r"(\d{1,2})[/-]+(\d{1,2})[/-]+(\d{4})", val_str)
    if m:
        d, mo, y = m.groups()
        try:
            return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
        except Exception:
            pass

    # Handle YYYY-MM-DD
    m2 = re.search(r"(\d{4})[/-]+(\d{1,2})[/-]+(\d{1,2})", val_str)
    if m2:
        y, mo, d = m2.groups()
        try:
            return f"{int(y):04d}-{int(mo):02d}-{int(d):02d}"
        except Exception:
            pass

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

    if any(k in s for k in ["done", "complete", "finish", "closed", "pass", "resolved"]):
        return "done"
    elif any(k in s for k in ["delay", "in progress", "progress", "active", "working", "ongoing", "started", "doing", "wip"]):
        return "in_progress"
    elif any(k in s for k in ["review", "testing", "qa", "verify", "audit", "hold", "pending review"]):
        return "in_review"
    elif any(k in s for k in ["backlog", "future", "icebox", "wishlist"]):
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
    """
    Universal Spreadsheet / Table Parser for ProjectPulse.
    Accepts ANY Excel (.xlsx, .xlsm, .xls) or CSV / TSV file.
    Supports basic 1-column task lists, simple 2-column tables, or complex Gantt schedules.
    """
    is_excel = filename.lower().endswith((".xlsx", ".xlsm", ".xltx", ".xls")) or file_bytes[:4] == b"PK\x03\x04"
    
    if is_excel:
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        target_sheet = None
        for sname in wb.sheetnames:
            if any(k in sname.lower() for k in ["gantt", "production", "schedule", "plan", "tasks", "activities", "sheet1"]):
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
        row_list = list(row)
        # Keep row if it has at least one non-empty cell
        if any(c is not None and str(c).strip() != "" for c in row_list):
            rows_raw.append(row_list)

    if not rows_raw:
        raise ValueError("The uploaded Excel sheet contains no data.")

    return _process_table_rows(rows_raw)

def _parse_csv_text(file_bytes):
    text = file_bytes.decode("utf-8-sig", errors="replace")
    sample = text[:2048]
    delimiter = "\t" if "\t" in sample and "," not in sample else (";" if ";" in sample and "," not in sample else ",")
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    rows_raw = [row for row in reader if any(c.strip() for c in row)]

    if not rows_raw:
        raise ValueError("The uploaded CSV file is empty.")

    return _process_table_rows(rows_raw)

def _process_table_rows(rows_raw):
    """
    Intelligently extracts tasks, assignees, timelines, and metadata from raw rows.
    Works for any table format (1 column, 2 columns, or full Gantt sheet).
    """
    # 1. Extract Project Metadata if present in top header banners
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
            if cell is None:
                continue
            norm = normalize_header(cell)
            field = match_column_name(norm)
            if field and field not in mapping.values():
                mapping[col_idx] = field
        
        # If we match title or any 2 useful columns
        if "title" in mapping.values():
            if len(mapping) > len(best_header_map) or best_header_idx == -1:
                best_header_idx = idx
                best_header_map = mapping
        elif len(mapping) >= 2 and len(mapping) > len(best_header_map):
            best_header_idx = idx
            best_header_map = mapping

    # 3. Fallback: If no recognized header row is found (e.g. raw list of activities)
    if best_header_idx == -1 or not best_header_map or "title" not in best_header_map.values():
        # Find which column contains descriptive text strings
        max_cols = max(len(r) for r in rows_raw)
        col_text_scores = [0] * max_cols
        
        for row in rows_raw:
            for c_idx, cell in enumerate(row):
                if cell is not None:
                    c_str = str(cell).strip()
                    # If string length > 2 and not just numbers or pure dates
                    if len(c_str) > 2 and not re.match(r"^\d+(\.\d+)?$", c_str) and not parse_date_value(c_str):
                        col_text_scores[c_idx] += 1

        best_title_col = 0
        if col_text_scores and max(col_text_scores) > 0:
            best_title_col = col_text_scores.index(max(col_text_scores))

        # Check if row 0 was a generic header or data
        row0_val = str(rows_raw[0][best_title_col] or "").strip().lower() if len(rows_raw[0]) > best_title_col else ""
        if any(row0_val == h for h in ["task", "tasks", "title", "activity", "name", "action", "items"]):
            best_header_idx = 0
            data_rows = rows_raw[1:]
        else:
            best_header_idx = -1
            data_rows = rows_raw
        
        best_header_map = {best_title_col: "title"}
        # If there are second or third columns, map assignee or date if detectable
        if max_cols > 1:
            for c_idx in range(max_cols):
                if c_idx == best_title_col:
                    continue
                # Test sample values in this column
                sample_vals = [r[c_idx] for r in data_rows[:10] if c_idx < len(r) and r[c_idx] is not None]
                if any(parse_date_value(v) for v in sample_vals):
                    if "start_date" not in best_header_map.values():
                        best_header_map[c_idx] = "start_date"
                    elif "due_date" not in best_header_map.values():
                        best_header_map[c_idx] = "due_date"
                elif "assignee" not in best_header_map.values() and any(isinstance(v, str) and len(v.strip()) > 1 for v in sample_vals):
                    best_header_map[c_idx] = "assignee"
    else:
        data_rows = rows_raw[best_header_idx + 1:]

    # 4. Detect Weekly Date Ranges in header rows
    week_ranges = {}
    if best_header_idx >= 0:
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
    task_no_col = None

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
        elif field == "task_no": task_no_col = col_idx

    current_order_idx = 0

    for row in data_rows:
        if not row or not any(c is not None and str(c).strip() != "" for c in row):
            continue

        raw_title = row[title_col] if title_col is not None and title_col < len(row) else None
        
        # If title column is empty, check if another column has title text
        if not raw_title or str(raw_title).strip() == "":
            for c_idx, cell in enumerate(row):
                if cell is not None and str(cell).strip() != "":
                    if c_idx != task_no_col and not parse_date_value(cell) and not re.match(r"^\d+(\.\d+)?$", str(cell).strip()):
                        raw_title = cell
                        break

        if not raw_title or str(raw_title).strip() == "":
            continue

        title_str = str(raw_title).strip()
        lower_title = title_str.lower()

        # Skip summary, total, or page header lines
        if lower_title in ("total time", "summary", "kpi", "total", "grand total", "sub total", "notes", "legend"):
            continue

        # Assignee
        raw_assignee = row[assignee_col] if assignee_col is not None and assignee_col < len(row) else None
        assignee_str = str(raw_assignee).strip() if raw_assignee is not None else None
        if assignee_str and assignee_str.lower() in ("unassigned", "n/a", "none", "-", "tbd", "undeclared"):
            assignee_str = None

        if assignee_str:
            sub_members = [m.strip() for m in re.split(r"[,&/]+", assignee_str) if m.strip() and m.strip().lower() not in ("pm team", "scm team", "qa", "qc", "production team")]
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

        # Dates: Parse explicitly if provided; otherwise KEEP AS NONE ("Not Declared")!
        start_date = parse_date_value(row[start_col]) if start_col is not None and start_col < len(row) else None
        due_date = parse_date_value(row[due_col]) if due_col is not None and due_col < len(row) else None

        # Check other date cells or weekly timeline ranges if explicit dates were not found
        if not start_date or not due_date:
            for c_idx in range(len(row)):
                if c_idx in (title_col, assignee_col, dept_col, status_col, desc_col, task_no_col):
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

        # Tags
        tags = []
        if dept_str:
            tags.append(dept_str.lower())
        if project_metadata.get("project_code"):
            tags.append(project_metadata["project_code"].lower())

        # Sprint / Phase (Keep None if not specified)
        sprint_name = None
        if sprint_col is not None and sprint_col < len(row) and row[sprint_col]:
            sprint_val = str(row[sprint_col]).strip()
            if sprint_val and sprint_val.lower() not in ("none", "null", "-", "n/a", "no sprint", "backlog"):
                sprint_name = sprint_val
                sprints_set.add(sprint_name)

        # Estimated Hours (0.0 if not provided)
        est_hours = 0.0
        if est_col is not None and est_col < len(row):
            est_hours = normalize_estimated_hours(row[est_col]) or 0.0

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
            "order_index": current_order_idx
        })
        current_order_idx += 1

    return {
        "tasks": tasks,
        "members_found": sorted(list(members_set)),
        "sprints_found": sorted(list(sprints_set)),
        "total_rows": len(tasks),
        "columns_detected": {v: k for k, v in best_header_map.items()},
        "metadata": project_metadata
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
