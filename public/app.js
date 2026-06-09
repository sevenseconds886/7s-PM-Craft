// 全局状态
let currentData = { requirements: [], sprints: [], drafts: [], ideas: [] };
let settings = { statusList: [], priorityList: [] };
let currentProductLine = '';
let cachedStats = { physicalProductLines: [], productLineCounts: {} };
let isRenderingHome = false;
let currentReqId = null;
let currentPlatform = 'web';
let docPanelOpen = false;
let docEditMode = false;
let draggedReqId = null;
let isSearchMode = false;
let listPageSize = 50;
let listCurrentPage = 1;
let listAllReqs = [];
let isLoadingMore = false;

// HTML 转义工具（防止 XSS）
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 将值转为数组（产品线字段兼容 string/array）
function toArray(v) {
  return Array.isArray(v) ? v : (v ? [v] : []);
}

// 常量配置
const CONFIG = {
  TOAST_DURATION: 2800,
  TOAST_FADE_DELAY: 260,
  DROPDOWN_SPACE_THRESHOLD: 200,
  SIDEBAR_MIN_WIDTH: 180,
  SIDEBAR_MAX_WIDTH: 400,
  DOC_PANEL_MIN_WIDTH: 260,
  DOC_PANEL_MAX_WIDTH: 600,
};

// ============================================================================
// 层级结构工具函数
// ============================================================================
const HierarchyUtils = {
  getChildren(requirements, parentId) {
    return requirements.filter(r => r.parent_id === parentId);
  },
  getParent(requirements, reqId) {
    const req = requirements.find(r => r.id === reqId);
    if (!req || !req.parent_id) return null;
    return requirements.find(r => r.id === req.parent_id) || null;
  },
  hasChildren(requirements, reqId) {
    return requirements.some(r => r.parent_id === reqId);
  },
  getDepth(requirements, reqId) {
    const req = requirements.find(r => r.id === reqId);
    if (!req || !req.parent_id) return 0;
    return 1;
  },
  getBreadcrumbPath(requirements, reqId) {
    const req = requirements.find(r => r.id === reqId);
    if (!req || !req.parent_id) return req.title;
    const parent = requirements.find(r => r.id === req.parent_id);
    return parent ? `${parent.title} > ${req.title}` : req.title;
  },
  buildHierarchyList(requirements) {
    const result = [];
    const processed = new Set();
    requirements.filter(r => !r.parent_id).forEach(parent => {
      result.push(parent);
      processed.add(parent.id);
      requirements.filter(r => r.parent_id === parent.id).forEach(child => {
        result.push(child);
        processed.add(child.id);
      });
    });
    requirements.filter(r => !processed.has(r.id)).forEach(r => result.push(r));
    return result;
  },
  checkCycleClient(requirements, reqId, parentId) {
    let current = parentId;
    let depth = 0;
    while (current && depth < 50) {
      if (current === reqId) return true;
      const req = requirements.find(r => r.id === current);
      current = req ? req.parent_id : null;
      depth++;
    }
    return false;
  },
  isDescendant(requirements, ancestorId, descendantId) {
    let current = descendantId;
    let depth = 0;
    while (current && depth < 50) {
      const req = requirements.find(r => r.id === current);
      if (!req || !req.parent_id) return false;
      if (req.parent_id === ancestorId) return true;
      current = req.parent_id;
      depth++;
    }
    return false;
  }
};

// 表格行折叠切换
function toggleParentRow(toggleEl, parentId) {
  const row = toggleEl.closest('tr');
  const isCollapsed = row.classList.contains('collapsed');
  const childRows = document.querySelectorAll(`tr[data-child-of="${CSS.escape(parentId)}"]`);
  childRows.forEach(child => {
    child.classList.toggle('hidden', !isCollapsed);
  });
  row.classList.toggle('collapsed', !isCollapsed);
}

// 通过 parentId 折叠切换（用于父需求列徽章点击）
function toggleParentRowById(parentId) {
  const row = document.querySelector(`tr[data-parent-id="${CSS.escape(parentId)}"]`);
  if (!row) return;
  const isCollapsed = row.classList.contains('collapsed');
  const childRows = document.querySelectorAll(`tr[data-child-of="${CSS.escape(parentId)}"]`);
  childRows.forEach(child => {
    child.classList.toggle('hidden', !isCollapsed);
  });
  row.classList.toggle('collapsed', !isCollapsed);
  // 同步更新树形前缀的箭头
  const toggleEl = row.querySelector('.tree-toggle');
  if (toggleEl) {
    toggleEl.textContent = isCollapsed ? '▼' : '▶';
  }
}

let lastSearchQuery = '';
let activeFilters = { status: null, priority: null, sprint: null, developer: '', requester: '' }; // 高级筛选状态
let statusViewMode = 'list'; // 'card' | 'list'
let sprintViewMode = 'card'; // 迭代视图模式: 'card' | 'list'
let currentSprint = null; // 当前选中的迭代名称（null 表示空迭代）
let previousPage = 'home'; // 'home' | 'list' | 'archive' | 'sprint' | 'drafts'
let docIsDirty = false; // 文档是否被修改过

// 需求池状态
let editingDraft = null;
let currentDraftStatusFilter = ''; // 当前状态筛选

// ===== 面板拖拽调整宽度 =====
function initResizablePanels() {
  const sidebar = document.getElementById('detail-sidebar');
  const sidebarResizer = document.getElementById('sidebar-resizer');
  const docPanel = document.getElementById('doc-panel');
  const docResizer = document.getElementById('doc-resizer');

  // 从 localStorage 恢复宽度
  const savedSidebar = localStorage.getItem('pm-sidebar-width');
  const savedDoc = localStorage.getItem('pm-doc-width');
  if (savedSidebar) sidebar.style.width = savedSidebar + 'px';
  if (savedDoc) docPanel.style.width = savedDoc + 'px';

  function makeResizable(handle, target, direction, minW, maxW, storageKey) {
    let startX, startW;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startW = target.offsetWidth;
      handle.classList.add('active');
      document.body.classList.add('resizing');
      const onMove = (e) => {
        const dx = e.clientX - startX;
        const newW = direction === 'left' ? startW + dx : startW - dx;
        const clamped = Math.max(minW, Math.min(maxW, newW));
        target.style.width = clamped + 'px';
      };
      const onUp = () => {
        handle.classList.remove('active');
        document.body.classList.remove('resizing');
        localStorage.setItem(storageKey, target.offsetWidth);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // 左侧 sidebar：向右拖放大
  makeResizable(sidebarResizer, sidebar, 'left', CONFIG.SIDEBAR_MIN_WIDTH, CONFIG.SIDEBAR_MAX_WIDTH, 'pm-sidebar-width');
  // 右侧 doc panel：向左拖放大
  makeResizable(docResizer, docPanel, 'right', CONFIG.DOC_PANEL_MIN_WIDTH, CONFIG.DOC_PANEL_MAX_WIDTH, 'pm-doc-width');
}

// ===== CustomDropdown 组件 =====
let _cdUID = 0;

// 颜色映射表
const CD_STATUS_COLORS = {
  '设计中': { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
  '待评审': { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  '开发中': { bg: '#e0e7ff', text: '#3730a3', border: '#a5b4fc' },
  '待验收': { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' },
  '已完成': { bg: '#d1fae5', text: '#065f46', border: '#6ee7b7' },
  '挂起':   { bg: '#f1f0ee', text: '#78716c', border: '#d6d3d1' },
};
const CD_PRIORITY_COLORS = {
  'P0': { bg: '#c46e52', text: '#ffffff' },
  'P1': { bg: '#d98f78', text: '#ffffff' },
  'P2': { bg: '#eab9a8', text: '#52271f' },
  'P3': { bg: '#c8d1bd', text: '#2e3829' },
  'P4': { bg: '#d4cfc7', text: '#4a433c' },
  'P5': { bg: '#e8e5e0', text: '#635a50' },
};

function cdGetOptBadgeStyle(type, value) {
  if (type === 'status' && CD_STATUS_COLORS[value]) {
    return `background:${CD_STATUS_COLORS[value].bg};color:${CD_STATUS_COLORS[value].text};`;
  }
  if (type === 'priority' && CD_PRIORITY_COLORS[value]) {
    return `background:${CD_PRIORITY_COLORS[value].bg};color:${CD_PRIORITY_COLORS[value].text};`;
  }
  return '';
}

/**
 * 生成 CustomDropdown HTML 片段
 * @param {Object} cfg
 * @param {string} cfg.id        - 唯一ID
 * @param {string} cfg.value     - 当前选中值
 * @param {Array}  cfg.options   - [{value, label}]
 * @param {string} cfg.style     - 'pill' | 'filter' | 'form'
 * @param {string} cfg.colorType - 'status' | 'priority' | '' (无着色)
 * @param {string} cfg.onChange  - 回调函数名，如 'updateStatus'
 * @param {string} cfg.extraClass - 额外 class
 * @param {string} cfg.stopClick - 是否阻止事件冒泡（行内编辑用）
 */
function cdRender(cfg) {
  const uid = cfg.id || ('cd-' + (++_cdUID));
  const styleCls = cfg.style === 'filter' ? 'cdropdown-pill cdropdown-filter'
    : cfg.style === 'form' ? 'cdropdown-form'
    : cfg.style === 'text' ? 'cdropdown-text'
    : 'cdropdown-pill';
  const colorCls = cfg.colorType && cfg.value ? `cd-${cfg.colorType}-${cfg.value}` : '';
  const selOpt = cfg.options.find(o => o.value === cfg.value) || cfg.options[0];
  const label = selOpt ? selOpt.label : '';

  const optsHtml = cfg.options.map(o => {
    const sel = o.value === cfg.value ? 'selected' : '';
    const badgeStyle = cdGetOptBadgeStyle(cfg.colorType, o.value);
    const badgeHtml = badgeStyle ? `<span class="cd-opt-badge" style="${badgeStyle}">${o.label}</span>` : '';
    const titleAttr = o.title ? `title="${escapeHtml(o.title)}"` : '';
    return `<div class="cdropdown-option ${sel}" data-value="${o.value}" ${titleAttr}>${badgeHtml || o.label}</div>`;
  }).join('');

  const stopClickAttr = cfg.stopClick ? 'data-stop-click="true"' : '';

  return `<div class="cdropdown ${styleCls} ${colorCls} ${cfg.extraClass || ''}" id="${uid}" data-onchange="${cfg.onChange || ''}" data-cd-value="${cfg.value || ''}" ${stopClickAttr}>
    <div class="cdropdown-trigger" onclick="cdToggle('${uid}')">
      <span class="cd-label">${label}</span>
      <svg class="cd-arrow" viewBox="0 0 14 14" fill="none"><path fill="currentColor" d="M7 9L2 3h10z"/></svg>
    </div>
    <div class="cdropdown-panel">${optsHtml}</div>
  </div>`;
}

function cdToggle(uid) {
  const el = document.getElementById(uid);
  if (!el) return;
  // 先关闭其他
  document.querySelectorAll('.cdropdown.open').forEach(d => { if (d.id !== uid) d.classList.remove('open'); });
  el.classList.toggle('open');
  // 计算是否向上展开
  if (el.classList.contains('open')) {
    const panel = el.querySelector('.cdropdown-panel');
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    panel.classList.toggle('upward', spaceBelow < CONFIG.DROPDOWN_SPACE_THRESHOLD);
  }
}

function cdSelect(uid, value) {
  const el = document.getElementById(uid);
  if (!el) return;
  el.dataset.cdValue = value;
  el.classList.remove('open');

  // 更新颜色 class
  const colorType = Array.from(el.classList).find(c => c.startsWith('cd-status-') || c.startsWith('cd-priority-'));
  if (colorType) el.classList.remove(colorType);
  // 检测新颜色类型
  const isStatus = el.classList.contains('cdropdown-pill') || el.classList.contains('cdropdown-filter');
  // 从 options 中推断 colorType
  const prevColorCls = el.className.match(/\bcd-(status|priority)-\S+/);
  if (prevColorCls) el.classList.remove(prevColorCls[0]);
  // 重新检测：看 data-onchange 或 class 来推断
  const onchange = el.dataset.onchange;
  let colorType2 = '';
  if (onchange && onchange.includes('Status')) colorType2 = 'status';
  else if (onchange && (onchange.includes('Priority') || onchange.includes('priority'))) colorType2 = 'priority';
  if (colorType2 && value) el.classList.add(`cd-${colorType2}-${value}`);

  // 更新 label
  const optEl = el.querySelector(`.cdropdown-option[data-value="${CSS.escape(value)}"]`);
  const label = optEl ? (optEl.querySelector('.cd-opt-badge')?.textContent || optEl.textContent.trim()) : value;
  el.querySelector('.cd-label').textContent = label;

  // 更新 selected
  el.querySelectorAll('.cdropdown-option').forEach(o => o.classList.toggle('selected', o.dataset.value === value));

  // 触发回调
  if (onchange) {
    // 解析 "funcName('arg1','arg2')" 格式，把 value 作为最后一个参数
    const fnMatch = onchange.match(/^(\w+)\((.*)\)$/);
    if (fnMatch) {
      const fn = window[fnMatch[1]];
      if (fn) {
        const args = fnMatch[2] ? fnMatch[2].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')) : [];
        fn(...args, value);
      }
    }
  }
}

// 点击外部关闭
document.addEventListener('click', (e) => {
  if (!e.target.closest('.cdropdown')) {
    document.querySelectorAll('.cdropdown.open').forEach(d => d.classList.remove('open'));
  }
});

// option 点击事件委托
document.addEventListener('click', (e) => {
  const opt = e.target.closest('.cdropdown-option');
  if (!opt) return;
  e.stopPropagation();
  const dropdown = opt.closest('.cdropdown');
  if (!dropdown) return;
  cdSelect(dropdown.id, opt.dataset.value);
});

// 阻止标记了 data-stop-click 的元素点击冒泡（用于行内编辑场景，但不阻止 cdropdown-option 点击冒泡）
document.addEventListener('click', (e) => {
  // 如果点击的是 cdropdown-option，永远不阻止冒泡（让事件委托处理器正常工作）
  if (e.target.closest('.cdropdown-option')) return;
  // 对于标记了 data-stop-click 的元素（dropdown / td），阻止冒泡
  const stopEl = e.target.closest('[data-stop-click="true"]');
  if (stopEl) {
    e.stopPropagation();
  }
});

// ===== 全局事件委托（替代内联 onclick）=====
document.addEventListener('click', (e) => {
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;
  const mode = actionEl.dataset.mode;
  const status = actionEl.dataset.status;

  // 导航/页面切换
  if (action === 'showHome') { showHome(); return; }
  if (action === 'showListPage') { showListPage(); return; }
  if (action === 'showSprintView') { showSprintView(); return; }
  if (action === 'showDraftsPage') { showDraftsPage(); return; }
  if (action === 'showIdeasPage') { showIdeasPage(); return; }
  if (action === 'showArchivePage') { showArchivePage(); return; }

  // 弹窗
  if (action === 'showSettings') { showSettings(); return; }
  if (action === 'closeSettings') { closeSettings(); return; }
  if (action === 'showCreateReqModal') { showCreateReqModal(); return; }
  if (action === 'closeCreateReqModal') { closeCreateReqModal(); return; }
  if (action === 'showCreateSprintModal') { showCreateSprintModal(); return; }
  if (action === 'closeCreateSprintModal') { closeCreateSprintModal(); return; }
  if (action === 'showDraftModal') { showDraftModal(); return; }
  if (action === 'closeDraftModal') { closeDraftModal(); return; }
  if (action === 'showIdeaModal') { showIdeaModal(); return; }
  if (action === 'closeIdeaModal') { closeIdeaModal(); return; }
  if (action === 'saveIdea') { saveIdea(); return; }
  if (action === 'closeIdeaConvertModal') { closeIdeaConvertModal(); return; }
  if (action === 'closeIdeaViewModal') { closeIdeaViewModal(); return; }
  if (action === 'confirmIdeaConvert') { confirmIdeaConvert(); return; }
  if (action === 'showVersionHistory') { showVersionHistory(); return; }
  if (action === 'closeVersionHistory') { closeVersionHistory(); return; }
  if (action === 'closePublishModal') { closePublishModal(); return; }
  if (action === 'closeDraftPreviewModal') { closeDraftPreviewModal(); return; }
  // [ARCHIVED] TAPD 事件 —— 已归档至 archive/tapd/
  // if (action === 'publishToTapd') { showTapdPublishModal(); return; }
  // if (action === 'closeTapdModal') { closeTapdModal(); return; }
  // if (action === 'startTapdAuth') { startTapdAuth(); return; }
  // if (action === 'confirmTapdPublish') { confirmTapdPublish(); return; }
  // if (action === 'saveTapdSettings') { saveTapdSettings(); return; }
  // if (action === 'saveTapdTokenSettings') { saveTapdTokenSettings(); return; }
  // if (action === 'switchTapdAuthTab') { switchTapdAuthTab(el.dataset.tab); return; }

  // 操作
  if (action === 'refreshData') { refreshData(); return; }
  if (action === 'clearSearch') { clearSearch(); return; }
  if (action === 'clearFilters') { clearFilters(); return; }
  if (action === 'createRequirement') { createRequirement(); return; }
  if (action === 'createSprintFromModal') { createSprintFromModal(); return; }
  if (action === 'saveDraft') { saveDraft(); return; }
  if (action === 'confirmPublish') { confirmPublish(); return; }
  if (action === 'addNewProductLine') { addNewProductLine(); return; }
  if (action === 'addProductLineFromSettings') { addProductLineFromSettings(); return; }
  if (action === 'addStatusFromSettings') { addStatusFromSettings(); return; }
  if (action === 'addPriorityFromSettings') { addPriorityFromSettings(); return; }

  // 视图切换
  if (action === 'switchStatusViewMode') { switchStatusViewMode(mode); return; }
  if (action === 'switchSprintViewMode') { switchSprintViewMode(mode); return; }

  // 详情页
  if (action === 'toggleDocPanel') { toggleDocPanel(); return; }
  if (action === 'toggleDocEditMode') { toggleDocEditMode(); return; }
  if (action === 'saveDocContent') { saveDocContent(); return; }
  if (action === 'cancelDocEdit') { cancelDocEdit(); return; }
  if (action === 'togglePrototypeFullscreen') { togglePrototypeFullscreen(); return; }

  // 需求池
  if (action === 'setDraftStatusFilter') { setDraftStatusFilter(status); return; }
  if (action === 'toggleArchivedDrafts') {
    document.getElementById('archived-drafts-content').classList.toggle('hidden');
    actionEl.querySelector('.chevron').classList.toggle('rotate-180');
    return;
  }
});

// input 事件委托
document.addEventListener('input', (e) => {
  const action = e.target.dataset.inputAction;
  if (!action) return;
  if (action === 'applyFilters') { applyFilters(); return; }
  if (action === 'renderDraftsList') { renderDraftsList(); return; }
  if (action === 'renderIdeas') { renderIdeas(); return; }
});

// keydown 事件委托（Enter 触发）
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const action = e.target.dataset.keydownAction;
  if (!action) return;
  e.preventDefault();
  if (action === 'addNewProductLine') { addNewProductLine(); return; }
  if (action === 'createSprintFromModal') { createSprintFromModal(); return; }
  if (action === 'addProductLineFromSettings') { addProductLineFromSettings(); return; }
  if (action === 'addStatusFromSettings') { addStatusFromSettings(); return; }
  if (action === 'addPriorityFromSettings') { addPriorityFromSettings(); return; }
});

// 获取 dropdown 当前值
function cdGetValue(uid) {
  const el = document.getElementById(uid);
  return el ? el.dataset.cdValue : '';
}

// 设置 dropdown 值（不触发回调）
function cdSetValue(uid, value) {
  const el = document.getElementById(uid);
  if (!el) return;
  el.dataset.cdValue = value;
  // 更新颜色 class
  const prevColorCls = el.className.match(/\bcd-(status|priority)-\S+/);
  if (prevColorCls) el.classList.remove(prevColorCls[0]);
  const onchange = el.dataset.onchange;
  let colorType = '';
  if (onchange && onchange.includes('Status')) colorType = 'status';
  else if (onchange && (onchange.includes('Priority') || onchange.includes('priority'))) colorType = 'priority';
  if (colorType && value) el.classList.add(`cd-${colorType}-${value}`);
  // 更新 label 和 selected
  const optEl = el.querySelector(`.cdropdown-option[data-value="${CSS.escape(value)}"]`);
  const label = optEl ? (optEl.querySelector('.cd-opt-badge')?.textContent || optEl.textContent.trim()) : value;
  el.querySelector('.cd-label').textContent = label;
  el.querySelectorAll('.cdropdown-option').forEach(o => o.classList.toggle('selected', o.dataset.value === value));
}

// 更新 dropdown 的 options
function cdUpdateOptions(uid, options, selectedValue) {
  const el = document.getElementById(uid);
  if (!el) return;
  const panel = el.querySelector('.cdropdown-panel');
  // 推断 colorType
  const onchange = el.dataset.onchange;
  let colorType = '';
  if (onchange && onchange.includes('Status')) colorType = 'status';
  else if (onchange && (onchange.includes('Priority') || onchange.includes('priority'))) colorType = 'priority';

  panel.innerHTML = options.map(o => {
    const sel = o.value === selectedValue ? 'selected' : '';
    const badgeStyle = cdGetOptBadgeStyle(colorType, o.value);
    const badgeHtml = badgeStyle ? `<span class="cd-opt-badge" style="${badgeStyle}">${o.label}</span>` : '';
    return `<div class="cdropdown-option ${sel}" data-value="${o.value}">${badgeHtml || o.label}</div>`;
  }).join('');
  if (selectedValue !== undefined) cdSetValue(uid, selectedValue);
}

// Toast 提示 - Apple 陶土色系风格
function showToast(message, type = 'success') {
  // 确保 toast 容器存在
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const icons = {
    success: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5L4.5 8.5L9.5 3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    error: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    info: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.4"/><path d="M6 5v3M6 3.5v.01" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  };

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <div class="toast-bar"></div>
    <div class="toast-icon">${icons[type] || icons.info}</div>
    <div class="toast-msg">${message}</div>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), CONFIG.TOAST_FADE_DELAY);
  }, CONFIG.TOAST_DURATION);
}

// 初始化自定义状态/优先级样式（Apple 灰度风格）
function initCustomStyles() {
  const defaultStatuses = ['设计中', '待评审', '开发中', '待验收', '已完成', '挂起'];
  const defaultPriorities = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'];

  // 复用 CD_STATUS_COLORS 和 CD_PRIORITY_COLORS，避免重复定义
  const statusPalette = Object.values(CD_STATUS_COLORS).map(c => ({ bg: c.bg, text: c.text }));
  const priorityPalette = Object.values(CD_PRIORITY_COLORS).map(c => ({ bg: c.bg, text: c.text }));

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
  initResizablePanels();
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
    const [reqRes, sprintRes, draftRes, ideaRes] = await Promise.all([
      fetch('/api/requirements'),
      fetch('/api/sprints'),
      fetch('/api/drafts'),
      fetch('/api/ideas')
    ]);

    const reqData = await reqRes.json();
    const sprintData = await sprintRes.json();
    const draftData = await draftRes.json();
    const ideaData = await ideaRes.json();

    currentData.requirements = reqData.requirements;
    currentData.sprints = sprintData.sprints || [];
    currentData.drafts = draftData.drafts || [];
    currentData.ideas = ideaData.ideas || [];

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
      renderDraftsList();
    } else if (!document.getElementById('ideas-page').classList.contains('hidden')) {
      renderIdeas();
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
  if (isRenderingHome) return;
  isRenderingHome = true;

  const statsContainer = document.getElementById('stats-container');
  const productLinesContainer = document.getElementById('product-lines');
  const archivedCard = document.getElementById('archived-card');

  if (!statsContainer || !productLinesContainer) {
    isRenderingHome = false;
    return;
  }

  // 使用本地数据计算统计（同步渲染，不阻塞）
  let statsData = {
    total: currentData.requirements.filter(r => !r.isArchive).length,
    archived: currentData.requirements.filter(r => r.isArchive).length,
    statusCounts: {},
    productLineCounts: {},
    physicalProductLines: []
  };

  // 计算状态统计
  for (const req of currentData.requirements) {
    if (!req.isArchive && req.status) {
      statsData.statusCounts[req.status] = (statsData.statusCounts[req.status] || 0) + 1;
    }
  }

  // 后台异步获取物理产品线信息并更新（如果有差异）
  fetch('/api/stats')
    .then(res => res.ok ? res.json() : null)
    .then(remoteStats => {
      if (remoteStats) {
        const oldPLs = JSON.stringify(cachedStats.physicalProductLines);
        const newPLs = JSON.stringify(remoteStats.physicalProductLines || []);
        cachedStats.physicalProductLines = remoteStats.physicalProductLines || [];
        cachedStats.productLineCounts = remoteStats.productLineCounts || {};
        if (oldPLs !== newPLs) {
          // 物理产品线列表有变化，重新渲染
          renderHome();
        }
      }
    })
    .catch(() => {}); // 静默失败，不影响当前渲染

  // 状态配色（与 CD_STATUS_COLORS 对应）
  const statusColorPalette = [
    'bg-blue-100 text-blue-800',
    'bg-amber-100 text-amber-800',
    'bg-indigo-100 text-indigo-800',
    'bg-pink-100 text-pink-800',
    'bg-emerald-100 text-emerald-800',
    'bg-stone-100 text-stone-500',
  ];

  const stats = { total: statsData.total || 0 };
  const statColors = { total: 'bg-ink-800 text-white' };
  const statLabels = { total: '总需求' };

  (settings.statusList || []).forEach((status, idx) => {
    stats[status] = (statsData.statusCounts && statsData.statusCounts[status]) || 0;
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
  if (archivedCard) {
    archivedCard.querySelector('.archived-count').textContent = statsData.archived || 0;
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

  // 更新灵感集入口计数
  const ideasEntry = document.getElementById('ideas-entry');
  if (ideasEntry) {
    ideasEntry.querySelector('.ideas-count').textContent = currentData.ideas.length;
  }

  // ===== 产品线卡片：只显示有物理文件夹的产品线 =====
  const physicalPLs = cachedStats.physicalProductLines || statsData.physicalProductLines || [];
  const plCounts = cachedStats.productLineCounts || statsData.productLineCounts || {};

  // 构建产品线统计（基于 mainProductLine）
  const plStats = new Map();
  for (const req of currentData.requirements) {
    if (req.isArchive) continue;
    const mainPL = req.mainProductLine || '未分类';
    if (!plStats.has(mainPL)) {
      plStats.set(mainPL, { count: 0, statusCounts: new Map() });
    }
    const stat = plStats.get(mainPL);
    stat.count++;
    stat.statusCounts.set(req.status, (stat.statusCounts.get(req.status) || 0) + 1);
  }

  // 有物理文件夹的产品线都展示（包括空的），按名称排序
  // 「未分类」作为默认常驻卡片，始终置底
  let productLines = physicalPLs.filter(pl => pl !== '未分类').sort();
  const hasUncategorizedDir = physicalPLs.includes('未分类');

  // 搜索过滤
  if (productLineSearchQuery) {
    productLines = productLines.filter(pl => pl.toLowerCase().includes(productLineSearchQuery));
  }

  // 渲染产品线卡片
  let cardsHtml = productLines.map(pl => {
    const stat = plStats.get(pl) || { count: 0, statusCounts: new Map() };
    const statusBreakdown = (settings.statusList || []).map(s => {
      const count = stat.statusCounts.get(s) || 0;
      return count > 0 ? `<span class="text-xs text-ink-500">${count} ${s}</span>` : '';
    }).filter(Boolean).join('<span class="text-ink-200 mx-2">·</span>');

    return `
      <div onclick="showList('${escapeHtml(pl)}')" class="product-card bg-white rounded-2xl border border-ink-100 p-6 cursor-pointer hover:border-ink-200 transition-colors">
        <div class="flex justify-between items-start mb-4">
          <h3 class="font-display text-lg text-ink-800">${escapeHtml(pl)}</h3>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="text-ink-200"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="font-display text-4xl text-ink-800 mb-1">${stat.count}</div>
        <div class="text-sm text-ink-500 mb-3">个需求</div>
        <div class="flex items-center flex-wrap gap-y-1">${statusBreakdown}</div>
      </div>
    `;
  }).join('');

  // 未分类卡片（灰色、置底、常驻）
  if (hasUncategorizedDir && (!productLineSearchQuery || '未分类'.toLowerCase().includes(productLineSearchQuery))) {
    const uncategorizedStat = plStats.get('未分类') || { count: 0, statusCounts: new Map() };
    cardsHtml += `
      <div onclick="showList('未分类')" class="product-card bg-stone-50 rounded-2xl border border-stone-200 p-6 cursor-pointer hover:border-stone-300 transition-colors">
        <div class="flex justify-between items-start mb-4">
          <h3 class="font-display text-lg text-stone-500">未分类</h3>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" class="text-stone-300"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="font-display text-4xl text-stone-500 mb-1">${uncategorizedStat.count}</div>
        <div class="text-sm text-stone-400 mb-3">个需求</div>
      </div>
    `;
  }

  productLinesContainer.innerHTML = cardsHtml;
  isRenderingHome = false;
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
  // 优先级筛选
  const priorityContainer = document.getElementById('filter-priority-dd');
  if (priorityContainer) {
    const currentVal = cdGetValue('cd-filter-priority');
    priorityContainer.innerHTML = cdRender({
      id: 'cd-filter-priority',
      value: currentVal || '',
      options: [{value: '', label: '全部优先级'}, ...(settings.priorityList || []).map(p => ({value: p, label: p}))],
      style: 'filter', colorType: 'priority', onChange: 'applyFilters'
    });
  }

  // 迭代筛选
  const sprintContainer = document.getElementById('filter-sprint-dd');
  if (sprintContainer) {
    const currentVal = cdGetValue('cd-filter-sprint');
    sprintContainer.innerHTML = cdRender({
      id: 'cd-filter-sprint',
      value: currentVal || '',
      options: [{value: '', label: '全部迭代'}, ...currentData.sprints.map(s => ({value: s.name, label: s.name}))],
      style: 'filter', colorType: '', onChange: 'applyFilters'
    });
  }
}

// 应用筛选
function applyFilters() {
  activeFilters.priority = cdGetValue('cd-filter-priority') || null;
  activeFilters.sprint = cdGetValue('cd-filter-sprint') || null;
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
  cdSetValue('cd-filter-priority', '');
  cdSetValue('cd-filter-sprint', '');
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
      const pls = toArray(r.productLine);
      const title = r.title != null ? String(r.title).toLowerCase() : '';
      const id = r.id != null ? String(r.id).toLowerCase() : '';
      const developer = r.developer != null ? String(r.developer).toLowerCase() : '';
      const requester = r.requester != null ? String(r.requester).toLowerCase() : '';
      return title.includes(q) ||
        id.includes(q) ||
        developer.includes(q) ||
        requester.includes(q) ||
        pls.some(pl => String(pl).toLowerCase().includes(q));
    });
  } else {
    // 按主产品线筛选（mainProductLine 优先，兼容旧数据 productLine）
    reqs = currentData.requirements.filter(r => {
      const mainPL = r.mainProductLine || (toArray(r.productLine)[0]) || '未分类';
      return mainPL === currentProductLine;
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

  // 保存完整列表用于分页
  listAllReqs = reqs;
  listCurrentPage = 1;

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
    renderReqTable(reqs, true);
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

  // 看板配色：从 CD_STATUS_COLORS 提取 accent 色
  const kanbanColorPalette = Object.values(CD_STATUS_COLORS).map(c => ({ accent: c.text }));

  // 优先级圆点配色：从 CD_PRIORITY_COLORS 提取
  const priorityDotColors = Object.fromEntries(
    Object.entries(CD_PRIORITY_COLORS).map(([k, v]) => [k, v.bg])
  );

  board.innerHTML = (settings.statusList || []).map((status, idx) => {
    const statusReqs = reqs.filter(r => r.status === status);
    const config = kanbanColorPalette[idx % kanbanColorPalette.length];

    return `
      <div class="kanban-column flex-shrink-0 w-[280px] flex flex-col" data-status="${status}">
        <div class="kanban-header flex items-center justify-between border-b border-ink-100 bg-white px-3 py-2.5 relative overflow-hidden">
          <div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:${config.accent};border-radius:0 2px 2px 0;"></div>
          <div class="flex items-center gap-2 pl-2">
            <span class="text-sm font-semibold text-ink-900">${status}</span>
          </div>
          <span class="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-ink-50 text-[11px] font-bold text-ink-600">${statusReqs.length}</span>
        </div>
        <div class="flex-1 p-2 space-y-2 min-h-[200px]"
             ondragover="handleKanbanDragOver(event)"
             ondragleave="handleKanbanDragLeave(event)"
             ondrop="handleKanbanDrop(event, '${status}')">
          ${statusReqs.map(req => {
            const hasChildren = HierarchyUtils.hasChildren(currentData.requirements, req.id);
            const childCount = hasChildren ? HierarchyUtils.getChildren(currentData.requirements, req.id).length : 0;
            return `
            <div draggable="true"
                 ondragstart="handleKanbanDragStart(event, '${escapeHtml(req.id)}')"
                 class="kanban-card rounded-xl shadow-sm border border-ink-100 bg-white cursor-grab relative group overflow-hidden"
                 data-req-id="${escapeHtml(req.id)}"
                 onclick="showDetail('${escapeHtml(req.id)}')">
              <div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:${config.accent};border-radius:12px 0 0 12px;"></div>
              <div class="p-3.5 pl-5">
                <button onclick="event.stopPropagation(); archiveReqFromList('${escapeHtml(req.id)}')"
                        onmousedown="event.stopPropagation()"
                        class="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-ink-50 text-ink-400 hover:bg-red-50 hover:text-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all z-10"
                        title="归档" draggable="false">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 6v8h12V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 3h14v3H1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 9h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                </button>
                ${hasChildren ? `<div class="kanban-expand-toggle" onclick="event.stopPropagation();toggleKanbanCard(this.closest('.kanban-card'),'${escapeHtml(req.id)}')">▼</div>` : ''}
                <div class="flex items-center gap-2 mb-2 pr-6">
                  <span style="width:6px;height:6px;border-radius:50%;background:${priorityDotColors[req.priority] || '#d4cfc7'};flex-shrink:0;" title="${req.priority}"></span>
                  <div class="text-sm text-ink-800 flex-1 font-medium" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${escapeHtml(req.title)}${hasChildren ? `<span class="kanban-child-count">${childCount} 个子需求</span>` : ''}</div>
                </div>
                <div class="flex items-center justify-between">
                  <span class="font-mono text-xs text-ink-400">${escapeHtml(req.id)}</span>
                  <div class="flex items-center gap-1.5 text-xs text-ink-400">
                    ${req.sprint ? `<span class="px-1.5 py-0.5 bg-ink-50 border border-ink-100 rounded text-ink-500">${req.sprint}</span>` : ''}
                    <span>${(req.platform || ['web']).join(', ')}</span>
                  </div>
                </div>
                <div class="kanban-children"></div>
              </div>
            </div>
          `}).join('')}
        </div>
      </div>
    `;
  }).join('');
}

function expandKanbanCard(cardEl, parentId) {
  const children = HierarchyUtils.getChildren(currentData.requirements, parentId);
  const container = cardEl.querySelector('.kanban-children');
  if (!container) return;

  container.innerHTML = children.map(child => {
    const stColors = CD_STATUS_COLORS[child.status] || {bg:'#e8e5e0',text:'#635a50',border:'#d4cfc7'};
    return `
    <div class="kanban-child-mini" onclick="event.stopPropagation();showDetail('${escapeHtml(child.id)}')" draggable="true"
         ondragstart="handleKanbanDragStart(event, '${escapeHtml(child.id)}')">
      <div class="flex items-center gap-2">
        <span class="text-xs font-mono text-stone-400">${escapeHtml(child.id)}</span>
        <span class="text-xs text-stone-700 truncate">${escapeHtml(child.title)}</span>
      </div>
      <span class="text-xs status-badge-mini" style="background:${stColors.bg};color:${stColors.text};border:1px solid ${stColors.border}">${escapeHtml(child.status)}</span>
    </div>
  `}).join('');

  cardEl.classList.add('expanded');
  const toggle = cardEl.querySelector('.kanban-expand-toggle');
  if (toggle) toggle.textContent = '▲';
}

function collapseKanbanCard(cardEl) {
  const container = cardEl.querySelector('.kanban-children');
  if (container) container.innerHTML = '';
  cardEl.classList.remove('expanded');
  const toggle = cardEl.querySelector('.kanban-expand-toggle');
  if (toggle) toggle.textContent = '▼';
}

function toggleKanbanCard(cardEl, parentId) {
  if (cardEl.classList.contains('expanded')) {
    collapseKanbanCard(cardEl);
  } else {
    expandKanbanCard(cardEl, parentId);
  }
}

function renderReqTable(reqs, reset = false) {
  const listContainer = document.getElementById('requirements-list');
  const loadMoreContainer = document.getElementById('load-more-container');

  if (reqs.length === 0) {
    listContainer.innerHTML = '<tr><td colspan="14" class="px-5 py-12 text-center text-ink-500 text-sm">暂无需求</td></tr>';
    if (loadMoreContainer) loadMoreContainer.classList.add('hidden');
    return;
  }

  // 按层级排序
  const sortedReqs = HierarchyUtils.buildHierarchyList(reqs);

  // 分页逻辑
  const totalCount = sortedReqs.length;
  const pageCount = Math.ceil(totalCount / listPageSize);
  const currentPage = reset ? 1 : listCurrentPage;
  if (reset) listCurrentPage = 1;

  const endIndex = currentPage * listPageSize;
  const pageReqs = sortedReqs.slice(0, endIndex);
  const hasMore = endIndex < totalCount;

  // 缓存产品线选项，避免每行重复计算
  const allPls = new Set([
    ...(settings.productLines || []),
    ...currentData.requirements.flatMap(r => toArray(r.productLine))
  ]);
  const plOptions = [
    {value: '', label: '未分类'},
    ...Array.from(allPls).filter(p => p && p !== '未分类').sort().map(p => ({value: p, label: p}))
  ];

  const rowsHtml = pageReqs.map(req => {
    const isChild = !!req.parent_id;
    const hasChildren = HierarchyUtils.hasChildren(currentData.requirements, req.id);

    // 原型标签
    const hasWeb = req.hasPrototype && req.hasPrototype.web;
    const hasMobile = req.hasPrototype && req.hasPrototype.mobile;
    const protoBadges = [];
    if (hasWeb) protoBadges.push('<span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-terracotta/10 text-terracotta border border-terracotta/20">Web</span>');
    if (hasMobile) protoBadges.push('<span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-600 border border-indigo-200">Mobile</span>');
    const protoHtml = protoBadges.length > 0 ? `<div class="flex gap-1">${protoBadges.join('')}</div>` : '<span class="text-xs text-ink-400">-</span>';

    // 产品线：主产品线（可编辑下拉）+ 关联产品线（只读标签）
    const mainPL = req.mainProductLine || (toArray(req.productLine)[0]) || '未分类';
    const relatedPLs = (req.relatedProductLines || []).filter(pl => pl && pl !== mainPL);

    // 合并所有来源的产品线
    const allPls = new Set([
      ...(settings.productLines || []),
      ...currentData.requirements.flatMap(r => {
        const p = toArray(r.productLine);
        return p;
      })
    ]);
    allPls.add(mainPL);
    const plOptions = [
      {value: '', label: '未分类'},
      ...Array.from(allPls).filter(p => p && p !== '未分类').sort().map(p => ({value: p, label: p}))
    ];

    // 关联产品线标签HTML
    const relatedTagsHtml = relatedPLs.length > 0
      ? `<div class="flex flex-wrap gap-1">${relatedPLs.map(pl =>
          `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs text-ink-600 bg-ink-50 border border-ink-100">${escapeHtml(pl)}</span>`
        ).join('')}</div>`
      : '<span class="text-xs text-ink-300">-</span>';

    // 搜索模式下的面包屑路径
    const breadcrumbHtml = isSearchMode && isChild
      ? `<div class="text-xs text-stone-400 mb-0.5">${escapeHtml(HierarchyUtils.getBreadcrumbPath(currentData.requirements, req.id))}</div>`
      : '';

    // 树形前缀
    const treePrefix = isChild
      ? '<span class="tree-prefix">└</span>'
      : (hasChildren ? `<span class="tree-toggle" onclick="event.stopPropagation();toggleParentRow(this,'${escapeHtml(req.id)}')">▼</span>` : '<span class="tree-prefix"></span>');

    const rowClass = isChild ? 'req-row-child' : (hasChildren ? 'req-row-parent' : '');
    const dataAttr = isChild ? `data-child-of="${escapeHtml(req.parent_id)}"` : (hasChildren ? `data-parent-id="${escapeHtml(req.id)}"` : '');

    // 父需求下拉选项：排除自己、排除后代、同一产品线、深度不超过2层
    const parentCandidates = currentData.requirements.filter(r => {
      if (r.id === req.id) return false;
      if (HierarchyUtils.isDescendant(currentData.requirements, req.id, r.id)) return false;
      const rMainPL = r.mainProductLine || (toArray(r.productLine)[0]) || '未分类';
      if (rMainPL !== mainPL) return false;
      const rParentId = r.parent_id;
      if (rParentId) return false;
      return true;
    });
    const parentOptions = [
      {value: '', label: '无'},
      ...parentCandidates.map(r => ({value: r.id, label: r.id, title: r.title}))
    ];
    const currentParentValue = req.parent_id || '';

    // 父需求列显示内容
    let parentCellHtml;
    if (hasChildren) {
      const childCount = HierarchyUtils.getChildren(currentData.requirements, req.id).length;
      parentCellHtml = `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-600 border border-amber-200 cursor-pointer hover:bg-amber-100" onclick="event.stopPropagation();toggleParentRowById('${escapeHtml(req.id)}')" title="${childCount} 个子需求，点击展开/折叠">▼ ${childCount}个子需求</span>`;
    } else if (isChild) {
      const parentReq = currentData.requirements.find(r => r.id === req.parent_id);
      const parentLabel = parentReq ? `${parentReq.id}` : req.parent_id;
      parentCellHtml = `<span class="inline-flex items-center gap-1 text-xs text-ink-500 cursor-pointer hover:text-amber-600" onclick="event.stopPropagation();showDetail('${escapeHtml(parentLabel)}')" title="${escapeHtml(parentLabel)} ${parentReq ? escapeHtml(parentReq.title) : ''}">↑ ${escapeHtml(parentLabel)}</span>`;
    } else {
      parentCellHtml = '<span class="text-xs text-ink-300">-</span>';
    }

    return `
    <tr class="border-b border-ink-50 hover:bg-ink-50 transition-colors ${rowClass}" ${dataAttr}>
      <td class="px-5 py-4">
        <div class="flex items-center gap-1">
          ${treePrefix}
          <span class="font-mono text-sm text-ink-500">${escapeHtml(req.id)}</span>
        </div>
      </td>
      <td class="px-5 py-4">
        ${breadcrumbHtml}
        <div class="text-sm text-ink-800 cursor-pointer hover:text-ink-600 transition-colors truncate" style="max-width:240px" title="${escapeHtml(req.title)}" onclick="showDetail('${escapeHtml(req.id)}')">${escapeHtml(req.title)}</div>
      </td>
      <td class="px-5 py-4" data-stop-click="true">
        ${hasChildren ? parentCellHtml : cdRender({ id: `cd-parent-${escapeHtml(req.id)}`, value: currentParentValue, options: parentOptions, style: 'text', colorType: '', onChange: `updateParentInline('${escapeHtml(req.id)}')`, stopClick: true })}
      </td>
      <td class="px-5 py-4" data-stop-click="true">
        ${cdRender({ id: `cd-pl-${escapeHtml(req.id)}`, value: mainPL, options: plOptions, style: 'pill', colorType: '', onChange: `updateProductLine('${escapeHtml(req.id)}')`, stopClick: true })}
      </td>
      <td class="px-5 py-4">
        ${relatedTagsHtml}
      </td>
      <td class="px-5 py-4">
        ${cdRender({ id: `cd-status-${escapeHtml(req.id)}`, value: req.status, options: (settings.statusList || []).map(s => ({value: s, label: s})), style: 'pill', colorType: 'status', onChange: `updateStatus('${escapeHtml(req.id)}')`, stopClick: true })}
      </td>
      <td class="px-5 py-4">
        ${cdRender({ id: `cd-sprint-${escapeHtml(req.id)}`, value: req.sprint || '', options: [{value: '', label: '未分配'}, ...currentData.sprints.filter(s => s.status === 'active').map(s => ({value: s.name, label: s.name}))], style: 'pill', colorType: '', onChange: `updateSprint('${escapeHtml(req.id)}')`, stopClick: true })}
      </td>
      <td class="px-5 py-4 text-sm text-ink-500">${(req.platform || ['web']).join(', ')}</td>
      <td class="px-5 py-4">${protoHtml}</td>
      <td class="px-5 py-4 text-sm text-ink-500">${req.developer || '-'}</td>
      <td class="px-5 py-4 text-sm text-ink-500">${formatDate(req.created)}</td>
      <td class="px-5 py-4" data-stop-click="true">
        <span class="text-sm text-ink-500 cursor-pointer hover:text-ink-700 hover:bg-ink-50 rounded px-2 py-1 transition-colors" onclick="editDueDate(this, '${escapeHtml(req.id)}', '${req.due_date || ''}')">${formatDate(req.due_date)}</span>
      </td>
      <td class="px-5 py-4">
        ${cdRender({ id: `cd-priority-${escapeHtml(req.id)}`, value: req.priority, options: (settings.priorityList || []).map(p => ({value: p, label: p})), style: 'pill', colorType: 'priority', onChange: `updatePriority('${escapeHtml(req.id)}')`, stopClick: true })}
      </td>
      <td class="px-5 py-4" onclick="event.stopPropagation()">
        <button onclick="event.stopPropagation(); archiveReqFromList('${escapeHtml(req.id)}')"
                onmousedown="event.stopPropagation()"
                class="p-1.5 rounded-full text-ink-500 hover:text-red-500 hover:bg-red-50 transition-colors"
                title="归档" draggable="false">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 6v8h12V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 3h14v3H1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 9h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
      </td>
    </tr>
  `}).join('');

  // 渲染表格内容
  if (reset) {
    listContainer.innerHTML = rowsHtml;
  } else {
    const oldLoadMore = listContainer.querySelector('.load-more-row');
    if (oldLoadMore) oldLoadMore.remove();
    listContainer.insertAdjacentHTML('beforeend', rowsHtml);
  }

  // 添加 loading 行（自动滚动加载）
  if (hasMore) {
    listContainer.insertAdjacentHTML('beforeend', `
      <tr class="load-more-row" id="load-more-trigger">
        <td colspan="14" class="px-5 py-4 text-center">
          <div class="flex items-center justify-center gap-2 text-sm text-ink-400">
            <svg class="animate-spin h-4 w-4 text-ink-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span>加载中...</span>
          </div>
        </td>
      </tr>
    `);
    // 注册 IntersectionObserver 自动加载
    setTimeout(() => {
      const trigger = document.getElementById('load-more-trigger');
      if (trigger && !trigger._observer) {
        const observer = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting && !isLoadingMore) {
              isLoadingMore = true;
              listCurrentPage++;
              renderReqTable(listAllReqs, false);
              // 延迟重置标志，避免重复触发
              setTimeout(() => { isLoadingMore = false; }, 300);
            }
          });
        }, { rootMargin: '100px' });
        observer.observe(trigger);
        trigger._observer = observer;
      }
    }, 0);
  }
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
  const stColors = CD_STATUS_COLORS[req.status] || {bg:'#e8e5e0',text:'#635a50',border:'#d4cfc7'};
  const prColors = CD_PRIORITY_COLORS[req.priority] || {bg:'#d4cfc7',text:'#4a433c'};

  // 产品线标签：主产品线（突出）+ 关联产品线（灰色）
  const mainPL = req.mainProductLine || (toArray(req.productLine)[0]) || '未分类';
  const relatedPLs = (req.relatedProductLines || []).filter(pl => pl && pl !== mainPL);
  const relatedTagsHtml = relatedPLs.length > 0
    ? relatedPLs.map(pl =>
        `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-stone-100 text-stone-500 border border-stone-200">${escapeHtml(pl)}</span>`
      ).join('')
    : '';

  // 面包屑路径（如有父需求）
  const breadcrumbHtml = req.parent_id
    ? `<div class="text-xs text-stone-400 mb-1">${escapeHtml(HierarchyUtils.getBreadcrumbPath(currentData.requirements, req.id))}</div>`
    : '';

  document.getElementById('detail-header').innerHTML = `
    <div class="flex items-center gap-3 flex-wrap">
      <span class="font-mono text-xs text-ink-500">${escapeHtml(req.id)}</span>
      <span class="text-sm text-ink-800 font-medium">${escapeHtml(req.title)}</span>
      <div class="flex items-center gap-2">
        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border"
              style="background:${stColors.bg};color:${stColors.text};border-color:${stColors.border}">
          <span class="w-1.5 h-1.5 rounded-full" style="background:${stColors.text}"></span>
          ${req.status}
        </span>
        <span class="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold"
              style="background:${prColors.bg};color:${prColors.text}">
          ${req.priority}
        </span>
      </div>
    </div>
    ${breadcrumbHtml}
    <div class="flex items-center gap-2 mt-2">
      <span class="text-xs font-medium text-ink-700 bg-ink-100 px-2 py-0.5 rounded">${escapeHtml(mainPL)}</span>
      ${relatedTagsHtml}
    </div>
  `;

  // 左侧需求列表 — 显示与当前需求共享至少一个产品线的需求
  const currentReqPLs = toArray(req.productLine);
  const plReqs = currentData.requirements.filter(r => {
    const pls = toArray(r.productLine);
    return pls.some(pl => currentReqPLs.includes(pl));
  });
  document.getElementById('detail-sidebar').innerHTML = plReqs.map(r => {
    const rSt = CD_STATUS_COLORS[r.status] || {bg:'#e8e5e0',text:'#635a50',border:'#d4cfc7'};
    const rPr = CD_PRIORITY_COLORS[r.priority] || {bg:'#d4cfc7',text:'#4a433c'};
    return `
    <div onclick="showDetail('${escapeHtml(r.id)}')" class="sidebar-item px-4 py-3 ${r.id === req.id ? 'active' : ''}">
      <div class="text-sm text-ink-800">${escapeHtml(r.title)}</div>
      <div class="flex items-center gap-2 mt-1.5">
        <span class="font-mono text-xs text-ink-400">${escapeHtml(r.id)}</span>
        <span class="inline-flex items-center gap-1 px-2 py-px rounded-full text-xs font-medium border"
              style="background:${rSt.bg};color:${rSt.text};border-color:${rSt.border}">
          <span class="w-1 h-1 rounded-full" style="background:${rSt.text}"></span>
          ${r.status}
        </span>
        <span class="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold"
              style="background:${rPr.bg};color:${rPr.text}">
          ${r.priority}
        </span>
      </div>
    </div>
  `}).join('');

  // 右侧面板：父需求
  const parentSection = document.getElementById('detail-parent-section');
  const parentContent = document.getElementById('detail-parent-content');
  const parentReq = HierarchyUtils.getParent(currentData.requirements, req.id);
  if (parentReq) {
    parentSection.classList.remove('hidden');
    parentContent.innerHTML = `
      <div class="flex items-center justify-between hover:bg-stone-50 rounded-lg p-2 transition-colors">
        <div class="flex items-center gap-2 cursor-pointer" onclick="showDetail('${escapeHtml(parentReq.id)}')">
          <span class="font-mono text-xs text-stone-400">${escapeHtml(parentReq.id)}</span>
          <span class="text-sm text-stone-700 truncate">${escapeHtml(parentReq.title)}</span>
        </div>
        <button onclick="event.stopPropagation();clearParent('${escapeHtml(req.id)}')" class="text-xs text-stone-400 hover:text-red-500 ml-2">清除</button>
      </div>
    `;
  } else {
    parentSection.classList.remove('hidden');
    parentContent.innerHTML = `
      <div class="flex items-center justify-between">
        <span class="text-sm text-stone-400">无</span>
        <button onclick="showSetParentModal('${escapeHtml(req.id)}')" class="text-xs text-blue-500 hover:text-blue-700">设置父需求</button>
      </div>
    `;
  }

  // 右侧面板：子需求
  const childrenSection = document.getElementById('detail-children-section');
  const childrenContent = document.getElementById('detail-children-content');
  const children = HierarchyUtils.getChildren(currentData.requirements, req.id);
  if (children.length > 0) {
    childrenSection.classList.remove('hidden');
    childrenContent.innerHTML = children.map(child => `
      <div class="flex items-center gap-2 cursor-pointer hover:bg-stone-50 rounded-lg p-2 transition-colors" onclick="showDetail('${escapeHtml(child.id)}')">
        <span class="font-mono text-xs text-stone-400">${escapeHtml(child.id)}</span>
        <span class="text-sm text-stone-700 truncate">${escapeHtml(child.title)}</span>
      </div>
    `).join('') + `
      <button onclick="showSetParentModal('${escapeHtml(req.id)}')" class="text-xs text-blue-500 hover:text-blue-700 mt-2">+ 添加子需求</button>
    `;
  } else {
    childrenSection.classList.add('hidden');
    childrenContent.innerHTML = '';
  }

  // 右侧面板：附件
  renderAssets(req.id);

  // 平台切换
  const platforms = req.platform || ['web'];
  const platformTabs = document.getElementById('platform-tabs');

  if (platforms.length > 1) {
    platformTabs.innerHTML = platforms.map(p => `
      <button onclick="switchPlatform('${p}')" class="px-4 py-1.5 rounded-full text-sm transition-all ${currentPlatform === p ? 'bg-ink-800 text-white' : 'text-ink-800 hover:bg-ink-50'}">
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
  let frame = document.getElementById('prototype-frame');
  const container = document.getElementById('prototype-container');
  const prototypeArea = document.getElementById('prototype-area');
  const docPanel = document.getElementById('doc-panel');
  const docResizer = document.getElementById('doc-resizer');
  const docToggleBtn = document.getElementById('doc-toggle-btn');
  const protoFullscreenBtn = document.getElementById('proto-fullscreen-btn');
  const platform = currentPlatform || (req.platform || ['web'])[0];
  const protoKey = platform === 'mobile' ? 'mobile' : 'web';

  // 检查原型文件是否存在
  if (!req.hasPrototype || !req.hasPrototype[protoKey]) {
    // 无原型时：隐藏原型区域，文档面板全屏
    prototypeArea.classList.add('hidden');
    docResizer.style.display = 'none';
    docPanel.classList.remove('hidden');
    docPanel.style.flex = '1';
    docPanel.style.width = '100%';
    docPanel.style.maxWidth = 'none';
    docPanel.style.minWidth = '0';
    if (docToggleBtn) {
      docToggleBtn.classList.add('bg-ink-800', 'text-white', 'border-ink-400');
      docToggleBtn.classList.remove('text-ink-600', 'border-ink-400');
    }
    if (protoFullscreenBtn) protoFullscreenBtn.classList.add('hidden');
    docPanelOpen = true;

    // 清空原型容器
    container.innerHTML = `<iframe id="prototype-frame" class="w-full h-full border-0" title="需求原型"></iframe>`;
    frame = document.getElementById('prototype-frame');
    if (frame) frame.src = 'about:blank';
    return;
  }

  // 有原型时：恢复三栏布局
  prototypeArea.classList.remove('hidden');
  if (protoFullscreenBtn) protoFullscreenBtn.classList.remove('hidden');

  // 重置文档面板样式
  docPanel.style.flex = '';
  docPanel.style.width = '380px';
  docPanel.style.maxWidth = '600px';
  docPanel.style.minWidth = '260px';

  // 按当前 docPanelOpen 状态控制文档面板
  if (docPanelOpen) {
    docPanel.classList.remove('hidden');
    docResizer.style.display = '';
  } else {
    docPanel.classList.add('hidden');
    docResizer.style.display = 'none';
  }

  const primaryPL = req.mainProductLine || (toArray(req.productLine)[0]) || '未分类';
  const protoFile = `/products/${encodeURIComponent(primaryPL)}/${encodeURIComponent(req.folderName)}/prototype-${platform}.html`;

  // 有原型时，恢复 iframe 结构
  container.innerHTML = `<iframe id="prototype-frame" class="w-full h-full border-0" title="需求原型"></iframe>`;

  // 重新获取 iframe 引用
  const newFrame = document.getElementById('prototype-frame');
  newFrame.src = protoFile;

  if (platform === 'mobile') {
    container.style.width = '520px';
    container.style.height = '1126px';
    container.style.maxWidth = '520px';
  } else {
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.maxWidth = 'none';
    container.style.maxHeight = 'none';
  }
}

// 解析 YAML front matter（简易解析器，支持 string/array/date）
function parseYamlFrontMatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { meta: {}, body: text };
  const yaml = match[1];
  const body = text.slice(match[0].length).trimStart();
  const meta = {};
  let key = null;
  let isArray = false;
  let arrItems = [];

  for (const line of yaml.split('\n')) {
    if (isArray) {
      if (line.match(/^\s+-\s+(.+)/)) {
        arrItems.push(RegExp.$1.trim().replace(/^['"]|['"]$/g, ''));
        continue;
      }
      // 数组结束
      meta[key] = arrItems;
      isArray = false;
      key = null;
      arrItems = [];
    }
    const kvMatch = line.match(/^(\w[\w_]*):\s*(.*)/);
    if (kvMatch) {
      if (key && isArray) { meta[key] = arrItems; isArray = false; arrItems = []; }
      key = kvMatch[1];
      const val = kvMatch[2].trim();
      if (val === '') {
        // 可能是数组，看下一行
        isArray = true;
        arrItems = [];
      } else {
        meta[key] = val.replace(/^['"]|['"]$/g, '');
      }
    }
  }
  if (key && isArray) meta[key] = arrItems;
  return { meta, body };
}

// 渲染 YAML 元信息栏
function renderDocMetaBar(meta) {
  const stColors = CD_STATUS_COLORS[meta.status] || {bg:'#e8e5e0',text:'#635a50',border:'#d4cfc7'};
  const prColors = CD_PRIORITY_COLORS[meta.priority] || {bg:'#d4cfc7',text:'#4a433c'};

  // 状态 badge
  const statusBadge = meta.status
    ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border" style="background:${stColors.bg};color:${stColors.text};border-color:${stColors.border}"><span class="w-1.5 h-1.5 rounded-full" style="background:${stColors.text}"></span>${meta.status}</span>`
    : '';
  // 优先级 badge
  const priorityBadge = meta.priority
    ? `<span class="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-xs font-bold" style="background:${prColors.bg};color:${prColors.text}">${meta.priority}</span>`
    : '';
  // 标签
  const tags = Array.isArray(meta.tags) ? meta.tags : (meta.tags ? [meta.tags] : []);
  const tagBadges = tags.map(t => `<span class="meta-tag">${t}</span>`).join('');
  // 产品线
  const pls = Array.isArray(meta.product_line) ? meta.product_line : (meta.product_line ? [meta.product_line] : []);

  return `
    <div class="doc-meta-bar">
      <div class="meta-grid">
        <div class="meta-item">
          <span class="meta-label">ID</span>
          <span class="meta-value font-mono text-xs">${meta.id || '-'}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">状态</span>
          ${statusBadge}
        </div>
        <div class="meta-item">
          <span class="meta-label">优先级</span>
          ${priorityBadge}
        </div>
        <div class="meta-item">
          <span class="meta-label">迭代</span>
          <span class="meta-value">${meta.sprint || '未分配'}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">创建</span>
          <span class="meta-value text-xs">${meta.created ? meta.created.slice(0,10) : '-'}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">更新</span>
          <span class="meta-value text-xs">${meta.updated ? meta.updated.slice(0,10) : '-'}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">负责人</span>
          <span class="meta-value">${meta.developer || '-'}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">提出人</span>
          <span class="meta-value">${meta.requester || '-'}</span>
        </div>
        ${pls.length ? `<div class="meta-item" style="grid-column: span 2"><span class="meta-label">产品线</span><span class="meta-value">${pls.join(' / ')}</span></div>` : ''}
        ${tags.length ? `<div class="meta-item" style="grid-column: span 2"><span class="meta-label">标签</span><div class="meta-tags">${tagBadges}</div></div>` : ''}
      </div>
    </div>
  `;
}

// 加载需求文档（智能渲染引擎）
function loadDoc(req) {
  const docContent = document.getElementById('doc-content');
  const docEditor = document.getElementById('doc-editor');
  const rawBody = req.body || '';

  // 编辑器保持原始 md 文本
  docEditor.value = rawBody;

  // 渲染模式：解析 YAML + 增强排版
  const { meta, body } = parseYamlFrontMatter(rawBody);
  const hasYaml = Object.keys(meta).length > 0;

  // 仅渲染 YAML 以下的内容
  // 自定义 marked 渲染器：将相对路径 assets/xxx 转换为绝对路径
  const renderer = new marked.Renderer();
  renderer.image = (href, title, text) => {
    let src = href;
    if (!src.startsWith('/') && !src.startsWith('http')) {
      const basePath = `/products/${encodeURIComponent(req.mainProductLine || '未分类')}/${encodeURIComponent(req.folderName || '')}`;
      src = src.replace(/^\.?\//, '');
      src = `${basePath}/${src}`;
    }
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(text || '')}" class="max-w-full rounded-lg border border-stone-200 cursor-zoom-in my-2" onclick="openImageLightbox('${escapeHtml(src)}')" loading="lazy">`;
  };

  const mdHtml = marked.parse(body || '*暂无文档内容*', { renderer });

  // 后处理：表格加 class、外部链接新窗口
  const processedHtml = mdHtml
    .replace(/<table>/g, '<table>')
    .replace(/<a href="([^"]+)"/g, (m, href) => {
      if (href.startsWith('http') || href.startsWith('//')) {
        return `<a href="${href}" target="_blank" rel="noopener"`;
      }
      return m;
    });

  // 组合：元信息栏 + 正文
  docContent.innerHTML = (hasYaml ? renderDocMetaBar(meta) : '') +
    `<div class="prose prose-sm max-w-none text-ink-700">${processedHtml}</div>`;

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

// 编辑器事件是否已绑定
let editorEventsBound = false;

// 编辑器粘贴上传处理
function handleEditorPaste(e) {
  const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
  if (files.length === 0) return;
  e.preventDefault();
  uploadAssets(files);
}

// 编辑器拖拽上传处理
function handleEditorDragOver(e) {
  e.preventDefault();
  const docEditor = document.getElementById('doc-editor');
  docEditor.classList.add('doc-editor-dragover');
}
function handleEditorDragLeave(e) {
  const docEditor = document.getElementById('doc-editor');
  docEditor.classList.remove('doc-editor-dragover');
}
function handleEditorDrop(e) {
  e.preventDefault();
  const docEditor = document.getElementById('doc-editor');
  docEditor.classList.remove('doc-editor-dragover');
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  uploadAssets(files);
}

// 批量上传附件到后端并在编辑器中插入引用
async function uploadAssets(files) {
  if (!currentReqId || files.length === 0) return;
  const formData = new FormData();
  files.forEach(file => formData.append('files', file));
  try {
    const res = await fetch(`/api/requirements/${currentReqId}/assets`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success && data.assets && data.assets.length > 0) {
      const docEditor = document.getElementById('doc-editor');
      let insertText = '';
      data.assets.forEach(asset => {
        insertText += `\n![${asset.filename}](assets/${asset.filename})\n`;
      });
      const start = docEditor.selectionStart || 0;
      const end = docEditor.selectionEnd || 0;
      const before = docEditor.value.substring(0, start);
      const after = docEditor.value.substring(end);
      docEditor.value = before + insertText + after;
      docEditor.selectionStart = docEditor.selectionEnd = start + insertText.length;
      docEditor.focus();
      docIsDirty = true;
      showToast(`已上传 ${data.assets.length} 张图片`, 'success');
    } else {
      showToast(data.error || '上传失败', 'error');
    }
  } catch (err) {
    console.error('上传附件失败:', err);
    showToast('上传失败', 'error');
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

  // 绑定粘贴/拖拽上传事件（仅一次）
  if (!editorEventsBound) {
    docEditor.addEventListener('paste', handleEditorPaste);
    docEditor.addEventListener('dragover', handleEditorDragOver);
    docEditor.addEventListener('dragleave', handleEditorDragLeave);
    docEditor.addEventListener('drop', handleEditorDrop);
    editorEventsBound = true;
  }

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

// ============================================================================
// 父/子需求交互
// ============================================================================

let currentSettingParentReqId = null;
let currentDeletingReqId = null;

function showSetParentModal(reqId) {
  currentSettingParentReqId = reqId;
  document.getElementById('parent-selector-modal').classList.remove('hidden');
  document.getElementById('parent-search-input').value = '';
  document.getElementById('parent-search-input').focus();
  renderParentSearchResults('');
}

function closeParentSelectorModal() {
  document.getElementById('parent-selector-modal').classList.add('hidden');
  currentSettingParentReqId = null;
}

function renderParentSearchResults(query) {
  const currentReq = currentData.requirements.find(r => r.id === currentSettingParentReqId);
  if (!currentReq) return;

  const candidates = currentData.requirements.filter(r => {
    if (r.id === currentSettingParentReqId) return false;
    if (r.mainProductLine !== currentReq.mainProductLine) return false;
    if (HierarchyUtils.checkCycleClient(currentData.requirements, currentSettingParentReqId, r.id)) return false;
    if (r.parent_id) return false;
    if (!query) return true;
    return r.id.toLowerCase().includes(query.toLowerCase()) ||
           r.title.toLowerCase().includes(query.toLowerCase());
  });

  const container = document.getElementById('parent-search-results');
  if (candidates.length === 0) {
    container.innerHTML = '<div class="p-3 text-sm text-stone-400 text-center">无匹配结果</div>';
    return;
  }
  container.innerHTML = candidates.map(r => `
    <div onclick="setParent('${escapeHtml(currentSettingParentReqId)}', '${escapeHtml(r.id)}')"
         class="p-3 hover:bg-stone-50 cursor-pointer border-b border-stone-50 last:border-0">
      <div class="text-sm font-medium text-stone-800">${escapeHtml(r.id)} ${escapeHtml(r.title)}</div>
      <div class="text-xs text-stone-400">${escapeHtml(r.mainProductLine)} · ${escapeHtml(r.status)}</div>
    </div>
  `).join('');
}

function setParent(reqId, parentId) {
  fetch(`/api/requirements/${reqId}/parent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parent_id: parentId })
  })
  .then(res => res.json())
  .then(data => {
    if (data.error) {
      showToast(data.error, 'error');
    } else {
      showToast('父需求已设置', 'success');
      closeParentSelectorModal();
      refreshData();
    }
  })
  .catch(err => {
    console.error('设置父需求失败:', err);
    showToast('设置失败', 'error');
  });
}

function clearParent(reqId) {
  fetch(`/api/requirements/${reqId}/parent`, { method: 'DELETE' })
  .then(res => res.json())
  .then(data => {
    showToast('已解除父子关系', 'success');
    refreshData();
  })
  .catch(err => {
    console.error('解除父子关系失败:', err);
    showToast('解除失败', 'error');
  });
}

// 行内更新父需求
function updateParentInline(reqId) {
  const parentId = cdGetValue(`cd-parent-${reqId}`);
  const req = currentData.requirements.find(r => r.id === reqId);
  const currentParent = req ? (req.parent_id || '') : '';

  // 值未变化，不处理
  if (parentId === currentParent) return;

  if (parentId) {
    setParent(reqId, parentId);
  } else {
    clearParent(reqId);
  }
}

function showDeleteWithChildrenModal(reqId) {
  const children = HierarchyUtils.getChildren(currentData.requirements, reqId);
  if (children.length === 0) {
    deleteRequirement(reqId);
    return;
  }
  currentDeletingReqId = reqId;
  document.getElementById('delete-parent-child-count').textContent = children.length;
  document.getElementById('delete-parent-modal').classList.remove('hidden');
}

function closeDeleteParentModal() {
  document.getElementById('delete-parent-modal').classList.add('hidden');
  currentDeletingReqId = null;
}

function deleteWithChildrenAction(action) {
  if (!currentDeletingReqId) return;
  deleteRequirement(currentDeletingReqId, action);
  closeDeleteParentModal();
}

function deleteRequirement(reqId, childrenAction) {
  let url = `/api/requirements/${reqId}`;
  if (childrenAction) url += `?childrenAction=${childrenAction}`;
  fetch(url, { method: 'DELETE' })
  .then(res => res.json())
  .then(data => {
    if (data.error) {
      showToast(data.error, 'error');
    } else {
      showToast('删除成功', 'success');
      refreshData();
      const detailPage = document.getElementById('detail-page');
      if (detailPage && !detailPage.classList.contains('hidden')) {
        showPage('list');
      }
    }
  })
  .catch(err => {
    console.error('删除需求失败:', err);
    showToast('删除失败', 'error');
  });
}

// ============================================================================
// 附件管理
// ============================================================================

async function renderAssets(reqId) {
  const assetsSection = document.getElementById('detail-assets-section');
  const assetsContent = document.getElementById('detail-assets-content');
  if (!assetsSection || !assetsContent) return;

  try {
    const res = await fetch(`/api/requirements/${reqId}/assets`);
    const data = await res.json();
    const assets = data.assets || [];

    if (assets.length > 0) {
      assetsSection.classList.remove('hidden');
      assetsContent.innerHTML = assets.map(asset => {
        const isImage = asset.mimeType && asset.mimeType.startsWith('image/');
        const icon = isImage ? '🖼️' : '📄';
        const sizeStr = formatAssetSize(asset.size);
        return `
          <div class="asset-item group" data-testid="asset-item">
            <span class="text-base">${icon}</span>
            <a href="${escapeHtml(asset.url)}" target="_blank" rel="noopener" class="flex-1 text-sm text-stone-700 truncate hover:text-blue-600" title="${escapeHtml(asset.filename)}">
              ${escapeHtml(asset.filename)}
            </a>
            <span class="text-xs text-stone-400 shrink-0">${sizeStr}</span>
            <button onclick="deleteAsset('${escapeHtml(reqId)}', '${escapeHtml(asset.filename)}')" class="opacity-0 group-hover:opacity-100 text-xs text-stone-400 hover:text-red-500 transition-opacity ml-1" data-testid="asset-delete-btn">删除</button>
          </div>
        `;
      }).join('');
    } else {
      assetsSection.classList.add('hidden');
      assetsContent.innerHTML = '';
    }
  } catch (err) {
    console.error('加载附件失败:', err);
  }
}

function formatAssetSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function deleteAsset(reqId, filename) {
  if (!confirm(`确定删除附件 "${filename}" 吗？`)) return;
  try {
    const res = await fetch(`/api/requirements/${reqId}/assets/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      showToast('附件已删除', 'success');
      renderAssets(reqId);
      // 如果当前在详情页，刷新文档渲染（可能包含该图片）
      const req = currentData.requirements.find(r => r.id === reqId);
      if (req) loadDoc(req);
    } else {
      showToast(data.error || '删除失败', 'error');
    }
  } catch (err) {
    console.error('删除附件失败:', err);
    showToast('删除失败', 'error');
  }
}

// Lightbox 图片放大
function openImageLightbox(src) {
  const modal = document.getElementById('lightbox-modal');
  const img = document.getElementById('lightbox-image');
  if (!modal || !img) return;
  img.src = src;
  modal.classList.remove('hidden');
}

function closeImageLightbox() {
  const modal = document.getElementById('lightbox-modal');
  if (modal) modal.classList.add('hidden');
}

// Lightbox 键盘和点击关闭
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeImageLightbox();
});

function showPage(pageName) {
  if (pageName === 'list') {
    showListPage();
  } else if (pageName === 'home') {
    showHome();
  }
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

// ============================================================================
// [ARCHIVED] TAPD 发布功能 —— 已归档至 archive/tapd/
// ============================================================================
/*
let tapdIterations = [];
let currentTapdReqId = null;

async function showTapdPublishModal() {
  const modal = document.getElementById('tapd-publish-modal');
  const authSection = document.getElementById('tapd-auth-section');
  const publishSection = document.getElementById('tapd-publish-section');
  const loadingSection = document.getElementById('tapd-loading-section');
  const resultSection = document.getElementById('tapd-result-section');

  // 重置状态
  authSection.classList.add('hidden');
  publishSection.classList.add('hidden');
  loadingSection.classList.add('hidden');
  resultSection.classList.add('hidden');

  currentTapdReqId = currentReqId;

  // 检查 TAPD 授权状态
  try {
    const res = await fetch('/api/tapd/status');
    const status = await res.json();

    if (!status.authorized) {
      authSection.classList.remove('hidden');
    } else {
      publishSection.classList.remove('hidden');
      document.getElementById('tapd-req-title').textContent = currentReqTitle || currentReqId;
      await loadTapdIterations();
    }
  } catch (err) {
    console.error('Check TAPD status error:', err);
    authSection.classList.remove('hidden');
  }

  modal.classList.remove('hidden');
}

function closeTapdModal() {
  document.getElementById('tapd-publish-modal').classList.add('hidden');
  currentTapdReqId = null;
}

async function startTapdAuth() {
  try {
    const res = await fetch('/api/tapd/auth-url');
    const data = await res.json();

    if (data.error) {
      alert('TAPD 未配置：' + data.error);
      return;
    }

    // 打开授权窗口
    const authWindow = window.open(data.authUrl, 'tapd-auth', 'width=600,height=600');

    // 轮询检查授权是否完成
    const checkInterval = setInterval(async () => {
      if (authWindow.closed) {
        clearInterval(checkInterval);
        // 重新检查状态
        const statusRes = await fetch('/api/tapd/status');
        const status = await statusRes.json();
        if (status.authorized) {
          // 刷新弹窗状态
          showTapdPublishModal();
        }
      }
    }, 1000);
  } catch (err) {
    console.error('Start TAPD auth error:', err);
    alert('启动 TAPD 授权失败');
  }
}

async function loadTapdIterations() {
  try {
    const res = await fetch('/api/tapd/iterations');
    const data = await res.json();
    tapdIterations = data.iterations || [];

    const select = document.getElementById('tapd-iteration-select');
    select.innerHTML = '<option value="">请选择迭代...</option>' +
      tapdIterations.map(it => `<option value="${it.id}">${it.name}</option>`).join('');
  } catch (err) {
    console.error('Load TAPD iterations error:', err);
  }
}

async function confirmTapdPublish() {
  const iterationId = document.getElementById('tapd-iteration-select').value;
  if (!iterationId) {
    alert('请选择目标迭代');
    return;
  }

  const publishSection = document.getElementById('tapd-publish-section');
  const loadingSection = document.getElementById('tapd-loading-section');
  const resultSection = document.getElementById('tapd-result-section');

  publishSection.classList.add('hidden');
  loadingSection.classList.remove('hidden');

  try {
    const res = await fetch(`/api/tapd/publish/${currentTapdReqId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iterationId })
    });

    const data = await res.json();

    loadingSection.classList.add('hidden');

    if (data.success) {
      resultSection.classList.remove('hidden');
      document.getElementById('tapd-result-link').href = data.url;
      showToast('需求已发布到 TAPD');
    } else {
      alert('发布失败：' + (data.error || '未知错误'));
      publishSection.classList.remove('hidden');
    }
  } catch (err) {
    console.error('Publish to TAPD error:', err);
    alert('发布失败：' + err.message);
    loadingSection.classList.add('hidden');
    publishSection.classList.remove('hidden');
  }
}
*/

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
  const resizer = document.getElementById('doc-resizer');
  const btn = document.getElementById('doc-toggle-btn');

  panel.classList.toggle('hidden', !docPanelOpen);
  resizer.style.display = docPanelOpen ? '' : 'none';

  if (docPanelOpen) {
    btn.classList.add('bg-ink-800', 'text-white', 'border-ink-400');
    btn.classList.remove('text-ink-600', 'border-ink-400');
  } else {
    btn.classList.remove('bg-ink-800', 'text-white', 'border-ink-400');
    btn.classList.add('text-ink-600', 'border-ink-400');
  }
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

// 更新产品线（含物理文件夹迁移 + 二次确认）
async function updateProductLine(id) {
  const newPL = cdGetValue(`cd-pl-${id}`);
  const req = currentData.requirements.find(r => r.id === id);
  if (!req) return;

  const oldMainPL = req.mainProductLine || (toArray(req.productLine)[0]) || '';
  const newPrimary = newPL || '未分类';

  if (oldMainPL === newPrimary) return;

  try {
    const res = await fetch(`/api/requirements/${id}/product-line`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_line: [newPrimary] })
    });

    if (res.ok) {
      await refreshData();
      showToast('产品线已更新', 'success');
    } else {
      const err = await res.json();
      // 4003: 需要二次确认
      if (err.code === 4003) {
        if (confirm(`确定将需求从「${oldMainPL || '未分类'}」移动到「${newPrimary}」？\n\n这将改变需求的物理存储位置。`)) {
          // 二次确认后重新请求
          const confirmRes = await fetch(`/api/requirements/${id}/product-line`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_line: [newPrimary], confirmed: true })
          });
          if (confirmRes.ok) {
            await refreshData();
            showToast('产品线已更新', 'success');
          } else {
            const confirmErr = await confirmRes.json();
            showToast(confirmErr.error || '更新失败', 'error');
            await refreshData();
          }
        } else {
          // 用户取消，恢复下拉选择
          await refreshData();
        }
      } else {
        showToast(err.error || '更新失败', 'error');
        await refreshData();
      }
    }
  } catch (e) {
    console.error('更新产品线失败:', e);
    showToast('更新失败', 'error');
    await refreshData();
  }
}

// 更新预计上线时间
async function updateDueDate(id, due_date) {
  try {
    await fetch(`/api/requirements/${id}/due_date`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ due_date })
    });
    await refreshData();
    showToast('预计上线时间已更新', 'success');
  } catch (e) {
    console.error('更新预计上线时间失败:', e);
    showToast('更新失败', 'error');
  }
}

// 行内编辑预计上线时间
function editDueDate(el, reqId, currentValue) {
  const input = document.createElement('input');
  input.type = 'date';
  input.value = currentValue || '';
  input.className = 'text-sm px-2 py-1 border border-ink-200 rounded-lg outline-none focus:border-ink-400 bg-white text-ink-700';

  el.replaceWith(input);
  input.focus();

  const save = async () => {
    const newDate = input.value;
    if (newDate !== (currentValue || '')) {
      await updateDueDate(reqId, newDate);
    } else {
      await refreshData();
    }
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      input.blur();
    } else if (e.key === 'Escape') {
      refreshData();
    }
  });
}


// 按状态筛选
function filterByStatus(status) {
  const plReqs = currentData.requirements.filter(r => {
    const pls = toArray(r.productLine);
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
    case 'ideas':
      showIdeasPage();
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
  document.getElementById('ideas-page').classList.add('hidden');
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
  const groups = groupArchivedByProductLineAndSprint(archivedReqs);
  container.innerHTML = Object.entries(groups).map(([pl, group]) => renderArchiveProductLineCard(pl, group)).join('');
}

// 归档需求分组：按产品线 → 迭代
function groupArchivedByProductLineAndSprint(archivedReqs) {
  const groups = {};
  for (const req of archivedReqs) {
    const pls = toArray(req.productLine);
    for (const pl of pls) {
      if (!groups[pl]) groups[pl] = { _reqs: [], sprints: {} };
      groups[pl]._reqs.push(req);
      const sprintKey = req.sprint || '未分配迭代';
      if (!groups[pl].sprints[sprintKey]) groups[pl].sprints[sprintKey] = [];
      groups[pl].sprints[sprintKey].push(req);
    }
  }
  return groups;
}

// 渲染归档页的产品线卡片
function renderArchiveProductLineCard(pl, group) {
  return `
    <div class="bg-white rounded-2xl border border-ink-100 overflow-hidden shadow-sm mb-8">
      <!-- 产品线折叠头 -->
      <div class="px-8 py-5 bg-ink-50 border-b border-ink-100 cursor-pointer hover:bg-ink-100 transition-colors"
           onclick="this.nextElementSibling.classList.toggle('hidden'); this.querySelector('.pl-chevron').classList.toggle('rotate-180')">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <svg width="20" height="20" viewBox="0 0 18 18" fill="none" class="text-ink-500">
              <rect x="2" y="4" width="14" height="12" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
              <path d="M2 8h14" stroke="currentColor" stroke-width="1.5"/>
              <path d="M6 2h6v2H6z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>
            <h3 class="font-display text-lg text-ink-800">${escapeHtml(pl)}</h3>
            <span class="text-sm text-ink-500">${group._reqs.length} 个归档需求</span>
          </div>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="pl-chevron text-ink-500 transition-transform"><path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      </div>

      <!-- 迭代列表 -->
      <div>
        ${renderArchiveSprintSections(group.sprints)}
      </div>
    </div>
  `;
}

// 渲染归档页的迭代区块
function renderArchiveSprintSections(sprints) {
  return Object.entries(sprints).sort(([a], [b]) => {
    if (a === '未分配迭代') return 1;
    if (b === '未分配迭代') return -1;
    return a.localeCompare(b);
  }).map(([sprint, reqs]) => `
    <div class="${sprint !== '未分配迭代' ? 'border-t border-ink-100' : ''} first:border-t-0">
      <!-- 迭代折叠头 -->
      <div class="px-8 py-4 cursor-pointer hover:bg-ink-50/60 transition-colors flex items-center justify-between"
           onclick="this.nextElementSibling.classList.toggle('hidden'); this.querySelector('.sprint-chevron').classList.toggle('rotate-180')">
        <div class="flex items-center gap-3">
          <div class="w-1 h-5 rounded-full bg-ink-500"></div>
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none" class="text-ink-400">
            <rect x="1" y="3" width="12" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/>
            <path d="M1 6h12" stroke="currentColor" stroke-width="1.2"/>
            <path d="M5 1h4v2H5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
          </svg>
          <span class="text-sm font-semibold text-ink-700">${sprint}</span>
          <span class="text-xs text-ink-400 bg-ink-50 px-2 py-0.5 rounded-full">${reqs.length} 个需求</span>
        </div>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" class="sprint-chevron text-ink-400 transition-transform"><path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>

      <!-- 需求列表 -->
      <div class="px-8 pb-6">
        <div class="bg-white rounded-xl border border-ink-100 overflow-hidden shadow-sm">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-ink-100 bg-ink-50">
                <th class="px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase tracking-wider" style="width:110px">需求ID</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase tracking-wider" style="min-width:200px">需求名称</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase tracking-wider" style="width:100px">状态</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase tracking-wider" style="width:90px">优先级</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase tracking-wider" style="width:100px">开发</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase tracking-wider" style="width:110px">归档时间</th>
                <th class="px-4 py-3 text-left text-xs font-semibold text-ink-500 uppercase tracking-wider" style="width:80px">操作</th>
              </tr>
            </thead>
            <tbody>
              ${renderArchiveReqRows(reqs)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `).join('');
}

// 渲染归档页的需求行
function renderArchiveReqRows(reqs) {
  return reqs.map((req, idx) => `
    <tr class="cursor-pointer hover:bg-ink-50/60 transition-colors ${idx !== reqs.length - 1 ? 'border-b border-ink-100' : ''}" onclick="showDetail('${escapeHtml(req.id)}', 'archive')">
      <td class="px-4 py-3.5"><span class="font-mono text-sm text-ink-500">${escapeHtml(req.id)}</span></td>
      <td class="px-4 py-3.5"><span class="text-sm text-ink-800 font-medium">${escapeHtml(req.title)}</span></td>
      <td class="px-4 py-3.5"><span class="static-pill sp-status-${req.status}">${req.status}</span></td>
      <td class="px-4 py-3.5"><span class="static-pill sp-priority-${req.priority}">${req.priority}</span></td>
      <td class="px-4 py-3.5 text-sm text-ink-500">${req.developer || '-'}</td>
      <td class="px-4 py-3.5 text-sm text-ink-500">${formatDate(req.updated)}</td>
      <td class="px-4 py-3.5" data-stop-click="true">
        <button onclick="event.stopPropagation(); unarchiveReq('${escapeHtml(req.id)}')"
                class="p-1.5 rounded-full text-ink-500 hover:text-amber-600 hover:bg-amber-50 transition-colors"
                title="回退到需求池" draggable="false">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M8 3L4 7M8 3l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </td>
    </tr>
  `).join('');
}

// 回退归档需求
async function unarchiveReq(id) {
  if (!confirm(`确定将需求 ${id} 从归档中回退吗？\n回退后状态将重置为「设计中」，迭代将被清除，需重新分配。`)) return;
  try {
    const res = await fetch(`/api/requirements/${id}/unarchive`, { method: 'POST' });
    if (res.ok) {
      showToast(`需求 ${id} 已回退到需求池`, 'success');
      await refreshData();
      renderArchivePage();
    } else {
      const err = await res.json();
      alert(err.error || '回退失败');
    }
  } catch (e) {
    alert('回退失败: ' + e.message);
  }
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
    toArray(r.productLine)
  );
  const productLines = [...new Set([...settingsProductLines, ...reqProductLines])];
  productLinesList.innerHTML = productLines.map(pl => {
    const count = currentData.requirements.filter(r => {
      const pls = toArray(r.productLine);
      return pls.includes(pl);
    }).length;
    return `<div class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ink-50 text-ink-800 rounded-full text-sm border border-ink-100 hover:border-ink-300 transition-colors">
      <span>${escapeHtml(pl)}</span>
      <span class="text-ink-400 text-xs">(${count})</span>
      <button onclick="removeProductLineFromSettings('${pl.replace(/'/g, "\\'")}')" class="w-4 h-4 rounded-full hover:bg-red-100 flex items-center justify-center text-ink-400 hover:text-red-500 transition-colors" title="删除产品线">
        <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>`;
  }).join('') || '<span class="text-sm text-ink-500">暂无产品线</span>';

  // 状态列表 - 可编辑/删除（胶囊样式）
  const statusListDisplay = document.getElementById('status-list-display');
  statusListDisplay.innerHTML = (settings.statusList || []).map((s, idx) => `
    <div class="status-item inline-flex items-center gap-1 px-3 py-1.5 bg-ink-50 rounded-full text-sm border border-ink-100 hover:border-ink-300 transition-colors" data-status-idx="${idx}">
      <span class="view-mode text-ink-800">${s}</span>
      <input type="text" value="${s}" class="edit-mode hidden px-2 py-0.5 text-sm border border-ink-200 rounded-lg focus:outline-none focus:border-ink-400 w-24 bg-white" data-original="${s}" onkeydown="if(event.key==='Enter')saveStatusEdit(${idx})" onblur="cancelStatusEdit(${idx})">
      <button onclick="startEditStatus(${idx})" class="view-mode w-4 h-4 rounded-full hover:bg-ink-200 flex items-center justify-center text-ink-400 hover:text-ink-700 transition-colors" title="编辑">
        <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M11 2L14 5M2 14l3-1 8-8-3-3-8 8-1 3z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button onclick="saveStatusEdit(${idx})" class="edit-mode hidden w-4 h-4 rounded-full hover:bg-green-100 flex items-center justify-center text-green-600 transition-colors" title="保存">
        <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button onclick="cancelStatusEdit(${idx})" class="edit-mode hidden w-4 h-4 rounded-full hover:bg-ink-200 flex items-center justify-center text-ink-400 hover:text-ink-700 transition-colors" title="取消">
        <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
      <button onclick="removeStatusFromSettings(${idx})" class="view-mode w-4 h-4 rounded-full hover:bg-red-100 flex items-center justify-center text-ink-400 hover:text-red-500 transition-colors" title="删除">
        <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>
  `).join('');

  // 优先级列表 - 可编辑/删除（胶囊样式）
  const priorityListDisplay = document.getElementById('priority-list-display');
  priorityListDisplay.innerHTML = (settings.priorityList || []).map((p, idx) => `
    <div class="priority-item inline-flex items-center gap-1 px-3 py-1.5 bg-ink-50 rounded-full text-sm border border-ink-100 hover:border-ink-300 transition-colors" data-priority-idx="${idx}">
      <span class="view-mode text-ink-800">${p}</span>
      <input type="text" value="${p}" class="edit-mode hidden px-2 py-0.5 text-sm border border-ink-200 rounded-lg focus:outline-none focus:border-ink-400 w-16 bg-white" data-original="${p}" onkeydown="if(event.key==='Enter')savePriorityEdit(${idx})" onblur="cancelPriorityEdit(${idx})">
      <button onclick="startEditPriority(${idx})" class="view-mode w-4 h-4 rounded-full hover:bg-ink-200 flex items-center justify-center text-ink-400 hover:text-ink-700 transition-colors" title="编辑">
        <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M11 2L14 5M2 14l3-1 8-8-3-3-8 8-1 3z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button onclick="savePriorityEdit(${idx})" class="edit-mode hidden w-4 h-4 rounded-full hover:bg-green-100 flex items-center justify-center text-green-600 transition-colors" title="保存">
        <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M3 8l3 3 7-7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button onclick="cancelPriorityEdit(${idx})" class="edit-mode hidden w-4 h-4 rounded-full hover:bg-ink-200 flex items-center justify-center text-ink-400 hover:text-ink-700 transition-colors" title="取消">
        <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
      <button onclick="removePriorityFromSettings(${idx})" class="view-mode w-4 h-4 rounded-full hover:bg-red-100 flex items-center justify-center text-ink-400 hover:text-red-500 transition-colors" title="删除">
        <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>
  `).join('');

  // [ARCHIVED] TAPD 设置区域 —— 已归档至 archive/tapd/
  // renderTapdSettings();
}

/*
// 切换 TAPD 认证方式标签页
function switchTapdAuthTab(tab) {
  document.getElementById('tapd-token-form').classList.toggle('hidden', tab !== 'token');
  document.getElementById('tapd-oauth-form').classList.toggle('hidden', tab !== 'oauth');
  document.getElementById('tapd-tab-token').classList.toggle('bg-white', tab === 'token');
  document.getElementById('tapd-tab-token').classList.toggle('text-ink-800', tab === 'token');
  document.getElementById('tapd-tab-oauth').classList.toggle('bg-white', tab === 'oauth');
  document.getElementById('tapd-tab-oauth').classList.toggle('text-ink-800', tab === 'oauth');
}

// 保存 API Token 配置
async function saveTapdTokenSettings() {
  const apiToken = document.getElementById('tapd-api-token').value.trim();
  const workspaceId = document.getElementById('tapd-workspace-id-token').value.trim();

  if (!apiToken || !workspaceId) {
    alert('请填写 API Token 和工作区 ID');
    return;
  }

  try {
    const res = await fetch('/api/tapd/config-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiToken, workspaceId })
    });
    const data = await res.json();

    if (data.success) {
      showToast('TAPD API Token 配置已保存');
      renderTapdSettings();
    } else {
      alert(data.error || '保存失败');
    }
  } catch (err) {
    alert('保存失败');
  }
}

// 渲染 TAPD 设置区域
async function renderTapdSettings() {
  const authorizedSection = document.getElementById('tapd-settings-authorized');
  const authMethodLabel = document.getElementById('tapd-auth-method-label');

  if (!authorizedSection) return;

  try {
    const res = await fetch('/api/tapd/status');
    const status = await res.json();

    if (status.authorized) {
      authorizedSection.classList.remove('hidden');
      if (authMethodLabel) {
        authMethodLabel.textContent = status.authMethod === 'api_token' ? 'API Token' : 'OAuth';
      }
    } else {
      authorizedSection.classList.add('hidden');
    }

    // 默认显示 API Token 标签页
    switchTapdAuthTab('token');

    // 填充现有配置值到表单（如果存在）
    const workspaceId = status.workspaceId || '';
    const tokenInput = document.getElementById('tapd-workspace-id-token');
    const oauthInput = document.getElementById('tapd-workspace-id-oauth');
    if (tokenInput && workspaceId) tokenInput.value = workspaceId;
    if (oauthInput && workspaceId) oauthInput.value = workspaceId;
  } catch (err) {
    console.error('Render TAPD settings error:', err);
    authorizedSection.classList.add('hidden');
    switchTapdAuthTab('token');
  }
}

// 保存 TAPD 设置
async function saveTapdSettings() {
  const clientId = document.getElementById('tapd-client-id').value.trim();
  const clientSecret = document.getElementById('tapd-client-secret').value.trim();
  const workspaceId = document.getElementById('tapd-workspace-id-oauth').value.trim();

  if (!clientId || !clientSecret || !workspaceId) {
    alert('请填写完整的 TAPD 配置信息');
    return;
  }

  try {
    const res = await fetch('/api/tapd/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret, workspaceId })
    });

    const data = await res.json();
    if (data.success) {
      showToast('TAPD 配置已保存');
      renderTapdSettings();
    } else {
      alert('保存失败：' + (data.error || '未知错误'));
    }
  } catch (err) {
    console.error('Save TAPD settings error:', err);
    alert('保存失败');
  }
}
*/

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

  // 创建产品线（API 会同时创建目录 + .gitkeep + 保存到 settings）
  try {
    const res = await fetch('/api/product-lines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    if (res.ok) {
      const data = await res.json();
      settings.productLines = data.productLines;
      input.value = '';
      renderSettings();
      await refreshData();
    } else {
      const err = await res.json();
      alert(err.error || '保存失败');
    }
  } catch (e) {
    alert('保存失败: ' + e.message);
  }
}

// 从设置中删除产品线
async function removeProductLineFromSettings(name) {
  if (!confirm(`确定删除产品线「${name}」吗？\n该产品线下的需求将移至「未分类」。`)) return;

  try {
    const res = await fetch(`/api/product-lines/${encodeURIComponent(name)}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      const data = await res.json();
      settings.productLines = data.productLines || settings.productLines.filter(pl => pl !== name);
      if (data.movedCount > 0) {
        showToast(`已删除产品线「${name}」，${data.movedCount} 个需求移至「未分类」`, 'success');
      } else {
        showToast(`已删除产品线「${name}」`, 'success');
      }
      renderSettings();
      await refreshData();
    } else {
      const err = await res.json();
      alert(err.error || '删除失败');
    }
  } catch (e) {
    alert('删除失败: ' + e.message);
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

document.getElementById('idea-modal').addEventListener('click', function(e) {
  if (e.target === this) closeIdeaModal();
});

document.getElementById('idea-convert-modal').addEventListener('click', function(e) {
  if (e.target === this) closeIdeaConvertModal();
});

document.getElementById('idea-view-modal').addEventListener('click', function(e) {
  if (e.target === this) closeIdeaViewModal();
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
    toArray(r.productLine)
  );
  const productLines = [...new Set([...settingsProductLines, ...reqProductLines])].filter(pl => pl && pl !== '未分类');

  // 主产品线下拉选择（单选，决定物理位置）
  const mainPLContainer = document.getElementById('new-req-main-product-line');
  if (mainPLContainer) {
    const mainPLOptions = [
      {value: '', label: '未分类'},
      ...productLines.sort().map(pl => ({value: pl, label: pl}))
    ];
    mainPLContainer.innerHTML = cdRender({
      id: 'cd-new-req-main-pl',
      value: currentProductLine || '',
      options: mainPLOptions,
      style: 'form',
      colorType: '',
      onChange: 'updateRelatedProductLineOptions()'
    });
  }

  // 关联产品线复选框组（多选，排除主产品线）
  const listContainer = document.getElementById('new-req-product-line-list');
  listContainer.innerHTML = productLines.map(pl => `
    <label class="flex items-center gap-2 cursor-pointer related-pl-option" data-pl="${escapeHtml(pl)}">
      <input type="checkbox" name="new-req-product-line" value="${escapeHtml(pl)}" class="w-4 h-4 rounded border-ink-300 text-ink-800 focus:ring-ink-500">
      <span class="text-sm text-ink-700">${escapeHtml(pl)}</span>
    </label>
  `).join('');

  // 初始化时根据当前主产品线禁用关联选项
  updateRelatedProductLineOptions();

  // 动态填充优先级下拉列表
  const priorityContainer = document.getElementById('new-req-priority-dd');
  const priorityList = settings.priorityList || ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'];
  const priorityLabels = { P0: '最高', P1: '高', P2: '中', P3: '低', P4: '很低', P5: '最低' };
  priorityContainer.innerHTML = cdRender({
    id: 'cd-new-req-priority',
    value: 'P2',
    options: priorityList.map(p => {
      const label = priorityLabels[p] || '';
      return {value: p, label: label ? `${p} - ${label}` : p};
    }),
    style: 'form', colorType: 'priority', onChange: ''
  });

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

// 更新关联产品线选项：禁用已选的主产品线
function updateRelatedProductLineOptions() {
  const mainPL = cdGetValue('cd-new-req-main-pl') || '';
  const relatedOptions = document.querySelectorAll('.related-pl-option');
  relatedOptions.forEach(label => {
    const pl = label.getAttribute('data-pl');
    const checkbox = label.querySelector('input[type="checkbox"]');
    if (pl === mainPL) {
      label.classList.add('opacity-40', 'pointer-events-none');
      checkbox.checked = false;
      checkbox.disabled = true;
    } else {
      label.classList.remove('opacity-40', 'pointer-events-none');
      checkbox.disabled = false;
    }
  });
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
  const priority = cdGetValue('cd-new-req-priority');
  const dueDate = document.getElementById('new-req-due-date').value;
  const developer = document.getElementById('new-req-developer').value.trim();
  const requester = document.getElementById('new-req-requester').value.trim();

  // 主产品线（单选，决定物理位置）
  const mainProductLine = cdGetValue('cd-new-req-main-pl') || '未分类';

  // 关联产品线（多选，排除主产品线）
  const productLineCheckboxes = document.querySelectorAll('input[name="new-req-product-line"]:checked');
  const relatedProductLines = Array.from(productLineCheckboxes).map(cb => cb.value);

  // 合并为 product_line 数组（main 在前，兼容旧格式）
  const productLines = [mainProductLine, ...relatedProductLines.filter(pl => pl !== mainProductLine)];

  const platforms = [];
  if (document.getElementById('new-req-platform-web').checked) platforms.push('web');
  if (document.getElementById('new-req-platform-mobile').checked) platforms.push('mobile');

  if (!title) {
    alert('请输入需求标题');
    return;
  }
  if (!mainProductLine) {
    alert('请选择主产品线');
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
        <div class="flex items-center gap-2.5">
          <svg class="sprint-icon text-ink-500" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="3" width="12" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/>
            <path d="M1 6h12" stroke="currentColor" stroke-width="1.2"/>
            <path d="M5 1h4v2H5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
          </svg>
          <span class="sprint-name text-ink-800">未分配</span>
        </div>
        <span class="sprint-count text-ink-500">${unassignedCount}</span>
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
          <div class="flex items-center gap-2.5">
            <svg class="sprint-icon ${isActive ? 'text-ink-600' : 'text-ink-500'}" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="3" width="12" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/>
              <path d="M1 6h12" stroke="currentColor" stroke-width="1.2"/>
              <path d="M5 1h4v2H5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
            </svg>
            <span class="sprint-name text-ink-800">${sprint.name}</span>
            ${isActive ? '<span class="sprint-status-badge bg-blue-50 text-blue-700">进行中</span>' : '<span class="sprint-status-badge bg-ink-100 text-ink-500">已结束</span>'}
          </div>
          <div class="flex items-center gap-2">
            <span class="sprint-count text-ink-500">${reqCount}</span>
            <button onclick="event.stopPropagation(); confirmArchiveSprint('${sprint.name.replace(/'/g, "\\'")}')"
                    class="p-1 rounded hover:bg-red-50 text-ink-500 hover:text-red-500 transition-colors"
                    title="归档迭代">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 6v8h12V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 3h14v3H1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 9h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
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
  const productLineFilterContainer = document.getElementById('sprint-product-line-filter-dd');
  const settingsProductLines = settings.productLines || [];
  const allReqs = currentSprint === null
    ? currentData.requirements.filter(r => !r.sprint)
    : currentData.requirements.filter(r => r.sprint === currentSprint);
  const reqProductLines = allReqs.flatMap(r => 
    toArray(r.productLine)
  );
  const allProductLines = [...new Set([...settingsProductLines, ...reqProductLines])];

  const currentFilter = cdGetValue('cd-sprint-pl-filter');
  productLineFilterContainer.innerHTML = cdRender({
    id: 'cd-sprint-pl-filter',
    value: currentFilter || '',
    options: [{value: '', label: '全部产品线'}, ...allProductLines.map(pl => ({value: pl, label: pl}))],
    style: 'filter', colorType: '', onChange: 'renderSprintView'
  });

  // 筛选需求
  let sprintReqs = currentSprint === null
    ? currentData.requirements.filter(r => !r.sprint)
    : currentData.requirements.filter(r => r.sprint === currentSprint);
  
  const plFilter = cdGetValue('cd-sprint-pl-filter');
  if (plFilter) {
    sprintReqs = sprintReqs.filter(r => {
      const pls = toArray(r.productLine);
      return pls.includes(plFilter);
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

  // 看板配色：从 CD_STATUS_COLORS 提取 accent 色
  const kanbanColorPalette = Object.values(CD_STATUS_COLORS).map(c => ({ accent: c.text }));

  // 优先级圆点配色：从 CD_PRIORITY_COLORS 提取
  const priorityDotColors = Object.fromEntries(
    Object.entries(CD_PRIORITY_COLORS).map(([k, v]) => [k, v.bg])
  );

  board.innerHTML = (settings.statusList || []).map((status, idx) => {
    const statusReqs = reqs.filter(r => r.status === status);
    const config = kanbanColorPalette[idx % kanbanColorPalette.length];

    return `
      <div class="kanban-column flex-shrink-0 w-[280px] flex flex-col" data-status="${status}">
        <div class="kanban-header flex items-center justify-between border-b border-ink-100 bg-white px-3 py-2.5 relative overflow-hidden">
          <div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:${config.accent};border-radius:0 2px 2px 0;"></div>
          <div class="flex items-center gap-2 pl-2">
            <span class="text-sm font-semibold text-ink-900">${status}</span>
          </div>
          <span class="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full bg-ink-50 text-[11px] font-bold text-ink-600">${statusReqs.length}</span>
        </div>
        <div class="flex-1 p-2 space-y-2 min-h-[200px]"
             ondragover="handleKanbanDragOver(event)"
             ondragleave="handleKanbanDragLeave(event)"
             ondrop="handleKanbanDrop(event, '${status}')">
          ${statusReqs.map(req => `
            <div draggable="true"
                 ondragstart="handleKanbanDragStart(event, '${escapeHtml(req.id)}')"
                 class="kanban-card rounded-xl shadow-sm border border-ink-100 bg-white cursor-grab relative group overflow-hidden"
                 onclick="showDetail('${escapeHtml(req.id)}', 'sprint')">
              <div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:${config.accent};border-radius:12px 0 0 12px;"></div>
              <div class="p-3.5 pl-5">
                <button onclick="event.stopPropagation(); archiveReqFromList('${escapeHtml(req.id)}')"
                        onmousedown="event.stopPropagation()"
                        class="absolute top-2.5 right-2.5 w-6 h-6 rounded-full bg-ink-50 text-ink-400 hover:bg-red-50 hover:text-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all z-10"
                        title="归档" draggable="false">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 6v8h12V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 3h14v3H1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 9h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                </button>
                <div class="flex items-center gap-2 mb-2 pr-6">
                  <span style="width:6px;height:6px;border-radius:50%;background:${priorityDotColors[req.priority] || '#d4cfc7'};flex-shrink:0;" title="${req.priority}"></span>
                  <div class="text-sm text-ink-800 flex-1 font-medium" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${escapeHtml(req.title)}</div>
                </div>
                <div class="flex items-center justify-between">
                  <span class="font-mono text-xs text-ink-400">${escapeHtml(req.id)}</span>
                  <div class="flex items-center gap-1.5 text-xs text-ink-400" data-stop-click="true">
                    ${(() => {
                      const pls = toArray(req.productLine);
                      const allPls = new Set([
                        ...(settings.productLines || []),
                        ...currentData.requirements.flatMap(r => {
                          const p = toArray(r.productLine);
                          return p;
                        })
                      ]);
                      if (pls.length > 0) allPls.add(pls[0]);
                      const plOptions = [
                        {value: '', label: '未分类'},
                        ...Array.from(allPls).filter(p => p && p !== '未分类').sort().map(p => ({value: p, label: p}))
                      ];
                      const plValue = pls.length > 0 ? pls[0] : '';
                      return cdRender({ id: `cd-kanban-pl-${escapeHtml(req.id)}`, value: plValue, options: plOptions, style: 'pill', colorType: '', onChange: `updateProductLine('${escapeHtml(req.id)}')`, stopClick: true });
                    })()}
                  </div>
                </div>
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
    const pls = toArray(req.productLine);
    return `
      <tr class="border-b border-ink-50 hover:bg-ink-50 transition-colors">
        <td class="px-5 py-4">
          <span class="font-mono text-sm text-ink-500">${escapeHtml(req.id)}</span>
        </td>
        <td class="px-5 py-4">
          <div class="text-sm text-ink-800 cursor-pointer hover:text-ink-600 transition-colors" onclick="showDetail('${escapeHtml(req.id)}', 'sprint')">${escapeHtml(req.title)}</div>
        </td>
        <td class="px-5 py-4">
          ${cdRender({ id: `cd-sp-status-${escapeHtml(req.id)}`, value: req.status, options: (settings.statusList || []).map(s => ({value: s, label: s})), style: 'pill', colorType: 'status', onChange: `updateStatus('${escapeHtml(req.id)}')`, stopClick: true })}
        </td>
        <td class="px-5 py-4" data-stop-click="true">
          ${(() => {
            const pls = toArray(req.productLine);
            const allPls = new Set([
              ...(settings.productLines || []),
              ...currentData.requirements.flatMap(r => {
                const p = toArray(r.productLine);
                return p;
              })
            ]);
            if (pls.length > 0) allPls.add(pls[0]);
            const plOptions = [
              {value: '', label: '未分类'},
              ...Array.from(allPls).filter(p => p && p !== '未分类').sort().map(p => ({value: p, label: p}))
            ];
            const plValue = pls.length > 0 ? pls[0] : '';
            return cdRender({ id: `cd-sp-pl-${escapeHtml(req.id)}`, value: plValue, options: plOptions, style: 'pill', colorType: '', onChange: `updateProductLine('${escapeHtml(req.id)}')`, stopClick: true });
          })()}
        </td>
        <td class="px-5 py-4">
          ${cdRender({ id: `cd-sp-priority-${escapeHtml(req.id)}`, value: req.priority, options: (settings.priorityList || []).map(p => ({value: p, label: p})), style: 'pill', colorType: 'priority', onChange: `updatePriority('${escapeHtml(req.id)}')`, stopClick: true })}
        </td>
        <td class="px-5 py-4" onclick="event.stopPropagation()">
          <button onclick="event.stopPropagation(); archiveReqFromList('${escapeHtml(req.id)}')"
                  class="p-1.5 rounded-full text-ink-500 hover:text-red-500 hover:bg-red-50 transition-colors"
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
  hideAllPages();
  document.getElementById('drafts-page').classList.remove('hidden');
  
  // 更新产品线筛选下拉
  const productLines = getAllProductLines();
  const currentPL = cdGetValue('cd-draft-pl-filter');
  document.getElementById('draft-product-line-filter-dd').innerHTML = cdRender({
    id: 'cd-draft-pl-filter',
    value: currentPL || '',
    options: [{value: '', label: '全部产品线'}, ...productLines.map(pl => ({value: pl, label: pl}))],
    style: 'filter', colorType: '', onChange: 'renderDraftsList'
  });
  
  // 初始化状态筛选标签
  updateStatusFilterTabs();
  renderDraftsList();
}

// 设置需求池状态筛选
function setDraftStatusFilter(status) {
  currentDraftStatusFilter = status;
  updateStatusFilterTabs();
  renderDraftsList();
}

// 更新状态筛选标签样式
function updateStatusFilterTabs() {
  document.querySelectorAll('.status-tab').forEach(btn => {
    if (btn.dataset.status === currentDraftStatusFilter) {
      btn.className = 'status-tab px-3 py-1.5 rounded-full text-sm font-medium bg-ink-800 text-white';
    } else {
      btn.className = 'status-tab px-3 py-1.5 rounded-full text-sm font-medium text-ink-600 hover:bg-ink-100';
    }
  });
}

// 渲染需求池列表
function renderDraftsList() {
  const container = document.getElementById('drafts-list');
  const productLineFilter = cdGetValue('cd-draft-pl-filter');
  const searchQuery = document.getElementById('draft-search').value.toLowerCase();
  
  // 筛选草稿（排除已搁置，已搁置在单独区域显示）
  let drafts = currentData.drafts.filter(d => d.status !== 'archived');
  
  if (currentDraftStatusFilter) {
    drafts = drafts.filter(d => d.status === currentDraftStatusFilter);
  }
  if (productLineFilter) {
    drafts = drafts.filter(d => 
      Array.isArray(d.product_line) && d.product_line.includes(productLineFilter)
    );
  }
  if (searchQuery) {
    drafts = drafts.filter(d => 
      (d.title || '').toLowerCase().includes(searchQuery) ||
      (d.description || '').toLowerCase().includes(searchQuery)
    );
  }
  
  // 更新已搁置区域
  renderArchivedDrafts();
  
  if (drafts.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="7" class="px-4 py-12 text-center text-ink-400">
          <div class="flex flex-col items-center">
            <svg width="40" height="40" viewBox="0 0 40 40" fill="none" class="mb-3 text-ink-300">
              <rect x="6" y="10" width="28" height="24" rx="2" stroke="currentColor" stroke-width="2"/>
              <path d="M6 18h28" stroke="currentColor" stroke-width="2"/>
              <path d="M13 6h14v4H13z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            </svg>
            <p>暂无草稿</p>
            <p class="text-xs mt-1">点击上方「新建草稿」添加</p>
          </div>
        </td>
      </tr>
    `;
    return;
  }
  
  container.innerHTML = drafts.map(draft => {
    const statusLabels = { draft: '草稿', in_progress: '进行中', published: '已发布', archived: '已搁置' };
    const priorityLabels = { low: '低', medium: '中', high: '高' };
    
    const statusOptions = ['draft', 'in_progress', 'archived']
      .map(s => `<option value="${s}" ${draft.status === s ? 'selected' : ''}>${statusLabels[s]}</option>`)
      .join('');
    
    const statusOptsArr = ['draft', 'in_progress', 'archived']
      .map(s => ({value: s, label: statusLabels[s]}));
    
    const productLines = getAllProductLines();
    const productLineCheckboxes = productLines.map(pl => {
      const checked = Array.isArray(draft.product_line) && draft.product_line.includes(pl) ? 'checked' : '';
      return `<label class="inline-flex items-center gap-1"><input type="checkbox" class="draft-pl-cb w-4 h-4" value="${escapeHtml(pl)}" ${checked}>${escapeHtml(pl)}</label>`;
    }).join('');
    
    return `
      <tr class="req-row group cursor-pointer hover:bg-ink-50/60 transition-colors" onclick="if(!event.target.closest('[data-stop-click]') && !event.target.closest('.cdropdown-option')) showDraftModal('${draft.id}')">
        <td class="px-4 py-3" data-stop-click="true">
          <span class="font-mono text-xs text-ink-500">${draft.id}</span>
        </td>
        <td class="px-4 py-3">
          <div class="flex items-center gap-2">
            <span class="font-medium text-ink-800 truncate max-w-xs">${draft.title || '无标题'}</span>
            ${draft.published_ids && draft.published_ids.length > 0
              ? `<span class="text-xs text-green-600">→ ${draft.published_ids.join(', ')}</span>`
              : ''}
          </div>
        </td>
        <td class="px-4 py-3" data-stop-click="true">
          ${cdRender({ id: `cd-draft-status-${draft.id}`, value: draft.status, options: statusOptsArr, style: 'pill', colorType: 'status', onChange: `updateDraftStatus('${draft.id}')`, stopClick: true, extraClass: 'text-xs' })}
        </td>
        <td class="px-4 py-3" data-stop-click="true">
          ${cdRender({ id: `cd-draft-priority-${draft.id}`, value: draft.priority, options: (settings.priorityList || []).map(p => ({value: p, label: p})), style: 'pill', colorType: 'priority', onChange: `updateDraftField('${draft.id}','priority')`, stopClick: true, extraClass: 'text-xs' })}
        </td>
        <td class="px-4 py-3" data-stop-click="true">
          <div class="flex flex-wrap gap-1 text-xs">
            ${Array.isArray(draft.product_line) && draft.product_line.length > 0
              ? draft.product_line.map(pl => `<span class="px-1.5 py-0.5 bg-ink-100 rounded text-ink-600">${escapeHtml(pl)}</span>`).join('')
              : '<span class="text-ink-400">-</span>'}
          </div>
        </td>
        <td class="px-4 py-3" data-stop-click="true">
          <span class="text-xs text-ink-500">${draft.source || '-'}</span>
        </td>
        <td class="px-4 py-3" data-stop-click="true">
          <div class="flex items-center gap-1">
            <button onclick="event.stopPropagation(); showDraftModal('${draft.id}')" class="p-1.5 rounded hover:bg-ink-100 text-ink-400 hover:text-ink-600" title="编辑">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M10.5 1.5l2 2-8 8H2.5v-2l8-8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
            </button>
            ${draft.status !== 'published'
              ? `<button onclick="event.stopPropagation(); openPublishModal('${draft.id}')" class="p-1.5 rounded hover:bg-sage-100 text-ink-400 hover:text-sage-600" title="发布">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M12 7L2 2v10l10-5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
                </button>`
              : ''}
            <button onclick="event.stopPropagation(); previewDraft('${draft.id}')" class="p-1.5 rounded hover:bg-blue-50 text-ink-400 hover:text-blue-600" title="预览">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 7s2.5-5 6-5 6 5 6 5-2.5 5-6 5-6-5-6-5z" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.5"/></svg>
            </button>
            <button onclick="event.stopPropagation(); deleteDraft('${draft.id}')" class="p-1.5 rounded hover:bg-rust-50 text-ink-400 hover:text-rust-500" title="删除">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 3.5h10M4.5 3.5V2a1 1 0 011-1h3a1 1 0 011 1v1.5M5.5 6v5M8.5 6v5M3 3.5l1 9h6l1-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// 渲染已搁置列表
function renderArchivedDrafts() {
  const container = document.getElementById('archived-drafts-list');
  const countEl = document.getElementById('archived-drafts-count');
  
  const archivedDrafts = currentData.drafts.filter(d => d.status === 'archived');
  countEl.textContent = archivedDrafts.length;
  
  if (archivedDrafts.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="6" class="px-4 py-6 text-center text-ink-400 text-sm">暂无已搁置需求</td>
      </tr>
    `;
    return;
  }
  
  container.innerHTML = archivedDrafts.map(draft => `
    <tr class="group hover:bg-ink-50/50">
      <td class="px-4 py-2">
        <span class="font-mono text-xs text-ink-500">${draft.id}</span>
      </td>
      <td class="px-4 py-2">
        <span class="text-sm text-ink-700 truncate max-w-xs">${draft.title || '无标题'}</span>
      </td>
      <td class="px-4 py-2">
        ${cdRender({ id: `cd-arc-status-${draft.id}`, value: draft.status, options: [{value:'draft',label:'草稿'},{value:'in_progress',label:'进行中'},{value:'archived',label:'已搁置'}], style: 'pill', colorType: 'status', onChange: `updateDraftStatus('${draft.id}')`, stopClick: true, extraClass: 'text-xs' })}
      </td>
      <td class="px-4 py-2">
        <div class="flex flex-wrap gap-1 text-xs">
          ${Array.isArray(draft.product_line) && draft.product_line.length > 0 
            ? draft.product_line.map(pl => `<span class="px-1.5 py-0.5 bg-ink-100 rounded text-ink-600">${escapeHtml(pl)}</span>`).join('')
            : '<span class="text-ink-400">-</span>'}
        </div>
      </td>
      <td class="px-4 py-2">
        <span class="text-xs text-ink-500">${draft.source || '-'}</span>
      </td>
      <td class="px-4 py-2">
        <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onclick="showDraftModal('${draft.id}')" class="p-1 rounded hover:bg-ink-100 text-ink-400 hover:text-ink-600" title="编辑">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M10.5 1.5l2 2-8 8H2.5v-2l8-8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
          </button>
          <button onclick="deleteDraft('${draft.id}')" class="p-1 rounded hover:bg-rust-50 text-ink-400 hover:text-rust-500" title="删除">
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 4h8M5 4V3h4v1M5 6v5M9 6v5M4 4l1 8h4l1-8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

// 获取所有产品线
function getAllProductLines() {
  const settingsProductLines = settings.productLines || [];
  const reqProductLines = currentData.requirements.flatMap(r =>
    toArray(r.productLine)
  );
  return [...new Set([...settingsProductLines, ...reqProductLines])];
}

// 预览草稿/原型
function previewDraft(draftId) {
  const draft = currentData.drafts.find(d => d.id === draftId);
  if (!draft) return;
  
  // 检查草稿是否有自己的原型文件（新格式）
  if (draft.prototypeFiles && draft.prototypeFiles.length > 0) {
    // 新格式：打开草稿文件夹中的原型文件
    const protoFile = draft.prototypeFiles[0];
    const protoPath = draft.folderPath ? draft.folderPath.split(/[/\\]/).pop() + '/' + protoFile : protoFile;
    window.open(`/drafts/${encodeURIComponent(protoPath)}`, '_blank');
    return;
  }
  
  // 旧格式或无原型：查找已发布需求的原型
  const prototypeFiles = [];
  
  for (const req of currentData.requirements) {
    if (req.title === draft.title || (draft.published_ids && draft.published_ids.includes(req.id))) {
      if (req.bodyPath) {
        const filename = req.bodyPath.split(/[/\\]/).pop();
        if (filename.endsWith('.html')) {
          prototypeFiles.push({ filename, bodyPath: req.bodyPath, title: req.title });
        }
      }
    }
  }
  
  if (prototypeFiles.length > 0) {
    const proto = prototypeFiles[0];
    const protoPath = proto.bodyPath.replace(/\\/g, '/').split('/').pop();
    window.open(`/products/${protoPath}`, '_blank');
  } else {
    showDraftPreviewModal(draft);
  }
}

// 显示草稿预览弹窗
function showDraftPreviewModal(draft) {
  let modal = document.getElementById('draft-preview-modal');
  if (!modal) {
    const html = `
      <div id="draft-preview-modal" class="fixed inset-0 bg-black/40 backdrop-blur-sm hidden z-50 flex items-center justify-center">
        <div class="bg-white rounded-2xl shadow-2xl w-[800px] h-[600px] max-h-[85vh] flex flex-col overflow-hidden animate-fade-in">
          <div class="px-6 py-4 border-b border-ink-100 flex justify-between items-center">
            <h3 id="draft-preview-title" class="font-display text-lg font-bold text-ink-900">草稿预览</h3>
            <button onclick="closeDraftPreviewModal()" class="w-8 h-8 rounded-lg hover:bg-ink-100 flex items-center justify-center transition-colors">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          </div>
          <div class="flex-1 overflow-auto p-6">
            <div id="draft-preview-content" class="prose prose-sm max-w-none"></div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    modal = document.getElementById('draft-preview-modal');
  }
  
  document.getElementById('draft-preview-title').textContent = draft.title || '无标题';
  const content = document.getElementById('draft-preview-content');
  
  let html = '';
  
  // 元数据
  if (draft.description) {
    html += `<div class="mb-4"><h4 class="text-sm font-semibold text-ink-700 mb-2">描述</h4><p class="text-ink-600">${draft.description}</p></div>`;
  }
  if (draft.source) {
    html += `<div class="mb-4"><h4 class="text-sm font-semibold text-ink-700 mb-2">来源</h4><p class="text-ink-600">${draft.source}</p></div>`;
  }
  if (draft.product_line && draft.product_line.length > 0) {
    html += `<div class="mb-4"><h4 class="text-sm font-semibold text-ink-700 mb-2">产品线</h4><div class="flex gap-2">${draft.product_line.map(pl => `<span class="px-2 py-1 bg-ink-100 rounded text-sm">${escapeHtml(pl)}</span>`).join('')}</div></div>`;
  }
  if (draft.tags && draft.tags.length > 0) {
    html += `<div class="mb-4"><h4 class="text-sm font-semibold text-ink-700 mb-2">标签</h4><div class="flex gap-2">${draft.tags.map(tag => `<span class="px-2 py-1 bg-clay-100 text-clay-700 rounded text-sm">${tag}</span>`).join('')}</div></div>`;
  }
  
  // 原型文件
  if (draft.prototypeFiles && draft.prototypeFiles.length > 0) {
    html += `<div class="mb-4"><h4 class="text-sm font-semibold text-ink-700 mb-2">原型文件</h4><div class="space-y-2">`;
    for (const proto of draft.prototypeFiles) {
      const protoPath = draft.folderPath ? draft.folderPath.split(/[/\\]/).pop() + '/' + proto : proto;
      html += `<a href="/drafts/${encodeURIComponent(protoPath)}" target="_blank" class="flex items-center gap-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 rounded-lg text-blue-700 text-sm transition-colors">
        <svg width="16" height="16" fill="none" viewBox="0 0 16 16"><path d="M2 4h12v8H2z" stroke="currentColor" stroke-width="1.5"/><path d="M5 4V2h4v2" stroke="currentColor" stroke-width="1.5"/></svg>
        ${proto}
      </a>`;
    }
    html += `</div></div>`;
  } else {
    html += `<div class="mt-4 p-4 bg-ink-50 rounded-lg text-sm text-ink-500">暂无原型文件</div>`;
  }
  
  content.innerHTML = html;
  modal.classList.remove('hidden');
}

function closeDraftPreviewModal() {
  document.getElementById('draft-preview-modal').classList.add('hidden');
}

// 显示草稿弹窗（新建/编辑）
function showDraftModal(draftId = null) {
  const modal = document.getElementById('draft-modal');
  const titleEl = document.getElementById('draft-modal-title');
  
  editingDraft = draftId ? currentData.drafts.find(d => d.id === draftId) : null;
  
  if (editingDraft) {
    titleEl.textContent = '编辑草稿';
    document.getElementById('draft-id').value = editingDraft.id;
    document.getElementById('draft-title-input').value = editingDraft.title || '';
    document.getElementById('draft-description-input').value = editingDraft.description || '';
    document.getElementById('draft-source-input').value = editingDraft.source || '';
    document.getElementById('draft-tags-input').value = (editingDraft.tags || []).join(', ');
    // 渲染优先级下拉（使用系统设置）
    const draftPriorityList = settings.priorityList || ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'];
    document.getElementById('draft-priority-input-dd').innerHTML = cdRender({
      id: 'cd-draft-priority-input',
      value: editingDraft.priority || draftPriorityList[2] || '',
      options: draftPriorityList.map(p => ({value: p, label: p})),
      style: 'form', colorType: 'priority', onChange: ''
    });
  } else {
    titleEl.textContent = '新建草稿';
    document.getElementById('draft-id').value = '';
    document.getElementById('draft-title-input').value = '';
    document.getElementById('draft-description-input').value = '';
    document.getElementById('draft-source-input').value = '';
    document.getElementById('draft-tags-input').value = '';
    // 渲染优先级下拉（使用系统设置）
    const draftPriorityList = settings.priorityList || ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'];
    document.getElementById('draft-priority-input-dd').innerHTML = cdRender({
      id: 'cd-draft-priority-input',
      value: draftPriorityList[2] || '',
      options: draftPriorityList.map(p => ({value: p, label: p})),
      style: 'form', colorType: 'priority', onChange: ''
    });
  }
  
  // 渲染产品线复选框
  const productLines = getAllProductLines();
  const container = document.getElementById('draft-product-lines');
  container.innerHTML = productLines.map(pl => {
    const checked = editingDraft && Array.isArray(editingDraft.product_line) && editingDraft.product_line.includes(pl) ? 'checked' : '';
    return `<label class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ink-50 rounded-lg cursor-pointer hover:bg-ink-100 text-sm">
      <input type="checkbox" class="draft-pl-cb w-4 h-4" value="${escapeHtml(pl)}" ${checked}>${escapeHtml(pl)}
    </label>`;
  }).join('') || '<span class="text-sm text-ink-400">暂无产品线</span>';
  
  modal.classList.remove('hidden');
  setTimeout(() => document.getElementById('draft-title-input').focus(), 100);
}

function closeDraftModal() {
  document.getElementById('draft-modal').classList.add('hidden');
  editingDraft = null;
}

// 保存草稿（新建/更新）
async function saveDraft() {
  const id = document.getElementById('draft-id').value;
  const title = document.getElementById('draft-title-input').value.trim();
  const description = document.getElementById('draft-description-input').value.trim();
  const priority = cdGetValue('cd-draft-priority-input');
  const source = document.getElementById('draft-source-input').value.trim();
  const tags = document.getElementById('draft-tags-input').value.split(',').map(t => t.trim()).filter(Boolean);
  const product_line = Array.from(document.querySelectorAll('#draft-product-lines .draft-pl-cb:checked')).map(cb => cb.value);
  
  if (!title) {
    showToast('请输入标题', 'error');
    return;
  }
  
  try {
    if (id) {
      // 更新
      const res = await fetch(`/api/drafts/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, priority, source, tags, product_line })
      });
      if (!res.ok) throw new Error();
      showToast('草稿已更新');
    } else {
      // 新建
      const res = await fetch('/api/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, priority, source, tags, product_line })
      });
      if (!res.ok) throw new Error();
      showToast('草稿已创建');
    }
    
    closeDraftModal();
    await refreshData();
    renderDraftsList();
  } catch (e) {
    showToast('保存失败', 'error');
  }
}

// 行内更新草稿字段
async function updateDraftField(id, field, value) {
  try {
    await fetch(`/api/drafts/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value })
    });
    await refreshData();
    showToast('已更新');
  } catch (e) {
    showToast('更新失败', 'error');
  }
}

// 更新草稿状态
async function updateDraftStatus(id, status) {
  try {
    const res = await fetch(`/api/drafts/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    const data = await res.json();
    
    if (!res.ok) {
      showToast(data.error || '更新失败', 'error');
      renderDraftsList(); // 恢复原状态
      return;
    }
    
    await refreshData();
    renderDraftsList();
    showToast('状态已更新');
  } catch (e) {
    showToast('更新失败', 'error');
  }
}

// 显示发布弹窗
function openPublishModal(draftId) {
  const draft = currentData.drafts.find(d => d.id === draftId);
  if (!draft) return;
  
  document.getElementById('publish-draft-id').value = draftId;
  document.getElementById('publish-draft-title').textContent = draft.title || '无标题';
  document.getElementById('publish-draft-desc').textContent = draft.description || '';
  
  // 预填已选产品线
  const productLines = getAllProductLines();
  const container = document.getElementById('publish-product-lines');
  const currentPL = Array.isArray(draft.product_line) ? draft.product_line : [];
  
  container.innerHTML = productLines.map(pl => {
    const checked = currentPL.includes(pl) ? 'checked' : '';
    return `<label class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ink-50 rounded-lg cursor-pointer hover:bg-ink-100 text-sm">
      <input type="checkbox" class="publish-pl-cb w-4 h-4" value="${escapeHtml(pl)}" ${checked}>${escapeHtml(pl)}
    </label>`;
  }).join('') || '<span class="text-sm text-ink-400">暂无产品线</span>';
  
  document.getElementById('publish-modal').classList.remove('hidden');
}

function closePublishModal() {
  document.getElementById('publish-modal').classList.add('hidden');
}

// 确认发布
async function confirmPublish() {
  const draftId = document.getElementById('publish-draft-id').value;
  const product_line = Array.from(document.querySelectorAll('#publish-product-lines .publish-pl-cb:checked')).map(cb => cb.value);
  
  if (product_line.length === 0) {
    showToast('请至少选择一个产品线', 'error');
    return;
  }
  
  try {
    const res = await fetch(`/api/drafts/${draftId}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_line })
    });
    
    if (!res.ok) throw new Error();
    
    const data = await res.json();
    closePublishModal();
    await refreshData();
    renderDraftsList();
    showToast(`已发布为 ${data.requirements.map(r => r.id).join(', ')}`);
  } catch (e) {
    showToast('发布失败', 'error');
  }
}

// 删除草稿
async function deleteDraft(draftId) {
  if (!confirm('确定要删除此草稿吗？')) return;
  
  try {
    const res = await fetch(`/api/drafts/${draftId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    
    await refreshData();
    renderDraftsList();
    showToast('草稿已删除');
  } catch (e) {
    showToast('删除失败', 'error');
  }
}

// 返回需求池（兼容旧代码）
function backToDrafts() {
  showDraftsPage();
}

// 显示创建草稿弹窗（兼容旧代码）
function showCreateDraftModal() {
  showDraftModal();
}

function closeCreateDraftModal() {
  closeDraftModal();
}

// 兼容旧代码
function createDraft() {
  saveDraft();
}

// 以下旧函数已移除，由新实现替代：
// - showDraftDetail -> openDraftModal
// - renderDraftDetail -> renderDraftsList
// - updateDraft -> updateDraftField / saveDraft
// - publishDraft -> openPublishModal / confirmPublish
// - archiveDraft -> updateDraftStatus
// - confirmDeleteDraft -> deleteDraft (新实现)

// ============================================================================
// 灵感集功能
// ============================================================================

let currentEditingIdeaId = null;
let currentConvertingIdeaId = null;
let currentConvertingIdeaMode = null;

// 显示灵感集页面
function showIdeasPage() {
  previousPage = 'ideas';
  hideAllPages();
  document.getElementById('ideas-page').classList.remove('hidden');
  renderIdeas();
}

// 渲染灵感卡片墙
function renderIdeas() {
  const grid = document.getElementById('ideas-grid');
  const empty = document.getElementById('ideas-empty');
  const countEl = document.getElementById('ideas-total-count');
  const searchVal = (document.getElementById('idea-search')?.value || '').toLowerCase();

  let ideas = currentData.ideas || [];

  // 搜索过滤
  if (searchVal) {
    ideas = ideas.filter(i =>
      (i.title || '').toLowerCase().includes(searchVal) ||
      (i.tags || []).some(t => t.toLowerCase().includes(searchVal))
    );
  }

  // 更新计数
  if (countEl) countEl.textContent = ideas.length;
  if (ideasEntryCount) ideasEntryCount.textContent = (currentData.ideas || []).length;

  if (ideas.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }

  empty.classList.add('hidden');

  // 按创建时间倒序
  ideas.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  grid.innerHTML = ideas.map(idea => {
    const tagsHtml = (idea.tags || []).map(tag =>
      `<span class="px-2 py-0.5 bg-rust-50 text-rust-600 text-xs rounded-full">${escapeHtml(tag)}</span>`
    ).join('');

    const dateStr = idea.created_at ? new Date(idea.created_at).toLocaleDateString('zh-CN') : '';
    const convertedBadge = idea.converted_to
      ? `<span class="px-2 py-0.5 bg-sage-50 text-sage-600 text-xs rounded-full">已转化</span>`
      : '';

    return `
      <div class="bg-white rounded-xl border border-ink-100 p-5 hover:shadow-md transition-shadow cursor-pointer" onclick="showIdeaModal('${idea.id}')">
        <div class="flex justify-between items-start mb-3">
          <h3 class="font-medium text-ink-800 text-base line-clamp-2 flex-1">${escapeHtml(idea.title)}</h3>
          ${convertedBadge}
        </div>
        <p class="text-sm text-ink-500 line-clamp-3 mb-4">${escapeHtml(idea.content || '').substring(0, 120)}${(idea.content || '').length > 120 ? '...' : ''}</p>
        <div class="flex items-center justify-between">
          <div class="flex flex-wrap gap-1.5">${tagsHtml}</div>
          <span class="text-xs text-ink-400">${dateStr}</span>
        </div>
        <div class="flex gap-2 mt-4 pt-3 border-t border-ink-50">
          <button onclick="event.stopPropagation(); showIdeaModal('${idea.id}')" class="px-3 py-1.5 text-xs text-ink-600 hover:text-ink-800 hover:bg-ink-50 rounded-lg transition-colors">编辑</button>
          ${!idea.converted_to ? `
            <button onclick="event.stopPropagation(); showIdeaConvertModal('${idea.id}', 'draft')" class="px-3 py-1.5 text-xs text-sage-600 hover:text-sage-800 hover:bg-sage-50 rounded-lg transition-colors">转草稿</button>
            <button onclick="event.stopPropagation(); showIdeaConvertModal('${idea.id}', 'requirement')" class="px-3 py-1.5 text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-lg transition-colors">转需求</button>
          ` : ''}
          <button onclick="event.stopPropagation(); deleteIdea('${idea.id}')" class="px-3 py-1.5 text-xs text-rust-500 hover:text-rust-700 hover:bg-rust-50 rounded-lg transition-colors ml-auto">删除</button>
        </div>
      </div>
    `;
  }).join('');
}

// 显示灵感弹窗（新建/编辑）
function showIdeaModal(ideaId = null) {
  const modal = document.getElementById('idea-modal');
  const titleEl = document.getElementById('idea-modal-title');
  const idInput = document.getElementById('idea-id');
  const titleInput = document.getElementById('idea-title-input');
  const contentInput = document.getElementById('idea-content-input');
  const tagsInput = document.getElementById('idea-tags-input');

  currentEditingIdeaId = ideaId;

  if (ideaId) {
    const idea = (currentData.ideas || []).find(i => i.id === ideaId);
    if (!idea) return;
    titleEl.textContent = '编辑灵感';
    idInput.value = idea.id;
    titleInput.value = idea.title || '';
    contentInput.value = idea.content || '';
    tagsInput.value = (idea.tags || []).join(', ');
  } else {
    titleEl.textContent = '新建灵感';
    idInput.value = '';
    titleInput.value = '';
    contentInput.value = '';
    tagsInput.value = '';
  }

  modal.classList.remove('hidden');
}

// 关闭灵感弹窗
function closeIdeaModal() {
  document.getElementById('idea-modal').classList.add('hidden');
  currentEditingIdeaId = null;
}

// 保存灵感
async function saveIdea() {
  const idInput = document.getElementById('idea-id').value;
  const title = document.getElementById('idea-title-input').value.trim();
  const content = document.getElementById('idea-content-input').value.trim();
  const tagsStr = document.getElementById('idea-tags-input').value.trim();

  if (!title) {
    showToast('请输入标题', 'error');
    return;
  }

  const tags = tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean);
  const isEdit = !!idInput;

  try {
    const url = isEdit ? `/api/ideas/${idInput}` : '/api/ideas';
    const method = isEdit ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, tags })
    });

    if (!res.ok) throw new Error();

    closeIdeaModal();
    await refreshData();
    renderIdeas();
    showToast(isEdit ? '灵感已更新' : '灵感已创建');
  } catch (e) {
    showToast('保存失败', 'error');
  }
}

// 删除灵感
async function deleteIdea(ideaId) {
  if (!confirm('确定要删除此灵感吗？')) return;

  try {
    const res = await fetch(`/api/ideas/${ideaId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();

    await refreshData();
    renderIdeas();
    showToast('灵感已删除');
  } catch (e) {
    showToast('删除失败', 'error');
  }
}

// 显示转化弹窗
function showIdeaConvertModal(ideaId, mode) {
  const idea = (currentData.ideas || []).find(i => i.id === ideaId);
  if (!idea) return;

  currentConvertingIdeaId = ideaId;
  currentConvertingIdeaMode = mode;

  const modal = document.getElementById('idea-convert-modal');
  const titleEl = document.getElementById('idea-convert-modal-title');
  const titleDisplay = document.getElementById('convert-idea-title');
  const descDisplay = document.getElementById('convert-idea-desc');
  const plSection = document.getElementById('convert-idea-product-line-section');
  const plContainer = document.getElementById('convert-idea-product-lines');

  titleEl.textContent = mode === 'draft' ? '转化为草稿' : '转化为需求';
  titleDisplay.textContent = idea.title;
  descDisplay.textContent = idea.content || '';
  document.getElementById('convert-idea-id').value = ideaId;
  document.getElementById('convert-idea-mode').value = mode;

  // 优先级选择（使用系统设置）
  const priorityList = settings.priorityList || ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'];
  document.getElementById('convert-idea-priority-dd').innerHTML = cdRender({
    id: 'cd-convert-idea-priority',
    value: priorityList[2] || '',
    options: priorityList.map(p => ({value: p, label: p})),
    style: 'form', colorType: 'priority', onChange: ''
  });

  // 产品线选择（只有转需求时需要）
  if (mode === 'requirement') {
    plSection.classList.remove('hidden');
    const productLines = getAllProductLines();
    plContainer.innerHTML = productLines.map(pl => `
      <label class="flex items-center gap-2 px-3 py-2 bg-ink-50 rounded-lg cursor-pointer hover:bg-ink-100 transition-colors">
        <input type="checkbox" name="convert-idea-pl" value="${escapeHtml(pl)}" class="w-4 h-4 text-sage-500 rounded border-ink-300 focus:ring-sage-500">
        <span class="text-sm text-ink-700">${escapeHtml(pl)}</span>
      </label>
    `).join('');
  } else {
    plSection.classList.add('hidden');
  }

  modal.classList.remove('hidden');
}

// 关闭转化弹窗
function closeIdeaConvertModal() {
  document.getElementById('idea-convert-modal').classList.add('hidden');
  currentConvertingIdeaId = null;
  currentConvertingIdeaMode = null;
}

// 确认转化
async function confirmIdeaConvert() {
  const ideaId = currentConvertingIdeaId;
  const mode = currentConvertingIdeaMode;
  if (!ideaId || !mode) return;

  const priority = cdGetValue('cd-convert-idea-priority') || '';

  let product_line = [];
  if (mode === 'requirement') {
    const checked = document.querySelectorAll('input[name="convert-idea-pl"]:checked');
    product_line = Array.from(checked).map(c => c.value);
  }

  try {
    const endpoint = mode === 'draft' ? `/api/ideas/${ideaId}/convert-to-draft` : `/api/ideas/${ideaId}/convert-to-requirement`;
    const body = mode === 'requirement'
      ? JSON.stringify({ product_line, priority })
      : JSON.stringify({ priority });
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body
    });

    if (!res.ok) throw new Error();

    const data = await res.json();
    closeIdeaConvertModal();
    await refreshData();
    renderIdeas();

    const target = mode === 'draft' ? '草稿' : '需求';
    const targetId = data.draftId || data.requirementId || '';
    showToast(`已转化为${target} ${targetId}`);
  } catch (e) {
    showToast('转化失败', 'error');
  }
}

// ========== 灵感集 ==========

let editingIdea = null;

// 显示灵感集页面
function showIdeasPage() {
  previousPage = 'ideas';
  hideAllPages();
  document.getElementById('ideas-page').classList.remove('hidden');
  renderIdeas();
}

// 渲染灵感卡片墙
function renderIdeas() {
  const grid = document.getElementById('ideas-grid');
  const empty = document.getElementById('ideas-empty');
  const totalEl = document.getElementById('ideas-total-count');
  const searchQuery = document.getElementById('idea-search')?.value.toLowerCase() || '';

  let ideas = [...currentData.ideas];

  if (searchQuery) {
    ideas = ideas.filter(i =>
      (i.title || '').toLowerCase().includes(searchQuery) ||
      (i.content || '').toLowerCase().includes(searchQuery) ||
      (i.tags || []).some(t => t.toLowerCase().includes(searchQuery))
    );
  }

  totalEl.textContent = ideas.length;

  if (ideas.length === 0) {
    grid.classList.add('hidden');
    empty.classList.remove('hidden');
    return;
  }

  grid.classList.remove('hidden');
  empty.classList.add('hidden');

  // 陶土色系标签配色
  const tagColors = [
    { bg: '#f5e6d8', text: '#8c5f3a', border: '#e8cdb3' },
    { bg: '#e3e7dd', text: '#4e6145', border: '#c8d1bd' },
    { bg: '#f5ddd4', text: '#8c4232', border: '#eab9a8' },
    { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
    { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
    { bg: '#e0e7ff', text: '#3730a3', border: '#a5b4fc' },
    { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' },
    { bg: '#d1fae5', text: '#065f46', border: '#6ee7b7' },
  ];

  grid.innerHTML = ideas.map(idea => {
    const created = idea.created_at ? new Date(idea.created_at).toLocaleDateString('zh-CN') : '-';
    const isConverted = idea.converted_to != null;
    const tags = idea.tags || [];
    const visibleTags = tags.slice(0, 2);
    const hiddenTagCount = tags.length - visibleTags.length;

    const tagsHtml = visibleTags.map((tag, idx) => {
      const color = tagColors[idx % tagColors.length];
      return `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium" style="background:${color.bg};color:${color.text};border:1px solid ${color.border}">${escapeHtml(tag)}</span>`;
    }).join('');
    const moreTagsHtml = hiddenTagCount > 0 ? `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-ink-100 text-ink-500">+${hiddenTagCount}</span>` : '';

    return `
      <div onclick="showIdeaViewModal('${escapeHtml(idea.id)}')" class="bg-white rounded-xl border border-ink-100 p-3.5 hover:shadow-md hover:border-ink-200 transition-all cursor-pointer group relative flex flex-col h-[168px]">
        ${isConverted ? '<div class="absolute top-2.5 right-2.5 px-1.5 py-0.5 bg-sage-100 text-sage-700 text-[10px] font-medium rounded">已转化</div>' : ''}
        <h3 class="font-display text-sm font-bold text-ink-800 mb-1.5 leading-snug line-clamp-2 ${isConverted ? 'pr-12' : ''}">${escapeHtml(idea.title || '无标题')}</h3>
        <p class="text-xs text-ink-500 line-clamp-3 mb-2 flex-1 leading-relaxed">${escapeHtml(idea.content || '')}</p>
        <div class="flex flex-wrap gap-1 mt-auto">
          ${tagsHtml}${moreTagsHtml}
        </div>
        <div class="flex items-center justify-between mt-2 pt-2 border-t border-ink-50">
          <span class="text-[10px] text-ink-400">${created}</span>
          <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onclick="event.stopPropagation(); showIdeaModal('${escapeHtml(idea.id)}')" class="p-1 rounded hover:bg-ink-100 text-ink-400 hover:text-ink-600" title="编辑">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M10.5 1.5l2 2-8 8H2.5v-2l8-8z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
            </button>
            ${!isConverted ? `
            <button onclick="event.stopPropagation(); openIdeaConvertModal('${escapeHtml(idea.id)}', 'draft')" class="p-1 rounded hover:bg-clay-100 text-ink-400 hover:text-clay-600" title="转草稿">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M8 1v5h5M8 6a5 5 0 1 1-5-5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button onclick="event.stopPropagation(); openIdeaConvertModal('${escapeHtml(idea.id)}', 'requirement')" class="p-1 rounded hover:bg-sage-100 text-ink-400 hover:text-sage-600" title="转需求">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M12 7L2 2v10l10-5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
            </button>
            ` : ''}
            <button onclick="event.stopPropagation(); deleteIdea('${escapeHtml(idea.id)}')" class="p-1 rounded hover:bg-rust-50 text-ink-400 hover:text-rust-500" title="删除">
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M2 3.5h10M4.5 3.5V2a1 1 0 011-1h3a1 1 0 011 1v1.5M5.5 6v5M8.5 6v5M3 3.5l1 9h6l1-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// 显示灵感弹窗（新建/编辑）
function showIdeaModal(ideaId = null) {
  const modal = document.getElementById('idea-modal');
  const titleEl = document.getElementById('idea-modal-title');

  editingIdea = ideaId ? currentData.ideas.find(i => i.id === ideaId) : null;

  if (editingIdea) {
    titleEl.textContent = '编辑灵感';
    document.getElementById('idea-id').value = editingIdea.id;
    document.getElementById('idea-title-input').value = editingIdea.title || '';
    document.getElementById('idea-content-input').value = editingIdea.content || '';
    document.getElementById('idea-tags-input').value = (editingIdea.tags || []).join(', ');
  } else {
    titleEl.textContent = '新建灵感';
    document.getElementById('idea-id').value = '';
    document.getElementById('idea-title-input').value = '';
    document.getElementById('idea-content-input').value = '';
    document.getElementById('idea-tags-input').value = '';
  }

  modal.classList.remove('hidden');
  setTimeout(() => document.getElementById('idea-title-input').focus(), 100);
}

function closeIdeaModal() {
  document.getElementById('idea-modal').classList.add('hidden');
  editingIdea = null;
}

// 保存灵感（新建/更新）
async function saveIdea() {
  const id = document.getElementById('idea-id').value;
  const title = document.getElementById('idea-title-input').value.trim();
  const content = document.getElementById('idea-content-input').value.trim();
  const tags = document.getElementById('idea-tags-input').value.split(',').map(t => t.trim()).filter(Boolean);

  if (!title) {
    showToast('请输入标题', 'error');
    return;
  }

  try {
    if (id) {
      const res = await fetch(`/api/ideas/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, tags })
      });
      if (!res.ok) throw new Error();
      showToast('灵感已更新');
    } else {
      const res = await fetch('/api/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, tags })
      });
      if (!res.ok) throw new Error();
      showToast('灵感已创建');
    }

    closeIdeaModal();
    await refreshData();
    renderIdeas();
  } catch (e) {
    showToast('保存失败', 'error');
  }
}

// 删除灵感
async function deleteIdea(ideaId) {
  if (!confirm('确定要删除此灵感吗？')) return;

  try {
    const res = await fetch(`/api/ideas/${ideaId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();

    await refreshData();
    renderIdeas();
    showToast('灵感已删除');
  } catch (e) {
    showToast('删除失败', 'error');
  }
}

// 打开转化弹窗
function openIdeaConvertModal(ideaId, mode) {
  const idea = currentData.ideas.find(i => i.id === ideaId);
  if (!idea) return;

  document.getElementById('convert-idea-id').value = ideaId;
  document.getElementById('convert-idea-mode').value = mode;
  document.getElementById('convert-idea-title').textContent = idea.title || '无标题';
  document.getElementById('convert-idea-desc').textContent = idea.content || '';

  const modalTitle = document.getElementById('idea-convert-modal-title');
  const plSection = document.getElementById('convert-idea-product-line-section');

  if (mode === 'draft') {
    modalTitle.textContent = '转草稿';
    plSection.classList.add('hidden');
  } else {
    modalTitle.textContent = '转需求';
    plSection.classList.remove('hidden');
    const productLines = getAllProductLines();
    const container = document.getElementById('convert-idea-product-lines');
    container.innerHTML = productLines.map(pl => {
      return `<label class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-ink-50 rounded-lg cursor-pointer hover:bg-ink-100 text-sm">
        <input type="checkbox" class="convert-idea-pl-cb w-4 h-4" value="${escapeHtml(pl)}">${escapeHtml(pl)}
      </label>`;
    }).join('') || '<span class="text-sm text-ink-400">暂无产品线</span>';
  }

  document.getElementById('idea-convert-modal').classList.remove('hidden');
}

function closeIdeaConvertModal() {
  document.getElementById('idea-convert-modal').classList.add('hidden');
}

let viewingIdeaId = null;

function showIdeaViewModal(ideaId) {
  const idea = currentData.ideas.find(i => i.id === ideaId);
  if (!idea) return;

  viewingIdeaId = ideaId;

  document.getElementById('view-idea-title').textContent = idea.title || '无标题';
  document.getElementById('view-idea-content').textContent = idea.content || '';
  document.getElementById('view-idea-id').textContent = idea.id;
  document.getElementById('view-idea-date').textContent = idea.created_at
    ? '创建于 ' + new Date(idea.created_at).toLocaleDateString('zh-CN')
    : '';

  // 标签
  const tagColors = [
    { bg: '#f5e6d8', text: '#8c5f3a', border: '#e8cdb3' },
    { bg: '#e3e7dd', text: '#4e6145', border: '#c8d1bd' },
    { bg: '#f5ddd4', text: '#8c4232', border: '#eab9a8' },
    { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
    { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
    { bg: '#e0e7ff', text: '#3730a3', border: '#a5b4fc' },
    { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' },
    { bg: '#d1fae5', text: '#065f46', border: '#6ee7b7' },
  ];
  const tagsHtml = (idea.tags || []).map((tag, idx) => {
    const color = tagColors[idx % tagColors.length];
    return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium" style="background:${color.bg};color:${color.text};border:1px solid ${color.border}">${escapeHtml(tag)}</span>`;
  }).join('');
  document.getElementById('view-idea-tags').innerHTML = tagsHtml;

  // 按钮事件绑定
  const isConverted = idea.converted_to != null;
  const editBtn = document.getElementById('view-idea-edit-btn');
  const draftBtn = document.getElementById('view-idea-draft-btn');
  const reqBtn = document.getElementById('view-idea-req-btn');
  const delBtn = document.getElementById('view-idea-delete-btn');

  editBtn.onclick = () => { closeIdeaViewModal(); showIdeaModal(ideaId); };
  draftBtn.onclick = () => { closeIdeaViewModal(); openIdeaConvertModal(ideaId, 'draft'); };
  draftBtn.style.display = isConverted ? 'none' : '';
  reqBtn.onclick = () => { closeIdeaViewModal(); openIdeaConvertModal(ideaId, 'requirement'); };
  reqBtn.style.display = isConverted ? 'none' : '';
  delBtn.onclick = () => { closeIdeaViewModal(); deleteIdea(ideaId); };

  document.getElementById('idea-view-modal').classList.remove('hidden');
}

function closeIdeaViewModal() {
  document.getElementById('idea-view-modal').classList.add('hidden');
  viewingIdeaId = null;
}

// 确认转化
async function confirmIdeaConvert() {
  const ideaId = document.getElementById('convert-idea-id').value;
  const mode = document.getElementById('convert-idea-mode').value;

  if (mode === 'draft') {
    await convertIdeaToDraft(ideaId);
  } else {
    await convertIdeaToRequirement(ideaId);
  }
}

// 灵感转草稿
async function convertIdeaToDraft(ideaId) {
  try {
    const res = await fetch(`/api/ideas/${ideaId}/convert-to-draft`, { method: 'POST' });
    const data = await res.json();

    if (res.ok) {
      closeIdeaConvertModal();
      await refreshData();
      renderIdeas();
      showToast(`已转为草稿 ${data.draftId}`);
    } else {
      showToast(data.error || '转化失败', 'error');
    }
  } catch (e) {
    showToast('转化失败', 'error');
  }
}

// 灵感转需求
async function convertIdeaToRequirement(ideaId) {
  const product_line = Array.from(document.querySelectorAll('#convert-idea-product-lines .convert-idea-pl-cb:checked')).map(cb => cb.value);

  if (product_line.length === 0) {
    showToast('请至少选择一个产品线', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/ideas/${ideaId}/convert-to-requirement`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_line })
    });
    const data = await res.json();

    if (res.ok) {
      closeIdeaConvertModal();
      await refreshData();
      renderIdeas();
      showToast(`已发布为 ${data.requirements.map(r => r.id).join(', ')}`);
    } else {
      showToast(data.error || '转化失败', 'error');
    }
  } catch (e) {
    showToast('转化失败', 'error');
  }
}
