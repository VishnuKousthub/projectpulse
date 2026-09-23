import json
import sqlite3
from datetime import datetime, timezone, timedelta
from app.database import get_db, init_db

def seed_database():
    init_db()
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Check if already seeded
        cursor.execute("SELECT COUNT(*) as count FROM projects")
        if cursor.fetchone()["count"] > 0:
            return

        now = datetime.now(timezone.utc)
        now_str = now.isoformat()
        
        # Project 1: CloudScale Platform 2.0
        cursor.execute("""
            INSERT INTO projects (name, description, color, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
        """, (
            "CloudScale Platform 2.0",
            "Next-generation distributed cloud infrastructure, microservices orchestration, and real-time observability dashboard.",
            "#3B82F6",
            (now - timedelta(days=20)).isoformat(),
            now_str
        ))
        p1_id = cursor.lastrowid

        # Project 2: Mobile App MVP
        cursor.execute("""
            INSERT INTO projects (name, description, color, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
        """, (
            "Mobile App MVP (iOS & Android)",
            "Cross-platform client application built with real-time biometric auth, offline caching, and push notifications.",
            "#8B5CF6",
            (now - timedelta(days=15)).isoformat(),
            now_str
        ))
        p2_id = cursor.lastrowid

        # Project 3: Brand & Design System Overhaul
        cursor.execute("""
            INSERT INTO projects (name, description, color, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
        """, (
            "Design System & Brand 2026",
            "Modern design token architecture, accessible component library, and marketing asset toolkit.",
            "#10B981",
            (now - timedelta(days=10)).isoformat(),
            now_str
        ))
        p3_id = cursor.lastrowid

        # Members for Project 1
        members_p1 = [
            ("Alex Morgan", "alex.morgan@company.internal", "Lead Architect", "#3B82F6"),
            ("Sophia Chen", "sophia.chen@company.internal", "Senior Backend Eng", "#8B5CF6"),
            ("Marcus Vance", "marcus.vance@company.internal", "Product Designer", "#EC4899"),
            ("Elena Rostova", "elena.rostova@company.internal", "DevOps & QA Lead", "#F59E0B"),
            ("David Kim", "david.kim@company.internal", "Frontend Specialist", "#10B981")
        ]
        member_ids_p1 = []
        for name, email, role, color in members_p1:
            cursor.execute("""
                INSERT INTO members (project_id, name, email, role, avatar_color)
                VALUES (?, ?, ?, ?, ?)
            """, (p1_id, name, email, role, color))
            member_ids_p1.append(cursor.lastrowid)

        # Sprints for Project 1
        sprint1_start = (now - timedelta(days=7)).strftime("%Y-%m-%d")
        sprint1_end = (now + timedelta(days=7)).strftime("%Y-%m-%d")
        cursor.execute("""
            INSERT INTO sprints (project_id, name, goal, start_date, end_date, status)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            p1_id,
            "Sprint 24: Core Architecture & Ingestion",
            "Deliver high-throughput telemetry stream ingestion, database indexing, and initial WebSocket cluster.",
            sprint1_start,
            sprint1_end,
            "active"
        ))
        sprint1_id = cursor.lastrowid

        sprint2_start = (now + timedelta(days=8)).strftime("%Y-%m-%d")
        sprint2_end = (now + timedelta(days=22)).strftime("%Y-%m-%d")
        cursor.execute("""
            INSERT INTO sprints (project_id, name, goal, start_date, end_date, status)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            p1_id,
            "Sprint 25: Dashboard & Alert Engine",
            "Integrate live metrics visualizer, user permission rules, and automated alerting webhooks.",
            sprint2_start,
            sprint2_end,
            "planning"
        ))
        sprint2_id = cursor.lastrowid

        # Milestones for Project 1
        milestones_p1 = [
            ("Alpha Test Deployment to Staging", (now + timedelta(days=4)).strftime("%Y-%m-%d"), "pending"),
            ("Ingestion Stress Test (100k msg/sec)", (now + timedelta(days=10)).strftime("%Y-%m-%d"), "pending"),
            ("SOC2 Security & Compliance Sign-off", (now + timedelta(days=24)).strftime("%Y-%m-%d"), "pending")
        ]
        for title, due, status in milestones_p1:
            cursor.execute("""
                INSERT INTO milestones (project_id, title, due_date, status)
                VALUES (?, ?, ?, ?)
            """, (p1_id, title, due, status))

        # Tasks for Project 1
        tasks_p1 = [
            {
                "title": "Build Distributed Stream Ingestion Pipeline",
                "desc": "Implement multi-partition message consumers with backpressure handling and dead-letter queue routing.",
                "status": "in_progress",
                "priority": "urgent",
                "sprint_id": sprint1_id,
                "assignee_id": member_ids_p1[0],
                "order_index": 0,
                "start_date": (now - timedelta(days=5)).strftime("%Y-%m-%d"),
                "due_date": (now + timedelta(days=2)).strftime("%Y-%m-%d"),
                "est": 18.0,
                "act": 11.5,
                "tags": ["backend", "telemetry", "kafka"],
                "subtasks": [
                    ("Design stream envelope protobuf schema", 1),
                    ("Configure partition consumer group balancing", 1),
                    ("Implement exponential backoff retry mechanism", 1),
                    ("Load benchmark with 50,000 synthetic events/sec", 0)
                ],
                "logs": [
                    (member_ids_p1[0], 4.5, "Schema design and serializer benchmarks", (now - timedelta(days=4)).strftime("%Y-%m-%d")),
                    (member_ids_p1[0], 7.0, "Consumer group balancing and retry handler", (now - timedelta(days=2)).strftime("%Y-%m-%d"))
                ]
            },
            {
                "title": "Refactor WebSocket Connection Manager",
                "desc": "Establish scalable client connection lifecycle, heartbeat keep-alives, and Redis pub/sub channel multiplexing.",
                "status": "in_progress",
                "priority": "high",
                "sprint_id": sprint1_id,
                "assignee_id": member_ids_p1[1],
                "order_index": 1,
                "start_date": (now - timedelta(days=4)).strftime("%Y-%m-%d"),
                "due_date": (now + timedelta(days=3)).strftime("%Y-%m-%d"),
                "est": 14.0,
                "act": 9.0,
                "tags": ["realtime", "websocket", "networking"],
                "subtasks": [
                    ("Heartbeat ping/pong frame validation", 1),
                    ("Graceful disconnection cleanup logic", 1),
                    ("Channel subscription authorization hook", 0),
                    ("Reconnection storm rate limiter", 0)
                ],
                "logs": [
                    (member_ids_p1[1], 5.0, "Core connection manager and heartbeat worker", (now - timedelta(days=3)).strftime("%Y-%m-%d")),
                    (member_ids_p1[1], 4.0, "Channel multiplexing integration", (now - timedelta(days=1)).strftime("%Y-%m-%d"))
                ]
            },
            {
                "title": "Design Dark Mode Theme & Glassmorphism Tokens",
                "desc": "Create unified CSS custom properties for sleek dark mode palettes, ambient gradients, and crisp focus states.",
                "status": "in_review",
                "priority": "medium",
                "sprint_id": sprint1_id,
                "assignee_id": member_ids_p1[4],
                "order_index": 0,
                "start_date": (now - timedelta(days=6)).strftime("%Y-%m-%d"),
                "due_date": (now + timedelta(days=1)).strftime("%Y-%m-%d"),
                "est": 8.0,
                "act": 8.0,
                "tags": ["frontend", "ui", "tailwind"],
                "subtasks": [
                    ("Extract shared color variables to token sheet", 1),
                    ("Configure high-contrast accessibility tests", 1),
                    ("Cross-browser rendering check (Chrome, Safari, Firefox)", 1)
                ],
                "logs": [
                    (member_ids_p1[4], 8.0, "Theme design tokens and component styling", (now - timedelta(days=2)).strftime("%Y-%m-%d"))
                ]
            },
            {
                "title": "SQLite Indexing & Query Latency Optimization",
                "desc": "Analyze query explain plans, add composite indexes on status/sprint filters, and verify query execution is under 2ms.",
                "status": "done",
                "priority": "high",
                "sprint_id": sprint1_id,
                "assignee_id": member_ids_p1[0],
                "order_index": 0,
                "start_date": (now - timedelta(days=7)).strftime("%Y-%m-%d"),
                "due_date": (now - timedelta(days=3)).strftime("%Y-%m-%d"),
                "est": 6.0,
                "act": 5.5,
                "tags": ["database", "sqlite", "performance"],
                "subtasks": [
                    ("Run EXPLAIN QUERY PLAN on dashboard queries", 1),
                    ("Create composite covering index", 1),
                    ("Benchmark 50k rows dataset", 1)
                ],
                "logs": [
                    (member_ids_p1[0], 5.5, "Query profiling, index creation and validation", (now - timedelta(days=4)).strftime("%Y-%m-%d"))
                ]
            },
            {
                "title": "Setup Automated Integration Test Pipeline",
                "desc": "Create end-to-end API test suites with automated GitHub Actions / local test runner integration.",
                "status": "done",
                "priority": "medium",
                "sprint_id": sprint1_id,
                "assignee_id": member_ids_p1[3],
                "order_index": 1,
                "start_date": (now - timedelta(days=6)).strftime("%Y-%m-%d"),
                "due_date": (now - timedelta(days=2)).strftime("%Y-%m-%d"),
                "est": 7.0,
                "act": 6.0,
                "tags": ["devops", "qa", "ci"],
                "subtasks": [
                    ("Setup pytest suite and fixtures", 1),
                    ("Add healthcheck endpoint assertion", 1),
                    ("Verify coverage > 90%", 1)
                ],
                "logs": [
                    (member_ids_p1[3], 6.0, "Test suite writing and CI workflow config", (now - timedelta(days=3)).strftime("%Y-%m-%d"))
                ]
            },
            {
                "title": "RBAC Permission Matrix & Scope Rules",
                "desc": "Define role permissions for Admin, Project Manager, Contributor, and Guest roles with fine-grained action guards.",
                "status": "todo",
                "priority": "high",
                "sprint_id": sprint1_id,
                "assignee_id": member_ids_p1[2],
                "order_index": 0,
                "start_date": (now + timedelta(days=1)).strftime("%Y-%m-%d"),
                "due_date": (now + timedelta(days=5)).strftime("%Y-%m-%d"),
                "est": 10.0,
                "act": 0.0,
                "tags": ["security", "auth", "rbac"],
                "subtasks": [
                    ("Draft permission table matrix", 0),
                    ("Review role escalation boundaries with security", 0),
                    ("Provide frontend UI disabled states spec", 0)
                ],
                "logs": []
            },
            {
                "title": "Project Data Export to JSON / CSV",
                "desc": "Build one-click export utility to generate full project backup dumps in structured JSON and tabular CSV format.",
                "status": "todo",
                "priority": "medium",
                "sprint_id": sprint1_id,
                "assignee_id": member_ids_p1[1],
                "order_index": 1,
                "start_date": (now + timedelta(days=2)).strftime("%Y-%m-%d"),
                "due_date": (now + timedelta(days=6)).strftime("%Y-%m-%d"),
                "est": 6.0,
                "act": 0.0,
                "tags": ["export", "backup", "csv"],
                "subtasks": [
                    ("JSON serialization format schema", 0),
                    ("CSV dialect formatting and headers", 0)
                ],
                "logs": []
            },
            {
                "title": "Evaluate WebAssembly Vector Computation Engine",
                "desc": "Spike research into compiling C/Rust routines to WASM for client-side analytical calculations.",
                "status": "backlog",
                "priority": "low",
                "sprint_id": None,
                "assignee_id": member_ids_p1[4],
                "order_index": 0,
                "start_date": None,
                "due_date": (now + timedelta(days=30)).strftime("%Y-%m-%d"),
                "est": 16.0,
                "act": 0.0,
                "tags": ["research", "wasm", "future"],
                "subtasks": [
                    ("Compile test C module to wasm", 0),
                    ("Benchmark JS vs WASM matrix transforms", 0)
                ],
                "logs": []
            },
            {
                "title": "Multi-Tenant Cloud Data Isolation Architecture",
                "desc": "Explore database schema sharding vs row-level tenant tagging for enterprise tier deployments.",
                "status": "backlog",
                "priority": "medium",
                "sprint_id": None,
                "assignee_id": member_ids_p1[0],
                "order_index": 1,
                "start_date": None,
                "due_date": (now + timedelta(days=45)).strftime("%Y-%m-%d"),
                "est": 24.0,
                "act": 0.0,
                "tags": ["architecture", "multitenant"],
                "subtasks": [],
                "logs": []
            }
        ]

        for task_data in tasks_p1:
            cursor.execute("""
                INSERT INTO tasks (
                    project_id, sprint_id, title, description, status, priority,
                    order_index, start_date, due_date, estimated_hours, actual_hours,
                    assignee_id, tags, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                p1_id,
                task_data["sprint_id"],
                task_data["title"],
                task_data["desc"],
                task_data["status"],
                task_data["priority"],
                task_data["order_index"],
                task_data["start_date"],
                task_data["due_date"],
                task_data["est"],
                task_data["act"],
                task_data["assignee_id"],
                json.dumps(task_data["tags"]),
                now_str,
                now_str
            ))
            t_id = cursor.lastrowid

            for idx, (sub_title, completed) in enumerate(task_data.get("subtasks", [])):
                cursor.execute("""
                    INSERT INTO subtasks (task_id, title, completed, order_index)
                    VALUES (?, ?, ?, ?)
                """, (t_id, sub_title, completed, idx))

            for mem_id, hrs, log_desc, l_date in task_data.get("logs", []):
                cursor.execute("""
                    INSERT INTO timelogs (task_id, member_id, hours, description, logged_date, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (t_id, mem_id, hrs, log_desc, l_date, now_str))

        # Recent activities for Project 1
        activities = [
            ("Alex Morgan", "Updated task status", "Moved 'SQLite Indexing & Query Latency' to Done", (now - timedelta(hours=3)).isoformat()),
            ("Sophia Chen", "Logged time", "Logged 4.0h on 'Refactor WebSocket Connection Manager'", (now - timedelta(hours=5)).isoformat()),
            ("David Kim", "Submitted for review", "Marked 'Design Dark Mode Theme' as In Review", (now - timedelta(hours=8)).isoformat()),
            ("Alex Morgan", "Created sprint", "Created 'Sprint 24: Core Architecture & Ingestion'", (now - timedelta(days=7)).isoformat())
        ]
        for user_name, action, details, act_time in activities:
            cursor.execute("""
                INSERT INTO activity_logs (project_id, task_id, user_name, action, details, timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (p1_id, None, user_name, action, details, act_time))

        # Central Resources Seeding
        seed_resources(cursor, now, p1_id, p2_id, p3_id)

        print("Database initialized and successfully seeded with demo projects and resources!")

def seed_resources(cursor, now, p1_id=1, p2_id=2, p3_id=3):
    cursor.execute("SELECT COUNT(*) as count FROM resources")
    if cursor.fetchone()["count"] > 0:
        return

    now_str = now.isoformat()
    today_str = now.strftime("%Y-%m-%d")
    next_month_str = (now + timedelta(days=45)).strftime("%Y-%m-%d")

    initial_resources = [
        ("RES-001", "Dr. Alex Morgan", "Employee", "Engineering", "Architecture & DevOps", "Lead Architect & PM",
         ["Cloud Architecture", "System Design", "Microservices", "Security Compliance"],
         "Principal enterprise architect and delivery lead for distributed infrastructure.",
         "alex.morgan@company.internal", "+1 (555) 234-5678", "HQ - Floor 4", 120.0, "hr", "active"),

        ("RES-002", "Radhika Patel", "Employee", "Operations", "Project Management", "Senior Project Manager",
         ["Project Budget", "Gantt Scheduling", "Procurement", "Resource Planning"],
         "Lead PM overseeing chemical synthesis timelines, capital budgets, and supply logistics.",
         "radhika.patel@chemtatva.com", "+91 98765 43210", "Hyderabad Facility", 95.0, "hr", "active"),

        ("RES-003", "Vishal Sharma", "Employee", "R&D", "Formulation & Synthesis", "Research Chemist Lead",
         ["Organic Synthesis", "Reaction Optimization", "Process Chemistry", "Scale-up"],
         "Specialist in active compound synthesis, reactor batch recipes, and process scale-up.",
         "vishal.sharma@chemtatva.com", "+91 98765 43211", "Reactor Facility A", 85.0, "hr", "active"),

        ("RES-004", "Rajagopal Rao", "Employee", "QC/QA", "Quality Assurance", "QA & Validation Manager",
         ["ICH Guidelines", "GMP Compliance", "SOP Authoring", "Audit Readiness"],
         "Head of quality assurance and regulatory documentation for CDMO projects.",
         "rajagopal.rao@chemtatva.com", "+91 98765 43212", "QA Building 2", 90.0, "hr", "active"),

        ("RES-005", "Agilent 1290 Infinity HPLC System", "Laboratory Equipment", "QC/QA", "Analytical Chemistry", "High-Pressure Liquid Chromatograph",
         ["UHPLC", "Method Validation", "Purity Assay", "Impurity Profiling"],
         "Ultra-high-performance liquid chromatography instrument equipped with diode array detector.",
         "lab304.hplc@chemtatva.internal", "Ext. 3041", "Lab 304 - Analytical Suite", 45.0, "hr", "active"),

        ("RES-006", "Waters Xevo G2-XS Mass Spectrometer", "Laboratory Equipment", "QC/QA", "Mass Spectrometry", "Q-ToF MS Instrument",
         ["HRMS", "Structural Elucidation", "Peptide Mapping", "Intact Mass"],
         "High-resolution quadrupole time-of-flight mass spectrometry analyzer for molecular identification.",
         "lab308.ms@chemtatva.internal", "Ext. 3082", "Lab 308 - MS Suite", 75.0, "hr", "active"),

        ("RES-007", "Store & Raw Materials Inventory", "External Resource", "Operations", "Supply Chain", "Inventory & Warehouse Team",
         ["Material Ingestion", "Reagent Storage", "Dispensing", "Safety Protocol"],
         "Central warehouse team handling chemical precursors, inventory logs, and dispatch.",
         "store@chemtatva.com", "Ext. 1002", "Central Warehouse B", 35.0, "hr", "active"),

        ("RES-008", "QC Analytical Support Team", "Contractor", "QC/QA", "Analytical Testing", "Contract QC Analysis Group",
         ["Batch Release", "Stability Testing", "Karl Fischer", "Dissolution Testing"],
         "Dedicated laboratory analysis team for fast-turnaround raw material and in-process testing.",
         "qc.team@chemtatva.com", "Ext. 3010", "QC Analytical Wing", 60.0, "hr", "active"),

        ("RES-009", "500L Pilot Glass-Lined Reactor", "Equipment", "Operations", "Reactor Facility A", "Pilot Synthesis Reactor",
         ["Batch Synthesis", "Jacket Heating/Cooling", "Pressure Rating 3 Bar", "Reflux Condenser"],
         "Main pilot production vessel for kilogram-scale chemical synthesis and validation batches.",
         "reactor.a500@chemtatva.internal", "Ext. 2011", "Reactor Bay 1", 110.0, "hr", "active"),

        ("RES-010", "Eurofins Scientific Services", "Vendor", "Procurement", "External Testing", "Certified Reference Lab",
         ["Bioassay", "Genotoxicity", "Heavy Metals Analysis", "Third-Party Certificate"],
         "External accredited testing vendor for independent batch certification and compliance.",
         "support@eurofins.internal", "+1 (800) 555-0199", "External Service (Europe / USA)", 250.0, "hr", "active")
    ]

    res_ids = {}
    for code, name, r_type, cat, dept, role, skills, desc, email, phone, loc, rate, unit, status in initial_resources:
        cursor.execute("""
            INSERT INTO resources (
                resource_code, name, type, category, department, role, skills,
                description, contact_email, contact_phone, location, cost_rate,
                cost_unit, status, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            code, name, r_type, cat, dept, role, json.dumps(skills),
            desc, email, phone, loc, rate, unit, status, now_str, now_str
        ))
        res_ids[code] = cursor.lastrowid

    # Map resources to Project 1
    p1_mappings = [
        (res_ids["RES-001"], "Lead Architect", 80.0, today_str, next_month_str, "Overall Architecture & Performance", "active"),
        (res_ids["RES-002"], "Project Manager", 50.0, today_str, next_month_str, "Budgeting & Milestone Delivery", "active"),
        (res_ids["RES-005"], "Primary Analytical Instrument", 60.0, today_str, next_month_str, "High-Throughput Verification", "active"),
        (res_ids["RES-007"], "Logistics Support", 30.0, today_str, next_month_str, "Materials Intake", "active"),
        (res_ids["RES-008"], "QC Validation", 40.0, today_str, next_month_str, "Batch Testing & Calibration", "active")
    ]
    for r_id, role, alloc, s_date, e_date, resp, st in p1_mappings:
        cursor.execute("""
            INSERT OR IGNORE INTO project_resources (
                project_id, resource_id, role, allocation_pct, start_date, end_date,
                responsibility, status, notes, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (p1_id, r_id, role, alloc, s_date, e_date, resp, st, "Seeded project mapping", now_str, now_str))

    # Map resources to Project 2 (Multi-project allocation test)
    p2_mappings = [
        (res_ids["RES-002"], "Advisory PM", 30.0, today_str, next_month_str, "Cross-Team Sync", "active"),
        (res_ids["RES-003"], "Chemical Lead", 70.0, today_str, next_month_str, "Pilot Scaling Synthesis", "active"),
        (res_ids["RES-009"], "Pilot Reactor Unit", 50.0, today_str, next_month_str, "Reactor Batch Runs", "active")
    ]
    for r_id, role, alloc, s_date, e_date, resp, st in p2_mappings:
        if p2_id:
            cursor.execute("""
                INSERT OR IGNORE INTO project_resources (
                    project_id, resource_id, role, allocation_pct, start_date, end_date,
                    responsibility, status, notes, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (p2_id, r_id, role, alloc, s_date, e_date, resp, st, "Seeded project mapping", now_str, now_str))

    # Map resources to tasks in Project 1
    cursor.execute("SELECT id, title FROM tasks WHERE project_id = ?", (p1_id,))
    p1_tasks = cursor.fetchall()
    if p1_tasks:
        for idx, task in enumerate(p1_tasks[:4]):
            t_id = task["id"]
            # Map Radhika to task 1 & 2
            if idx in (0, 1) and "RES-002" in res_ids:
                cursor.execute("""
                    INSERT OR IGNORE INTO task_resources (task_id, resource_id, project_id, role, responsibility, allocation_pct, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (t_id, res_ids["RES-002"], p1_id, "Project Manager", "Project Budget & Approval", 50.0, now_str))
            # Map HPLC instrument to task 2 & 3
            if idx in (1, 2) and "RES-005" in res_ids:
                cursor.execute("""
                    INSERT OR IGNORE INTO task_resources (task_id, resource_id, project_id, role, responsibility, allocation_pct, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (t_id, res_ids["RES-005"], p1_id, "Analytical Instrument", "Chromatography Verification", 60.0, now_str))
            # Map Store team to task 0 & 3
            if idx in (0, 3) and "RES-007" in res_ids:
                cursor.execute("""
                    INSERT OR IGNORE INTO task_resources (task_id, resource_id, project_id, role, responsibility, allocation_pct, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (t_id, res_ids["RES-007"], p1_id, "Logistics", "Raw Material Delivery", 30.0, now_str))

if __name__ == "__main__":
    seed_database()
