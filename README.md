# 7s-PM-Craft

> 产品经理的需求管理工作台 — 一句话写 PRD、一键出原型、看板拖拽管进度

---

## 产品经理操作指南

### 启动

打开终端，进入项目目录，运行 `npm start`，浏览器访问 **http://localhost:3456**

### 核心流程

```
记录想法 → 写需求文档 → 出原型 → 跟进度 → 归档
  需求池      PRD生成      原型生成   看板拖拽   一键归档
```

#### 1. 记录想法 → 需求池

首页点「需求池」→ 点 + 新建草稿 → 填标题和描述 → 保存

草稿是想法的暂存区，不占正式需求编号。想好了随时点「发布」转正。

#### 2. 写需求文档 → PRD 生成

在 WorkBuddy 对话中描述你的需求，AI 会通过 **多轮追问** 逐步帮你完善：

1. 你说个大概 → AI 问你核心场景和目标
2. 你回答 → AI 整理出需求概要，继续问边界和细节
3. 你确认 → AI 补充功能和页面设计
4. 你满意 → AI 输出完整 PRD 文档，可选自动导入到 PM-Craft

> 提示：描述越具体，追问轮次越少。最好说清"给谁用、解决什么问题、和现在的区别"。

#### 3. 出原型 → 原型生成

PRD 写完后，在对话中要求生成原型。AI 会：

1. 确认设计风格（默认陶土色系，和你 PM-Craft 界面风格一致）
2. 列出需要做的页面，你确认
3. 逐页生成可交互 HTML 原型
4. 组装成单文件，可选自动导入

导入后在需求详情页直接预览，按钮可点击、表单可输入、页面可切换。

#### 4. 跟进度 → 看板拖拽

- **状态看板**：拖拽需求卡片到不同状态列（设计中 → 待评审 → 开发中 → 待验收 → 已完成）
- **迭代看板**：左侧选迭代，右侧看该迭代的需求分布
- **快速编辑**：列表模式下直接改状态、优先级、迭代

#### 5. 归档

- 单个归档：看板/列表中点归档按钮
- 迭代归档：设置 → 迭代管理 → 归档迭代（一键归档该迭代所有需求）
- 归档后在「已归档」页面按产品线查看

### 页面速查

| 页面 | 入口 | 干什么 |
|------|------|--------|
| 首页 | 打开即见 | 总览数据、进各模块 |
| 需求列表 | 首页点产品线卡片 | 看板/列表双模式，拖拽改状态 |
| 需求详情 | 点任意需求 | 左侧原型 + 右侧文档，可在线编辑 |
| 需求池 | 首页入口 | 管理草稿，发布转正 |
| 已归档 | 首页入口 | 按产品线查看归档需求 |
| 设置 | 右上角齿轮 | 管理迭代、产品线、状态定义 |

### 快捷操作

- **全局搜索**：首页搜索框，支持关键词、需求ID、人名
- **高级筛选**：列表页点筛选，按优先级/迭代/负责人组合过滤
- **文档编辑**：详情页右侧文档面板，直接改内容，自动保存版本
- **原型全屏**：详情页原型区点放大按钮

---

## 技术参考

### 快速开始

```bash
cd workbuddy-file
npm install        # 首次安装依赖
npm start          # 启动服务
# 浏览器打开 http://localhost:3456
```

**零配置原则**：所有数据保存在本地文件系统，不依赖外部数据库。

### 换电脑迁移

复制整个工作区文件夹到新电脑 → `npm start` → 所有数据自动加载。

### 技术架构

```
┌─────────────────────────────────────┐
│  浏览器平台层（Web 界面）            │  ← 需求聚合、展示、管理
├─────────────────────────────────────┤
│  Skills 层（IDE / WorkBuddy 调用）  │  ← 生产内容
├─────────────────────────────────────┤
│  文件协议层（本地文件夹）            │  ← 数据存储
└─────────────────────────────────────┘
```

### 文件协议

```
{workspace}/
├── products/{product-line}/REQ-{id}-{slug}/
│   ├── requirement.md          # YAML Front Matter + Markdown 正文
│   ├── prototype-web.html      # 可选，Web端原型
│   └── prototype-mobile.html   # 可选，移动端原型
├── archive/{product-line}/REQ-{id}-{slug}/
├── drafts/                     # 需求池草稿
└── .sprints.json               # 迭代元数据
```

### Skills 规范

统一规范源：**[`.workbuddy/skills/pm-craft-rules/SKILL.md`](./.workbuddy/skills/pm-craft-rules/SKILL.md)** （v2.2.0）

| 章节 | 内容 |
|------|------|
| §1 文件协议 | 目录结构、命名规则、ID/Slug 算法 |
| §2 需求文档规范 | YAML front matter 字段定义、读取容错 |
| §2.6 草稿文档规范 | 需求池文件格式、发布流程 |
| §3 原型规范 | DesignSystem 接口、交互/保真度要求 |
| §4 迭代数据规范 | `.sprints.json` 格式、API 端点 |
| §5 命令协议 | `/prd-new` 等命令格式与执行流程 |
| §6 元数据校验规则 | 外部产物导入校验清单、import 接口规范 |
| §7 产物放置规则 | 路径模板、归档路径、设计系统配置 |

独立 Skill（执行层）：

| Skill | 版本 | 功能 |
|-------|------|------|
| `prd-generator` | v2.0.0 | 多轮追问 + 模块化模板生成需求文档 |
| `prototype-generator` | v2.0.0 | 多页源文件 + 组装生成高保真 HTML 原型 |
| `sprint-manager` | v2.0.0 | 迭代管理（创建/关闭/归档/分配） |

### API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/requirements` | GET | 获取所有需求 |
| `/api/requirements` | POST | 创建新需求 |
| `/api/requirements/import` | POST | 导入外部产物（自动校验/补全元数据） |
| `/api/requirements/:id` | GET | 获取单个需求 |
| `/api/requirements/:id/status` | POST | 修改状态 |
| `/api/requirements/:id/priority` | POST | 修改优先级 |
| `/api/requirements/:id/sprint` | POST | 修改迭代 |
| `/api/requirements/:id/content` | POST | 修改文档正文 |
| `/api/requirements/:id/archive` | POST | 归档需求 |
| `/api/requirements/:id/prototype/import` | POST | 导入外部原型 HTML |
| `/api/requirements/:id/history` | GET | 获取版本历史 |
| `/api/sprints` | GET/POST | 获取/创建迭代 |
| `/api/sprints/:name/close` | POST | 关闭迭代 |
| `/api/sprints/:name/archive` | POST | 归档迭代下所有需求 |
| `/api/settings` | GET/POST | 获取/保存设置 |
| `/api/product-lines` | POST | 创建产品线 |
| `/api/drafts` | GET/POST | 获取/创建草稿 |
| `/api/drafts/:id` | GET/PUT/DELETE | 读取/更新/删除草稿 |
| `/api/drafts/:id/publish` | POST | 发布草稿为正式需求 |

### 测试

```bash
npx playwright test           # 运行 E2E 测试
npx playwright show-report    # 查看测试报告
```

### 开发计划

- [x] 首页统计 + 产品线卡片 + 迭代入口 + 需求池入口
- [x] 需求列表（看板 + 列表双模式）+ 拖拽 + 行内编辑 + 高级筛选
- [x] 需求详情（原型 + 文档同屏、三栏可拖拽、智能渲染引擎）
- [x] 全局搜索 + 设置弹窗（产品线/状态/优先级自定义）
- [x] 新建需求/迭代 + 归档（需求/迭代/批量）
- [x] 需求文档在线编辑 + 版本历史
- [x] 多产品线支持（复选框组）
- [x] CustomDropdown 自定义下拉组件 + 状态配色高辨识度
- [x] 需求池（草稿 CRUD + 发布为正式需求）
- [x] 导入接口（requirement import + prototype import）
- [x] Skills 体系（pm-craft-rules v2.2 + prd-generator v2 + prototype-generator v2 + sprint-manager v2）
- [x] Playwright E2E 测试 75/75 通过
