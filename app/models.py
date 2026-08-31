from typing import List, Optional, Any, Dict
from pydantic import BaseModel, Field

class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    color: Optional[str] = "#3B82F6"

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None

class MemberCreate(BaseModel):
    name: str
    email: Optional[str] = ""
    role: Optional[str] = "Member"
    avatar_color: Optional[str] = "#6366F1"

class SprintCreate(BaseModel):
    name: str
    goal: Optional[str] = ""
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    status: Optional[str] = "planning"

class SprintUpdate(BaseModel):
    name: Optional[str] = None
    goal: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    status: Optional[str] = None

class MilestoneCreate(BaseModel):
    title: str
    due_date: str
    status: Optional[str] = "pending"

class MilestoneUpdate(BaseModel):
    title: Optional[str] = None
    due_date: Optional[str] = None
    status: Optional[str] = None

class SubtaskCreate(BaseModel):
    title: str
    completed: Optional[bool] = False

class SubtaskUpdate(BaseModel):
    title: Optional[str] = None
    completed: Optional[bool] = None

class TimeLogCreate(BaseModel):
    task_id: int
    member_id: Optional[int] = None
    hours: float
    description: Optional[str] = ""
    logged_date: Optional[str] = None

class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    status: Optional[str] = "todo"
    priority: Optional[str] = "medium"
    sprint_id: Optional[int] = None
    assignee_id: Optional[int] = None
    start_date: Optional[str] = None
    due_date: Optional[str] = None
    estimated_hours: Optional[float] = 0.0
    tags: Optional[List[str]] = []
    subtasks: Optional[List[str]] = []

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    sprint_id: Optional[int] = None
    assignee_id: Optional[int] = None
    order_index: Optional[int] = None
    start_date: Optional[str] = None
    due_date: Optional[str] = None
    estimated_hours: Optional[float] = None
    actual_hours: Optional[float] = None
    tags: Optional[List[str]] = None

class TaskReorder(BaseModel):
    task_id: int
    status: str
    new_order_index: int
