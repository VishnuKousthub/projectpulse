/**
 * ProjectPulse - Simple mode: Dashboard + Project Charter
 *
 * Loaded after app.js. Adds two views (Dashboard, Charter) to the existing `app`
 * object and, unless FEATURES.advancedViews is turned on, hides the views that made
 * the tool feel overwhelming (Kanban, Calendar, Resource Mapping, Analytics).
 * Nothing is deleted: set advancedViews: true to get everything back.
 */
const FEATURES = {
  advancedViews: false,      // true = show Kanban / Calendar / Resource Mapping / Analytics again
  landingView: 'dashboard',  // view opened after sign-in
};

const UI = {
  input: 'w-full h-8 px-2 text-xs rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500',
  card: 'bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xs',
  th: 'py-2 px-3 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400',
  td: 'py-2 px-3 align-top text-xs text-slate-700 dark:text-slate-200',
  btn: 'h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer',
  btnPrimary: 'bg-blue-600 hover:bg-blue-700 text-white',
  btnGhost: 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-600',
  iconBtn: 'p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer',
};

Object.assign(app, {
  // ------------------------------------------------------------------ setup
  applySimpleMode() {
    if (FEATURES.advancedViews) return;
    ['kanban', 'calendar', 'resources', 'analytics'].forEach(v => {
      const el = document.getElementById(`nav-${v}`);
      if (el) el.style.display = 'none';
    });
    const reset = document.getElementById('sidebar-reset-demo-btn');
    if (reset) reset.style.display = 'none';
    const count = document.getElementById('core-views-count');
    if (count) count.textContent = '4';
  },

  fmtDate(value) {
    if (!value) return '—';
    const d = new Date(String(value).slice(0, 10) + 'T00:00:00');
    if (isNaN(d)) return this.escapeHtml(String(value));
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  daysLabel(days) {
    if (days === null || days === undefined) return '';
    if (days === 0) return 'today';
    return days > 0 ? `${days}d left` : `${-days}d late`;
  },

  healthBadge(h) {
    const map = {
      delayed: ['Delayed', 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'],
      at_risk: ['At risk', 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'],
      on_track: ['On track', 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'],
      done: ['Done', 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'],
    };
    const [label, cls] = map[h] || map.on_track;
    return `<span class="inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold ${cls}">${label}</span>`;
  },

  // -------------------------------------------------------------- dashboard
  async renderDashboard() {
    const root = document.getElementById('view-dashboard-container');
    if (!root) return;
    if (!root.dataset.loaded) {
      root.innerHTML = `<div class="py-16 text-center text-xs text-slate-400">Loading dashboard…</div>`;
    }
    let d;
    try {
      d = await this.api('/api/dashboard');
    } catch (e) {
      root.innerHTML = `<div class="py-16 text-center text-xs text-rose-500">Could not load the dashboard.</div>`;
      return;
    }
    if (this.state.activeView !== 'dashboard') return;   // user moved on while loading
    root.dataset.loaded = '1';
    const k = d.kpis;
    const esc = (v) => this.escapeHtml(v == null ? '' : String(v));

    const tile = (label, value, sub, tone) => `
      <div class="${UI.card} p-4">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400">${label}</div>
        <div class="mt-1 text-2xl font-extrabold ${tone || 'text-slate-800 dark:text-white'}">${value}</div>
        <div class="text-[11px] text-slate-400 mt-0.5">${sub}</div>
      </div>`;

    const projectRows = d.projects.map(p => `
      <tr class="border-t border-slate-100 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer"
          onclick="app.openProjectFromDashboard(${p.id}, 'table')">
        <td class="${UI.td}">
          <div class="flex items-center gap-2">
            <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${esc(p.color || '#3B82F6')}"></span>
            <div class="min-w-0">
              <div class="font-bold text-slate-900 dark:text-white truncate max-w-[260px]">${esc(p.name)}</div>
              <div class="text-[10px] text-slate-400 font-mono">${esc(p.project_code || '')}</div>
            </div>
          </div>
        </td>
        <td class="${UI.td}">${esc(p.project_manager || '—')}</td>
        <td class="${UI.td}">${p.delivery_date ? `${this.fmtDate(p.delivery_date)}<div class="text-[10px] ${p.days_left < 0 ? 'text-rose-500' : 'text-slate-400'}">${this.daysLabel(p.days_left)}</div>` : '<span class="text-slate-400">Not set</span>'}</td>
        <td class="${UI.td}" style="min-width:130px">
          <div class="flex items-center gap-2">
            <div class="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"><div class="h-full bg-blue-600" style="width:${p.progress}%"></div></div>
            <span class="font-semibold w-9 text-right">${p.progress}%</span>
          </div>
          <div class="text-[10px] text-slate-400 mt-0.5">${p.done_tasks}/${p.total_tasks} tasks</div>
        </td>
        <td class="${UI.td} ${p.overdue_tasks ? 'text-rose-600 font-bold' : 'text-slate-400'}">${p.overdue_tasks}</td>
        <td class="${UI.td}">${p.next_due ? `${this.fmtDate(p.next_due.date)}<div class="text-[10px] text-slate-400 truncate max-w-[180px]">${esc(p.next_due.title)}</div>` : '<span class="text-slate-400">—</span>'}</td>
        <td class="${UI.td}">${this.healthBadge(p.health)}</td>
      </tr>`).join('');

    const overdueRows = d.overdue.length ? d.overdue.map(t => `
      <tr class="border-t border-slate-100 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer"
          onclick="app.openProjectFromDashboard(${t.project_id}, 'table')">
        <td class="${UI.td}"><div class="font-semibold text-slate-900 dark:text-white truncate max-w-[240px]">${esc(t.title)}</div>
          <div class="text-[10px] text-slate-400 truncate max-w-[240px]">${esc(t.project_name)}</div></td>
        <td class="${UI.td}">${esc(t.assignee)}</td>
        <td class="${UI.td} text-right text-rose-600 font-bold whitespace-nowrap">${t.days_late}d late</td>
      </tr>`).join('') : `<tr><td colspan="3" class="py-6 text-center text-xs text-slate-400">Nothing overdue 🎉</td></tr>`;

    const delivRows = d.deliverables.length ? d.deliverables.map(x => `
      <tr class="border-t border-slate-100 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer"
          onclick="app.openProjectFromDashboard(${x.project_id}, 'charter')">
        <td class="${UI.td}"><div class="font-semibold text-slate-900 dark:text-white">${esc(x.title)}</div>
          <div class="text-[10px] text-slate-400 truncate max-w-[240px]">${esc(x.project_name)}${x.quantity ? ' · ' + esc(x.quantity) : ''}</div></td>
        <td class="${UI.td} text-right whitespace-nowrap">${this.fmtDate(x.due_date)}
          <div class="text-[10px] ${x.days_left !== null && x.days_left < 0 ? 'text-rose-500' : 'text-slate-400'}">${this.daysLabel(x.days_left)}</div></td>
      </tr>`).join('') : `<tr><td colspan="2" class="py-6 text-center text-xs text-slate-400">No open deliverables. Add them on a project's Charter page.</td></tr>`;

    const maxOpen = Math.max(1, ...d.workload.map(w => w.open));
    const workload = d.workload.length ? d.workload.map(w => `
      <div class="flex items-center gap-2 text-xs">
        <div class="w-28 truncate text-slate-700 dark:text-slate-200" title="${esc(w.name)}">${esc(w.name)}</div>
        <div class="flex-1 h-2 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden flex">
          <div class="h-full bg-rose-500" style="width:${w.overdue / maxOpen * 100}%"></div>
          <div class="h-full bg-blue-500" style="width:${(w.open - w.overdue) / maxOpen * 100}%"></div>
        </div>
        <div class="w-16 text-right text-slate-500">${w.open}${w.overdue ? ` <span class="text-rose-500">(${w.overdue})</span>` : ''}</div>
      </div>`).join('') : '<div class="py-4 text-xs text-slate-400 text-center">No open tasks.</div>';

    const risks = d.high_risks.length ? d.high_risks.map(r => `
      <div class="py-2 border-t first:border-t-0 border-slate-100 dark:border-slate-700/60 cursor-pointer" onclick="app.openProjectFromDashboard(${r.project_id}, 'charter')">
        <div class="text-xs font-semibold text-slate-900 dark:text-white"><span class="font-mono text-rose-600">${esc(r.risk_code || '')}</span> ${esc(r.description)}</div>
        <div class="text-[10px] text-slate-400 truncate">${esc(r.project_name)}${r.owner ? ' · ' + esc(r.owner) : ''}</div>
      </div>`).join('') : '<div class="py-4 text-xs text-slate-400 text-center">No open high-impact risks.</div>';

    const panel = (title, sub, body) => `
      <div class="${UI.card} overflow-hidden">
        <div class="px-4 py-3 border-b border-slate-100 dark:border-slate-700/60">
          <h3 class="text-sm font-bold text-slate-800 dark:text-white">${title}</h3>
          ${sub ? `<div class="text-[11px] text-slate-400">${sub}</div>` : ''}
        </div>${body}
      </div>`;

    root.innerHTML = `
      <div class="grid grid-cols-2 lg:grid-cols-5 gap-3">
        ${tile('Projects', k.projects, `${k.total_tasks} tasks in total`)}
        ${tile('Overdue tasks', k.overdue_tasks, 'past their due date', k.overdue_tasks ? 'text-rose-600' : '')}
        ${tile('Due this week', k.due_this_week, 'next 7 days', k.due_this_week ? 'text-amber-600' : '')}
        ${tile('Overall progress', k.completion_pct + '%', 'tasks marked done')}
        ${tile('High risks open', k.open_high_risks, 'from project charters', k.open_high_risks ? 'text-rose-600' : '')}
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div class="${UI.card} p-4 flex flex-col">
          <div class="mb-2">
            <h3 class="text-sm font-bold text-slate-800 dark:text-white">Project Health</h3>
            <div class="text-[11px] text-slate-400">Projects by delivery status</div>
          </div>
          <div id="dashboard-health-chart-container" class="relative flex-1 min-h-[200px] max-h-[230px] flex items-center justify-center">
            <canvas id="dashboardHealthChart" class="w-full max-h-[220px]"></canvas>
          </div>
        </div>

        <div class="${UI.card} p-4 flex flex-col">
          <div class="mb-2">
            <h3 class="text-sm font-bold text-slate-800 dark:text-white">Task Status by Project</h3>
            <div class="text-[11px] text-slate-400">Done, in progress, to do and overdue</div>
          </div>
          <div id="dashboard-status-chart-container" class="relative flex-1 min-h-[200px] max-h-[230px] flex items-center justify-center">
            <canvas id="dashboardStatusChart" class="w-full max-h-[220px]"></canvas>
          </div>
        </div>

        <div class="${UI.card} p-4 flex flex-col">
          <div class="mb-2">
            <h3 class="text-sm font-bold text-slate-800 dark:text-white">Key Tasks</h3>
            <div class="text-[11px] text-slate-400">Urgent & high priority open work</div>
          </div>
          <div id="dashboard-key-tasks-chart-container" class="relative flex-1 min-h-[200px] max-h-[230px] flex items-center justify-center">
            <canvas id="dashboardKeyTasksChart" class="w-full max-h-[220px]"></canvas>
          </div>
        </div>
      </div>

      ${panel('Projects', 'Click a project to open its task table', `
        <div class="overflow-x-auto"><table class="w-full">
          <thead class="bg-slate-50 dark:bg-slate-800/80"><tr>
            <th class="${UI.th}">Project</th><th class="${UI.th}">Manager</th><th class="${UI.th}">Delivery</th>
            <th class="${UI.th}">Progress</th><th class="${UI.th}">Overdue</th><th class="${UI.th}">Next due</th><th class="${UI.th}">Health</th>
          </tr></thead><tbody>${projectRows}</tbody></table></div>`)}

      <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
        ${panel('Most overdue tasks', d.overdue_total > d.overdue.length ? `Showing ${d.overdue.length} of ${d.overdue_total}` : `${d.overdue_total} overdue`, `
          <div class="overflow-x-auto"><table class="w-full"><tbody>${overdueRows}</tbody></table></div>`)}
        ${panel('Deliverables due', 'Open deliverables, soonest first', `
          <div class="overflow-x-auto"><table class="w-full"><tbody>${delivRows}</tbody></table></div>`)}
      </div>

      <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
        ${panel('Open tasks per person', 'Red = overdue', `<div class="p-4 space-y-2">${workload}</div>`)}
        ${panel('Open high-impact risks', '', `<div class="px-4 py-2">${risks}</div>`)}
      </div>`;
    this.renderDashboardCharts(d);
    this.initLucide();
  },

  renderDashboardCharts(d) {
    if (typeof Chart === 'undefined') return;
    if (!this.state.charts) this.state.charts = {};

    ['dashboardHealth', 'dashboardStatus', 'dashboardKeyTasks'].forEach(k => {
      if (this.state.charts[k]) {
        this.state.charts[k].destroy();
        delete this.state.charts[k];
      }
    });

    const isDark = document.documentElement.classList.contains('dark');
    const textColor = isDark ? '#94A3B8' : '#64748B';
    const gridColor = isDark ? 'rgba(51, 65, 85, 0.4)' : 'rgba(226, 232, 240, 0.7)';
    const tooltipBg = isDark ? '#1E293B' : '#0F172A';

    // 1. Doughnut: Projects by Health
    const healthCounts = { on_track: 0, at_risk: 0, delayed: 0, done: 0 };
    (d.projects || []).forEach(p => {
      if (healthCounts[p.health] !== undefined) healthCounts[p.health]++;
      else healthCounts.on_track++;
    });
    const totalProjects = (d.projects || []).length;
    const healthCanvas = document.getElementById('dashboardHealthChart');
    if (healthCanvas) {
      if (totalProjects === 0) {
        const c = document.getElementById('dashboard-health-chart-container');
        if (c) c.innerHTML = '<div class="py-12 text-center text-xs text-slate-400">Nothing to show yet</div>';
      } else {
        this.state.charts.dashboardHealth = new Chart(healthCanvas, {
          type: 'doughnut',
          data: {
            labels: ['On track', 'At risk', 'Delayed', 'Done'],
            datasets: [{
              data: [healthCounts.on_track, healthCounts.at_risk, healthCounts.delayed, healthCounts.done],
              backgroundColor: ['#10B981', '#F59E0B', '#F43F5E', '#3B82F6'],
              borderColor: isDark ? '#1E293B' : '#FFFFFF',
              borderWidth: 2,
              hoverOffset: 4
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'bottom',
                labels: { boxWidth: 10, padding: 8, font: { size: 10 }, color: textColor }
              },
              tooltip: {
                backgroundColor: tooltipBg,
                callbacks: {
                  label: (ctx) => ` ${ctx.label}: ${ctx.raw} (${totalProjects ? Math.round(ctx.raw / totalProjects * 100) : 0}%)`
                }
              }
            },
            cutout: '70%'
          },
          plugins: [{
            id: 'healthCenterCount',
            beforeDraw(chart) {
              const { width, height, ctx } = chart;
              ctx.save();
              const legendH = chart.legend ? chart.legend.height : 0;
              const centerY = (height - legendH) / 2;
              ctx.font = 'bold 22px sans-serif';
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillStyle = isDark ? '#F8FAFC' : '#0F172A';
              ctx.fillText(String(totalProjects), width / 2, centerY - 8);

              ctx.font = '10px sans-serif';
              ctx.fillStyle = isDark ? '#94A3B8' : '#64748B';
              ctx.fillText(totalProjects === 1 ? 'project' : 'projects', width / 2, centerY + 12);
              ctx.restore();
            }
          }]
        });
      }
    }

    // 2. Horizontal Stacked Bar: Task Status by Project
    const sortedProjects = [...(d.projects || [])]
      .sort((a, b) => (b.overdue_tasks || 0) - (a.overdue_tasks || 0) || (b.total_tasks || 0) - (a.total_tasks || 0))
      .slice(0, 8);
    const statusCanvas = document.getElementById('dashboardStatusChart');
    if (statusCanvas) {
      if (sortedProjects.length === 0 || sortedProjects.every(p => p.total_tasks === 0)) {
        const c = document.getElementById('dashboard-status-chart-container');
        if (c) c.innerHTML = '<div class="py-12 text-center text-xs text-slate-400">Nothing to show yet</div>';
      } else {
        this.state.charts.dashboardStatus = new Chart(statusCanvas, {
          type: 'bar',
          data: {
            labels: sortedProjects.map(p => p.name.length > 18 ? p.name.slice(0, 17) + '…' : p.name),
            datasets: [
              {
                label: 'Done',
                data: sortedProjects.map(p => p.status_counts ? p.status_counts.done : p.done_tasks || 0),
                backgroundColor: '#10B981'
              },
              {
                label: 'In progress',
                data: sortedProjects.map(p => p.status_counts ? p.status_counts.in_progress : 0),
                backgroundColor: '#3B82F6'
              },
              {
                label: 'To do',
                data: sortedProjects.map(p => p.status_counts ? p.status_counts.todo : 0),
                backgroundColor: '#94A3B8'
              },
              {
                label: 'Overdue',
                data: sortedProjects.map(p => p.status_counts ? p.status_counts.overdue : p.overdue_tasks || 0),
                backgroundColor: '#F43F5E'
              }
            ]
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            onClick: (evt, elements) => {
              if (elements && elements.length > 0) {
                const idx = elements[0].index;
                const proj = sortedProjects[idx];
                if (proj) this.openProjectFromDashboard(proj.id, 'table');
              }
            },
            onHover: (evt, elements) => {
              evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
            },
            scales: {
              x: {
                stacked: true,
                grid: { color: gridColor },
                ticks: { color: textColor, precision: 0 }
              },
              y: {
                stacked: true,
                grid: { display: false },
                ticks: { color: textColor, font: { size: 10 } }
              }
            },
            plugins: {
              legend: {
                position: 'bottom',
                labels: { boxWidth: 10, padding: 8, font: { size: 10 }, color: textColor }
              },
              tooltip: {
                backgroundColor: tooltipBg,
                callbacks: {
                  title: (items) => {
                    const idx = items[0].dataIndex;
                    return sortedProjects[idx]?.name || '';
                  }
                }
              }
            }
          }
        });
      }
    }

    // 3. Horizontal Bar: Key Tasks
    const keyTasks = d.key_tasks || [];
    const keyTasksCanvas = document.getElementById('dashboardKeyTasksChart');
    if (keyTasksCanvas) {
      if (keyTasks.length === 0) {
        const c = document.getElementById('dashboard-key-tasks-chart-container');
        if (c) c.innerHTML = '<div class="py-12 text-center text-xs text-slate-400">Nothing to show yet</div>';
      } else {
        this.state.charts.dashboardKeyTasks = new Chart(keyTasksCanvas, {
          type: 'bar',
          data: {
            labels: keyTasks.map(t => {
              const tTitle = t.title.length > 16 ? t.title.slice(0, 15) + '…' : t.title;
              const pName = t.project_name.length > 12 ? t.project_name.slice(0, 11) + '…' : t.project_name;
              const due = t.due_date ? t.due_date.slice(5) : 'No due';
              return `${tTitle} (${pName} · ${due})`;
            }),
            datasets: [{
              label: 'Progress %',
              data: keyTasks.map(t => t.progress_pct || 0),
              backgroundColor: keyTasks.map(t => {
                const pct = t.progress_pct || 0;
                if (pct >= 80) return '#10B981';
                if (pct >= 40) return '#3B82F6';
                return '#F59E0B';
              }),
              borderRadius: 4
            }]
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            onClick: (evt, elements) => {
              if (elements && elements.length > 0) {
                const idx = elements[0].index;
                const task = keyTasks[idx];
                if (task) this.openProjectFromDashboard(task.project_id, 'table');
              }
            },
            onHover: (evt, elements) => {
              evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
            },
            scales: {
              x: {
                min: 0,
                max: 100,
                grid: { color: gridColor },
                ticks: {
                  color: textColor,
                  callback: (v) => v + '%'
                }
              },
              y: {
                grid: { display: false },
                ticks: { color: textColor, font: { size: 10 } }
              }
            },
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: tooltipBg,
                callbacks: {
                  title: (items) => {
                    const idx = items[0].dataIndex;
                    const t = keyTasks[idx];
                    return `${t.title} [${t.project_name}]`;
                  },
                  label: (ctx) => {
                    const t = keyTasks[ctx.dataIndex];
                    const prio = (t.priority || '').toUpperCase();
                    return ` ${ctx.raw}% complete · Priority: ${prio} · Due: ${t.due_date || 'None'}`;
                  }
                }
              }
            }
          }
        });
      }
    }
  },

  async openProjectFromDashboard(projectId, view) {
    await this.selectProject(projectId);
    this.switchView(view || 'table');
  },

  // ---------------------------------------------------------------- charter
  async renderCharter() {
    const root = document.getElementById('view-charter-container');
    if (!root) return;
    const pid = this.state.currentProjectId;
    if (!pid) {
      root.innerHTML = `<div class="py-16 text-center text-xs text-slate-400">Select or create a project first.</div>`;
      return;
    }
    let c;
    try {
      c = await this.api(`/api/projects/${pid}/charter`);
    } catch (e) { return; }
    if (this.state.activeView !== 'charter' || Number(this.state.currentProjectId) !== Number(pid)) return;
    this.state.charter = c;
    this.paintCharter();
  },

  paintCharter() {
    const root = document.getElementById('view-charter-container');
    const c = this.state.charter;
    if (!root || !c) return;
    const p = c.project;
    const canEdit = this.isFullAccess();
    const editing = this.state.charterEditHeader && canEdit;
    const esc = (v) => this.escapeHtml(v == null ? '' : String(v));
    const edit = this.state.charterEdit || {};   // {kind, id}

    // ---------- header block
    const field = (label, view, inputHtml, wide) => `
      <div class="${wide ? 'sm:col-span-2 lg:col-span-3' : ''}">
        <div class="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">${label}</div>
        ${editing ? inputHtml : `<div class="text-xs text-slate-800 dark:text-slate-100 break-words">${view || '<span class="text-slate-400">Not set</span>'}</div>`}
      </div>`;
    const inp = (id, val, type = 'text', extra = '') =>
      `<input id="${id}" type="${type}" value="${esc(type === 'date' ? String(val || '').slice(0, 10) : val)}" class="${UI.input}" ${extra}>`;
    const tech = p.tech_pack
      ? (/^https?:\/\//i.test(p.tech_pack) ? `<a href="${esc(p.tech_pack)}" target="_blank" rel="noopener" class="text-blue-600 hover:underline">${esc(p.tech_pack)}</a>` : esc(p.tech_pack))
      : '';

    const header = `
      <div class="${UI.card} p-5">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 class="text-base font-extrabold text-slate-800 dark:text-white">Project Charter</h2>
            <div class="text-[11px] text-slate-400">Scope, key dates and tech pack for this project</div>
          </div>
          <div class="flex items-center gap-2">
            <button onclick="app.openProjectReportModal()" class="${UI.btn} ${UI.btnGhost}"><i data-lucide="file-text" class="w-3.5 h-3.5"></i>Project Report</button>
            ${canEdit ? (editing
              ? `<button onclick="app.cancelCharterHeader()" class="${UI.btn} ${UI.btnGhost}">Cancel</button>
                 <button onclick="app.saveCharterHeader()" class="${UI.btn} ${UI.btnPrimary}">Save</button>`
              : `<button onclick="app.editCharterHeader()" class="${UI.btn} ${UI.btnPrimary}"><i data-lucide="pencil" class="w-3.5 h-3.5"></i>Edit</button>`) : ''}
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          ${field('Project name', esc(p.name), inp('cf-name', p.name))}
          ${field('Project code', esc(p.project_code), inp('cf-code', p.project_code))}
          ${field('CAS no.', esc(p.cas_no), inp('cf-cas', p.cas_no))}
          ${field('Project manager', esc(p.project_manager),
              inp('cf-pm', p.project_manager, 'text', 'list="cf-members"') +
              `<datalist id="cf-members">${(c.members || []).map(m => `<option value="${esc(m)}">`).join('')}</datalist>`)}
          ${field('Project received date', this.fmtDate(p.received_date) === '—' ? '' : this.fmtDate(p.received_date), inp('cf-received', p.received_date, 'date'))}
          ${field('Project delivery date', this.fmtDate(p.delivery_date) === '—' ? '' : this.fmtDate(p.delivery_date), inp('cf-delivery', p.delivery_date, 'date'))}
          ${field('Tech pack (link or reference)', tech, inp('cf-tech', p.tech_pack), true)}
          ${field('Project scope', esc(p.description), `<textarea id="cf-scope" rows="3" class="${UI.input} h-auto py-1.5">${esc(p.description)}</textarea>`, true)}
        </div>
      </div>`;

    // ---------- deliverables & risks statuses
    const STATUS_CHOICES = [
      ['backlog', 'Backlog', 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'],
      ['todo', 'To Do', 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'],
      ['in_progress', 'In Progress', 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'],
      ['in_review', 'In Review', 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800'],
      ['done', 'Done', 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'],
    ];

    const getStatusStyle = (st) => {
      const norm = (st === 'pending' || st === 'open' ? 'todo' : (st === 'completed' || st === 'closed' || st === 'mitigated') ? 'done' : st) || 'todo';
      const found = STATUS_CHOICES.find(([v]) => v === norm);
      return found ? found[2] : 'bg-slate-50 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300';
    };

    const statusSel = (idAttr, val, handler) => {
      const v = (val === 'pending' || val === 'open' ? 'todo' : (val === 'completed' || val === 'closed' || val === 'mitigated') ? 'done' : val) || 'todo';
      const colorCls = getStatusStyle(v);
      const idStr = idAttr ? `id="${idAttr}"` : '';
      const onchangeStr = handler ? `onchange="${handler}"` : '';
      return `
        <select ${idStr} ${onchangeStr} class="text-xs font-semibold px-2 py-1 rounded-md border !w-auto cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500 ${colorCls}" ${canEdit ? '' : 'disabled'}>
          ${STATUS_CHOICES.map(([optVal, optLabel]) => `<option value="${optVal}" class="bg-white text-slate-900 dark:bg-slate-800 dark:text-white" ${optVal === v ? 'selected' : ''}>${optLabel}</option>`).join('')}
        </select>`;
    };

    const delivForm = (d) => `
      <tr class="border-t border-slate-100 dark:border-slate-700/60 bg-blue-50/40 dark:bg-slate-700/20">
        <td class="${UI.td}">${inp('cd-title', d.title, 'text', 'placeholder="Deliverable"')}</td>
        <td class="${UI.td}">${inp('cd-quality', d.quality, 'text', 'placeholder="e.g. Purity ≥ 99% by HPLC"')}</td>
        <td class="${UI.td}">${inp('cd-qty', d.quantity, 'text', 'placeholder="e.g. 1 kg"')}</td>
        <td class="${UI.td}">${inp('cd-due', d.due_date, 'date')}</td>
        <td class="${UI.td}">${statusSel('cd-status', d.status || 'todo', 'app.updateDropdownColor(this)')}</td>
        <td class="${UI.td} whitespace-nowrap text-right">
          <button onclick="app.saveDeliverable(${d.id || 0})" class="${UI.btn} ${UI.btnPrimary}">Save</button>
          <button onclick="app.cancelCharterRow()" class="${UI.btn} ${UI.btnGhost}">Cancel</button>
        </td>
      </tr>`;
    const delivRows = c.deliverables.map(d =>
      (edit.kind === 'deliverable' && edit.id === d.id) ? delivForm(d) : `
      <tr class="border-t border-slate-100 dark:border-slate-700/60">
        <td class="${UI.td} font-semibold text-slate-900 dark:text-white">${esc(d.title)}</td>
        <td class="${UI.td}">${esc(d.quality) || '<span class="text-slate-400">—</span>'}</td>
        <td class="${UI.td}">${esc(d.quantity) || '<span class="text-slate-400">—</span>'}</td>
        <td class="${UI.td} whitespace-nowrap">${this.fmtDate(d.due_date)}</td>
        <td class="${UI.td}">${statusSel('', d.status, `app.setDeliverableStatus(${d.id}, this.value)`)}</td>
        <td class="${UI.td} text-right whitespace-nowrap">${canEdit ? `
          <button onclick="app.editCharterRow('deliverable', ${d.id})" class="${UI.iconBtn}" title="Edit"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
          <button onclick="app.deleteDeliverable(${d.id})" class="${UI.iconBtn} hover:!text-rose-600" title="Delete"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>` : ''}</td>
      </tr>`).join('');
    const delivNew = (edit.kind === 'deliverable' && edit.id === 0) ? delivForm({}) : '';
    const delivEmpty = (!c.deliverables.length && !delivNew)
      ? `<tr><td colspan="6" class="py-6 text-center text-xs text-slate-400">No deliverables yet.</td></tr>` : '';

    const deliverables = `
      <div class="${UI.card} overflow-hidden">
        <div class="px-5 py-3 flex items-center justify-between border-b border-slate-100 dark:border-slate-700/60">
          <div><h3 class="text-sm font-bold text-slate-800 dark:text-white">Project deliverables</h3>
            <div class="text-[11px] text-slate-400">What is being delivered, to what quality and quantity</div></div>
          ${canEdit ? `<button onclick="app.editCharterRow('deliverable', 0)" class="${UI.btn} ${UI.btnGhost}"><i data-lucide="plus" class="w-3.5 h-3.5"></i>Add deliverable</button>` : ''}
        </div>
        <div class="overflow-x-auto"><table class="w-full">
          <thead class="bg-slate-50 dark:bg-slate-800/80"><tr>
            <th class="${UI.th}">Deliverable</th><th class="${UI.th}">Quality</th><th class="${UI.th}">Quantity</th>
            <th class="${UI.th}">Due</th><th class="${UI.th}">Status</th><th class="${UI.th}"></th></tr></thead>
          <tbody>${delivRows}${delivNew}${delivEmpty}</tbody></table></div>
      </div>`;

    // ---------- milestones (existing tasks, grouped by Technical / Both / Non-technical tag)
    const typeSel = (t) => `
      <select onchange="app.setTaskType(${t.id}, this.value)" class="${UI.input} !w-auto" ${canEdit ? '' : 'disabled'}>
        <option value="" ${!t.type ? 'selected' : ''}>Not set</option>
        <option value="technical" ${t.type === 'technical' ? 'selected' : ''}>Technical</option>
        <option value="both" ${t.type === 'both' ? 'selected' : ''}>Both</option>
        <option value="nontechnical" ${t.type === 'nontechnical' ? 'selected' : ''}>Non-technical</option>
      </select>`;
    const msTable = (title, items, emptyText, bare) => `
      <div class="${bare ? '' : UI.card + ' overflow-hidden'}">
        ${bare ? '' : `<div class="px-5 py-3 border-b border-slate-100 dark:border-slate-700/60">
          <h3 class="text-sm font-bold text-slate-800 dark:text-white">${title} <span class="text-slate-400 font-medium">· ${items.length}</span></h3>
        </div>`}
        <div class="overflow-x-auto"><table class="w-full">
          <thead class="bg-slate-50 dark:bg-slate-800/80"><tr>
            <th class="${UI.th} w-10">#</th><th class="${UI.th}">Objective / activity / milestone</th><th class="${UI.th}">Timeline</th>
            <th class="${UI.th}">Task owner</th><th class="${UI.th}">Status</th><th class="${UI.th}">Type</th></tr></thead>
          <tbody>${items.length ? items.map((t, i) => `
            <tr class="border-t border-slate-100 dark:border-slate-700/60">
              <td class="${UI.td} text-slate-400">${i + 1}</td>
              <td class="${UI.td} font-semibold text-slate-900 dark:text-white">${esc(t.title)}</td>
              <td class="${UI.td} whitespace-nowrap">${t.start_date || t.due_date ? `${this.fmtDate(t.start_date)} → ${this.fmtDate(t.due_date)}` : '<span class="text-slate-400">Not declared</span>'}</td>
              <td class="${UI.td}">${esc(t.assignee_name) || '<span class="text-slate-400">Unassigned</span>'}</td>
              <td class="${UI.td}">${esc(String(t.status || '').replace('_', ' '))}</td>
              <td class="${UI.td}">${typeSel(t)}</td>
            </tr>`).join('') : `<tr><td colspan="6" class="py-5 text-center text-xs text-slate-400">${emptyText}</td></tr>`}
          </tbody></table></div>
      </div>`;
    const tech2 = c.milestones.filter(t => t.type === 'technical');
    const both = c.milestones.filter(t => t.type === 'both');
    const nonTech = c.milestones.filter(t => t.type === 'nontechnical');
    const untyped = c.milestones.filter(t => !t.type);
    const milestones = `
      ${msTable('Project objectives / milestones — Technical', tech2, 'Pick “Technical” in the Type column of an activity below to list it here.')}
      ${msTable('Project objectives / milestones — Both', both, 'Pick “Both” in the Type column of an activity below to list it here.')}
      ${msTable('Project objectives / milestones — Non-technical', nonTech, 'Pick “Non-technical” in the Type column of an activity below to list it here.')}
      ${untyped.length ? `<details class="${UI.card} overflow-hidden" ${(!tech2.length && !both.length && !nonTech.length) ? 'open' : ''}>
          <summary class="px-5 py-3 cursor-pointer text-sm font-bold text-slate-800 dark:text-white">Activities not classified yet <span class="text-slate-400 font-medium">· ${untyped.length}</span></summary>
          ${msTable('Not classified', untyped, '', true)}
        </details>` : ''}`;

    // ---------- risks
    const impactBadge = (v) => {
      const cls = v === 'high' ? 'bg-rose-50 text-rose-700 border-rose-200' : v === 'medium' ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-600 border-slate-200';
      return `<span class="inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold capitalize ${cls}">${esc(v)}</span>`;
    };
    const riskForm = (r) => `
      <tr class="border-t border-slate-100 dark:border-slate-700/60 bg-blue-50/40 dark:bg-slate-700/20">
        <td class="${UI.td}">${inp('cr-code', r.risk_code, 'text', 'placeholder="auto"')}</td>
        <td class="${UI.td}">${inp('cr-desc', r.description, 'text', 'placeholder="Risk description"')}</td>
        <td class="${UI.td}"><select id="cr-impact" class="${UI.input}">${['high', 'medium', 'low'].map(v => `<option value="${v}" ${(r.impact || 'medium') === v ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select></td>
        <td class="${UI.td}">${inp('cr-mit', r.mitigation, 'text', 'placeholder="Mitigation plan"')}</td>
        <td class="${UI.td}">${inp('cr-owner', r.owner, 'text', 'placeholder="Owner"')}</td>
        <td class="${UI.td}">${statusSel('cr-status', r.status || 'todo', 'app.updateDropdownColor(this)')}</td>
        <td class="${UI.td} whitespace-nowrap text-right">
          <button onclick="app.saveRisk(${r.id || 0})" class="${UI.btn} ${UI.btnPrimary}">Save</button>
          <button onclick="app.cancelCharterRow()" class="${UI.btn} ${UI.btnGhost}">Cancel</button>
        </td>
      </tr>`;
    const riskRows = c.risks.map(r =>
      (edit.kind === 'risk' && edit.id === r.id) ? riskForm(r) : `
      <tr class="border-t border-slate-100 dark:border-slate-700/60 ${r.status === 'done' ? 'opacity-50' : ''}">
        <td class="${UI.td} font-mono font-bold">${esc(r.risk_code)}</td>
        <td class="${UI.td}">${esc(r.description)}</td>
        <td class="${UI.td}">${impactBadge(r.impact)}</td>
        <td class="${UI.td}">${esc(r.mitigation) || '<span class="text-slate-400">—</span>'}</td>
        <td class="${UI.td}">${esc(r.owner) || '<span class="text-slate-400">—</span>'}</td>
        <td class="${UI.td}">${statusSel('', r.status, `app.setRiskStatus(${r.id}, this.value)`)}</td>
        <td class="${UI.td} text-right whitespace-nowrap">${canEdit ? `
          <button onclick="app.editCharterRow('risk', ${r.id})" class="${UI.iconBtn}" title="Edit"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
          <button onclick="app.deleteRisk(${r.id})" class="${UI.iconBtn} hover:!text-rose-600" title="Delete"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>` : ''}</td>
      </tr>`).join('');
    const riskNew = (edit.kind === 'risk' && edit.id === 0) ? riskForm({}) : '';
    const riskEmpty = (!c.risks.length && !riskNew) ? `<tr><td colspan="7" class="py-6 text-center text-xs text-slate-400">No risks logged.</td></tr>` : '';

    const risks = `
      <div class="${UI.card} overflow-hidden">
        <div class="px-5 py-3 flex items-center justify-between border-b border-slate-100 dark:border-slate-700/60">
          <div><h3 class="text-sm font-bold text-slate-800 dark:text-white">Project risks</h3>
            <div class="text-[11px] text-slate-400">Open high-impact risks show on the Dashboard</div></div>
          ${canEdit ? `<button onclick="app.editCharterRow('risk', 0)" class="${UI.btn} ${UI.btnGhost}"><i data-lucide="plus" class="w-3.5 h-3.5"></i>Add risk</button>` : ''}
        </div>
        <div class="overflow-x-auto"><table class="w-full">
          <thead class="bg-slate-50 dark:bg-slate-800/80"><tr>
            <th class="${UI.th}">Risk ID</th><th class="${UI.th}">Risk description</th><th class="${UI.th}">Impact</th>
            <th class="${UI.th}">Mitigation plan</th><th class="${UI.th}">Owner</th><th class="${UI.th}">Status</th><th class="${UI.th}"></th></tr></thead>
          <tbody>${riskRows}${riskNew}${riskEmpty}</tbody></table></div>
      </div>`;

    root.innerHTML = header + deliverables + milestones + risks;
    this.initLucide();
  },

  // -- header edit
  editCharterHeader() { this.state.charterEditHeader = true; this.paintCharter(); },
  cancelCharterHeader() { this.state.charterEditHeader = false; this.paintCharter(); },
  async saveCharterHeader() {
    const v = (id) => document.getElementById(id)?.value ?? '';
    const name = v('cf-name').trim();
    if (!name) { this.showToast('Project name is required', 'error'); return; }
    const pid = this.state.currentProjectId;
    await this.api(`/api/projects/${pid}`, {
      method: 'PUT',
      body: {
        name, description: v('cf-scope'),
        project_code: v('cf-code'), cas_no: v('cf-cas'), project_manager: v('cf-pm'),
        received_date: v('cf-received'), delivery_date: v('cf-delivery'), tech_pack: v('cf-tech'),
      },
    });
    this.state.charterEditHeader = false;
    this.showToast('Charter saved', 'success');
    // refresh project list (name may have changed) and this page
    const list = await this.api('/api/projects');
    this.state.projects = list;
    this.renderProjectsDropdown();
    this.renderProjectsSidebar();
    await this.renderCharter();
  },

  // -- row edit helpers
  editCharterRow(kind, id) { this.state.charterEdit = { kind, id }; this.paintCharter(); },
  cancelCharterRow() { this.state.charterEdit = null; this.paintCharter(); },

  async saveDeliverable(id) {
    const v = (x) => document.getElementById(x)?.value ?? '';
    const body = {
      title: v('cd-title'),
      quality: v('cd-quality'),
      quantity: v('cd-qty'),
      due_date: v('cd-due'),
      status: v('cd-status') || 'todo'
    };
    if (!body.title.trim()) { this.showToast('Deliverable name is required', 'error'); return; }
    if (id) await this.api(`/api/deliverables/${id}`, { method: 'PUT', body });
    else await this.api(`/api/projects/${this.state.currentProjectId}/deliverables`, { method: 'POST', body });
    this.state.charterEdit = null;
    await this.renderCharter();
  },
  async setDeliverableStatus(id, status) {
    await this.api(`/api/deliverables/${id}`, { method: 'PUT', body: { status } });
    await this.renderCharter();
  },
  async deleteDeliverable(id) {
    if (!confirm('Delete this deliverable?')) return;
    await this.api(`/api/deliverables/${id}`, { method: 'DELETE' });
    await this.renderCharter();
  },

  async saveRisk(id) {
    const v = (x) => document.getElementById(x)?.value ?? '';
    const body = {
      risk_code: v('cr-code'),
      description: v('cr-desc'),
      impact: v('cr-impact'),
      mitigation: v('cr-mit'),
      owner: v('cr-owner'),
      status: v('cr-status') || 'todo'
    };
    if (!body.description.trim()) { this.showToast('Risk description is required', 'error'); return; }
    if (id) await this.api(`/api/risks/${id}`, { method: 'PUT', body });
    else await this.api(`/api/projects/${this.state.currentProjectId}/risks`, { method: 'POST', body });
    this.state.charterEdit = null;
    await this.renderCharter();
  },
  updateDropdownColor(el) {
    const colors = {
      backlog: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
      todo: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800',
      in_progress: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
      in_review: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800',
      done: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
    };
    const base = 'text-xs font-semibold px-2 py-1 rounded-md border !w-auto cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500 ';
    el.className = base + (colors[el.value] || colors.todo);
  },
  async setRiskStatus(id, status) {
    await this.api(`/api/risks/${id}`, { method: 'PUT', body: { status } });
    await this.renderCharter();
  },
  async deleteRisk(id) {
    if (!confirm('Delete this risk?')) return;
    await this.api(`/api/risks/${id}`, { method: 'DELETE' });
    await this.renderCharter();
  },

  // Technical / Both / Non-technical is stored as a normal task tag, so it also shows in the Table Grid.
  async setTaskType(taskId, type) {
    const TYPE_TAGS = ['technical', 'non-technical', 'nontechnical', 'both'];
    let task = (this.state.tasks || []).find(t => Number(t.id) === Number(taskId));
    if (!task) task = await this.api(`/api/tasks/${taskId}`);
    const kept = (task.tags || []).filter(t => !TYPE_TAGS.includes(String(t).trim().toLowerCase()));
    if (type === 'technical') kept.push('Technical');
    if (type === 'both') kept.push('Both');
    if (type === 'nontechnical') kept.push('Non-technical');
    await this.api(`/api/tasks/${taskId}`, { method: 'PUT', body: { tags: kept } });
    if (task) task.tags = kept;
    await this.renderCharter();
  },
});
