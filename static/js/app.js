/**
 * ProjectPulse - Modern Project Management SPA Logic
 */

const app = {
  _projectSeq: 0,
  _searchTimer: null,
  state: {
    user: null,
    authToken: localStorage.getItem('projectpulse_token') || null,
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
    calendarDate: new Date(),
    charts: {},
    sortableInstances: []
  },

  syncCurrentProjectCache() {
    if (this.state.currentProjectId) {
      const pid = this.state.currentProjectId;
      if (this.state.currentProject) {
        localStorage.setItem(`projectpulse_cached_project_${pid}`, JSON.stringify(this.state.currentProject));
      }
      if (this.state.tasks) {
        localStorage.setItem(`projectpulse_cached_tasks_${pid}`, JSON.stringify(this.state.tasks));
      }
    }
  },

  async init() {
    this.initTheme();
    this.initKeyboardShortcuts();
    this.initClickOutside();
    this.initLucide();

    // Fast-path: Instant Hydration from Local Storage (0ms perceived load)
    const token = localStorage.getItem('projectpulse_token');
    const cachedUser = localStorage.getItem('projectpulse_user');
    const cachedProjects = localStorage.getItem('projectpulse_cached_projects');
    const activeProjectId = localStorage.getItem('projectpulse_active_project');
    const cachedCurrentProject = activeProjectId ? localStorage.getItem(`projectpulse_cached_project_${activeProjectId}`) : null;
    const cachedTasks = activeProjectId ? localStorage.getItem(`projectpulse_cached_tasks_${activeProjectId}`) : null;

    if (token && cachedUser) {
      try {
        this.state.authToken = token;
        this.state.user = JSON.parse(cachedUser);
        this.updateHeaderUserProfile();
        this.hideAuthContainer();

        if (cachedProjects) {
          this.state.projects = JSON.parse(cachedProjects);
          this.renderProjectsDropdown();
          this.renderProjectsSidebar();
        }

        if (cachedCurrentProject) {
          this.state.currentProject = JSON.parse(cachedCurrentProject);
          this.state.currentProjectId = this.state.currentProject.id;
          this.populateFilterDropdowns();
        }

        if (cachedTasks) {
          this.state.tasks = JSON.parse(cachedTasks);
          this.renderCurrentView();
        }
      } catch (e) {
        console.error('Error hydrating cache:', e);
      }
    } else {
      this.showAuthContainer();
    }

    // Background auth check & quiet bootstrap sync
    await this.checkAuth();
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

  initClickOutside() {
    document.addEventListener('click', (e) => {
      const userBtn = document.getElementById('user-profile-btn');
      const userMenu = document.getElementById('user-dropdown-menu');
      if (userMenu && !userMenu.classList.contains('hidden')) {
        if (!userBtn?.contains(e.target) && !userMenu.contains(e.target)) {
          userMenu.classList.add('hidden');
        }
      }
    });
  },

  closeAllModals() {
    this.closeTaskModal();
    this.closeProjectModal();
    this.closeImportExportModal();
    this.closeGanttUploadModal();
    this.closeUserMenu();
  },

  toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.toggle('-translate-x-full');
  },

  async api(endpoint, options = {}) {
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      };
      if (this.state.authToken) {
        headers['Authorization'] = `Bearer ${this.state.authToken}`;
      }

      const response = await fetch(endpoint, {
        ...options,
        headers
      });

      if (response.status === 401 && !endpoint.startsWith('/api/auth/')) {
        this.handleSessionExpired();
        throw new Error('Session expired. Please sign in again.');
      }

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || errData.detail || `Request failed with status ${response.status}`);
      }
      return await response.json();
    } catch (err) {
      if (!endpoint.startsWith('/api/auth/')) {
        this.showToast(err.message, 'error');
      }
      throw err;
    }
  },

  async fetchProjects(autoSelectId = null) {
    try {
      const projects = await this.api('/api/projects');
      this.state.projects = projects;
      this.renderProjectsDropdown();
      this.renderProjectsSidebar();

      if (projects.length > 0) {
        let targetId = autoSelectId;
        if (!targetId) {
          const savedId = localStorage.getItem('projectpulse_active_project');
          const exists = projects.find(p => p.id === Number(savedId));
          targetId = exists ? exists.id : projects[0].id;
        } else {
          const exists = projects.find(p => p.id === Number(targetId));
          if (!exists) targetId = projects[0].id;
        }
        await this.selectProject(targetId);
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
      <option value="${p.id}" ${Number(p.id) === Number(this.state.currentProjectId) ? 'selected' : ''}>
        ${this.escapeHtml(p.name)}
      </option>
    `).join('');

    select.onchange = (e) => this.selectProject(Number(e.target.value));
  },

  renderProjectsSidebar() {
    const container = document.getElementById('projects-list-sidebar');
    if (!container) return;
    container.innerHTML = this.state.projects.map(p => `
      <div class="group/p flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${Number(p.id) === Number(this.state.currentProjectId) ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}">
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
    if (!projectId) return;
    projectId = Number(projectId);
    if (isNaN(projectId)) return;

    // Increment request sequence to invalidate any prior pending async fetches
    const seq = ++this._projectSeq;
    this.state.currentProjectId = projectId;
    localStorage.setItem('projectpulse_active_project', projectId);
    
    // Immediately sync selects & sidebar
    const select = document.getElementById('project-select');
    if (select) select.value = String(projectId);
    const analyticsSelect = document.getElementById('analytics-project-select');
    if (analyticsSelect) analyticsSelect.value = String(projectId);
    this.renderProjectsSidebar();

    // Reset project-dependent view state to avoid distortion across projects
    this.state.ganttOffset = 0;
    this.state.calendarSelectedDay = null;
    const inspector = document.getElementById('calendar-day-inspector');
    if (inspector) inspector.classList.add('hidden');

    // Reset assignee filter on project switch
    this.state.filterAssignee = '';
    const memberSelect = document.getElementById('filter-assignee');
    if (memberSelect) memberSelect.value = '';

    // Fast-path: Instant 0ms cache hydration if available
    const cachedProj = localStorage.getItem(`projectpulse_cached_project_${projectId}`);
    const cachedTasks = localStorage.getItem(`projectpulse_cached_tasks_${projectId}`);
    let hydratedFromCache = false;

    if (cachedProj && cachedTasks && !this.state.searchQuery && !this.state.filterPriority) {
      try {
        const parsedProj = JSON.parse(cachedProj);
        const parsedTasks = JSON.parse(cachedTasks);
        if (parsedProj && Number(parsedProj.id) === projectId && Array.isArray(parsedTasks)) {
          this.state.currentProject = parsedProj;
          this.state.tasks = parsedTasks;
          this.populateFilterDropdowns();
          this.renderCurrentView();
          hydratedFromCache = true;
        }
      } catch (e) {
        console.error('Cache hydration error:', e);
      }
    }

    if (!hydratedFromCache) {
      const projInList = this.state.projects.find(p => Number(p.id) === projectId);
      this.state.currentProject = projInList ? { ...projInList, members: [], sprints: [], milestones: [] } : null;
      this.state.tasks = [];
      this.populateFilterDropdowns();
      this.renderCurrentView();
    }

    let url = `/api/projects/${projectId}/tasks?`;
    if (this.state.searchQuery) url += `search=${encodeURIComponent(this.state.searchQuery)}&`;
    if (this.state.filterPriority) url += `priority=${encodeURIComponent(this.state.filterPriority)}&`;

    try {
      const [project, tasks] = await Promise.all([
        this.api(`/api/projects/${projectId}`),
        this.api(url)
      ]);

      // Guard: Discard stale response if user switched to another project while this request was in flight
      if (seq !== this._projectSeq || Number(this.state.currentProjectId) !== projectId) {
        return;
      }

      this.state.currentProject = project;
      this.state.tasks = tasks;

      if (!this.state.searchQuery && !this.state.filterPriority) {
        this.syncCurrentProjectCache();
      }

      this.populateFilterDropdowns();
      this.renderCurrentView();
    } catch (e) {
      if (seq === this._projectSeq) {
        console.error('Failed to select project:', e);
      }
    }
  },

  populateFilterDropdowns() {
    const memberSelect = document.getElementById('filter-assignee');
    const members = this.state.currentProject?.members || [];
    if (memberSelect) {
      const currentVal = this.state.filterAssignee ? String(this.state.filterAssignee) : '';
      const hasMember = members.some(m => String(m.id) === currentVal);
      if (!hasMember) {
        this.state.filterAssignee = '';
      }
      memberSelect.innerHTML = `
        <option value="">All Assignees</option>
        ${members.map(m => `<option value="${m.id}" ${String(m.id) === String(this.state.filterAssignee) ? 'selected' : ''}>${this.escapeHtml(m.name)}</option>`).join('')}
      `;
      memberSelect.value = this.state.filterAssignee || '';
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
      case 'analytics':
        this.renderAnalytics();
        break;
    }
  },

  async fetchTasks() {
    if (!this.state.currentProjectId) return;
    const reqProjectId = Number(this.state.currentProjectId);
    const seq = ++this._projectSeq;
    
    let url = `/api/projects/${reqProjectId}/tasks?`;
    if (this.state.searchQuery) url += `search=${encodeURIComponent(this.state.searchQuery)}&`;
    if (this.state.filterAssignee) url += `assignee_id=${encodeURIComponent(this.state.filterAssignee)}&`;
    if (this.state.filterPriority) url += `priority=${encodeURIComponent(this.state.filterPriority)}&`;

    try {
      const tasks = await this.api(url);
      if (seq !== this._projectSeq || Number(this.state.currentProjectId) !== reqProjectId) {
        return;
      }
      this.state.tasks = tasks;
      if (!this.state.searchQuery && !this.state.filterAssignee && !this.state.filterPriority) {
        this.syncCurrentProjectCache();
      }
      this.renderCurrentView();
    } catch (e) {
      if (seq === this._projectSeq) {
        console.error(e);
      }
    }
  },

  handleSearch(value) {
    this.state.searchQuery = value;
    clearTimeout(this._searchTimer);
    this._searchTimer = setTimeout(() => {
      this.fetchTasks();
    }, 150);
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

    if (swimlane === 'priority') {
      // Swimlanes Layout by Priority
      const priorities = [
        { id: 'urgent', title: 'Urgent Priority', color: '#EF4444' },
        { id: 'high', title: 'High Priority', color: '#F97316' },
        { id: 'medium', title: 'Medium Priority', color: '#F59E0B' },
        { id: 'low', title: 'Low Priority', color: '#10B981' }
      ];
      const swimlaneGroups = priorities.map(p => ({
        id: p.id,
        title: p.title,
        color: p.color,
        tasks: filteredTasks.filter(t => (t.priority || 'medium') === p.id)
      })).filter(g => g.tasks.length > 0);

      boardContainer.innerHTML = swimlaneGroups.map(sg => {
        const sgDone = sg.tasks.filter(t => t.status === 'done').length;
        const sgTotal = sg.tasks.length;
        const sgEst = sg.tasks.reduce((sum, t) => sum + (parseFloat(t.estimated_hours) || 0), 0);

        const colsHtml = columnsMeta.map(col => {
          const colTasks = sg.tasks.filter(t => (t.status || 'todo') === col.id);
          const colCards = colTasks.map(t => this.renderTaskCardHTML(t, members, todayStr)).join('');

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
        const colCards = colTasks.map(t => this.renderTaskCardHTML(t, members, todayStr)).join('');

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

    // 5. Initialize SortableJS on all columns (destroy old instances first to prevent memory leaks and event collisions)
    if (this.state.sortableInstances && this.state.sortableInstances.length > 0) {
      this.state.sortableInstances.forEach(s => {
        try {
          if (s && typeof s.destroy === 'function') s.destroy();
        } catch (e) {}
      });
    }
    this.state.sortableInstances = [];

    const containers = boardContainer.querySelectorAll('.kanban-col-body');
    containers.forEach(container => {
      try {
        const sortable = new Sortable(container, {
          group: 'kanban-cards',
          animation: 150,
          ghostClass: 'opacity-40',
          chosenClass: 'scale-[1.02]',
          dragClass: 'rotate-1',
          onEnd: async (evt) => {
            const itemEl = evt.item;
            const taskId = parseInt(itemEl.getAttribute('data-task-id'), 10);
            const newStatus = evt.to.getAttribute('data-status');
            if (taskId && newStatus) {
              await this.handleTaskMove(taskId, newStatus);
            }
          }
        });
        this.state.sortableInstances.push(sortable);
      } catch (err) {
        console.error('Error initializing sortable on column:', err);
      }
    });

    this.initLucide();
  },

  renderTaskCardHTML(task, members, todayStr) {
    if (!todayStr) todayStr = new Date().toISOString().split('T')[0];
    if (!members) members = this.state.currentProject?.members || [];

    const isDone = task.status === 'done';
    const isOverdue = !isDone && task.due_date && task.due_date < todayStr;
    const assigned = members.find(m => m.id === task.assignee_id);

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

    return `
      <div data-task-id="${task.id}" onclick="app.openTaskModal({id: ${task.id}})"
        class="task-card bg-white dark:bg-slate-800 p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs cursor-pointer select-none space-y-2.5 transition-all duration-200 hover:shadow-md hover:scale-[1.01] ${borderLeftColor} group">
        
        <!-- Card Header: Checkbox + Task ID + Priority -->
        <div class="flex items-center justify-between gap-1.5">
          <div class="flex items-center space-x-2 min-w-0">
            <button onclick="event.stopPropagation(); app.quickToggleTaskDone(${task.id}, '${task.status}')"
              class="w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition ${isDone ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300 dark:border-slate-600 hover:border-blue-500'}"
              title="${isDone ? 'Mark as In Progress' : 'Mark as Done'}">
              ${isDone ? '<i data-lucide="check" class="w-3 h-3"></i>' : ''}
            </button>
            <span class="text-[10px] font-mono text-slate-400 font-bold">#${task.id}</span>
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

  async handleTaskMove(taskId, newStatus) {
    const task = this.state.tasks.find(t => t.id === taskId);
    if (!task) return;
    const prevStatus = task.status;
    if (prevStatus === newStatus) return;

    // Optimistic instant state update
    task.status = newStatus;
    this.renderKanban();

    try {
      await this.api(`/api/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus })
      });
      this.showToast(`Moved to ${newStatus.replace('_', ' ')}`, 'success');
    } catch (e) {
      console.error('Failed to move task:', e);
      task.status = prevStatus;
      this.renderKanban();
      this.showToast('Failed to update task status', 'error');
    }
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

    // 1. Calculate base bounds from project tasks (First activity start to last activity end)
    let taskMin = null;
    let taskMax = null;

    this.state.tasks.forEach(t => {
      if (t.start_date) {
        const s = new Date(t.start_date + 'T00:00:00');
        if (!taskMin || s < taskMin) taskMin = s;
        if (!taskMax || s > taskMax) taskMax = s;
      }
      if (t.due_date) {
        const d = new Date(t.due_date + 'T23:59:59');
        if (!taskMin || d < taskMin) taskMin = d;
        if (!taskMax || d > taskMax) taskMax = d;
      }
    });

    if (!taskMin) {
      taskMin = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
    if (!taskMax || taskMax < taskMin) {
      taskMax = new Date(taskMin.getTime() + (28 * 86400000));
    }

    let timelineMin, timelineMax;
    let topHeaders = [];
    let bottomHeaders = [];
    let totalCols = 0;

    // 2. Build timescale columns based on mode
    if (scale === 'day') {
      // DAILY SCALE
      const baseStart = new Date(taskMin.getFullYear(), taskMin.getMonth(), taskMin.getDate());
      timelineMin = new Date(baseStart.getTime() + (offset * 86400000));
      const daysCount = Math.max(Math.ceil((taskMax.getTime() - baseStart.getTime()) / 86400000) + 1, 7);
      totalCols = daysCount;
      timelineMax = new Date(timelineMin.getTime() + (daysCount * 86400000));

      if (rangeLabel) {
        const startFormatted = timelineMin.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const endFormatted = new Date(timelineMax.getTime() - 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        rangeLabel.textContent = `Daily View • ${startFormatted} to ${endFormatted}`;
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
      // WEEKLY SCALE (Project-Relative: Starts at Week 1 from first activity start date through project end date)
      const dayOfWeek = taskMin.getDay();
      const mondayOffset = (dayOfWeek + 6) % 7; // Align to Monday of first activity's week
      const projectStartMonday = new Date(taskMin.getFullYear(), taskMin.getMonth(), taskMin.getDate() - mondayOffset);
      
      // Total weeks needed to span from projectStartMonday through taskMax
      const totalDays = Math.max(1, Math.ceil((taskMax.getTime() - projectStartMonday.getTime()) / 86400000));
      const totalProjectWeeks = Math.max(1, Math.ceil(totalDays / 7));

      // Apply offset navigation (shifts by 1 week per click)
      timelineMin = new Date(projectStartMonday.getTime() + (offset * 7 * 86400000));
      const weeksCount = totalProjectWeeks;
      totalCols = weeksCount;
      timelineMax = new Date(timelineMin.getTime() + (weeksCount * 7 * 86400000));

      if (rangeLabel) {
        const startFormatted = taskMin.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const endFormatted = taskMax.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        rangeLabel.textContent = `Project Timeline • ${totalProjectWeeks} Week${totalProjectWeeks > 1 ? 's' : ''} (Week 1 to Week ${totalProjectWeeks}) • ${startFormatted} to ${endFormatted}`;
      }

      let curMonth = -1;
      let curMonthSpan = 0;
      let curMonthName = '';

      for (let w = 0; w < weeksCount; w++) {
        const wStart = new Date(timelineMin.getTime() + (w * 7 * 86400000));
        const wEnd = new Date(wStart.getTime() + (6 * 86400000)); // Sunday
        const isCurrentWeek = now >= wStart && now < new Date(wStart.getTime() + (7 * 86400000));
        const projectWeekNum = w + 1 + offset;

        bottomHeaders.push(`
          <div class="flex-1 min-w-[90px] text-center border-r border-slate-100 dark:border-slate-700/60 py-1.5 ${isCurrentWeek ? 'bg-blue-50/80 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 font-bold' : 'text-slate-600 dark:text-slate-300'}">
            <div class="text-[10px] font-extrabold ${isCurrentWeek ? 'text-blue-600 dark:text-blue-400' : 'text-slate-800 dark:text-slate-200'}">Week ${projectWeekNum}</div>
            <div class="text-[9px] text-slate-400 dark:text-slate-400 font-medium">${wStart.getDate()} ${wStart.toLocaleDateString('en-US', { month: 'short' })} - ${wEnd.getDate()} ${wEnd.toLocaleDateString('en-US', { month: 'short' })}</div>
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
      const baseMonth = new Date(taskMin.getFullYear(), taskMin.getMonth() + offset, 1);
      timelineMin = baseMonth;
      
      const totalMonths = Math.max(
        ((taskMax.getFullYear() - taskMin.getFullYear()) * 12) + (taskMax.getMonth() - taskMin.getMonth()) + 1,
        1
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
      const endYear = Math.max(taskMax.getFullYear(), startYear);
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
                <button onclick="event.stopPropagation(); app.openTaskModal({ insert_after_id: ${t.id} })" title="Insert Activity Below" class="opacity-0 group-hover:opacity-100 p-0.5 text-slate-400 hover:text-emerald-500 rounded transition ml-auto flex-shrink-0">
                  <i data-lucide="plus-circle" class="w-3.5 h-3.5 text-emerald-500"></i>
                </button>
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
    return this.inlineUpdateTask(taskId, field, value || null);
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

  setTableStatusFilter(val) {
    this.state.tableStatusFilter = val;
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
      if (this.state.tableStatusFilter && t.status !== this.state.tableStatusFilter) {
        return false;
      }
      if (!q) return true;
      const titleMatch = (t.title || '').toLowerCase().includes(q);
      const descMatch = (t.description || '').toLowerCase().includes(q);
      const tagsMatch = (t.tags || []).some(tag => tag.toLowerCase().includes(q));
      const assignee = members.find(m => m.id === t.assignee_id);
      const assigneeMatch = (assignee && assignee.name.toLowerCase().includes(q)) || (t.assignee_name && t.assignee_name.toLowerCase().includes(q));
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
            <div class="text-sm font-semibold text-slate-600 dark:text-slate-400">No activities match the current filter</div>
            <div class="text-xs text-slate-400 mt-1">Try resetting search or adjusting status filter</div>
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
              
              <div class="flex items-center space-x-1 flex-shrink-0">
                <span class="text-[10px] font-mono text-slate-400 dark:text-slate-500 font-bold">#${(idx + 1).toString().padStart(2, '0')}</span>
                <div class="opacity-0 group-hover:opacity-100 flex flex-col -space-y-1 transition">
                  <button onclick="event.stopPropagation(); app.moveTaskOrder(${t.id}, 'up')" title="Move Up" class="p-0.5 hover:text-blue-600 text-slate-400 ${idx === 0 ? 'invisible pointer-events-none' : ''}">
                    <i data-lucide="chevron-up" class="w-3 h-3"></i>
                  </button>
                  <button onclick="event.stopPropagation(); app.moveTaskOrder(${t.id}, 'down')" title="Move Down" class="p-0.5 hover:text-blue-600 text-slate-400 ${idx === filtered.length - 1 ? 'invisible pointer-events-none' : ''}">
                    <i data-lucide="chevron-down" class="w-3 h-3"></i>
                  </button>
                </div>
              </div>

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
            <div class="relative inline-block w-full max-w-[100px]">
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
              <select onchange="app.handleTableAssigneeChange(${t.id}, this.value)"
                class="w-full text-xs bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500 font-medium truncate">
                <option value="">Unassigned</option>
                ${members.map(m => `<option value="${m.id}" ${t.assignee_id === m.id ? 'selected' : ''}>${this.escapeHtml(m.name)} (${this.escapeHtml(m.role || 'Member')})</option>`).join('')}
                ${(t.assignee_name && !t.assignee_id) ? `<option value="__current__" selected>${this.escapeHtml(t.assignee_name)} (Custom)</option>` : ''}
                <option value="__add_new__" class="font-bold text-blue-600 dark:text-blue-400">+ Type Custom Assignee...</option>
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
              <button onclick="app.openTaskModal({ insert_after_id: ${t.id} })" class="p-1 rounded-md text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition flex items-center space-x-1" title="Insert New Activity Below This">
                <i data-lucide="plus-circle" class="w-3.5 h-3.5 text-emerald-500"></i>
                <span class="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 hidden xl:inline">Insert Below</span>
              </button>
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
    const t = this.state.tasks.find(x => x.id === taskId);
    if (!t) return;

    const previousValue = t[field];
    const prevAssigneeName = t.assignee_name;
    const prevAssigneeAvatar = t.assignee_avatar;

    // 1. Optimistic instant state update
    t[field] = value;
    if (field === 'assignee_id') {
      const member = this.state.currentProject?.members?.find(m => m.id === Number(value));
      t.assignee_name = member ? member.name : null;
      t.assignee_avatar = member ? member.avatar_color : null;
    }

    // 2. Render whatever view the user is currently looking at (0ms latency!)
    this.renderCurrentView();

    // 3. Send update to server in background
    try {
      const payload = { [field]: value };
      const updated = await this.api(`/api/tasks/${taskId}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      
      if (updated) {
        Object.assign(t, updated);
        this.renderCurrentView();
      }
      this.showToast(`Updated ${field.replace('_', ' ')}`, 'success');
    } catch (e) {
      console.error('Failed to update task:', e);
      // Rollback on failure
      t[field] = previousValue;
      t.assignee_name = prevAssigneeName;
      t.assignee_avatar = prevAssigneeAvatar;
      this.renderCurrentView();
      this.showToast(`Failed to update ${field.replace('_', ' ')}`, 'error');
    }
  },

  async handleTableAssigneeChange(taskId, value) {
    if (value === '__current__') return;
    if (value === '__add_new__') {
      const name = prompt('Enter new / custom assignee name for this activity:');
      if (!name || !name.trim()) {
        this.renderTable();
        return;
      }
      const cleanedName = name.trim();
      const t = this.state.tasks.find(x => x.id === taskId);
      if (t) {
        t.assignee_name = cleanedName;
        t.assignee_avatar = '#3B82F6';
        this.renderCurrentView();
      }
      try {
        const updated = await this.api(`/api/tasks/${taskId}`, {
          method: 'PUT',
          body: JSON.stringify({ assignee_name: cleanedName })
        });
        if (updated) {
          const idx = this.state.tasks.findIndex(x => x.id === taskId);
          if (idx !== -1) this.state.tasks[idx] = updated;
          if (this.state.currentProject && updated.assignee_id) {
            if (!this.state.currentProject.members.some(m => m.id === updated.assignee_id)) {
              this.state.currentProject.members.push({
                id: updated.assignee_id,
                name: updated.assignee_name,
                role: 'Member',
                avatar_color: updated.assignee_avatar || '#3B82F6'
              });
            }
          }
          this.syncCurrentProjectCache();
          this.renderCurrentView();
        }
        this.showToast(`Assigned to "${cleanedName}"`, 'success');
      } catch (e) {
        console.error('Failed to assign new member:', e);
        this.showToast('Failed to assign member', 'error');
        this.fetchTasks();
      }
    } else {
      this.inlineUpdateTask(taskId, 'assignee_id', value ? Number(value) : null);
    }
  },

  async inlineDeleteTask(taskId) {
    if (!confirm('Are you sure you want to delete this activity?')) return;
    const numId = Number(taskId);
    const deletedTask = this.state.tasks.find(t => t.id === numId);
    const prevTasks = [...this.state.tasks];

    // 1. Optimistic UI update (0ms instant response)
    this.state.tasks = this.state.tasks.filter(t => t.id !== numId);
    const curProj = this.state.projects.find(p => p.id === this.state.currentProjectId);
    if (curProj && curProj.total_tasks > 0) {
      curProj.total_tasks--;
      if (deletedTask?.status === 'done' && curProj.completed_tasks > 0) curProj.completed_tasks--;
    }
    this.renderProjectsSidebar();
    this.renderCurrentView();
    this.syncCurrentProjectCache();
    this.showToast('Activity deleted', 'success');

    // 2. Background server deletion
    try {
      await this.api(`/api/tasks/${numId}`, { method: 'DELETE' });
    } catch (e) {
      console.error('Failed to delete activity on server:', e);
      this.state.tasks = prevTasks;
      if (curProj) curProj.total_tasks = (curProj.total_tasks || 0) + 1;
      this.renderProjectsSidebar();
      this.renderCurrentView();
      this.showToast('Failed to delete activity on server', 'error');
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
      this.renderCalendarWeek(container, tasks, members);
    } else if (this.state.calendarMode === 'agenda') {
      this.renderCalendarAgenda(container, tasks, members);
    } else {
      this.renderCalendarMonth(container, tasks, members);
    }

    // 3. Render Day Inspector if day is selected
    this.renderCalendarDayInspector(members);
    this.initLucide();
  },

  renderCalendarMonth(container, tasks, members) {
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

  renderCalendarWeek(container, tasks, members) {
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

  renderCalendarAgenda(container, tasks, members) {
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

  renderCalendarDayInspector(members) {
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

  // ==================== ANALYTICS DASHBOARD ====================
  async handleAnalyticsProjectChange(projectId) {
    if (!projectId) return;
    await this.selectProject(Number(projectId));
    if (this.state.activeView === 'analytics') {
      this.renderAnalytics();
    }
  },

  async renderAnalytics() {
    if (!this.state.currentProjectId && this.state.projects?.length > 0) {
      this.state.currentProjectId = this.state.projects[0].id;
    }
    if (!this.state.currentProjectId) return;
    const targetPid = Number(this.state.currentProjectId);

    try {
      // 1. Populate Analytics Project Selector
      const pSelect = document.getElementById('analytics-project-select');
      if (pSelect && this.state.projects?.length > 0) {
        pSelect.innerHTML = this.state.projects.map(p => `
          <option value="${p.id}" ${Number(p.id) === targetPid ? 'selected' : ''}>
            ${this.escapeHtml(p.name)} (${p.task_count || 0} tasks)
          </option>
        `).join('');
      }

      // 2. Fetch Analytics Data
      const url = `/api/projects/${targetPid}/analytics`;
      const data = await this.api(url);
      if (Number(this.state.currentProjectId) !== targetPid) return;
      if (!data || data.error) {
        console.warn('Analytics data not available:', data?.error);
        return;
      }

      const kpis = data.kpis || {};
      
      const elTotal = document.getElementById('kpi-total-tasks');
      const elInProg = document.getElementById('kpi-inprogress-tasks');
      const elDone = document.getElementById('kpi-done-tasks');
      const elRate = document.getElementById('kpi-completion-rate');
      const elOver = document.getElementById('kpi-overdue-tasks');
      const elHrs = document.getElementById('kpi-total-hours');

      if (elTotal) elTotal.textContent = kpis.total_tasks || 0;
      if (elInProg) elInProg.textContent = kpis.in_progress_tasks || 0;
      if (elDone) elDone.textContent = kpis.done_tasks || 0;
      if (elRate) elRate.textContent = `${kpis.completion_rate || 0}%`;
      if (elOver) elOver.textContent = kpis.overdue_tasks || 0;
      if (elHrs) elHrs.textContent = `${(kpis.total_act_hours || 0).toFixed(1)}h`;

      const subtitle = document.getElementById('burndown-project-title');
      if (subtitle) subtitle.textContent = 'Project Lifecycle';

      // 3. Render Charts with Safe Wrappers
      try {
        this.renderBurndownChart(data.burndown);
      } catch (err) {
        console.error('Error rendering burndown chart:', err);
      }

      try {
        this.renderPriorityChart(data.priority_distribution);
      } catch (err) {
        console.error('Error rendering priority chart:', err);
      }

      try {
        this.renderWorkloadChart(data.workload);
      } catch (err) {
        console.error('Error rendering workload chart:', err);
      }

      // 4. Render Activity Stream
      try {
        const activities = await this.api(`/api/projects/${targetPid}/activity`);
        if (Number(this.state.currentProjectId) !== targetPid) return;
        const actContainer = document.getElementById('activity-stream-render');
        if (actContainer) {
          if (!activities || activities.length === 0) {
            actContainer.innerHTML = `<div class="text-slate-400 p-2">No activity recorded yet for this project.</div>`;
          } else {
            actContainer.innerHTML = activities.slice(0, 15).map(a => `
              <div class="flex items-start space-x-2.5 pb-2 border-b border-slate-100 dark:border-slate-700/60">
                <div class="w-6 h-6 rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300 flex items-center justify-center font-bold text-[10px] flex-shrink-0 mt-0.5">
                  ${((a && a.user_name) || 'U').charAt(0).toUpperCase()}
                </div>
                <div class="flex-1 min-w-0">
                  <div class="font-semibold text-slate-800 dark:text-white truncate">${this.escapeHtml(a.user_name || 'User')}: <span class="font-normal text-slate-500">${this.escapeHtml(a.details || a.action || '')}</span></div>
                  <div class="text-[10px] text-slate-400">${new Date(a.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              </div>
            `).join('');
          }
        }
      } catch (err) {
        console.error('Error rendering activity stream:', err);
      }

    } catch (e) {
      console.error('Error loading analytics:', e);
    }
  },

  renderBurndownChart(burndown) {
    const ctx = document.getElementById('burndownChart');
    if (!ctx) return;
    if (typeof Chart === 'undefined') {
      ctx.parentElement.innerHTML = `<div class="p-4 text-xs text-slate-400 text-center">Chart library loading...</div>`;
      return;
    }
    if (this.state.charts.burndown) this.state.charts.burndown.destroy();

    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? '#334155' : '#e2e8f0';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    const labels = (burndown?.labels && burndown.labels.length > 0) ? burndown.labels : ['Kickoff', 'Procurement', 'Synthesis', 'QC Analysis', 'Release'];
    const ideal = (burndown?.ideal && burndown.ideal.length > 0) ? burndown.ideal : [100, 75, 50, 25, 0];
    const actual = (burndown?.actual && burndown.actual.length > 0) ? burndown.actual : [100, 85, 55, 30, 10];

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
    if (typeof Chart === 'undefined') return;
    if (this.state.charts.priority) this.state.charts.priority.destroy();

    const counts = { urgent: 0, high: 0, medium: 0, low: 0 };
    if (Array.isArray(priorityCounts)) {
      priorityCounts.forEach(p => { 
        if (p && counts[p.priority] !== undefined) counts[p.priority] = p.count || 0; 
      });
    }

    const totalPriority = counts.urgent + counts.high + counts.medium + counts.low;
    const dataVals = totalPriority > 0 ? [counts.urgent, counts.high, counts.medium, counts.low] : [0, 0, 1, 0];

    this.state.charts.priority = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Urgent', 'High', 'Medium', 'Low'],
        datasets: [{
          data: dataVals,
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
    if (typeof Chart === 'undefined') return;
    if (this.state.charts.workload) this.state.charts.workload.destroy();

    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? '#334155' : '#e2e8f0';
    const textColor = isDark ? '#94a3b8' : '#64748b';

    const safeList = Array.isArray(workload) ? workload : [];
    const names = safeList.map(w => (w && w.name ? String(w.name).split(' ')[0] : 'Member'));
    const est = safeList.map(w => (w ? parseFloat(w.total_est_hours) || 0 : 0));
    const act = safeList.map(w => (w ? parseFloat(w.total_act_hours) || 0 : 0));

    this.state.charts.workload = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: names.length > 0 ? names : ['Unassigned'],
        datasets: [
          { label: 'Assigned Est. Hours', data: est.length > 0 ? est : [0], backgroundColor: '#3b82f6', borderRadius: 4 },
          { label: 'Actual Logged Hours', data: act.length > 0 ? act : [0], backgroundColor: '#10b981', borderRadius: 4 }
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

  // ==================== TASK MODAL CRUD & SEQUENCING ====================
  async moveTaskOrder(taskId, direction) {
    const allTasks = [...(this.state.tasks || [])].sort((a, b) => {
      const orderA = a.order_index !== undefined && a.order_index !== null ? Number(a.order_index) : a.id;
      const orderB = b.order_index !== undefined && b.order_index !== null ? Number(b.order_index) : b.id;
      if (orderA !== orderB) return orderA - orderB;
      return a.id - b.id;
    });

    const idx = allTasks.findIndex(t => t.id === taskId);
    if (idx === -1) return;
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= allTasks.length) return;

    // Optimistic swap
    const currentTask = allTasks[idx];
    const targetTask = allTasks[targetIdx];
    const tempOrder = currentTask.order_index;
    currentTask.order_index = targetTask.order_index;
    targetTask.order_index = tempOrder;

    this.renderCurrentView();

    try {
      const res = await this.api(`/api/tasks/${taskId}/move`, {
        method: 'POST',
        body: JSON.stringify({ direction })
      });
      if (res && res.tasks) {
        this.state.tasks = res.tasks;
        this.syncCurrentProjectCache();
        this.renderCurrentView();
      }
    } catch (e) {
      console.error('Failed to move task order:', e);
      this.fetchTasks();
    }
  },

  async openTaskModal(params = {}) {
    const modal = document.getElementById('task-modal');
    if (!modal) return;

    this.populateTaskModalDropdowns();

    const idInput = document.getElementById('task-input-id');
    const titleInput = document.getElementById('task-input-title');
    const descInput = document.getElementById('task-input-description');
    const statusSelect = document.getElementById('task-input-status');
    const prioritySelect = document.getElementById('task-input-priority');
    const assigneeSelect = document.getElementById('task-input-assignee');
    const manualAssigneeInput = document.getElementById('task-input-assignee-manual');
    const startInput = document.getElementById('task-input-startdate');
    const dueInput = document.getElementById('task-input-duedate');
    const estInput = document.getElementById('task-input-esthours');
    const actInput = document.getElementById('task-input-acthours');
    const tagsInput = document.getElementById('task-input-tags');
    const delBtn = document.getElementById('task-delete-btn');
    const posWrapper = document.getElementById('task-position-wrapper');
    const posSelect = document.getElementById('task-input-position');

    document.getElementById('subtasks-container').innerHTML = '';
    document.getElementById('new-subtask-input').value = '';

    // Reset manual assignee mode
    this.toggleTaskAssigneeManualMode(false);
    if (manualAssigneeInput) manualAssigneeInput.value = '';

    const sortedTasks = [...(this.state.tasks || [])].sort((a, b) => {
      const orderA = a.order_index !== undefined && a.order_index !== null ? Number(a.order_index) : a.id;
      const orderB = b.order_index !== undefined && b.order_index !== null ? Number(b.order_index) : b.id;
      if (orderA !== orderB) return orderA - orderB;
      return a.id - b.id;
    });

    if (posSelect) {
      posSelect.innerHTML = `
        <option value="end">At the end of the project (default)</option>
        <option value="start">At the very beginning (Before #01)</option>
        ${sortedTasks.map((t, i) => `
          <option value="after_${t.id}">After #${(i + 1).toString().padStart(2, '0')}: ${this.escapeHtml(t.title)}</option>
        `).join('')}
      `;
    }

    if (params.id) {
      document.getElementById('task-modal-title').textContent = 'Edit Task Details';
      document.getElementById('task-modal-type-badge').textContent = 'Task #' + params.id;
      if (delBtn) delBtn.classList.remove('hidden');
      if (posWrapper) posWrapper.classList.add('hidden');

      // 1. Instantly populate modal from local state cache (0ms latency!)
      const localTask = this.state.tasks.find(t => t.id === Number(params.id));
      if (localTask) {
        idInput.value = localTask.id;
        titleInput.value = localTask.title || '';
        descInput.value = localTask.description || '';
        statusSelect.value = localTask.status || 'todo';
        prioritySelect.value = localTask.priority || 'medium';
        
        // Handle Assignee matching
        const matchedMember = localTask.assignee_id ? this.state.currentProject?.members?.find(m => m.id === localTask.assignee_id) : null;
        if (matchedMember) {
          if (assigneeSelect) assigneeSelect.value = String(matchedMember.id);
        } else if (localTask.assignee_name) {
          if (manualAssigneeInput) manualAssigneeInput.value = localTask.assignee_name;
          this.toggleTaskAssigneeManualMode(true);
        } else {
          if (assigneeSelect) assigneeSelect.value = '';
        }

        startInput.value = localTask.start_date || '';
        dueInput.value = localTask.due_date || '';
        estInput.value = localTask.estimated_hours || 0;
        if (actInput) actInput.value = localTask.actual_hours || 0;
        tagsInput.value = (localTask.tags || []).join(', ');
        this.renderSubtaskList(localTask.subtasks_list || localTask.subtasks || []);
      }

      this.updateTaskModalDateBadges();
      modal.classList.remove('hidden');
      titleInput.focus();
      this.initLucide();

      // 2. Fetch fresh subtasks & timelogs in background without blocking UI
      try {
        const task = await this.api(`/api/tasks/${params.id}`);
        if (task && idInput.value == task.id) {
          idInput.value = task.id;
          titleInput.value = task.title || '';
          descInput.value = task.description || '';
          statusSelect.value = task.status || 'todo';
          prioritySelect.value = task.priority || 'medium';
          
          const matchedMember = task.assignee_id ? this.state.currentProject?.members?.find(m => m.id === task.assignee_id) : null;
          if (matchedMember) {
            if (assigneeSelect) assigneeSelect.value = String(matchedMember.id);
          } else if (task.assignee_name) {
            if (manualAssigneeInput) manualAssigneeInput.value = task.assignee_name;
            this.toggleTaskAssigneeManualMode(true);
          } else {
            if (assigneeSelect) assigneeSelect.value = '';
          }

          startInput.value = task.start_date || '';
          dueInput.value = task.due_date || '';
          estInput.value = task.estimated_hours || 0;
          if (actInput) actInput.value = task.actual_hours || 0;
          tagsInput.value = (task.tags || []).join(', ');
          this.renderSubtaskList(task.subtasks || []);
          this.updateTaskModalDateBadges();
        }
      } catch (e) {
        console.error('Failed to load subtask details for modal:', e);
      }
      return;
    } else {
      document.getElementById('task-modal-title').textContent = 'Create New Task';
      document.getElementById('task-modal-type-badge').textContent = 'New Task';
      if (delBtn) delBtn.classList.add('hidden');
      if (posWrapper) posWrapper.classList.remove('hidden');

      idInput.value = '';
      titleInput.value = '';
      descInput.value = '';
      statusSelect.value = params.status || 'todo';
      prioritySelect.value = 'medium';
      
      if (params.assignee_name) {
        if (manualAssigneeInput) manualAssigneeInput.value = params.assignee_name;
        this.toggleTaskAssigneeManualMode(true);
      } else if (assigneeSelect) {
        assigneeSelect.value = params.assignee_id ? String(params.assignee_id) : '';
      }
      
      startInput.value = params.start_date || '';
      dueInput.value = params.due_date || '';
      estInput.value = '4.0';
      if (actInput) actInput.value = '0.0';
      tagsInput.value = '';

      if (params.insert_after_id && posSelect) {
        posSelect.value = `after_${params.insert_after_id}`;
        const pred = sortedTasks.find(t => t.id === Number(params.insert_after_id));
        if (pred) {
          if (pred.due_date && !params.start_date) {
            startInput.value = pred.due_date;
          }
        }
      } else if (params.position && posSelect) {
        posSelect.value = params.position;
      }
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
    const assigneeSelect = document.getElementById('task-input-assignee');
    const membersDatalist = document.getElementById('project-members-datalist');

    if (assigneeSelect && p) {
      assigneeSelect.innerHTML = `<option value="">Unassigned</option>` +
        (p.members || []).map(m => `<option value="${m.id}">${this.escapeHtml(m.name)} (${m.role})</option>`).join('') +
        `<option value="__manual__" class="font-bold text-blue-600 dark:text-blue-400">+ Type New / Custom Assignee Name...</option>`;
    }

    if (membersDatalist && p) {
      membersDatalist.innerHTML = (p.members || []).map(m => `<option value="${this.escapeHtml(m.name)}">`).join('');
    }
  },

  toggleTaskAssigneeManualMode(forceMode = null) {
    const selectCont = document.getElementById('task-assignee-select-container');
    const manualCont = document.getElementById('task-assignee-manual-container');
    const toggleLabel = document.getElementById('task-assignee-toggle-label');
    const manualInput = document.getElementById('task-input-assignee-manual');
    const selectEl = document.getElementById('task-input-assignee');

    const isCurrentlyManual = !manualCont?.classList.contains('hidden');
    const willBeManual = forceMode !== null ? forceMode : !isCurrentlyManual;

    if (willBeManual) {
      selectCont?.classList.add('hidden');
      manualCont?.classList.remove('hidden');
      if (toggleLabel) toggleLabel.textContent = 'Choose List';
      if (manualInput) {
        if (selectEl && selectEl.value && selectEl.value !== '__manual__') {
          const m = this.state.currentProject?.members?.find(x => String(x.id) === String(selectEl.value));
          if (m && !manualInput.value) manualInput.value = m.name;
        }
        manualInput.focus();
      }
    } else {
      manualCont?.classList.add('hidden');
      selectCont?.classList.remove('hidden');
      if (toggleLabel) toggleLabel.textContent = '+ Custom Name';
      if (selectEl && selectEl.value === '__manual__') {
        selectEl.value = '';
      }
    }
  },

  handleTaskAssigneeSelectChange(value) {
    if (value === '__manual__') {
      this.toggleTaskAssigneeManualMode(true);
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
    const desc = document.getElementById('task-input-description')?.value || '';
    const status = document.getElementById('task-input-status')?.value || 'todo';
    const priority = document.getElementById('task-input-priority')?.value || 'medium';

    // Assignee resolution (handles both select dropdown and manual custom text input)
    const isManualAssignee = !document.getElementById('task-assignee-manual-container')?.classList.contains('hidden');
    const manualAssigneeName = document.getElementById('task-input-assignee-manual')?.value.trim();
    const selectAssigneeVal = document.getElementById('task-input-assignee')?.value;

    let assigneeId = null;
    let assigneeName = null;
    let assigneeAvatar = null;

    if (isManualAssignee && manualAssigneeName) {
      assigneeName = manualAssigneeName;
      // Check if matches an existing member
      const matched = this.state.currentProject?.members?.find(m => m.name.toLowerCase() === manualAssigneeName.toLowerCase());
      if (matched) {
        assigneeId = matched.id;
        assigneeAvatar = matched.avatar_color;
      } else {
        assigneeId = null;
        assigneeAvatar = '#3B82F6';
      }
    } else if (!isManualAssignee && selectAssigneeVal && selectAssigneeVal !== '__manual__') {
      assigneeId = Number(selectAssigneeVal);
      const matched = this.state.currentProject?.members?.find(m => m.id === assigneeId);
      assigneeName = matched ? matched.name : null;
      assigneeAvatar = matched ? matched.avatar_color : null;
    }

    const startDate = document.getElementById('task-input-startdate')?.value || null;
    const dueDate = document.getElementById('task-input-duedate')?.value || null;
    const estHours = parseFloat(document.getElementById('task-input-esthours')?.value || 0);
    const actHours = parseFloat(document.getElementById('task-input-acthours')?.value || 0);
    const tagsRaw = document.getElementById('task-input-tags')?.value || '';
    const tags = tagsRaw.split(',').map(t => t.trim().replace(/^#/, '')).filter(Boolean);

    const tempSubtasks = Array.from(document.querySelectorAll('.temporary-subtask')).map(el => el.textContent);
    const position = document.getElementById('task-input-position')?.value || 'end';

    const payload = {
      title,
      description: desc,
      status,
      priority,
      position,
      assignee_id: assigneeId,
      assignee_name: (isManualAssignee && manualAssigneeName) ? manualAssigneeName : undefined,
      start_date: startDate,
      due_date: dueDate,
      estimated_hours: estHours,
      actual_hours: actHours,
      tags,
      subtasks: tempSubtasks
    };

    // Close modal immediately (instant 0ms UX)
    this.closeTaskModal();

    if (taskId) {
      // EDIT EXISTING TASK (Optimistic)
      const numId = Number(taskId);
      const localTask = this.state.tasks.find(t => t.id === numId);
      const prevCopy = localTask ? { ...localTask } : null;
      if (localTask) {
        Object.assign(localTask, {
          title,
          description: desc,
          status,
          priority,
          assignee_id: assigneeId,
          assignee_name: assigneeName,
          assignee_avatar: assigneeAvatar,
          start_date: startDate,
          due_date: dueDate,
          estimated_hours: estHours,
          actual_hours: actHours,
          tags
        });
        this.renderCurrentView();
        this.syncCurrentProjectCache();
      }
      this.showToast('Task updated successfully', 'success');

      try {
        const updated = await this.api(`/api/tasks/${taskId}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
        if (localTask && updated) {
          Object.assign(localTask, updated);
          if (this.state.currentProject && updated.assignee_id && updated.assignee_name) {
            if (!this.state.currentProject.members.some(m => m.id === updated.assignee_id)) {
              this.state.currentProject.members.push({
                id: updated.assignee_id,
                name: updated.assignee_name,
                role: 'Member',
                avatar_color: updated.assignee_avatar || '#3B82F6'
              });
            }
          }
          this.syncCurrentProjectCache();
          this.renderCurrentView();
        }
      } catch (e) {
        console.error('Failed to update task:', e);
        if (localTask && prevCopy) {
          Object.assign(localTask, prevCopy);
          this.renderCurrentView();
        }
        this.showToast('Failed to save task update on server', 'error');
      }
    } else {
      // CREATE NEW TASK (Optimistic 0ms UI insertion)
      const tempId = -Date.now();
      const optimisticTask = {
        id: tempId,
        project_id: this.state.currentProjectId,
        title,
        description: desc,
        status: status,
        priority: priority,
        assignee_id: assigneeId,
        assignee_name: assigneeName,
        assignee_avatar: assigneeAvatar,
        start_date: startDate,
        due_date: dueDate,
        estimated_hours: estHours,
        actual_hours: actHours,
        tags,
        subtask_count: tempSubtasks.length,
        subtask_completed_count: 0,
        subtasks_list: tempSubtasks.map((st, i) => ({ id: i + 1, task_id: tempId, title: st, completed: 0, order_index: i })),
        logged_hours_sum: 0,
        order_index: 999999,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Position logic
      if (position === 'start') {
        this.state.tasks.unshift(optimisticTask);
      } else if (position.startsWith('after_')) {
        const afterId = Number(position.split('_')[1]);
        const idx = this.state.tasks.findIndex(t => t.id === afterId);
        if (idx !== -1) {
          this.state.tasks.splice(idx + 1, 0, optimisticTask);
        } else {
          this.state.tasks.push(optimisticTask);
        }
      } else if (position.startsWith('before_')) {
        const beforeId = Number(position.split('_')[1]);
        const idx = this.state.tasks.findIndex(t => t.id === beforeId);
        if (idx !== -1) {
          this.state.tasks.splice(idx, 0, optimisticTask);
        } else {
          this.state.tasks.push(optimisticTask);
        }
      } else {
        this.state.tasks.push(optimisticTask);
      }

      // Re-index order_index locally
      this.state.tasks.forEach((t, i) => { t.order_index = i; });

      // Update project counts
      const curProj = this.state.projects.find(p => p.id === this.state.currentProjectId);
      if (curProj) curProj.total_tasks = (curProj.total_tasks || 0) + 1;

      this.renderProjectsSidebar();
      this.renderCurrentView();
      this.syncCurrentProjectCache();
      this.showToast('Activity created successfully', 'success');

      try {
        const created = await this.api(`/api/projects/${this.state.currentProjectId}/tasks`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (created) {
          const idx = this.state.tasks.findIndex(t => t.id === tempId);
          if (idx !== -1) {
            this.state.tasks[idx] = created;
          }
          if (this.state.currentProject && created.assignee_id && created.assignee_name) {
            if (!this.state.currentProject.members.some(m => m.id === created.assignee_id)) {
              this.state.currentProject.members.push({
                id: created.assignee_id,
                name: created.assignee_name,
                role: 'Member',
                avatar_color: created.assignee_avatar || '#3B82F6'
              });
            }
          }
          this.syncCurrentProjectCache();
          this.renderCurrentView();
        }
      } catch (e) {
        console.error('Failed to create task on server:', e);
        this.state.tasks = this.state.tasks.filter(t => t.id !== tempId);
        if (curProj && curProj.total_tasks > 0) curProj.total_tasks--;
        this.renderProjectsSidebar();
        this.renderCurrentView();
        this.showToast('Failed to create task on server', 'error');
      }
    }
  },

  async handleDeleteTask() {
    const taskId = document.getElementById('task-input-id')?.value;
    if (!taskId) return;
    if (!confirm('Are you sure you want to delete this task?')) return;

    const numId = Number(taskId);
    const deletedTask = this.state.tasks.find(t => t.id === numId);
    const prevTasks = [...this.state.tasks];

    // Optimistic UI update (0ms instant response)
    this.closeTaskModal();
    this.state.tasks = this.state.tasks.filter(t => t.id !== numId);
    const curProj = this.state.projects.find(p => p.id === this.state.currentProjectId);
    if (curProj && curProj.total_tasks > 0) {
      curProj.total_tasks--;
      if (deletedTask?.status === 'done' && curProj.completed_tasks > 0) curProj.completed_tasks--;
    }
    this.renderProjectsSidebar();
    this.renderCurrentView();
    this.syncCurrentProjectCache();
    this.showToast('Task deleted', 'success');

    try {
      await this.api(`/api/tasks/${numId}`, { method: 'DELETE' });
    } catch (e) {
      console.error('Failed to delete task on server:', e);
      this.state.tasks = prevTasks;
      if (curProj) curProj.total_tasks = (curProj.total_tasks || 0) + 1;
      this.renderProjectsSidebar();
      this.renderCurrentView();
      this.showToast('Failed to delete task on server', 'error');
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
    const description = document.getElementById('project-input-description')?.value || '';
    const color = document.getElementById('project-input-color')?.value || '#3B82F6';

    this.closeProjectModal();

    if (id) {
      // Edit existing project (Optimistic)
      const numId = Number(id);
      const proj = this.state.projects.find(p => p.id === numId);
      if (proj) {
        proj.name = name;
        proj.description = description;
        proj.color = color;
      }
      if (this.state.currentProject && this.state.currentProject.id === numId) {
        this.state.currentProject.name = name;
        this.state.currentProject.description = description;
        this.state.currentProject.color = color;
      }
      this.renderProjectsDropdown();
      this.renderProjectsSidebar();
      this.showToast('Project updated successfully', 'success');

      try {
        await this.api(`/api/projects/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ name, description, color })
        });
      } catch (e) {
        console.error('Failed to update project on server:', e);
        this.showToast('Failed to update project settings', 'error');
      }
    } else {
      // Create new project (Instant UI Switch & fast backend call)
      try {
        const project = await this.api('/api/projects', {
          method: 'POST',
          body: JSON.stringify({ name, description, color })
        });

        // Add to projects list
        this.state.projects.unshift(project);
        localStorage.setItem('projectpulse_cached_projects', JSON.stringify(this.state.projects));

        // Switch to the newly created project immediately (0 extra roundtrips!)
        this.state.currentProjectId = project.id;
        this.state.currentProject = project;
        this.state.tasks = [];
        localStorage.setItem('projectpulse_active_project', project.id);
        this.syncCurrentProjectCache();

        this.renderProjectsDropdown();
        this.renderProjectsSidebar();
        this.populateFilterDropdowns();
        this.renderCurrentView();

        this.showToast('Project created successfully', 'success');
      } catch (e) {
        console.error('Failed to create project:', e);
        this.showToast('Failed to create project', 'error');
      }
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
      if (!confirm(`Are you sure you want to permanently delete the project "${name}"?\n\nAll tasks, members, and records in this project will be deleted.`)) {
        return;
      }
    }

    // 1. Optimistic UI update (0ms instant response)
    const remainingProjects = this.state.projects.filter(p => p.id !== projectId);
    this.state.projects = remainingProjects;
    localStorage.setItem('projectpulse_cached_projects', JSON.stringify(remainingProjects));
    localStorage.removeItem(`projectpulse_cached_project_${projectId}`);
    localStorage.removeItem(`projectpulse_cached_tasks_${projectId}`);

    if (this.state.currentProjectId === projectId) {
      if (remainingProjects.length > 0) {
        this.state.currentProjectId = remainingProjects[0].id;
        this.state.currentProject = remainingProjects[0];
        localStorage.setItem('projectpulse_active_project', remainingProjects[0].id);
      } else {
        this.state.currentProjectId = null;
        this.state.currentProject = null;
        this.state.tasks = [];
        localStorage.removeItem('projectpulse_active_project');
      }
    }

    this.renderProjectsDropdown();
    this.renderProjectsSidebar();
    this.closeProjectModal();
    this.showToast(`Project "${name}" deleted`, 'success');

    if (this.state.currentProjectId) {
      this.selectProject(this.state.currentProjectId);
    } else {
      this.renderCurrentView();
    }

    // 2. Background server deletion
    try {
      await this.api(`/api/projects/${projectId}`, { method: 'DELETE' });
    } catch (e) {
      console.error('Failed to delete project on server:', e);
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
    const headers = {};
    if (this.state.authToken) {
      headers['Authorization'] = `Bearer ${this.state.authToken}`;
    }

    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: formData
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload Gantt file');
      }

      this.showToast(data.message || `Successfully imported ${data.tasks_imported} tasks!`, 'success');
      this.closeGanttUploadModal();

      if (data.projects && Array.isArray(data.projects)) {
        this.state.projects = data.projects;
        localStorage.setItem('projectpulse_cached_projects', JSON.stringify(data.projects));
      }
      if (data.current_project) {
        this.state.currentProject = data.current_project;
        this.state.currentProjectId = data.current_project.id;
        localStorage.setItem('projectpulse_active_project', data.current_project.id);
        localStorage.setItem(`projectpulse_cached_project_${data.current_project.id}`, JSON.stringify(data.current_project));
      }
      if (data.tasks && Array.isArray(data.tasks)) {
        this.state.tasks = data.tasks;
        if (this.state.currentProjectId) {
          localStorage.setItem(`projectpulse_cached_tasks_${this.state.currentProjectId}`, JSON.stringify(data.tasks));
        }
      }

      this.renderProjectsDropdown();
      this.renderProjectsSidebar();
      this.populateFilterDropdowns();
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
        this.showToast('Project imported successfully', 'success');

        if (res.projects && Array.isArray(res.projects)) {
          this.state.projects = res.projects;
          localStorage.setItem('projectpulse_cached_projects', JSON.stringify(res.projects));
        }
        if (res.current_project) {
          this.state.currentProject = res.current_project;
          this.state.currentProjectId = res.current_project.id;
          localStorage.setItem('projectpulse_active_project', res.current_project.id);
          localStorage.setItem(`projectpulse_cached_project_${res.current_project.id}`, JSON.stringify(res.current_project));
        }
        if (res.tasks && Array.isArray(res.tasks)) {
          this.state.tasks = res.tasks;
          if (this.state.currentProjectId) {
            localStorage.setItem(`projectpulse_cached_tasks_${this.state.currentProjectId}`, JSON.stringify(res.tasks));
          }
        }

        this.renderProjectsDropdown();
        this.renderProjectsSidebar();
        this.populateFilterDropdowns();
        this.renderCurrentView();
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
    // 1. Instantly display modal (0ms perceived latency)
    const modal = document.getElementById('notifications-modal');
    if (modal) modal.classList.remove('hidden');
    this.switchNotifTab('settings');
    this.initLucide();

    // 2. Fetch settings and logs concurrently in background
    try {
      this.renderNotificationMembers();
      const [settings] = await Promise.all([
        this.api('/api/notifications/settings'),
        this.loadNotificationLogs()
      ]);
      if (settings) {
        this.populateNotificationSettings(settings);
      }
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

  // ==================== AUTHENTICATION & LOGIN SCREEN ====================
  async checkAuth() {
    const token = this.state.authToken || localStorage.getItem('projectpulse_token');
    if (!token) {
      this.state.user = null;
      this.state.authToken = null;
      localStorage.removeItem('projectpulse_user');
      this.showAuthContainer();
      return false;
    }

    this.state.authToken = token;
    const activeProjectId = this.state.currentProjectId || localStorage.getItem('projectpulse_active_project') || '';

    try {
      const res = await fetch(`/api/auth/me?active_project_id=${encodeURIComponent(activeProjectId)}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (res.ok) {
        const data = await res.json();
        if (data && data.authenticated && data.user) {
          this.state.user = data.user;
          localStorage.setItem('projectpulse_user', JSON.stringify(data.user));
          this.updateHeaderUserProfile();
          this.hideAuthContainer();

          if (data.projects && Array.isArray(data.projects) && data.projects.length > 0) {
            this.state.projects = data.projects;
            localStorage.setItem('projectpulse_cached_projects', JSON.stringify(data.projects));
            this.renderProjectsDropdown();
            this.renderProjectsSidebar();
          }

          if (data.current_project) {
            this.state.currentProject = data.current_project;
            this.state.currentProjectId = data.current_project.id;
            localStorage.setItem('projectpulse_active_project', data.current_project.id);
            localStorage.setItem(`projectpulse_cached_project_${data.current_project.id}`, JSON.stringify(data.current_project));
            this.populateFilterDropdowns();
          }

          if (data.tasks && Array.isArray(data.tasks)) {
            this.state.tasks = data.tasks;
            if (this.state.currentProjectId) {
              localStorage.setItem(`projectpulse_cached_tasks_${this.state.currentProjectId}`, JSON.stringify(data.tasks));
            }
            this.renderCurrentView();
          }

          return true;
        }
      }
    } catch (e) {
      console.error('Auth check error:', e);
      if (this.state.user) return true;
    }

    this.state.user = null;
    this.state.authToken = null;
    localStorage.removeItem('projectpulse_token');
    localStorage.removeItem('projectpulse_user');
    this.showAuthContainer();
    return false;
  },

  showAuthContainer() {
    const container = document.getElementById('auth-container');
    if (container) {
      container.classList.remove('hidden');
      document.getElementById('login-input-identifier')?.focus();
    }
  },

  hideAuthContainer() {
    const container = document.getElementById('auth-container');
    if (container) {
      container.classList.add('hidden');
    }
    this.hideAuthError();
  },

  switchAuthTab(tab = 'login') {
    const loginTab = document.getElementById('auth-tab-login');
    const registerTab = document.getElementById('auth-tab-register');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    const demoBar = document.getElementById('auth-demo-bar');
    this.hideAuthError();

    if (tab === 'login') {
      loginTab?.classList.add('bg-blue-600', 'text-white', 'shadow-xs');
      loginTab?.classList.remove('text-slate-400');
      registerTab?.classList.remove('bg-blue-600', 'text-white', 'shadow-xs');
      registerTab?.classList.add('text-slate-400');

      loginForm?.classList.remove('hidden');
      registerForm?.classList.add('hidden');
      demoBar?.classList.remove('hidden');
      document.getElementById('login-input-identifier')?.focus();
    } else {
      registerTab?.classList.add('bg-blue-600', 'text-white', 'shadow-xs');
      registerTab?.classList.remove('text-slate-400');
      loginTab?.classList.remove('bg-blue-600', 'text-white', 'shadow-xs');
      loginTab?.classList.add('text-slate-400');

      registerForm?.classList.remove('hidden');
      loginForm?.classList.add('hidden');
      demoBar?.classList.add('hidden');
      document.getElementById('register-input-fullname')?.focus();
    }
    this.initLucide();
  },

  fillDemoCredentials(role = 'admin') {
    const idInput = document.getElementById('login-input-identifier');
    const pwdInput = document.getElementById('login-input-password');
    if (!idInput || !pwdInput) return;

    if (role === 'admin') {
      idInput.value = 'admin';
      pwdInput.value = 'admin123';
    } else if (role === 'pm') {
      idInput.value = 'pm';
      pwdInput.value = 'pm123';
    } else if (role === 'lead') {
      idInput.value = 'lead';
      pwdInput.value = 'lead123';
    } else if (role === 'assignee' || role === 'asignee' || role === 'member') {
      idInput.value = 'assignee';
      pwdInput.value = 'assignee123';
    }

    this.hideAuthError();
  },

  async quickDemoLogin(role = 'admin') {
    this.fillDemoCredentials(role);
    await this.handleLoginFormSubmit();
  },

  togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    if (btn) {
      btn.innerHTML = isPassword ? '<i data-lucide="eye-off" class="w-4 h-4"></i>' : '<i data-lucide="eye" class="w-4 h-4"></i>';
      this.initLucide();
    }
  },

  showAuthError(message) {
    const box = document.getElementById('auth-error-alert');
    const text = document.getElementById('auth-error-text');
    if (box && text) {
      text.textContent = message || 'Invalid username or password';
      box.classList.remove('hidden');
    }
  },

  hideAuthError() {
    const box = document.getElementById('auth-error-alert');
    if (box) box.classList.add('hidden');
  },

  async handleLoginFormSubmit(e) {
    if (e) e.preventDefault();
    const identifier = document.getElementById('login-input-identifier')?.value.trim();
    const password = document.getElementById('login-input-password')?.value;
    const remember = document.getElementById('login-input-remember')?.checked;

    if (!identifier || !password) {
      this.showAuthError('Please enter your username and password');
      return;
    }

    const submitBtn = document.getElementById('login-submit-btn');
    const originalText = submitBtn?.innerHTML;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Entering Workspace...</span>';
      this.initLucide();
    }

    const savedProjectId = localStorage.getItem('projectpulse_active_project') || '';

    try {
      const res = await this.api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: identifier,
          password,
          remember,
          active_project_id: savedProjectId
        })
      });

      if (res.token && res.user) {
        this.state.authToken = res.token;
        this.state.user = res.user;
        localStorage.setItem('projectpulse_token', res.token);
        localStorage.setItem('projectpulse_user', JSON.stringify(res.user));

        if (res.projects && Array.isArray(res.projects) && res.projects.length > 0) {
          this.state.projects = res.projects;
          localStorage.setItem('projectpulse_cached_projects', JSON.stringify(res.projects));
        }

        if (res.current_project) {
          this.state.currentProject = res.current_project;
          this.state.currentProjectId = res.current_project.id;
          localStorage.setItem('projectpulse_active_project', res.current_project.id);
          localStorage.setItem(`projectpulse_cached_project_${res.current_project.id}`, JSON.stringify(res.current_project));
        }

        if (res.tasks && Array.isArray(res.tasks)) {
          this.state.tasks = res.tasks;
          if (this.state.currentProjectId) {
            localStorage.setItem(`projectpulse_cached_tasks_${this.state.currentProjectId}`, JSON.stringify(res.tasks));
          }
        }

        // Instant UI Render in 0ms!
        this.updateHeaderUserProfile();
        this.renderProjectsDropdown();
        this.renderProjectsSidebar();
        this.populateFilterDropdowns();
        this.renderCurrentView();
        this.hideAuthContainer();
        this.showToast(`Welcome back, ${res.user.full_name}!`, 'success');
      }
    } catch (err) {
      this.showAuthError(err.message || 'Login failed. Check your credentials.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
        this.initLucide();
      }
    }
  },

  async handleRegisterFormSubmit(e) {
    if (e) e.preventDefault();
    const full_name = document.getElementById('register-input-fullname')?.value.trim();
    const username = document.getElementById('register-input-username')?.value.trim();
    const email = document.getElementById('register-input-email')?.value.trim();
    const password = document.getElementById('register-input-password')?.value;

    if (!full_name || !username || !email || !password) {
      this.showAuthError('All fields are required.');
      return;
    }

    const submitBtn = document.getElementById('register-submit-btn');
    const originalText = submitBtn?.innerHTML;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin"></i><span>Creating Account...</span>';
      this.initLucide();
    }

    try {
      const res = await this.api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ full_name, username, email, password })
      });

      if (res.token && res.user) {
        this.state.authToken = res.token;
        this.state.user = res.user;
        localStorage.setItem('projectpulse_token', res.token);
        localStorage.setItem('projectpulse_user', JSON.stringify(res.user));

        if (res.projects && Array.isArray(res.projects) && res.projects.length > 0) {
          this.state.projects = res.projects;
          localStorage.setItem('projectpulse_cached_projects', JSON.stringify(res.projects));
        }

        if (res.current_project) {
          this.state.currentProject = res.current_project;
          this.state.currentProjectId = res.current_project.id;
          localStorage.setItem('projectpulse_active_project', res.current_project.id);
          localStorage.setItem(`projectpulse_cached_project_${res.current_project.id}`, JSON.stringify(res.current_project));
        }

        if (res.tasks && Array.isArray(res.tasks)) {
          this.state.tasks = res.tasks;
          if (this.state.currentProjectId) {
            localStorage.setItem(`projectpulse_cached_tasks_${this.state.currentProjectId}`, JSON.stringify(res.tasks));
          }
        }

        this.updateHeaderUserProfile();
        this.renderProjectsDropdown();
        this.renderProjectsSidebar();
        this.populateFilterDropdowns();
        this.renderCurrentView();
        this.hideAuthContainer();
        this.showToast(`Account created! Welcome, ${res.user.full_name}!`, 'success');
      }
    } catch (err) {
      this.showAuthError(err.message || 'Registration failed.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
        this.initLucide();
      }
    }
  },

  async handleLogout() {
    const token = this.state.authToken;
    // 1. Instant 0ms UI cleanup
    this.state.authToken = null;
    this.state.user = null;
    localStorage.removeItem('projectpulse_token');
    localStorage.removeItem('projectpulse_user');
    const activeId = this.state.currentProjectId;
    if (activeId) {
      localStorage.removeItem(`projectpulse_cached_project_${activeId}`);
      localStorage.removeItem(`projectpulse_cached_tasks_${activeId}`);
    }
    this.closeUserMenu();
    this.showAuthContainer();
    this.showToast('You have signed out', 'info');

    // 2. Non-blocking server cleanup in background
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      }).catch(() => {});
    }
  },

  handleSessionExpired() {
    this.state.authToken = null;
    this.state.user = null;
    localStorage.removeItem('projectpulse_token');
    localStorage.removeItem('projectpulse_user');
    this.showAuthContainer();
    this.showAuthError('Your session has expired. Please sign in again.');
  },

  toggleUserMenu() {
    const menu = document.getElementById('user-dropdown-menu');
    if (menu) {
      menu.classList.toggle('hidden');
      this.initLucide();
    }
  },

  closeUserMenu() {
    document.getElementById('user-dropdown-menu')?.classList.add('hidden');
  },

  updateHeaderUserProfile() {
    const user = this.state.user;
    if (!user) return;

    const avatarEl = document.getElementById('header-user-avatar');
    const nameEl = document.getElementById('header-user-name');
    const roleEl = document.getElementById('header-user-role');
    const dropNameEl = document.getElementById('dropdown-user-fullname');
    const dropEmailEl = document.getElementById('dropdown-user-email');

    const initial = (user.full_name || user.username || 'U').charAt(0).toUpperCase();

    if (avatarEl) {
      avatarEl.textContent = initial;
      if (user.avatar_color) {
        avatarEl.style.backgroundColor = user.avatar_color;
      }
    }
    if (nameEl) nameEl.textContent = user.full_name || user.username;
    if (roleEl) roleEl.textContent = user.role || 'Member';
    if (dropNameEl) dropNameEl.textContent = user.full_name || user.username;
    if (dropEmailEl) dropEmailEl.textContent = user.email || '';
    this.initLucide();
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
