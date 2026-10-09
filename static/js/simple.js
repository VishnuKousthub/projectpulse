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
  getLandingView() {
    const role = this.getUserRole();
    if (role === 'lead' || role === 'assignee' || role === 'member' || role === 'developer') {
      return 'table';
    }
    return FEATURES.landingView || 'dashboard';
  },

  applySimpleMode() {
    if (FEATURES.advancedViews) return;
    ['kanban', 'calendar', 'resources', 'analytics'].forEach(v => {
      const el = document.getElementById(`nav-${v}`);
      if (el) el.style.display = 'none';
    });
    const reset = document.getElementById('sidebar-reset-demo-btn');
    if (reset) reset.style.display = 'none';

    const role = this.getUserRole();
    const isAdmin = (role === 'admin');
    const isProgress = this.isProgressOnly();

    const navUsers = document.getElementById('nav-users');
    if (navUsers) {
      navUsers.style.display = isAdmin ? '' : 'none';
    }

    const navCharter = document.getElementById('nav-charter');
    if (navCharter) {
      navCharter.style.display = this.isFullAccess() ? '' : 'none';
    }

    const navDashboard = document.getElementById('nav-dashboard');
    if (navDashboard) {
      navDashboard.style.display = isProgress ? 'none' : '';
    }

    const count = document.getElementById('core-views-count');
    if (count) {
      if (isAdmin) count.textContent = '5';
      else if (isProgress) count.textContent = '3';
      else count.textContent = '4';
    }
  },

  fmtDate(value) {
    if (!value) return '—';
    const d = new Date(String(value).slice(0, 10) + 'T00:00:00');
    if (isNaN(d)) return this.escapeHtml(String(value));
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  formatINR(amount) {
    if (amount == null || amount === '' || isNaN(Number(amount))) return '₹0';
    const num = Math.round(Number(amount));
    const isNeg = num < 0;
    let s = Math.abs(num).toString();
    if (s.length > 3) {
      const lastThree = s.slice(-3);
      const otherNumbers = s.slice(0, -3);
      s = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree;
    }
    return (isNeg ? '-' : '') + '₹' + s;
  },

  fmtRupee(amount) {
    return this.formatINR(amount);
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

    const canCharter = this.isFullAccess();

    const delivRows = d.deliverables.length ? d.deliverables.map(x => `
      <tr class="border-t border-slate-100 dark:border-slate-700/60 ${canCharter ? 'hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer' : ''}"
          ${canCharter ? `onclick="app.openProjectFromDashboard(${x.project_id}, 'charter')"` : ''}>
        <td class="${UI.td}"><div class="font-semibold text-slate-900 dark:text-white">${esc(x.title)}</div>
          <div class="text-[10px] text-slate-400 truncate max-w-[240px]">${esc(x.project_name)}${x.quantity ? ' · ' + esc(x.quantity) : ''}</div></td>
        <td class="${UI.td} text-right whitespace-nowrap">${this.fmtDate(x.dispatch_date || x.due_date)}
          <div class="text-[10px] text-slate-400">${this.daysLabel(x.days_left)}</div></td>
      </tr>`).join('') : `<tr><td colspan="2" class="py-6 text-center text-xs text-slate-400">No upcoming dispatches.${canCharter ? " Add them on a project's Charter page." : ""}</td></tr>`;

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
      <div class="py-2 border-t first:border-t-0 border-slate-100 dark:border-slate-700/60 cursor-pointer hover:opacity-80"
           onclick="app.openProjectFromDashboard(${r.project_id}, 'table')">
        <div class="text-xs font-semibold text-slate-900 dark:text-white"><span class="font-mono text-rose-600">${esc(r.risk_code || '')}</span> ${esc(r.description)}</div>
        <div class="text-[10px] text-slate-400 truncate">${r.task_title ? `${esc(r.task_title)} · ` : ''}${esc(r.project_name)}${r.owner ? ' · ' + esc(r.owner) : ''}</div>
      </div>`).join('') : '<div class="py-4 text-xs text-slate-400 text-center">No open high-impact risks.</div>';

    const panel = (title, sub, body) => `
      <div class="${UI.card} overflow-hidden">
        <div class="px-4 py-3 border-b border-slate-100 dark:border-slate-700/60">
          <h3 class="text-sm font-bold text-slate-800 dark:text-white">${title}</h3>
          ${sub ? `<div class="text-[11px] text-slate-400">${sub}</div>` : ''}
        </div>${body}
      </div>`;

    root.innerHTML = `
      <div class="grid grid-cols-1 xl:grid-cols-12 gap-5 mb-5">
        <div class="${UI.card} p-5 flex flex-col h-[340px] xl:col-span-5">
          <div class="mb-3">
            <h3 class="text-sm font-bold text-slate-800 dark:text-white">Projects by Health</h3>
            <div class="text-[11px] text-slate-400">Project distribution across delivery status</div>
          </div>
          <div id="dashboard-health-chart-container" class="relative flex-1 min-h-0 flex items-center justify-center">
            <canvas id="dashboardHealthChart" class="w-full h-full"></canvas>
          </div>
        </div>

        <div class="${UI.card} p-5 flex flex-col h-[340px] xl:col-span-7">
          <div class="mb-3">
            <h3 class="text-sm font-bold text-slate-800 dark:text-white">Task Status by Project</h3>
            <div class="text-[11px] text-slate-400">Done, in progress, to do and overdue tasks (up to 8 projects)</div>
          </div>
          <div id="dashboard-status-chart-container" class="relative flex-1 min-h-0 flex items-center justify-center">
            <canvas id="dashboardStatusChart" class="w-full h-full"></canvas>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-5 gap-3">
        ${tile('Projects', k.projects, `${k.total_tasks} tasks in total`)}
        ${tile('Overdue tasks', k.overdue_tasks, 'past their due date', k.overdue_tasks ? 'text-rose-600' : '')}
        ${tile('Due this week', k.due_this_week, 'next 7 days', k.due_this_week ? 'text-amber-600' : '')}
        ${tile('Overall progress', k.completion_pct + '%', 'tasks marked done')}
        ${tile('High risks open', k.open_high_risks, 'from activities', k.open_high_risks ? 'text-rose-600' : '')}
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
        ${panel('Upcoming dispatches', 'Soonest first', `
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

    ['dashboardHealth', 'dashboardStatus'].forEach(k => {
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
    const healthLabels = ['On track', 'At risk', 'Delayed', 'Done'];
    const healthKeys = ['on_track', 'at_risk', 'delayed', 'done'];
    const healthColors = ['#10B981', '#F59E0B', '#F43F5E', '#3B82F6'];
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
            labels: healthLabels,
            datasets: [{
              data: healthKeys.map(k => healthCounts[k]),
              backgroundColor: healthColors,
              borderColor: isDark ? '#1E293B' : '#FFFFFF',
              borderWidth: 2,
              borderRadius: 6,
              spacing: 3,
              hoverOffset: 6
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
              padding: { top: 6, bottom: 6, left: 6, right: 12 }
            },
            onClick: (evt, elements) => {
              if (elements && elements.length > 0) {
                const tableEl = document.querySelector('table');
                if (tableEl) tableEl.scrollIntoView({ behavior: 'smooth' });
              }
            },
            onHover: (evt, elements) => {
              evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
            },
            plugins: {
              legend: {
                position: 'right',
                align: 'center',
                labels: {
                  usePointStyle: true,
                  pointStyle: 'circle',
                  boxWidth: 8,
                  boxHeight: 8,
                  padding: 14,
                  color: textColor,
                  font: { size: 11, weight: '500' },
                  generateLabels(chart) {
                    const data = chart.data;
                    if (!data.labels.length || !data.datasets.length) return [];
                    const ds = data.datasets[0];
                    const tot = ds.data.reduce((acc, val) => acc + val, 0);
                    const labels = [];
                    data.labels.forEach((label, i) => {
                      const val = ds.data[i];
                      if (val === 0) return; // Omit statuses that have 0 projects
                      const pct = tot ? Math.round((val / tot) * 100) : 0;
                      labels.push({
                        text: `${label}   ${val} (${pct}%)`,
                        fillStyle: ds.backgroundColor[i],
                        strokeStyle: ds.backgroundColor[i],
                        lineWidth: 0,
                        hidden: false,
                        index: i
                      });
                    });
                    return labels;
                  }
                }
              },
              tooltip: {
                backgroundColor: tooltipBg,
                callbacks: {
                  label: (ctx) => ` ${ctx.label}: ${ctx.raw} (${totalProjects ? Math.round(ctx.raw / totalProjects * 100) : 0}%)`
                }
              }
            },
            cutout: '68%'
          },
          plugins: [{
            id: 'healthCenterCount',
            beforeDraw(chart) {
              const { chartArea, ctx } = chart;
              if (!chartArea) return;
              const centerX = (chartArea.left + chartArea.right) / 2;
              const centerY = (chartArea.top + chartArea.bottom) / 2;
              ctx.save();
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.font = 'bold 26px sans-serif';
              ctx.fillStyle = isDark ? '#F8FAFC' : '#0F172A';
              ctx.fillText(String(totalProjects), centerX, centerY - 10);

              ctx.font = '11px sans-serif';
              ctx.fillStyle = isDark ? '#94A3B8' : '#64748B';
              ctx.fillText(totalProjects === 1 ? 'project' : 'projects', centerX, centerY + 14);
              ctx.restore();
            }
          }]
        });
      }
    }

    // 2. Vertical Stacked Bar: Task Status by Project
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
            labels: sortedProjects.map(p => p.name.length > 14 ? p.name.slice(0, 13) + '…' : p.name),
            datasets: [
              {
                label: 'Done',
                data: sortedProjects.map(p => p.status_counts ? p.status_counts.done : p.done_tasks || 0),
                backgroundColor: '#10B981',
                borderRadius: { topLeft: 4, topRight: 4 },
                barPercentage: 0.6
              },
              {
                label: 'In progress',
                data: sortedProjects.map(p => p.status_counts ? p.status_counts.in_progress : 0),
                backgroundColor: '#3B82F6',
                borderRadius: { topLeft: 4, topRight: 4 },
                barPercentage: 0.6
              },
              {
                label: 'To do',
                data: sortedProjects.map(p => p.status_counts ? p.status_counts.todo : 0),
                backgroundColor: '#94A3B8',
                borderRadius: { topLeft: 4, topRight: 4 },
                barPercentage: 0.6
              },
              {
                label: 'Overdue',
                data: sortedProjects.map(p => p.status_counts ? p.status_counts.overdue : p.overdue_tasks || 0),
                backgroundColor: '#F43F5E',
                borderRadius: { topLeft: 4, topRight: 4 },
                barPercentage: 0.6
              }
            ]
          },
          options: {
            indexAxis: 'x',
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
                grid: { display: false },
                ticks: { color: textColor, font: { size: 10 } }
              },
              y: {
                stacked: true,
                grid: { color: gridColor, borderDash: [4, 4], drawBorder: false },
                ticks: { color: textColor, precision: 0, font: { size: 10 } }
              }
            },
            plugins: {
              legend: {
                position: 'top',
                align: 'end',
                labels: {
                  usePointStyle: true,
                  pointStyle: 'circle',
                  boxWidth: 6,
                  boxHeight: 6,
                  padding: 12,
                  font: { size: 10, weight: '500' },
                  color: textColor
                }
              },
              tooltip: {
                backgroundColor: tooltipBg,
                callbacks: {
                  title: (items) => {
                    const idx = items[0].dataIndex;
                    return sortedProjects[idx]?.name || '';
                  },
                  label: (ctx) => {
                    const p = sortedProjects[ctx.dataIndex];
                    const tot = p.total_tasks || 0;
                    const val = ctx.raw || 0;
                    const pct = tot ? Math.round((val / tot) * 100) : 0;
                    return ` ${ctx.dataset.label}: ${val} (${pct}%)`;
                  },
                  footer: (items) => {
                    const idx = items[0].dataIndex;
                    const p = sortedProjects[idx];
                    return `Total: ${p.total_tasks || 0} tasks`;
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
      const [charterData, chemists] = await Promise.all([
        this.api(`/api/projects/${pid}/charter`),
        this.api('/api/chemists').catch(() => [])
      ]);
      c = charterData;
      this.state.chemists = chemists || [];
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

    const chemistsList = this.state.chemists || [];
    const chemistSelect = `
      <div class="flex items-center gap-1.5">
        <select id="cf-chemist" class="${UI.input} flex-1" onchange="if(this.value==='__NEW__'){app.promptNewChemist();}">
          <option value="">Select Chemist…</option>
          ${chemistsList.map(ch => `<option value="${esc(ch.name)}" ${ch.name === p.chemist_name ? 'selected' : ''}>${esc(ch.name)}</option>`).join('')}
          <option value="__NEW__" class="font-bold text-blue-600">+ Add new chemist…</option>
        </select>
        <button type="button" onclick="app.promptNewChemist()" class="${UI.btn} ${UI.btnGhost} !px-2.5" title="Add new chemist">+</button>
      </div>`;

    const header = `
      <div class="${UI.card} p-5">
        <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 class="text-base font-extrabold text-slate-800 dark:text-white">Project Charter</h2>
            <div class="text-[11px] text-slate-400">Project Scope</div>
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
          ${field('Customer name', esc(p.customer_name), inp('cf-customer', p.customer_name))}
          ${field('Project manager', esc(p.project_manager),
              inp('cf-pm', p.project_manager, 'text', 'list="cf-members"') +
              `<datalist id="cf-members">${(c.members || []).map(m => `<option value="${esc(m)}">`).join('')}</datalist>`)}
          ${field('Chemist name', esc(p.chemist_name), chemistSelect)}
          ${field('Project received date', this.fmtDate(p.received_date) === '—' ? '' : this.fmtDate(p.received_date), inp('cf-received', p.received_date, 'date'))}
          ${field('Project delivery date', this.fmtDate(p.delivery_date) === '—' ? '' : this.fmtDate(p.delivery_date), inp('cf-delivery', p.delivery_date, 'date'))}
          ${field('Total deliverable quantity', esc(p.total_deliverable_quantity), inp('cf-quantity', p.total_deliverable_quantity, 'text', 'placeholder="e.g. 500 g or 10 kg"'))}
          ${field('Project budget', this.formatINR(p.project_budget), inp('cf-budget', p.project_budget != null ? p.project_budget : 0, 'number', 'min="0" step="any" placeholder="0"'))}
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

    // ---------- deliverables (friendly card look)
    const renderDispatchChip = (dispatchDateStr) => {
      if (!dispatchDateStr) return '';
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const parts = String(dispatchDateStr).slice(0, 10).split('-');
        if (parts.length < 3) return `<span class="inline-flex items-center text-[10px] text-slate-400"><i data-lucide="calendar" class="w-2.5 h-2.5 mr-1"></i>${dispatchDateStr.slice(0, 10)}</span>`;
        const target = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        target.setHours(0, 0, 0, 0);
        const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));
        if (diffDays > 0) {
          return `<span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800/60"><i data-lucide="clock" class="w-3 h-3"></i>${diffDays}d to dispatch</span>`;
        } else if (diffDays === 0) {
          return `<span class="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60"><i data-lucide="alert-circle" class="w-3 h-3"></i>Dispatch today</span>`;
        } else {
          return `<span class="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-700/60 dark:text-slate-300 border border-slate-200 dark:border-slate-700"><i data-lucide="check-circle-2" class="w-3 h-3"></i>dispatched ${Math.abs(diffDays)}d ago</span>`;
        }
      } catch (e) {
        return '';
      }
    };

    const renderCard = (d) => `
      <div class="bg-white dark:bg-slate-800/90 p-4 rounded-xl border border-slate-200 dark:border-slate-700/80 shadow-sm hover:shadow transition-shadow flex flex-col justify-between">
        <div>
          <div class="flex items-start justify-between gap-2 mb-2">
            <div class="flex items-center gap-2">
              <span class="text-xl">📦</span>
              <h4 class="text-xs font-bold text-slate-900 dark:text-white leading-snug">${esc(d.title)}</h4>
            </div>
            ${canEdit ? `
              <div class="flex items-center -mr-1 -mt-1 opacity-70 hover:opacity-100">
                <button onclick="app.editCharterRow('deliverable', ${d.id})" class="${UI.iconBtn} !p-1" title="Edit"><i data-lucide="pencil" class="w-3.5 h-3.5"></i></button>
                <button onclick="app.deleteDeliverable(${d.id})" class="${UI.iconBtn} !p-1 hover:!text-rose-600" title="Delete"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
              </div>` : ''}
          </div>
          <div class="text-[11px] text-slate-500 dark:text-slate-400 space-y-1 mb-3">
            <div><span class="text-slate-400 font-medium">Quantity:</span> <strong class="text-slate-700 dark:text-slate-300">${esc(d.quantity || '—')}</strong></div>
            <div><span class="text-slate-400 font-medium">Quality:</span> <strong class="text-slate-700 dark:text-slate-300">${esc(d.quality || '—')}</strong></div>
          </div>
        </div>
        <div class="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-700/60">
          <div>${renderDispatchChip(d.dispatch_date || d.due_date)}</div>
          <div class="text-[10px] text-slate-400 font-mono">${this.fmtDate(d.dispatch_date || d.due_date)}</div>
        </div>
      </div>`;

    const editingDeliv = edit.kind === 'deliverable' ? (c.deliverables.find(x => x.id === edit.id) || {}) : null;
    const formHtml = editingDeliv ? `
      <div class="m-4 p-4 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-slate-800/80 shadow-sm">
        <div class="flex items-center justify-between mb-3">
          <h4 class="text-xs font-bold uppercase tracking-wider text-blue-900 dark:text-blue-300">
            ${editingDeliv.id ? `Edit Deliverable #${editingDeliv.id}` : 'Add New Deliverable'}
          </h4>
          <button onclick="app.cancelCharterRow()" class="${UI.iconBtn}"><i data-lucide="x" class="w-4 h-4"></i></button>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <div>
            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Deliverable *</label>
            ${inp('cd-title', editingDeliv.title, 'text', 'placeholder="e.g. AZADOL Batch"')}
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Quantity</label>
            ${inp('cd-qty', editingDeliv.quantity, 'text', 'placeholder="e.g. 1 kg"')}
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Quality</label>
            ${inp('cd-quality', editingDeliv.quality, 'text', 'placeholder="e.g. Purity ≥ 99%"')}
          </div>
          <div>
            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Dispatch date</label>
            ${inp('cd-dispatch', editingDeliv.dispatch_date || editingDeliv.due_date, 'date')}
          </div>
        </div>
        <div class="flex items-center justify-end gap-2">
          <button onclick="app.cancelCharterRow()" class="${UI.btn} ${UI.btnGhost}">Cancel</button>
          <button onclick="app.saveDeliverable(${editingDeliv.id || 0})" class="${UI.btn} ${UI.btnPrimary}">
            ${editingDeliv.id ? 'Save changes' : 'Add deliverable'}
          </button>
        </div>
      </div>` : '';

    const emptyState = `
      <div class="p-10 text-center flex flex-col items-center justify-center">
        <div class="text-4xl mb-3">📦</div>
        <h4 class="text-sm font-bold text-slate-800 dark:text-white mb-1">No deliverables logged yet</h4>
        <p class="text-xs text-slate-400 max-w-sm mb-4">Track deliverable batches, quantities, quality specifications, and dispatch dates.</p>
        ${canEdit ? `<button onclick="app.editCharterRow('deliverable', 0)" class="${UI.btn} ${UI.btnPrimary}"><i data-lucide="plus" class="w-4 h-4"></i>Add your first deliverable</button>` : ''}
      </div>`;

    const deliverables = `
      <div class="${UI.card} overflow-hidden">
        <div class="px-5 py-3 flex items-center justify-between border-b border-slate-100 dark:border-slate-700/60">
          <div>
            <h3 class="text-sm font-bold text-slate-800 dark:text-white">Project deliverables</h3>
            <div class="text-[11px] text-slate-400">Batches, specifications, quantities and dispatch dates</div>
          </div>
          ${canEdit ? `<button onclick="app.editCharterRow('deliverable', 0)" class="${UI.btn} ${UI.btnGhost}"><i data-lucide="plus" class="w-3.5 h-3.5"></i>Add deliverable</button>` : ''}
        </div>
        ${formHtml}
        ${!c.deliverables.length && !formHtml ? emptyState : `
          <div class="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            ${c.deliverables.map(d => renderCard(d)).join('')}
          </div>
        `}
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
    root.innerHTML = header + deliverables + milestones;
    this.initLucide();
  },

  // -- header edit
  editCharterHeader() { this.state.charterEditHeader = true; this.paintCharter(); },
  cancelCharterHeader() { this.state.charterEditHeader = false; this.paintCharter(); },
  async promptNewChemist() {
    const sel = document.getElementById('cf-chemist');
    const name = (prompt('Enter new chemist name:') || '').trim();
    if (!name) {
      if (sel && sel.value === '__NEW__') sel.value = '';
      return;
    }
    try {
      let savedName = name;
      try {
        const res = await this.api('/api/chemists', {
          method: 'POST',
          body: { name }
        });
        savedName = res.name || name;
        this.showToast(`Chemist '${savedName}' added`, 'success');
      } catch (err) {
        if (err.message && err.message.includes('already exists')) {
          this.showToast(err.message, 'info');
        } else {
          throw err;
        }
      }
      const chemists = await this.api('/api/chemists').catch(() => []);
      this.state.chemists = chemists;
      if (sel) {
        sel.innerHTML = `
          <option value="">Select Chemist…</option>
          ${chemists.map(ch => `<option value="${this.escapeHtml(ch.name)}">${this.escapeHtml(ch.name)}</option>`).join('')}
          <option value="__NEW__" class="font-bold text-blue-600">+ Add new chemist…</option>
        `;
        const matched = chemists.find(c => c.name.toLowerCase() === savedName.toLowerCase());
        sel.value = matched ? matched.name : '';
      }
    } catch (e) {
      this.showToast(e.message || 'Failed to add chemist', 'error');
      if (sel && sel.value === '__NEW__') sel.value = '';
    }
  },
  async saveCharterHeader() {
    const v = (id) => document.getElementById(id)?.value ?? '';
    const name = v('cf-name').trim();
    if (!name) { this.showToast('Project name is required', 'error'); return; }

    const rec = v('cf-received');
    const del = v('cf-delivery');
    if (rec && del && del < rec) {
      this.showToast('Project delivery date must be on or after received date', 'error');
      return;
    }

    const budgetRaw = v('cf-budget');
    const budget = budgetRaw !== '' ? Number(budgetRaw) : 0;
    if (isNaN(budget) || budget < 0) {
      this.showToast('Project budget must be a non-negative number', 'error');
      return;
    }

    let chemistVal = v('cf-chemist');
    if (chemistVal === '__NEW__') chemistVal = '';

    const pid = this.state.currentProjectId;
    try {
      await this.api(`/api/projects/${pid}`, {
        method: 'PUT',
        body: {
          name,
          project_code: v('cf-code'),
          cas_no: v('cf-cas'),
          customer_name: v('cf-customer'),
          project_manager: v('cf-pm'),
          chemist_name: chemistVal,
          received_date: rec,
          delivery_date: del,
          total_deliverable_quantity: v('cf-quantity'),
          project_budget: budget,
        },
      });
      this.state.charterEditHeader = false;
      this.showToast('Charter saved', 'success');
      // refresh project list (name may have changed) and this page
      const list = await this.api('/api/projects');
      this.state.projects = list;
      if (this.state.currentProjectId) {
        const updatedP = list.find(x => x.id === this.state.currentProjectId);
        if (updatedP) {
          this.state.currentProject = { ...(this.state.currentProject || {}), ...updatedP };
        }
      }
      this.renderProjectsDropdown();
      this.renderProjectsSidebar();
      await this.renderCharter();
    } catch (e) {
      this.showToast(e.message || 'Failed to save charter', 'error');
    }
  },

  // -- row edit helpers
  editCharterRow(kind, id) { this.state.charterEdit = { kind, id }; this.paintCharter(); },
  cancelCharterRow() { this.state.charterEdit = null; this.paintCharter(); },

  async saveDeliverable(id) {
    const v = (x) => document.getElementById(x)?.value ?? '';
    const body = {
      title: v('cd-title'),
      quantity: v('cd-qty'),
      quality: v('cd-quality'),
      dispatch_date: v('cd-dispatch')
    };
    if (!body.title.trim()) { this.showToast('Deliverable name is required', 'error'); return; }
    if (id) await this.api(`/api/deliverables/${id}`, { method: 'PUT', body });
    else await this.api(`/api/projects/${this.state.currentProjectId}/deliverables`, { method: 'POST', body });
    this.state.charterEdit = null;
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

  // ---------------------------------------------------------------- users (admin only)
  async renderUsers() {
    const root = document.getElementById('view-users-container');
    if (!root) return;

    const role = this.getUserRole();
    if (role !== 'admin') {
      this.switchView(this.getLandingView());
      return;
    }

    try {
      const users = await this.api('/api/users');
      this.state.usersList = users || [];
    } catch (e) {
      this.showToast(e.message || 'Failed to load users', 'error');
      this.state.usersList = [];
    }

    this.paintUsers();
  },

  paintUsers() {
    const root = document.getElementById('view-users-container');
    if (!root) return;

    const users = this.state.usersList || [];
    const currentUserId = this.state.user?.id;
    const showAddForm = !!this.state.showAddUserForm;
    const esc = (s) => this.escapeHtml(s || '');

    root.innerHTML = `
      <div class="space-y-4">
        <!-- Header -->
        <div class="${UI.card} p-5">
          <div class="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div class="flex items-center gap-2.5">
                <h2 class="text-lg font-black text-slate-900 dark:text-white">Users</h2>
                <span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-900/60">
                  ${users.length} account${users.length === 1 ? '' : 's'}
                </span>
              </div>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                <span class="font-bold text-slate-700 dark:text-slate-300">Roles:</span>
                Admin = everything, including Users and the advanced views; PM = everything except Users; Lead and Assignee = limited edit (status, assignee, dates, progress, hours, risks).
              </p>
            </div>
            <div>
              <button onclick="app.toggleAddUserForm(${!showAddForm})" class="${UI.btn} ${UI.btnPrimary}">
                <i data-lucide="${showAddForm ? 'x' : 'user-plus'}" class="w-4 h-4"></i>
                <span>${showAddForm ? 'Close form' : 'Add user'}</span>
              </button>
            </div>
          </div>

          <!-- Inline Add User Form Row -->
          ${showAddForm ? `
            <div class="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/60 bg-slate-50/70 dark:bg-slate-900/50 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
              <div class="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 mb-3 flex items-center gap-1.5">
                <i data-lucide="user-plus" class="w-3.5 h-3.5 text-blue-500"></i>
                <span>Add new user account</span>
              </div>
              <form onsubmit="event.preventDefault(); app.submitCreateUser();" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                <div>
                  <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Full Name *</label>
                  <input type="text" id="new-user-fullname" required placeholder="e.g. Alex Morgan" class="${UI.input}">
                </div>
                <div>
                  <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Username *</label>
                  <input type="text" id="new-user-username" required placeholder="e.g. alex" class="${UI.input}">
                </div>
                <div>
                  <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Email *</label>
                  <input type="email" id="new-user-email" required placeholder="alex@company.com" class="${UI.input}">
                </div>
                <div>
                  <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Temp Password (min 8) *</label>
                  <input type="password" id="new-user-password" required minlength="8" placeholder="••••••••" class="${UI.input}">
                </div>
                <div>
                  <label class="block text-[10px] font-bold text-slate-500 uppercase mb-1">Role *</label>
                  <select id="new-user-role" class="${UI.input} font-semibold">
                    <option value="assignee">Assignee</option>
                    <option value="lead">Lead</option>
                    <option value="pm">PM</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div class="sm:col-span-2 lg:col-span-5 flex items-center justify-end gap-2 pt-2">
                  <button type="button" onclick="app.toggleAddUserForm(false)" class="${UI.btn} ${UI.btnGhost}">Cancel</button>
                  <button type="submit" class="${UI.btn} ${UI.btnPrimary}">
                    <i data-lucide="check" class="w-3.5 h-3.5"></i>
                    <span>Create account</span>
                  </button>
                </div>
              </form>
            </div>
          ` : ''}
        </div>

        <!-- Users Table Card -->
        <div class="${UI.card} overflow-hidden">
          <div class="overflow-x-auto min-w-[720px]">
            <table class="w-full text-left text-xs border-collapse">
              <thead class="bg-slate-50 dark:bg-slate-900 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th class="${UI.th}">Name & Username</th>
                  <th class="${UI.th}">Email</th>
                  <th class="${UI.th}">Role</th>
                  <th class="${UI.th}">Status</th>
                  <th class="${UI.th}">Last Login</th>
                  <th class="${UI.th} text-right">Actions</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-100 dark:divide-slate-700/60">
                ${users.map(u => {
                  const isSelf = (Number(u.id) === Number(currentUserId));
                  const active = (u.is_active !== 0);
                  const roleCls = {
                    admin: 'border-blue-500 text-blue-600 dark:text-blue-400 font-bold',
                    pm: 'border-indigo-500 text-indigo-600 dark:text-indigo-400 font-bold',
                    lead: 'border-purple-500 text-purple-600 dark:text-purple-400 font-bold',
                    assignee: 'border-emerald-500 text-emerald-600 dark:text-emerald-400 font-semibold'
                  }[u.role] || '';

                  return `
                    <tr class="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                      <td class="${UI.td}">
                        <div class="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <span>${esc(u.full_name)}</span>
                          ${isSelf ? `<span class="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300">You</span>` : ''}
                        </div>
                        <div class="text-[11px] text-slate-400 font-mono">@${esc(u.username)}</div>
                      </td>
                      <td class="${UI.td} font-mono text-[11px]">
                        ${esc(u.email)}
                      </td>
                      <td class="${UI.td}">
                        <select
                          onchange="app.changeUserRole(${u.id}, this.value, this, '${u.role}')"
                          class="${UI.input} !w-auto font-semibold ${roleCls}"
                          ${isSelf ? 'disabled title="Administrators cannot change their own role"' : ''}>
                          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
                          <option value="pm" ${u.role === 'pm' ? 'selected' : ''}>PM</option>
                          <option value="lead" ${u.role === 'lead' ? 'selected' : ''}>Lead</option>
                          <option value="assignee" ${u.role === 'assignee' ? 'selected' : ''}>Assignee</option>
                        </select>
                      </td>
                      <td class="${UI.td}">
                        <button
                          type="button"
                          onclick="app.toggleUserStatus(${u.id}, ${!active}, this, ${active})"
                          class="px-2.5 py-1 rounded-full text-[11px] font-bold border transition flex items-center gap-1.5 ${
                            active
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800 hover:bg-emerald-100'
                              : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800 hover:bg-rose-100'
                          } ${isSelf ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}"
                          ${isSelf ? 'disabled title="Administrators cannot disable their own account"' : ''}>
                          <span class="w-1.5 h-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-rose-500'}"></span>
                          <span>${active ? 'Active' : 'Disabled'}</span>
                        </button>
                      </td>
                      <td class="${UI.td} text-[11px] text-slate-400">
                        ${u.last_login ? this.fmtDate(u.last_login) : '<span class="italic text-slate-400">Never</span>'}
                      </td>
                      <td class="${UI.td} text-right">
                        <button
                          type="button"
                          onclick="app.promptResetPassword(${u.id}, '${esc(u.username)}')"
                          class="${UI.btn} ${UI.btnGhost} !h-7 !px-2.5 !text-[11px]"
                          title="Reset temporary password">
                          <i data-lucide="key" class="w-3 h-3 text-slate-500"></i>
                          <span>Reset password</span>
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    this.initLucide();
  },

  toggleAddUserForm(show) {
    this.state.showAddUserForm = show;
    this.paintUsers();
    if (show) {
      document.getElementById('new-user-fullname')?.focus();
    }
  },

  async submitCreateUser() {
    const fullName = document.getElementById('new-user-fullname')?.value?.trim();
    const username = document.getElementById('new-user-username')?.value?.trim();
    const email = document.getElementById('new-user-email')?.value?.trim();
    const password = document.getElementById('new-user-password')?.value;
    const role = document.getElementById('new-user-role')?.value;

    if (!fullName || !username || !email || !password || !role) {
      this.showToast('Please fill in all required fields', 'error');
      return;
    }
    if (password.length < 8) {
      this.showToast('Password must be at least 8 characters', 'error');
      return;
    }

    try {
      await this.api('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          full_name: fullName,
          username: username,
          email: email,
          password: password,
          role: role
        })
      });
      this.showToast(`User account @${username} created successfully`, 'success');
      this.state.showAddUserForm = false;
      await this.renderUsers();
    } catch (e) {
      this.showToast(e.message || 'Failed to create user', 'error');
    }
  },

  async changeUserRole(userId, newRole, selectEl, oldRole) {
    const isToAdmin = (newRole === 'admin');
    const isFromAdmin = (oldRole === 'admin');
    if (isToAdmin || isFromAdmin) {
      const msg = isToAdmin
        ? `Are you sure you want to promote this user to Administrator? They will have full system access.`
        : `Are you sure you want to change this Administrator's role to ${newRole.toUpperCase()}?`;
      if (!confirm(msg)) {
        if (selectEl) selectEl.value = oldRole;
        return;
      }
    }

    try {
      await this.api(`/api/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ role: newRole })
      });
      this.showToast('User role updated successfully', 'success');
      await this.renderUsers();
    } catch (e) {
      if (selectEl) selectEl.value = oldRole;
      this.showToast(e.message || 'Failed to update user role', 'error');
    }
  },

  async toggleUserStatus(userId, newStatus, btnEl, oldStatus) {
    if (!newStatus) {
      if (!confirm('Are you sure you want to disable this account? Any active sessions will be terminated immediately.')) {
        return;
      }
    }

    try {
      await this.api(`/api/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: newStatus ? 1 : 0 })
      });
      this.showToast(newStatus ? 'Account enabled successfully' : 'Account disabled successfully', 'success');
      await this.renderUsers();
    } catch (e) {
      this.showToast(e.message || 'Failed to update account status', 'error');
    }
  },

  async promptResetPassword(userId, username) {
    const newPassword = prompt(`Enter new temporary password for @${username} (min 8 characters):`);
    if (newPassword === null) return;
    if (newPassword.length < 8) {
      this.showToast('Password must be at least 8 characters long', 'error');
      return;
    }

    try {
      await this.api(`/api/users/${userId}/reset_password`, {
        method: 'POST',
        body: JSON.stringify({ new_password: newPassword })
      });
      this.showToast(`Password reset for @${username}. All existing sessions were invalidated.`, 'success');
    } catch (e) {
      this.showToast(e.message || 'Failed to reset password', 'error');
    }
  },
});
