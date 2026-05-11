# 7s-PM-Craft

> 产品工作流 AI 系统 — 一句话生成高保真原型 + 自动归档需求文档 + 浏览器端统一管理

---

## 快速开始

```bash
# 1. 进入项目目录
cd workbuddy-file

# 2. 安装依赖（首次）
npm install

# 3. 启动本地 HTTP 管家
npm start

# 4. 浏览器打开 http://localhost:3000
```

**零配置原则：** 所有数据保存在本地文件系统中，不依赖外部数据库。

---

## 功能概览

### 首页 Dashboard
- 统计概览：总需求数、各状态分布（设计中/待评审/开发中/待验收/归档）
- 产品线卡片：展示各产品线的需求数量及状态分布
- 全局搜索：跨产品线搜索需求，支持关键词、ID、开发/提出人

### 需求列表页
- **状态视图**：看板（卡片）/ 列表（表格）双模式切换
  - 6 列看板：设计中、待评审、开发中、待验收、归档、挂起
  - 拖拽需求到不同状态列，自动更新状态
  - 状态标签快速筛选
  - 表格模式下支持行内编辑（状态/优先级/迭代下拉）
- **迭代视图**：分段列表展示，支持拖拽改迭代
  - 未分配 / 活跃迭代 / 已关闭迭代（默认折叠）
- 归档操作：看板卡片 hover 归档、表格行归档按钮

### 需求详情页
- 左侧：当前产品线需求快速切换
- 中间：原型展示（Web端等比例缩放 / 移动端 375×667）
  - 支持多端原型 Tab 切换
- 右侧：需求文档 Markdown 渲染（可展开/收起）

### 新建需求
- 填写标题、产品线、优先级、预计上线、平台、开发/提出人
- 自动分配全局自增 ID（REQ-000001 格式）
- 创建后自动生成 requirement.md，自动跳转详情页

### 设置弹窗
- 迭代管理：新建、关闭迭代
- 产品线：自动汇总展示
- 状态/优先级定义：可视化展示当前枚举值

### Skills CLI
```bash
# 命令行工具，支持需求管理命令
npm run pm -- prd-new "描述" --platform web
npm run pm -- list
```

---

## Skills 规范

所有 AI 工具、Skill、手动操作遵循统一规范：

**📄 [`skills/pm-craft-rules/SKILL.md`](./skills/pm-craft-rules/SKILL.md)** （v2.0.0）

| 章节 | 内容 |
|------|------|
| §1 文件协议 | 目录结构、命名规则、ID/Slug 算法 |
| §2 需求文档规范 | YAML front matter 字段定义、读取容错 |
| §3 原型规范 | DesignSystem 接口、交互/保真度要求 |
| §4 迭代数据规范 | `.sprints.json` 格式、API 端点 |
| §5 命令协议 | `/prd-new` 等命令格式与执行流程 |
| §6 元数据校验规则 | 外部产物导入校验清单、import 接口规范 |
| §7 产物放置规则 | 路径模板、归档路径、设计系统配置 |

---

## 技术架构

```
┌─────────────────────────────────────┐
│  浏览器平台层（Web 界面）            │  ← 需求聚合、展示、管理
├─────────────────────────────────────┤
│  Skills 层（IDE / WorkBuddy 调用）  │  ← 生产内容
├─────────────────────────────────────┤
│  文件协议层（本地文件夹）            │  ← 数据存储
└─────────────────────────────────────┘
```

## 文件协议

```
{workspace}/
├── products/{product-line}/REQ-{id}-{slug}/
│   ├── requirement.md          # YAML Front Matter + Markdown 正文
│   ├── prototype-web.html      # 可选
│   └── prototype-mobile.html   # 可选
├── archive/{product-line}/REQ-{id}-{slug}/
├── .sprints.json               # 迭代元数据
└── skills/pm-craft-rules/SKILL.md   # 统一规范（v2.0，替代旧 PROTOCOL.md）
```

### requirement.md 格式

```markdown
---
id: REQ-000001
title: 登录页面
status: 设计中
priority: P0
platform:
  - web
  - mobile
product_line:           # 数组格式（v2.0+，兼容旧 string 格式）
  - 产品线A
sprint: 迭代1
developer: 张三
requester: 李四
created: 2026-04-29
updated: 2026-04-29
due_date: 2026-05-15
tags:
  - 认证
  - 核心流程
---

## 需求描述
...
```

---

## API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/requirements` | GET | 获取所有需求 |
| `/api/requirements` | POST | 创建新需求 |
| `/api/requirements/import` | POST | **导入外部产物**（自动校验/补全元数据） |
| `/api/requirements/:id` | GET | 获取单个需求 |
| `/api/requirements/:id/status` | POST | 修改状态 |
| `/api/requirements/:id/priority` | POST | 修改优先级 |
| `/api/requirements/:id/sprint` | POST | 修改迭代 |
| `/api/requirements/:id/content` | POST | 修改文档正文 |
| `/api/requirements/:id/archive` | POST | 归档需求 |
| `/api/requirements/:id/prototype/import` | POST | **导入外部原型 HTML**（自动注入关联 meta） |
| `/api/sprints` | GET | 获取迭代列表 |
| `/api/sprints` | POST | 创建迭代 |
| `/api/sprints/:name/close` | POST | 关闭迭代 |
| `/api/sprints/:name/archive` | POST | 归档迭代下所有需求 |
| `/api/settings` | GET | 获取设置 |
| `/api/settings` | POST | 保存设置 |
| `/api/product-lines` | POST | 创建产品线 |

### 导入接口说明（v2.0 新增）

```bash
# 导入需求文档（可不含 front matter，服务端自动补全）
curl -X POST http://localhost:3456/api/requirements/import \
  -H "Content-Type: application/json" \
  -d '{
    "content": "# 需求标题\n\n## 需求描述\n\n...",
    "options": { "product_line": ["产品线A"], "priority": "P1" }
  }'

# 导入原型 HTML 到已有需求
curl -X POST http://localhost:3456/api/requirements/REQ-000001/prototype/import \
  -H "Content-Type: application/json" \
  -d '{
    "content": "<html>...</html>",
    "platform": "web"
  }'
```

---

## 测试

```bash
# 运行 Playwright E2E 测试
npx playwright test

# 查看测试报告
npx playwright show-report
```

---

## 换电脑迁移

```
1. 将整个工作区文件夹复制到新电脑
2. 在新电脑执行：npm start
3. 浏览器打开 http://localhost:3000
4. 所有历史需求自动加载
```

---

## 开发计划

- [x] 首页统计 + 产品线卡片
- [x] 需求列表（状态视图 + 迭代视图）
- [x] 看板拖拽改状态、迭代拖拽改迭代
- [x] 行内编辑（状态/优先级/迭代下拉）
- [x] 需求详情（原型 + 需求文档同屏）
- [x] 全局搜索
- [x] 设置弹窗（迭代管理、产品线、状态/优先级定义）
- [x] 新建需求
- [x] 列表页归档
- [x] 状态视图卡片/列表模式切换
- [x] Playwright E2E 测试
- [x] 需求文档在线编辑
- [x] 原型全屏展示
- [x] 需求支持多产品线
- [x] Skills 合并为统一规范（pm-craft-rules v2.0）
- [x] 外部产物导入接口（POST /api/requirements/import）
- [x] 原型导入接口（POST /api/requirements/:id/prototype/import）
- [x] 元数据自动校验与补全
