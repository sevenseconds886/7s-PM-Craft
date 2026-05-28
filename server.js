const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { execSync } = require('child_process');

// 全局未捕获异常处理——记录完整堆栈后退出，防止数据损坏
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err.stack || err.message);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
  process.exit(1);
});

const app = express();
const PORT = process.env.PORT || 3456;
const WORKSPACE = path.resolve(__dirname);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(WORKSPACE, 'public')));
// 静态文件服务：products/ 和 archive/ 用于原型 iframe 访问
app.use('/products', express.static(path.join(WORKSPACE, 'products')));
app.use('/archive', express.static(path.join(WORKSPACE, 'archive')));
app.use('/drafts', express.static(path.join(WORKSPACE, 'drafts')));
app.use('/ideas', express.static(path.join(WORKSPACE, 'ideas')));

// 确保 ideas 目录存在
const ideasDir = path.join(WORKSPACE, 'ideas');
if (!fs.existsSync(ideasDir)) {
  fs.mkdirSync(ideasDir, { recursive: true });
}

// ============================================================================
// 错误码常量定义
// ============================================================================
const ERROR_CODES = {
  MAIN_PRODUCT_LINE_EMPTY: { code: 4001, message: 'main_product_line 不能为空' },
  TARGET_PRODUCT_LINE_NOT_EXIST: { code: 4002, message: '目标产品线物理文件夹不存在' },
  MAIN_PRODUCT_LINE_CHANGE_NOT_CONFIRMED: { code: 4003, message: '修改主产品线需要二次确认' }
};

// ============================================================================
// 工具函数：获取物理存在的产品线列表（products/ 下实际存在的文件夹）
// ============================================================================
function getPhysicalProductLines() {
  const productsDir = path.join(WORKSPACE, 'products');
  if (!fs.existsSync(productsDir)) return [];
  return fs.readdirSync(productsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

// ============================================================================
// 工具函数：统一处理新旧产品线格式
// 输入：从 YAML front matter 解析出的原始数据
// 输出：{ mainProductLine: string, relatedProductLines: string[], productLine: string[] }
//
// 兼容规则：
// 1. 新数据（有 main_product_line）：直接使用
// 2. 旧数据（只有 product_line）：第一个元素作为 main_product_line，其余作为 related_product_lines
// 3. product_line 为 string 时：转为单元素数组
// ============================================================================
function normalizeProductLines(data) {
  let mainProductLine = '';
  let relatedProductLines = [];
  let productLine = [];

  // 处理 product_line 字段（兼容 string/array）
  if (typeof data.product_line === 'string') {
    productLine = data.product_line ? [data.product_line] : [];
  } else if (Array.isArray(data.product_line)) {
    productLine = [...data.product_line];
  }

  // 新格式：有 main_product_line 字段
  if (data.main_product_line && typeof data.main_product_line === 'string') {
    mainProductLine = data.main_product_line;
    // related_product_lines 可能是 string 或 array
    if (typeof data.related_product_lines === 'string') {
      relatedProductLines = data.related_product_lines ? [data.related_product_lines] : [];
    } else if (Array.isArray(data.related_product_lines)) {
      relatedProductLines = [...data.related_product_lines];
    }
    // 确保 productLine 包含所有产品线（向后兼容）
    productLine = [mainProductLine, ...relatedProductLines.filter(pl => pl !== mainProductLine)];
  } else {
    // 旧格式：从 product_line 推导
    if (productLine.length > 0) {
      mainProductLine = productLine[0];
      relatedProductLines = productLine.slice(1);
    } else {
      mainProductLine = '未分类';
      productLine = ['未分类'];
    }
  }

  return { mainProductLine, relatedProductLines, productLine };
}

// ============================================================================
// 工具函数：构建同时包含新旧字段的 YAML front matter
// 写入文件时同时写入新旧字段，确保向后兼容
// ============================================================================
function buildFrontMatterWithProductLines(frontMatter) {
  const fm = { ...frontMatter };
  const { mainProductLine, relatedProductLines, productLine } = normalizeProductLines(fm);

  // 同时写入新旧字段
  fm.main_product_line = mainProductLine;
  if (relatedProductLines.length > 0) {
    fm.related_product_lines = relatedProductLines;
  } else {
    delete fm.related_product_lines;
  }
  fm.product_line = productLine;

  return fm;
}

// ============================================================================
// 工具函数：解析 requirement.md
// ============================================================================
function parseRequirement(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!match) return null;

  try {
    const frontMatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
    const body = match[2].trim();
    return { ...frontMatter, body, bodyPath: filePath };
  } catch (e) {
    console.error('解析 YAML 失败:', filePath, e.message);
    return null;
  }
}

// ============================================================================
// 工具函数：扫描所有需求
// ============================================================================
function scanRequirements() {
  const requirements = [];
  const productsDir = path.join(WORKSPACE, 'products');
  const archiveDir = path.join(WORKSPACE, 'archive');

  function scanDir(dir, isArchive = false) {
    if (!fs.existsSync(dir)) return;

    const productLines = fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory());

    for (const pl of productLines) {
      const plPath = path.join(dir, pl.name);
      if (!fs.existsSync(plPath)) continue;
      const entries = fs.readdirSync(plPath, { withFileTypes: true });
      const reqDirs = entries.filter(d => d.isDirectory() && d.name.startsWith('REQ-'));

      for (const reqDir of reqDirs) {
        const reqPath = path.join(plPath, reqDir.name);
        const reqFile = path.join(reqPath, 'requirement.md');

        if (fs.existsSync(reqFile)) {
          const req = parseRequirement(reqFile);
          if (req) {
            // 检查原型文件
            const hasWeb = fs.existsSync(path.join(reqPath, 'prototype-web.html'));
            const hasMobile = fs.existsSync(path.join(reqPath, 'prototype-mobile.html'));

            // 使用 normalizeProductLines 统一处理新旧格式
            const plInfo = normalizeProductLines(req);

            requirements.push({
              ...req,
              folderName: reqDir.name,
              mainProductLine: plInfo.mainProductLine,
              relatedProductLines: plInfo.relatedProductLines,
              productLine: plInfo.productLine,
              isArchive,
              hasPrototype: { web: hasWeb, mobile: hasMobile }
            });
          }
        }
      }
    }
  }

  scanDir(productsDir, false);
  scanDir(archiveDir, true);

  return requirements;
}

// ============================================================================
// 工具函数：扫描所有草稿（需求池）
// ============================================================================
function scanDrafts() {
  const drafts = [];
  const draftsDir = path.join(WORKSPACE, 'drafts');
  const existingFolderNames = new Set();

  if (!fs.existsSync(draftsDir)) {
    fs.mkdirSync(draftsDir, { recursive: true });
    return drafts;
  }

  // ========== 第一阶段：扫描 DRAFT-* 文件夹（v2.2.0+ 新格式） ==========
  const folders = fs.readdirSync(draftsDir, { withFileTypes: true })
    .filter(f => f.isDirectory() && /^DRAFT-\d+-.+$/.test(f.name));

  for (const folder of folders) {
    const folderPath = path.join(draftsDir, folder.name);
    existingFolderNames.add(folder.name);

    let draftFile = path.join(folderPath, 'requirement.md');
    if (!fs.existsSync(draftFile)) {
      draftFile = path.join(folderPath, 'draft.md');
    }

    if (!fs.existsSync(draftFile)) continue;

    try {
      const content = fs.readFileSync(draftFile, 'utf-8');
      const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

      if (match) {
        const frontMatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
        const prototypeFiles = fs.readdirSync(folderPath)
          .filter(f => f.endsWith('.html'));

        drafts.push({
          id: frontMatter.id || folder.name,
          title: frontMatter.title || folder.name,
          description: frontMatter.description || '',
          status: frontMatter.status || 'draft',
          priority: frontMatter.priority || 'medium',
          source: frontMatter.source || '',
          product_line: frontMatter.product_line || [],
          tags: frontMatter.tags || [],
          created_at: frontMatter.created_at,
          updated_at: frontMatter.updated_at,
          published_ids: frontMatter.published_ids || [],
          bodyPath: draftFile,
          folderPath: folderPath,
          prototypeFiles: prototypeFiles
        });
      }
    } catch (e) {
      console.error('解析草稿文件夹失败:', folder.name, e.message);
    }
  }

  // ========== 第二阶段：扫描旧格式 .md 文件（向后兼容） ==========
  const files = fs.readdirSync(draftsDir, { withFileTypes: true })
    .filter(f => f.isFile() && f.name.endsWith('.md') && /^DRAFT-\d+-.+\.md$/.test(f.name));

  for (const file of files) {
    const folderName = file.name.replace(/\.md$/, '');
    if (existingFolderNames.has(folderName)) {
      console.log(`跳过旧格式文件（已存在文件夹）: ${file.name}`);
      continue;
    }

    const filePath = path.join(draftsDir, file.name);

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

      if (match) {
        const frontMatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });

        drafts.push({
          id: frontMatter.id || file.name.replace(/\.md$/, ''),
          title: frontMatter.title || file.name.replace(/\.md$/, ''),
          description: frontMatter.description || '',
          status: frontMatter.status || 'draft',
          priority: frontMatter.priority || 'medium',
          source: frontMatter.source || '',
          product_line: frontMatter.product_line || [],
          tags: frontMatter.tags || [],
          created_at: frontMatter.created_at,
          updated_at: frontMatter.updated_at,
          published_ids: frontMatter.published_ids || [],
          bodyPath: filePath,
          folderPath: null,
          prototypeFiles: []
        });
      }
    } catch (e) {
      console.error('解析草稿文件失败:', file.name, e.message);
    }
  }

  return drafts;
}

// ============================================================================
// 工具函数：生成下一个可用草稿 ID
// ============================================================================
function getNextDraftId() {
  const drafts = scanDrafts();
  if (drafts.length === 0) return 'DRAFT-000001';

  const uniqueNums = new Set(drafts.map(d => {
    const match = (d.id || '').match(/DRAFT-(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }));

  const maxNum = Math.max(...uniqueNums);
  const nextNum = String(maxNum + 1).padStart(6, '0');
  return `DRAFT-${nextNum}`;
}

// ============================================================================
// 工具函数：扫描所有灵感
// ============================================================================
function scanIdeas() {
  const ideas = [];
  const ideasDir = path.join(WORKSPACE, 'ideas');

  if (!fs.existsSync(ideasDir)) {
    fs.mkdirSync(ideasDir, { recursive: true });
    return ideas;
  }

  const folders = fs.readdirSync(ideasDir, { withFileTypes: true })
    .filter(f => f.isDirectory() && /^IDEA-\d+-.+$/.test(f.name));

  for (const folder of folders) {
    const folderPath = path.join(ideasDir, folder.name);
    const ideaFile = path.join(folderPath, 'idea.md');

    if (!fs.existsSync(ideaFile)) continue;

    try {
      const content = fs.readFileSync(ideaFile, 'utf-8');
      const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

      if (match) {
        const frontMatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });

        ideas.push({
          id: frontMatter.id || folder.name,
          title: frontMatter.title || folder.name,
          content: frontMatter.content || '',
          tags: frontMatter.tags || [],
          created_at: frontMatter.created_at,
          updated_at: frontMatter.updated_at,
          converted_to: frontMatter.converted_to || null,
          bodyPath: ideaFile,
          folderPath: folderPath
        });
      }
    } catch (e) {
      console.error('解析灵感文件夹失败:', folder.name, e.message);
    }
  }

  return ideas;
}

// ============================================================================
// 工具函数：生成下一个可用灵感 ID
// ============================================================================
function getNextIdeaId() {
  const ideas = scanIdeas();
  if (ideas.length === 0) return 'IDEA-000001';

  const uniqueNums = new Set(ideas.map(i => {
    const match = (i.id || '').match(/IDEA-(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }));

  const maxNum = Math.max(...uniqueNums);
  const nextNum = String(maxNum + 1).padStart(6, '0');
  return `IDEA-${nextNum}`;
}

// ============================================================================
// 工具函数：读取迭代数据
// ============================================================================
function getSprints() {
  const sprintsFile = path.join(WORKSPACE, '.sprints.json');
  if (!fs.existsSync(sprintsFile)) return { sprints: [] };

  try {
    return JSON.parse(fs.readFileSync(sprintsFile, 'utf-8'));
  } catch (e) {
    return { sprints: [] };
  }
}

// ============================================================================
// 工具函数：读取设置
// ============================================================================
function getSettings() {
  const settingsFile = path.join(WORKSPACE, '.settings.json');
  const defaults = {
    statusList: ['设计中', '待评审', '开发中', '待验收', '已完成', '挂起'],
    priorityList: ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'],
    productLines: []
  };
  if (!fs.existsSync(settingsFile)) return defaults;

  try {
    const data = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    return { ...defaults, ...data };
  } catch (e) {
    return defaults;
  }
}

// ============================================================================
// 工具函数：保存设置
// ============================================================================
function saveSettings(settings) {
  const settingsFile = path.join(WORKSPACE, '.settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
}

// ============================================================================
// 工具函数：生成下一个可用 ID
// ============================================================================
function getNextReqId() {
  const requirements = scanRequirements();
  if (requirements.length === 0) return 'REQ-000001';

  const nums = requirements.map(r => {
    const match = r.id.match(/REQ-(\d{6})/);
    return match ? parseInt(match[1], 10) : 0;
  });

  const maxNum = Math.max(...nums);
  const nextNum = String(maxNum + 1).padStart(6, '0');
  return `REQ-${nextNum}`;
}

// ============================================================================
// 工具函数：从标题生成 slug
// ============================================================================
function generateSlug(title) {
  let slug = title
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

  if (!slug || slug === '-') {
    slug = 'new-' + Date.now();
  }

  let len = 0;
  let result = '';
  for (const c of slug) {
    len += c >= '\u4e00' && c <= '\u9fa5' ? 2 : 1;
    if (len <= 50) result += c;
    else break;
  }

  return result.replace(/-+$/, '') || 'new-requirement';
}

// ============================================================================
// 工具函数：创建产品线目录（含 .gitkeep）
// ============================================================================
function ensureProductLineDir(productLineName, baseDir = 'products') {
  const plDir = path.join(WORKSPACE, baseDir, productLineName);
  if (!fs.existsSync(plDir)) {
    fs.mkdirSync(plDir, { recursive: true });
    const gitkeepPath = path.join(plDir, '.gitkeep');
    if (!fs.existsSync(gitkeepPath)) {
      fs.writeFileSync(gitkeepPath, '');
    }
  }
  return plDir;
}

// ============================================================================
// API：Dashboard 统计（只返回有物理文件夹的产品线）
// ============================================================================
app.get('/api/stats', (req, res) => {
  try {
    const requirements = scanRequirements();
    const physicalPLs = getPhysicalProductLines();

    // 统计：总需求数（排除归档）
    let totalCount = 0;
    let archivedCount = 0;
    const statusCounts = {};
    const plCounts = {};

    // 初始化所有物理产品线的计数
    for (const pl of physicalPLs) {
      plCounts[pl] = 0;
    }

    for (const req of requirements) {
      if (req.isArchive) {
        archivedCount++;
        continue;
      }

      totalCount++;

      // 状态统计
      if (req.status) {
        statusCounts[req.status] = (statusCounts[req.status] || 0) + 1;
      }

      // 产品线统计（只统计物理存在的产品线）
      const mainPL = req.mainProductLine || (Array.isArray(req.productLine) ? req.productLine[0] : req.productLine);
      if (mainPL && physicalPLs.includes(mainPL)) {
        plCounts[mainPL] = (plCounts[mainPL] || 0) + 1;
      }
    }

    res.json({
      total: totalCount,
      archived: archivedCount,
      statusCounts,
      productLineCounts: plCounts,
      physicalProductLines: physicalPLs
    });
  } catch (err) {
    console.error('获取统计失败:', err);
    res.status(500).json({ error: '获取统计失败: ' + err.message });
  }
});

// ============================================================================
// API：创建新需求
// ============================================================================
app.post('/api/requirements', (req, res) => {
  try {
    const {
      title,
      productLine,
      priority = 'P2',
      platform = ['web'],
      developer = '',
      requester = '',
      due_date = ''
    } = req.body;

    // productLine 支持 string 或 array（前端兼容）
    const productLines = Array.isArray(productLine) ? productLine : (productLine ? [productLine] : []);

    if (!title || productLines.length === 0) {
      return res.status(400).json({ error: '标题和产品线为必填项' });
    }

    const id = getNextReqId();
    const slug = generateSlug(title);
    const folderName = `${id}-${slug}`;
    const today = new Date().toISOString().split('T')[0];

    // 取第一个产品线作为主产品线
    const mainProductLine = productLines[0];

    // 确保产品线目录存在（自动创建 + .gitkeep）
    const plDir = ensureProductLineDir(mainProductLine, 'products');

    // 创建需求文件夹
    const reqDir = path.join(plDir, folderName);
    if (fs.existsSync(reqDir)) {
      return res.status(400).json({ error: '需求文件夹已存在' });
    }

    fs.mkdirSync(reqDir, { recursive: true });

    // 构建 YAML front matter（同时写入新旧字段）
    const settings = getSettings();
    const frontMatter = buildFrontMatterWithProductLines({
      id,
      title,
      status: settings.statusList[0] || '设计中',
      priority,
      platform: Array.isArray(platform) ? platform : [platform],
      product_line: productLines,
      sprint: '',
      developer,
      requester,
      created: today,
      updated: today,
      due_date,
      tags: []
    });

    const body = `## 需求描述\n\n## 验收标准\n\n## 备注\n`;
    const content = `---\n${yaml.dump(frontMatter)}---\n${body}`;

    const reqFile = path.join(reqDir, 'requirement.md');
    fs.writeFileSync(reqFile, content, 'utf-8');

    res.json({ success: true, id, folderName, title });
  } catch (err) {
    console.error('创建需求失败:', err);
    res.status(500).json({ error: '创建失败: ' + err.message });
  }
});

// ============================================================================
// API：获取所有需求
// ============================================================================
app.get('/api/requirements', (req, res) => {
  const requirements = scanRequirements();
  res.json({ requirements });
});

// ============================================================================
// API：获取所有草稿（需求池）
// ============================================================================
app.get('/api/drafts', (req, res) => {
  const drafts = scanDrafts();
  res.json({ drafts });
});

// ============================================================================
// API：创建草稿（统一为需求草稿，移除 type 分类）
// ============================================================================
app.post('/api/drafts', (req, res) => {
  try {
    const {
      title,
      description = '',
      priority = 'medium',
      source = '',
      product_line = [],
      tags = []
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: '标题为必填项' });
    }

    const id = getNextDraftId();
    const today = new Date().toISOString();

    const slug = generateSlug(title);
    const folderName = `${id}-${slug}`;

    const draftsDir = path.join(WORKSPACE, 'drafts');
    if (!fs.existsSync(draftsDir)) {
      fs.mkdirSync(draftsDir, { recursive: true });
    }

    const folderPath = path.join(draftsDir, folderName);
    if (fs.existsSync(folderPath)) {
      return res.status(400).json({ error: '草稿已存在' });
    }
    fs.mkdirSync(folderPath, { recursive: true });

    const filePath = path.join(folderPath, 'draft.md');

    const frontMatter = {
      id,
      title: title.trim(),
      description,
      status: 'draft',
      priority,
      source,
      product_line: Array.isArray(product_line) ? product_line : [],
      tags,
      created_at: today,
      updated_at: today
    };

    const yamlStr = yaml.dump(frontMatter, { lineWidth: -1, quotingType: '"', forceQuotes: true });
    const body = `# ${title.trim()}\n\n${description}`;
    const content = `---\n${yamlStr}---\n${body}`;

    fs.writeFileSync(filePath, content, 'utf8');

    res.json({ success: true, id, path: folderName });
  } catch (err) {
    console.error('创建草稿失败:', err);
    res.status(500).json({ error: '创建失败: ' + err.message });
  }
});

// ============================================================================
// API：获取单个草稿
// ============================================================================
app.get('/api/drafts/:id', (req, res) => {
  const drafts = scanDrafts();
  const draft = drafts.find(d => d.id === req.params.id);

  if (!draft) {
    return res.status(404).json({ error: '草稿不存在' });
  }

  res.json(draft);
});

// ============================================================================
// API：更新草稿
// ============================================================================
app.put('/api/drafts/:id', (req, res) => {
  try {
    const drafts = scanDrafts();
    const draft = drafts.find(d => d.id === req.params.id);

    if (!draft) {
      return res.status(404).json({ error: '草稿不存在' });
    }

    const { title, description, priority, source, product_line, tags } = req.body;
    const today = new Date().toISOString();

    let content = fs.readFileSync(draft.bodyPath, 'utf-8');

    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (match) {
      const frontMatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }) || {};
      if (title) frontMatter.title = title;
      if (description !== undefined) frontMatter.description = description;
      if (priority) frontMatter.priority = priority;
      if (source !== undefined) frontMatter.source = source;
      if (product_line !== undefined) frontMatter.product_line = product_line;
      if (tags) frontMatter.tags = tags;
      frontMatter.updated_at = today;

      const newTitle = title || frontMatter.title || '无标题';
      const newDescription = description !== undefined ? description : frontMatter.description || '';
      const newBody = `# ${newTitle}\n\n${newDescription}`;
      content = `---\n${yaml.dump(frontMatter)}---\n${newBody}`;
    }

    fs.writeFileSync(draft.bodyPath, content, 'utf-8');

    res.json({ success: true, id: req.params.id });
  } catch (err) {
    console.error('更新草稿失败:', err);
    res.status(500).json({ error: '更新失败: ' + err.message });
  }
});

// ============================================================================
// API：更新草稿状态
// ============================================================================
app.post('/api/drafts/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    const drafts = scanDrafts();
    const draft = drafts.find(d => d.id === req.params.id);

    if (!draft) {
      return res.status(404).json({ error: '草稿不存在' });
    }

    const validStatuses = ['draft', 'in_progress', 'published', 'archived'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: '无效的状态值' });
    }

    const currentStatus = draft.status;
    if (status === 'published') {
      return res.status(400).json({ error: '请使用"发布"功能将草稿转为正式需求' });
    }
    if (currentStatus === 'published' && status !== 'archived') {
      return res.status(400).json({ error: '已发布的草稿只能归档' });
    }

    const content = fs.readFileSync(draft.bodyPath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (match) {
      const frontMatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }) || {};
      frontMatter.status = status;
      frontMatter.updated_at = new Date().toISOString();

      const newContent = `---\n${yaml.dump(frontMatter)}---\n${match[2]}`;
      fs.writeFileSync(draft.bodyPath, newContent, 'utf-8');

      res.json({ success: true, id: req.params.id, status });
    } else {
      res.status(500).json({ error: '文件格式错误' });
    }
  } catch (err) {
    console.error('更新草稿状态失败:', err);
    res.status(500).json({ error: '更新失败: ' + err.message });
  }
});

// ============================================================================
// API：发布草稿为正式需求（支持多产品线）
// ============================================================================
app.post('/api/drafts/:id/publish', (req, res) => {
  try {
    const { product_line = [] } = req.body;
    const drafts = scanDrafts();
    const draft = drafts.find(d => d.id === req.params.id);

    if (!draft) {
      return res.status(404).json({ error: '草稿不存在' });
    }

    const targetProductLines = Array.isArray(product_line) && product_line.length > 0
      ? product_line
      : (Array.isArray(draft.product_line) && draft.product_line.length > 0 ? draft.product_line : ['未分类']);

    const settings = getSettings();
    const results = [];

    for (const pl of targetProductLines) {
      const id = getNextReqId();
      const slug = generateSlug(draft.title || '无标题');
      const folderName = `${id}-${slug}`;
      const today = new Date().toISOString().split('T')[0];

      // 确保产品线目录存在
      const plDir = ensureProductLineDir(pl, 'products');

      const reqDir = path.join(plDir, folderName);
      if (fs.existsSync(reqDir)) {
        continue;
      }
      fs.mkdirSync(reqDir, { recursive: true });

      // 构建 YAML front matter（同时写入新旧字段）
      const frontMatter = buildFrontMatterWithProductLines({
        id,
        title: draft.title || '无标题',
        status: settings.statusList[0] || '设计中',
        priority: draft.priority || 'P2',
        platform: ['web'],
        product_line: [pl],
        sprint: '',
        developer: '',
        requester: '',
        created: today,
        updated: today,
        due_date: '',
        tags: draft.tags || [],
        draft_id: draft.id
      });

      const description = draft.description || '';
      const body = `## 需求描述\n\n${description}\n\n## 验收标准\n\n- [ ] 标准1\n\n## 备注\n`;
      const reqContent = `---\n${yaml.dump(frontMatter)}---\n${body}`;

      const reqFile = path.join(reqDir, 'requirement.md');
      fs.writeFileSync(reqFile, reqContent, 'utf-8');

      results.push({ id, product_line: pl, path: folderName });
    }

    // 更新草稿状态为 published
    const draftContent = fs.readFileSync(draft.bodyPath, 'utf-8');
    const match = draftContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (match) {
      const fm = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }) || {};
      fm.status = 'published';
      fm.published_ids = results.map(r => r.id);
      fm.updated_at = new Date().toISOString();
      const newDraftContent = `---\n${yaml.dump(fm)}---\n${match[2]}`;
      fs.writeFileSync(draft.bodyPath, newDraftContent, 'utf-8');
    }

    const firstResult = results[0];
    res.json({
      success: true,
      requirements: results,
      requirementId: firstResult ? firstResult.id : null
    });
  } catch (err) {
    console.error('发布草稿失败:', err);
    res.status(500).json({ error: '发布失败: ' + err.message });
  }
});

// ============================================================================
// API：删除草稿
// ============================================================================
app.delete('/api/drafts/:id', (req, res) => {
  try {
    const drafts = scanDrafts();
    const draft = drafts.find(d => d.id === req.params.id);

    if (!draft) {
      return res.status(404).json({ error: '草稿不存在' });
    }

    if (draft.folderPath && fs.existsSync(draft.folderPath)) {
      try {
        execSync(`rm -rf "${draft.folderPath}"`, { stdio: 'ignore', windowsHide: true });
      } catch (e) {
        fs.rmSync(draft.folderPath, { recursive: true, force: true });
      }
    } else if (draft.bodyPath && fs.existsSync(draft.bodyPath)) {
      fs.unlinkSync(draft.bodyPath);
    } else {
      return res.status(404).json({ error: '草稿文件不存在' });
    }

    res.json({ success: true, id: req.params.id });
  } catch (err) {
    console.error('删除草稿失败:', err);
    res.status(500).json({ error: '删除失败: ' + err.message });
  }
});

// ============================================================================
// API：获取灵感列表
// ============================================================================
app.get('/api/ideas', (req, res) => {
  const ideas = scanIdeas();
  res.json({ ideas });
});

// ============================================================================
// API：创建灵感
// ============================================================================
app.post('/api/ideas', (req, res) => {
  try {
    const { title, content = '', tags = [] } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ error: '标题为必填项' });
    }

    const id = getNextIdeaId();
    const today = new Date().toISOString();
    const slug = generateSlug(title);
    const folderName = `${id}-${slug}`;

    const ideasDir = path.join(WORKSPACE, 'ideas');
    if (!fs.existsSync(ideasDir)) {
      fs.mkdirSync(ideasDir, { recursive: true });
    }

    const folderPath = path.join(ideasDir, folderName);
    if (fs.existsSync(folderPath)) {
      return res.status(400).json({ error: '灵感已存在' });
    }
    fs.mkdirSync(folderPath, { recursive: true });

    const filePath = path.join(folderPath, 'idea.md');

    const frontMatter = {
      id,
      title: title.trim(),
      content,
      tags: Array.isArray(tags) ? tags : [],
      created_at: today,
      updated_at: today,
      converted_to: null
    };

    const yamlStr = yaml.dump(frontMatter, { lineWidth: -1, quotingType: '"', forceQuotes: true });
    const body = `# ${title.trim()}\n\n${content}`;
    const fileContent = `---\n${yamlStr}---\n${body}`;

    fs.writeFileSync(filePath, fileContent, 'utf8');

    res.json({ success: true, id, path: folderName });
  } catch (err) {
    console.error('创建灵感失败:', err);
    res.status(500).json({ error: '创建失败: ' + err.message });
  }
});

// ============================================================================
// API：获取单个灵感
// ============================================================================
app.get('/api/ideas/:id', (req, res) => {
  const ideas = scanIdeas();
  const idea = ideas.find(i => i.id === req.params.id);

  if (!idea) {
    return res.status(404).json({ error: '灵感不存在' });
  }

  res.json({ idea });
});

// ============================================================================
// API：更新灵感
// ============================================================================
app.put('/api/ideas/:id', (req, res) => {
  try {
    const ideas = scanIdeas();
    const idea = ideas.find(i => i.id === req.params.id);

    if (!idea) {
      return res.status(404).json({ error: '灵感不存在' });
    }

    const { title, content, tags } = req.body;
    const today = new Date().toISOString();

    let fileContent = fs.readFileSync(idea.bodyPath, 'utf-8');
    const match = fileContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (match) {
      const frontMatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }) || {};
      if (title) frontMatter.title = title;
      if (content !== undefined) frontMatter.content = content;
      if (tags) frontMatter.tags = tags;
      frontMatter.updated_at = today;

      const newTitle = title || frontMatter.title || '无标题';
      const newContent = content !== undefined ? content : frontMatter.content || '';
      const newBody = `# ${newTitle}\n\n${newContent}`;
      fileContent = `---\n${yaml.dump(frontMatter)}---\n${newBody}`;
    }

    // 如果标题变了，重命名文件夹
    if (title && title !== idea.title) {
      const oldFolderPath = idea.folderPath;
      const slug = generateSlug(title);
      const newFolderName = `${idea.id}-${slug}`;
      const newFolderPath = path.join(WORKSPACE, 'ideas', newFolderName);

      if (!fs.existsSync(newFolderPath)) {
        fs.mkdirSync(newFolderPath, { recursive: true });
        const newBodyPath = path.join(newFolderPath, 'idea.md');
        fs.writeFileSync(newBodyPath, fileContent, 'utf-8');

        // 删除旧文件夹
        try {
          execSync(`rmdir /S /Q "${oldFolderPath}"`, { stdio: 'ignore', windowsHide: true });
        } catch (e) {
          fs.rmSync(oldFolderPath, { recursive: true, force: true });
        }
        res.json({ success: true, id: req.params.id });
        return;
      }
    }

    fs.writeFileSync(idea.bodyPath, fileContent, 'utf-8');
    res.json({ success: true, id: req.params.id });
  } catch (err) {
    console.error('更新灵感失败:', err);
    res.status(500).json({ error: '更新失败: ' + err.message });
  }
});

// ============================================================================
// API：删除灵感
// ============================================================================
app.delete('/api/ideas/:id', (req, res) => {
  try {
    const ideas = scanIdeas();
    const idea = ideas.find(i => i.id === req.params.id);

    if (!idea) {
      return res.status(404).json({ error: '灵感不存在' });
    }

    if (idea.folderPath && fs.existsSync(idea.folderPath)) {
      try {
        execSync(`rmdir /S /Q "${idea.folderPath}"`, { stdio: 'ignore', windowsHide: true });
      } catch (e) {
        fs.rmSync(idea.folderPath, { recursive: true, force: true });
      }
    } else if (idea.bodyPath && fs.existsSync(idea.bodyPath)) {
      fs.unlinkSync(idea.bodyPath);
    }

    res.json({ success: true, id: req.params.id });
  } catch (err) {
    console.error('删除灵感失败:', err);
    res.status(500).json({ error: '删除失败: ' + err.message });
  }
});

// ============================================================================
// API：灵感转草稿
// ============================================================================
app.post('/api/ideas/:id/convert-to-draft', (req, res) => {
  try {
    const ideas = scanIdeas();
    const idea = ideas.find(i => i.id === req.params.id);

    if (!idea) {
      return res.status(404).json({ error: '灵感不存在' });
    }

    const draftId = getNextDraftId();
    const slug = generateSlug(idea.title || '无标题');
    const folderName = `${draftId}-${slug}`;
    const today = new Date().toISOString();

    const draftsDir = path.join(WORKSPACE, 'drafts');
    if (!fs.existsSync(draftsDir)) {
      fs.mkdirSync(draftsDir, { recursive: true });
    }

    const folderPath = path.join(draftsDir, folderName);
    fs.mkdirSync(folderPath, { recursive: true });

    const draftFrontMatter = {
      id: draftId,
      title: idea.title || '无标题',
      description: idea.content || '',
      status: 'draft',
      priority: 'medium',
      source: '灵感集',
      product_line: [],
      tags: idea.tags || [],
      created_at: today,
      updated_at: today,
      published_ids: []
    };

    const yamlStr = yaml.dump(draftFrontMatter, { lineWidth: -1, quotingType: '"', forceQuotes: true });
    const body = `# ${idea.title || '无标题'}\n\n${idea.content || ''}`;
    const draftContent = `---\n${yamlStr}---\n${body}`;

    fs.writeFileSync(path.join(folderPath, 'draft.md'), draftContent, 'utf-8');

    // 更新灵感的 converted_to 字段
    const ideaContent = fs.readFileSync(idea.bodyPath, 'utf-8');
    const ideaMatch = ideaContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (ideaMatch) {
      const ideaFM = yaml.load(ideaMatch[1], { schema: yaml.JSON_SCHEMA }) || {};
      ideaFM.converted_to = draftId;
      ideaFM.updated_at = today;
      const newIdeaContent = `---\n${yaml.dump(ideaFM)}---\n${ideaMatch[2]}`;
      fs.writeFileSync(idea.bodyPath, newIdeaContent, 'utf-8');
    }

    res.json({ success: true, draftId });
  } catch (err) {
    console.error('灵感转草稿失败:', err);
    res.status(500).json({ error: '转换失败: ' + err.message });
  }
});

// ============================================================================
// API：灵感转需求（直接发布）
// ============================================================================
app.post('/api/ideas/:id/convert-to-requirement', (req, res) => {
  try {
    const { product_line = [] } = req.body;
    const ideas = scanIdeas();
    const idea = ideas.find(i => i.id === req.params.id);

    if (!idea) {
      return res.status(404).json({ error: '灵感不存在' });
    }

    const targetProductLines = Array.isArray(product_line) && product_line.length > 0
      ? product_line
      : ['未分类'];

    const settings = getSettings();
    const today = new Date().toISOString().split('T')[0];
    const results = [];

    for (const pl of targetProductLines) {
      const id = getNextReqId();
      const slug = generateSlug(idea.title || '无标题');
      const folderName = `${id}-${slug}`;

      // 确保产品线目录存在
      const plDir = ensureProductLineDir(pl, 'products');

      const reqDir = path.join(plDir, folderName);
      if (fs.existsSync(reqDir)) {
        continue;
      }
      fs.mkdirSync(reqDir, { recursive: true });

      // 构建 YAML front matter
      const frontMatter = buildFrontMatterWithProductLines({
        id,
        title: idea.title || '无标题',
        status: settings.statusList[0] || '设计中',
        priority: 'P2',
        platform: ['web'],
        product_line: [pl],
        sprint: '',
        developer: '',
        requester: '',
        created: today,
        updated: today,
        due_date: '',
        tags: idea.tags || [],
        idea_id: idea.id
      });

      const description = idea.content || '';
      const body = `## 需求描述\n\n${description}\n\n## 验收标准\n\n- [ ] 标准1\n\n## 备注\n`;
      const reqContent = `---\n${yaml.dump(frontMatter)}---\n${body}`;

      const reqFile = path.join(reqDir, 'requirement.md');
      fs.writeFileSync(reqFile, reqContent, 'utf-8');

      results.push({ id, product_line: pl, path: folderName });
    }

    // 更新灵感的 converted_to 字段
    const ideaContent = fs.readFileSync(idea.bodyPath, 'utf-8');
    const ideaMatch = ideaContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (ideaMatch) {
      const ideaFM = yaml.load(ideaMatch[1], { schema: yaml.JSON_SCHEMA }) || {};
      ideaFM.converted_to = results.map(r => r.id).join(', ');
      ideaFM.updated_at = new Date().toISOString();
      const newIdeaContent = `---\n${yaml.dump(ideaFM)}---\n${ideaMatch[2]}`;
      fs.writeFileSync(idea.bodyPath, newIdeaContent, 'utf-8');
    }

    const firstResult = results[0];
    res.json({
      success: true,
      requirements: results,
      requirementId: firstResult ? firstResult.id : null
    });
  } catch (err) {
    console.error('灵感转需求失败:', err);
    res.status(500).json({ error: '转换失败: ' + err.message });
  }
});

// ============================================================================
// API：获取单个需求
// ============================================================================
app.get('/api/requirements/:id', (req, res) => {
  const requirements = scanRequirements();
  const requirement = requirements.find(r => r.id === req.params.id);

  if (!requirement) {
    return res.status(404).json({ error: '需求不存在' });
  }

  res.json(requirement);
});

// ============================================================================
// API：修改需求状态
// ============================================================================
app.post('/api/requirements/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    const requirements = scanRequirements();
    const requirement = requirements.find(r => r.id === req.params.id);

    if (!requirement) {
      return res.status(404).json({ error: '需求不存在' });
    }

    const content = fs.readFileSync(requirement.bodyPath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (match) {
      const frontMatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
      frontMatter.status = status;
      frontMatter.updated = new Date().toISOString().split('T')[0];

      // 同时更新新旧字段
      const updatedFM = buildFrontMatterWithProductLines(frontMatter);

      const newContent = `---\n${yaml.dump(updatedFM)}---\n${match[2]}`;
      fs.writeFileSync(requirement.bodyPath, newContent);

      res.json({ success: true, id: req.params.id, status });
    } else {
      res.status(500).json({ error: '文件格式错误' });
    }
  } catch (err) {
    console.error('修改状态失败:', err);
    res.status(500).json({ error: '修改失败: ' + err.message });
  }
});

// ============================================================================
// API：修改需求优先级
// ============================================================================
app.post('/api/requirements/:id/priority', (req, res) => {
  try {
    const { priority } = req.body;
    const requirements = scanRequirements();
    const requirement = requirements.find(r => r.id === req.params.id);

    if (!requirement) {
      return res.status(404).json({ error: '需求不存在' });
    }

    const content = fs.readFileSync(requirement.bodyPath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (match) {
      const frontMatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
      frontMatter.priority = priority;
      frontMatter.updated = new Date().toISOString().split('T')[0];

      const updatedFM = buildFrontMatterWithProductLines(frontMatter);

      const newContent = `---\n${yaml.dump(updatedFM)}---\n${match[2]}`;
      fs.writeFileSync(requirement.bodyPath, newContent);

      res.json({ success: true, id: req.params.id, priority });
    } else {
      res.status(500).json({ error: '文件格式错误' });
    }
  } catch (err) {
    console.error('修改优先级失败:', err);
    res.status(500).json({ error: '修改失败: ' + err.message });
  }
});

// ============================================================================
// API：修改需求迭代
// ============================================================================
app.post('/api/requirements/:id/sprint', (req, res) => {
  try {
    const { sprint } = req.body;
    const requirements = scanRequirements();
    const requirement = requirements.find(r => r.id === req.params.id);

    if (!requirement) {
      return res.status(404).json({ error: '需求不存在' });
    }

    const content = fs.readFileSync(requirement.bodyPath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (match) {
      const frontMatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
      frontMatter.sprint = sprint;
      frontMatter.updated = new Date().toISOString().split('T')[0];

      const updatedFM = buildFrontMatterWithProductLines(frontMatter);

      const newContent = `---\n${yaml.dump(updatedFM)}---\n${match[2]}`;
      fs.writeFileSync(requirement.bodyPath, newContent);

      res.json({ success: true, id: req.params.id, sprint });
    } else {
      res.status(500).json({ error: '文件格式错误' });
    }
  } catch (err) {
    console.error('修改迭代失败:', err);
    res.status(500).json({ error: '修改失败: ' + err.message });
  }
});

// ============================================================================
// API：修改需求预计上线时间
// ============================================================================
app.post('/api/requirements/:id/due_date', (req, res) => {
  try {
    const { due_date } = req.body;
    const requirements = scanRequirements();
    const requirement = requirements.find(r => r.id === req.params.id);

    if (!requirement) {
      return res.status(404).json({ error: '需求不存在' });
    }

    const content = fs.readFileSync(requirement.bodyPath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (match) {
      const frontMatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
      frontMatter.due_date = due_date;
      frontMatter.updated = new Date().toISOString().split('T')[0];

      const updatedFM = buildFrontMatterWithProductLines(frontMatter);

      const newContent = `---\n${yaml.dump(updatedFM)}---\n${match[2]}`;
      fs.writeFileSync(requirement.bodyPath, newContent);

      res.json({ success: true, id: req.params.id, due_date });
    } else {
      res.status(500).json({ error: '文件格式错误' });
    }
  } catch (err) {
    console.error('修改预计上线时间失败:', err);
    res.status(500).json({ error: '修改失败: ' + err.message });
  }
});

// ============================================================================
// API：修改需求文档内容（自动保存历史版本）
// ============================================================================
app.post('/api/requirements/:id/content', (req, res) => {
  try {
    const { content } = req.body;
    const requirements = scanRequirements();
    const requirement = requirements.find(r => r.id === req.params.id);

    if (!requirement) {
      return res.status(404).json({ error: '需求不存在' });
    }

    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content 必须为字符串' });
    }

    const fileContent = fs.readFileSync(requirement.bodyPath, 'utf-8');
    const match = fileContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (match) {
      const frontMatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
      frontMatter.updated = new Date().toISOString().split('T')[0];

      const updatedFM = buildFrontMatterWithProductLines(frontMatter);

      const newContent = `---\n${yaml.dump(updatedFM)}---\n${content}`;

      // 保存历史版本
      const reqDir = path.dirname(requirement.bodyPath);
      const historyDir = path.join(reqDir, '.history');
      if (!fs.existsSync(historyDir)) {
        fs.mkdirSync(historyDir, { recursive: true });
      }
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const historyFile = path.join(historyDir, `${timestamp}.md`);
      fs.writeFileSync(historyFile, fileContent, 'utf-8');

      fs.writeFileSync(requirement.bodyPath, newContent);

      res.json({ success: true, id: req.params.id });
    } else {
      res.status(500).json({ error: '文件格式错误' });
    }
  } catch (err) {
    console.error('保存文档失败:', err);
    res.status(500).json({ error: '保存失败: ' + err.message });
  }
});

// ============================================================================
// API：获取需求文档版本历史列表
// ============================================================================
app.get('/api/requirements/:id/history', (req, res) => {
  try {
    const requirements = scanRequirements();
    const requirement = requirements.find(r => r.id === req.params.id);

    if (!requirement) {
      return res.status(404).json({ error: '需求不存在' });
    }

    const reqDir = path.dirname(requirement.bodyPath);
    const historyDir = path.join(reqDir, '.history');

    if (!fs.existsSync(historyDir)) {
      return res.json({ versions: [] });
    }

    const files = fs.readdirSync(historyDir)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const filePath = path.join(historyDir, f);
        const stats = fs.statSync(filePath);
        const timestamp = f.replace('.md', '');
        return { timestamp, filename: f, size: stats.size, created: stats.birthtime };
      })
      .sort((a, b) => b.created - a.created);

    res.json({ versions: files });
  } catch (err) {
    console.error('获取版本历史失败:', err);
    res.status(500).json({ error: '获取版本历史失败: ' + err.message });
  }
});

// ============================================================================
// API：获取指定版本的文档内容
// ============================================================================
app.get('/api/requirements/:id/history/:timestamp', (req, res) => {
  try {
    const requirements = scanRequirements();
    const requirement = requirements.find(r => r.id === req.params.id);

    if (!requirement) {
      return res.status(404).json({ error: '需求不存在' });
    }

    const reqDir = path.dirname(requirement.bodyPath);
    const historyDir = path.join(reqDir, '.history');
    const historyFile = path.join(historyDir, `${req.params.timestamp}.md`);

    if (!fs.existsSync(historyFile)) {
      return res.status(404).json({ error: '版本不存在' });
    }

    const content = fs.readFileSync(historyFile, 'utf-8');
    const stats = fs.statSync(historyFile);

    res.json({
      timestamp: req.params.timestamp,
      content,
      size: stats.size,
      created: stats.birthtime
    });
  } catch (err) {
    console.error('获取版本内容失败:', err);
    res.status(500).json({ error: '获取版本内容失败: ' + err.message });
  }
});

// ============================================================================
// API：归档需求
// ============================================================================
app.post('/api/requirements/:id/archive', (req, res) => {
  try {
    const requirements = scanRequirements();
    const requirement = requirements.find(r => r.id === req.params.id);

    if (!requirement) {
      return res.status(404).json({ error: '需求不存在' });
    }

    // 使用 mainProductLine 决定归档位置（保持主产品线不变）
    const sourceDir = path.dirname(requirement.bodyPath);
    const primaryProductLine = requirement.mainProductLine ||
      (Array.isArray(requirement.productLine) ? requirement.productLine[0] : requirement.productLine);
    const targetDir = path.join(WORKSPACE, 'archive', primaryProductLine, requirement.folderName);

    if (fs.existsSync(targetDir)) {
      return res.status(400).json({ error: '该需求已被归档，请勿重复操作' });
    }

    // 确保 archive 产品线目录存在
    const archivePlDir = path.join(WORKSPACE, 'archive', primaryProductLine);
    if (!fs.existsSync(archivePlDir)) {
      fs.mkdirSync(archivePlDir, { recursive: true });
    }

    // 先移动文件夹
    fs.renameSync(sourceDir, targetDir);

    // 移动成功后更新状态
    const newBodyPath = path.join(targetDir, 'requirement.md');
    const content = fs.readFileSync(newBodyPath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (match) {
      const frontMatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
      frontMatter.status = '已完成';
      frontMatter.updated = new Date().toISOString().split('T')[0];

      const updatedFM = buildFrontMatterWithProductLines(frontMatter);

      const newContent = `---\n${yaml.dump(updatedFM)}---\n${match[2]}`;
      fs.writeFileSync(newBodyPath, newContent);
    }

    res.json({ success: true, id: req.params.id });
  } catch (err) {
    console.error('归档需求失败:', err);
    res.status(500).json({ error: '归档失败: ' + err.message });
  }
});

// ============================================================================
// API：回退归档需求（从 archive 移回 products，清除迭代）
// ============================================================================
app.post('/api/requirements/:id/unarchive', (req, res) => {
  try {
    const archiveDir = path.join(WORKSPACE, 'archive');
    let foundReq = null;
    let foundSourceDir = null;
    let foundProductLine = null;

    if (fs.existsSync(archiveDir)) {
      const plDirs = fs.readdirSync(archiveDir, { withFileTypes: true }).filter(d => d.isDirectory());
      for (const plD of plDirs) {
        const plPath = path.join(archiveDir, plD.name);
        const entries = fs.readdirSync(plPath, { withFileTypes: true })
          .filter(d => d.isDirectory() && d.name.startsWith('REQ-'));
        for (const entry of entries) {
          const reqDir = path.join(plPath, entry.name);
          const reqFile = path.join(reqDir, 'requirement.md');
          if (!fs.existsSync(reqFile)) continue;
          try {
            const content = fs.readFileSync(reqFile, 'utf-8');
            const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
            if (match) {
              const fm = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
              if (fm.id === req.params.id) {
                foundReq = fm;
                foundSourceDir = reqDir;
                foundProductLine = plD.name;
                break;
              }
            }
          } catch (e) {}
        }
        if (foundReq) break;
      }
    }

    if (!foundReq || !foundSourceDir) {
      return res.status(404).json({ error: '归档需求不存在' });
    }

    const folderName = path.basename(foundSourceDir);
    const productsPlDir = path.join(WORKSPACE, 'products', foundProductLine);
    let targetProductLine = foundProductLine;
    if (!fs.existsSync(productsPlDir)) {
      targetProductLine = '未分类';
    }
    const targetDir = path.join(WORKSPACE, 'products', targetProductLine, folderName);

    const targetPlDir = path.join(WORKSPACE, 'products', targetProductLine);
    if (!fs.existsSync(targetPlDir)) {
      fs.mkdirSync(targetPlDir, { recursive: true });
      const gitkeepPath = path.join(targetPlDir, '.gitkeep');
      if (!fs.existsSync(gitkeepPath)) {
        fs.writeFileSync(gitkeepPath, '');
      }
    }

    if (fs.existsSync(targetDir)) {
      return res.status(400).json({ error: '目标位置已存在同名需求' });
    }

    try {
      execSync(`xcopy "${foundSourceDir}" "${targetDir}" /E /I /Y /Q`, { stdio: 'pipe', windowsHide: true });
      execSync(`rmdir /S /Q "${foundSourceDir}"`, { stdio: 'pipe', windowsHide: true });
    } catch (e) {
      return res.status(500).json({ error: '文件移动失败: ' + e.message });
    }

    // 更新需求元数据
    const newReqFile = path.join(targetDir, 'requirement.md');
    const content = fs.readFileSync(newReqFile, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (match) {
      const frontMatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
      frontMatter.status = '设计中';
      delete frontMatter.sprint;

      // 如果产品线变了，更新 product_line
      if (targetProductLine !== foundProductLine) {
        let pls = frontMatter.product_line;
        if (typeof pls === 'string') pls = [pls];
        if (Array.isArray(pls)) {
          frontMatter.product_line = pls.map(pl => pl === foundProductLine ? targetProductLine : pl);
        } else {
          frontMatter.product_line = [targetProductLine];
        }
      }

      frontMatter.updated = new Date().toISOString().split('T')[0];

      const updatedFM = buildFrontMatterWithProductLines(frontMatter);

      const newContent = `---\n${yaml.dump(updatedFM)}---\n${match[2]}`;
      fs.writeFileSync(newReqFile, newContent);
    }

    res.json({ success: true, id: req.params.id, productLine: targetProductLine });
  } catch (err) {
    console.error('回退归档需求失败:', err);
    res.status(500).json({ error: '回退失败: ' + err.message });
  }
});

// ============================================================================
// 工具函数：校验并补全需求的 YAML front matter
// ============================================================================
function validateAndFixFrontMatter(fm, settings, today) {
  const fixed = { ...fm };

  if (!fixed.id || !/^REQ-\d{6}$/.test(String(fixed.id))) {
    fixed.id = null;
  }

  if (!fixed.title || typeof fixed.title !== 'string' || !fixed.title.trim()) {
    fixed.title = null;
  }

  if (!settings.statusList.includes(fixed.status)) {
    fixed.status = settings.statusList[0] || '设计中';
  }

  if (!settings.priorityList.includes(fixed.priority)) {
    fixed.priority = 'P2';
  }

  // product_line：必须是数组
  if (typeof fixed.product_line === 'string') {
    fixed.product_line = fixed.product_line ? [fixed.product_line] : [];
  } else if (!Array.isArray(fixed.product_line)) {
    fixed.product_line = [];
  }

  // 同步处理 main_product_line 和 related_product_lines
  const plInfo = normalizeProductLines(fixed);
  fixed.main_product_line = plInfo.mainProductLine;
  if (plInfo.relatedProductLines.length > 0) {
    fixed.related_product_lines = plInfo.relatedProductLines;
  }
  fixed.product_line = plInfo.productLine;

  if (typeof fixed.platform === 'string') {
    fixed.platform = fixed.platform ? [fixed.platform] : ['web'];
  } else if (!Array.isArray(fixed.platform)) {
    fixed.platform = ['web'];
  }

  if (!Array.isArray(fixed.tags)) {
    fixed.tags = [];
  }

  if (typeof fixed.sprint !== 'string') {
    fixed.sprint = '';
  }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!fixed.created || !dateRe.test(String(fixed.created))) {
    fixed.created = today;
  }
  if (!fixed.updated || !dateRe.test(String(fixed.updated))) {
    fixed.updated = today;
  }

  if (typeof fixed.developer !== 'string') fixed.developer = '';
  if (typeof fixed.requester !== 'string') fixed.requester = '';
  if (!fixed.due_date || !dateRe.test(String(fixed.due_date))) fixed.due_date = '';

  return fixed;
}

// ============================================================================
// API：导入外部产物（requirement.md 内容）
// ============================================================================
app.post('/api/requirements/import', (req, res) => {
  try {
    const { content, options = {} } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'content 必须为非空字符串' });
    }

    const settings = getSettings();
    const today = new Date().toISOString().split('T')[0];

    let frontMatter = {};
    let body = content;

    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (fmMatch) {
      try {
        frontMatter = yaml.load(fmMatch[1], { schema: yaml.JSON_SCHEMA }) || {};
      } catch (e) {
        frontMatter = {};
      }
      body = fmMatch[2].trim();
    }

    if (options && typeof options === 'object') {
      Object.assign(frontMatter, options);
    }

    if (!frontMatter.title || !String(frontMatter.title).trim()) {
      const h1Match = body.match(/^#\s+(.+)$/m);
      frontMatter.title = h1Match ? h1Match[1].trim() : '无标题';
    }

    const fixed = validateAndFixFrontMatter(frontMatter, settings, today);

    if (!fixed.id) {
      fixed.id = getNextReqId();
    } else {
      const existing = scanRequirements();
      const idTaken = existing.some(r => r.id === fixed.id);
      if (idTaken) {
        fixed.id = getNextReqId();
      }
    }

    const primaryProductLine = fixed.main_product_line ||
      (fixed.product_line && fixed.product_line.length > 0 ? fixed.product_line[0] : '未分类');

    if (!fixed.product_line || fixed.product_line.length === 0) {
      fixed.product_line = [primaryProductLine];
    }

    const slug = generateSlug(fixed.title);
    const folderName = `${fixed.id}-${slug}`;
    const plDir = ensureProductLineDir(primaryProductLine, 'products');
    const reqDir = path.join(plDir, folderName);

    if (fs.existsSync(reqDir)) {
      return res.status(409).json({ error: `需求文件夹已存在: ${folderName}` });
    }

    fs.mkdirSync(reqDir, { recursive: true });

    const finalBody = body || '## 需求描述\n\n## 验收标准\n\n## 备注\n';
    const fileContent = `---\n${yaml.dump(fixed)}---\n${finalBody}`;
    const reqFile = path.join(reqDir, 'requirement.md');
    fs.writeFileSync(reqFile, fileContent, 'utf-8');

    res.json({
      success: true,
      id: fixed.id,
      path: path.relative(WORKSPACE, reqFile).replace(/\\/g, '/'),
      title: fixed.title,
      productLine: fixed.product_line,
      fixedFields: Object.keys(options)
    });
  } catch (err) {
    console.error('导入需求失败:', err);
    res.status(500).json({ error: '导入失败: ' + err.message });
  }
});

// ============================================================================
// API：导入原型文件到已有需求
// ============================================================================
app.post('/api/requirements/:id/prototype/import', (req, res) => {
  try {
    const { content, platform } = req.body;
    const { id } = req.params;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'content 必须为非空字符串' });
    }

    const validPlatforms = ['web', 'mobile'];
    const targetPlatform = validPlatforms.includes(platform) ? platform : 'web';

    const requirements = scanRequirements();
    const requirement = requirements.find(r => r.id === id);

    if (!requirement) {
      return res.status(404).json({ error: `需求 ${id} 不存在` });
    }

    const reqDir = path.dirname(requirement.bodyPath);
    const protoFileName = `prototype-${targetPlatform}.html`;
    const protoPath = path.join(reqDir, protoFileName);

    let finalContent = content;
    const metaTag = `<meta name="pm-craft-requirement-id" content="${id}">`;
    if (finalContent.includes('<head>') && !finalContent.includes('pm-craft-requirement-id')) {
      finalContent = finalContent.replace('<head>', `<head>\n  ${metaTag}`);
    }

    fs.writeFileSync(protoPath, finalContent, 'utf-8');

    res.json({
      success: true,
      id,
      platform: targetPlatform,
      path: path.relative(WORKSPACE, protoPath).replace(/\\/g, '/'),
      overwritten: requirement.hasPrototype[targetPlatform]
    });
  } catch (err) {
    console.error('导入原型失败:', err);
    res.status(500).json({ error: '导入失败: ' + err.message });
  }
});

// ============================================================================
// API：获取迭代列表
// ============================================================================
app.get('/api/sprints', (req, res) => {
  const sprints = getSprints();
  res.json(sprints);
});

// ============================================================================
// API：创建迭代
// ============================================================================
app.post('/api/sprints', (req, res) => {
  try {
    const { name } = req.body;
    const sprintsData = getSprints();

    if (sprintsData.sprints.find(s => s.name === name)) {
      return res.status(400).json({ error: '迭代已存在' });
    }

    sprintsData.sprints.push({
      name,
      status: 'active',
      created: new Date().toISOString().split('T')[0],
      closed: null
    });

    fs.writeFileSync(
      path.join(WORKSPACE, '.sprints.json'),
      JSON.stringify(sprintsData, null, 2)
    );

    res.json({ success: true, sprint: name });
  } catch (err) {
    console.error('创建迭代失败:', err);
    res.status(500).json({ error: '创建失败: ' + err.message });
  }
});

// ============================================================================
// API：关闭迭代
// ============================================================================
app.post('/api/sprints/:name/close', (req, res) => {
  try {
    const sprintsData = getSprints();
    const sprint = sprintsData.sprints.find(s => s.name === req.params.name);

    if (!sprint) {
      return res.status(404).json({ error: '迭代不存在' });
    }

    sprint.status = 'closed';
    sprint.closed = new Date().toISOString().split('T')[0];

    fs.writeFileSync(
      path.join(WORKSPACE, '.sprints.json'),
      JSON.stringify(sprintsData, null, 2)
    );

    res.json({ success: true, sprint: req.params.name });
  } catch (err) {
    console.error('关闭迭代失败:', err);
    res.status(500).json({ error: '关闭失败: ' + err.message });
  }
});

// ============================================================================
// API：归档迭代（关闭迭代 + 归档所有需求）
// ============================================================================
app.post('/api/sprints/:name/archive', (req, res) => {
  try {
    const sprintsData = getSprints();
    const sprint = sprintsData.sprints.find(s => s.name === req.params.name);

    if (!sprint) {
      return res.status(404).json({ error: '迭代不存在' });
    }

    sprint.status = 'closed';
    sprint.closed = new Date().toISOString().split('T')[0];
    fs.writeFileSync(
      path.join(WORKSPACE, '.sprints.json'),
      JSON.stringify(sprintsData, null, 2)
    );

    const requirements = scanRequirements();
    let archivedCount = 0;
    const failedItems = [];

    for (const requirement of requirements) {
      if (requirement.sprint === req.params.name && !requirement.isArchive) {
        const sourceDir = path.dirname(requirement.bodyPath);
        const primaryProductLine = requirement.mainProductLine ||
          (Array.isArray(requirement.productLine) ? requirement.productLine[0] : requirement.productLine);
        const targetDir = path.join(WORKSPACE, 'archive', primaryProductLine, requirement.folderName);

        try {
          const archivePlDir = path.join(WORKSPACE, 'archive', primaryProductLine);
          if (!fs.existsSync(archivePlDir)) {
            fs.mkdirSync(archivePlDir, { recursive: true });
          }

          fs.renameSync(sourceDir, targetDir);

          const newBodyPath = path.join(targetDir, 'requirement.md');
          const content = fs.readFileSync(newBodyPath, 'utf-8');
          const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

          if (match) {
            const fm = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
            fm.status = '已完成';
            fm.updated = new Date().toISOString().split('T')[0];

            const updatedFM = buildFrontMatterWithProductLines(fm);

            const newContent = `---\n${yaml.dump(updatedFM)}---\n${match[2]}`;
            fs.writeFileSync(newBodyPath, newContent);
          }

          archivedCount++;
        } catch (moveErr) {
          failedItems.push({ id: requirement.id, error: moveErr.message });
        }
      }
    }

    res.json({ success: true, sprint: req.params.name, archivedCount, failedItems: failedItems.length > 0 ? failedItems : undefined });
  } catch (err) {
    console.error('归档迭代失败:', err);
    res.status(500).json({ error: '归档失败: ' + err.message });
  }
});

// ============================================================================
// API：获取设置
// ============================================================================
app.get('/api/settings', (req, res) => {
  const settings = getSettings();
  res.json(settings);
});

// ============================================================================
// API：创建产品线（创建目录 + 保存到 settings）
// ============================================================================
app.post('/api/product-lines', (req, res) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: '产品线名称不能为空' });
    }

    const settings = getSettings();
    const productLines = settings.productLines || [];

    if (productLines.includes(name)) {
      return res.status(400).json({ error: '产品线已存在' });
    }

    // 确保 products 目录下有该产品线目录
    ensureProductLineDir(name, 'products');

    // 保存到 settings
    settings.productLines = [...productLines, name];
    saveSettings(settings);

    res.json({ success: true, name, productLines: settings.productLines });
  } catch (err) {
    console.error('创建产品线失败:', err);
    res.status(500).json({ error: '创建失败: ' + err.message });
  }
});

// ============================================================================
// API：删除产品线（需求归入"未分类"）
// ============================================================================
app.delete('/api/product-lines/:name', async (req, res) => {
  try {
    const { name } = req.params;
    if (name === '未分类') {
      return res.status(400).json({ error: '不能删除「未分类」' });
    }
    const settings = getSettings();
    const productLines = settings.productLines || [];

    function safeMoveDir(srcDir, dstDir) {
      try {
        execSync(`xcopy "${srcDir}" "${dstDir}" /E /I /Y /Q`, { stdio: 'pipe', windowsHide: true });
        execSync(`rmdir /S /Q "${srcDir}"`, { stdio: 'pipe', windowsHide: true });
        return true;
      } catch (e) {
        console.error(`safeMoveDir 失败: ${srcDir} → ${dstDir}`, e.message);
        return false;
      }
    }

    function updateReqProductLine(reqDir, oldName, newName) {
      const reqFile = path.join(reqDir, 'requirement.md');
      if (!fs.existsSync(reqFile)) return;
      try {
        const content = fs.readFileSync(reqFile, 'utf-8');
        const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (match) {
          const frontMatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
          let pls = frontMatter.product_line;
          if (typeof pls === 'string') pls = [pls];
          if (Array.isArray(pls)) {
            frontMatter.product_line = pls.map(pl => pl === oldName ? newName : pl);
          } else {
            frontMatter.product_line = [newName];
          }
          frontMatter.updated = new Date().toISOString().split('T')[0];

          const updatedFM = buildFrontMatterWithProductLines(frontMatter);

          const newContent = `---\n${yaml.dump(updatedFM)}---\n${match[2]}`;
          fs.writeFileSync(reqFile, newContent);
        }
      } catch (yamlErr) {
        console.error(`更新 ${reqDir} 的 product_line 失败:`, yamlErr.message);
      }
    }

    let movedCount = 0;
    const plDir = path.join(WORKSPACE, 'products', name);
    const archivePlDir = path.join(WORKSPACE, 'archive', name);

    if (fs.existsSync(plDir)) {
      const uncategorizedDir = ensureProductLineDir('未分类', 'products');

      const entries = fs.readdirSync(plDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name.startsWith('REQ-'));

      for (const entry of entries) {
        const srcPath = path.join(plDir, entry.name);
        const dstPath = path.join(uncategorizedDir, entry.name);
        if (fs.existsSync(dstPath)) continue;
        updateReqProductLine(srcPath, name, '未分类');
        if (safeMoveDir(srcPath, dstPath)) {
          movedCount++;
        }
      }

      try {
        execSync(`rmdir /S /Q "${plDir}"`, { stdio: 'pipe', windowsHide: true });
      } catch (e) {}
    }

    if (fs.existsSync(archivePlDir)) {
      const archiveUncategorized = ensureProductLineDir('未分类', 'archive');

      const archiveEntries = fs.readdirSync(archivePlDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name.startsWith('REQ-'));

      for (const entry of archiveEntries) {
        const srcPath = path.join(archivePlDir, entry.name);
        const dstPath = path.join(archiveUncategorized, entry.name);
        if (fs.existsSync(dstPath)) continue;
        updateReqProductLine(srcPath, name, '未分类');
        if (safeMoveDir(srcPath, dstPath)) {
          movedCount++;
        }
      }

      try {
        execSync(`rmdir /S /Q "${archivePlDir}"`, { stdio: 'pipe', windowsHide: true });
      } catch (e) {}
    }

    // 扫描所有需求，更新引用该产品线的元数据
    const scanDirs = [
      { base: path.join(WORKSPACE, 'products'), reqDirs: [] },
      { base: path.join(WORKSPACE, 'archive'), reqDirs: [] }
    ];
    for (const scan of scanDirs) {
      if (!fs.existsSync(scan.base)) continue;
      const plDirs = fs.readdirSync(scan.base, { withFileTypes: true }).filter(d => d.isDirectory());
      for (const plD of plDirs) {
        const plPath = path.join(scan.base, plD.name);
        try {
          const entries = fs.readdirSync(plPath, { withFileTypes: true })
            .filter(d => d.isDirectory() && d.name.startsWith('REQ-'));
          for (const entry of entries) {
            const reqDir = path.join(plPath, entry.name);
            const reqFile = path.join(reqDir, 'requirement.md');
            if (!fs.existsSync(reqFile)) continue;
            try {
              const content = fs.readFileSync(reqFile, 'utf-8');
              const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
              if (match) {
                const frontMatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
                let pls = frontMatter.product_line;
                if (typeof pls === 'string') pls = [pls];
                if (Array.isArray(pls) && pls.includes(name)) {
                  frontMatter.product_line = pls.map(pl => pl === name ? '未分类' : pl);
                  frontMatter.updated = new Date().toISOString().split('T')[0];

                  const updatedFM = buildFrontMatterWithProductLines(frontMatter);

                  const newContent = `---\n${yaml.dump(updatedFM)}---\n${match[2]}`;
                  fs.writeFileSync(reqFile, newContent);
                  movedCount++;
                }
              }
            } catch (e) {}
          }
        } catch (e) {}
      }
    }

    settings.productLines = productLines.filter(pl => pl !== name);
    if (!settings.productLines.includes('未分类') && movedCount > 0) {
      settings.productLines.push('未分类');
    }
    saveSettings(settings);

    res.json({ success: true, deletedProductLine: name, movedCount, productLines: settings.productLines });
  } catch (err) {
    console.error('删除产品线失败:', err);
    res.status(500).json({ error: '删除失败: ' + err.message });
  }
});

// ============================================================================
// API：修改需求产品线（含物理文件夹迁移）
// 支持前端传参格式：{ product_line: string[] }（兼容旧格式）
// ============================================================================
app.post('/api/requirements/:id/product-line', (req, res) => {
  try {
    const { id } = req.params;
    const { product_line, main_product_line, related_product_lines, confirmed } = req.body;

    // 找到需求
    const requirement = scanRequirements().find(r => r.id === id);
    if (!requirement) {
      return res.status(404).json({ error: '需求不存在' });
    }

    // 解析新的产品线设置
    let newMainPL = '';
    let newRelatedPLs = [];
    let newProductLine = [];

    if (main_product_line && typeof main_product_line === 'string') {
      // 新格式：直接指定 main_product_line
      newMainPL = main_product_line;
      if (Array.isArray(related_product_lines)) {
        newRelatedPLs = [...related_product_lines];
      }
      newProductLine = [newMainPL, ...newRelatedPLs.filter(pl => pl !== newMainPL)];
    } else if (product_line) {
      // 旧格式兼容：从 product_line 数组推导
      const plArray = Array.isArray(product_line) ? product_line : (product_line ? [product_line] : []);
      newMainPL = plArray[0] || '未分类';
      newRelatedPLs = plArray.slice(1);
      newProductLine = plArray.length > 0 ? plArray : ['未分类'];
    } else {
      return res.status(400).json({
        error: '请提供 product_line 或 main_product_line',
        code: ERROR_CODES.MAIN_PRODUCT_LINE_EMPTY.code
      });
    }

    // 校验 main_product_line 不能为空
    if (!newMainPL || newMainPL.trim() === '') {
      return res.status(400).json({
        error: ERROR_CODES.MAIN_PRODUCT_LINE_EMPTY.message,
        code: ERROR_CODES.MAIN_PRODUCT_LINE_EMPTY.code
      });
    }

    const oldMainPL = requirement.mainProductLine ||
      (Array.isArray(requirement.productLine) ? requirement.productLine[0] : requirement.productLine) || '未分类';

    // 校验目标产品线物理文件夹是否存在
    const physicalPLs = getPhysicalProductLines();
    if (!physicalPLs.includes(newMainPL)) {
      return res.status(400).json({
        error: ERROR_CODES.TARGET_PRODUCT_LINE_NOT_EXIST.message,
        code: ERROR_CODES.TARGET_PRODUCT_LINE_NOT_EXIST.code
      });
    }

    // 如果修改主产品线，需要二次确认
    if (oldMainPL !== newMainPL && !confirmed) {
      return res.status(400).json({
        error: ERROR_CODES.MAIN_PRODUCT_LINE_CHANGE_NOT_CONFIRMED.message,
        code: ERROR_CODES.MAIN_PRODUCT_LINE_CHANGE_NOT_CONFIRMED.code,
        requireConfirm: true,
        from: oldMainPL,
        to: newMainPL
      });
    }

    // 读取并更新 requirement.md
    const content = fs.readFileSync(requirement.bodyPath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
      return res.status(500).json({ error: '需求文件格式错误' });
    }

    const frontMatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
    frontMatter.product_line = newProductLine;
    frontMatter.main_product_line = newMainPL;
    if (newRelatedPLs.length > 0) {
      frontMatter.related_product_lines = newRelatedPLs;
    } else {
      delete frontMatter.related_product_lines;
    }
    frontMatter.updated = new Date().toISOString().split('T')[0];

    const updatedFM = buildFrontMatterWithProductLines(frontMatter);
    const newContent = `---\n${yaml.dump(updatedFM)}---\n${match[2]}`;

    // 如果主产品线变更，需要物理移动文件夹
    if (oldMainPL !== newMainPL) {
      const isArchive = requirement.isArchive;
      const baseDir = isArchive ? 'archive' : 'products';
      const srcDir = path.join(WORKSPACE, baseDir, oldMainPL, requirement.folderName);
      const dstDir = path.join(WORKSPACE, baseDir, newMainPL, requirement.folderName);

      // 确保目标产品线目录存在
      ensureProductLineDir(newMainPL, baseDir);

      // 先写回文件（在原位置）
      fs.writeFileSync(requirement.bodyPath, newContent);

      // 移动文件夹
      if (fs.existsSync(srcDir)) {
        try {
          execSync(`xcopy "${srcDir}" "${dstDir}" /E /I /Y /Q`, { stdio: 'pipe', windowsHide: true });
          execSync(`rmdir /S /Q "${srcDir}"`, { stdio: 'pipe', windowsHide: true });
        } catch (e) {
          console.error('移动需求文件夹失败:', e.message);
        }
      }
    } else {
      // 只更新文件内容
      fs.writeFileSync(requirement.bodyPath, newContent);
    }

    // 返回更新后的数据
    const updatedReq = scanRequirements().find(r => r.id === id);
    res.json({ success: true, requirement: updatedReq || { id, product_line: newProductLine, main_product_line: newMainPL } });
  } catch (err) {
    console.error('修改产品线失败:', err);
    res.status(500).json({ error: '修改失败: ' + err.message });
  }
});

// ============================================================================
// 工具函数：批量替换需求文件中某个字段的值
// ============================================================================
function batchRenameField(field, from, to) {
  const requirements = scanRequirements();
  let count = 0;

  for (const req of requirements) {
    if (req[field] === from) {
      const content = fs.readFileSync(req.bodyPath, 'utf-8');
      const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (match) {
        const frontMatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
        frontMatter[field] = to;
        frontMatter.updated = new Date().toISOString().split('T')[0];

        const updatedFM = buildFrontMatterWithProductLines(frontMatter);

        const newContent = `---\n${yaml.dump(updatedFM)}---\n${match[2]}`;
        fs.writeFileSync(req.bodyPath, newContent);
        count++;
      }
    }
  }
  return count;
}

// ============================================================================
// API：保存设置
// ============================================================================
app.post('/api/settings', (req, res) => {
  try {
    const { statusList, priorityList, productLines, renameStatus, renamePriority } = req.body;
    const settings = getSettings();

    if (renameStatus && renameStatus.from && renameStatus.to) {
      batchRenameField('status', renameStatus.from, renameStatus.to);
      settings.statusList = settings.statusList.map(s => s === renameStatus.from ? renameStatus.to : s);
    }

    if (renamePriority && renamePriority.from && renamePriority.to) {
      batchRenameField('priority', renamePriority.from, renamePriority.to);
      settings.priorityList = settings.priorityList.map(p => p === renamePriority.from ? renamePriority.to : p);
    }

    if (statusList && Array.isArray(statusList) && statusList.length > 0) {
      settings.statusList = statusList;
    }
    if (priorityList && Array.isArray(priorityList) && priorityList.length > 0) {
      settings.priorityList = priorityList;
    }
    if (productLines && Array.isArray(productLines)) {
      settings.productLines = productLines;
    }

    saveSettings(settings);
    res.json({ success: true, settings });
  } catch (err) {
    console.error('保存设置失败:', err);
    res.status(500).json({ error: '保存失败: ' + err.message });
  }
});

// ============================================================================
// 首页路由
// ============================================================================
app.get('/', (req, res) => {
  res.sendFile(path.join(WORKSPACE, 'public', 'index.html'));
});

// ============================================================================
// [ARCHIVED] TAPD OAuth & API 路由
// 已归档至 archive/tapd/，如需恢复请查看 archive/tapd/README.md
// ============================================================================

// ============================================================================
// 启动服务器
// ============================================================================
app.listen(PORT, () => {
  console.log(`7s-PM-Craft 管家已启动`);
  console.log(`访问地址: http://localhost:${PORT}`);
  console.log(`工作区: ${WORKSPACE}`);
});
