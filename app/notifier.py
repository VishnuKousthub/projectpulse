"""
ProjectPulse - Microsoft Outlook and SMTP Email Notification Engine
Handles automated email alerts for:
1. 1 Day Before Due Date (Nearing Due Date)
2. On Due Date (Pending Due Date Reminder)
3. 1 Day After Due Date and Recurring Weekly Overdue Escalations
4. Task Assignment Notifications
5. Task Completion Confirmations
"""

import os
import json
import smtplib
import threading
import time
from datetime import datetime, timezone, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.database import get_db

def get_now_iso():
    return datetime.now(timezone.utc).isoformat()

def get_settings(conn):
    row = conn.execute("SELECT * FROM email_settings WHERE id = 1").fetchone()
    if not row:
        now_str = get_now_iso()
        conn.execute("""
            INSERT INTO email_settings (
                id, smtp_provider, smtp_host, smtp_port, smtp_user, smtp_pass,
                sender_name, use_tls, is_enabled, simulation_mode,
                notify_due_soon, notify_due_today, notify_overdue, recurring_day,
                notify_assigned, notify_completed, updated_at
            )
            VALUES (
                1, 'outlook', 'smtp.office365.com', 587, '', '',
                'ProjectPulse Notifications', 1, 1, 1,
                1, 1, 1, 'monday', 1, 1, ?
            )
        """, (now_str,))
        row = conn.execute("SELECT * FROM email_settings WHERE id = 1").fetchone()
    return dict(row)

def render_html_email(
    headline: str,
    subject: str,
    message_paragraphs: list,
    task: dict,
    project: dict,
    alert_badge: str = "Notification",
    badge_color: str = "#3B82F6",
    action_url: str = "http://127.0.0.1:8000"
) -> str:
    paragraphs_html = "".join([f"<p style='margin: 0 0 14px; font-size: 14px; line-height: 1.6; color: #334155;'>{p}</p>" for p in message_paragraphs])
    
    tags_list = []
    try:
        if task.get("tags"):
            tags_list = json.loads(task["tags"]) if isinstance(task["tags"], str) else task["tags"]
    except Exception:
        tags_list = []
    
    tags_html = "".join([f"<span style='display:inline-block; padding: 2px 8px; margin-right: 4px; font-size: 11px; background-color: #f1f5f9; color: #475569; border-radius: 4px; font-weight: 600;'>#{t}</span>" for t in tags_list])

    task_desc_html = f"<div style='font-size: 12px; color: #475569; margin-top: 4px;'>{task.get('description')}</div>" if task.get('description') else ""
    tags_row_html = f"<tr><td style='padding-top: 10px;'>{tags_html}</td></tr>" if tags_html else ""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{subject}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color: #f8fafc; padding: 30px 10px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);" cellspacing="0" cellpadding="0" border="0">
          <tr>
            <td style="background-color: #0f172a; padding: 20px 28px; border-bottom: 3px solid #3b82f6;">
              <table width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="left">
                    <span style="font-size: 18px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">Project<span style="color: #60a5fa;">Pulse</span></span>
                    <span style="display: block; font-size: 11px; color: #94a3b8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 2px;">Workspace Notifications</span>
                  </td>
                  <td align="right">
                    <span style="display: inline-block; padding: 4px 10px; font-size: 11px; font-weight: 700; text-transform: uppercase; color: #ffffff; background-color: {badge_color}; border-radius: 9999px;">
                      {alert_badge}
                    </span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 28px 20px;">
              <h2 style="margin: 0 0 16px; font-size: 18px; font-weight: 700; color: #0f172a; line-height: 1.3;">
                {headline}
              </h2>
              {paragraphs_html}
              <table role="presentation" width="100%" style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; margin: 20px 0; padding: 16px;" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="padding-bottom: 10px;">
                    <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b;">Project</span>
                    <div style="font-size: 14px; font-weight: 700; color: #1e293b; margin-top: 2px;">{project.get('name', 'Active Project')}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom: 10px; border-top: 1px solid #e2e8f0; padding-top: 10px;">
                    <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b;">Activity / Task</span>
                    <div style="font-size: 15px; font-weight: 700; color: #2563eb; margin-top: 2px;">{task.get('title', 'Untitled Activity')}</div>
                    {task_desc_html}
                  </td>
                </tr>
                <tr>
                  <td style="border-top: 1px solid #e2e8f0; padding-top: 10px;">
                    <table width="100%" cellspacing="0" cellpadding="0" border="0">
                      <tr>
                        <td width="50%" valign="top">
                          <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b;">Timeline</span>
                          <div style="font-size: 13px; font-weight: 600; color: #334155; margin-top: 2px; font-family: monospace;">
                            {task.get('start_date') or 'N/A'} &rarr; <span style="color: #dc2626; font-weight: bold;">{task.get('due_date') or 'N/A'}</span>
                          </div>
                        </td>
                        <td width="25%" valign="top">
                          <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b;">Status</span>
                          <div style="font-size: 13px; font-weight: 600; text-transform: capitalize; color: #334155; margin-top: 2px;">
                            {str(task.get('status', 'todo')).replace('_', ' ')}
                          </div>
                        </td>
                        <td width="25%" valign="top">
                          <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #64748b;">Priority</span>
                          <div style="font-size: 13px; font-weight: 700; text-transform: capitalize; color: #d97706; margin-top: 2px;">
                            {task.get('priority', 'medium')}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                {tags_row_html}
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin: 24px 0 10px;">
                <tr>
                  <td align="center">
                    <a href="{action_url}" target="_blank" style="display: inline-block; background-color: #2563eb; color: #ffffff; font-weight: 700; font-size: 13px; text-decoration: none; padding: 12px 28px; border-radius: 8px; box-shadow: 0 2px 4px rgba(37,99,235,0.2);">
                      Open in ProjectPulse &rarr;
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; padding: 16px 28px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0; font-size: 11px; color: #94a3b8;">
                Automated notification from <strong>ProjectPulse</strong>. To manage alerts or Microsoft Outlook settings, visit Workspace Settings in ProjectPulse.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>"""
    return html

def send_email_dispatch(
    conn,
    project_id: int,
    task_id: int,
    recipient_email: str,
    recipient_name: str,
    subject: str,
    body_html: str,
    trigger_type: str
) -> dict:
    if not recipient_email or '@' not in recipient_email:
        return {'success': False, 'error': f"Invalid recipient email: '{recipient_email}'"}

    settings = get_settings(conn)
    if not settings.get('is_enabled'):
        return {'success': False, 'error': 'Email notifications are globally disabled in settings'}

    now_str = get_now_iso()
    status = 'simulated'
    error_msg = None

    should_send_smtp = (
        not settings.get('simulation_mode') and
        settings.get('smtp_user') and
        settings.get('smtp_pass') and
        settings.get('smtp_host')
    )

    if should_send_smtp:
        try:
            msg = MIMEMultipart('alternative')
            msg['Subject'] = subject
            sender_name = settings.get('sender_name') or 'ProjectPulse Notifications'
            sender_addr = settings.get('smtp_user')
            msg['From'] = f"{sender_name} <{sender_addr}>"
            msg['To'] = f"{recipient_name} <{recipient_email}>" if recipient_name else recipient_email

            html_part = MIMEText(body_html, 'html', 'utf-8')
            msg.attach(html_part)

            host = settings.get('smtp_host', 'smtp.office365.com')
            port = int(settings.get('smtp_port', 587))
            
            with smtplib.SMTP(host, port, timeout=12) as server:
                server.ehlo()
                if settings.get('use_tls', 1):
                    server.starttls()
                    server.ehlo()
                server.login(settings.get('smtp_user'), settings.get('smtp_pass'))
                server.sendmail(sender_addr, [recipient_email], msg.as_string())
            
            status = 'sent'
        except Exception as e:
            status = 'failed'
            error_msg = str(e)
    else:
        status = 'simulated'

    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO email_logs (
            project_id, task_id, recipient_email, recipient_name,
            subject, body_html, trigger_type, status, error_message, sent_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        project_id, task_id, recipient_email, recipient_name,
        subject, body_html, trigger_type, status, error_msg, now_str
    ))

    return {
        'success': status in ['sent', 'simulated'],
        'status': status,
        'error': error_msg,
        'recipient': recipient_email,
        'trigger_type': trigger_type
    }

def notify_task_assigned(conn, task_id: int, previous_assignee_id: int = None):
    settings = get_settings(conn)
    if not settings.get('notify_assigned'):
        return

    task = conn.execute("""
        SELECT t.*, m.name as assignee_name, m.email as assignee_email,
               p.name as project_name
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        LEFT JOIN members m ON t.assignee_id = m.id
        WHERE t.id = ?
    """, (task_id,)).fetchone()

    if not task or not task['assignee_email']:
        return

    if previous_assignee_id is not None and previous_assignee_id == task['assignee_id']:
        return

    subject = f"📋 Assigned: {task['title']} - {task['project_name']}"
    headline = "You have been assigned to an activity"
    messages = [
        f"Hello <strong>{task['assignee_name']}</strong>,",
        f"You have been assigned as the owner for <strong>'{task['title']}'</strong> in project <strong>'{task['project_name']}'</strong>.",
        f"Please review the timeline dates and requirements in the task details below."
    ]

    body_html = render_html_email(
        headline=headline,
        subject=subject,
        message_paragraphs=messages,
        task=dict(task),
        project={'name': task['project_name']},
        alert_badge='New Assignment',
        badge_color='#3B82F6'
    )

    send_email_dispatch(
        conn=conn,
        project_id=task['project_id'],
        task_id=task['id'],
        recipient_email=task['assignee_email'],
        recipient_name=task['assignee_name'],
        subject=subject,
        body_html=body_html,
        trigger_type='assigned'
    )

def notify_task_completed(conn, task_id: int, actor_name: str = 'User'):
    settings = get_settings(conn)
    if not settings.get('notify_completed'):
        return

    task = conn.execute("""
        SELECT t.*, m.name as assignee_name, m.email as assignee_email,
               p.name as project_name
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        LEFT JOIN members m ON t.assignee_id = m.id
        WHERE t.id = ?
    """, (task_id,)).fetchone()

    if not task or not task['assignee_email']:
        return

    subject = f"✅ Completed: {task['title']} - {task['project_name']}"
    headline = "Activity marked as completed"
    messages = [
        f"Hello <strong>{task['assignee_name']}</strong>,",
        f"The activity <strong>'{task['title']}'</strong> in project <strong>'{task['project_name']}'</strong> has been marked as <strong>Completed (Done)</strong> by {actor_name}.",
        f"Total recorded actual hours: <strong>{task['actual_hours']}h</strong> (Estimated: {task['estimated_hours']}h)."
    ]

    body_html = render_html_email(
        headline=headline,
        subject=subject,
        message_paragraphs=messages,
        task=dict(task),
        project={'name': task['project_name']},
        alert_badge='Completed',
        badge_color='#10B981'
    )

    send_email_dispatch(
        conn=conn,
        project_id=task['project_id'],
        task_id=task['id'],
        recipient_email=task['assignee_email'],
        recipient_name=task['assignee_name'],
        subject=subject,
        body_html=body_html,
        trigger_type='completed'
    )

def run_all_due_date_checks(conn, reference_date_str: str = None) -> list:
    settings = get_settings(conn)
    if not settings.get('is_enabled'):
        return []

    if reference_date_str:
        try:
            today = datetime.strptime(reference_date_str, '%Y-%m-%d').date()
        except Exception:
            today = datetime.now(timezone.utc).date()
    else:
        today = datetime.now(timezone.utc).date()

    today_str = today.strftime('%Y-%m-%d')
    weekday_name = today.strftime('%A').lower()
    recurring_day = (settings.get('recurring_day') or 'monday').lower()

    tasks = conn.execute("""
        SELECT t.*, m.name as assignee_name, m.email as assignee_email,
               p.name as project_name
        FROM tasks t
        JOIN projects p ON t.project_id = p.id
        LEFT JOIN members m ON t.assignee_id = m.id
        WHERE t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date != ''
          AND m.email IS NOT NULL AND m.email != ''
        ORDER BY t.due_date ASC
    """).fetchall()

    results = []

    for task in tasks:
        try:
            due_date = datetime.strptime(task['due_date'], '%Y-%m-%d').date()
        except Exception:
            continue

        delta_days = (due_date - today).days

        # 1. Action 1: 1 Day Before Due Date
        if delta_days == 1 and settings.get('notify_due_soon'):
            trigger = 'due_soon'
            already_sent = conn.execute("""
                SELECT id FROM notification_dispatches
                WHERE task_id = ? AND trigger_type = ? AND dispatch_date = ?
            """, (task['id'], trigger, today_str)).fetchone()

            if not already_sent:
                subject = f"⏳ Reminder: Due Tomorrow - {task['title']} ({task['project_name']})"
                headline = "Activity Deadline Approaching Tomorrow"
                messages = [
                    f"Hello <strong>{task['assignee_name']}</strong>,",
                    f"This is a reminder that your assigned activity <strong>'{task['title']}'</strong> in <strong>'{task['project_name']}'</strong> is due tomorrow on <strong>{task['due_date']}</strong>.",
                    f"Current status is <strong>{task['status'].replace('_', ' ').capitalize()}</strong>. Please make sure all requirements are on track."
                ]
                body_html = render_html_email(
                    headline=headline,
                    subject=subject,
                    message_paragraphs=messages,
                    task=dict(task),
                    project={'name': task['project_name']},
                    alert_badge='Due Tomorrow',
                    badge_color='#F59E0B'
                )
                res = send_email_dispatch(conn, task['project_id'], task['id'], task['assignee_email'], task['assignee_name'], subject, body_html, trigger)
                conn.execute("""
                    INSERT INTO notification_dispatches (task_id, trigger_type, dispatch_date, recipient_email, created_at)
                    VALUES (?, ?, ?, ?, ?)
                """, (task['id'], trigger, today_str, task['assignee_email'], get_now_iso()))
                results.append(res)

        # 2. Action 2: On Due Date
        elif delta_days == 0 and settings.get('notify_due_today'):
            trigger = 'due_today'
            already_sent = conn.execute("""
                SELECT id FROM notification_dispatches
                WHERE task_id = ? AND trigger_type = ? AND dispatch_date = ?
            """, (task['id'], trigger, today_str)).fetchone()

            if not already_sent:
                subject = f"🚨 Action Required: Due Today - {task['title']} ({task['project_name']})"
                headline = "Activity is Due Today"
                messages = [
                    f"Hello <strong>{task['assignee_name']}</strong>,",
                    f"The activity <strong>'{task['title']}'</strong> in project <strong>'{task['project_name']}'</strong> has reached its due date today (<strong>{task['due_date']}</strong>) and is currently pending.",
                    f"Please complete the activity deliverables or update the progress status in ProjectPulse."
                ]
                body_html = render_html_email(
                    headline=headline,
                    subject=subject,
                    message_paragraphs=messages,
                    task=dict(task),
                    project={'name': task['project_name']},
                    alert_badge='Due Today',
                    badge_color='#EF4444'
                )
                res = send_email_dispatch(conn, task['project_id'], task['id'], task['assignee_email'], task['assignee_name'], subject, body_html, trigger)
                conn.execute("""
                    INSERT INTO notification_dispatches (task_id, trigger_type, dispatch_date, recipient_email, created_at)
                    VALUES (?, ?, ?, ?, ?)
                """, (task['id'], trigger, today_str, task['assignee_email'], get_now_iso()))
                results.append(res)

        # 3. Action 3: Next Day After Due Date
        elif delta_days == -1 and settings.get('notify_overdue'):
            trigger = 'overdue_1day'
            already_sent = conn.execute("""
                SELECT id FROM notification_dispatches
                WHERE task_id = ? AND trigger_type = ? AND dispatch_date = ?
            """, (task['id'], trigger, today_str)).fetchone()

            if not already_sent:
                subject = f"⚠️ Overdue Alert: {task['title']} is 1 day overdue ({task['project_name']})"
                headline = "Activity is Overdue (1 Day Past Due)"
                messages = [
                    f"Hello <strong>{task['assignee_name']}</strong>,",
                    f"The activity <strong>'{task['title']}'</strong> in project <strong>'{task['project_name']}'</strong> was due yesterday on <strong>{task['due_date']}</strong> and remains pending.",
                    f"Please take immediate action to complete this activity or adjust the timeline schedule."
                ]
                body_html = render_html_email(
                    headline=headline,
                    subject=subject,
                    message_paragraphs=messages,
                    task=dict(task),
                    project={'name': task['project_name']},
                    alert_badge='Overdue Alert',
                    badge_color='#DC2626'
                )
                res = send_email_dispatch(conn, task['project_id'], task['id'], task['assignee_email'], task['assignee_name'], subject, body_html, trigger)
                conn.execute("""
                    INSERT INTO notification_dispatches (task_id, trigger_type, dispatch_date, recipient_email, created_at)
                    VALUES (?, ?, ?, ?, ?)
                """, (task['id'], trigger, today_str, task['assignee_email'], get_now_iso()))
                results.append(res)

        # 4. Action 3 (cont): Recurring Weekly Overdue Escalations
        elif delta_days < -1 and settings.get('notify_overdue'):
            days_overdue = abs(delta_days)
            is_weekly_trigger = (weekday_name == recurring_day) or (days_overdue % 7 == 0)

            if is_weekly_trigger:
                trigger = f"overdue_recurring_{days_overdue}d"
                already_sent = conn.execute("""
                    SELECT id FROM notification_dispatches
                    WHERE task_id = ? AND trigger_type = ? AND dispatch_date = ?
                """, (task['id'], trigger, today_str)).fetchone()

                if not already_sent:
                    subject = f"🔁 Weekly Overdue Escalation: {task['title']} ({days_overdue} days overdue)"
                    headline = f"Recurring Overdue Reminder: {days_overdue} Days Past Due"
                    messages = [
                        f"Hello <strong>{task['assignee_name']}</strong>,",
                        f"This is your weekly recurring escalation reminder for pending activity <strong>'{task['title']}'</strong> in <strong>'{task['project_name']}'</strong>.",
                        f"This activity had a deadline of <strong>{task['due_date']}</strong> and is now <strong>{days_overdue} days overdue</strong>.",
                        f"Please update the project management board with latest progress status."
                    ]
                    body_html = render_html_email(
                        headline=headline,
                        subject=subject,
                        message_paragraphs=messages,
                        task=dict(task),
                        project={'name': task['project_name']},
                        alert_badge=f"{days_overdue}d Overdue",
                        badge_color='#991B1B'
                    )
                    res = send_email_dispatch(conn, task['project_id'], task['id'], task['assignee_email'], task['assignee_name'], subject, body_html, 'overdue_recurring')
                    conn.execute("""
                        INSERT INTO notification_dispatches (task_id, trigger_type, dispatch_date, recipient_email, created_at)
                        VALUES (?, ?, ?, ?, ?)
                    """, (task['id'], trigger, today_str, task['assignee_email'], get_now_iso()))
                    results.append(res)

    return results

def send_test_email(conn, recipient_email: str) -> dict:
    sample_task = {
        'title': 'Azadol Batch Production Quality Clearance',
        'description': 'Verify spectroscopic purity and HPLC yield certificates for 1kg production batch.',
        'start_date': '2026-08-28',
        'due_date': '2026-09-02',
        'status': 'in_progress',
        'priority': 'high',
        'tags': ['outlook', 'test', 'compliance']
    }
    sample_project = {
        'name': 'AZADOL (CCS079) - 1kg Batch Production'
    }
    subject = "🧪 Test Notification: ProjectPulse Microsoft Outlook Integration"
    headline = "Microsoft Outlook Email Integration Active!"
    messages = [
        "Hello from <strong>ProjectPulse</strong>,",
        "This is a confirmation test email verifying that your Microsoft Outlook / SMTP connection is properly configured and functioning.",
        "Automated notifications will be triggered for: 1 day before due dates, on due dates, overdue escalation reminders, activity assignments, and completions."
    ]

    body_html = render_html_email(
        headline=headline,
        subject=subject,
        message_paragraphs=messages,
        task=sample_task,
        project=sample_project,
        alert_badge='Test Email',
        badge_color='#3B82F6'
    )

    return send_email_dispatch(
        conn=conn,
        project_id=1,
        task_id=None,
        recipient_email=recipient_email,
        recipient_name='Project Team Member',
        subject=subject,
        body_html=body_html,
        trigger_type='test_email'
    )

_scheduler_started = False
_scheduler_lock = threading.Lock()

def _scheduler_loop():
    while True:
        try:
            with get_db() as conn:
                run_all_due_date_checks(conn)
        except Exception as e:
            print(f"[ProjectPulse Notifier] Background check error: {e}")
        time.sleep(3600)

def start_background_scheduler():
    global _scheduler_started
    with _scheduler_lock:
        if not _scheduler_started:
            t = threading.Thread(target=_scheduler_loop, daemon=True, name='ProjectPulseEmailScheduler')
            t.start()
            _scheduler_started = True
            print("[ProjectPulse Notifier] Background email notification scheduler started successfully.")
