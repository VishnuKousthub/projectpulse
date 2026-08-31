/**
 * ProjectPulse - Modern Project Management SPA Logic
 */

const app = {
  state: {
    projects: [],
    currentProjectId: null,
    currentProject: null,
    tasks: [],
    activeView: 'kanban',
    ganttScale: 'week', // 'day' | 'week' | 'month' | 'year'
    ganttOffset: 0,
    searchQuery: '',
    filterAssignee: '',
    filterPriority: '',
    filterSprint: '',
    calendarDate: new Date(),
    stopwatch: {
      timerId: null,
      startTime: 0,
      elapsedMs: 0,
      isRunning: false,
      taskId: null,
      taskTitle: ''
    },
    charts: {},
    sortableInstances: []
  },

  async init() {
    this.initTheme();
    this.initKeyboardShortcuts();
    await this.fetchProjects();
    this.initLucide();
  },

  initTheme() {
    const isDark = localStorage.getItem('projectpulse_theme') === 'dark' ||
      (!('projectpulse_theme' in localStorage) && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (isDark) {
      document.documentElement.classList.add('dark');
      document.getElementById('theme-icon')?.setAttribute('data-lucide', 'sun');
      const tText = document.getElementById('theme-text');
      if (tText) tText.textContent = 'Light Mode';
    }
  },

  toggleDarkMode() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('projectpulse_theme', isDark ? 'dark' : 'light');
    const icon = document.getElementById('theme-icon');
    const text = document.getElementById('theme-text');
    if (icon) icon.setAttribute('data-lucide', isDark ? 'sun' : 'moon');
    if (text) text.textContent = isDark ? 'Light Mode' : 'Dark Mode';
    this.initLucide();
    if (this.state.activeView === 'analytics') {
      this.renderAnalytics();
    }
  },

  initLucide() {
    if (window.lucide) {
      window.lucide.createIcons();
    }
  },

  initKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
        e.preventDefault();
        document.getElementById('global-search')?.focus();
      }
      if (e.key === 'Escape') {
        this.closeAllModals();
      }
    });
  },

  closeAllModals() {
    this.closeTaskModal();
    this.closeProjectModal();
    this.closeSprintModal();
    this.closeMilestoneModal();
    this.closeManualTimeLogModal();
    this.closeImportExportModal();
    this.closeGanttUploadModal();
  },

  toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.toggle('-translate-x-full');
  },

  async api(endpoint, options = {}) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        },
        ...options
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || errData.detail || `Request failed with status ${response.status}`);
      }
      return await response.json();
    } catch (err) {
      this.showToast(err.message, 'error');
      throw err;
    }
  },

  async fetchProjects() {
    try {
      const projects = await this.api('/api/projects');
      this.state.projects = projects;
      this.renderProjectsDropdown();
      this.renderProjectsSidebar();

      if (projects.length > 0) {
        const savedId = localStorage.getItem('projectpulse_active_project');
        const exists = projects.find(p => p.id === Number(savedId));
        await this.selectProject(exists ? exists.id : projects[0].id);
      } else {
        this.openProjectModal();
      }
    } catch (e) {
      console.error(e);
    }
  },

  renderProjectsDropdown() {
    const select = document.getElementById('project-select');
    if (!select) return;
    select.innerHTML = this.state.projects.map(p => `
      <option value="${p.id}" ${p.id === this.state.currentProjectId ? 'selected' : ''}>
        ${this.escapeHtml(p.name)}
      </option>
    `).join('');

    select.onchange = (e) => this.selectProject(Number(e.target.value));
  },

  renderProjectsSidebar() {
    const container = document.getElementById('projects-list-sidebar');
    if (!container) return;
    container.innerHTML = this.state.projects.map(p => `
      <div class="group/p flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${p.id === this.state.currentProjectId ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}">
        <button onclick="app.selectProject(${p.id})" class="flex items-center space-x-2 truncate flex-1 text-left min-w-0">
          <span class="w-2 h-2 rounded-full flex-shrink-0" style="background-color: ${p.color || '#3B82F6'}"></span>
          <span class="truncate">${this.escapeHtml(p.name)}</span>
        </button>
        <div class="flex items-center space-x-1.5 flex-shrink-0">
          <span class="text-[10px] text-slate-500">${p.completed_tasks || 0}/${p.total_tasks || 0}</span>
          <button onclick="event.stopPropagation(); app.deleteProject(${p.id}, '${this.escapeHtml(p.name)}')" title="Delete Project" class="opacity-0 group-hover/p:opacity-100 p-0.5 text-slate-400 hover:text-rose-400 rounded transition">
            <i data-lucide="trash-2" class="w-3 h-3"></i>
          </button>
        </div>
      </div>
    `).join('');
    this.initLucide();
  },

  async selectProject(projectId) {
    this.state.currentProjectId = projectId;
    localStorage.setItem('projectpulse_active_project', projectId);
    
    this.state.currentProject = await this.api(`/api/projects/${projectId}`);
    
    const select = document.getElementById('project-select');
    if (select) select.value = projectId;
    this.renderProjectsSidebar();
    this.populateFilterDropdowns();

    await this.fetchTasks();
  },

  populateFilterDropdowns() {
    const memberSelect = document.getElementById('filter-assignee');
    const members = this.state.currentProject?.members || [];
    if (memberSelect) {
      memberSelect.innerHTML = `
        <option value="">All Assignees</option>
        ${members.map(m => `<option value="${m.id}">${this.escapeHtml(m.name)}</option>`).join('')}
      `;
    }
  },

  switchView(viewName) {
    this.state.activeView = viewName;

    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.classList.remove('bg-blue-600', 'text-white', 'font-semibold', 'shadow-xs');
      btn.classList.add('text-slate-300');
    });
    const activeNav = document.getElementById(`nav-${viewName}`);
    if (activeNav) {
      activeNav.classList.add('bg-blue-600', 'text-white', 'font-semibold', 'shadow-xs');
      activeNav.classList.remove('text-slate-300');
    }

    document.querySelectorAll('.view-panel').forEach(panel => panel.classList.add('hidden'));
    const targetPanel = document.getElementById(`view-${viewName}-container`);
    if (targetPanel) targetPanel.classList.remove('hidden');

    const titles = {
      kanban: 'Kanban Board',
      gantt: 'Gantt & Timeline',
      table: 'Table Grid',
      calendar: 'Calendar Schedule',
      sprints: 'Sprints & Milestones',
      timetracker: 'Time Tracker',
      analytics: 'Analytics Dashboard'
    };
    const titleText = titles[viewName] || 'Project Management';
    const vTitle = document.getElementById('view-title');
    if (vTitle) vTitle.textContent = titleText;

    this.renderCurrentView();
    this.initLucide();
  },

  renderCurrentView() {
    switch (this.state.activeView) {
      case 'kanban':
        this.renderKanban();
        break;
      case 'gantt':
        this.renderGantt();
        break;
      case 'table':
        this.renderTable();
        break;
      case 'calendar':
        this.renderCalendar();
        break;
      case 'sprints':
        this.renderSprints();
        break;
      case 'timetracker':
        this.renderTimeTracker();
        break;
      case 'analytics':
        this.renderAnalytics();
        break;
    }
  },

  async fetchTasks() {
    if (!this.state.currentProjectId) return;
    
    let url = `/api/projects/${this.state.currentProjectId}/tasks?`;
    if (this.state.searchQuery) url += `search=${encodeURIComponent(this.state.searchQuery)}&`;
    if (this.state.filterAssignee) url += `assignee_id=${encodeURIComponent(this.state.filterAssignee)}&`;
    if (this.state.filterPriority) url += `priority=${encodeURIComponent(this.state.filterPriority)}&`;
    if (this.state.filterSprint) url += `sprint_id=${encodeURIComponent(this.state.filterSprint)}&`;

    try {
      const tasks = await this.api(url);
      this.state.tasks = tasks;
      this.renderCurrentView();
    } catch (e) {
      console.error(e);
    }
  },

  handleSearch(value) {
    this.state.searchQuery = value;
    this.fetchTasks();
  },

  handleFilterChange() {
    this.state.filterAssignee = document.getElementById('filter-assignee')?.value || '';
    this.state.filterPriority = document.getElementById('filter-priority')?.value || '';
    this.fetchTasks();
  },

  // ==================== KANBAN BOARD RENDERER (TACTILE, SWIMLANES & ADVANCED CARDS) ====================
  setKanbanSwimlane(val) {
    this.state.kanbanSwimlane = val || 'status';
    this.renderKanban();
  },

  handleKanbanFilter(val) {
    this.state.kanbanFilterQuery = (val || '').toLowerCase().trim();
    this.renderKanban();
  },

  async advanceTaskStatus(taskId) {
    const task = this.state.tasks.find(t => t.id === taskId);
    if (!task) return;
    const flow = ['backlog', 'todo', 'in_progress', 'in_review', 'done'];
    const curIdx = flow.indexOf(task.status);
    const nextStatus = curIdx < flow.length - 1 ? flow[curIdx + 1] : flow[0];
    await this.inlineUpdateTask(taskId, 'status', nextStatus);
  },

  async quickToggleTaskDone(taskId, currentStatus) {
    const nextStatus = currentStatus === 'done' ? 'in_progress' : 'done';
    await this.inlineUpdateTask(taskId, 'status', nextStatus);
  },

  renderKanban() {
    const boardContainer = document.getElementById('kanban-board-render');
    if (!boardContainer) return;

    if (!this.state.kanbanSwimlane) this.state.kanbanSwimlane = 'status';
    const allTasks = this.state.tasks || [];
    const members = this.state.currentProject?.members || [];
    const sprints = this.state.currentProject?.sprints || [];
    const todayStr = new Date().toISOString().split('T')[0];

    // 1. Calculate Workflow Pipeline Breakdown
    const totalAll = allTasks.length;
    const countBacklog = allTasks.filter(t => t.status === 'backlog').length;
    const countTodo = allTasks.filter(t => t.status === 'todo').length;
    const countInProg = allTasks.filter(t => t.status === 'in_progress').length;
    const countInRev = allTasks.filter(t => t.status === 'in_review').length;
    const countDone = allTasks.filter(t => t.status === 'done').length;

    const pctBacklog = totalAll > 0 ? (countBacklog / totalAll) * 100 : 0;
    const pctTodo = totalAll > 0 ? (countTodo / totalAll) * 100 : 0;
    const pctInProg = totalAll > 0 ? (countInProg / totalAll) * 100 : 0;
    const pctInRev = totalAll > 0 ? (countInRev / totalAll) * 100 : 0;
    const pctDone = totalAll > 0 ? (countDone / totalAll) * 100 : 0;

    // Update Progress Bars & Labels
    const barB = document.getElementById('bar-backlog');
    const barT = document.getElementById('bar-todo');
    const barP = document.getElementById('bar-in_progress');
    const barR = document.getElementById('bar-in_review');
    const barD = document.getElementById('bar-done');

    if (barB) barB.style.width = `${pctBacklog}%`;
    if (barT) barT.style.width = `${pctTodo}%`;
    if (barP) barP.style.width = `${pctInProg}%`;
    if (barR) barR.style.width = `${pctInRev}%`;
    if (barD) barD.style.width = `${pctDone}%`;

    const lblB = document.getElementById('label-backlog');
    const lblT = document.getElementById('label-todo');
    const lblP = document.getElementById('label-in_progress');
    const lblR = document.getElementById('label-in_review');
    const lblD = document.getElementById('label-done');
    const totBadge = document.getElementById('kanban-total-badge');

    if (totBadge) totBadge.textContent = `${totalAll} Activities`;
    if (lblB) lblB.innerHTML = `<span class="w-2 h-2 rounded-full bg-slate-400"></span> Backlog: ${countBacklog}`;
    if (lblT) lblT.innerHTML = `<span class="w-2 h-2 rounded-full bg-blue-500"></span> To Do: ${countTodo}`;
    if (lblP) lblP.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-500"></span> In Progress: ${countInProg}`;
    if (lblR) lblR.innerHTML = `<span class="w-2 h-2 rounded-full bg-purple-500"></span> In Review: ${countInRev}`;
    if (lblD) lblD.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500"></span> Done: ${countDone}`;

    // 2. Filter tasks
    const q = this.state.kanbanFilterQuery || '';
    const filteredTasks = allTasks.filter(t => {
      if (!q) return true;
      const titleMatch = (t.title || '').toLowerCase().includes(q);
      const descMatch = (t.description || '').toLowerCase().includes(q);
      const tagsMatch = (t.tags || []).some(tag => tag.toLowerCase().includes(q));
      const assignee = members.find(m => m.id === t.assignee_id);
      const assigneeMatch = assignee && assignee.name.toLowerCase().includes(q);
      return titleMatch || descMatch || tagsMatch || assigneeMatch;
    });

    // 3. Destroy previous SortableJS instances
    this.state.sortableInstances.forEach(inst => inst.destroy());
    this.state.sortableInstances = [];

    // 4. Render Layout
    const columnsMeta = [
      { id: 'backlog', title: 'Backlog', color: 'bg-slate-400', textColor: 'text-slate-700 dark:text-slate-300', headerBg: 'bg-slate-100 dark:bg-slate-800' },
      { id: 'todo', title: 'To Do', color: 'bg-blue-500', textColor: 'text-blue-700 dark:text-blue-300', headerBg: 'bg-blue-50 dark:bg-blue-950/40' },
      { id: 'in_progress', title: 'In Progress', color: 'bg-amber-500', textColor: 'text-amber-700 dark:text-amber-300', headerBg: 'bg-amber-50 dark:bg-amber-950/40' },
      { id: 'in_review', title: 'In Review', color: 'bg-purple-500', textColor: 'text-purple-700 dark:text-purple-300', headerBg: 'bg-purple-50 dark:bg-purple-950/40' },
      { id: 'done', title: 'Done', color: 'bg-emerald-500', textColor: 'text-emerald-700 dark:text-emerald-300', headerBg: 'bg-emerald-50 dark:bg-emerald-950/40' }
    ];

    const swimlane = this.state.kanbanSwimlane;

    if (swimlane === 'sprint' || swimlane === 'priority') {
      // Swimlanes Layout
      let swimlaneGroups = [];
      if (swimlane === 'sprint') {
        swimlaneGroups = sprints.map(s => ({
          id: s.id,
          title: s.name,
          color: '#3B82F6',
          tasks: filteredTasks.filter(t => t.sprint_id === s.id)
        }));
        const unassigned = filteredTasks.filter(t => !t.sprint_id);
        if (unassigned.length > 0) {
          swimlaneGroups.push({ id: null, title: 'Backlog / Unassigned Phase', color: '#64748B', tasks: unassigned });
        }
      } else {
        const priorities = [
          { id: 'urgent', title: 'Urgent Priority', color: '#EF4444' },
          { id: 'high', title: 'High Priority', color: '#F97316' },
          { id: 'medium', title: 'Medium Priority', color: '#F59E0B' },
          { id: 'low', title: 'Low Priority', color: '#10B981' }
        ];
        swimlaneGroups = priorities.map(p => ({
          id: p.id,
          title: p.title,
          color: p.color,
          tasks: filteredTasks.filter(t => (t.priority || 'medium') === p.id)
        })).filter(g => g.tasks.length > 0);
      }

      boardContainer.innerHTML = swimlaneGroups.map(sg => {
        const sgDone = sg.tasks.filter(t => t.status === 'done').length;
        const sgTotal = sg.tasks.length;
        const sgEst = sg.tasks.reduce((sum, t) => sum + (parseFloat(t.estimated_hours) || 0), 0);

        const colsHtml = columnsMeta.map(col => {
          const colTasks = sg.tasks.filter(t => (t.status || 'todo') === col.id);
          const colCards = colTasks.map(t => this.renderTaskCardHTML(t, members, sprints, todayStr)).join('');

          return `
            <div class="bg-slate-100/70 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-200/80 dark:border-slate-700/60 flex flex-col min-w-[240px]">
              <div class="flex items-center justify-between mb-2 pb-1.5 border-b border-slate-200/60 dark:border-slate-700/60">
                <div class="flex items-center space-x-1.5">
                  <span class="w-2 h-2 rounded-full ${col.color}"></span>
                  <span class="font-bold text-[11px] uppercase tracking-wider text-slate-600 dark:text-slate-300">${col.title}</span>
                </div>
                <span class="text-[10px] font-bold text-slate-500 bg-white dark:bg-slate-700 px-1.5 py-0.2 rounded-full border border-slate-200 dark:border-slate-600">
                  ${colTasks.length}
                </span>
              </div>
              <div id="col-swim-${sg.id || 'none'}-${col.id}" data-status="${col.id}" data-swimlane="${sg.id || ''}" class="kanban-col-body space-y-2.5 flex-1 min-h-[140px]">
                ${colCards || '<div class="h-20 border border-dashed border-slate-200 dark:border-slate-700/60 rounded-lg flex items-center justify-center text-slate-400 text-[11px]">Drop here</div>'}
              </div>
            </div>
          `;
        }).join('');

        return `
          <div class="bg-white dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-700/80 p-4 space-y-3 shadow-xs mb-4">
            <div class="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-700/60">
              <div class="flex items-center space-x-2.5">
                <div class="w-3 h-3 rounded-full" style="background-color: ${sg.color};"></div>
                <h3 class="font-extrabold text-xs text-slate-900 dark:text-white uppercase tracking-wider">${this.escapeHtml(sg.title)}</h3>
                <span class="text-[11px] font-semibold text-slate-500">(${sgTotal} activities • ${sgEst.toFixed(1)}h)</span>
              </div>
              <div class="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                ${sgDone}/${sgTotal} Completed (${sgTotal > 0 ? Math.round((sgDone / sgTotal) * 100) : 0}%)
              </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 items-start overflow-x-auto pb-1">
              ${colsHtml}
            </div>
          </div>
        `;
      }).join('');

    } else {
      // Standard 5 Columns Layout
      const colsHtml = columnsMeta.map(col => {
        const colTasks = filteredTasks.filter(t => (t.status || 'todo') === col.id);
        const colHours = colTasks.reduce((sum, t) => sum + (parseFloat(t.estimated_hours) || 0), 0);
        const colCards = colTasks.map(t => this.renderTaskCardHTML(t, members, sprints, todayStr)).join('');

        return `
          <div class="bg-slate-100/90 dark:bg-slate-800/80 rounded-xl p-3.5 border border-slate-200 dark:border-slate-700/70 shadow-xs flex flex-col min-w-[260px]">
            
            <!-- Column Header -->
            <div class="flex items-center justify-between mb-3 px-1">
              <div class="flex items-center space-x-2">
                <span class="w-2.5 h-2.5 rounded-full ${col.color} shadow-xs"></span>
                <h3 class="font-extrabold text-xs uppercase tracking-wider text-slate-800 dark:text-slate-200">${col.title}</h3>
                <span class="text-[11px] font-bold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 px-2 py-0.5 rounded-full border border-slate-200 dark:border-slate-600 shadow-2xs">
                  ${colTasks.length}
                </span>
              </div>
              
              <div class="flex items-center space-x-1">
                <span class="text-[10px] font-mono text-slate-400 font-semibold mr-1">${colHours.toFixed(0)}h</span>
                <button onclick="app.openTaskModal({status: '${col.id}'})" title="Add task to ${col.title}" class="p-1 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-white dark:hover:bg-slate-700 transition">
                  <i data-lucide="plus" class="w-3.5 h-3.5"></i>
                </button>
              </div>
            </div>

            <!-- Column Body / Drop Zone -->
            <div id="col-${col.id}" data-status="${col.id}" class="kanban-col-body space-y-2.5 flex-1 min-h-[350px]">
              ${colCards || `
                <div class="h-32 border-2 border-dashed border-slate-200 dark:border-slate-700/60 rounded-xl flex flex-col items-center justify-center text-slate-400 text-xs">
                  <i data-lucide="inbox" class="w-5 h-5 mb-1 opacity-50"></i>
                  <span>No activities</span>
                </div>
              `}
            </div>

          </div>
        `;
      }).join('');

      boardContainer.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-start overflow-x-auto pb-2">
          ${colsHtml}
        </div>
      `;
    }

    // 5. Initialize SortableJS on all columns
    const containers = boardContainer.querySelectorAll('.kanban-col-body');
    containers.forEach(container => {
      const sortable = new Sortable(container, {
        group: 'kanban-tasks',
        animation: 200,
        ghostClass: 'sortable-ghost',
        chosenClass: 'sortable-chosen',
        dragClass: 'sortable-drag',
        dataIdAttr: 'data-task-id',
        onEnd: async (evt) => {
          const taskId = Number(evt.item.getAttribute('data-task-id'));
          const newStatus = evt.to.getAttribute('data-status');
          
          const taskItems = Array.from(evt.to.querySelectorAll('[data-task-id]'));
          const reorderPayload = taskItems.map((el, index) => ({
            task_id: Number(el.getAttribute('data-task-id')),
            status: newStatus,
            new_order_index: index
          }));

          try {
            await this.api('/api/tasks/reorder', {
              method: 'POST',
              body: JSON.stringify(reorderPayload)
            });
            const taskObj = this.state.tasks.find(t => t.id === taskId);
            if (taskObj) taskObj.status = newStatus;
            this.showToast(`Moved to ${newStatus.replace('_', ' ')}`, 'success');
            this.renderKanban();
          } catch (err) {
            this.fetchTasks();
          }
        }
      });
      this.state.sortableInstances.push(sortable);
    });

    this.initLucide();
  },

  renderTaskCardHTML(task, members, sprints, todayStr) {
    if (!todayStr) todayStr = new Date().toISOString().split('T')[0];
    if (!members) members = this.state.currentProject?.members || [];
    if (!sprints) sprints = this.state.currentProject?.sprints || [];

    const isDone = task.status === 'done';
    const isOverdue = !isDone && task.due_date && task.due_date < todayStr;
    const assigned = members.find(m => m.id === task.assignee_id);
    const sprint = sprints.find(s => s.id === task.sprint_id);

    // Left Border Strip Accent Color
    const borderLeftColor = {
      urgent: 'border-l-4 border-l-rose-500',
      high: 'border-l-4 border-l-orange-500',
      medium: 'border-l-4 border-l-amber-500',
      low: 'border-l-4 border-l-emerald-500'
    }[task.priority] || 'border-l-4 border-l-amber-500';

    const priorityBadge = {
      urgent: '<span class="px-1.5 py-0.2 rounded text-[10px] font-extrabold uppercase bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 flex items-center gap-0.5"><i data-lucide="flame" class="w-3 h-3"></i> Urgent</span>',
      high: '<span class="px-1.5 py-0.2 rounded text-[10px] font-extrabold uppercase bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300 flex items-center gap-0.5"><i data-lucide="alert-circle" class="w-3 h-3"></i> High</span>',
      medium: '<span class="px-1.5 py-0.2 rounded text-[10px] font-bold uppercase bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">Medium</span>',
      low: '<span class="px-1.5 py-0.2 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">Low</span>'
    }[task.priority] || '<span class="px-1.5 py-0.2 rounded text-[10px] font-bold uppercase bg-slate-100 text-slate-600">Medium</span>';

    const subtaskTotal = task.subtask_count || 0;
    const subtaskDone = task.subtask_completed_count || 0;
    const subtaskPercent = subtaskTotal > 0 ? Math.round((subtaskDone / subtaskTotal) * 100) : 0;

    const tagsHtml = (task.tags || []).slice(0, 2).map(tag => `
      <span class="px-1.5 py-0.2 rounded text-[10px] bg-slate-100 dark:bg-slate-700/80 text-slate-600 dark:text-slate-300 font-medium">#${this.escapeHtml(tag)}</span>
    `).join('');

    const estH = parseFloat(task.estimated_hours) || 0;
    const actH = parseFloat(task.actual_hours) || 0;

    return `
      <div data-task-id="${task.id}" onclick="app.openTaskModal({id: ${task.id}})"
        class="task-card bg-white dark:bg-slate-800 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs cursor-pointer select-none space-y-2.5 transition-all duration-200 hover:shadow-md hover:scale-[1.01] ${borderLeftColor} group">
        
        <!-- Card Header: Checkbox + Phase Tag + Priority -->
        <div class="flex items-center justify-between gap-1.5">
          <div class="flex items-center space-x-2 min-w-0">
            <button onclick="event.stopPropagation(); app.quickToggleTaskDone(${task.id}, '${task.status}')"
              class="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition ${isDone ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300 dark:border-slate-600 hover:border-blue-500'}"
              title="${isDone ? 'Mark as In Progress' : 'Mark as Done'}">
              ${isDone ? '<i data-lucide="check" class="w-3 h-3"></i>' : ''}
            </button>
            
            ${sprint ? `
              <span class="text-[10px] font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-1.5 py-0.2 rounded border border-blue-200/60 dark:border-blue-800/60 truncate max-w-[120px]" title="${this.escapeHtml(sprint.name)}">
                ${this.escapeHtml(sprint.name)}
              </span>
            ` : '<span class="text-[10px] font-mono text-slate-400 font-bold">#' + task.id + '</span>'}
          </div>

          <div class="flex-shrink-0">
            ${priorityBadge}
          </div>
        </div>

        <!-- Task Title -->
        <h4 class="text-xs font-bold text-slate-800 dark:text-white leading-snug line-clamp-2 ${isDone ? 'line-through text-slate-400 dark:text-slate-500' : ''}">
          ${this.escapeHtml(task.title)}
        </h4>

        ${tagsHtml ? `<div class="flex flex-wrap gap-1">${tagsHtml}</div>` : ''}

        <!-- Subtasks Progress (if any) -->
        ${subtaskTotal > 0 ? `
          <div class="space-y-1">
            <div class="flex justify-between text-[10px] text-slate-400 font-medium">
              <span class="flex items-center gap-1"><i data-lucide="check-square" class="w-3 h-3"></i> Subtasks</span>
              <span>${subtaskDone}/${subtaskTotal} (${subtaskPercent}%)</span>
            </div>
            <div class="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
              <div class="h-full bg-blue-500 rounded-full transition-all duration-300" style="width: ${subtaskPercent}%"></div>
            </div>
          </div>
        ` : ''}

        <!-- Card Footer: Assignee, Dates & Hours -->
        <div class="pt-2 border-t border-slate-100 dark:border-slate-700/60 flex items-center justify-between text-[11px] text-slate-500">
          
          <!-- Assignee -->
          <div class="flex items-center space-x-1.5 min-w-0">
            ${assigned ? `
              <div class="w-5 h-5 rounded-full text-[9px] font-bold text-white flex items-center justify-center shadow-2xs flex-shrink-0" style="background-color: ${assigned.avatar_color || '#3B82F6'};" title="${this.escapeHtml(assigned.name)} (${this.escapeHtml(assigned.role || '')})">
                ${assigned.name.charAt(0).toUpperCase()}
              </div>
              <span class="text-[10px] font-semibold text-slate-700 dark:text-slate-300 truncate max-w-[80px]">${this.escapeHtml(assigned.name.split(' ')[0])}</span>
            ` : `
              <span class="text-[10px] text-slate-400">Unassigned</span>
            `}
          </div>

          <!-- Timeline / Due Date -->
          <div class="flex items-center space-x-1 text-[10px]">
            ${task.due_date ? `
              <span class="flex items-center space-x-1 ${isOverdue ? 'px-1.5 py-0.2 rounded bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 font-bold' : 'text-slate-400'}">
                <i data-lucide="calendar" class="w-3 h-3"></i>
                <span>${task.start_date ? task.start_date.slice(5) + ' → ' : ''}${task.due_date.slice(5)}</span>
              </span>
            ` : (task.start_date ? `
              <span class="flex items-center space-x-1 text-slate-400">
                <i data-lucide="calendar" class="w-3 h-3"></i>
                <span>Start: ${task.start_date.slice(5)}</span>
              </span>
            ` : `
              <span class="text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.2 rounded border border-dashed border-amber-300 dark:border-amber-700/80 flex items-center gap-1">
                <i data-lucide="calendar-off" class="w-2.5 h-2.5"></i>
                <span>Not Declared</span>
              </span>
            `)}
          </div>

          <!-- Hours Logged -->
          <div class="text-[10px] font-mono text-slate-500 font-medium">
            ${estH}h
          </div>

        </div>

        <!-- Quick Advance Bar on Hover -->
        <div class="hidden group-hover:flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-700/40 text-[10px] text-slate-400">
          <button onclick="event.stopPropagation(); app.advanceTaskStatus(${task.id})" class="text-blue-600 dark:text-blue-400 font-bold hover:underline flex items-center space-x-0.5">
            <span>Advance</span>
            <i data-lucide="arrow-right" class="w-3 h-3"></i>
          </button>
          <span class="text-[9px] text-slate-400">Click for details</span>
        </div>

      </div>
    `;
  },

  // ==================== GANTT / TIMELINE MULTI-SCALE RENDERER ====================
  setGanttScale(scale) {
    this.state.ganttScale = scale;
    this.state.ganttOffset = 0;

    document.querySelectorAll('.gantt-scale-btn').forEach(btn => {
      btn.classList.remove('bg-blue-600', 'text-white', 'shadow-xs', 'font-bold');
      btn.classList.add('text-slate-600', 'dark:text-slate-400');
    });
    const activeBtn = document.getElementById(`gantt-scale-${scale}`);
    if (activeBtn) {
      activeBtn.classList.add('bg-blue-600', 'text-white', 'shadow-xs', 'font-bold');
      activeBtn.classList.remove('text-slate-600', 'dark:text-slate-400');
    }

    this.renderGantt();
  },

  shiftGanttTimeline(direction) {
    this.state.ganttOffset += direction;
    this.renderGantt();
  },

  resetGanttToToday() {
    this.state.ganttOffset = 0;
    this.renderGantt();
  },

  renderGantt() {
    const container = document.getElementById('gantt-timeline-render');
    const tasksCount = document.getElementById('gantt-tasks-count');
    const rangeLabel = document.getElementById('gantt-timeline-range-label');
    if (tasksCount) tasksCount.textContent = `${this.state.tasks.length} tasks`;
    if (!container) return;

    if (this.state.tasks.length === 0) {
      container.innerHTML = `
        <div class="p-12 text-center text-slate-400 text-xs space-y-3">
          <i data-lucide="calendar-x" class="w-8 h-8 mx-auto text-slate-300"></i>
          <div>No tasks scheduled yet for this project.</div>
          <button onclick="app.openGanttUploadModal()" class="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-4 py-2 rounded-lg text-xs">
            + Upload Gantt Excel File
          </button>
        </div>
      `;
      this.initLucide();
      return;
    }

    const scale = this.state.ganttScale || 'week';
    const offset = this.state.ganttOffset || 0;
    const now = new Date();

    // 1. Calculate base bounds from project tasks
    let taskMin = new Date(now.getTime() - (7 * 86400000));
    let taskMax = new Date(now.getTime() + (30 * 86400000));
    let hasExplicitDates = false;

    this.state.tasks.forEach(t => {
      if (t.start_date) {
        const s = new Date(t.start_date + 'T00:00:00');
        if (!hasExplicitDates || s < taskMin) taskMin = s;
        hasExplicitDates = true;
      }
      if (t.due_date) {
        const d = new Date(t.due_date + 'T23:59:59');
        if (!hasExplicitDates || d > taskMax) taskMax = d;
        hasExplicitDates = true;
      }
    });

    let timelineMin, timelineMax;
    let topHeaders = [];
    let bottomHeaders = [];
    let totalCols = 0;

    // 2. Build timescale columns based on mode
    if (scale === 'day') {
      // DAILY SCALE
      const baseStart = new Date(taskMin.getTime() + (offset * 7 * 86400000));
      timelineMin = new Date(baseStart.getFullYear(), baseStart.getMonth(), baseStart.getDate());
      const daysCount = Math.max(Math.ceil((taskMax - taskMin) / 86400000) + 4, 18);
      totalCols = daysCount;
      timelineMax = new Date(timelineMin.getTime() + (daysCount * 86400000));

      if (rangeLabel) {
        rangeLabel.textContent = `Daily View • ${timelineMin.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} to ${timelineMax.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      }

      // Group days by month for top header
      let curMonth = -1;
      let curMonthSpan = 0;
      let curMonthName = '';

      for (let i = 0; i < daysCount; i++) {
        const d = new Date(timelineMin.getTime() + (i * 86400000));
        const isToday = d.toDateString() === now.toDateString();
        const isWeekend = d.getDay() === 0 || d.getDay() === 6;

        bottomHeaders.push(`
          <div class="flex-1 min-w-[36px] text-center border-r border-slate-100 dark:border-slate-700/60 py-1.5 ${isToday ? 'bg-blue-100/70 dark:bg-blue-900/50 font-bold text-blue-600 dark:text-blue-400' : (isWeekend ? 'bg-slate-50/60 dark:bg-slate-900/40 text-slate-400' : 'text-slate-600 dark:text-slate-300')}">
            <div class="text-[9px] uppercase font-semibold">${d.toLocaleDateString('en-US', { weekday: 'narrow' })}</div>
            <div class="text-[11px]">${d.getDate()}</div>
          </div>
        `);

        if (d.getMonth() !== curMonth) {
          if (curMonth !== -1) {
            topHeaders.push(`<div class="border-r border-slate-200 dark:border-slate-700 text-center text-xs font-bold text-slate-700 dark:text-slate-200 py-1 bg-slate-50 dark:bg-slate-800/90" style="flex: ${curMonthSpan}">${curMonthName}</div>`);
          }
          curMonth = d.getMonth();
          curMonthName = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
          curMonthSpan = 1;
        } else {
          curMonthSpan++;
        }
      }
      if (curMonthSpan > 0) {
        topHeaders.push(`<div class="border-r border-slate-200 dark:border-slate-700 text-center text-xs font-bold text-slate-700 dark:text-slate-200 py-1 bg-slate-50 dark:bg-slate-800/90" style="flex: ${curMonthSpan}">${curMonthName}</div>`);
      }

    } else if (scale === 'week') {
      // WEEKLY SCALE (Default)
      const dayOfWeek = taskMin.getDay();
      const mondayOffset = (dayOfWeek + 6) % 7; // align to Monday
      const startMonday = new Date(taskMin.getFullYear(), taskMin.getMonth(), taskMin.getDate() - mondayOffset + (offset * 28));
      timelineMin = startMonday;
      
      const weeksCount = Math.max(Math.ceil((taskMax - taskMin) / (7 * 86400000)) + 2, 8);
      totalCols = weeksCount;
      timelineMax = new Date(timelineMin.getTime() + (weeksCount * 7 * 86400000));

      if (rangeLabel) {
        rangeLabel.textContent = `Weekly View • ${timelineMin.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} to ${timelineMax.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
      }

      let curMonth = -1;
      let curMonthSpan = 0;
      let curMonthName = '';

      for (let w = 0; w < weeksCount; w++) {
        const wStart = new Date(timelineMin.getTime() + (w * 7 * 86400000));
        const wEnd = new Date(wStart.getTime() + (5 * 86400000)); // Sat
        const isCurrentWeek = now >= wStart && now <= new Date(wStart.getTime() + (7 * 86400000));

        // Get ISO week number
        const tempD = new Date(Date.UTC(wStart.getFullYear(), wStart.getMonth(), wStart.getDate()));
        const dayNum = tempD.getUTCDay() || 7;
        tempD.setUTCDate(tempD.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(tempD.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((tempD - yearStart) / 86400000) + 1) / 7);

        bottomHeaders.push(`
          <div class="flex-1 min-w-[90px] text-center border-r border-slate-100 dark:border-slate-700/60 py-1.5 ${isCurrentWeek ? 'bg-blue-50/80 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-bold' : 'text-slate-600 dark:text-slate-300'}">
            <div class="text-[10px] font-bold">W${weekNo}</div>
            <div class="text-[9px] text-slate-400">${wStart.getDate()} ${wStart.toLocaleDateString('en-US', { month: 'short' })} - ${wEnd.getDate()} ${wEnd.toLocaleDateString('en-US', { month: 'short' })}</div>
          </div>
        `);

        if (wStart.getMonth() !== curMonth) {
          if (curMonth !== -1) {
            topHeaders.push(`<div class="border-r border-slate-200 dark:border-slate-700 text-center text-xs font-bold text-slate-700 dark:text-slate-200 py-1 bg-slate-50 dark:bg-slate-800/90" style="flex: ${curMonthSpan}">${curMonthName}</div>`);
          }
          curMonth = wStart.getMonth();
          curMonthName = wStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
          curMonthSpan = 1;
        } else {
          curMonthSpan++;
        }
      }
      if (curMonthSpan > 0) {
        topHeaders.push(`<div class="border-r border-slate-200 dark:border-slate-700 text-center text-xs font-bold text-slate-700 dark:text-slate-200 py-1 bg-slate-50 dark:bg-slate-800/90" style="flex: ${curMonthSpan}">${curMonthName}</div>`);
      }

    } else if (scale === 'month') {
      // MONTHLY SCALE
      const baseMonth = new Date(taskMin.getFullYear(), taskMin.getMonth() + (offset * 3), 1);
      timelineMin = baseMonth;
      
      const totalMonths = Math.max(
        ((taskMax.getFullYear() - taskMin.getFullYear()) * 12) + (taskMax.getMonth() - taskMin.getMonth()) + 3,
        6
      );
      totalCols = totalMonths;
      timelineMax = new Date(timelineMin.getFullYear(), timelineMin.getMonth() + totalMonths, 0, 23, 59, 59);

      if (rangeLabel) {
        rangeLabel.textContent = `Monthly View • ${timelineMin.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })} to ${timelineMax.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
      }

      let curYear = -1;
      let curYearSpan = 0;

      for (let m = 0; m < totalMonths; m++) {
        const mDate = new Date(timelineMin.getFullYear(), timelineMin.getMonth() + m, 1);
        const isCurrentMonth = now.getFullYear() === mDate.getFullYear() && now.getMonth() === mDate.getMonth();

        bottomHeaders.push(`
          <div class="flex-1 min-w-[110px] text-center border-r border-slate-100 dark:border-slate-700/60 py-2 ${isCurrentMonth ? 'bg-blue-50/80 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-bold' : 'text-slate-700 dark:text-slate-300 font-semibold'}">
            <div class="text-xs">${mDate.toLocaleDateString('en-US', { month: 'short' })}</div>
            <div class="text-[9px] text-slate-400 font-normal">Month ${mDate.getMonth() + 1}</div>
          </div>
        `);

        if (mDate.getFullYear() !== curYear) {
          if (curYear !== -1) {
            topHeaders.push(`<div class="border-r border-slate-200 dark:border-slate-700 text-center text-xs font-bold text-slate-700 dark:text-slate-200 py-1 bg-slate-50 dark:bg-slate-800/90" style="flex: ${curYearSpan}">${curYear}</div>`);
          }
          curYear = mDate.getFullYear();
          curYearSpan = 1;
        } else {
          curYearSpan++;
        }
      }
      if (curYearSpan > 0) {
        topHeaders.push(`<div class="border-r border-slate-200 dark:border-slate-700 text-center text-xs font-bold text-slate-700 dark:text-slate-200 py-1 bg-slate-50 dark:bg-slate-800/90" style="flex: ${curYearSpan}">${curYear}</div>`);
      }

    } else if (scale === 'year') {
      // YEARLY / MULTI-YEAR SCALE (Quarters)
      const startYear = taskMin.getFullYear() + offset;
      const endYear = Math.max(taskMax.getFullYear() + 1, startYear + 2);
      timelineMin = new Date(startYear, 0, 1);
      timelineMax = new Date(endYear, 11, 31, 23, 59, 59);
      const totalYears = endYear - startYear + 1;

      if (rangeLabel) {
        rangeLabel.textContent = `Yearly Roadmap • ${startYear} to ${endYear}`;
      }

      for (let y = startYear; y <= endYear; y++) {
        topHeaders.push(`<div class="border-r border-slate-200 dark:border-slate-700 text-center text-xs font-bold text-slate-700 dark:text-slate-200 py-1 bg-slate-50 dark:bg-slate-800/90" style="flex: 4">${y}</div>`);
        
        for (let q = 1; q <= 4; q++) {
          const qStart = new Date(y, (q - 1) * 3, 1);
          const isCurQuarter = now >= qStart && now < new Date(y, q * 3, 1);

          bottomHeaders.push(`
            <div class="flex-1 min-w-[90px] text-center border-r border-slate-100 dark:border-slate-700/60 py-2 ${isCurQuarter ? 'bg-blue-50/80 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-bold' : 'text-slate-700 dark:text-slate-300 font-semibold'}">
              <div class="text-xs">Q${q}</div>
              <div class="text-[9px] text-slate-400 font-normal">${qStart.toLocaleDateString('en-US', { month: 'short' })}</div>
            </div>
          `);
        }
      }
    }

    const totalSpanMs = Math.max(timelineMax - timelineMin, 86400000);

    // 3. Render Task Rows (strictly sorted by sequential process order)
    const sortedTasks = [...(this.state.tasks || [])].sort((a, b) => {
      const orderA = a.order_index !== undefined && a.order_index !== null ? Number(a.order_index) : a.id;
      const orderB = b.order_index !== undefined && b.order_index !== null ? Number(b.order_index) : b.id;
      if (orderA !== orderB) return orderA - orderB;
      return a.id - b.id;
    });

    const rowsHtml = sortedTasks.map((t, idx) => {
      const taskStart = t.start_date ? new Date(t.start_date + 'T00:00:00') : new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const taskDue = t.due_date ? new Date(t.due_date + 'T23:59:59') : new Date(taskStart.getTime() + 86400000);

      const startOffsetMs = Math.max(0, taskStart - timelineMin);
      const durationMs = Math.max(86400000, taskDue - taskStart);

      const leftPct = Math.min(100, Math.max(0, (startOffsetMs / totalSpanMs) * 100));
      const widthPct = Math.max(1.5, Math.min(100 - leftPct, (durationMs / totalSpanMs) * 100));

      const isCompleted = t.status === 'done';
      const isUrgent = t.priority === 'urgent';
      
      const barColor = isCompleted ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20' :
        (t.status === 'in_progress' ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-500/20' :
        (isUrgent ? 'bg-rose-500 hover:bg-rose-600 shadow-rose-500/20' :
        (t.status === 'in_review' ? 'bg-purple-500 hover:bg-purple-600 shadow-purple-500/20' : 'bg-slate-400 hover:bg-slate-500')));

      const progressWidth = isCompleted ? 100 : (t.status === 'in_progress' ? 60 : 0);

      return `
        <div class="flex items-center border-b border-slate-100 dark:border-slate-700/60 hover:bg-slate-50/70 dark:hover:bg-slate-700/30 transition py-1.5 group">
          
          <!-- Left Task Info & Direct Editable Date Column -->
          <div class="w-[430px] flex-shrink-0 pr-3 pl-3 flex items-center justify-between space-x-2">
            
            <!-- Title & Assignee info -->
            <div class="flex-1 min-w-0 cursor-pointer" onclick="app.openTaskModal({id: ${t.id}})" title="Click to view/edit full task details">
              <div class="text-xs font-bold text-slate-800 dark:text-white truncate flex items-center space-x-1.5">
                <span class="text-[10px] text-slate-400 font-mono flex-shrink-0">#${idx + 1}</span>
                ${t.assignee_name ? `<span class="w-4 h-4 rounded-full text-[9px] font-bold text-white flex items-center justify-center flex-shrink-0" style="background-color: ${t.assignee_avatar || '#6366F1'}">${t.assignee_name.charAt(0)}</span>` : ''}
                <span class="truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition font-semibold">${this.escapeHtml(t.title)}</span>
              </div>
              <div class="text-[10px] text-slate-400 flex items-center space-x-1.5 mt-0.5">
                <span class="capitalize px-1.5 py-0.2 rounded text-[9px] font-semibold ${isCompleted ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}">${t.status.replace('_', ' ')}</span>
                <span>•</span>
                <span class="truncate max-w-[85px]">${t.assignee_name ? this.escapeHtml(t.assignee_name.split(' ')[0]) : 'Unassigned'}</span>
              </div>
            </div>

            <!-- Direct Start & End Date Pickers in Gantt Row -->
            <div class="flex items-center space-x-1.5 flex-shrink-0">
              ${t.start_date ? `
                <div class="inline-flex items-center space-x-0.5">
                  <input type="date" value="${t.start_date}"
                    onchange="app.inlineUpdateGanttTask(${t.id}, 'start_date', this.value)"
                    title="Edit Start Date"
                    class="w-[100px] text-[10px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded px-1.5 py-0.5 border border-slate-200 dark:border-slate-700 focus:border-blue-500 focus:outline-none">
                  <button onclick="app.inlineUpdateGanttTask(${t.id}, 'start_date', '')" class="p-0.5 text-slate-400 hover:text-rose-500" title="Set as Not Declared">
                    <i data-lucide="x" class="w-2.5 h-2.5"></i>
                  </button>
                </div>
              ` : `
                <div class="relative group/gstart inline-flex items-center">
                  <div class="text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded border border-dashed border-amber-300 dark:border-amber-700 flex items-center space-x-1 cursor-pointer hover:bg-amber-100 transition">
                    <i data-lucide="calendar-off" class="w-2.5 h-2.5"></i>
                    <span>Not Declared</span>
                  </div>
                  <input type="date" value="" onchange="app.inlineUpdateGanttTask(${t.id}, 'start_date', this.value)" title="Click to set start date" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full">
                </div>
              `}

              <span class="text-[10px] text-slate-400 font-bold">→</span>

              ${t.due_date ? `
                <div class="inline-flex items-center space-x-0.5">
                  <input type="date" value="${t.due_date}"
                    onchange="app.inlineUpdateGanttTask(${t.id}, 'due_date', this.value)"
                    title="Edit End / Due Date"
                    class="w-[100px] text-[10px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded px-1.5 py-0.5 border border-slate-200 dark:border-slate-700 focus:border-blue-500 focus:outline-none">
                  <button onclick="app.inlineUpdateGanttTask(${t.id}, 'due_date', '')" class="p-0.5 text-slate-400 hover:text-rose-500" title="Set as Not Declared">
                    <i data-lucide="x" class="w-2.5 h-2.5"></i>
                  </button>
                </div>
              ` : `
                <div class="relative group/gdue inline-flex items-center">
                  <div class="text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded border border-dashed border-amber-300 dark:border-amber-700 flex items-center space-x-1 cursor-pointer hover:bg-amber-100 transition">
                    <i data-lucide="calendar-off" class="w-2.5 h-2.5"></i>
                    <span>Not Declared</span>
                  </div>
                  <input type="date" value="" onchange="app.inlineUpdateGanttTask(${t.id}, 'due_date', this.value)" title="Click to set end date" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full">
                </div>
              `}
            </div>

          </div>

          <!-- Right Timeline Bar Area -->
          <div class="flex-1 relative h-8 bg-slate-50/50 dark:bg-slate-900/30 rounded-lg flex items-center px-1">
            ${(!t.start_date && !t.due_date) ? `
              <div class="h-6 px-3 rounded-lg border border-dashed border-amber-300 dark:border-amber-700 bg-amber-50/80 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-[10px] font-bold flex items-center space-x-1.5 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/50 transition shadow-2xs"
                onclick="app.openTaskModal({id: ${t.id}})"
                title="Schedule is Not Declared. Click to declare start & end dates.">
                <i data-lucide="help-circle" class="w-3 h-3 text-amber-500"></i>
                <span>Schedule Not Declared (TBD)</span>
              </div>
            ` : `
              <div class="gantt-bar absolute h-5.5 rounded-lg text-[10px] font-bold text-white flex items-center px-2.5 shadow-sm cursor-pointer truncate transition-all duration-150 ${barColor}"
                style="left: ${leftPct}%; width: ${Math.max(widthPct, 2.5)}%;"
                onclick="app.openTaskModal({id: ${t.id}})"
                title="${this.escapeHtml(t.title)}&#10;Owner: ${this.escapeHtml(t.assignee_name || 'Unassigned')}&#10;Timeline: ${t.start_date || 'Not Declared'} to ${t.due_date || 'Not Declared'}&#10;Status: ${t.status}&#10;Est: ${t.estimated_hours}h&#10;Click to open task details">
                
                <!-- Progress Fill -->
                <div class="absolute inset-0 bg-white/20 rounded-lg pointer-events-none" style="width: ${progressWidth}%"></div>
                
                <span class="relative z-10 truncate font-semibold">${this.escapeHtml(t.title)}</span>
                ${t.subtask_count > 0 ? `<span class="relative z-10 ml-1.5 text-[9px] bg-black/20 px-1 rounded">${t.subtask_completed_count}/${t.subtask_count}</span>` : ''}
              </div>
            `}
          </div>
        </div>
      `;
    }).join('');

    // 4. Render Project Milestones Pins if available
    const milestones = this.state.currentProject?.milestones || [];
    let milestoneRowHtml = '';
    if (milestones.length > 0) {
      milestoneRowHtml = `
        <div class="flex items-center border-t-2 border-slate-200 dark:border-slate-700 bg-amber-50/30 dark:bg-amber-950/20 py-2">
          <div class="w-[430px] flex-shrink-0 pr-4 pl-3 text-xs font-bold text-amber-700 dark:text-amber-400 flex items-center space-x-1.5">
            <i data-lucide="flag" class="w-4 h-4 text-amber-500"></i>
            <span>Project Milestones</span>
          </div>
          <div class="flex-1 relative h-6">
            ${milestones.map(m => {
              if (!m.due_date) return '';
              const mDate = new Date(m.due_date + 'T12:00:00');
              const mOffset = Math.max(0, mDate - timelineMin);
              const mLeft = Math.min(99, Math.max(0, (mOffset / totalSpanMs) * 100));
              return `
                <div class="absolute -top-1 transform -translate-x-1/2 flex items-center space-x-1 cursor-pointer bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded shadow-xs"
                  style="left: ${mLeft}%;"
                  title="Milestone: ${this.escapeHtml(m.title)} (Target: ${m.due_date})">
                  <i data-lucide="flag" class="w-2.5 h-2.5"></i>
                  <span class="truncate max-w-[100px]">${this.escapeHtml(m.title)}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="min-w-[1050px]">
        <!-- Sticky Two-Tier Header -->
        <div class="sticky top-0 z-20 shadow-xs">
          <!-- Top Tier Header (Months/Years) -->
          <div class="flex items-center border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
            <div class="w-[430px] flex-shrink-0 py-1.5 px-3 text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider flex justify-between items-center bg-slate-100 dark:bg-slate-800">
              <span>Process Activities</span>
              <span class="text-[10px] text-slate-500 dark:text-slate-400 font-semibold lowercase">start & end dates</span>
            </div>
            <div class="flex-1 flex">${topHeaders.join('')}</div>
          </div>
          <!-- Bottom Tier Header (Days/Weeks/Months/Quarters) -->
          <div class="flex items-center border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/95">
            <div class="w-[430px] flex-shrink-0 py-1 px-3 text-[10px] text-slate-500 dark:text-slate-400 font-semibold uppercase flex justify-between items-center bg-slate-50 dark:bg-slate-800/95">
              <span>Activity / Owner</span>
              <span class="font-mono">Start Date → End Date</span>
            </div>
            <div class="flex-1 flex">${bottomHeaders.join('')}</div>
          </div>
        </div>

        <!-- Task Rows -->
        <div class="divide-y divide-slate-100 dark:divide-slate-700/40">${rowsHtml}</div>
        <!-- Milestone Row -->
        ${milestoneRowHtml}
      </div>
    `;

    this.initLucide();
  },

  async inlineUpdateGanttTask(taskId, field, value) {
    try {
      const payload = { [field]: value || null };
      const updated = await this.api(`/api/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      
      const t = this.state.tasks.find(x => x.id === taskId);
      if (t) {
        Object.assign(t, updated);
      }
      
      this.showToast(`Updated ${field.replace('_', ' ')}`, 'success');
      this.renderGantt();
    } catch (e) {
      console.error(e);
      this.fetchTasks();
    }
  },

  // ==================== TABLE GRID RENDERER (SEQUENTIAL PROCESS VIEW) ====================
  setTableSortBy(val) {
    this.state.tableSortBy = val || 'order';
    const select = document.getElementById('table-sort-by');
    if (select) select.value = this.state.tableSortBy;
    this.renderTable();
  },

  handleTableFilter(val) {
    this.state.tableFilterQuery = (val || '').toLowerCase().trim();
    this.renderTable();
  },

  renderTable() {
    const tbody = document.getElementById('tasks-table-body');
    if (!tbody) return;

    if (!this.state.tableSortBy) this.state.tableSortBy = 'order';

    const allTasks = this.state.tasks || [];
    const members = this.state.currentProject?.members || [];
    const todayStr = new Date().toISOString().split('T')[0];

    // 1. Calculate KPI Metrics
    const totalCount = allTasks.length;
    const doneCount = allTasks.filter(t => t.status === 'done').length;
    const donePercent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
    const totalEstHours = allTasks.reduce((acc, t) => acc + (parseFloat(t.estimated_hours) || 0), 0);
    const totalActHours = allTasks.reduce((acc, t) => acc + (parseFloat(t.actual_hours) || 0), 0);
    const inProgressCount = allTasks.filter(t => t.status === 'in_progress').length;
    const pendingCount = allTasks.filter(t => t.status === 'todo' || t.status === 'in_review' || t.status === 'backlog').length;
    const criticalCount = allTasks.filter(t => t.priority === 'urgent' || t.priority === 'high').length;
    const overdueCount = allTasks.filter(t => t.status !== 'done' && t.due_date && t.due_date < todayStr).length;

    // Update KPI Elements
    const statComp = document.getElementById('table-stat-completed');
    const statPct = document.getElementById('table-stat-percent');
    const statHrs = document.getElementById('table-stat-hours');
    const statInProg = document.getElementById('table-stat-inprogress');
    const statTodo = document.getElementById('table-stat-todo');
    const statCrit = document.getElementById('table-stat-critical');
    const statOver = document.getElementById('table-stat-overdue');

    if (statComp) statComp.textContent = `${doneCount} / ${totalCount}`;
    if (statPct) statPct.textContent = `${donePercent}% Completed`;
    if (statHrs) statHrs.textContent = `${totalEstHours.toFixed(1)}h est / ${totalActHours.toFixed(1)}h act`;
    if (statInProg) statInProg.textContent = `${inProgressCount} In Progress`;
    if (statTodo) statTodo.textContent = `${pendingCount} Pending / Review`;
    if (statCrit) statCrit.textContent = `${criticalCount} High / Urgent`;
    if (statOver) statOver.textContent = `${overdueCount} Overdue`;

    // 2. Filter Tasks
    const q = this.state.tableFilterQuery || '';
    let filtered = allTasks.filter(t => {
      if (!q) return true;
      const titleMatch = (t.title || '').toLowerCase().includes(q);
      const descMatch = (t.description || '').toLowerCase().includes(q);
      const tagsMatch = (t.tags || []).some(tag => tag.toLowerCase().includes(q));
      const assignee = members.find(m => m.id === t.assignee_id);
      const assigneeMatch = assignee && assignee.name.toLowerCase().includes(q);
      return titleMatch || descMatch || tagsMatch || assigneeMatch;
    });

    // 3. Sort Tasks according to Sequence or user choice
    const priorityWeight = { urgent: 4, high: 3, medium: 2, low: 1 };
    filtered.sort((a, b) => {
      switch (this.state.tableSortBy) {
        case 'date_asc':
          return (a.start_date || '9999').localeCompare(b.start_date || '9999');
        case 'due_asc':
          return (a.due_date || '9999').localeCompare(b.due_date || '9999');
        case 'priority':
          return (priorityWeight[b.priority] || 0) - (priorityWeight[a.priority] || 0);
        case 'hours_desc':
          return (b.estimated_hours || 0) - (a.estimated_hours || 0);
        case 'title_asc':
          return (a.title || '').localeCompare(b.title || '');
        case 'order':
        default:
          const orderA = a.order_index !== undefined && a.order_index !== null ? Number(a.order_index) : a.id;
          const orderB = b.order_index !== undefined && b.order_index !== null ? Number(b.order_index) : b.id;
          if (orderA !== orderB) return orderA - orderB;
          return a.id - b.id;
      }
    });

    // 4. Empty State
    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" class="px-6 py-12 text-center text-slate-400 dark:text-slate-500">
            <i data-lucide="search-x" class="w-10 h-10 mx-auto mb-2 opacity-40"></i>
            <div class="text-sm font-semibold text-slate-600 dark:text-slate-400">No activities match the search filter</div>
            <div class="text-xs text-slate-400 mt-1">Try resetting or clearing your search term</div>
          </td>
        </tr>
      `;
      this.initLucide();
      return;
    }

    // 5. Render Sequential Activity Rows
    let html = '';
    filtered.forEach((t, idx) => {
      const isDone = t.status === 'done';
      const isOverdue = !isDone && t.due_date && t.due_date < todayStr;
      const assignedMember = members.find(m => m.id === t.assignee_id);
      const estH = parseFloat(t.estimated_hours) || 0;
      const actH = parseFloat(t.actual_hours) || 0;

      // Status Badges & Colors
      const statusConfig = {
        done: { label: 'Done', color: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60', dot: 'bg-emerald-500' },
        in_progress: { label: 'In Progress', color: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60', dot: 'bg-amber-500' },
        in_review: { label: 'In Review', color: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800/60', dot: 'bg-purple-500' },
        todo: { label: 'To Do', color: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/60', dot: 'bg-blue-500' },
        backlog: { label: 'Backlog', color: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700', dot: 'bg-slate-400' }
      }[t.status] || { label: t.status, color: 'bg-slate-100 text-slate-700 border-slate-200', dot: 'bg-slate-400' };

      // Priority Badges
      const priorityConfig = {
        urgent: { label: 'Urgent', color: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60', icon: 'flame' },
        high: { label: 'High', color: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800/60', icon: 'alert-circle' },
        medium: { label: 'Medium', color: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60', icon: 'minus' },
        low: { label: 'Low', color: 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-800/60 dark:text-slate-400 dark:border-slate-700', icon: 'arrow-down' }
      }[t.priority] || { label: 'Medium', color: 'bg-amber-50 text-amber-700 border-amber-200', icon: 'minus' };

      const tagsHtml = (t.tags || []).slice(0, 2).map(tag => `
        <span class="px-1.5 py-0.2 rounded text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium border border-slate-200/80 dark:border-slate-700">#${this.escapeHtml(tag)}</span>
      `).join('');

      html += `
        <tr class="hover:bg-blue-50/40 dark:hover:bg-slate-800/60 transition group border-b border-slate-100 dark:border-slate-800/80">
          
          <!-- 1. Activity Name & Sequence -->
          <td class="px-3.5 py-2.5">
            <div class="flex items-center space-x-2.5">
              <button onclick="app.inlineUpdateTask(${t.id}, 'status', '${isDone ? 'in_progress' : 'done'}')"
                class="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition ${isDone ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300 dark:border-slate-600 hover:border-blue-500'}"
                title="${isDone ? 'Mark as in progress' : 'Mark as completed'}">
                ${isDone ? '<i data-lucide="check" class="w-3 h-3"></i>' : ''}
              </button>
              <span class="text-[10px] font-mono text-slate-400 dark:text-slate-500 font-bold flex-shrink-0">#${(idx + 1).toString().padStart(2, '0')}</span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center space-x-1.5">
                  <span onclick="app.openTaskModal({id: ${t.id}})"
                    class="font-semibold text-xs text-slate-800 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer truncate transition ${isDone ? 'line-through text-slate-400 dark:text-slate-500' : ''}">
                    ${this.escapeHtml(t.title)}
                  </span>
                  ${tagsHtml}
                </div>
              </div>
            </div>
          </td>

          <!-- 2. Status Dropdown -->
          <td class="px-3.5 py-2.5">
            <div class="relative inline-block w-full max-w-[120px]">
              <select onchange="app.inlineUpdateTask(${t.id}, 'status', this.value)"
                class="w-full text-xs font-semibold px-2 py-1 rounded-lg border appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500 ${statusConfig.color}">
                <option value="backlog" ${t.status === 'backlog' ? 'selected' : ''}>Backlog</option>
                <option value="todo" ${t.status === 'todo' ? 'selected' : ''}>To Do</option>
                <option value="in_progress" ${t.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
                <option value="in_review" ${t.status === 'in_review' ? 'selected' : ''}>In Review</option>
                <option value="done" ${t.status === 'done' ? 'selected' : ''}>Done</option>
              </select>
            </div>
          </td>

          <!-- 3. Priority Dropdown -->
          <td class="px-3.5 py-2.5">
            <div class="relative inline-block w-full max-w-[110px]">
              <select onchange="app.inlineUpdateTask(${t.id}, 'priority', this.value)"
                class="w-full text-xs font-semibold px-2 py-1 rounded-lg border appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500 ${priorityConfig.color}">
                <option value="low" ${t.priority === 'low' ? 'selected' : ''}>Low</option>
                <option value="medium" ${t.priority === 'medium' ? 'selected' : ''}>Medium</option>
                <option value="high" ${t.priority === 'high' ? 'selected' : ''}>High</option>
                <option value="urgent" ${t.priority === 'urgent' ? 'selected' : ''}>Urgent</option>
              </select>
            </div>
          </td>

          <!-- 4. Assignee / Role -->
          <td class="px-3.5 py-2.5">
            <div class="relative inline-block w-full max-w-[170px]">
              <select onchange="app.inlineUpdateTask(${t.id}, 'assignee_id', this.value ? Number(this.value) : null)"
                class="w-full text-xs bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium truncate">
                <option value="">Unassigned</option>
                ${members.map(m => `<option value="${m.id}" ${t.assignee_id === m.id ? 'selected' : ''}>${this.escapeHtml(m.name)} (${this.escapeHtml(m.role || 'Member')})</option>`).join('')}
              </select>
            </div>
          </td>

          <!-- 5. Start Date -->
          <td class="px-3.5 py-2.5">
            ${t.start_date ? `
              <div class="inline-flex items-center space-x-1 max-w-[130px]">
                <input type="date" value="${t.start_date}"
                  onchange="app.inlineUpdateTask(${t.id}, 'start_date', this.value)"
                  class="w-full bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs rounded-lg px-2 py-1 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono">
                <button onclick="app.inlineUpdateTask(${t.id}, 'start_date', '')" class="p-1 rounded text-slate-400 hover:text-rose-500 transition" title="Clear / Mark as Not Declared">
                  <i data-lucide="x" class="w-3 h-3"></i>
                </button>
              </div>
            ` : `
              <div class="relative group/date inline-flex items-center">
                <div class="inline-flex items-center space-x-1.5 px-2 py-1 rounded-lg border border-dashed border-amber-300 dark:border-amber-700/80 bg-amber-50/70 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-[11px] font-semibold cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/40 transition">
                  <i data-lucide="calendar-off" class="w-3 h-3 text-amber-500"></i>
                  <span>Not Declared</span>
                </div>
                <input type="date" value="" onchange="app.inlineUpdateTask(${t.id}, 'start_date', this.value)" title="Click to declare start date" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full">
              </div>
            `}
          </td>

          <!-- 6. Due Date -->
          <td class="px-3.5 py-2.5">
            ${t.due_date ? `
              <div class="inline-flex items-center space-x-1 max-w-[130px]">
                <input type="date" value="${t.due_date}"
                  onchange="app.inlineUpdateTask(${t.id}, 'due_date', this.value)"
                  class="w-full text-xs rounded-lg px-2 py-1 border focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono ${isOverdue ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-300 dark:border-rose-800 font-bold' : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'}">
                <button onclick="app.inlineUpdateTask(${t.id}, 'due_date', '')" class="p-1 rounded text-slate-400 hover:text-rose-500 transition" title="Clear / Mark as Not Declared">
                  <i data-lucide="x" class="w-3 h-3"></i>
                </button>
              </div>
            ` : `
              <div class="relative group/date inline-flex items-center">
                <div class="inline-flex items-center space-x-1.5 px-2 py-1 rounded-lg border border-dashed border-amber-300 dark:border-amber-700/80 bg-amber-50/70 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 text-[11px] font-semibold cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/40 transition">
                  <i data-lucide="calendar-off" class="w-3 h-3 text-amber-500"></i>
                  <span>Not Declared</span>
                </div>
                <input type="date" value="" onchange="app.inlineUpdateTask(${t.id}, 'due_date', this.value)" title="Click to declare due date" class="absolute inset-0 opacity-0 cursor-pointer w-full h-full">
              </div>
            `}
          </td>

          <!-- 7. Hours (Est & Act) -->
          <td class="px-3.5 py-2.5">
            <div class="flex items-center space-x-1">
              <input type="number" step="0.5" min="0" value="${estH}"
                onchange="app.inlineUpdateTask(${t.id}, 'estimated_hours', parseFloat(this.value) || 0)"
                title="Estimated Hours"
                class="w-12 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs rounded-lg px-1.5 py-1 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-center">
              <span class="text-slate-400">/</span>
              <input type="number" step="0.5" min="0" value="${actH}"
                onchange="app.inlineUpdateTask(${t.id}, 'actual_hours', parseFloat(this.value) || 0)"
                title="Actual Logged Hours"
                class="w-12 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-xs rounded-lg px-1.5 py-1 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono text-center">
            </div>
          </td>

          <!-- 8. Actions -->
          <td class="px-3.5 py-2.5 text-right whitespace-nowrap">
            <div class="flex items-center justify-end space-x-1">
              <button onclick="app.openTaskModal({id: ${t.id}})" class="p-1 rounded-md text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition" title="Open Full Details">
                <i data-lucide="maximize-2" class="w-3.5 h-3.5"></i>
              </button>
              <button onclick="app.inlineDeleteTask(${t.id})" class="p-1 rounded-md text-slate-400 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-700 transition" title="Delete Activity">
                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
              </button>
            </div>
          </td>

        </tr>
      `;
    });

    tbody.innerHTML = html;

    // Update Footer Summary
    const footer = document.getElementById('table-summary-footer');
    if (footer) {
      footer.textContent = `Showing ${filtered.length} of ${totalCount} activities in sequential process order`;
    }

    this.initLucide();
  },

  async inlineUpdateTask(taskId, field, value) {
    try {
      const payload = { [field]: value };
      const updated = await this.api(`/api/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      
      const t = this.state.tasks.find(x => x.id === taskId);
      if (t) {
        Object.assign(t, updated);
      }
      
      this.showToast(`Updated ${field.replace('_', ' ')}`, 'success');
      this.renderTable();
    } catch (e) {
      console.error(e);
      this.fetchTasks();
    }
  },

  async inlineDeleteTask(taskId) {
    if (!confirm('Are you sure you want to delete this activity?')) return;
    try {
      await this.api(`/api/tasks/${taskId}`, { method: 'DELETE' });
      this.state.tasks = this.state.tasks.filter(t => t.id !== taskId);
      this.renderCurrentView();
      this.showToast('Activity deleted', 'success');
    } catch (e) {
      console.error(e);
    }
  },

  // ==================== CALENDAR RENDERER (MULTI-MODE, RICH TIMELINE & DAY INSPECTOR) ====================
  setCalendarMode(mode) {
    this.state.calendarMode = mode || 'month';
    const modes = ['month', 'week', 'agenda'];
    modes.forEach(m => {
      const btn = document.getElementById(`cal-mode-${m}`);
      if (btn) {
        if (m === this.state.calendarMode) {
          btn.className = 'px-2.5 py-1 rounded-lg transition bg-blue-600 text-white font-bold shadow-xs';
        } else {
          btn.className = 'px-2.5 py-1 rounded-lg transition text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white';
        }
      }
    });
    this.renderCalendar();
  },

  setCalendarFilter(filter) {
    this.state.calendarFilter = filter || 'all';
    this.renderCalendar();
  },

  prevCalendarPeriod() {
    if (!this.state.calendarDate) this.state.calendarDate = new Date();
    const mode = this.state.calendarMode || 'month';
    if (mode === 'week') {
      this.state.calendarDate.setDate(this.state.calendarDate.getDate() - 7);
    } else {
      this.state.calendarDate.setMonth(this.state.calendarDate.getMonth() - 1);
    }
    this.renderCalendar();
  },

  nextCalendarPeriod() {
    if (!this.state.calendarDate) this.state.calendarDate = new Date();
    const mode = this.state.calendarMode || 'month';
    if (mode === 'week') {
      this.state.calendarDate.setDate(this.state.calendarDate.getDate() + 7);
    } else {
      this.state.calendarDate.setMonth(this.state.calendarDate.getMonth() + 1);
    }
    this.renderCalendar();
  },

  todayCalendarPeriod() {
    this.state.calendarDate = new Date();
    this.renderCalendar();
  },

  selectCalendarDay(dateStr) {
    this.state.calendarSelectedDay = dateStr;
    this.renderCalendar();
  },

  closeCalendarDayInspector() {
    this.state.calendarSelectedDay = null;
    const inspector = document.getElementById('calendar-day-inspector');
    if (inspector) inspector.classList.add('hidden');
    this.renderCalendar();
  },

  renderCalendar() {
    const container = document.getElementById('calendar-grid-render');
    const monthYear = document.getElementById('calendar-month-year');
    const headerBadge = document.getElementById('calendar-header-badge');
    if (!container) return;

    if (!this.state.calendarDate) this.state.calendarDate = new Date();
    if (!this.state.calendarMode) this.state.calendarMode = 'month';
    if (!this.state.calendarFilter) this.state.calendarFilter = 'all';

    const cur = this.state.calendarDate;
    const year = cur.getFullYear();
    const month = cur.getMonth();
    const allTasks = this.state.tasks || [];
    const members = this.state.currentProject?.members || [];
    const sprints = this.state.currentProject?.sprints || [];
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    // Filter tasks by calendarFilter
    const filter = this.state.calendarFilter;
    const tasks = allTasks.filter(t => {
      if (filter === 'in_progress') return t.status === 'in_progress';
      if (filter === 'todo') return t.status === 'todo' || t.status === 'backlog';
      if (filter === 'done') return t.status === 'done';
      if (filter === 'urgent') return t.priority === 'urgent' || t.priority === 'high';
      return true;
    });

    // 1. Calculate KPI Metrics for the Active Month
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const monthTasks = allTasks.filter(t => {
      const startInMonth = t.start_date && t.start_date.startsWith(monthPrefix);
      const dueInMonth = t.due_date && t.due_date.startsWith(monthPrefix);
      return startInMonth || dueInMonth;
    });

    const mTotal = monthTasks.length;
    const mDone = monthTasks.filter(t => t.status === 'done').length;
    const mPct = mTotal > 0 ? Math.round((mDone / mTotal) * 100) : 0;
    const mInProg = monthTasks.filter(t => t.status === 'in_progress').length;
    const mPending = monthTasks.filter(t => t.status === 'todo' || t.status === 'in_review' || t.status === 'backlog').length;
    const mOverdue = monthTasks.filter(t => t.status !== 'done' && t.due_date && t.due_date < todayStr).length;
    const mCritical = monthTasks.filter(t => t.priority === 'urgent' || t.priority === 'high').length;

    // Update KPI Elements
    const statTotal = document.getElementById('calendar-stat-total');
    const statMonthName = document.getElementById('calendar-stat-month-name');
    const statDone = document.getElementById('calendar-stat-done');
    const statPct = document.getElementById('calendar-stat-percent');
    const statInProg = document.getElementById('calendar-stat-inprogress');
    const statPending = document.getElementById('calendar-stat-pending');
    const statOverdue = document.getElementById('calendar-stat-overdue');
    const statCrit = document.getElementById('calendar-stat-critical');

    const monthNameStr = cur.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (monthYear) monthYear.innerHTML = `<span>${monthNameStr}</span>`;
    if (headerBadge) headerBadge.textContent = `${mTotal} activities scheduled in ${cur.toLocaleDateString('en-US', { month: 'short' })}`;
    if (statTotal) statTotal.textContent = `${mTotal} Activities`;
    if (statMonthName) statMonthName.textContent = monthNameStr;
    if (statDone) statDone.textContent = `${mDone} / ${mTotal}`;
    if (statPct) statPct.textContent = `${mPct}% Completed`;
    if (statInProg) statInProg.textContent = `${mInProg} In Progress`;
    if (statPending) statPending.textContent = `${mPending} Pending Deadlines`;
    if (statOverdue) statOverdue.textContent = `${mOverdue} Overdue`;
    if (statCrit) statCrit.textContent = `${mCritical} High / Urgent`;

    // 2. Delegate by mode
    if (this.state.calendarMode === 'week') {
      this.renderCalendarWeek(container, tasks, members, sprints);
    } else if (this.state.calendarMode === 'agenda') {
      this.renderCalendarAgenda(container, tasks, members, sprints);
    } else {
      this.renderCalendarMonth(container, tasks, members, sprints);
    }

    // 3. Render Day Inspector if day is selected
    this.renderCalendarDayInspector(members, sprints);
    this.initLucide();
  },

  renderCalendarMonth(container, tasks, members, sprints) {
    const cur = this.state.calendarDate;
    const year = cur.getFullYear();
    const month = cur.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    const weekdays = [
      { name: 'Sun', isWeekend: true },
      { name: 'Mon', isWeekend: false },
      { name: 'Tue', isWeekend: false },
      { name: 'Wed', isWeekend: false },
      { name: 'Thu', isWeekend: false },
      { name: 'Fri', isWeekend: false },
      { name: 'Sat', isWeekend: true }
    ];

    const headerHtml = weekdays.map(w => `
      <div class="text-center font-extrabold text-[11px] uppercase tracking-wider ${w.isWeekend ? 'text-rose-500/80 dark:text-rose-400/80 bg-rose-50/30 dark:bg-rose-950/10' : 'text-slate-500 dark:text-slate-400 bg-slate-100/60 dark:bg-slate-800/60'} py-2.5 border-b border-slate-200 dark:border-slate-700">
        ${w.name}
      </div>
    `).join('');

    let cellsHtml = [];
    // Leading blank days
    for (let i = 0; i < firstDay; i++) {
      cellsHtml.push(`<div class="min-h-[110px] bg-slate-50/40 dark:bg-slate-900/20 p-2 border border-slate-100/80 dark:border-slate-800/60 opacity-40"></div>`);
    }

    // Days in Month
    for (let day = 1; day <= daysInMonth; day++) {
      const dayStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
      const isSelected = this.state.calendarSelectedDay === dayStr;
      const dayOfWeek = (firstDay + day - 1) % 7;
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      // Find tasks active on this day (either starts, due, or spans this day)
      const dayTasks = tasks.filter(t => {
        if (t.due_date === dayStr) return true;
        if (t.start_date === dayStr) return true;
        if (t.start_date && t.due_date && dayStr >= t.start_date && dayStr <= t.due_date) return true;
        return false;
      });

      const maxPills = 3;
      const visibleTasks = dayTasks.slice(0, maxPills);
      const remaining = dayTasks.length - maxPills;

      const taskChips = visibleTasks.map(t => {
        const isDone = t.status === 'done';
        const isDue = t.due_date === dayStr;
        const isStart = t.start_date === dayStr;
        const isOverdue = !isDone && t.due_date && t.due_date < todayStr;
        const assigned = members.find(m => m.id === t.assignee_id);

        let chipStyle = 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800/60';
        let dotColor = 'bg-blue-500';

        if (isDone) {
          chipStyle = 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60';
          dotColor = 'bg-emerald-500';
        } else if (isOverdue) {
          chipStyle = 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800/60 font-bold';
          dotColor = 'bg-rose-500';
        } else if (t.status === 'in_progress') {
          chipStyle = 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60';
          dotColor = 'bg-amber-500';
        }

        return `
          <div onclick="event.stopPropagation(); app.openTaskModal({id: ${t.id}})"
            class="px-2 py-1 rounded-md text-[11px] font-semibold border flex items-center justify-between space-x-1.5 cursor-pointer shadow-2xs hover:scale-[1.02] hover:shadow-xs transition ${chipStyle}"
            title="${this.escapeHtml(t.title)} | ${isDue ? 'Due Today' : (isStart ? 'Starts Today' : 'In Progress')}">
            <div class="flex items-center space-x-1.5 min-w-0 flex-1">
              <span class="w-1.5 h-1.5 rounded-full ${dotColor} flex-shrink-0"></span>
              <span class="truncate ${isDone ? 'line-through opacity-70' : ''}">${this.escapeHtml(t.title)}</span>
            </div>
            ${assigned ? `
              <div class="w-4 h-4 rounded-full text-[9px] font-bold text-white flex items-center justify-center flex-shrink-0" style="background-color: ${assigned.avatar_color || '#3B82F6'};">
                ${assigned.name.charAt(0).toUpperCase()}
              </div>
            ` : ''}
          </div>
        `;
      }).join('');

      cellsHtml.push(`
        <div onclick="app.selectCalendarDay('${dayStr}')"
          class="min-h-[110px] p-2 border border-slate-100 dark:border-slate-800 transition flex flex-col justify-between cursor-pointer group hover:bg-blue-50/30 dark:hover:bg-slate-800/70 ${isSelected ? 'ring-2 ring-blue-500 bg-blue-50/40 dark:bg-blue-950/40' : (isToday ? 'bg-blue-50/20 dark:bg-blue-950/20' : (isWeekend ? 'bg-slate-50/50 dark:bg-slate-900/30' : 'bg-white dark:bg-slate-800/90'))}">
          
          <!-- Day Header -->
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-1">
              <span class="text-xs font-extrabold ${isToday ? 'w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center shadow-xs' : (isWeekend ? 'text-rose-500 dark:text-rose-400' : 'text-slate-700 dark:text-slate-200')}">
                ${day}
              </span>
              ${isToday ? '<span class="text-[10px] font-bold text-blue-600 dark:text-blue-400 ml-1">Today</span>' : ''}
            </div>

            <div class="flex items-center space-x-1">
              ${dayTasks.length > 0 ? `
                <span class="px-1.5 py-0.2 rounded-full text-[10px] font-bold ${dayTasks.some(t => !t.status === 'done' && t.due_date < todayStr) ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}">
                  ${dayTasks.length}
                </span>
              ` : ''}
              <button onclick="event.stopPropagation(); app.openTaskModal({start_date: '${dayStr}', due_date: '${dayStr}'})"
                class="opacity-0 group-hover:opacity-100 p-0.5 rounded text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
                title="Add task on ${dayStr}">
                <i data-lucide="plus" class="w-3 h-3"></i>
              </button>
            </div>
          </div>

          <!-- Day Task Pills List -->
          <div class="space-y-1 mt-1.5 flex-1 overflow-hidden">
            ${taskChips}
            ${remaining > 0 ? `
              <div class="text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:underline px-1 pt-0.5">
                +${remaining} more activity
              </div>
            ` : ''}
          </div>

        </div>
      `);
    }

    container.innerHTML = `
      <div class="grid grid-cols-7 gap-px bg-slate-200 dark:bg-slate-700 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm">
        ${headerHtml}
        ${cellsHtml.join('')}
      </div>
    `;
  },

  renderCalendarWeek(container, tasks, members, sprints) {
    const cur = this.state.calendarDate || new Date();
    // Compute current week start (Sunday)
    const d = new Date(cur);
    const dayOfWeek = d.getDay();
    d.setDate(d.getDate() - dayOfWeek);

    const weekDays = [];
    for (let i = 0; i < 7; i++) {
      const wDate = new Date(d);
      wDate.setDate(wDate.getDate() + i);
      weekDays.push(wDate);
    }

    const todayStr = new Date().toISOString().split('T')[0];

    const columnsHtml = weekDays.map(wDate => {
      const dayStr = wDate.toISOString().split('T')[0];
      const isToday = dayStr === todayStr;
      const isSelected = this.state.calendarSelectedDay === dayStr;
      const dayTasks = tasks.filter(t => {
        if (t.due_date === dayStr) return true;
        if (t.start_date === dayStr) return true;
        if (t.start_date && t.due_date && dayStr >= t.start_date && dayStr <= t.due_date) return true;
        return false;
      });

      const cardsHtml = dayTasks.map(t => {
        const isDone = t.status === 'done';
        const assigned = members.find(m => m.id === t.assignee_id);
        const sprint = sprints.find(s => s.id === t.sprint_id);

        return `
          <div onclick="app.openTaskModal({id: ${t.id}})"
            class="bg-white dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs hover:shadow-md hover:border-blue-400 dark:hover:border-blue-500 transition cursor-pointer space-y-2">
            
            <div class="flex items-start justify-between">
              <span class="text-[10px] font-mono text-slate-400 font-bold">#${t.id}</span>
              <span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${isDone ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'} capitalize">
                ${t.status.replace('_', ' ')}
              </span>
            </div>

            <h4 class="font-bold text-xs text-slate-800 dark:text-white ${isDone ? 'line-through text-slate-400' : ''}">
              ${this.escapeHtml(t.title)}
            </h4>

            ${sprint ? `
              <div class="text-[10px] font-semibold text-blue-600 dark:text-blue-400 flex items-center space-x-1">
                <i data-lucide="zap" class="w-3 h-3"></i>
                <span class="truncate">${this.escapeHtml(sprint.name)}</span>
              </div>
            ` : ''}

            <div class="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-700/60 text-[11px] text-slate-500">
              <span>${t.estimated_hours || 0}h est</span>
              ${assigned ? `
                <div class="flex items-center space-x-1">
                  <div class="w-4 h-4 rounded-full text-[9px] font-bold text-white flex items-center justify-center" style="background-color: ${assigned.avatar_color || '#3B82F6'};">
                    ${assigned.name.charAt(0).toUpperCase()}
                  </div>
                  <span class="text-[10px] font-medium truncate max-w-[60px]">${this.escapeHtml(assigned.name.split(' ')[0])}</span>
                </div>
              ` : '<span class="text-slate-400 text-[10px]">Unassigned</span>'}
            </div>

          </div>
        `;
      }).join('');

      return `
        <div onclick="app.selectCalendarDay('${dayStr}')"
          class="flex-1 min-w-[160px] rounded-xl border border-slate-200 dark:border-slate-700 p-3 transition flex flex-col ${isSelected ? 'ring-2 ring-blue-500 bg-blue-50/30 dark:bg-blue-950/20' : (isToday ? 'bg-blue-50/20 dark:bg-blue-950/20' : 'bg-slate-50/60 dark:bg-slate-850/60')}">
          
          <div class="text-center pb-2.5 border-b border-slate-200 dark:border-slate-700 mb-3">
            <div class="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              ${wDate.toLocaleDateString('en-US', { weekday: 'short' })}
            </div>
            <div class="text-base font-extrabold mt-0.5 ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-slate-800 dark:text-white'}">
              ${wDate.getDate()}
            </div>
            <span class="text-[10px] font-semibold text-slate-500">${dayTasks.length} activities</span>
          </div>

          <div class="space-y-2.5 flex-1 overflow-y-auto max-h-[480px]">
            ${cardsHtml || '<div class="text-center text-slate-400 text-xs py-8 opacity-60">No activities</div>'}
          </div>

        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="flex space-x-3 overflow-x-auto pb-2">
        ${columnsHtml}
      </div>
    `;
  },

  renderCalendarAgenda(container, tasks, members, sprints) {
    const cur = this.state.calendarDate || new Date();
    const year = cur.getFullYear();
    const month = cur.getMonth();
    const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
    const todayStr = new Date().toISOString().split('T')[0];

    // Filter tasks active in this month and sort by due date / start date
    const monthTasks = tasks.filter(t => {
      return (t.due_date && t.due_date.startsWith(monthPrefix)) || (t.start_date && t.start_date.startsWith(monthPrefix));
    }).sort((a, b) => (a.due_date || a.start_date || '9999') > (b.due_date || b.start_date || '9999') ? 1 : -1);

    if (monthTasks.length === 0) {
      container.innerHTML = `
        <div class="p-12 text-center text-slate-400 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
          <i data-lucide="calendar-x" class="w-10 h-10 mx-auto mb-2 opacity-40"></i>
          <div class="font-bold text-sm text-slate-700 dark:text-slate-300">No deliverables scheduled for this month</div>
          <div class="text-xs text-slate-400 mt-1">Use the "+ Add Activity" button to schedule deliverables.</div>
        </div>
      `;
      return;
    }

    // Group by Date
    const dateGroups = {};
    monthTasks.forEach(t => {
      const dKey = t.due_date || t.start_date || 'No Date';
      if (!dateGroups[dKey]) dateGroups[dKey] = [];
      dateGroups[dKey].push(t);
    });

    const agendaHtml = Object.keys(dateGroups).map(dKey => {
      const isPast = dKey !== 'No Date' && dKey < todayStr;
      const isToday = dKey === todayStr;
      const dObj = dKey !== 'No Date' ? new Date(dKey + 'T00:00:00') : null;
      const dFormatted = dObj ? dObj.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }) : 'Unscheduled';

      const taskCards = dateGroups[dKey].map(t => {
        const isDone = t.status === 'done';
        const assigned = members.find(m => m.id === t.assignee_id);
        const sprint = sprints.find(s => s.id === t.sprint_id);

        return `
          <div class="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs hover:border-blue-400 dark:hover:border-blue-500 transition flex items-center justify-between gap-4">
            
            <div class="flex items-center space-x-3.5 flex-1 min-w-0">
              <button onclick="app.inlineUpdateTask(${t.id}, 'status', '${isDone ? 'in_progress' : 'done'}')"
                class="w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 transition ${isDone ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300 dark:border-slate-600 hover:border-blue-500'}">
                ${isDone ? '<i data-lucide="check" class="w-3.5 h-3.5"></i>' : ''}
              </button>

              <div class="min-w-0 flex-1">
                <div class="flex items-center space-x-2">
                  <h4 onclick="app.openTaskModal({id: ${t.id}})"
                    class="font-bold text-xs text-slate-800 dark:text-white hover:text-blue-600 cursor-pointer truncate ${isDone ? 'line-through text-slate-400' : ''}">
                    ${this.escapeHtml(t.title)}
                  </h4>
                  ${sprint ? `<span class="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/60">${this.escapeHtml(sprint.name)}</span>` : ''}
                </div>
                <div class="text-[11px] text-slate-400 mt-0.5">
                  Timeline: ${t.start_date || 'N/A'} ? ${t.due_date || 'N/A'} • ${t.estimated_hours || 0}h estimated
                </div>
              </div>
            </div>

            <div class="flex items-center space-x-4 flex-shrink-0">
              ${assigned ? `
                <div class="flex items-center space-x-2">
                  <div class="w-6 h-6 rounded-full text-[10px] font-bold text-white flex items-center justify-center" style="background-color: ${assigned.avatar_color || '#3B82F6'};">
                    ${assigned.name.charAt(0).toUpperCase()}
                  </div>
                  <span class="text-xs font-semibold text-slate-700 dark:text-slate-300">${this.escapeHtml(assigned.name)}</span>
                </div>
              ` : '<span class="text-slate-400 text-xs">Unassigned</span>'}

              <button onclick="app.openTaskModal({id: ${t.id}})" class="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-slate-100 dark:hover:bg-slate-700">
                <i data-lucide="maximize-2" class="w-4 h-4"></i>
              </button>
            </div>

          </div>
        `;
      }).join('');

      return `
        <div class="space-y-2.5">
          <div class="flex items-center space-x-2">
            <span class="w-2.5 h-2.5 rounded-full ${isToday ? 'bg-blue-600' : (isPast ? 'bg-slate-400' : 'bg-emerald-500')}"></span>
            <h3 class="font-extrabold text-xs text-slate-800 dark:text-slate-200">${dFormatted}</h3>
            ${isToday ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">Today</span>' : ''}
          </div>
          <div class="space-y-2 pl-4 border-l-2 border-slate-200 dark:border-slate-700">
            ${taskCards}
          </div>
        </div>
      `;
    }).join('');

    const unscheduledTasks = tasks.filter(t => !t.start_date && !t.due_date);
    let unscheduledHtml = '';
    if (unscheduledTasks.length > 0) {
      const uCards = unscheduledTasks.map(t => {
        const isDone = t.status === 'done';
        const assigned = members.find(m => m.id === t.assignee_id);
        return `
          <div class="bg-amber-50/40 dark:bg-amber-950/20 p-3 rounded-xl border border-dashed border-amber-300 dark:border-amber-700/80 flex items-center justify-between gap-4">
            <div class="flex items-center space-x-3 min-w-0 flex-1">
              <span class="text-[10px] font-mono text-amber-600 font-bold">#${t.id}</span>
              <span class="text-xs font-bold text-slate-800 dark:text-white truncate">${this.escapeHtml(t.title)}</span>
              <span class="text-[9px] font-bold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/40 px-1.5 py-0.5 rounded">Not Declared</span>
            </div>
            <button onclick="app.openTaskModal({id: ${t.id}})" class="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
              <span>Declare Dates</span>
              <i data-lucide="calendar" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        `;
      }).join('');

      unscheduledHtml = `
        <div class="space-y-2.5 pt-4">
          <div class="flex items-center space-x-2">
            <span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
            <h3 class="font-extrabold text-xs text-amber-700 dark:text-amber-300 uppercase tracking-wider">Dates Not Declared / TBD (${unscheduledTasks.length})</h3>
          </div>
          <div class="space-y-2 pl-4 border-l-2 border-dashed border-amber-300 dark:border-amber-700">
            ${uCards}
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="max-w-4xl mx-auto space-y-6 py-2">
        ${agendaHtml}
        ${unscheduledHtml}
      </div>
    `;
  },

  renderCalendarDayInspector(members, sprints) {
    const inspector = document.getElementById('calendar-day-inspector');
    if (!inspector) return;

    const dayStr = this.state.calendarSelectedDay;
    if (!dayStr) {
      inspector.classList.add('hidden');
      return;
    }

    const dObj = new Date(dayStr + 'T00:00:00');
    const dayFormatted = dObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const allTasks = this.state.tasks || [];

    const dayTasks = allTasks.filter(t => {
      if (t.due_date === dayStr) return true;
      if (t.start_date === dayStr) return true;
      if (t.start_date && t.due_date && dayStr >= t.start_date && dayStr <= t.due_date) return true;
      return false;
    });

    const tasksHtml = dayTasks.map(t => {
      const isDone = t.status === 'done';
      const assigned = members.find(m => m.id === t.assignee_id);
      return `
        <div class="flex items-center justify-between p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40">
          <div class="flex items-center space-x-3">
            <button onclick="app.inlineUpdateTask(${t.id}, 'status', '${isDone ? 'in_progress' : 'done'}')"
              class="w-4 h-4 rounded border flex items-center justify-center ${isDone ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300 dark:border-slate-600'}">
              ${isDone ? '<i data-lucide="check" class="w-3 h-3"></i>' : ''}
            </button>
            <div>
              <div onclick="app.openTaskModal({id: ${t.id}})" class="text-xs font-bold text-slate-800 dark:text-white hover:text-blue-600 cursor-pointer ${isDone ? 'line-through text-slate-400' : ''}">
                ${this.escapeHtml(t.title)}
              </div>
              <div class="text-[11px] text-slate-400">
                ${t.start_date || 'N/A'} ? ${t.due_date || 'N/A'} • ${assigned ? assigned.name : 'Unassigned'} • ${t.estimated_hours || 0}h
              </div>
            </div>
          </div>
          <button onclick="app.openTaskModal({id: ${t.id}})" class="text-blue-600 hover:underline text-xs font-semibold">
            Details
          </button>
        </div>
      `;
    }).join('');

    inspector.innerHTML = `
      <div class="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-700">
        <div class="flex items-center space-x-2">
          <i data-lucide="calendar" class="w-4 h-4 text-blue-600"></i>
          <span class="font-extrabold text-sm text-slate-800 dark:text-white">${dayFormatted}</span>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
            ${dayTasks.length} ${dayTasks.length === 1 ? 'activity' : 'activities'}
          </span>
        </div>
        <div class="flex items-center space-x-2">
          <button onclick="app.openTaskModal({start_date: '${dayStr}', due_date: '${dayStr}'})" class="bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 rounded text-xs font-semibold flex items-center space-x-1">
            <i data-lucide="plus" class="w-3 h-3"></i>
            <span>Add on this day</span>
          </button>
          <button onclick="app.closeCalendarDayInspector()" class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1">
            <i data-lucide="x" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
      <div class="space-y-2 mt-3 max-h-60 overflow-y-auto">
        ${tasksHtml || '<div class="text-center text-slate-400 text-xs py-4">No activities scheduled on this day.</div>'}
      </div>
    `;

    inspector.classList.remove('hidden');
  },

  // ==================== SPRINTS & MILESTONES RENDERER ====================
  renderSprints() {
    const sprintContainer = document.getElementById('sprints-list-render');
    const milestoneContainer = document.getElementById('milestones-list-render');
    const sprints = this.state.currentProject?.sprints || [];
    const milestones = this.state.currentProject?.milestones || [];

    if (sprintContainer) {
      if (sprints.length === 0) {
        sprintContainer.innerHTML = `<div class="bg-white dark:bg-slate-800 p-8 rounded-xl border border-slate-200 dark:border-slate-700 text-center text-slate-400 text-xs">No sprints created yet. Click "+ New Sprint" to start planning.</div>`;
      } else {
        sprintContainer.innerHTML = sprints.map(s => {
          const totalTasks = s.total_tasks || 0;
          const doneTasks = s.completed_tasks || 0;
          const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
          const isActive = s.status === 'active';

          return `
            <div class="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 shadow-sm space-y-4">
              <div class="flex items-start justify-between">
                <div>
                  <div class="flex items-center space-x-2">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}">
                      ${s.status}
                    </span>
                    <h3 class="text-sm font-bold text-slate-800 dark:text-white">${this.escapeHtml(s.name)}</h3>
                  </div>
                  ${s.goal ? `<p class="text-xs text-slate-500 mt-1">${this.escapeHtml(s.goal)}</p>` : ''}
                </div>

                <div class="flex items-center space-x-2">
                  <button onclick="app.toggleSprintStatus(${s.id}, '${s.status}')" class="text-xs font-semibold px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700">
                    ${isActive ? 'Complete Sprint' : (s.status === 'completed' ? 'Reopen' : 'Start Sprint')}
                  </button>
                  <button onclick="app.openSprintModal(${JSON.stringify(s).replace(/"/g, '&quot;')})" class="text-slate-400 hover:text-blue-600 p-1">
                    <i data-lucide="edit-2" class="w-4 h-4"></i>
                  </button>
                </div>
              </div>

              <div class="space-y-1.5">
                <div class="flex justify-between text-xs font-medium text-slate-500">
                  <span>${doneTasks} of ${totalTasks} tasks completed</span>
                  <span class="font-bold text-slate-700 dark:text-slate-300">${pct}%</span>
                </div>
                <div class="w-full h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div class="h-full bg-blue-600 rounded-full transition-all duration-300" style="width: ${pct}%"></div>
                </div>
              </div>

              <div class="flex items-center justify-between text-xs text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-700/60">
                <div class="flex items-center space-x-1">
                  <i data-lucide="calendar" class="w-3.5 h-3.5"></i>
                  <span>${s.start_date || 'N/A'} ? ${s.end_date || 'N/A'}</span>
                </div>
                <div class="font-mono">
                  <span>${s.total_actual_hours || 0}h / ${s.total_estimated_hours || 0}h logged</span>
                </div>
              </div>
            </div>
          `;
        }).join('');
      }
    }

    if (milestoneContainer) {
      if (milestones.length === 0) {
        milestoneContainer.innerHTML = `<div class="text-center text-slate-400 text-xs py-4">No milestones created.</div>`;
      } else {
        milestoneContainer.innerHTML = milestones.map(m => `
          <div class="flex items-center justify-between p-3 rounded-lg border border-slate-100 dark:border-slate-700/60 bg-slate-50 dark:bg-slate-900/40">
            <div class="flex items-center space-x-3">
              <input type="checkbox" ${m.status === 'completed' ? 'checked' : ''} onchange="app.toggleMilestoneStatus(${m.id}, this.checked)" class="rounded text-blue-600 w-4 h-4 cursor-pointer">
              <div>
                <h4 class="text-xs font-bold text-slate-800 dark:text-white ${m.status === 'completed' ? 'line-through text-slate-400' : ''}">${this.escapeHtml(m.title)}</h4>
                <span class="text-[10px] text-slate-400">Due: ${m.due_date}</span>
              </div>
            </div>
            <button onclick="app.deleteMilestone(${m.id})" class="text-slate-400 hover:text-rose-500 p-1">
              <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
            </button>
          </div>
        `).join('');
      }
    }
  },

  async toggleSprintStatus(sprintId, currentStatus) {
    const newStatus = currentStatus === 'active' ? 'completed' : (currentStatus === 'completed' ? 'planning' : 'active');
    try {
      await this.api(`/api/projects/${this.state.currentProjectId}/sprints/${sprintId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus })
      });
      await this.selectProject(this.state.currentProjectId);
      this.showToast(`Sprint status updated to ${newStatus}`, 'success');
    } catch (e) {
      console.error(e);
    }
  },

  async toggleMilestoneStatus(milestoneId, isCompleted) {
    try {
      await this.api(`/api/projects/${this.state.currentProjectId}/milestones/${milestoneId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: isCompleted ? 'completed' : 'pending' })
      });
      await this.selectProject(this.state.currentProjectId);
      this.showToast('Milestone status updated', 'success');
    } catch (e) {
      console.error(e);
    }
  },

  async deleteMilestone(milestoneId) {
    if (!confirm('Are you sure you want to delete this milestone?')) return;
    try {
      await this.api(`/api/projects/${this.state.currentProjectId}/milestones/${milestoneId}`, { method: 'DELETE' });
      await this.selectProject(this.state.currentProjectId);
      this.showToast('Milestone deleted', 'success');
    } catch (e) {
      console.error(e);
    }
  },

  // ==================== TIME TRACKER RENDERER ====================
  async renderTimeTracker() {
    if (!this.state.currentProjectId) return;
    try {
      const logs = await this.api(`/api/projects/${this.state.currentProjectId}/timelogs`);
      const tbody = document.getElementById('timelogs-table-body');
      const totalCard = document.getElementById('total-logged-hours-card');
      const summaryText = document.getElementById('est-vs-act-summary');

      let totalHours = 0;
      let totalEst = 0;
      this.state.tasks.forEach(t => {
        totalHours += Number(t.actual_hours || 0);
        totalEst += Number(t.estimated_hours || 0);
      });

      if (totalCard) totalCard.textContent = `${totalHours.toFixed(1)}h`;
      if (summaryText) summaryText.textContent = `${totalHours.toFixed(1)}h recorded / ${totalEst.toFixed(1)}h estimated`;

      if (tbody) {
        if (logs.length === 0) {
          tbody.innerHTML = `<tr><td colspan="6" class="px-4 py-8 text-center text-slate-400">No time logs recorded yet.</td></tr>`;
        } else {
          tbody.innerHTML = logs.map(l => `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/40 transition">
              <td class="px-4 py-3 font-mono text-slate-500">${l.logged_date}</td>
              <td class="px-4 py-3 font-bold text-slate-800 dark:text-white">${this.escapeHtml(l.task_title)}</td>
              <td class="px-4 py-3">${this.escapeHtml(l.member_name || 'Anonymous')}</td>
              <td class="px-4 py-3 font-mono font-bold text-blue-600 dark:text-blue-400">${l.hours}h</td>
              <td class="px-4 py-3 text-slate-500">${this.escapeHtml(l.description || '?')}</td>
              <td class="px-4 py-3 text-right">
                <button onclick="app.deleteTimeLog(${l.id})" class="text-slate-400 hover:text-rose-500 p-1">
                  <i data-lucide="trash-2" class="w-4 h-4"></i>
                </button>
              </td>
            </tr>
          `).join('');
        }
      }
    } catch (e) {
      console.error(e);
    }
  },

  async deleteTimeLog(logId) {
    if (!confirm('Delete this time log entry?')) return;
    try {
      await this.api(`/api/timelogs/${logId}`, { method: 'DELETE' });
      await this.fetchTasks();
      this.showToast('Time log removed', 'success');
    } catch (e) {
      console.error(e);
    }
  },

  // ==================== STOPWATCH TIMER LOGIC ====================
  toggleStopwatch() {
    const sw = this.state.stopwatch;
    const btn = document.getElementById('timer-toggle-btn');
    const mainBtn = document.getElementById('main-stopwatch-btn');
    const dot = document.getElementById('timer-dot');

    if (sw.isRunning) {
      clearInterval(sw.timerId);
      sw.isRunning = false;
      if (btn) btn.textContent = 'Resume';
      if (mainBtn) mainBtn.textContent = 'Resume Stopwatch';
      if (dot) dot.classList.remove('bg-emerald-500', 'pulse-indicator');
      if (dot) dot.classList.add('bg-amber-400');
    } else {
      sw.startTime = Date.now() - sw.elapsedMs;
      sw.isRunning = true;
      if (btn) btn.textContent = 'Pause';
      if (mainBtn) mainBtn.textContent = 'Pause Stopwatch';
      if (dot) dot.classList.remove('bg-slate-400', 'bg-amber-400');
      if (dot) dot.classList.add('bg-emerald-500', 'pulse-indicator');

      sw.timerId = setInterval(() => {
        sw.elapsedMs = Date.now() - sw.startTime;
        this.updateStopwatchDisplay();
      }, 1000);
    }
  },

  updateStopwatchDisplay() {
    const totalSec = Math.floor(this.state.stopwatch.elapsedMs / 1000);
    const hrs = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const mins = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const secs = String(totalSec % 60).padStart(2, '0');
    const formatted = `${hrs}:${mins}:${secs}`;

    const topDisplay = document.getElementById('timer-display');
    const mainDisplay = document.getElementById('main-stopwatch-display');
    if (topDisplay) topDisplay.textContent = formatted;
    if (mainDisplay) mainDisplay.textContent = formatted;
  },

  async saveStopwatchLog() {
    const sw = this.state.stopwatch;
    const hours = Math.max(Number((sw.elapsedMs / 3600000).toFixed(2)), 0.1);
    if (hours <= 0 || sw.elapsedMs < 1000) {
      this.showToast('Please run stopwatch before logging', 'error');
      return;
    }
    if (sw.isRunning) this.toggleStopwatch();
    this.openManualTimeLogModal({ hours });
  },

  // ==================== ANALYTICS DASHBOARD ====================
  async renderAnalytics() {
    if (!this.state.currentProjectId) return;
    try {
      const data = await this.api(`/api/projects/${this.state.currentProjectId}/analytics`);
      const kpis = data.kpis || {};
      
      document.getElementById('kpi-total-tasks').textContent = kpis.total_tasks || 0;
      document.getElementById('kpi-inprogress-tasks').textContent = kpis.in_progress_tasks || 0;
      document.getElementById('kpi-done-tasks').textContent = kpis.done_tasks || 0;
      document.getElementById('kpi-completion-rate').textContent = `${kpis.completion_rate || 0}%`;
      document.getElementById('kpi-overdue-tasks').textContent = kpis.overdue_tasks || 0;
      document.getElementById('kpi-total-hours').textContent = `${(kpis.total_act_hours || 0).toFixed(1)}h`;

      const sprintTitle = document.getElementById('burndown-sprint-title');
      if (sprintTitle) sprintTitle.textContent = kpis.sprint_name || 'Active Sprint';

      this.renderBurndownChart(data.burndown);
      this.renderPriorityChart(data.priority_distribution);
      this.renderWorkloadChart(data.workload);

      const activities = await this.api(`/api/projects/${this.state.currentProjectId}/activity`);
      const actContainer = document.getElementById('activity-stream-render');
      if (actContainer) {
        if (activities.length === 0) {
          actContainer.innerHTML = `<div class="text-slate-400">No activity recorded yet.</div>`;
        } else {
          actContainer.innerHTML = activities.slice(0, 15).map(a => `
            <div class="flex items-start space-x-2.5 pb-2 border-b border-slate-100 dark:border-slate-700/60">
              <div class="w-6 h-6 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300 flex items-center justify-center font-bold text-[10px] flex-shrink-0 mt-0.5">
                ${a.user_name.charAt(0)}
              </div>
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-slate-800 dark:text-white truncate">${this.escapeHtml(a.user_name)}: <span class="font-normal text-slate-500">${this.escapeHtml(a.details || a.action)}</span></div>
                <div class="text-[10px] text-slate-400">${new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            </div>
          `).join('');
        }
      }
    } catch (e) {
      console.error(e);
    }
  },

  renderBurndownChart(burndown) {
    const ctx = document.getElementById('burndownChart');
    if (!ctx) return;
    if (this.state.charts.burndown) this.state.charts.burndown.destroy();

    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? '#334155' : '#e2e8f0';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    const labels = burndown?.labels?.length > 0 ? burndown.labels : ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5'];
    const ideal = burndown?.ideal?.length > 0 ? burndown.ideal : [40, 30, 20, 10, 0];
    const actual = burndown?.actual?.length > 0 ? burndown.actual : [40, 38, 25, 20, 15];

    this.state.charts.burndown = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Ideal Guideline (Hours)',
            data: ideal,
            borderColor: '#94a3b8',
            borderDash: [5, 5],
            borderWidth: 2,
            pointRadius: 0,
            fill: false,
            tension: 0.1
          },
          {
            label: 'Actual Remaining (Hours)',
            data: actual,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.15)',
            borderWidth: 3,
            pointRadius: 4,
            fill: true,
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: textColor, font: { size: 11 } } }
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor } },
          y: { grid: { color: gridColor }, ticks: { color: textColor }, beginAtZero: true }
        }
      }
    });
  },

  renderPriorityChart(priorityCounts = []) {
    const ctx = document.getElementById('priorityChart');
    if (!ctx) return;
    if (this.state.charts.priority) this.state.charts.priority.destroy();

    const counts = { urgent: 0, high: 0, medium: 0, low: 0 };
    priorityCounts.forEach(p => { if (counts[p.priority] !== undefined) counts[p.priority] = p.count; });

    this.state.charts.priority = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Urgent', 'High', 'Medium', 'Low'],
        datasets: [{
          data: [counts.urgent, counts.high, counts.medium, counts.low],
          backgroundColor: ['#ef4444', '#f97316', '#eab308', '#10b981'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } }
        },
        cutout: '70%'
      }
    });
  },

  renderWorkloadChart(workload = []) {
    const ctx = document.getElementById('workloadChart');
    if (!ctx) return;
    if (this.state.charts.workload) this.state.charts.workload.destroy();

    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? '#334155' : '#e2e8f0';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    const names = workload.map(w => w.name.split(' ')[0]);
    const est = workload.map(w => w.total_est_hours || 0);
    const act = workload.map(w => w.total_act_hours || 0);

    this.state.charts.workload = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: names,
        datasets: [
          { label: 'Assigned Est. Hours', data: est, backgroundColor: '#3b82f6', borderRadius: 4 },
          { label: 'Actual Logged Hours', data: act, backgroundColor: '#10b981', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: textColor, font: { size: 11 } } }
        },
        scales: {
          x: { grid: { color: gridColor }, ticks: { color: textColor } },
          y: { grid: { color: gridColor }, ticks: { color: textColor }, beginAtZero: true }
        }
      }
    });
  },

  // ==================== TASK MODAL CRUD ====================
  async openTaskModal(params = {}) {
    const modal = document.getElementById('task-modal');
    if (!modal) return;

    this.populateTaskModalDropdowns();

    const idInput = document.getElementById('task-input-id');
    const titleInput = document.getElementById('task-input-title');
    const descInput = document.getElementById('task-input-description');
    const statusSelect = document.getElementById('task-input-status');
    const prioritySelect = document.getElementById('task-input-priority');
    const sprintSelect = document.getElementById('task-input-sprint');
    const assigneeSelect = document.getElementById('task-input-assignee');
    const startInput = document.getElementById('task-input-startdate');
    const dueInput = document.getElementById('task-input-duedate');
    const estInput = document.getElementById('task-input-esthours');
    const actInput = document.getElementById('task-input-acthours');
    const tagsInput = document.getElementById('task-input-tags');
    const delBtn = document.getElementById('task-delete-btn');
    const footerLogs = document.getElementById('task-details-footer-section');

    document.getElementById('subtasks-container').innerHTML = '';
    document.getElementById('new-subtask-input').value = '';

    if (params.id) {
      document.getElementById('task-modal-title').textContent = 'Edit Task Details';
      document.getElementById('task-modal-type-badge').textContent = 'Task #' + params.id;
      if (delBtn) delBtn.classList.remove('hidden');
      if (footerLogs) footerLogs.classList.remove('hidden');

      try {
        const task = await this.api(`/api/tasks/${params.id}`);
        idInput.value = task.id;
        titleInput.value = task.title || '';
        descInput.value = task.description || '';
        statusSelect.value = task.status || 'todo';
        prioritySelect.value = task.priority || 'medium';
        sprintSelect.value = task.sprint_id || '';
        assigneeSelect.value = task.assignee_id || '';
        startInput.value = task.start_date || '';
        dueInput.value = task.due_date || '';
        estInput.value = task.estimated_hours || 0;
        if (actInput) actInput.value = task.actual_hours || 0;
        tagsInput.value = (task.tags || []).join(', ');

        this.renderSubtaskList(task.subtasks || []);

        const logsBadge = document.getElementById('task-logged-total-badge');
        if (logsBadge) logsBadge.textContent = `Total: ${task.actual_hours || 0}h`;

        const logsList = document.getElementById('task-timelogs-list');
        if (logsList) {
          logsList.innerHTML = (task.timelogs || []).map(tl => `
            <div class="flex justify-between py-1 border-b border-slate-100 dark:border-slate-700/60">
              <span>${tl.logged_date} • ${this.escapeHtml(tl.member_name || 'User')}: ${this.escapeHtml(tl.description || '')}</span>
              <span class="font-mono font-bold text-blue-600">${tl.hours}h</span>
            </div>
          `).join('') || '<div class="text-slate-400">No logs on this task.</div>';
        }

      } catch (e) {
        console.error(e);
      }
    } else {
      document.getElementById('task-modal-title').textContent = 'Create New Task';
      document.getElementById('task-modal-type-badge').textContent = 'New Task';
      if (delBtn) delBtn.classList.add('hidden');
      if (footerLogs) footerLogs.classList.add('hidden');

      idInput.value = '';
      titleInput.value = '';
      descInput.value = '';
      statusSelect.value = params.status || 'todo';
      prioritySelect.value = 'medium';
      sprintSelect.value = params.sprint_id || '';
      assigneeSelect.value = '';
      
      const today = new Date().toISOString().split('T')[0];
      startInput.value = params.start_date || '';
      dueInput.value = params.due_date || '';
      estInput.value = '4.0';
      if (actInput) actInput.value = '0.0';
      tagsInput.value = '';
    }

    this.updateTaskModalDateBadges();
    modal.classList.remove('hidden');
    titleInput.focus();
    this.initLucide();
  },

  setTaskModalDateUndeclared(type) {
    if (type === 'start') {
      const input = document.getElementById('task-input-startdate');
      if (input) input.value = '';
    } else if (type === 'due') {
      const input = document.getElementById('task-input-duedate');
      if (input) input.value = '';
    }
    this.updateTaskModalDateBadges();
  },

  updateTaskModalDateBadges() {
    const sInput = document.getElementById('task-input-startdate');
    const sBadge = document.getElementById('task-startdate-undeclared-badge');
    if (sBadge && sInput) {
      if (!sInput.value) {
        sBadge.classList.remove('hidden');
      } else {
        sBadge.classList.add('hidden');
      }
    }

    const dInput = document.getElementById('task-input-duedate');
    const dBadge = document.getElementById('task-duedate-undeclared-badge');
    if (dBadge && dInput) {
      if (!dInput.value) {
        dBadge.classList.remove('hidden');
      } else {
        dBadge.classList.add('hidden');
      }
    }
    this.initLucide();
  },

  closeTaskModal() {
    document.getElementById('task-modal')?.classList.add('hidden');
  },

  populateTaskModalDropdowns() {
    const p = this.state.currentProject;
    const sprintSelect = document.getElementById('task-input-sprint');
    const assigneeSelect = document.getElementById('task-input-assignee');

    if (sprintSelect && p) {
      sprintSelect.innerHTML = `<option value="">No Sprint (Backlog)</option>` +
        (p.sprints || []).map(s => `<option value="${s.id}">${this.escapeHtml(s.name)} (${s.status})</option>`).join('');
    }

    if (assigneeSelect && p) {
      assigneeSelect.innerHTML = `<option value="">Unassigned</option>` +
        (p.members || []).map(m => `<option value="${m.id}">${this.escapeHtml(m.name)} (${m.role})</option>`).join('');
    }
  },

  renderSubtaskList(subtasks) {
    const container = document.getElementById('subtasks-container');
    if (!container) return;
    
    const countSpan = document.getElementById('subtask-progress-count');
    const completed = subtasks.filter(s => s.completed).length;
    if (countSpan) countSpan.textContent = `${completed} / ${subtasks.length}`;

    container.innerHTML = subtasks.map(s => `
      <div class="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/60">
        <label class="flex items-center space-x-2.5 flex-1 min-w-0 cursor-pointer">
          <input type="checkbox" ${s.completed ? 'checked' : ''} onchange="app.toggleSubtask(${s.id}, this.checked)" class="rounded text-blue-600 w-3.5 h-3.5">
          <span class="text-xs ${s.completed ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-200'} truncate">${this.escapeHtml(s.title)}</span>
        </label>
        <button type="button" onclick="app.deleteSubtask(${s.id})" class="text-slate-400 hover:text-rose-500 p-1">
          <i data-lucide="x" class="w-3.5 h-3.5"></i>
        </button>
      </div>
    `).join('');
    this.initLucide();
  },

  async handleAddSubtask() {
    const input = document.getElementById('new-subtask-input');
    const title = input?.value.trim();
    if (!title) return;

    const taskId = document.getElementById('task-input-id')?.value;
    if (taskId) {
      try {
        await this.api(`/api/tasks/${taskId}/subtasks`, {
          method: 'POST',
          body: JSON.stringify({ title })
        });
        const task = await this.api(`/api/tasks/${taskId}`);
        this.renderSubtaskList(task.subtasks || []);
        input.value = '';
      } catch (e) {
        console.error(e);
      }
    } else {
      const container = document.getElementById('subtasks-container');
      const div = document.createElement('div');
      div.className = 'flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700/60';
      div.innerHTML = `
        <span class="text-xs text-slate-700 dark:text-slate-200 temporary-subtask">${this.escapeHtml(title)}</span>
        <button type="button" onclick="this.parentElement.remove()" class="text-slate-400 hover:text-rose-500 p-1"><i data-lucide="x" class="w-3.5 h-3.5"></i></button>
      `;
      container.appendChild(div);
      input.value = '';
      this.initLucide();
    }
  },

  async toggleSubtask(subtaskId, completed) {
    try {
      await this.api(`/api/subtasks/${subtaskId}`, {
        method: 'PUT',
        body: JSON.stringify({ completed })
      });
      const taskId = document.getElementById('task-input-id')?.value;
      if (taskId) {
        const task = await this.api(`/api/tasks/${taskId}`);
        this.renderSubtaskList(task.subtasks || []);
      }
      this.fetchTasks();
    } catch (e) {
      console.error(e);
    }
  },

  async deleteSubtask(subtaskId) {
    try {
      await this.api(`/api/subtasks/${subtaskId}`, { method: 'DELETE' });
      const taskId = document.getElementById('task-input-id')?.value;
      if (taskId) {
        const task = await this.api(`/api/tasks/${taskId}`);
        this.renderSubtaskList(task.subtasks || []);
      }
      this.fetchTasks();
    } catch (e) {
      console.error(e);
    }
  },

  async handleSaveTask() {
    const title = document.getElementById('task-input-title')?.value.trim();
    if (!title) {
      this.showToast('Please enter a task title', 'error');
      return;
    }

    const taskId = document.getElementById('task-input-id')?.value;
    const desc = document.getElementById('task-input-description')?.value;
    const status = document.getElementById('task-input-status')?.value;
    const priority = document.getElementById('task-input-priority')?.value;
    const sprintId = document.getElementById('task-input-sprint')?.value || null;
    const assigneeId = document.getElementById('task-input-assignee')?.value || null;
    const startDate = document.getElementById('task-input-startdate')?.value || null;
    const dueDate = document.getElementById('task-input-duedate')?.value || null;
    const estHours = parseFloat(document.getElementById('task-input-esthours')?.value || 0);
    const actHours = parseFloat(document.getElementById('task-input-acthours')?.value || 0);
    const tagsRaw = document.getElementById('task-input-tags')?.value || '';
    const tags = tagsRaw.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean);

    const tempSubtasks = Array.from(document.querySelectorAll('.temporary-subtask')).map(el => el.textContent);

    const payload = {
      title,
      description: desc,
      status,
      priority,
      sprint_id: sprintId ? Number(sprintId) : null,
      assignee_id: assigneeId ? Number(assigneeId) : null,
      start_date: startDate,
      due_date: dueDate,
      estimated_hours: estHours,
      actual_hours: actHours,
      tags,
      subtasks: tempSubtasks
    };

    try {
      if (taskId) {
        await this.api(`/api/tasks/${taskId}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        this.showToast('Task updated successfully', 'success');
      } else {
        await this.api(`/api/projects/${this.state.currentProjectId}/tasks`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        this.showToast('Task created successfully', 'success');
      }

      this.closeTaskModal();
      await this.fetchTasks();
    } catch (e) {
      console.error(e);
    }
  },

  async handleDeleteTask() {
    const taskId = document.getElementById('task-input-id')?.value;
    if (!taskId) return;
    if (!confirm('Are you sure you want to delete this task?')) return;

    try {
      await this.api(`/api/tasks/${taskId}`, { method: 'DELETE' });
      this.closeTaskModal();
      await this.fetchTasks();
      this.showToast('Task deleted', 'success');
    } catch (e) {
      console.error(e);
    }
  },

  // ==================== PROJECT MODAL ====================
  openProjectModal(editProjectId = null) {
    const modal = document.getElementById('project-modal');
    if (!modal) return;

    const idInput = document.getElementById('project-input-id');
    const nameInput = document.getElementById('project-input-name');
    const descInput = document.getElementById('project-input-description');
    const colorInput = document.getElementById('project-input-color');
    const delBtn = document.getElementById('project-delete-btn');
    const titleEl = document.getElementById('project-modal-title');
    const submitBtn = document.getElementById('project-submit-btn');

    if (editProjectId) {
      const proj = this.state.projects.find(p => p.id === editProjectId) || this.state.currentProject;
      if (idInput) idInput.value = editProjectId;
      if (nameInput) nameInput.value = proj?.name || '';
      if (descInput) descInput.value = proj?.description || '';
      if (colorInput) colorInput.value = proj?.color || '#3B82F6';
      if (titleEl) titleEl.textContent = 'Project Settings';
      if (submitBtn) submitBtn.textContent = 'Save Changes';
      if (delBtn) delBtn.classList.remove('hidden');
    } else {
      if (idInput) idInput.value = '';
      if (nameInput) nameInput.value = '';
      if (descInput) descInput.value = '';
      if (colorInput) colorInput.value = '#3B82F6';
      if (titleEl) titleEl.textContent = 'Create New Project';
      if (submitBtn) submitBtn.textContent = 'Create Project';
      if (delBtn) delBtn.classList.add('hidden');
    }

    modal.classList.remove('hidden');
    nameInput?.focus();
    this.initLucide();
  },

  closeProjectModal() {
    document.getElementById('project-modal')?.classList.add('hidden');
  },

  async handleSaveProject() {
    const id = document.getElementById('project-input-id')?.value;
    const name = document.getElementById('project-input-name')?.value.trim();
    if (!name) {
      this.showToast('Please enter a project name', 'error');
      return;
    }
    const description = document.getElementById('project-input-description')?.value;
    const color = document.getElementById('project-input-color')?.value;

    try {
      if (id) {
        await this.api(`/api/projects/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ name, description, color })
        });
        this.closeProjectModal();
        await this.fetchProjects();
        await this.selectProject(Number(id));
        this.showToast('Project updated successfully', 'success');
      } else {
        const project = await this.api('/api/projects', {
          method: 'POST',
          body: JSON.stringify({ name, description, color })
        });
        this.closeProjectModal();
        await this.fetchProjects();
        await this.selectProject(project.id);
        this.showToast('Project created successfully', 'success');
      }
    } catch (e) {
      console.error(e);
      this.showToast('Failed to save project', 'error');
    }
  },

  handleDeleteProjectFromModal() {
    const id = Number(document.getElementById('project-input-id')?.value);
    if (!id) return;
    const name = document.getElementById('project-input-name')?.value || '';
    this.deleteProject(id, name);
  },

  async deleteProject(projectId, projectName = '') {
    if (!projectId) return;
    const name = projectName || (this.state.projects.find(p => p.id === projectId)?.name || 'this project');

    if (this.state.projects.length <= 1) {
      if (!confirm(`Warning: "${name}" is your only project. Deleting it will leave the workspace empty. Do you want to proceed?`)) {
        return;
      }
    } else {
      if (!confirm(`Are you sure you want to permanently delete the project "${name}"?\n\nAll tasks, sprints, milestones, and time logs in this project will be deleted.`)) {
        return;
      }
    }

    try {
      await this.api(`/api/projects/${projectId}`, { method: 'DELETE' });
      this.showToast(`Project "${name}" deleted`, 'success');
      this.closeProjectModal();

      await this.fetchProjects();
      if (this.state.projects.length > 0) {
        const nextId = this.state.projects[0].id;
        await this.selectProject(nextId);
      } else {
        this.state.currentProjectId = null;
        this.state.currentProject = null;
        this.state.tasks = [];
        this.renderProjectsDropdown();
        this.renderProjectsSidebar();
        this.renderCurrentView();
      }
    } catch (e) {
      console.error(e);
      this.showToast('Failed to delete project', 'error');
    }
  },

  // ==================== SPRINT MODAL ====================
  openSprintModal(sprint = null) {
    const modal = document.getElementById('sprint-modal');
    if (!modal) return;

    document.getElementById('sprint-input-id').value = sprint ? sprint.id : '';
    document.getElementById('sprint-input-name').value = sprint ? sprint.name : '';
    document.getElementById('sprint-input-goal').value = sprint ? sprint.goal || '' : '';
    document.getElementById('sprint-input-startdate').value = sprint ? sprint.start_date || '' : new Date().toISOString().split('T')[0];
    document.getElementById('sprint-input-enddate').value = sprint ? sprint.end_date || '' : '';
    document.getElementById('sprint-input-status').value = sprint ? sprint.status : 'planning';

    modal.classList.remove('hidden');
  },

  closeSprintModal() {
    document.getElementById('sprint-modal')?.classList.add('hidden');
  },

  async handleSaveSprint() {
    const id = document.getElementById('sprint-input-id')?.value;
    const name = document.getElementById('sprint-input-name')?.value.trim();
    if (!name) {
      this.showToast('Sprint name is required', 'error');
      return;
    }
    const goal = document.getElementById('sprint-input-goal')?.value;
    const startDate = document.getElementById('sprint-input-startdate')?.value || null;
    const endDate = document.getElementById('sprint-input-enddate')?.value || null;
    const status = document.getElementById('sprint-input-status')?.value;

    const payload = { name, goal, start_date: startDate, end_date: endDate, status };

    try {
      if (id) {
        await this.api(`/api/projects/${this.state.currentProjectId}/sprints/${id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      } else {
        await this.api(`/api/projects/${this.state.currentProjectId}/sprints`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
      }
      this.closeSprintModal();
      await this.selectProject(this.state.currentProjectId);
      this.showToast('Sprint saved', 'success');
    } catch (e) {
      console.error(e);
    }
  },

  // ==================== MILESTONE MODAL ====================
  openMilestoneModal() {
    document.getElementById('milestone-input-title').value = '';
    document.getElementById('milestone-input-duedate').value = '';
    document.getElementById('milestone-modal')?.classList.remove('hidden');
  },

  closeMilestoneModal() {
    document.getElementById('milestone-modal')?.classList.add('hidden');
  },

  async handleSaveMilestone() {
    const title = document.getElementById('milestone-input-title')?.value.trim();
    const dueDate = document.getElementById('milestone-input-duedate')?.value;
    if (!title || !dueDate) {
      this.showToast('Title and target date are required', 'error');
      return;
    }

    try {
      await this.api(`/api/projects/${this.state.currentProjectId}/milestones`, {
        method: 'POST',
        body: JSON.stringify({ title, due_date: dueDate })
      });
      this.closeMilestoneModal();
      await this.selectProject(this.state.currentProjectId);
      this.showToast('Milestone created', 'success');
    } catch (e) {
      console.error(e);
    }
  },

  // ==================== TIME LOG MODAL ====================
  openManualTimeLogModal(params = {}) {
    const modal = document.getElementById('timelog-modal');
    if (!modal) return;

    const taskSelect = document.getElementById('timelog-input-task');
    const memberSelect = document.getElementById('timelog-input-member');

    taskSelect.innerHTML = this.state.tasks.map(t => `<option value="${t.id}" ${t.id === params.taskId ? 'selected' : ''}>${this.escapeHtml(t.title)}</option>`).join('');
    
    const members = this.state.currentProject?.members || [];
    memberSelect.innerHTML = members.map(m => `<option value="${m.id}">${this.escapeHtml(m.name)}</option>`).join('');

    document.getElementById('timelog-input-hours').value = params.hours || '';
    document.getElementById('timelog-input-date').value = new Date().toISOString().split('T')[0];
    document.getElementById('timelog-input-desc').value = '';

    modal.classList.remove('hidden');
  },

  closeManualTimeLogModal() {
    document.getElementById('timelog-modal')?.classList.add('hidden');
  },

  async handleSaveTimeLog() {
    const taskId = document.getElementById('timelog-input-task')?.value;
    const memberId = document.getElementById('timelog-input-member')?.value || null;
    const hours = parseFloat(document.getElementById('timelog-input-hours')?.value || 0);
    const date = document.getElementById('timelog-input-date')?.value;
    const desc = document.getElementById('timelog-input-desc')?.value;

    if (!taskId || hours <= 0) {
      this.showToast('Valid task and hours are required', 'error');
      return;
    }

    try {
      await this.api(`/api/tasks/${taskId}/timelogs`, {
        method: 'POST',
        body: JSON.stringify({
          member_id: memberId ? Number(memberId) : null,
          hours,
          logged_date: date,
          description: desc
        })
      });
      this.closeManualTimeLogModal();
      await this.fetchTasks();
      this.showToast(`Recorded ${hours}h worklog`, 'success');
    } catch (e) {
      console.error(e);
    }
  },

  // ==================== GANTT EXCEL / CSV UPLOAD ====================
  openGanttUploadModal() {
    const modal = document.getElementById('gantt-upload-modal');
    if (!modal) return;

    const fileInput = document.getElementById('gantt-file-input');
    if (fileInput) fileInput.value = '';
    document.getElementById('gantt-preview-box')?.classList.add('hidden');
    document.getElementById('gantt-drop-text').textContent = 'Click or drag & drop your Gantt file here';
    
    const pName = this.state.currentProject?.name || 'Active';
    const activeLabel = document.getElementById('gantt-active-project-name');
    if (activeLabel) activeLabel.textContent = pName;

    document.getElementById('gantt-new-project-name').value = '';
    this.toggleGanttDestOption('current');

    modal.classList.remove('hidden');
    this.initLucide();
  },

  closeGanttUploadModal() {
    document.getElementById('gantt-upload-modal')?.classList.add('hidden');
  },

  toggleGanttDestOption(val) {
    const newContainer = document.getElementById('gantt-new-project-input-container');
    if (val === 'new') {
      newContainer?.classList.remove('hidden');
      document.getElementById('gantt-new-project-name')?.focus();
    } else {
      newContainer?.classList.add('hidden');
    }
  },

  handleGanttFileChange(file) {
    if (!file) return;
    const previewBox = document.getElementById('gantt-preview-box');
    const nameLabel = document.getElementById('gantt-file-name-label');
    const sizeLabel = document.getElementById('gantt-file-size-label');
    const dropText = document.getElementById('gantt-drop-text');

    if (nameLabel) nameLabel.textContent = file.name;
    if (sizeLabel) sizeLabel.textContent = `${(file.size / 1024).toFixed(1)} KB`;
    if (dropText) dropText.textContent = `Selected: ${file.name}`;
    if (previewBox) previewBox.classList.remove('hidden');

    const newNameInput = document.getElementById('gantt-new-project-name');
    if (newNameInput && !newNameInput.value) {
      newNameInput.value = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
    }
    this.initLucide();
  },

  async submitGanttUpload() {
    const fileInput = document.getElementById('gantt-file-input');
    const file = fileInput?.files?.[0];
    if (!file) {
      this.showToast('Please select an Excel or CSV file first', 'error');
      return;
    }

    const destType = document.querySelector('input[name="gantt_destination"]:checked')?.value || 'current';
    const newProjectName = destType === 'new' ? document.getElementById('gantt-new-project-name').value.trim() : '';

    if (destType === 'new' && !newProjectName) {
      this.showToast('Please specify a name for the new project', 'error');
      return;
    }

    const submitBtn = document.getElementById('gantt-upload-submit-btn');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Importing Tasks...</span>`;
      this.initLucide();
    }

    const formData = new FormData();
    formData.append('file', file);
    if (newProjectName) {
      formData.append('new_project_name', newProjectName);
    }

    const targetUrl = `/api/projects/${this.state.currentProjectId || 1}/upload_gantt`;

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload Gantt file');
      }

      this.showToast(data.message || `Successfully imported ${data.tasks_imported} tasks!`, 'success');
      this.closeGanttUploadModal();

      await this.fetchProjects();
      if (data.project_id) {
        await this.selectProject(data.project_id);
      }
      this.switchView('gantt');
    } catch (err) {
      this.showToast(err.message, 'error');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i data-lucide="upload" class="w-4 h-4"></i><span>Import Gantt Tasks</span>`;
        this.initLucide();
      }
    }
  },

  downloadSampleGantt(format = 'xlsx') {
    const url = format === 'xlsx' ? '/api/gantt/sample_xlsx' : '/api/gantt/sample_csv';
    window.location.href = url;
    this.showToast(`Downloading sample Gantt ${format.toUpperCase()} template...`, 'info');
  },

  // ==================== IMPORT / EXPORT MODAL ====================
  openImportExportModal() {
    document.getElementById('import-export-modal')?.classList.remove('hidden');
  },

  closeImportExportModal() {
    document.getElementById('import-export-modal')?.classList.add('hidden');
  },

  async exportProjectJSON() {
    if (!this.state.currentProjectId) return;
    try {
      const data = await this.api(`/api/projects/${this.state.currentProjectId}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `projectpulse_backup_${this.state.currentProject?.name?.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      this.showToast('Backup file downloaded', 'success');
    } catch (e) {
      console.error(e);
    }
  },

  async importProjectJSON() {
    const input = document.getElementById('import-json-file');
    const file = input?.files?.[0];
    if (!file) {
      this.showToast('Please select a JSON backup file', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const payload = JSON.parse(e.target.result);
        const res = await this.api('/api/projects/import', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        this.closeImportExportModal();
        await this.fetchProjects();
        await this.selectProject(res.project_id);
        this.showToast('Project imported successfully', 'success');
      } catch (err) {
        this.showToast('Invalid JSON backup file', 'error');
      }
    };
    reader.readAsText(file);
  },

  async resetDemoData() {
    if (!confirm('Reset database and restore demo projects? All custom edits will be reverted.')) return;
    try {
      await this.api('/api/seed/reset', { method: 'POST' });
      localStorage.removeItem('projectpulse_active_project');
      await this.fetchProjects();
      this.showToast('Demo data restored successfully', 'success');
    } catch (e) {
      console.error(e);
    }
  },

  // ==================== OUTLOOK EMAIL NOTIFICATION INTEGRATION ====================
  async openNotificationsModal() {
    try {
      const settings = await this.api('/api/notifications/settings');
      this.populateNotificationSettings(settings);
      await this.loadNotificationLogs();
      this.renderNotificationMembers();
      
      const modal = document.getElementById('notifications-modal');
      if (modal) modal.classList.remove('hidden');
      this.switchNotifTab('settings');
      this.initLucide();
    } catch (e) {
      console.error(e);
      this.showToast('Failed to load notification settings', 'error');
    }
  },

  closeNotificationsModal() {
    const modal = document.getElementById('notifications-modal');
    if (modal) modal.classList.add('hidden');
  },

  switchNotifTab(tabName) {
    const tabs = ['settings', 'outbox', 'members'];
    tabs.forEach(t => {
      const btn = document.getElementById(`notif-tab-${t}-btn`);
      const pane = document.getElementById(`notif-tab-${t}`);
      if (t === tabName) {
        if (btn) {
          btn.className = 'py-3 px-4 border-b-2 border-blue-600 text-blue-600 dark:text-blue-400 font-bold flex items-center space-x-2';
        }
        if (pane) pane.classList.remove('hidden');
      } else {
        if (btn) {
          btn.className = 'py-3 px-4 border-b-2 border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center space-x-2';
        }
        if (pane) pane.classList.add('hidden');
      }
    });
    if (tabName === 'outbox') {
      this.loadNotificationLogs();
    } else if (tabName === 'members') {
      this.renderNotificationMembers();
    }
    this.initLucide();
  },

  populateNotificationSettings(s) {
    const provSelect = document.getElementById('notif-input-provider');
    if (provSelect) provSelect.value = s.smtp_provider || 'outlook';

    const userIn = document.getElementById('notif-input-user');
    if (userIn) userIn.value = s.smtp_user || '';

    const passIn = document.getElementById('notif-input-pass');
    if (passIn) passIn.value = s.has_password ? '••••••••' : (s.smtp_pass || '');

    const nameIn = document.getElementById('notif-input-sendername');
    if (nameIn) nameIn.value = s.sender_name || 'ProjectPulse Notifications';

    const hostIn = document.getElementById('notif-input-host');
    if (hostIn) hostIn.value = s.smtp_host || 'smtp.office365.com';

    const portIn = document.getElementById('notif-input-port');
    if (portIn) portIn.value = s.smtp_port || 587;

    const tlsIn = document.getElementById('notif-input-tls');
    if (tlsIn) tlsIn.checked = !!s.use_tls;

    const simIn = document.getElementById('notif-input-simulation');
    if (simIn) simIn.checked = !!s.simulation_mode;

    const dueSoonIn = document.getElementById('notif-rule-duesoon');
    if (dueSoonIn) dueSoonIn.checked = s.notify_due_soon !== 0;

    const dueTodayIn = document.getElementById('notif-rule-duetoday');
    if (dueTodayIn) dueTodayIn.checked = s.notify_due_today !== 0;

    const overdueIn = document.getElementById('notif-rule-overdue');
    if (overdueIn) overdueIn.checked = s.notify_overdue !== 0;

    const recDayIn = document.getElementById('notif-input-recurringday');
    if (recDayIn) recDayIn.value = (s.recurring_day || 'monday').toLowerCase();

    const assignedIn = document.getElementById('notif-rule-assigned');
    if (assignedIn) assignedIn.checked = s.notify_assigned !== 0;

    const completedIn = document.getElementById('notif-rule-completed');
    if (completedIn) completedIn.checked = s.notify_completed !== 0;

    this.handleSimulationToggle();
  },

  handleProviderChange(provider) {
    const hostIn = document.getElementById('notif-input-host');
    const portIn = document.getElementById('notif-input-port');
    const tlsIn = document.getElementById('notif-input-tls');
    const statusBadge = document.getElementById('notif-smtp-status-badge');

    if (provider === 'outlook') {
      if (hostIn) hostIn.value = 'smtp.office365.com';
      if (portIn) portIn.value = '587';
      if (tlsIn) tlsIn.checked = true;
      if (statusBadge) statusBadge.textContent = 'Microsoft Outlook / Office 365';
    } else if (provider === 'hotmail') {
      if (hostIn) hostIn.value = 'smtp-mail.outlook.com';
      if (portIn) portIn.value = '587';
      if (tlsIn) tlsIn.checked = true;
      if (statusBadge) statusBadge.textContent = 'Outlook.com / Live / Hotmail';
    } else {
      if (statusBadge) statusBadge.textContent = 'Custom SMTP';
    }
  },

  handleSimulationToggle() {
    const simIn = document.getElementById('notif-input-simulation');
    const label = document.getElementById('notif-mode-label');
    const isSim = simIn ? simIn.checked : true;
    if (label) {
      label.textContent = isSim ? 'Sandbox / Simulation Mode' : 'Live Outlook / SMTP Mode';
      label.className = `text-xs font-bold ${isSim ? 'text-indigo-600 dark:text-indigo-400' : 'text-emerald-600 dark:text-emerald-400'}`;
    }
  },

  async saveNotificationSettings() {
    try {
      const payload = {
        smtp_provider: document.getElementById('notif-input-provider')?.value || 'outlook',
        smtp_user: document.getElementById('notif-input-user')?.value || '',
        smtp_pass: document.getElementById('notif-input-pass')?.value || '',
        sender_name: document.getElementById('notif-input-sendername')?.value || 'ProjectPulse Notifications',
        smtp_host: document.getElementById('notif-input-host')?.value || 'smtp.office365.com',
        smtp_port: parseInt(document.getElementById('notif-input-port')?.value || '587', 10),
        use_tls: document.getElementById('notif-input-tls')?.checked ? 1 : 0,
        simulation_mode: document.getElementById('notif-input-simulation')?.checked ? 1 : 0,
        notify_due_soon: document.getElementById('notif-rule-duesoon')?.checked ? 1 : 0,
        notify_due_today: document.getElementById('notif-rule-duetoday')?.checked ? 1 : 0,
        notify_overdue: document.getElementById('notif-rule-overdue')?.checked ? 1 : 0,
        recurring_day: document.getElementById('notif-input-recurringday')?.value || 'monday',
        notify_assigned: document.getElementById('notif-rule-assigned')?.checked ? 1 : 0,
        notify_completed: document.getElementById('notif-rule-completed')?.checked ? 1 : 0,
        is_enabled: 1
      };

      const updated = await this.api('/api/notifications/settings', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });

      this.populateNotificationSettings(updated);
      this.showToast('Outlook & Notification settings saved successfully', 'success');
    } catch (e) {
      console.error(e);
      this.showToast('Failed to save notification settings', 'error');
    }
  },

  async sendTestEmail() {
    const input = document.getElementById('notif-input-testemail');
    const email = input ? input.value.trim() : '';
    if (!email || !email.includes('@')) {
      this.showToast('Please enter a valid recipient email address', 'error');
      return;
    }

    try {
      this.showToast('Sending test email...', 'info');
      const res = await this.api('/api/notifications/test_email', {
        method: 'POST',
        body: JSON.stringify({ email })
      });

      if (res.success) {
        this.showToast(res.status === 'sent' ? `Live email delivered to ${email}` : `Test email generated and saved to Outbox (Simulation)`, 'success');
        await this.loadNotificationLogs();
      } else {
        this.showToast(`Test email error: ${res.error || 'Failed'}`, 'error');
      }
    } catch (e) {
      console.error(e);
      this.showToast('Error sending test email', 'error');
    }
  },

  async runManualNotificationCheck() {
    try {
      this.showToast('Scanning pending tasks for due date triggers...', 'info');
      const res = await this.api('/api/notifications/run_checks', {
        method: 'POST',
        body: JSON.stringify({})
      });
      const count = res.notifications_dispatched || 0;
      this.showToast(`Scan complete! ${count} notification(s) dispatched.`, 'success');
      await this.loadNotificationLogs();
    } catch (e) {
      console.error(e);
      this.showToast('Failed to run due date checks', 'error');
    }
  },

  async loadNotificationLogs() {
    try {
      const logs = await this.api('/api/notifications/logs?limit=50');
      const countBadge = document.getElementById('notif-outbox-count-badge');
      if (countBadge) countBadge.textContent = logs.length;

      const tbody = document.getElementById('notif-logs-table-body');
      if (!tbody) return;

      if (!logs.length) {
        tbody.innerHTML = `
          <tr>
            <td colspan="6" class="px-4 py-8 text-center text-slate-400">
              <i data-lucide="mail-search" class="w-8 h-8 mx-auto mb-2 opacity-40"></i>
              <div>No notifications logged yet. Trigger alerts or click "Run Due Date Checks Now".</div>
            </td>
          </tr>
        `;
        this.initLucide();
        return;
      }

      const triggerBadges = {
        due_soon: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">⏳ Due Tomorrow</span>',
        due_today: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300">🚨 Due Today</span>',
        overdue_1day: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">⚠️ 1d Overdue</span>',
        overdue_recurring: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300">🔁 Weekly Overdue</span>',
        assigned: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">📋 Assigned</span>',
        completed: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">✅ Completed</span>',
        test_email: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">🧪 Test Email</span>'
      };

      tbody.innerHTML = logs.map(l => {
        const timeStr = new Date(l.sent_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const triggerBadge = triggerBadges[l.trigger_type] || `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">${l.trigger_type}</span>`;
        const statusBadge = l.status === 'sent'
          ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">Sent</span>'
          : l.status === 'simulated'
          ? '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-600 border border-blue-500/20">Simulated</span>'
          : '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-600 border border-rose-500/20" title="' + this.escapeHtml(l.error_message || 'Failed') + '">Failed</span>';

        return `
          <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
            <td class="px-3 py-2.5 font-mono text-[11px] whitespace-nowrap text-slate-500">${timeStr}</td>
            <td class="px-3 py-2.5">
              <div class="font-semibold text-slate-800 dark:text-white">${this.escapeHtml(l.recipient_name || 'Member')}</div>
              <div class="text-[11px] text-slate-500">${this.escapeHtml(l.recipient_email)}</div>
            </td>
            <td class="px-3 py-2.5 whitespace-nowrap">${triggerBadge}</td>
            <td class="px-3 py-2.5">
              <div class="font-medium text-slate-800 dark:text-slate-200 truncate max-w-[180px]">${this.escapeHtml(l.task_title || l.subject)}</div>
              <div class="text-[10px] text-slate-400 truncate max-w-[180px]">${this.escapeHtml(l.project_name || 'Project')}</div>
            </td>
            <td class="px-3 py-2.5 whitespace-nowrap">${statusBadge}</td>
            <td class="px-3 py-2.5 text-right whitespace-nowrap">
              <button onclick="app.openEmailPreview(${l.id})" class="text-blue-600 hover:text-blue-700 dark:text-blue-400 font-semibold text-[11px] hover:underline flex items-center justify-end space-x-1 ml-auto">
                <i data-lucide="eye" class="w-3.5 h-3.5"></i>
                <span>Preview</span>
              </button>
            </td>
          </tr>
        `;
      }).join('');

      this.initLucide();
    } catch (e) {
      console.error(e);
    }
  },

  async openEmailPreview(logId) {
    try {
      const log = await this.api(`/api/notifications/logs/${logId}`);
      if (!log) return;

      const modal = document.getElementById('email-preview-modal');
      const subjEl = document.getElementById('email-preview-subject');
      const toEl = document.getElementById('email-preview-to');
      const dateEl = document.getElementById('email-preview-date');
      const container = document.getElementById('email-preview-container');

      if (subjEl) subjEl.textContent = log.subject;
      if (toEl) toEl.textContent = `${log.recipient_name || 'Recipient'} <${log.recipient_email}>`;
      if (dateEl) dateEl.textContent = new Date(log.sent_at).toLocaleString();
      if (container) container.innerHTML = log.body_html;

      if (modal) modal.classList.remove('hidden');
      this.initLucide();
    } catch (e) {
      console.error(e);
      this.showToast('Failed to load email preview', 'error');
    }
  },

  closeEmailPreviewModal() {
    const modal = document.getElementById('email-preview-modal');
    if (modal) modal.classList.add('hidden');
  },

  renderNotificationMembers() {
    const members = this.state.members || [];
    const tbody = document.getElementById('notif-members-table-body');
    if (!tbody) return;

    if (!members.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="4" class="px-4 py-6 text-center text-slate-400">No members configured for active project.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = members.map(m => {
      const email = m.email || '';
      return `
        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
          <td class="px-3 py-2.5">
            <div class="flex items-center space-x-2">
              <div class="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0" style="background-color: ${m.avatar_color || '#3B82F6'};">
                ${m.name.charAt(0).toUpperCase()}
              </div>
              <span class="font-bold text-slate-800 dark:text-white">${this.escapeHtml(m.name)}</span>
            </div>
          </td>
          <td class="px-3 py-2.5 text-slate-500 font-medium">${this.escapeHtml(m.role || 'Member')}</td>
          <td class="px-3 py-2.5">
            <input type="email" value="${this.escapeHtml(email)}" id="member-email-input-${m.id}" placeholder="e.g. ${m.name.toLowerCase().replace(/\s+/g, '.')}@company.com"
              class="w-full px-2.5 py-1 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-white focus:ring-1 focus:ring-blue-500">
          </td>
          <td class="px-3 py-2.5 text-right whitespace-nowrap">
            <button onclick="app.updateMemberEmail(${m.id})" class="bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 rounded text-[11px] font-semibold transition">
              Save Email
            </button>
          </td>
        </tr>
      `;
    }).join('');

    this.initLucide();
  },

  async updateMemberEmail(memberId) {
    const input = document.getElementById(`member-email-input-${memberId}`);
    const email = input ? input.value.trim() : '';
    try {
      await this.api(`/api/members/${memberId}`, {
        method: 'PUT',
        body: JSON.stringify({ email })
      });
      await this.fetchMembers();
      this.showToast('Member email address updated', 'success');
    } catch (e) {
      console.error(e);
      this.showToast('Failed to update member email', 'error');
    }
  },

  async refreshMembersList() {
    await this.fetchMembers();
    this.renderNotificationMembers();
  },

  // ==================== TOAST NOTIFICATIONS ====================
  showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    const colors = {
      success: 'bg-emerald-600 text-white',
      error: 'bg-rose-600 text-white',
      info: 'bg-slate-800 text-white'
    }[type] || 'bg-slate-800 text-white';

    toast.className = `${colors} px-4 py-2.5 rounded-xl shadow-lg text-xs font-semibold flex items-center space-x-2 animate-in slide-in-from-bottom duration-200`;
    toast.innerHTML = `
      <span>${this.escapeHtml(message)}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('opacity-0', 'transition', 'duration-300');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};

document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
