#!/usr/bin/env node
/**
 * 数据迁移脚本：将旧版 product_line 字段迁移到新版 main_product_line + related_product_lines
 *
 * 用法:
 *   node scripts/migrate-product-lines.js [--dry-run]
 *
 * 选项:
 *   --dry-run  只预览变更，不实际写入文件
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const WORKSPACE = path.resolve(__dirname, '..');
const PRODUCTS_DIR = path.join(WORKSPACE, 'products');
const ARCHIVE_DIR = path.join(WORKSPACE, 'archive');

// 工具函数：将值转为数组
function toArray(v) {
  return Array.isArray(v) ? v : (v ? [v] : []);
}

// 工具函数：统一处理新旧产品线格式
function normalizeProductLines(data) {
  let mainProductLine = '';
  let relatedProductLines = [];
  let productLine = [];

  if (typeof data.product_line === 'string') {
    productLine = data.product_line ? [data.product_line] : [];
  } else if (Array.isArray(data.product_line)) {
    productLine = [...data.product_line];
  }

  if (data.main_product_line && typeof data.main_product_line === 'string') {
    mainProductLine = data.main_product_line;
    if (typeof data.related_product_lines === 'string') {
      relatedProductLines = data.related_product_lines ? [data.related_product_lines] : [];
    } else if (Array.isArray(data.related_product_lines)) {
      relatedProductLines = [...data.related_product_lines];
    }
    productLine = [mainProductLine, ...relatedProductLines.filter(pl => pl !== mainProductLine)];
  } else {
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

// 扫描所有需求文件
function scanRequirementFiles() {
  const files = [];

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
        const reqFile = path.join(plPath, reqDir.name, 'requirement.md');
        if (fs.existsSync(reqFile)) {
          files.push({ filePath: reqFile, isArchive, productLine: pl.name });
        }
      }
    }
  }

  scanDir(PRODUCTS_DIR, false);
  scanDir(ARCHIVE_DIR, true);
  return files;
}

// 解析 requirement.md
function parseRequirement(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;

  try {
    const frontMatter = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
    const body = match[2].trim();
    return { frontMatter, body, rawFrontMatter: match[1] };
  } catch (e) {
    console.error('解析 YAML 失败:', filePath, e.message);
    return null;
  }
}

// 构建新的 YAML front matter
function buildNewFrontMatter(frontMatter) {
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

// 将对象转为 YAML 字符串（简单实现，保持基本格式）
function toYamlString(obj) {
  const lines = [];
  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined || val === null) continue;
    if (Array.isArray(val)) {
      lines.push(`${key}:`);
      for (const item of val) {
        lines.push(`  - ${item}`);
      }
    } else if (typeof val === 'string') {
      // 如果字符串包含特殊字符，加引号
      if (/[:#\[\]{}|>&*!,'"\n]/.test(val) || val.startsWith(' ') || val.endsWith(' ')) {
        lines.push(`${key}: "${val.replace(/"/g, '\\"')}"`);
      } else {
        lines.push(`${key}: ${val}`);
      }
    } else if (typeof val === 'number' || typeof val === 'boolean') {
      lines.push(`${key}: ${val}`);
    } else if (val instanceof Date) {
      lines.push(`${key}: ${val.toISOString().split('T')[0]}`);
    }
  }
  return lines.join('\n');
}

// 主函数
async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const files = scanRequirementFiles();

  console.log(`扫描到 ${files.length} 个需求文件`);
  console.log(dryRun ? '\n[干跑模式] 以下变更不会被实际写入\n' : '\n开始迁移...\n');

  const backup = [];
  let migratedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const { filePath, isArchive } of files) {
    const parsed = parseRequirement(filePath);
    if (!parsed) {
      console.error(`  ❌ 解析失败: ${filePath}`);
      errorCount++;
      continue;
    }

    const { frontMatter, body } = parsed;

    // 检查是否已经是新格式
    if (frontMatter.main_product_line) {
      console.log(`  ⏭️  已迁移，跳过: ${path.basename(path.dirname(filePath))}`);
      skippedCount++;
      continue;
    }

    // 记录备份信息
    backup.push({
      file: filePath,
      oldProductLine: frontMatter.product_line,
      isArchive
    });

    // 构建新 front matter
    const newFrontMatter = buildNewFrontMatter(frontMatter);

    console.log(`  📝 ${path.basename(path.dirname(filePath))}: ${JSON.stringify(frontMatter.product_line)} → main=${newFrontMatter.main_product_line}, related=${JSON.stringify(newFrontMatter.related_product_lines || [])}`);

    if (!dryRun) {
      const newContent = `---\n${toYamlString(newFrontMatter)}\n---\n\n${body}`;
      fs.writeFileSync(filePath, newContent, 'utf-8');
    }

    migratedCount++;
  }

  // 写入备份文件
  if (backup.length > 0 && !dryRun) {
    const backupPath = path.join(WORKSPACE, `migration-backup-${Date.now()}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), 'utf-8');
    console.log(`\n✅ 备份已保存: ${backupPath}`);
  }

  console.log(`\n${dryRun ? '干跑完成' : '迁移完成'}:`);
  console.log(`  已迁移: ${migratedCount}`);
  console.log(`  已跳过: ${skippedCount}`);
  console.log(`  失败: ${errorCount}`);

  if (dryRun && migratedCount > 0) {
    console.log(`\n💡 去掉 --dry-run 参数以实际执行迁移`);
  }
}

main().catch(e => {
  console.error('迁移失败:', e);
  process.exit(1);
});
