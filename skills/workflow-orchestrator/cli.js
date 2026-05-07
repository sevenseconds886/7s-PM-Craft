#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const WORKSPACE = process.cwd();

// ============ 工具函数 ============

function scanAllReqs() {
  const reqs = [];
  const dirs = [path.join(WORKSPACE, 'products'), path.join(WORKSPACE, 'archive')];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const pls = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const pl of pls) {
      const plPath = path.join(dir, pl.name);
      const reqDirs = fs.readdirSync(plPath, { withFileTypes: true })
        .filter(d => d.isDirectory() && d.name.startsWith('REQ-'));
      for (const rd of reqDirs) {
        const reqPath = path.join(plPath, rd.name);
        const mdPath = path.join(reqPath, 'requirement.md');
        if (fs.existsSync(mdPath)) {
          reqs.push({ id: rd.name.match(/REQ-\d+/)?.[0], folderName: rd.name, path: reqPath, productLine: pl.name, mdPath });
        }
      }
    }
  }
  return reqs;
}

function getNextId() {
  const reqs = scanAllReqs();
  let max = 0;
  for (const r of reqs) {
    if (r.id) {
      const n = parseInt(r.id.replace('REQ-', ''));
      if (n > max) max = n;
    }
  }
  return String(max + 1).padStart(6, '0');
}

function generateSlug(text) {
  // 简单的拼音/英文转换：取前 4-6 个字的拼音或英文关键词
  // MVP 版本：直接用描述的前 20 个字符，去除特殊字符，空格转短横线
  return text.slice(0, 30)
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 40) || 'untitled';
}

function readReq(reqId) {
  const reqs = scanAllReqs();
  return reqs.find(r => r.id === reqId);
}

function parseMd(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  return { frontMatter: yaml.load(match[1]), body: match[2].trim() };
}

function writeMd(filePath, frontMatter, body) {
  const newContent = `---\n${yaml.dump(frontMatter)}---\n${body}`;
  fs.writeFileSync(filePath, newContent);
}

function getProductLines() {
  const productsDir = path.join(WORKSPACE, 'products');
  if (!fs.existsSync(productsDir)) return [];
  return fs.readdirSync(productsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ============ 命令 ============

function cmdPrdNew() {
  const description = process.argv[3];
  if (!description) {
    console.log('用法: node cli.js prd-new <需求描述> [选项]');
    console.log('选项:');
    console.log('  --product-line <名称>  指定产品线');
    console.log('  --priority <P0-P5>     指定优先级 (默认 P2)');
    console.log('  --platform <web|mobile|both>  指定平台 (默认 web)');
    console.log('  --sprint <名称>        指定迭代');
    console.log('  --skip-prototype       跳过原型生成提示');
    return;
  }

  // 解析选项
  const options = { priority: 'P2', platform: ['web'], skipPrototype: false };
  for (let i = 4; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === '--product-line' && process.argv[i + 1]) { options.productLine = process.argv[i + 1]; i++; }
    else if (arg === '--priority' && process.argv[i + 1]) { options.priority = process.argv[i + 1]; i++; }
    else if (arg === '--platform' && process.argv[i + 1]) {
      const p = process.argv[i + 1];
      options.platform = p === 'both' ? ['web', 'mobile'] : [p];
      i++;
    }
    else if (arg === '--sprint' && process.argv[i + 1]) { options.sprint = process.argv[i + 1]; i++; }
    else if (arg === '--skip-prototype') { options.skipPrototype = true; }
  }

  // 确定产品线
  let productLine = options.productLine;
  if (!productLine) {
    const pls = getProductLines();
    if (pls.length === 1) {
      productLine = pls[0];
    } else if (pls.length > 1) {
      console.log('存在多个产品线，请指定 --product-line：');
      pls.forEach(p => console.log(`  - ${p}`));
      return;
    } else {
      productLine = '默认产品线';
    }
  }

  // 分配 ID
  const id = `REQ-${getNextId()}`;
  const slug = generateSlug(description);
  const folderName = `${id}-${slug}`;
  const reqPath = path.join(WORKSPACE, 'products', productLine, folderName);
  ensureDir(reqPath);

  // 生成 requirement.md
  const today = new Date().toISOString().split('T')[0];
  const frontMatter = {
    id,
    title: description.slice(0, 40),
    status: '设计中',
    priority: options.priority,
    platform: options.platform,
    product_line: productLine,
    sprint: options.sprint || '',
    developer: '',
    requester: '',
    created: today,
    updated: today,
    due_date: '',
    tags: []
  };

  const body = `## 需求描述\n${description}\n\n## 验收标准\n- [ ] \n\n## 备注\n`;
  writeMd(path.join(reqPath, 'requirement.md'), frontMatter, body);

  console.log(`\n✅ 需求已创建: ${id}`);
  console.log(`📁 路径: ${reqPath}`);
  console.log(`📄 文件: ${path.join(reqPath, 'requirement.md')}`);

  // 生成 AI Prompt
  if (!options.skipPrototype) {
    console.log(`\n💡 下一步：生成需求文档`);
    console.log(`   将以下 Prompt 发送给你的 AI 助手（Cursor/Trae/ChatGPT 等）：\n`);
    console.log('─'.repeat(60));
    console.log(`你是一位资深产品经理。请根据以下需求描述，生成一份规范的需求文档。\n`);
    console.log(`需求描述：${description}\n`);
    console.log(`请严格按照以下规则输出：\n`);
    console.log(`1. 输出格式：Markdown，包含 YAML Front Matter`);
    console.log(`2. YAML 字段必须完整：id, title, status, priority, platform, product_line, sprint, developer, requester, created, updated, due_date, tags`);
    console.log(`3. 需求描述要结构化：背景、功能说明、用户旅程`);
    console.log(`4. 验收标准至少 3-5 条，必须可测试验证`);
    console.log(`5. 使用真实文案，不用"示例""占位符"`);
    console.log(`6. 将生成的内容直接写入文件：${path.join(reqPath, 'requirement.md')}`);
    console.log('─'.repeat(60));
    console.log(`\n   或者运行: node skills/workflow-orchestrator/cli.js prototype ${id}`);
    console.log(`   获取生成原型的 Prompt`);
  }
}

function cmdPrototype() {
  const reqId = process.argv[3];
  if (!reqId) {
    console.log('用法: node cli.js prototype <需求ID>');
    return;
  }

  const req = readReq(reqId);
  if (!req) {
    console.log(`❌ 需求 ${reqId} 不存在`);
    return;
  }

  const parsed = parseMd(req.mdPath);
  if (!parsed) {
    console.log(`❌ 无法解析 ${reqId} 的需求文档`);
    return;
  }

  const { frontMatter, body } = parsed;
  const platforms = frontMatter.platform || ['web'];

  console.log(`\n💡 将以下 Prompt 发送给你的 AI 助手，生成高保真原型：\n`);
  console.log('─'.repeat(60));
  console.log(`你是一位前端原型设计师。请根据以下需求文档，生成高保真 HTML 原型。\n`);
  console.log(`需求标题：${frontMatter.title || reqId}`);
  console.log(`需求描述：\n${body.slice(0, 500)}${body.length > 500 ? '...' : ''}\n`);

  if (platforms.includes('web')) {
    console.log(`\n【Web 端原型要求】`);
    console.log(`- 文件名: prototype-web.html`);
    console.log(`- 保存路径: ${req.path}/`);
    console.log(`- 使用 Tailwind CSS（CDN 引入）`);
    console.log(`- 最大宽度 1200px，居中显示`);
    console.log(`- 按钮必须有 hover/active 状态`);
    console.log(`- 输入框必须有 focus 状态`);
    console.log(`- 能走通主要用户旅程`);
  }

  if (platforms.includes('mobile')) {
    console.log(`\n【移动端原型要求】`);
    console.log(`- 文件名: prototype-mobile.html`);
    console.log(`- 保存路径: ${req.path}/`);
    console.log(`- 使用 Tailwind CSS（CDN 引入）`);
    console.log(`- 固定宽度 375px，模拟手机`);
    console.log(`- 底部 Tab 导航，全宽按钮`);
    console.log(`- 按钮必须有 hover/active 状态`);
  }

  console.log(`\n【设计规范】`);
  console.log(`- 配色：自然专业，避免高饱和色`);
  console.log(`- 圆角：按钮 8px，卡片 12px`);
  console.log(`- 阴影：柔和阴影（0 2px 8px rgba(0,0,0,0.08)）`);
  console.log(`- 使用真实文案，不用"示例""占位符"`);
  console.log(`- 单个 HTML 文件，所有样式内联或 CDN`);
  console.log('─'.repeat(60));
}

function cmdPrdUpdate() {
  const reqId = process.argv[3];
  const description = process.argv[4];
  if (!reqId || !description) {
    console.log('用法: node cli.js prd-update <需求ID> <更新描述>');
    return;
  }

  const req = readReq(reqId);
  if (!req) {
    console.log(`❌ 需求 ${reqId} 不存在`);
    return;
  }

  const parsed = parseMd(req.mdPath);
  if (!parsed) {
    console.log(`❌ 无法解析需求文档`);
    return;
  }

  parsed.frontMatter.updated = new Date().toISOString().split('T')[0];
  parsed.body += `\n\n## 更新记录 (${parsed.frontMatter.updated})\n${description}\n`;
  writeMd(req.mdPath, parsed.frontMatter, parsed.body);

  console.log(`✅ 需求 ${reqId} 已更新`);
}

function cmdPrdStatus() {
  const reqId = process.argv[3];
  const status = process.argv[4];
  const validStatuses = ['设计中', '待评审', '开发中', '待验收', '归档', '挂起'];

  if (!reqId || !status) {
    console.log('用法: node cli.js prd-status <需求ID> <状态>');
    console.log(`有效状态: ${validStatuses.join(' / ')}`);
    return;
  }

  if (!validStatuses.includes(status)) {
    console.log(`❌ 无效状态: ${status}`);
    console.log(`有效状态: ${validStatuses.join(' / ')}`);
    return;
  }

  const req = readReq(reqId);
  if (!req) {
    console.log(`❌ 需求 ${reqId} 不存在`);
    return;
  }

  const parsed = parseMd(req.mdPath);
  if (!parsed) {
    console.log(`❌ 无法解析需求文档`);
    return;
  }

  parsed.frontMatter.status = status;
  parsed.frontMatter.updated = new Date().toISOString().split('T')[0];
  writeMd(req.mdPath, parsed.frontMatter, parsed.body);

  // 如果状态是归档，移动文件夹
  if (status === '归档') {
    const archiveDir = path.join(WORKSPACE, 'archive', req.productLine);
    ensureDir(archiveDir);
    const targetPath = path.join(archiveDir, req.folderName);
    fs.renameSync(req.path, targetPath);
    console.log(`✅ 需求 ${reqId} 已归档 → ${targetPath}`);
  } else {
    console.log(`✅ 需求 ${reqId} 状态已更新为: ${status}`);
  }
}

function cmdPrdPriority() {
  const reqId = process.argv[3];
  const priority = process.argv[4];
  const validPriorities = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'];

  if (!reqId || !priority) {
    console.log('用法: node cli.js prd-priority <需求ID> <优先级>');
    console.log(`有效优先级: ${validPriorities.join(' / ')}`);
    return;
  }

  if (!validPriorities.includes(priority)) {
    console.log(`❌ 无效优先级: ${priority}`);
    return;
  }

  const req = readReq(reqId);
  if (!req) {
    console.log(`❌ 需求 ${reqId} 不存在`);
    return;
  }

  const parsed = parseMd(req.mdPath);
  if (!parsed) {
    console.log(`❌ 无法解析需求文档`);
    return;
  }

  parsed.frontMatter.priority = priority;
  parsed.frontMatter.updated = new Date().toISOString().split('T')[0];
  writeMd(req.mdPath, parsed.frontMatter, parsed.body);

  console.log(`✅ 需求 ${reqId} 优先级已更新为: ${priority}`);
}

function cmdPrdSprint() {
  const reqId = process.argv[3];
  const sprint = process.argv[4];

  if (!reqId) {
    console.log('用法: node cli.js prd-sprint <需求ID> <迭代名称>');
    console.log('       node cli.js prd-sprint <需求ID> --clear  清除迭代');
    return;
  }

  const req = readReq(reqId);
  if (!req) {
    console.log(`❌ 需求 ${reqId} 不存在`);
    return;
  }

  const parsed = parseMd(req.mdPath);
  if (!parsed) {
    console.log(`❌ 无法解析需求文档`);
    return;
  }

  parsed.frontMatter.sprint = sprint === '--clear' ? '' : (sprint || '');
  parsed.frontMatter.updated = new Date().toISOString().split('T')[0];
  writeMd(req.mdPath, parsed.frontMatter, parsed.body);

  if (sprint === '--clear') {
    console.log(`✅ 需求 ${reqId} 已移出迭代`);
  } else {
    console.log(`✅ 需求 ${reqId} 已分配到迭代: ${sprint || '未分配'}`);
  }
}

function cmdList() {
  const reqs = scanAllReqs();
  if (reqs.length === 0) {
    console.log('暂无需求');
    return;
  }

  console.log('\n📋 需求列表\n');
  console.log(`${'ID'.padEnd(12)} ${'状态'.padEnd(6)} ${'产品线'.padEnd(10)} ${'路径'}`);
  console.log('─'.repeat(80));
  for (const r of reqs) {
    const parsed = parseMd(r.mdPath);
    const status = parsed?.frontMatter?.status || '?';
    console.log(`${(r.id || '?').padEnd(12)} ${status.padEnd(6)} ${r.productLine.padEnd(10)} ${r.path.replace(WORKSPACE, '.')}`);
  }
  console.log(`\n共 ${reqs.length} 个需求`);
}

function cmdHelp() {
  console.log(`
7s-PM-Craft Workflow Orchestrator

用法: node cli.js <命令> [参数]

命令:
  prd-new <描述> [选项]     创建新需求
  prd-update <ID> <描述>     更新需求
  prd-status <ID> <状态>     修改需求状态
  prd-priority <ID> <优先级> 修改需求优先级
  prd-sprint <ID> <迭代>     修改需求迭代
  prototype <ID>             输出生成原型的 AI Prompt
  list                       列出所有需求

选项 (prd-new):
  --product-line <名称>      指定产品线
  --priority <P0-P5>         指定优先级
  --platform <web|mobile|both> 指定平台
  --sprint <名称>            指定迭代
  --skip-prototype           跳过原型生成提示

示例:
  node cli.js prd-new "登录页面，支持手机号+验证码" --priority P0 --platform both
  node cli.js prd-status REQ-000001 开发中
  node cli.js prototype REQ-000001
`);
}

// ============ 主入口 ============

const command = process.argv[2];

switch (command) {
  case 'prd-new': cmdPrdNew(); break;
  case 'prd-update': cmdPrdUpdate(); break;
  case 'prd-status': cmdPrdStatus(); break;
  case 'prd-priority': cmdPrdPriority(); break;
  case 'prd-sprint': cmdPrdSprint(); break;
  case 'prototype': cmdPrototype(); break;
  case 'list': cmdList(); break;
  case 'help':
  case '--help':
  case '-h':
  default: cmdHelp(); break;
}
