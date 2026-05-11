const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const app = express();
const PORT = process.env.PORT || 3000;
const WORKSPACE = __dirname;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(WORKSPACE, 'public')));

// 工具函数：解析 requirement.md
function parseRequirement(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  
  if (!match) return null;
  
  try {
    const frontMatter = yaml.load(match[1]);
    const body = match[2].trim();
    return { ...frontMatter, body, bodyPath: filePath };
  } catch (e) {
    console.error('解析 YAML 失败:', filePath, e.message);
    return null;
  }
}

// 工具函数：扫描所有需求
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
      const reqDirs = fs.readdirSync(plPath, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name.startsWith('REQ-'));
      
      for (const reqDir of reqDirs) {
        const reqPath = path.join(plPath, reqDir.name);
        const reqFile = path.join(reqPath, 'requirement.md');
        
        if (fs.existsSync(reqFile)) {
          const req = parseRequirement(reqFile);
          if (req) {
            // 检查原型文件
            const hasWeb = fs.existsSync(path.join(reqPath, 'prototype-web.html'));
            const hasMobile = fs.existsSync(path.join(reqPath, 'prototype-mobile.html'));

            // 兼容旧数据：product_line 可能是 string，统一转为 array
            let productLines = req.product_line;
            if (typeof productLines === 'string') {
              productLines = [productLines];
            } else if (!Array.isArray(productLines)) {
              productLines = [pl.name];
            }

            requirements.push({
              ...req,
              folderName: reqDir.name,
              productLine: productLines,
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

// 工具函数：读取迭代数据
function getSprints() {
  const sprintsFile = path.join(WORKSPACE, '.sprints.json');
  if (!fs.existsSync(sprintsFile)) return { sprints: [] };
  
  try {
    return JSON.parse(fs.readFileSync(sprintsFile, 'utf-8'));
  } catch (e) {
    return { sprints: [] };
  }
}

// 工具函数：读取设置
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

// 工具函数：保存设置
function saveSettings(settings) {
  const settingsFile = path.join(WORKSPACE, '.settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
}

// 工具函数：生成下一个可用 ID
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

// 工具函数：从标题生成 slug
function generateSlug(title) {
  // 先尝试提取字母、数字和常见连接符
  let slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

  // 如果处理完为空（纯中文标题且无空格），用 timestamp
  if (!slug || slug === '-') {
    slug = 'new-requirement';
  }

  // 限制长度
  if (slug.length > 50) {
    slug = slug.substring(0, 50).replace(/-+$/, '');
  }

  return slug;
}

// API：创建新需求
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

    // productLine 支持 string 或 array
    const productLines = Array.isArray(productLine) ? productLine : (productLine ? [productLine] : []);

    if (!title || productLines.length === 0) {
      return res.status(400).json({ error: '标题和产品线为必填项' });
    }

    const id = getNextReqId();
    const slug = generateSlug(title);
    const folderName = `${id}-${slug}`;
    const today = new Date().toISOString().split('T')[0];

    // 取第一个产品线作为物理文件夹路径（主产品线）
    const primaryProductLine = productLines[0];

    // 确保产品线目录存在
    const plDir = path.join(WORKSPACE, 'products', primaryProductLine);
    if (!fs.existsSync(plDir)) {
      fs.mkdirSync(plDir, { recursive: true });
    }

    // 创建需求文件夹
    const reqDir = path.join(plDir, folderName);
    if (fs.existsSync(reqDir)) {
      return res.status(400).json({ error: '需求文件夹已存在' });
    }

    fs.mkdirSync(reqDir, { recursive: true });

    // 构建 YAML front matter
    const settings = getSettings();
    const frontMatter = {
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
    };

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

// API：获取所有需求
app.get('/api/requirements', (req, res) => {
  const requirements = scanRequirements();
  res.json({ requirements });
});

// API：获取单个需求
app.get('/api/requirements/:id', (req, res) => {
  const requirements = scanRequirements();
  const requirement = requirements.find(r => r.id === req.params.id);
  
  if (!requirement) {
    return res.status(404).json({ error: '需求不存在' });
  }
  
  res.json(requirement);
});

// API：修改需求状态
app.post('/api/requirements/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    const requirements = scanRequirements();
    const requirement = requirements.find(r => r.id === req.params.id);

    if (!requirement) {
      return res.status(404).json({ error: '需求不存在' });
    }

    // 读取原文件
    const content = fs.readFileSync(requirement.bodyPath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (match) {
      const frontMatter = yaml.load(match[1]);
      frontMatter.status = status;
      frontMatter.updated = new Date().toISOString().split('T')[0];

      const newContent = `---\n${yaml.dump(frontMatter)}---\n${match[2]}`;
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

// API：修改需求优先级
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
      const frontMatter = yaml.load(match[1]);
      frontMatter.priority = priority;
      frontMatter.updated = new Date().toISOString().split('T')[0];

      const newContent = `---\n${yaml.dump(frontMatter)}---\n${match[2]}`;
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

// API：修改需求迭代
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
      const frontMatter = yaml.load(match[1]);
      frontMatter.sprint = sprint;
      frontMatter.updated = new Date().toISOString().split('T')[0];

      const newContent = `---\n${yaml.dump(frontMatter)}---\n${match[2]}`;
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

// API：修改需求文档内容
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
      const frontMatter = yaml.load(match[1]);
      frontMatter.updated = new Date().toISOString().split('T')[0];

      const newContent = `---\n${yaml.dump(frontMatter)}---\n${content}`;
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

// API：归档需求
app.post('/api/requirements/:id/archive', (req, res) => {
  try {
    const requirements = scanRequirements();
    const requirement = requirements.find(r => r.id === req.params.id);

    if (!requirement) {
      return res.status(404).json({ error: '需求不存在' });
    }

    // 计算源目录和目标目录
    const sourceDir = path.dirname(requirement.bodyPath);
    const primaryProductLine = Array.isArray(requirement.productLine) ? requirement.productLine[0] : requirement.productLine;
    const targetDir = path.join(WORKSPACE, 'archive', primaryProductLine, requirement.folderName);

    // 检查目标是否已存在
    if (fs.existsSync(targetDir)) {
      return res.status(400).json({ error: '该需求已被归档，请勿重复操作' });
    }

    // 确保 archive 产品线目录存在
    const archivePlDir = path.join(WORKSPACE, 'archive', primaryProductLine);
    if (!fs.existsSync(archivePlDir)) {
      fs.mkdirSync(archivePlDir, { recursive: true });
    }

    // 第一步：先移动文件夹（移动成功后再改状态，避免状态变了但文件没移）
    fs.renameSync(sourceDir, targetDir);

    // 第二步：移动成功后更新状态
    const newBodyPath = path.join(targetDir, 'requirement.md');
    const content = fs.readFileSync(newBodyPath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (match) {
      const frontMatter = yaml.load(match[1]);
      frontMatter.status = '已完成';
      frontMatter.updated = new Date().toISOString().split('T')[0];

      const newContent = `---\n${yaml.dump(frontMatter)}---\n${match[2]}`;
      fs.writeFileSync(newBodyPath, newContent);
    }

    res.json({ success: true, id: req.params.id });
  } catch (err) {
    console.error('归档需求失败:', err);
    res.status(500).json({ error: '归档失败: ' + err.message });
  }
});

// 工具函数：校验并补全需求的 YAML front matter（满足 pm-craft-rules §6.2）
function validateAndFixFrontMatter(fm, settings, today) {
  const fixed = { ...fm };

  // id：格式校验，不合法则清空，由调用方重新分配
  if (!fixed.id || !/^REQ-\d{6}$/.test(String(fixed.id))) {
    fixed.id = null; // 标记为需要重新分配
  }

  // title：非空字符串
  if (!fixed.title || typeof fixed.title !== 'string' || !fixed.title.trim()) {
    fixed.title = null; // 标记为需从正文 H1 提取
  }

  // status：必须在 statusList 中
  if (!settings.statusList.includes(fixed.status)) {
    fixed.status = settings.statusList[0] || '设计中';
  }

  // priority：必须在 priorityList 中
  if (!settings.priorityList.includes(fixed.priority)) {
    fixed.priority = 'P2';
  }

  // product_line：必须是数组
  if (typeof fixed.product_line === 'string') {
    fixed.product_line = fixed.product_line ? [fixed.product_line] : [];
  } else if (!Array.isArray(fixed.product_line)) {
    fixed.product_line = [];
  }

  // platform：必须是数组
  if (typeof fixed.platform === 'string') {
    fixed.platform = fixed.platform ? [fixed.platform] : ['web'];
  } else if (!Array.isArray(fixed.platform)) {
    fixed.platform = ['web'];
  }

  // tags：必须是数组
  if (!Array.isArray(fixed.tags)) {
    fixed.tags = [];
  }

  // sprint：必须是字符串
  if (typeof fixed.sprint !== 'string') {
    fixed.sprint = '';
  }

  // created / updated：格式 YYYY-MM-DD
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!fixed.created || !dateRe.test(String(fixed.created))) {
    fixed.created = today;
  }
  if (!fixed.updated || !dateRe.test(String(fixed.updated))) {
    fixed.updated = today;
  }

  // 补全可选字段默认值
  if (typeof fixed.developer !== 'string') fixed.developer = '';
  if (typeof fixed.requester !== 'string') fixed.requester = '';
  if (!fixed.due_date || !dateRe.test(String(fixed.due_date))) fixed.due_date = '';

  return fixed;
}

// API：导入外部产物（requirement.md 内容）→ 解析、校验、补全元数据、写入文件系统
// POST /api/requirements/import
// Body: { content: string, options?: { product_line?, priority?, ... } }
app.post('/api/requirements/import', (req, res) => {
  try {
    const { content, options = {} } = req.body;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'content 必须为非空字符串' });
    }

    const settings = getSettings();
    const today = new Date().toISOString().split('T')[0];

    // 1. 解析 YAML front matter
    let frontMatter = {};
    let body = content;

    const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (fmMatch) {
      try {
        frontMatter = yaml.load(fmMatch[1]) || {};
      } catch (e) {
        frontMatter = {};
      }
      body = fmMatch[2].trim();
    }

    // 2. 用 options 覆盖用户指定字段（options 优先级最高）
    if (options && typeof options === 'object') {
      Object.assign(frontMatter, options);
    }

    // 3. 若 title 为空，尝试从正文 H1 提取
    if (!frontMatter.title || !String(frontMatter.title).trim()) {
      const h1Match = body.match(/^#\s+(.+)$/m);
      frontMatter.title = h1Match ? h1Match[1].trim() : '无标题';
    }

    // 4. 校验并补全元数据
    const fixed = validateAndFixFrontMatter(frontMatter, settings, today);

    // 5. 分配 ID（若缺失或格式不合法）
    // 注意：import 接口必须在 POST /api/requirements 之前注册以避免路由冲突
    // 检查 ID 是否已存在于文件系统
    if (!fixed.id) {
      fixed.id = getNextReqId();
    } else {
      // 检查 ID 是否已被占用
      const existing = scanRequirements();
      const idTaken = existing.some(r => r.id === fixed.id);
      if (idTaken) {
        fixed.id = getNextReqId();
      }
    }

    // 6. product_line 为空时放到"未分类"
    const primaryProductLine = (fixed.product_line && fixed.product_line.length > 0)
      ? fixed.product_line[0]
      : '未分类';

    if (fixed.product_line.length === 0) {
      fixed.product_line = ['未分类'];
    }

    // 7. 生成 slug，创建文件夹
    const slug = generateSlug(fixed.title);
    const folderName = `${fixed.id}-${slug}`;
    const plDir = path.join(WORKSPACE, 'products', primaryProductLine);
    const reqDir = path.join(plDir, folderName);

    if (!fs.existsSync(plDir)) {
      fs.mkdirSync(plDir, { recursive: true });
    }

    if (fs.existsSync(reqDir)) {
      return res.status(409).json({ error: `需求文件夹已存在: ${folderName}` });
    }

    fs.mkdirSync(reqDir, { recursive: true });

    // 8. 写入 requirement.md（确保 body 有基础结构）
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

// API：导入原型文件到已有需求
// POST /api/requirements/:id/prototype/import
// Body: { content: string, platform: "web" | "mobile" }
app.post('/api/requirements/:id/prototype/import', (req, res) => {
  try {
    const { content, platform } = req.body;
    const { id } = req.params;

    if (!content || typeof content !== 'string') {
      return res.status(400).json({ error: 'content 必须为非空字符串' });
    }

    const validPlatforms = ['web', 'mobile'];
    const targetPlatform = validPlatforms.includes(platform) ? platform : 'web';

    // 找到需求
    const requirements = scanRequirements();
    const requirement = requirements.find(r => r.id === id);

    if (!requirement) {
      return res.status(404).json({ error: `需求 ${id} 不存在` });
    }

    const reqDir = path.dirname(requirement.bodyPath);
    const protoFileName = `prototype-${targetPlatform}.html`;
    const protoPath = path.join(reqDir, protoFileName);

    // 注入关联 meta 标签（若内容是 HTML 且尚未注入）
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

// API：获取迭代列表
app.get('/api/sprints', (req, res) => {
  const sprints = getSprints();
  res.json(sprints);
});

// API：创建迭代
app.post('/api/sprints', (req, res) => {
  try {
    const { name } = req.body;
    const sprintsData = getSprints();

    // 检查是否已存在
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

// API：关闭迭代
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

// API：归档迭代（关闭迭代 + 归档所有需求）
app.post('/api/sprints/:name/archive', (req, res) => {
  try {
    const sprintsData = getSprints();
    const sprint = sprintsData.sprints.find(s => s.name === req.params.name);

    if (!sprint) {
      return res.status(404).json({ error: '迭代不存在' });
    }

    // 关闭迭代
    sprint.status = 'closed';
    sprint.closed = new Date().toISOString().split('T')[0];
    fs.writeFileSync(
      path.join(WORKSPACE, '.sprints.json'),
      JSON.stringify(sprintsData, null, 2)
    );

    // 归档该迭代下所有未归档需求
    const requirements = scanRequirements();
    let archivedCount = 0;
    const failedItems = [];

    for (const requirement of requirements) {
      if (requirement.sprint === req.params.name && !requirement.isArchive) {
        const sourceDir = path.dirname(requirement.bodyPath);
        const primaryProductLine = Array.isArray(requirement.productLine) ? requirement.productLine[0] : requirement.productLine;
        const targetDir = path.join(WORKSPACE, 'archive', primaryProductLine, requirement.folderName);

        try {
          // 确保 archive 产品线目录存在
          const archivePlDir = path.join(WORKSPACE, 'archive', primaryProductLine);
          if (!fs.existsSync(archivePlDir)) {
            fs.mkdirSync(archivePlDir, { recursive: true });
          }

          // 先移动文件夹
          fs.renameSync(sourceDir, targetDir);

          // 移动成功后再更新状态
          const newBodyPath = path.join(targetDir, 'requirement.md');
          const content = fs.readFileSync(newBodyPath, 'utf-8');
          const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

          if (match) {
            const frontMatter = yaml.load(match[1]);
            frontMatter.status = '已完成';
            frontMatter.updated = new Date().toISOString().split('T')[0];
            const newContent = `---\n${yaml.dump(frontMatter)}---\n${match[2]}`;
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

// API：获取设置
app.get('/api/settings', (req, res) => {
  const settings = getSettings();
  res.json(settings);
});

// API：创建产品线（创建目录 + 保存到 settings）
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
    const plDir = path.join(WORKSPACE, 'products', name);
    if (!fs.existsSync(plDir)) {
      fs.mkdirSync(plDir, { recursive: true });
    }

    // 保存到 settings
    settings.productLines = [...productLines, name];
    saveSettings(settings);

    res.json({ success: true, name, productLines: settings.productLines });
  } catch (err) {
    console.error('创建产品线失败:', err);
    res.status(500).json({ error: '创建失败: ' + err.message });
  }
});

// 工具函数：批量替换需求文件中某个字段的值
function batchRenameField(field, from, to) {
  const requirements = scanRequirements();
  let count = 0;

  for (const req of requirements) {
    if (req[field] === from) {
      const content = fs.readFileSync(req.bodyPath, 'utf-8');
      const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (match) {
        const frontMatter = yaml.load(match[1]);
        frontMatter[field] = to;
        frontMatter.updated = new Date().toISOString().split('T')[0];
        const newContent = `---\n${yaml.dump(frontMatter)}---\n${match[2]}`;
        fs.writeFileSync(req.bodyPath, newContent);
        count++;
      }
    }
  }
  return count;
}

// API：保存设置
app.post('/api/settings', (req, res) => {
  try {
    const { statusList, priorityList, productLines, renameStatus, renamePriority } = req.body;
    const settings = getSettings();

    // 处理状态重命名
    if (renameStatus && renameStatus.from && renameStatus.to) {
      batchRenameField('status', renameStatus.from, renameStatus.to);
      settings.statusList = settings.statusList.map(s => s === renameStatus.from ? renameStatus.to : s);
    }

    // 处理优先级重命名
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

// 首页路由
app.get('/', (req, res) => {
  res.sendFile(path.join(WORKSPACE, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`7s-PM-Craft 管家已启动`);
  console.log(`访问地址: http://localhost:${PORT}`);
  console.log(`工作区: ${WORKSPACE}`);
});
