// 全局状态
let currentData = { requirements: [], sprints: [], drafts: [] };
let settings = { statusList: [], priorityList: [] };
let currentProductLine = '';
let currentReqId = null;
let currentPlatform = 'web';
let docPanelOpen = false;
let docEditMode = false;
let draggedReqId = null;
let isSearchMode = false;
let lastSearchQuery = '';
let activeFilters = { status: null, priority: null, sprint: null, developer: '', requester: '' }; // 高级筛选状态
let statusViewMode = 'list'; // 'card' | 'list'
let sprintViewMode = 'card'; // 迭代视图模式: 'card' | 'list'
let currentSprint = null; // 当前选中的迭代名称（null 表示空迭代）
let previousPage = 'home'; // 'home' | 'list' | 'archive' | 'sprint' | 'drafts'
let docIsDirty = false; // 文档是否被修改过

// 需求池状态
let draftTypeFilter = ''; // '' | 'idea' | 'prototype'
let draftStatusFilter = ''; // '' | 'draft' | 'in_progress' | 'published' | 'archived'
let currentDraftId = null;

// Toast 提示 - Apple 风格
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  const bgClass = type === 'success' ? 'bg-ink-800' : type === 'error' ? 'bg-red-500' : 'bg-ink-800';
  toast.className = `toast ${bgClass} fixed bottom-6 right-6 z-50`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

// 初始化自定义状态/优先级样式（Apple 灰度风格）
function initCustomStyles() {
  const defaultStatuses = ['设计中', '待评审', '开发中', '待验收', '已完成', '挂起'];
  const defaultPriorities = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'];

  // Apple 灰度状态配色
  const statusPalette = [
    { bg: '#e8e5e0', text: '#4a433c' },
    { bg: '#e8e5e0', text: '#4a433c' },
    { bg: '#e8e5e0', text: '#4a433c' },
    { bg: '#e8e5e0', text: '#4a433c' },
    { bg: '#c8d1bd', text: '#2e3829' },
    { bg: '#e8cdb3', text: '#523624' },
  ];
  // Apple 灰度优先级配色
  const priorityPalette = [
    { bg: '#c46e52', text: '#ffffff' },
    { bg: '#d98f78', text: '#ffffff' },
    { bg: '#eab9a8', text: '#52271f' },
    { bg: '#c8d1bd', text: '#2e3829' },
    { bg: '#d4cfc7', text: '#4a433c' },
    { bg: '#c8d1bd', text: '#2e3829' },
  ];

  const allStatuses = settings.statusList || [];
  const allPriorities = settings.priorityList || [];

  // 为用户添加的自定义状态注入样式（不在默认列表中的）
  allStatuses.forEach((status, i) => {
    if (defaultStatuses.includes(status)) return;
    const idx = i % statusPalette.length;
    const colors = statusPalette[idx];
    const key = CSS.escape(status);
    if (!document.getElementById(`dyn-status-${key}`)) {
      const style = document.createElement('style');
      style.id = `dyn-status-${key}`;
      style.textContent = `.status-${key} { background: ${colors.bg}; color: ${colors.text}; }`;
      document.head.appendChild(style);
    }
  });

  // 为用户添加的自定义优先级注入样式
  allPriorities.forEach((priority, i) => {
    if (defaultPriorities.includes(priority)) return;
    const idx = i % priorityPalette.length;
    const colors = priorityPalette[idx];
    const key = CSS.escape(priority);
    if (!document.getElementById(`dyn-priority-${key}`)) {
      const style = document.createElement('style');
      style.id = `dyn-priority-${key}`;
      style.textContent = `.priority-${key} { background: ${colors.bg}; color: ${colors.text}; }`;
      document.head.appendChild(style);
    }
  });
}

// 初始化
async function init() {
  await loadSettings();
  initCustomStyles();
  await refreshData();
  showHome();
}

// 加载设置
async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      settings = await res.json();
    }
  } catch (e) {
    console.error('加载设置失败:', e);
  }
}

// 刷新数据
async function refreshData() {
  try {
    const [reqRes, sprintRes, draftRes] = await Promise.all([
      fetch('/api/requirements'),
      fetch('/api/sprints'),
      fetch('/api/drafts')
    ]);

    const reqData = await reqRes.json();
    const sprintData = await sprintRes.json();
    const draftData = await draftRes.json();

    currentData.requirements = reqData.requirements;
    currentData.sprints = sprintData.sprints || [];
    currentData.drafts = draftData.drafts || [];

    if (!document.getElementById('home-page').classList.contains('hidden')) {
      renderHome();
    } else if (!document.getElementById('list-page').classList.contains('hidden')) {
      initFilterOptions();
      renderList();
    } else if (!document.getElementById('detail-page').classList.contains('hidden')) {
      renderDetail();
    } else if (!document.getElementById('sprint-page').classList.contains('hidden')) {
      renderSprintView();
    } else if (!document.getElementById('drafts-page').classList.contains('hidden')) {
      renderDraftsPage();
    } else if (!document.getElementById('draft-detail-page').classList.contains('hidden')) {
      renderDraftDetail();
    }
  } catch (e) {
    console.error('刷新数据失败:', e);
  }
}

// 产品线搜索功能
let productLineSearchQuery = '';
function performProductLineSearch() {
  const query = document.getElementById('product-line-search').value.trim().toLowerCase();
  productLineSearchQuery = query;
  renderHome();
}

// 渲染首页
function renderHome() {
  const statsContainer = document.getElementById('stats-container');
  const productLinesContainer = document.getElementById('product-lines');
  const archivedCard = document.getElementById('archived-card');

  // 动态统计：总需求 + 各状态数量（仅未归档需求，跟随设置中的状态定义）
  const stats = { total: currentData.requirements.filter(r => !r.isArchive).length };
  const statColors = { total: 'bg-ink-800 text-white' };
  const statLabels = { total: '总需求' };

  // Apple 灰度状态配色
  const statusColorPalette = [
    'bg-ink-50 text-ink-800',
    'bg-ink-50 text-ink-800',
    'bg-ink-50 text-ink-800',
    'bg-ink-50 text-ink-800',
    'bg-ink-200 text-ink-800',
    'bg-ink-100 text-ink-500',
    'bg-ink-50 text-ink-800',
    'bg-ink-50 text-ink-800',
  ];

  (settings.statusList || []).forEach((status, idx) => {
    stats[status] = currentData.requirements.filter(r => r.status === status && !r.isArchive).length;
    statColors[status] = statusColorPalette[idx % statusColorPalette.length];
    statLabels[status] = status;
  });

  const colCount = Object.keys(stats).length;
  statsContainer.style.gridTemplateColumns = `repeat(${colCount}, minmax(0, 1fr))`;
  statsContainer.className = 'grid gap-4';

  statsContainer.innerHTML = Object.entries(stats).map(([key, val]) => `
    <div class="${statColors[key]} rounded-2xl p-6 text-center">
      <div class="font-display text-4xl">${val}</div>
      <div class="text-xs mt-1 opacity-70" style="letter-spacing: 0.04em;">${statLabels[key]}</div>
    </div>
  `).join('');

  // 更新已归档卡片数量
  const archivedCount = currentData.requirements.filter(r => r.isArchive).length;
  if (archivedCard) {
    archivedCard.querySelector('.archived-count').textContent = archivedCount;
  }

  // 更新迭代入口计数
  const sprintEntry = document.getElementById('iteration-entry');
  if (sprintEntry) {
    sprintEntry.querySelector('.sprint-count').textContent = currentData.sprints.length;
  }
  
  // 更新需求池入口计数
  const draftsEntry = document.getElementById('drafts-entry');
  if (draftsEntry) {
    const draftsCount = currentData.drafts.filter(d => d.status !== 'published').length;
    draftsEntry.querySelector('.drafts-count').textContent = draftsCount;
  }

  // 收集所有唯一的产品线（仅未归档需求，合并 settings.productLines 和需求中的产品线）
  const settingsProductLines = settings.productLines || [];
  const reqProductLines = currentData.requirements
    .filter(r => !r.isArchive)
    .flatMap(r => Array.isArray(r.productLine) ? r.productLine : (r.productLine ? [r.productLine] : []));
  const productLines = [...new Set([...settingsProductLines, ...reqProductLines])];

  // 产品线搜索过滤
  const filteredProductLines = productLineSearchQuery
    ? productLines.filter(pl => pl.toLowerCase().includes(productLineSearchQuery))
    : productLines;

  productLinesContainer.innerHTML = filteredProductLines.map(pl => {
    const plReqs = currentData.requirements.filter(r => {
      const pls = Array.isArray(r.productLine) ? r.productLine : (r.productLine ? [r.productLine] : []);
      return pls.includes(pl) && !r.isArchive;
    });
    const statusBreakdown = (settings.statusList || []).map(s => {
      const count = plReqs.filter(r => r.status === s).length;
      return count > 0 ? `<span class="text-xs text-ink-500">${count} ${s}</span>` : '';
    }).filter(Boolean).join('<span class="text-ink-200 mx-2">·</span>');

    return `
      <div onclick="showList('${pl}')" class="product-card bg-white rounded-2xl border border-ink-100 p-6 cursor-pointer hover:border-ink-200 transition-colors">
        <div class="flex justify-between items-start mb-4">
          <h3 class="font-display text-lg text-ink-800">${pl}</h3>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="text-ink-200"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="font-display text-4xl text-ink-800 mb-1">${plReqs.length}</div>
        <div class="text-sm text-ink-500 mb-3">个需求</div>
        <div class="flex items-center flex-wrap gap-y-1">${statusBreakdown}</div>
      </div>
    `;
  }).join('');
}

// 显示首页
function showHome() {
  isSearchMode = false;
  lastSearchQuery = '';
  productLineSearchQuery = '';
  document.getElementById('global-search').value = '';
  const plSearch = document.getElementById('product-line-search');
  if (plSearch) plSearch.value = '';
  previousPage = 'home';
  hideAllPages();
  document.getElementById('home-page').classList.remove('hidden');
  renderHome();
}

// 显示列表页
function showList(productLine) {
  if (productLine) currentProductLine = productLine;
  isSearchMode = false;
  lastSearchQuery = '';
  const clearBtn = document.getElementById('clear-search-btn');
  if (clearBtn) clearBtn.classList.add('hidden');
  hideAllPages();
  document.getElementById('list-page').classList.remove('hidden');
  document.getElementById('list-title').textContent = currentProductLine;
  initFilterOptions();
  renderList();
}

// 搜索功能
function performSearch() {
  const query = document.getElementById('global-search').value.trim().toLowerCase();
  if (!query) return;

  isSearchMode = true;
  lastSearchQuery = query;

  hideAllPages();
  document.getElementById('list-page').classList.remove('hidden');
  document.getElementById('list-title').textContent = `搜索结果: "${query}"`;
  // 显示清除按钮
  const clearBtn = document.getElementById('clear-search-btn');
  if (clearBtn) clearBtn.classList.remove('hidden');
  renderList();
}

// 清除搜索
function clearSearch() {
  isSearchMode = false;
  lastSearchQuery = '';
  document.getElementById('global-search').value = '';
  const clearBtn = document.getElementById('clear-search-btn');
  if (clearBtn) clearBtn.classList.add('hidden');
  showList(currentProductLine);
}

// 初始化筛选器选项（优先级、迭代下拉）
function initFilterOptions() {
  const prioritySelect = document.getElementById('filter-priority');
  const sprintSelect = document.getElementById('filter-sprint');

  if (prioritySelect) {
    const currentVal = prioritySelect.value;
    prioritySelect.innerHTML = '<option value="">全部优先级</option>' +
      (settings.priorityList || []).map(p => `<option value="${p}">${p}</option>`).join('');
    prioritySelect.value = currentVal || '';
  }

  if (sprintSelect) {
    const currentVal = sprintSelect.value;
    sprintSelect.innerHTML = '<option value="">全部迭代</option>' +
      currentData.sprints.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
    sprintSelect.value = currentVal || '';
  }
}

// 应用筛选
function applyFilters() {
  activeFilters.priority = document.getElementById('filter-priority')?.value || null;
  activeFilters.sprint = document.getElementById('filter-sprint')?.value || null;
  activeFilters.developer = document.getElementById('filter-developer')?.value.trim().toLowerCase();
  activeFilters.requester = document.getElementById('filter-requester')?.value.trim().toLowerCase();

  // 更新清除按钮可见性
  const hasFilters = activeFilters.priority || activeFilters.sprint || activeFilters.developer || activeFilters.requester;
  const clearBtn = document.getElementById('clear-filter-btn');
  if (clearBtn) clearBtn.classList.toggle('hidden', !hasFilters);

  renderList();
}

// 清除筛选
function clearFilters() {
  activeFilters = { status: null, priority: null, sprint: null, developer: '', requester: '' };
  document.getElementById('filter-priority').value = '';
  document.getElementById('filter-sprint').value = '';
  document.getElementById('filter-developer').value = '';
  document.getElementById('filter-requester').value = '';
  const clearBtn = document.getElementById('clear-filter-btn');
  if (clearBtn) clearBtn.classList.add('hidden');
  renderList();
}

// 渲染列表页
function renderList() {
  let reqs;
  if (isSearchMode) {
    const q = lastSearchQuery;
    reqs = currentData.requirements.filter(r => {
      const pls = Array.isArray(r.productLine) ? r.productLine : (r.productLine ? [r.productLine] : []);
      return (r.title && r.title.toLowerCase().includes(q)) ||
        (r.id && r.id.toLowerCase().includes(q)) ||
        (r.developer && r.developer.toLowerCase().includes(q)) ||
        (r.requester && r.requester.toLowerCase().includes(q)) ||
        pls.some(pl => pl.toLowerCase().includes(q));
    });
  } else {
    reqs = currentData.requirements.filter(r => {
      const pls = Array.isArray(r.productLine) ? r.productLine : (r.productLine ? [r.productLine] : []);
      return pls.includes(currentProductLine);
    });
  }

  // 应用高级筛选
  if (activeFilters.priority) {
    reqs = reqs.filter(r => r.priority === activeFilters.priority);
  }
  if (activeFilters.sprint) {
    reqs = reqs.filter(r => r.sprint === activeFilters.sprint);
  }
  if (activeFilters.developer) {
    reqs = reqs.filter(r => r.developer && r.developer.toLowerCase().includes(activeFilters.developer));
  }
  if (activeFilters.requester) {
    reqs = reqs.filter(r => r.requester && r.requester.toLowerCase().includes(activeFilters.requester));
  }

  // 状态标签
  const statusTabs = document.getElementById('status-tabs');
  if (isSearchMode) {
    statusTabs.innerHTML = `<span class="text-sm text-ink-500">找到 ${reqs.length} 个结果</span>`;
  } else {
    statusTabs.innerHTML = [
      { label: '全部', count: reqs.length, filter: null },
      ...(settings.statusList || []).map(s => ({ label: s, count: reqs.filter(r => r.status === s).length, filter: s }))
    ].map(({ label, count, filter }) => `
      <button onclick="${filter ? `filterByStatus('${filter}')` : 'renderList()'}" class="px-4 py-2 text-sm border border-ink-200 rounded-full hover:border-ink-400 hover:text-ink-600 transition-colors whitespace-nowrap">
        ${label} <span class="text-ink-500 ml-1">${count}</span>
      </button>
    `).join('');
  }

  // 确定展示模式：搜索模式强制表格；正常模式按 statusViewMode
  const showTable = isSearchMode || statusViewMode === 'list';

  if (showTable) {
    document.getElementById('kanban-board').classList.add('hidden');
    document.getElementById('table-view').classList.remove('hidden');
    renderReqTable(reqs);
  } else {
    document.getElementById('kanban-board').classList.remove('hidden');
    document.getElementById('table-view').classList.add('hidden');
    renderKanban(reqs);
  }

  // 更新状态视图模式切换按钮样式
  updateStatusViewModeButtons();
}

// 切换状态视图模式
function switchStatusViewMode(mode) {
  statusViewMode = mode;
  renderList();
}

// 更新状态视图模式按钮样式
function updateStatusViewModeButtons() {
  const btnCard = document.getElementById('btn-view-card');
  const btnList = document.getElementById('btn-view-list');

  if (!btnCard || !btnList) return;

  if (statusViewMode === 'card') {
    btnCard.className = 'view-btn active';
    btnList.className = 'view-btn';
  } else {
    btnCard.className = 'view-btn';
    btnList.className = 'view-btn active';
  }
}

// 渲染看板
function renderKanban(reqs) {
  const board = document.getElementById('kanban-board');

  // Apple 灰度看板配色
  const kanbanColorPalette = [
    { header: 'bg-ink-50 border-ink-100', dot: 'bg-ink-800' },
    { header: 'bg-ink-50 border-ink-100', dot: 'bg-ink-400' },
    { header: 'bg-ink-50 border-ink-100', dot: 'bg-ink-800' },
    { header: 'bg-ink-50 border-ink-100', dot: 'bg-ink-400' },
    { header: 'bg-ink-200 border-ink-200', dot: 'bg-ink-800' },
    { header: 'bg-ink-50 border-ink-100', dot: 'bg-ink-400' },
    { header: 'bg-ink-50 border-ink-100', dot: 'bg-ink-800' },
    { header: 'bg-ink-50 border-ink-100', dot: 'bg-ink-400' }
  ];

  board.innerHTML = (settings.statusList || []).map((status, idx) => {
    const statusReqs = reqs.filter(r => r.status === status);
    const config = kanbanColorPalette[idx % kanbanColorPalette.length];

    return `
      <div class="kanban-column flex-shrink-0 w-[280px] flex flex-col" data-status="${status}">
        <div class="kanban-header border-b ${config.header}">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full ${config.dot}"></span>
            <span class="text-sm font-medium text-ink-800">${status}</span>
          </div>
          <span class="text-xs text-ink-500">${statusReqs.length}</span>
        </div>
        <div class="flex-1 p-2 space-y-2 min-h-[200px]"
             ondragover="handleKanbanDragOver(event)"
             ondragleave="handleKanbanDragLeave(event)"
             ondrop="handleKanbanDrop(event, '${status}')">
          ${statusReqs.map(req => `
            <div draggable="true"
                 ondragstart="handleKanbanDragStart(event, '${req.id}')"
                 class="kanban-card cursor-grab relative group"
                 onclick="showDetail('${req.id}')">
              <button onclick="event.stopPropagation(); archiveReqFromList('${req.id}')"
                      onmousedown="event.stopPropagation()"
                      class="absolute top-2 right-2 w-6 h-6 rounded-lg bg-ink-100 text-ink-500 hover:bg-red-50 hover:text-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all z-10"
                      title="归档" draggable="false">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 6v8h12V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 3h14v3H1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 9h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              </button>
              <div class="text-sm text-ink-800 mb-2 pr-6" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${req.title}</div>
              <div class="flex items-center justify-between">
                <span class="font-mono text-xs text-ink-500">${req.id}</span>
                <span class="priority-badge priority-${req.priority}">${req.priority}</span>
              </div>
              <div class="flex items-center gap-3 mt-2 text-xs text-ink-500">
                ${req.sprint ? `<span class="px-2 py-0.5 bg-ink-50 rounded text-ink-500">${req.sprint}</span>` : ''}
                <span>${(req.platform || ['web']).join(', ')}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function renderReqTable(reqs) {
  const listContainer = document.getElementById('requirements-list');

  if (reqs.length === 0) {
    listContainer.innerHTML = '<tr><td colspan="11" class="px-5 py-12 text-center text-ink-500 text-sm">暂无需求</td></tr>';
    return;
  }

  listContainer.innerHTML = reqs.map(req => `
    <tr class="border-b border-ink-50 hover:bg-ink-50 transition-colors">
      <td class="px-5 py-4">
        <span class="font-mono text-xs text-ink-500">${req.id}</span>
      </td>
      <td class="px-5 py-4">
        <div class="text-sm text-ink-800 cursor-pointer hover:text-ink-600 transition-colors" onclick="showDetail('${req.id}')">${req.title}</div>
      </td>
      <td class="px-5 py-4" onclick="event.stopPropagation()">
        <select onchange="updateStatus('${req.id}', this.value)" onclick="event.stopPropagation()" class="text-xs border border-ink-200 rounded-lg px-3 py-1.5 bg-white text-ink-800 cursor-pointer hover:border-ink-400 transition-colors">
          ${(settings.statusList || []).map(s => `<option value="${s}" ${req.status === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
      <td class="px-5 py-4" onclick="event.stopPropagation()">
        <select onchange="updateSprint('${req.id}', this.value)" onclick="event.stopPropagation()" class="text-xs border border-ink-200 rounded-lg px-3 py-1.5 bg-white text-ink-800 cursor-pointer hover:border-ink-400 transition-colors">
          <option value="">未分配</option>
          ${currentData.sprints.filter(s => s.status === 'active').map(s => `<option value="${s.name}" ${req.sprint === s.name ? 'selected' : ''}>${s.name}</option>`).join('')}
        </select>
      </td>
      <td class="px-5 py-4 text-xs text-ink-500">${(req.platform || ['web']).join(', ')}</td>
      <td class="px-5 py-4 text-xs text-ink-500">${req.developer || '-'}</td>
      <td class="px-5 py-4 text-xs text-ink-500">${req.requester || '-'}</td>
      <td class="px-5 py-4 text-xs text-ink-500">${formatDate(req.created)}</td>
      <td class="px-5 py-4 text-xs text-ink-500">${formatDate(req.due_date)}</td>
      <td class="px-5 py-4" onclick="event.stopPropagation()">
        <select onchange="updatePriority('${req.id}', this.value)" onclick="event.stopPropagation()" class="text-xs border border-ink-200 rounded-lg px-3 py-1.5 cursor-pointer hover:border-ink-400 transition-colors ${req.priority ? 'priority-' + req.priority : 'bg-white text-ink-800'}">
          ${(settings.priorityList || []).map(p => `<option value="${p}" ${req.priority === p ? 'selected' : ''}>${p}</option>`).join('')}
        </select>
      </td>
      <td class="px-5 py-4" onclick="event.stopPropagation()">
        <button onclick="event.stopPropagation(); archiveReqFromList('${req.id}')"
                onmousedown="event.stopPropagation()"
                class="p-1.5 rounded-lg text-ink-500 hover:text-red-500 hover:bg-red-50 transition-colors"
                title="归档" draggable="false">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 6v8h12V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 3h14v3H1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 9h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </td>
    </tr>
  `).join('');
}

// 看板拖拽事件
function handleKanbanDragStart(e, reqId) {
  // 如果事件来自归档按钮，不启动拖拽，让 click 事件正常触发
  if (e.target.closest('button[title="归档"]')) {
    e.preventDefault();
    return;
  }

  draggedReqId = reqId;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', reqId);
  e.target.classList.add('opacity-50');
}

function handleKanbanDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const column = e.currentTarget;
  column.classList.add('bg-ink-50');
}

function handleKanbanDragLeave(e) {
  const column = e.currentTarget;
  column.classList.remove('bg-ink-50');
}

async function handleKanbanDrop(e, targetStatus) {
  e.preventDefault();
  const column = e.currentTarget;
  column.classList.remove('bg-ink-50');

  if (!draggedReqId) return;

  const req = currentData.requirements.find(r => r.id === draggedReqId);
  if (!req || req.status === targetStatus) {
    draggedReqId = null;
    return;
  }

  try {
    await fetch(`/api/requirements/${draggedReqId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: targetStatus })
    });
    draggedReqId = null;
    await refreshData();
  } catch (err) {
    console.error('看板拖拽更新状态失败:', err);
    draggedReqId = null;
  }
}

// 显示详情页
function showDetail(reqId, fromPage = 'list') {
  currentReqId = reqId;
  currentPlatform = 'web';
  previousPage = fromPage;
  hideAllPages();
  document.getElementById('detail-page').classList.remove('hidden');
  renderDetail();
}

// 渲染详情页
function renderDetail() {
  const req = currentData.requirements.find(r => r.id === currentReqId);
  if (!req) return;

  // 头部
  document.getElementById('detail-header').innerHTML = `
    <span class="font-mono text-xs text-ink-500">${req.id}</span>
    <span class="mx-2 text-ink-200">·</span>
    <span class="text-sm">${req.title}</span>
    <span class="mx-2 text-ink-200">·</span>
    <span class="status-badge status-${req.status}">${req.status}</span>
    <span class="mx-2 text-ink-200">·</span>
    <span class="priority-badge priority-${req.priority}">${req.priority}</span>
  `;

  // 左侧需求列表 — 显示与当前需求共享至少一个产品线的需求
  const currentReqPLs = Array.isArray(req.productLine) ? req.productLine : (req.productLine ? [req.productLine] : []);
  const plReqs = currentData.requirements.filter(r => {
    const pls = Array.isArray(r.productLine) ? r.productLine : (r.productLine ? [r.productLine] : []);
    return pls.some(pl => currentReqPLs.includes(pl));
  });
  document.getElementById('detail-sidebar').innerHTML = plReqs.map(r => `
    <div onclick="showDetail('${r.id}')" class="sidebar-item ${r.id === req.id ? 'active' : ''}">
      <div class="text-sm text-ink-800">${r.title}</div>
      <div class="flex items-center gap-2 mt-1">
        <span class="font-mono text-xs text-ink-500">${r.id}</span>
        <span class="status-badge status-${r.status}">${r.status}</span>
      </div>
    </div>
  `).join('');

  // 平台切换
  const platforms = req.platform || ['web'];
  const platformTabs = document.getElementById('platform-tabs');

  if (platforms.length > 1) {
    platformTabs.innerHTML = platforms.map(p => `
      <button onclick="switchPlatform('${p}')" class="px-4 py-1.5 rounded-lg text-sm transition-all ${currentPlatform === p ? 'bg-ink-800 text-white' : 'text-ink-800 hover:bg-ink-50'}">
        ${p === 'web' ? 'Web端' : '移动端'}
      </button>
    `).join('');
    platformTabs.classList.remove('hidden');
  } else {
    platformTabs.innerHTML = '';
    platformTabs.classList.add('hidden');
  }

  // 加载原型
  loadPrototype(req);

  // 加载需求文档
  loadDoc(req);
}

// 加载原型
function loadPrototype(req) {
  const frame = document.getElementById('prototype-frame');
  const container = document.getElementById('prototype-container');
  const platform = currentPlatform || (req.platform || ['web'])[0];
  const protoKey = platform === 'mobile' ? 'mobile' : 'web';

  // 检查原型文件是否存在
  if (!req.hasPrototype || !req.hasPrototype[protoKey]) {
    // 无原型时，直接在原型区域展示 PRD 文档
    frame.src = 'about:blank';
    
    // 获取文档内容
    const docContent = req.body || '';
    
    // 渲染 Markdown 为 HTML
    container.innerHTML = `
      <div class="w-full h-full bg-white rounded-2xl shadow-lg overflow-hidden flex flex-col">
        <div class="px-6 py-4 bg-ink-50 border-b border-ink-100">
          <span class="text-sm font-medium text-ink-600">需求文档</span>
        </div>
        <div class="flex-1 overflow-y-auto p-6">
          <div class="prose prose-sm max-w-none text-ink-700">
            ${marked.parse(docContent || '*暂无文档内容*')}
          </div>
        </div>
      </div>
    `;
    
    // 设置容器尺寸
    if (platform === 'mobile') {
      container.style.width = '375px';
      container.style.height = '667px';
      container.style.maxWidth = '375px';
    } else {
      container.style.width = '100%';
      container.style.height = '100%';
      container.style.maxWidth = docPanelOpen ? '680px' : '960px';
      container.style.maxHeight = '800px';
    }
    return;
  }

  const primaryPL = Array.isArray(req.productLine) ? req.productLine[0] : req.productLine;
  const protoFile = `/products/${encodeURIComponent(primaryPL)}/${encodeURIComponent(req.folderName)}/prototype-${platform}.html`;
  frame.src = protoFile;
  
  // 有原型时，恢复 iframe 结构
  container.innerHTML = `<iframe id="prototype-frame" class="w-full h-full border-0"></iframe>`;
  
  // 重新获取 iframe 引用
  const newFrame = document.getElementById('prototype-frame');
  newFrame.src = protoFile;

  if (platform === 'mobile') {
    container.style.width = '375px';
    container.style.height = '667px';
    container.style.maxWidth = '375px';
  } else {
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.maxWidth = docPanelOpen ? '680px' : '960px';
    container.style.maxHeight = '800px';
  }
}

// 加载需求文档
function loadDoc(req) {
  const docContent = document.getElementById('doc-content');
  const docEditor = document.getElementById('doc-editor');
  docContent.innerHTML = marked.parse(req.body || '');
  docEditor.value = req.body || '';

  // 非编辑模式下确保正确显示状态
  if (!docEditMode) {
    docContent.classList.remove('hidden');
    docEditor.classList.add('hidden');
    const editBtn = document.getElementById('doc-edit-btn');
    const saveBtn = document.getElementById('doc-save-btn');
    const cancelBtn = document.getElementById('doc-cancel-btn');
    if (editBtn) editBtn.classList.remove('hidden');
    if (saveBtn) saveBtn.classList.add('hidden');
    if (cancelBtn) cancelBtn.classList.add('hidden');
  }
}

// 切换文档编辑模式
function toggleDocEditMode() {
  docEditMode = true;
  docIsDirty = false;
  const docContent = document.getElementById('doc-content');
  const docEditor = document.getElementById('doc-editor');
  const editBtn = document.getElementById('doc-edit-btn');
  const saveBtn = document.getElementById('doc-save-btn');
  const cancelBtn = document.getElementById('doc-cancel-btn');

  docContent.classList.add('hidden');
  docEditor.classList.remove('hidden');
  editBtn.classList.add('hidden');
  saveBtn.classList.remove('hidden');
  cancelBtn.classList.remove('hidden');

  // 监听内容变化，标记脏状态
  docEditor.addEventListener('input', () => { docIsDirty = true; }, { once: true });

  // 聚焦到编辑器末尾
  docEditor.focus();
  docEditor.setSelectionRange(docEditor.value.length, docEditor.value.length);
}

// 保存文档内容
async function saveDocContent() {
  const docEditor = document.getElementById('doc-editor');
  const content = docEditor.value;

  try {
    const res = await fetch(`/api/requirements/${currentReqId}/content`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });

    if (res.ok) {
      docEditMode = false;
      docIsDirty = false;
      showToast('文档已保存');
      const docContent = document.getElementById('doc-content');
      const editBtn = document.getElementById('doc-edit-btn');
      const saveBtn = document.getElementById('doc-save-btn');
      const cancelBtn = document.getElementById('doc-cancel-btn');

      docEditor.classList.add('hidden');
      docContent.classList.remove('hidden');
      if (editBtn) editBtn.classList.remove('hidden');
      if (saveBtn) saveBtn.classList.add('hidden');
      if (cancelBtn) cancelBtn.classList.add('hidden');

      await refreshData();
    } else {
      const err = await res.json();
      showToast(err.error || '保存失败', 'error');
    }
  } catch (e) {
    console.error('保存文档失败:', e);
    showToast('保存失败', 'error');
  }
}

// 取消编辑
function cancelDocEdit() {
  docEditMode = false;
  docIsDirty = false;
  const req = currentData.requirements.find(r => r.id === currentReqId);
  const docContent = document.getElementById('doc-content');
  const docEditor = document.getElementById('doc-editor');
  const editBtn = document.getElementById('doc-edit-btn');
  const saveBtn = document.getElementById('doc-save-btn');
  const cancelBtn = document.getElementById('doc-cancel-btn');

  docEditor.value = req ? (req.body || '') : '';
  docEditor.classList.add('hidden');
  docContent.classList.remove('hidden');
  editBtn.classList.remove('hidden');
  saveBtn.classList.add('hidden');
  cancelBtn.classList.add('hidden');
}

// 格式化时间戳显示
function formatVersionTime(timestamp) {
  const d = new Date(timestamp.replace(/-/g, 'T').slice(0, 19));
  const now = new Date();
  const diff = (now - d) / 1000;

  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`;

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// 显示版本历史弹窗
async function showVersionHistory() {
  const modal = document.getElementById('version-history-modal');
  const listContainer = document.getElementById('version-list');
  const previewHeader = document.getElementById('version-preview-header');
  const previewContent = document.getElementById('version-preview-content');

  modal.classList.remove('hidden');
  listContainer.innerHTML = '<div class="text-sm text-ink-400 px-2 py-4 text-center">加载中...</div>';
  previewHeader.textContent = '';
  previewContent.innerHTML = '';

  try {
    const res = await fetch(`/api/requirements/${currentReqId}/history`);
    const data = await res.json();

    if (data.versions.length === 0) {
      listContainer.innerHTML = '<div class="text-sm text-ink-400 px-2 py-4 text-center">暂无历史版本</div>';
      return;
    }

    // 渲染版本列表
    listContainer.innerHTML = data.versions.map((v, idx) => `
      <div onclick="showVersionContent('${v.timestamp}')"
           class="version-item px-3 py-2.5 rounded-xl cursor-pointer hover:bg-ink-50 transition-colors text-sm ${idx === 0 ? 'bg-ink-50 border border-ink-200' : ''}"
           id="ver-${v.timestamp}">
        <div class="text-ink-700 font-medium">${formatVersionTime(v.timestamp)}</div>
        <div class="text-xs text-ink-400 mt-0.5">${v.filename}</div>
      </div>
    `).join('');

    // 默认显示最新版本
    showVersionContent(data.versions[0].timestamp);
  } catch (e) {
    console.error('加载版本历史失败:', e);
    listContainer.innerHTML = '<div class="text-sm text-red-500 px-2 py-4 text-center">加载失败</div>';
  }
}

// 显示指定版本内容
async function showVersionContent(timestamp) {
  const previewHeader = document.getElementById('version-preview-header');
  const previewContent = document.getElementById('version-preview-content');

  // 更新选中状态
  document.querySelectorAll('.version-item').forEach(el => {
    el.classList.remove('bg-ink-50', 'border', 'border-ink-200');
  });
  const selected = document.getElementById(`ver-${timestamp}`);
  if (selected) selected.classList.add('bg-ink-50', 'border', 'border-ink-200');

  try {
    const res = await fetch(`/api/requirements/${currentReqId}/history/${timestamp}`);
    const data = await res.json();

    if (!res.ok) {
      previewHeader.textContent = '版本不存在';
      previewContent.innerHTML = '';
      return;
    }

    const d = new Date(data.created);
    const timeStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    previewHeader.textContent = `版本时间：${timeStr}    文件大小：${(data.size / 1024).toFixed(1)} KB`;

    // 提取 body 内容并渲染
    const match = data.content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    const body = match ? match[1] : data.content;
    previewContent.innerHTML = marked.parse(body);
  } catch (e) {
    console.error('加载版本内容失败:', e);
    previewHeader.textContent = '加载失败';
    previewContent.innerHTML = '';
  }
}

// 关闭版本历史弹窗
function closeVersionHistory() {
  document.getElementById('version-history-modal').classList.add('hidden');
}

// 离开页面时检查未保存内容
window.addEventListener('beforeunload', (e) => {
  if (docIsDirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// 切换平台
function switchPlatform(platform) {
  currentPlatform = platform;
  renderDetail();
}

// 原型全屏切换
function togglePrototypeFullscreen() {
  const prototypeArea = document.getElementById('prototype-area');
  const fullscreenBtn = document.getElementById('proto-fullscreen-btn');

  if (!document.fullscreenElement) {
    prototypeArea.requestFullscreen().then(() => {
      fullscreenBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      fullscreenBtn.title = '退出全屏';
    }).catch(err => {
      console.error('全屏失败:', err);
    });
  } else {
    document.exitFullscreen().then(() => {
      fullscreenBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      fullscreenBtn.title = '全屏';
    });
  }
}

// 监听全屏变化事件
if (typeof document !== 'undefined') {
  document.addEventListener('fullscreenchange', () => {
    const fullscreenBtn = document.getElementById('proto-fullscreen-btn');
    if (!fullscreenBtn) return;
    if (!document.fullscreenElement) {
      fullscreenBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      fullscreenBtn.title = '全屏';
    }
  });
}

// 切换文档面板
function toggleDocPanel() {
  docPanelOpen = !docPanelOpen;
  const panel = document.getElementById('doc-panel');
  const btn = document.getElementById('doc-toggle-btn');

  panel.classList.toggle('hidden', !docPanelOpen);

  if (docPanelOpen) {
    btn.classList.add('bg-ink-800', 'text-white', 'border-ink-400');
    btn.classList.remove('text-ink-600', 'border-ink-400');
  } else {
    btn.classList.remove('bg-ink-800', 'text-white', 'border-ink-400');
    btn.classList.add('text-ink-600', 'border-ink-400');
  }

  if (currentReqId) renderDetail();
}

// 更新状态
async function updateStatus(id, status) {
  try {
    await fetch(`/api/requirements/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    await refreshData();
  } catch (e) {
    console.error('更新状态失败:', e);
  }
}

// 更新优先级
async function updatePriority(id, priority) {
  try {
    await fetch(`/api/requirements/${id}/priority`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority })
    });
    await refreshData();
  } catch (e) {
    console.error('更新优先级失败:', e);
  }
}

// 更新迭代
async function updateSprint(id, sprint) {
  try {
    await fetch(`/api/requirements/${id}/sprint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sprint })
    });
    await refreshData();
  } catch (e) {
    console.error('更新迭代失败:', e);
  }
}

// 归档需求
async function archiveReq() {
  if (!confirm('确定要归档这个需求吗？')) return;

  try {
    const res = await fetch(`/api/requirements/${currentReqId}/archive`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || '归档失败', 'error');
      return;
    }
    showToast('需求已归档');
    await refreshData();

    // 根据来源页面决定返回哪里
    if (previousPage === 'archive') {
      showArchivePage();
    } else if (previousPage === 'home') {
      showHome();
    } else {
      showList(currentProductLine);
    }
  } catch (e) {
    console.error('归档失败:', e);
    showToast('归档失败，请重试', 'error');
  }
}

// 按状态筛选
function filterByStatus(status) {
  const plReqs = currentData.requirements.filter(r => {
    const pls = Array.isArray(r.productLine) ? r.productLine : (r.productLine ? [r.productLine] : []);
    return pls.includes(currentProductLine) && r.status === status;
  });
  renderReqTable(plReqs);
}

// 显示列表
function showListPage() {
  switch (previousPage) {
    case 'archive':
      showArchivePage();
      break;
    case 'sprint':
      showSprintView();
      break;
    case 'drafts':
      showDraftsPage();
      break;
    case 'home':
      showHome();
      break;
    default:
      showList(currentProductLine);
  }
}

// 隐藏所有页面
function hideAllPages() {
  document.getElementById('home-page').classList.add('hidden');
  document.getElementById('list-page').classList.add('hidden');
  document.getElementById('detail-page').classList.add('hidden');
  document.getElementById('archive-page').classList.add('hidden');
  document.getElementById('sprint-page').classList.add('hidden');
  document.getElementById('drafts-page').classList.add('hidden');
  document.getElementById('draft-detail-page').classList.add('hidden');
}

// 显示归档页
function showArchivePage() {
  hideAllPages();
  document.getElementById('archive-page').classList.remove('hidden');
  renderArchivePage();
}

// 渲染归档页
function renderArchivePage() {
  const container = document.getElementById('archive-content');
  const archivedReqs = currentData.requirements.filter(r => r.isArchive);

  if (archivedReqs.length === 0) {
    container.innerHTML = '<div class="text-center text-ink-500 text-sm py-20">暂无已归档需求</div>';
    return;
  }

  // 按产品线 → 迭代 两级分组
  const groups = {};
  for (const req of archivedReqs) {
    const pls = Array.isArray(req.productLine) ? req.productLine : (req.productLine ? [req.productLine] : ['未分类']);
    for (const pl of pls) {
      if (!groups[pl]) groups[pl] = { _reqs: [], sprints: {} };
      groups[pl]._reqs.push(req);

      // 按迭代分组
      const sprintKey = req.sprint || '未分配迭代';
      if (!groups[pl].sprints[sprintKey]) groups[pl].sprints[sprintKey] = [];
      groups[pl].sprints[sprintKey].push(req);
    }
  }

  container.innerHTML = Object.entries(groups).map(([pl, group]) => `
    <div class="bg-white rounded-2xl border border-ink-100 overflow-hidden shadow-sm mb-4">
      <!-- 产品线折叠头 -->
      <div class="px-6 py-4 bg-ink-50 border-b border-ink-100 cursor-pointer hover:bg-ink-100 transition-colors"
           onclick="this.nextElementSibling.classList.toggle('hidden'); this.querySelector('.pl-chevron').classList.toggle('rotate-180')">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" class="text-ink-500">
              <rect x="2" y="4" width="14" height="12" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
              <path d="M2 8h14" stroke="currentColor" stroke-width="1.5"/>
              <path d="M6 2h6v2H6z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
            <h3 class="font-display text-base text-ink-800">${pl}</h3>
            <span class="text-sm text-ink-500">${group._reqs.length} 个归档需求</span>
          </div>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="pl-chevron text-ink-500 transition-transform"><path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      </div>

      <!-- 迭代列表（折叠内容，默认展开） -->
      <div class="divide-y divide-ink-100">
        ${Object.entries(group.sprints).sort(([a], [b]) => {
          if (a === '未分配迭代') return 1;
          if (b === '未分配迭代') return -1;
          return a.localeCompare(b);
        }).map(([sprint, reqs]) => `
          <div>
            <!-- 迭代折叠头 -->
            <div class="px-6 py-3 cursor-pointer hover:bg-ink-50 transition-colors"
                 onclick="this.nextElementSibling.classList.toggle('hidden'); this.querySelector('.sprint-chevron').classList.toggle('rotate-180')">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="text-ink-500">
                    <rect x="1" y="3" width="12" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/>
                    <path d="M1 6h12" stroke="currentColor" stroke-width="1.2"/>
                    <path d="M5 1h4v2H5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                  </svg>
                  <span class="text-sm font-medium text-ink-800">${sprint}</span>
                  <span class="text-xs text-ink-500">${reqs.length} 个</span>
                </div>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="sprint-chevron text-ink-500 transition-transform"><path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
            </div>

            <!-- 需求列表（默认展开） -->
            <div class="bg-white">
              <table class="w-full">
                <thead>
                  <tr>
                    <th>需求ID</th>
                    <th>需求名称</th>
                    <th>状态</th>
                    <th>优先级</th>
                    <th>开发</th>
                    <th>归档时间</th>
                  </tr>
                </thead>
                <tbody>
                  ${reqs.map(req => `
                    <tr class="cursor-pointer hover:bg-ink-50 transition-colors" onclick="showDetail('${req.id}', 'archive')">
                      <td><span class="font-mono text-xs text-ink-500">${req.id}</span></td>
                      <td><span class="text-sm text-ink-800">${req.title}</span></td>
                      <td><span class="status-badge status-${req.status}">${req.status}</span></td>
                      <td><span class="priority-badge priority-${req.priority}">${req.priority}</span></td>
                      <td class="text-xs text-ink-500">${req.developer || '-'}</td>
                      <td class="text-xs text-ink-500">${formatDate(req.updated)}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

// 归档迭代
async function archiveSprint(name) {
  const count = currentData.requirements.filter(r => r.sprint === name && !r.isArchive).length;
  const msg = count > 0
    ? `确定要归档迭代 "${name}" 吗？该迭代下还有 ${count} 个未归档需求，将一并归档。`
    : `确定要归档迭代 "${name}" 吗？`;

  if (!confirm(msg)) return;

  try {
    const res = await fetch(`/api/sprints/${encodeURIComponent(name)}/archive`, {
      method: 'POST'
    });

    if (res.ok) {
      await refreshData();
      renderSettings();
    } else {
      const err = await res.json();
      alert(err.error || '归档迭代失败');
    }
  } catch (e) {
    console.error('归档迭代失败:', e);
  }
}

// 设置弹窗
function showSettings() {
  const modal = document.getElementById('settings-modal');
  modal.classList.remove('hidden');
  renderSettings();
}

function closeSettings() {
  const modal = document.getElementById('settings-modal');
  modal.classList.add('hidden');
}

function renderSettings() {
  // 产品线列表（合并 settings.productLines 和需求中的产品线）
  const productLinesList = document.getElementById('product-lines-list');
  const settingsProductLines = settings.productLines || [];
  const reqProductLines = currentData.requirements.flatMap(r =>
    Array.isArray(r.productLine) ? r.productLine : (r.productLine ? [r.productLine] : [])
  );
  const productLines = [...new Set([...settingsProductLines, ...reqProductLines])];
  productLinesList.innerHTML = productLines.map(pl => {
    const count = currentData.requirements.filter(r => {
      const pls = Array.isArray(r.productLine) ? r.productLine : (r.productLine ? [r.productLine] : []);
      return pls.includes(pl);
    }).length;
    const isFromSettings = settingsProductLines.includes(pl);
    return `<span class="px-3 py-1.5 bg-ink-50 text-ink-800 rounded-full text-sm">${pl} <span class="text-ink-500 ml-1">(${count})</span></span>`;
  }).join('') || '<span class="text-sm text-ink-500">暂无产品线</span>';

  // 状态列表 - 可编辑/删除
  const statusListDisplay = document.getElementById('status-list-display');
  statusListDisplay.innerHTML = (settings.statusList || []).map((s, idx) => `
    <div class="status-item inline-flex items-center gap-1.5" data-status-idx="${idx}">
      <span class="status-badge status-${s} view-mode">${s}</span>
      <input type="text" value="${s}" class="edit-mode hidden px-2 py-1 text-xs border border-ink-200 rounded-lg focus:outline-none focus:border-ink-400 w-24" data-original="${s}" onkeydown="if(event.key==='Enter')saveStatusEdit(${idx})" onblur="cancelStatusEdit(${idx})">
      <button onclick="startEditStatus(${idx})" class="view-mode w-5 h-5 rounded hover:bg-ink-50 flex items-center justify-center text-ink-500 hover:text-ink-800 transition-colors" title="编辑">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M11 2L14 5M2 14l3-1 8-8-3-3-8 8-1 3z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button onclick="saveStatusEdit(${idx})" class="edit-mode hidden w-5 h-5 rounded hover:bg-green-50 flex items-center justify-center text-green-600 transition-colors" title="保存">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button onclick="cancelStatusEdit(${idx})" class="edit-mode hidden w-5 h-5 rounded hover:bg-ink-50 flex items-center justify-center text-ink-500 hover:text-ink-800 transition-colors" title="取消">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
      <button onclick="removeStatusFromSettings(${idx})" class="view-mode w-5 h-5 rounded hover:bg-red-50 flex items-center justify-center text-ink-500 hover:text-red-500 transition-colors" title="删除">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>
  `).join('');

  // 优先级列表 - 可编辑/删除
  const priorityListDisplay = document.getElementById('priority-list-display');
  priorityListDisplay.innerHTML = (settings.priorityList || []).map((p, idx) => `
    <div class="priority-item inline-flex items-center gap-1.5" data-priority-idx="${idx}">
      <span class="priority-badge priority-${p} view-mode">${p}</span>
      <input type="text" value="${p}" class="edit-mode hidden px-2 py-1 text-xs border border-ink-200 rounded-lg focus:outline-none focus:border-ink-400 w-16" data-original="${p}" onkeydown="if(event.key==='Enter')savePriorityEdit(${idx})" onblur="cancelPriorityEdit(${idx})">
      <button onclick="startEditPriority(${idx})" class="view-mode w-5 h-5 rounded hover:bg-ink-50 flex items-center justify-center text-ink-500 hover:text-ink-800 transition-colors" title="编辑">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M11 2L14 5M2 14l3-1 8-8-3-3-8 8-1 3z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button onclick="savePriorityEdit(${idx})" class="edit-mode hidden w-5 h-5 rounded hover:bg-green-50 flex items-center justify-center text-green-600 transition-colors" title="保存">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button onclick="cancelPriorityEdit(${idx})" class="edit-mode hidden w-5 h-5 rounded hover:bg-ink-50 flex items-center justify-center text-ink-500 hover:text-ink-800 transition-colors" title="取消">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
      <button onclick="removePriorityFromSettings(${idx})" class="view-mode w-5 h-5 rounded hover:bg-red-50 flex items-center justify-center text-ink-500 hover:text-red-500 transition-colors" title="删除">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>
  `).join('');
}

// 从设置中添加产品线
// ========== 状态编辑 ==========

function startEditStatus(idx) {
  const container = document.querySelector(`.status-item[data-status-idx="${idx}"]`);
  if (!container) return;

  const viewModes = container.querySelectorAll('.view-mode');
  const editModes = container.querySelectorAll('.edit-mode');
  const input = container.querySelector('input.edit-mode');

  viewModes.forEach(el => el.classList.add('hidden'));
  editModes.forEach(el => el.classList.remove('hidden'));
  if (input) {
    input.focus();
    input.select();
  }
}

async function saveStatusEdit(idx) {
  const container = document.querySelector(`.status-item[data-status-idx="${idx}"]`);
  if (!container) return;

  const input = container.querySelector('input.edit-mode');
  const original = input.dataset.original;
  const newName = input.value.trim();

  if (!newName) {
    alert('状态名称不能为空');
    return;
  }
  if (newName === original) {
    cancelStatusEdit(idx);
    return;
  }
  if ((settings.statusList || []).includes(newName)) {
    alert('该状态名称已存在');
    return;
  }

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ renameStatus: { from: original, to: newName } })
    });

    if (res.ok) {
      await loadSettings();
      await refreshData();
      renderSettings();
    } else {
      const err = await res.json();
      alert(err.error || '修改失败');
    }
  } catch (e) {
    console.error('修改状态失败:', e);
  }
}

function cancelStatusEdit(idx) {
  const container = document.querySelector(`.status-item[data-status-idx="${idx}"]`);
  if (!container) return;

  const viewModes = container.querySelectorAll('.view-mode');
  const editModes = container.querySelectorAll('.edit-mode');
  const input = container.querySelector('input.edit-mode');

  viewModes.forEach(el => el.classList.remove('hidden'));
  editModes.forEach(el => el.classList.add('hidden'));
  if (input) input.value = input.dataset.original;
}

// ========== 优先级编辑 ==========

function startEditPriority(idx) {
  const container = document.querySelector(`.priority-item[data-priority-idx="${idx}"]`);
  if (!container) return;

  const viewModes = container.querySelectorAll('.view-mode');
  const editModes = container.querySelectorAll('.edit-mode');
  const input = container.querySelector('input.edit-mode');

  viewModes.forEach(el => el.classList.add('hidden'));
  editModes.forEach(el => el.classList.remove('hidden'));
  if (input) {
    input.focus();
    input.select();
  }
}

async function savePriorityEdit(idx) {
  const container = document.querySelector(`.priority-item[data-priority-idx="${idx}"]`);
  if (!container) return;

  const input = container.querySelector('input.edit-mode');
  const original = input.dataset.original;
  const newName = input.value.trim();

  if (!newName) {
    alert('优先级名称不能为空');
    return;
  }
  if (newName === original) {
    cancelPriorityEdit(idx);
    return;
  }
  if ((settings.priorityList || []).includes(newName)) {
    alert('该优先级名称已存在');
    return;
  }

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ renamePriority: { from: original, to: newName } })
    });

    if (res.ok) {
      await loadSettings();
      await refreshData();
      renderSettings();
    } else {
      const err = await res.json();
      alert(err.error || '修改失败');
    }
  } catch (e) {
    console.error('修改优先级失败:', e);
  }
}

function cancelPriorityEdit(idx) {
  const container = document.querySelector(`.priority-item[data-priority-idx="${idx}"]`);
  if (!container) return;

  const viewModes = container.querySelectorAll('.view-mode');
  const editModes = container.querySelectorAll('.edit-mode');
  const input = container.querySelector('input.edit-mode');

  viewModes.forEach(el => el.classList.remove('hidden'));
  editModes.forEach(el => el.classList.add('hidden'));
  if (input) input.value = input.dataset.original;
}

async function addProductLineFromSettings() {
  const input = document.getElementById('new-product-line-input');
  const name = input.value.trim();

  if (!name) {
    alert('请输入产品线名称');
    return;
  }

  // 从 settings.productLines 获取当前列表
  const currentProductLines = settings.productLines || [];
  if (currentProductLines.includes(name)) {
    alert('该产品线已存在');
    return;
  }

  // 保存到 settings
  const newProductLines = [...currentProductLines, name];
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productLines: newProductLines })
    });
    if (res.ok) {
      settings.productLines = newProductLines;
      input.value = '';
      renderSettings();
      // 刷新首页数据并重新渲染
      await refreshData();
    } else {
      alert('保存失败');
    }
  } catch (e) {
    alert('保存失败: ' + e.message);
  }
}

// 从设置中添加状态
async function addStatusFromSettings() {
  const input = document.getElementById('new-status-input');
  const name = input.value.trim();

  if (!name) {
    alert('请输入状态名称');
    return;
  }

  if ((settings.statusList || []).includes(name)) {
    alert('该状态已存在');
    return;
  }

  settings.statusList = [...(settings.statusList || []), name];

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statusList: settings.statusList })
    });

    if (res.ok) {
      input.value = '';
      await refreshData();
      renderSettings();
    } else {
      const err = await res.json();
      alert(err.error || '添加失败');
    }
  } catch (e) {
    console.error('添加状态失败:', e);
  }
}

// 从设置中删除状态
async function removeStatusFromSettings(idx) {
  const name = settings.statusList[idx];
  if (!name) return;

  // 检查是否有需求正在使用此状态
  const inUse = currentData.requirements.some(r => r.status === name);
  if (inUse) {
    alert(`状态 "${name}" 正在被某些需求使用，无法删除。请先将相关需求迁移到其他状态。`);
    return;
  }

  if (!confirm(`确定要删除状态 "${name}" 吗？`)) return;

  settings.statusList = settings.statusList.filter((_, i) => i !== idx);

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ statusList: settings.statusList })
    });

    if (res.ok) {
      await refreshData();
      renderSettings();
    } else {
      const err = await res.json();
      alert(err.error || '删除失败');
    }
  } catch (e) {
    console.error('删除状态失败:', e);
  }
}

// 从设置中添加优先级
async function addPriorityFromSettings() {
  const input = document.getElementById('new-priority-input');
  const name = input.value.trim();

  if (!name) {
    alert('请输入优先级名称');
    return;
  }

  if ((settings.priorityList || []).includes(name)) {
    alert('该优先级已存在');
    return;
  }

  settings.priorityList = [...(settings.priorityList || []), name];

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priorityList: settings.priorityList })
    });

    if (res.ok) {
      input.value = '';
      await refreshData();
      renderSettings();
    } else {
      const err = await res.json();
      alert(err.error || '添加失败');
    }
  } catch (e) {
    console.error('添加优先级失败:', e);
  }
}

// 从设置中删除优先级
async function removePriorityFromSettings(idx) {
  const name = settings.priorityList[idx];
  if (!name) return;

  // 检查是否有需求正在使用此优先级
  const inUse = currentData.requirements.some(r => r.priority === name);
  if (inUse) {
    alert(`优先级 "${name}" 正在被某些需求使用，无法删除。请先将相关需求迁移到其他优先级。`);
    return;
  }

  if (!confirm(`确定要删除优先级 "${name}" 吗？`)) return;

  settings.priorityList = settings.priorityList.filter((_, i) => i !== idx);

  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priorityList: settings.priorityList })
    });

    if (res.ok) {
      await refreshData();
      renderSettings();
    } else {
      const err = await res.json();
      alert(err.error || '删除失败');
    }
  } catch (e) {
    console.error('删除优先级失败:', e);
  }
}

// 点击弹窗背景关闭
document.getElementById('settings-modal').addEventListener('click', function(e) {
  if (e.target === this) closeSettings();
});

// 格式化日期
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ========== 新建迭代 ==========

function showCreateSprintModal() {
  const modal = document.getElementById('create-sprint-modal');
  modal.classList.remove('hidden');
  document.getElementById('new-sprint-name').value = '';
  setTimeout(() => document.getElementById('new-sprint-name').focus(), 100);
}

function closeCreateSprintModal() {
  document.getElementById('create-sprint-modal').classList.add('hidden');
}

async function createSprintFromModal() {
  const name = document.getElementById('new-sprint-name').value.trim();

  if (!name) {
    alert('请输入迭代名称');
    return;
  }

  try {
    const res = await fetch('/api/sprints', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });

    if (res.ok) {
      closeCreateSprintModal();
      await refreshData();
    } else {
      const err = await res.json();
      alert(err.error || '创建失败');
    }
  } catch (e) {
    console.error('创建迭代失败:', e);
    alert('创建失败，请检查网络');
  }
}

// 点击弹窗背景关闭
document.getElementById('create-sprint-modal').addEventListener('click', function(e) {
  if (e.target === this) closeCreateSprintModal();
});

// ========== 新建需求 ==========

function showCreateReqModal() {
  const modal = document.getElementById('create-req-modal');
  modal.classList.remove('hidden');

  // 收集所有唯一产品线（合并 settings.productLines 和需求中的产品线）
  const settingsProductLines = settings.productLines || [];
  const reqProductLines = currentData.requirements.flatMap(r =>
    Array.isArray(r.productLine) ? r.productLine : (r.productLine ? [r.productLine] : [])
  );
  const productLines = [...new Set([...settingsProductLines, ...reqProductLines])];

  // 渲染产品线复选框组
  const listContainer = document.getElementById('new-req-product-line-list');
  listContainer.innerHTML = productLines.map(pl => `
    <label class="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" name="new-req-product-line" value="${pl}" ${pl === currentProductLine ? 'checked' : ''} class="w-4 h-4 rounded border-ink-300 text-ink-800 focus:ring-ink-500">
      <span class="text-sm text-ink-700">${pl}</span>
    </label>
  `).join('');

  // 动态填充优先级下拉列表
  const prioritySelect = document.getElementById('new-req-priority');
  const priorityList = settings.priorityList || ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'];
  const priorityLabels = { P0: '最高', P1: '高', P2: '中', P3: '低', P4: '很低', P5: '最低' };
  prioritySelect.innerHTML = priorityList.map(p => {
    const label = priorityLabels[p] || '';
    const text = label ? `${p} - ${label}` : p;
    return `<option value="${p}" ${p === 'P2' ? 'selected' : ''}>${text}</option>`;
  }).join('');

  // 清空输入框和其他字段
  document.getElementById('new-req-product-line-input').value = '';
  document.getElementById('new-req-title').value = '';
  document.getElementById('new-req-due-date').value = '';
  document.getElementById('new-req-platform-web').checked = true;
  document.getElementById('new-req-platform-mobile').checked = false;
  document.getElementById('new-req-developer').value = '';
  document.getElementById('new-req-requester').value = '';

  // 聚焦标题
  setTimeout(() => document.getElementById('new-req-title').focus(), 100);
}

// 添加新产品线到复选框组
async function addNewProductLine() {
  const input = document.getElementById('new-req-product-line-input');
  const name = input.value.trim();
  if (!name) return;

  const listContainer = document.getElementById('new-req-product-line-list');

  // 检查是否已存在（前端临时检查）
  const existing = listContainer.querySelector(`input[value="${name}"]`);
  if (existing) {
    existing.checked = true;
    input.value = '';
    return;
  }

  // 调用 API 创建产品线
  try {
    const res = await fetch('/api/product-lines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();

    if (res.ok) {
      // 更新 settings
      settings.productLines = data.productLines;

      // 添加新复选框
      const label = document.createElement('label');
      label.className = 'flex items-center gap-2 cursor-pointer';
      label.innerHTML = `
        <input type="checkbox" name="new-req-product-line" value="${name}" checked>
        <span class="text-sm text-ink-800">${name}</span>
      `;
      listContainer.appendChild(label);
      input.value = '';
    } else {
      alert(data.error || '创建产品线失败');
    }
  } catch (e) {
    alert('创建产品线失败: ' + e.message);
  }
}

function closeCreateReqModal() {
  document.getElementById('create-req-modal').classList.add('hidden');
}

async function createRequirement() {
  const title = document.getElementById('new-req-title').value.trim();
  const priority = document.getElementById('new-req-priority').value;
  const dueDate = document.getElementById('new-req-due-date').value;
  const developer = document.getElementById('new-req-developer').value.trim();
  const requester = document.getElementById('new-req-requester').value.trim();

  // 收集选中的产品线
  const productLineCheckboxes = document.querySelectorAll('input[name="new-req-product-line"]:checked');
  const productLines = Array.from(productLineCheckboxes).map(cb => cb.value);

  const platforms = [];
  if (document.getElementById('new-req-platform-web').checked) platforms.push('web');
  if (document.getElementById('new-req-platform-mobile').checked) platforms.push('mobile');

  if (!title) {
    alert('请输入需求标题');
    return;
  }
  if (productLines.length === 0) {
    alert('请至少选择一个产品线');
    return;
  }
  if (platforms.length === 0) {
    alert('请至少选择一个终端平台');
    return;
  }

  try {
    const res = await fetch('/api/requirements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        productLine: productLines,
        priority,
        platform: platforms,
        developer,
        requester,
        due_date: dueDate
      })
    });

    const data = await res.json();

    if (res.ok) {
      closeCreateReqModal();
      await refreshData();
      // 进入新需求的详情页
      showDetail(data.id);
    } else {
      alert(data.error || '创建失败');
    }
  } catch (e) {
    console.error('创建需求失败:', e);
    alert('创建失败，请检查网络');
  }
}

// 点击弹窗背景关闭
document.getElementById('create-req-modal').addEventListener('click', function(e) {
  if (e.target === this) closeCreateReqModal();
});

// ========== 列表页归档 ==========

async function archiveReqFromList(reqId) {
  if (!confirm('确定要归档这个需求吗？')) return;

  try {
    const res = await fetch(`/api/requirements/${reqId}/archive`, {
      method: 'POST'
    });
    const data = await res.json();
    if (res.ok) {
      showToast('需求已归档');
      await refreshData();
    } else {
      showToast(data.error || '归档失败', 'error');
    }
  } catch (e) {
    console.error('归档失败:', e);
    showToast('归档失败', 'error');
  }
}

// ========== 迭代视图页 ==========

// 显示迭代视图页
function showSprintView() {
  previousPage = 'sprint';
  currentSprint = null; // 默认选中空迭代或第一个迭代
  hideAllPages();
  document.getElementById('sprint-page').classList.remove('hidden');
  renderSprintView();
}

// 渲染迭代视图页
function renderSprintView() {
  // 渲染左侧迭代列表
  renderSprintList();
  
  // 渲染右侧看板或列表
  renderSprintBoard();
  
  // 更新视图切换按钮样式
  updateSprintViewModeButtons();
}

// 渲染左侧迭代列表
function renderSprintList() {
  const sprintList = document.getElementById('sprint-list');
  
  // 构建迭代列表（包括空迭代）
  const sprintNames = currentData.sprints.map(s => s.name);
  
  // 计算每个迭代的需求数量
  const sprintReqCounts = {};
  sprintNames.forEach(name => {
    sprintReqCounts[name] = currentData.requirements.filter(r => r.sprint === name && !r.isArchive).length;
  });
  
  // 未分配迭代的需求数量
  const unassignedCount = currentData.requirements.filter(r => !r.sprint && !r.isArchive).length;
  
  // 排序迭代：进行中的在前，然后按名称排序
  const sortedSprints = [...currentData.sprints].sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
    return a.name.localeCompare(b.name);
  });
  
  let html = '';
  
  // 空迭代选项（未分配）
  const isUnassignedSelected = currentSprint === null || currentSprint === '';
  html += `
    <div onclick="selectSprint('')" 
         class="sidebar-item ${isUnassignedSelected ? 'active' : ''}"
         data-sprint="">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="text-ink-500">
            <rect x="1" y="3" width="12" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/>
            <path d="M1 6h12" stroke="currentColor" stroke-width="1.2"/>
            <path d="M5 1h4v2H5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
          </svg>
          <span class="text-sm text-ink-800">未分配</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="text-xs text-ink-500">${unassignedCount}</span>
        </div>
      </div>
    </div>
  `;
  
  // 迭代列表
  sortedSprints.forEach(sprint => {
    const isSelected = currentSprint === sprint.name;
    const isActive = sprint.status === 'active';
    const reqCount = sprintReqCounts[sprint.name] || 0;
    
    html += `
      <div onclick="selectSprint('${sprint.name.replace(/'/g, "\\'")}')" 
           class="sidebar-item ${isSelected ? 'active' : ''}"
           data-sprint="${sprint.name.replace(/"/g, '&quot;')}"
           ondragover="handleSprintListDragOver(event)"
           ondragleave="handleSprintListDragLeave(event)"
           ondrop="handleSprintListDrop(event, '${sprint.name.replace(/'/g, "\\'")}')">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="${isActive ? 'text-ink-600' : 'text-ink-500'}">
              <rect x="1" y="3" width="12" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/>
              <path d="M1 6h12" stroke="currentColor" stroke-width="1.2"/>
              <path d="M5 1h4v2H5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            </svg>
            <span class="text-sm text-ink-800">${sprint.name}</span>
            ${isActive ? '<span class="px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-ink-600">进行中</span>' : '<span class="px-1.5 py-0.5 rounded text-[10px] bg-ink-100 text-ink-500">已结束</span>'}
          </div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-ink-500">${reqCount}</span>
            <button onclick="event.stopPropagation(); confirmArchiveSprint('${sprint.name.replace(/'/g, "\\'")}')" 
                    class="p-1 rounded hover:bg-red-50 text-ink-500 hover:text-red-500 transition-colors" 
                    title="归档迭代">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 6v8h12V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 3h14v3H1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 9h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  });
  
  sprintList.innerHTML = html;
}

// 确认归档迭代
function confirmArchiveSprint(name) {
  const count = currentData.requirements.filter(r => r.sprint === name && !r.isArchive).length;
  const msg = count > 0
    ? `确定要归档迭代 "${name}" 吗？该迭代下还有 ${count} 个未归档需求，将一并归档。`
    : `确定要归档迭代 "${name}" 吗？`;

  if (!confirm(msg)) return;

  archiveSprint(name);
}

// 选择迭代
function selectSprint(sprintName) {
  currentSprint = sprintName === '' ? null : sprintName;
  renderSprintView();
}

// 渲染右侧看板或列表
function renderSprintBoard() {
  // 填充产品线筛选下拉
  const productLineFilter = document.getElementById('sprint-product-line-filter');
  const settingsProductLines = settings.productLines || [];
  const allReqs = currentSprint === null
    ? currentData.requirements.filter(r => !r.sprint)
    : currentData.requirements.filter(r => r.sprint === currentSprint);
  const reqProductLines = allReqs.flatMap(r => 
    Array.isArray(r.productLine) ? r.productLine : (r.productLine ? [r.productLine] : [])
  );
  const allProductLines = [...new Set([...settingsProductLines, ...reqProductLines])];

  const currentFilter = productLineFilter.value;
  productLineFilter.innerHTML = '<option value="">全部产品线</option>' +
    allProductLines.map(pl => `<option value="${pl}" ${pl === currentFilter ? 'selected' : ''}>${pl}</option>`).join('');

  // 筛选需求
  let sprintReqs = currentSprint === null
    ? currentData.requirements.filter(r => !r.sprint)
    : currentData.requirements.filter(r => r.sprint === currentSprint);
  
  if (productLineFilter.value) {
    sprintReqs = sprintReqs.filter(r => {
      const pls = Array.isArray(r.productLine) ? r.productLine : (r.productLine ? [r.productLine] : []);
      return pls.includes(productLineFilter.value);
    });
  }

  // 渲染视图
  if (sprintViewMode === 'card') {
    document.getElementById('sprint-kanban-board').classList.remove('hidden');
    document.getElementById('sprint-list-view').classList.add('hidden');
    renderSprintKanbanBoard(sprintReqs);
  } else {
    document.getElementById('sprint-kanban-board').classList.add('hidden');
    document.getElementById('sprint-list-view').classList.remove('hidden');
    renderSprintReqTable(sprintReqs);
  }
}

// 渲染迭代视图看板（按状态分组，支持拖拽到其他迭代）
function renderSprintKanbanBoard(reqs) {
  const board = document.getElementById('sprint-kanban-board');

  // Apple 灰度看板配色
  const kanbanColorPalette = [
    { header: 'bg-ink-50 border-ink-100', dot: 'bg-ink-800' },
    { header: 'bg-ink-50 border-ink-100', dot: 'bg-ink-400' },
    { header: 'bg-ink-50 border-ink-100', dot: 'bg-ink-800' },
    { header: 'bg-ink-50 border-ink-100', dot: 'bg-ink-400' },
    { header: 'bg-ink-200 border-ink-200', dot: 'bg-ink-800' },
    { header: 'bg-ink-50 border-ink-100', dot: 'bg-ink-400' },
    { header: 'bg-ink-50 border-ink-100', dot: 'bg-ink-800' },
    { header: 'bg-ink-50 border-ink-100', dot: 'bg-ink-400' }
  ];

  board.innerHTML = (settings.statusList || []).map((status, idx) => {
    const statusReqs = reqs.filter(r => r.status === status);
    const config = kanbanColorPalette[idx % kanbanColorPalette.length];

    return `
      <div class="kanban-column flex-shrink-0 w-[280px] flex flex-col" data-status="${status}">
        <div class="kanban-header border-b ${config.header}">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full ${config.dot}"></span>
            <span class="text-sm font-medium text-ink-800">${status}</span>
          </div>
          <span class="text-xs text-ink-500">${statusReqs.length}</span>
        </div>
        <div class="flex-1 p-2 space-y-2 min-h-[200px]"
             ondragover="handleKanbanDragOver(event)"
             ondragleave="handleKanbanDragLeave(event)"
             ondrop="handleKanbanDrop(event, '${status}')">
          ${statusReqs.map(req => `
            <div draggable="true"
                 ondragstart="handleKanbanDragStart(event, '${req.id}')"
                 class="kanban-card cursor-grab relative group"
                 onclick="showDetail('${req.id}', 'sprint')">
              <button onclick="event.stopPropagation(); archiveReqFromList('${req.id}')"
                      onmousedown="event.stopPropagation()"
                      class="absolute top-2 right-2 w-6 h-6 rounded-lg bg-ink-100 text-ink-500 hover:bg-red-50 hover:text-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all z-10"
                      title="归档" draggable="false">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 6v8h12V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 3h14v3H1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 9h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              </button>
              <div class="text-sm text-ink-800 mb-2 pr-6" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${req.title}</div>
              <div class="flex items-center justify-between">
                <span class="font-mono text-xs text-ink-500">${req.id}</span>
                <span class="priority-badge priority-${req.priority}">${req.priority}</span>
              </div>
              <div class="flex items-center gap-3 mt-2 text-xs text-ink-500">
                ${(() => {
                  const pls = Array.isArray(req.productLine) ? req.productLine : (req.productLine ? [req.productLine] : []);
                  return pls.map(pl => `<span class="px-2 py-0.5 bg-ink-50 rounded text-ink-500">${pl}</span>`).join('');
                })()}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
}

// 渲染迭代视图表格
function renderSprintReqTable(reqs) {
  const listContainer = document.getElementById('sprint-requirements-list');

  if (reqs.length === 0) {
    listContainer.innerHTML = '<tr><td colspan="6" class="px-5 py-12 text-center text-ink-500 text-sm">暂无需求</td></tr>';
    return;
  }

  listContainer.innerHTML = reqs.map(req => {
    const pls = Array.isArray(req.productLine) ? req.productLine : (req.productLine ? [req.productLine] : []);
    return `
      <tr class="border-b border-ink-50 hover:bg-ink-50 transition-colors">
        <td class="px-5 py-4">
          <span class="font-mono text-xs text-ink-500">${req.id}</span>
        </td>
        <td class="px-5 py-4">
          <div class="text-sm text-ink-800 cursor-pointer hover:text-ink-600 transition-colors" onclick="showDetail('${req.id}', 'sprint')">${req.title}</div>
        </td>
        <td class="px-5 py-4" onclick="event.stopPropagation()">
          <select onchange="updateStatus('${req.id}', this.value)" class="text-xs border border-ink-200 rounded-lg px-3 py-1.5 bg-white text-ink-800 cursor-pointer hover:border-ink-400 transition-colors">
            ${(settings.statusList || []).map(s => `<option value="${s}" ${req.status === s ? 'selected' : ''}>${s}</option>`).join('')}
          </select>
        </td>
        <td class="px-5 py-4 text-xs text-ink-500">${pls.join(', ')}</td>
        <td class="px-5 py-4" onclick="event.stopPropagation()">
          <select onchange="updatePriority('${req.id}', this.value)" class="text-xs border border-ink-200 rounded-lg px-3 py-1.5 cursor-pointer hover:border-ink-400 transition-colors ${req.priority ? 'priority-' + req.priority : 'bg-white text-ink-800'}">
            ${(settings.priorityList || []).map(p => `<option value="${p}" ${req.priority === p ? 'selected' : ''}>${p}</option>`).join('')}
          </select>
        </td>
        <td class="px-5 py-4" onclick="event.stopPropagation()">
          <button onclick="event.stopPropagation(); archiveReqFromList('${req.id}')"
                  class="p-1.5 rounded-lg text-ink-500 hover:text-red-500 hover:bg-red-50 transition-colors"
                  title="归档" draggable="false">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 6v8h12V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 3h14v3H1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 9h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

// 切换迭代视图模式
function switchSprintViewMode(mode) {
  sprintViewMode = mode;
  renderSprintBoard();
}

// 更新迭代视图模式按钮样式
function updateSprintViewModeButtons() {
  const btnCard = document.getElementById('btn-sprint-card');
  const btnList = document.getElementById('btn-sprint-list');

  if (!btnCard || !btnList) return;

  if (sprintViewMode === 'card') {
    btnCard.className = 'view-btn active';
    btnList.className = 'view-btn';
  } else {
    btnCard.className = 'view-btn';
    btnList.className = 'view-btn active';
  }
}

// 迭代列表拖拽事件
function handleSprintListDragOver(e) {
  e.preventDefault();
  const item = e.currentTarget;
  item.classList.add('drag-over');
}

function handleSprintListDragLeave(e) {
  const item = e.currentTarget;
  item.classList.remove('drag-over');
}

async function handleSprintListDrop(e, targetSprint) {
  e.preventDefault();
  const item = e.currentTarget;
  item.classList.remove('drag-over');

  if (!draggedReqId) return;

  const req = currentData.requirements.find(r => r.id === draggedReqId);
  if (!req) return;

  const currentSprintVal = req.sprint || '';
  const targetVal = targetSprint || '';
  
  if (currentSprintVal === targetVal) {
    draggedReqId = null;
    return;
  }

  // 更新迭代
  try {
    await fetch(`/api/requirements/${draggedReqId}/sprint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sprint: targetSprint })
    });
    draggedReqId = null;
    await refreshData();
    showToast(`需求已移动到 ${targetSprint || '未分配'}`);
  } catch (err) {
    console.error('拖拽更新迭代失败:', err);
    draggedReqId = null;
    showToast('移动失败', 'error');
  }
}

// 启动
init();

// ========== 需求池 ==========

// 显示需求池页面
function showDraftsPage() {
  previousPage = 'drafts';
  draftTypeFilter = '';
  draftStatusFilter = '';
  hideAllPages();
  document.getElementById('drafts-page').classList.remove('hidden');
  renderDraftsPage();
}

// 渲染需求池页面
function renderDraftsPage() {
  const container = document.getElementById('drafts-list');
  
  // 筛选草稿
  let drafts = currentData.drafts;
  if (draftTypeFilter) {
    drafts = drafts.filter(d => d.type === draftTypeFilter);
  }
  if (draftStatusFilter) {
    drafts = drafts.filter(d => d.status === draftStatusFilter);
  }
  
  // 渲染 Tab
  const allCount = currentData.drafts.length;
  const ideaCount = currentData.drafts.filter(d => d.type === 'idea').length;
  const protoCount = currentData.drafts.filter(d => d.type === 'prototype').length;
  const activeCount = currentData.drafts.filter(d => d.status !== 'published' && d.status !== 'archived').length;
  
  document.getElementById('drafts-type-tabs').innerHTML = [
    { label: `全部 (${allCount})`, filter: '', count: allCount },
    { label: `需求草稿 (${ideaCount})`, filter: 'idea', count: ideaCount },
    { label: `原型草稿 (${protoCount})`, filter: 'prototype', count: protoCount }
  ].map(t => `
    <button onclick="filterDraftsByType('${t.filter}')" 
            class="px-4 py-2 text-sm border border-ink-200 rounded-full hover:border-ink-400 hover:text-ink-600 transition-colors whitespace-nowrap ${draftTypeFilter === t.filter ? 'bg-ink-800 text-white border-ink-800' : ''}">
      ${t.label}
    </button>
  `).join('');
  
  // 状态筛选
  document.getElementById('drafts-status-tabs').innerHTML = `
    <button onclick="filterDraftsByStatus('')" class="px-3 py-1.5 text-xs border border-ink-200 rounded-lg hover:border-ink-400 transition-colors ${draftStatusFilter === '' ? 'bg-ink-100' : ''}">
      全部状态
    </button>
    <button onclick="filterDraftsByStatus('draft')" class="px-3 py-1.5 text-xs border border-ink-200 rounded-lg hover:border-ink-400 transition-colors ${draftStatusFilter === 'draft' ? 'bg-ink-100' : ''}">
      草稿
    </button>
    <button onclick="filterDraftsByStatus('in_progress')" class="px-3 py-1.5 text-xs border border-ink-200 rounded-lg hover:border-ink-400 transition-colors ${draftStatusFilter === 'in_progress' ? 'bg-ink-100' : ''}">
      进行中
    </button>
    <button onclick="filterDraftsByStatus('published')" class="px-3 py-1.5 text-xs border border-ink-200 rounded-lg hover:border-ink-400 transition-colors ${draftStatusFilter === 'published' ? 'bg-ink-100' : ''}">
      已发布
    </button>
    <button onclick="filterDraftsByStatus('archived')" class="px-3 py-1.5 text-xs border border-ink-200 rounded-lg hover:border-ink-400 transition-colors ${draftStatusFilter === 'archived' ? 'bg-ink-100' : ''}">
      已搁置
    </button>
  `;
  
  // 渲染列表
  if (drafts.length === 0) {
    container.innerHTML = `
      <div class="text-center text-ink-500 text-sm py-20">
        <div class="mb-4">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none" class="mx-auto text-ink-300">
            <rect x="8" y="12" width="32" height="28" rx="2" stroke="currentColor" stroke-width="2"/>
            <path d="M8 20h32" stroke="currentColor" stroke-width="2"/>
            <path d="M16 8h16v4H16z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
          </svg>
        </div>
        <p>暂无草稿</p>
        <p class="text-xs mt-1">点击上方「新建草稿」添加</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = drafts.map(draft => {
    const typeIcon = draft.type === 'idea' 
      ? '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2L10 6H14L11 9L12 14L8 11L4 14L5 9L2 6H6L8 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" stroke-width="1.5"/><path d="M2 6h12" stroke="currentColor" stroke-width="1.5"/></svg>';
    
    const typeLabel = draft.type === 'idea' ? '需求' : '原型';
    const typeClass = draft.type === 'idea' ? 'bg-ink-100 text-ink-600' : 'bg-ink-50 text-ink-500';
    
    const statusLabel = { draft: '草稿', in_progress: '进行中', published: '已发布', archived: '已搁置' }[draft.status] || draft.status;
    const statusClass = { draft: 'bg-ink-50 text-ink-500', in_progress: 'bg-blue-50 text-blue-600', published: 'bg-green-50 text-green-600', archived: 'bg-ink-100 text-ink-400' }[draft.status] || 'bg-ink-50 text-ink-500';
    
    const priorityLabel = { low: '低', medium: '中', high: '高' }[draft.priority] || draft.priority || '';
    const priorityBadge = priorityLabel ? `<span class="text-xs text-ink-500">${priorityLabel}优先级</span>` : '';
    
    const sourceLabel = { user_feedback: '用户反馈', competitor: '竞品', tech: '技术优化', self: '自主' }[draft.source] || draft.source || '';
    const sourceBadge = sourceLabel ? `<span class="px-2 py-0.5 bg-ink-50 rounded text-xs text-ink-500">${sourceLabel}</span>` : '';
    
    const publishedId = draft.published_id ? `<span class="font-mono text-xs text-green-600 ml-2">→ ${draft.published_id}</span>` : '';
    
    return `
      <div class="bg-white rounded-2xl border border-ink-100 p-5 hover:border-ink-200 hover:shadow-sm transition-all cursor-pointer"
           onclick="showDraftDetail('${draft.id}')">
        <div class="flex items-start justify-between mb-3">
          <div class="flex items-center gap-2">
            <span class="font-mono text-xs text-ink-500">${draft.id}</span>
            ${publishedId}
          </div>
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 ${typeClass} rounded text-xs">${typeIcon} ${typeLabel}</span>
            <span class="px-2 py-0.5 ${statusClass} rounded text-xs">${statusLabel}</span>
          </div>
        </div>
        <h3 class="text-base font-medium text-ink-800 mb-2">${draft.title || '无标题'}</h3>
        <div class="flex items-center gap-3 text-xs text-ink-500">
          ${priorityBadge}
          ${sourceBadge}
          ${draft.updated_at ? `<span>${formatDate(draft.updated_at)}</span>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// 按类型筛选草稿
function filterDraftsByType(type) {
  draftTypeFilter = type;
  renderDraftsPage();
}

// 按状态筛选草稿
function filterDraftsByStatus(status) {
  draftStatusFilter = status;
  renderDraftsPage();
}

// 显示创建草稿弹窗
function showCreateDraftModal() {
  const modal = document.getElementById('create-draft-modal');
  modal.classList.remove('hidden');
  
  // 收集所有唯一产品线
  const settingsProductLines = settings.productLines || [];
  const reqProductLines = currentData.requirements.flatMap(r =>
    Array.isArray(r.productLine) ? r.productLine : (r.productLine ? [r.productLine] : [])
  );
  const productLines = [...new Set([...settingsProductLines, ...reqProductLines])];
  
  // 渲染产品线选项
  document.getElementById('draft-product-line-select').innerHTML = 
    '<option value="">未指定</option>' +
    productLines.map(pl => `<option value="${pl}">${pl}</option>`).join('');
  
  // 清空输入
  document.getElementById('draft-title').value = '';
  document.getElementById('draft-priority').value = 'medium';
  document.getElementById('draft-source').value = '';
  document.getElementById('draft-type-idea').checked = true;
  
  setTimeout(() => document.getElementById('draft-title').focus(), 100);
}

function closeCreateDraftModal() {
  document.getElementById('create-draft-modal').classList.add('hidden');
}

// 创建草稿
async function createDraft() {
  const title = document.getElementById('draft-title').value.trim();
  const priority = document.getElementById('draft-priority').value;
  const source = document.getElementById('draft-source').value;
  const productLine = document.getElementById('draft-product-line-select').value;
  const type = document.getElementById('draft-type-idea').checked ? 'idea' : 'prototype';
  
  if (!title) {
    alert('请输入标题');
    return;
  }
  
  try {
    const res = await fetch('/api/drafts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, type, priority, source, product_line: productLine })
    });
    
    const data = await res.json();
    
    if (res.ok) {
      closeCreateDraftModal();
      await refreshData();
      showToast(`草稿 ${data.id} 已创建`);
      showDraftDetail(data.id);
    } else {
      alert(data.error || '创建失败');
    }
  } catch (e) {
    console.error('创建草稿失败:', e);
    alert('创建失败，请检查网络');
  }
}

// 显示草稿详情页
function showDraftDetail(draftId) {
  currentDraftId = draftId;
  previousPage = 'drafts';
  hideAllPages();
  document.getElementById('draft-detail-page').classList.remove('hidden');
  renderDraftDetail();
}

// 渲染草稿详情页
function renderDraftDetail() {
  const draft = currentData.drafts.find(d => d.id === currentDraftId);
  if (!draft) {
    document.getElementById('draft-detail-content').innerHTML = '<div class="text-center text-ink-500 py-20">草稿不存在</div>';
    return;
  }
  
  const isIdea = draft.type === 'idea';
  const statusOptions = [
    { value: 'draft', label: '草稿' },
    { value: 'in_progress', label: '进行中' },
    { value: 'published', label: '已发布' },
    { value: 'archived', label: '已搁置' }
  ];
  
  document.getElementById('draft-detail-header').innerHTML = `
    <span class="font-mono text-xs text-ink-500">${draft.id}</span>
    <span class="mx-2 text-ink-200">·</span>
    <span class="text-sm">${draft.title || '无标题'}</span>
    <span class="mx-2 text-ink-200">·</span>
    <span class="px-2 py-0.5 ${isIdea ? 'bg-ink-100 text-ink-600' : 'bg-ink-50 text-ink-500'} rounded text-xs">
      ${isIdea ? '需求草稿' : '原型草稿'}
    </span>
  `;
  
  document.getElementById('draft-detail-content').innerHTML = `
    <div class="space-y-6">
      <!-- 基本信息 -->
      <div class="bg-white rounded-2xl border border-ink-100 p-6">
        <h3 class="text-sm font-semibold text-ink-700 mb-4">基本信息</h3>
        <div class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span class="text-ink-500">标题</span>
            <input type="text" id="draft-edit-title" value="${draft.title || ''}" 
                   class="w-full mt-1 px-3 py-2 border border-ink-200 rounded-lg text-ink-800 focus:outline-none focus:border-ink-400">
          </div>
          <div>
            <span class="text-ink-500">状态</span>
            <select id="draft-edit-status" class="w-full mt-1 px-3 py-2 border border-ink-200 rounded-lg bg-white text-ink-800 focus:outline-none focus:border-ink-400">
              ${statusOptions.map(s => `<option value="${s.value}" ${draft.status === s.value ? 'selected' : ''}>${s.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <span class="text-ink-500">优先级</span>
            <select id="draft-edit-priority" class="w-full mt-1 px-3 py-2 border border-ink-200 rounded-lg bg-white text-ink-800 focus:outline-none focus:border-ink-400">
              <option value="low" ${draft.priority === 'low' ? 'selected' : ''}>低</option>
              <option value="medium" ${(!draft.priority || draft.priority === 'medium') ? 'selected' : ''}>中</option>
              <option value="high" ${draft.priority === 'high' ? 'selected' : ''}>高</option>
            </select>
          </div>
          <div>
            <span class="text-ink-500">来源</span>
            <select id="draft-edit-source" class="w-full mt-1 px-3 py-2 border border-ink-200 rounded-lg bg-white text-ink-800 focus:outline-none focus:border-ink-400">
              <option value="">未指定</option>
              <option value="user_feedback" ${draft.source === 'user_feedback' ? 'selected' : ''}>用户反馈</option>
              <option value="competitor" ${draft.source === 'competitor' ? 'selected' : ''}>竞品分析</option>
              <option value="tech" ${draft.source === 'tech' ? 'selected' : ''}>技术优化</option>
              <option value="self" ${draft.source === 'self' ? 'selected' : ''}>自主提出</option>
            </select>
          </div>
          <div>
            <span class="text-ink-500">关联产品线</span>
            <input type="text" id="draft-edit-product-line" value="${draft.product_line || ''}" 
                   class="w-full mt-1 px-3 py-2 border border-ink-200 rounded-lg text-ink-800 focus:outline-none focus:border-ink-400"
                   placeholder="未指定">
          </div>
          <div>
            <span class="text-ink-500">发布时间</span>
            <input type="date" id="draft-edit-due-date" 
                   class="w-full mt-1 px-3 py-2 border border-ink-200 rounded-lg text-ink-800 focus:outline-none focus:border-ink-400">
          </div>
        </div>
        <div class="mt-4 flex justify-end">
          <button onclick="updateDraft()" class="px-4 py-2 bg-ink-800 text-white text-sm font-medium rounded-lg hover:bg-ink-700 transition-colors">
            保存修改
          </button>
        </div>
      </div>
      
      ${isIdea ? `
      <!-- 文档内容 -->
      <div class="bg-white rounded-2xl border border-ink-100 p-6">
        <h3 class="text-sm font-semibold text-ink-700 mb-4">文档内容</h3>
        <textarea id="draft-edit-body" rows="12"
                  class="w-full px-4 py-3 border border-ink-200 rounded-xl text-sm font-mono text-ink-800 focus:outline-none focus:border-ink-400 resize-none"
                  placeholder="输入需求文档内容...">${draft.body || ''}</textarea>
        <div class="mt-4 flex justify-end">
          <button onclick="updateDraftBody()" class="px-4 py-2 bg-ink-800 text-white text-sm font-medium rounded-lg hover:bg-ink-700 transition-colors">
            保存文档
          </button>
        </div>
      </div>
      ` : `
      <!-- 原型预览 -->
      <div class="bg-white rounded-2xl border border-ink-100 p-6">
        <h3 class="text-sm font-semibold text-ink-700 mb-4">原型预览</h3>
        <div class="border border-ink-100 rounded-xl overflow-hidden">
          <iframe src="/drafts/${encodeURIComponent(draft.bodyPath?.split(/[/\\]/).pop() || '')}" 
                  class="w-full h-[500px] border-0"></iframe>
        </div>
      </div>
      `}
      
      <!-- 发布选项 -->
      ${draft.status !== 'published' ? `
      <div class="bg-white rounded-2xl border border-ink-100 p-6">
        <h3 class="text-sm font-semibold text-ink-700 mb-4">发布为正式需求</h3>
        <div class="grid grid-cols-2 gap-4 mb-4">
          <div>
            <span class="text-sm text-ink-600">目标产品线</span>
            <select id="publish-product-line" class="w-full mt-1 px-3 py-2 border border-ink-200 rounded-lg bg-white text-ink-800 focus:outline-none focus:border-ink-400">
              ${(settings.productLines || []).map(pl => `<option value="${pl}" ${pl === draft.product_line ? 'selected' : ''}>${pl}</option>`).join('')}
              ${draft.product_line && !settings.productLines?.includes(draft.product_line) ? `<option value="${draft.product_line}" selected>${draft.product_line}</option>` : ''}
            </select>
          </div>
          <div>
            <span class="text-sm text-ink-600">优先级</span>
            <select id="publish-priority" class="w-full mt-1 px-3 py-2 border border-ink-200 rounded-lg bg-white text-ink-800 focus:outline-none focus:border-ink-400">
              <option value="P0" ${(!draft.priority || draft.priority === 'high') ? 'selected' : ''}>P0 - 最高</option>
              <option value="P1" ${draft.priority === 'medium' ? 'selected' : ''}>P1 - 高</option>
              <option value="P2" ${draft.priority === 'low' ? 'selected' : ''}>P2 - 中</option>
            </select>
          </div>
        </div>
        <button onclick="publishDraft()" class="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-500 transition-colors">
          发布需求
        </button>
      </div>
      ` : ''}
      
      <!-- 操作 -->
      <div class="flex justify-between items-center">
        <div class="text-xs text-ink-500">
          创建于: ${draft.created_at ? new Date(draft.created_at).toLocaleString('zh-CN') : '-'}
          ${draft.published_id ? `<br>已发布为: <span class="text-green-600">${draft.published_id}</span>` : ''}
        </div>
        <div class="flex gap-3">
          ${draft.status !== 'published' ? `
          <button onclick="archiveDraft()" class="px-4 py-2 text-sm text-ink-600 border border-ink-200 rounded-lg hover:bg-ink-50 transition-colors">
            搁置
          </button>
          ` : ''}
          <button onclick="confirmDeleteDraft()" class="px-4 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors">
            删除
          </button>
        </div>
      </div>
    </div>
  `;
}

// 更新草稿基本信息
async function updateDraft() {
  const title = document.getElementById('draft-edit-title').value.trim();
  const status = document.getElementById('draft-edit-status').value;
  const priority = document.getElementById('draft-edit-priority').value;
  const source = document.getElementById('draft-edit-source').value;
  const product_line = document.getElementById('draft-edit-product-line').value;
  
  if (!title) {
    alert('标题不能为空');
    return;
  }
  
  try {
    const res = await fetch(`/api/drafts/${currentDraftId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, status, priority, source, product_line })
    });
    
    if (res.ok) {
      showToast('草稿已更新');
      await refreshData();
    } else {
      const data = await res.json();
      alert(data.error || '更新失败');
    }
  } catch (e) {
    console.error('更新草稿失败:', e);
    alert('更新失败');
  }
}

// 更新草稿文档内容
async function updateDraftBody() {
  const body = document.getElementById('draft-edit-body').value;
  
  try {
    const res = await fetch(`/api/drafts/${currentDraftId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body })
    });
    
    if (res.ok) {
      showToast('文档已保存');
      await refreshData();
    } else {
      const data = await res.json();
      alert(data.error || '保存失败');
    }
  } catch (e) {
    console.error('保存文档失败:', e);
    alert('保存失败');
  }
}

// 发布草稿
async function publishDraft() {
  if (!confirm('确定要发布这个草稿为正式需求吗？')) return;
  
  const productLine = document.getElementById('publish-product-line').value;
  const priority = document.getElementById('publish-priority').value;
  
  try {
    const res = await fetch(`/api/drafts/${currentDraftId}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productLine, priority })
    });
    
    const data = await res.json();
    
    if (res.ok) {
      showToast(`已发布为需求 ${data.id}`);
      await refreshData();
      // 跳转到需求详情
      showDetail(data.id);
    } else {
      alert(data.error || '发布失败');
    }
  } catch (e) {
    console.error('发布草稿失败:', e);
    alert('发布失败');
  }
}

// 搁置草稿
async function archiveDraft() {
  if (!confirm('确定要搁置这个草稿吗？')) return;
  
  try {
    const res = await fetch(`/api/drafts/${currentDraftId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'archived' })
    });
    
    if (res.ok) {
      showToast('草稿已搁置');
      await refreshData();
      renderDraftDetail();
    } else {
      const data = await res.json();
      alert(data.error || '操作失败');
    }
  } catch (e) {
    console.error('搁置草稿失败:', e);
    alert('操作失败');
  }
}

// 确认删除草稿
function confirmDeleteDraft() {
  if (!confirm('确定要删除这个草稿吗？此操作不可恢复。')) return;
  deleteDraft();
}

// 删除草稿
async function deleteDraft() {
  try {
    const res = await fetch(`/api/drafts/${currentDraftId}`, {
      method: 'DELETE'
    });
    
    if (res.ok) {
      showToast('草稿已删除');
      await refreshData();
      showDraftsPage();
    } else {
      const data = await res.json();
      alert(data.error || '删除失败');
    }
  } catch (e) {
    console.error('删除草稿失败:', e);
    alert('删除失败');
  }
}

// 返回需求池列表
function backToDrafts() {
  showDraftsPage();
}
