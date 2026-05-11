---
name: pm-craft-rules
version: 2.0.0
description: 7s-PM-Craft 全平台产物规范（文件协议、PRD格式、原型规范、迭代数据格式、命令协议、元数据校验规则、产物放置规则）
author: 7s-PM-Craft
---

# PM-Craft Rules

7s-PM-Craft 平台唯一的规范源。所有 Skill、脚本、AI 工具、人工操作均应遵循本文档。

---

## 1. 文件协议

### 1.1 目录结构

```
{workspace}/
├── products/
│   └── {product-line}/
│       └── REQ-{id}-{slug}/
│           ├── requirement.md
│           ├── prototype-web.html      # 可选
│           └── prototype-mobile.html   # 可选
├── archive/
│   └── {product-line}/
│       └── REQ-{id}-{slug}/
│           ├── requirement.md
│           ├── prototype-web.html
│           └── prototype-mobile.html
├── drafts/                      # 需求池草稿目录
│   └── DRAFT-{id}-{slug}.md    # 草稿文件
├── PROTOCOL.md          # 可选，若存在则优先使用
├── .sprints.json
└── .workflow-config.json  # 可选
```

### 1.2 命名规则

| 项目 | 格式 | 示例 |
|------|------|------|
| 需求 ID | `REQ-` + 6 位数字（全局自增） | `REQ-000042` |
| 草稿 ID | `DRAFT-` + 3 位数字（自增） | `DRAFT-001` |
| Slug | 英文或拼音，短横线连接，全小写，最长 40 字符 | `phone-login` |
| 文件夹名 | `REQ-{id}-{slug}` | `REQ-000001-login-page` |
| 草稿文件名 | `DRAFT-{id}-{slug}.md` | `DRAFT-001-用户反馈批量导出订单.md` |
| 文件名 | 固定为 `requirement.md`、`prototype-web.html`、`prototype-mobile.html` | — |

### 1.3 ID 分配算法

1. 扫描 `products/` 和 `archive/` 下所有 `REQ-*` 文件夹
2. 提取所有匹配 `REQ-(\d+)` 的编号
3. 取最大编号，+1
4. 格式化为 6 位前导零
5. 若工作区为空，从 `REQ-000001` 开始

### 1.4 Slug 生成算法

1. 取需求标题或描述的前 30 个字符
2. 去除所有非中英文/数字/空格的字符
3. 空格替换为短横线
4. 全部转为小写
5. 截取前 40 个字符
6. 若结果为空，使用 `"untitled"`

---

## 2. 需求文档规范

### 2.1 文件格式

单个 `requirement.md` 文件，包含：
- **YAML Front Matter**（元数据区，必须在文件顶部）
- **Markdown 正文**（需求描述、验收标准、备注）

### 2.2 YAML Front Matter 字段定义

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | string | ✅ | 由平台分配 | 格式 `REQ-000001` |
| `title` | string | ✅ | 无 | 需求标题 |
| `status` | string | ✅ | `"设计中"` | 必须在 `statusList` 中（从 Settings 获取） |
| `priority` | string | ❌ | `"P2"` | 必须在 `priorityList` 中（从 Settings 获取） |
| `platform` | array | ❌ | `["web"]` | 枚举：`"web"` / `"mobile"` |
| `product_line` | array | ❌ | `[]` | **数组格式**；读取时兼容 string（自动包装为单元素数组）；第一个元素为主产品线，决定物理文件夹路径 |
| `sprint` | string | ❌ | `""` | 空字符串 = 未分配 |
| `developer` | string | ❌ | `""` | 开发负责人 |
| `requester` | string | ❌ | `""` | 需求提出人 |
| `created` | date | ❌ | 今天 | 格式 `YYYY-MM-DD` |
| `updated` | date | ❌ | 今天 | 格式 `YYYY-MM-DD`，每次修改自动更新 |
| `due_date` | date | ❌ | `""` | 格式 `YYYY-MM-DD` |
| `tags` | array | ❌ | `[]` | 标签数组 |

### 2.3 读取容错规则

| 字段缺失 | 处理方式 |
|----------|----------|
| `status` | 默认 `"设计中"` |
| `priority` | 默认 `"P2"` |
| `platform` | 默认 `["web"]` |
| `product_line` | 默认 `[]`；若为 string 则包装为 `[value]` |
| `sprint` | 默认 `""` |
| `tags` | 默认 `[]` |
| `created` / `updated` | 默认文件修改时间 |

### 2.4 正文结构建议

```markdown
## 需求描述

### 背景
[简述产品背景和目标]

### 功能说明
1. **功能点A**：...
2. **功能点B**：...

### 用户旅程
1. 用户打开...
2. 用户点击...
3. 系统响应...

## 验收标准

- [ ] 标准1：[具体、可测试的描述]
- [ ] 标准2：[具体、可测试的描述]

## 备注

[补充注意事项]
```

### 2.5 生成规则

- `id`、`created`、`updated` 由平台自动填充，生成时可保留 `""` 或占位符
- `status` 固定为 `"设计中"`
- 所有字段必须有值，空值用 `""`（string）或 `[]`（array）表示，不能省略字段
- `platform` 和 `tags` 必须为数组格式
- 验收标准必须以 `- [ ] ` 开头，描述具体可验证

---

## 2.5 草稿文档规范（需求池）

### 2.5.1 文件格式

存储在 `drafts/` 目录下的 `.md` 文件，包含：
- **YAML Front Matter**（元数据区）
- **Markdown 正文**（需求描述）

### 2.5.2 YAML Front Matter 字段定义

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `id` | string | ✅ | 自动分配 | 格式 `DRAFT-001` |
| `type` | string | ❌ | `"idea"` | 草稿类型：`idea` / `bug` / `improvement` |
| `title` | string | ✅ | 无 | 草稿标题 |
| `status` | string | ✅ | `"draft"` | 状态：`draft` / `in_progress` / `published` / `archived` |
| `priority` | string | ❌ | `"medium"` | 优先级：`low` / `medium` / `high` |
| `source` | string | ❌ | `"self"` | 来源：`user_feedback` / `competitor` / `tech` / `self` |
| `product_line` | string | ❌ | `""` | 关联产品线（发布时使用） |
| `tags` | array | ❌ | `[]` | 标签数组 |
| `created_at` | string | ✅ | 自动 | ISO 8601 时间戳 |
| `updated_at` | string | ✅ | 自动 | ISO 8601 时间戳 |

### 2.5.3 发布流程

发布草稿时：
1. 扫描 `products/` 和 `archive/` 分配下一个 `REQ-` ID
2. 创建文件夹 `products/{product_line}/REQ-{id}-{slug}/`
3. 生成 `requirement.md`（status 设为 `"设计中"`）
4. 草稿 status 改为 `published`

---

## 3. 原型规范

### 3.1 文件格式

- 单个 HTML 文件，包含所有 CSS 和 JS（内联或 CDN）
- Web 端：响应式布局，支持 1024px+ 宽度
- 移动端：固定 375px 宽度，模拟 iPhone 视口
- **设计系统色值不应 hardcode**，应从 `designSystem` 参数读取（见下方）

### 3.2 设计系统接口规范

原型生成器（无论是什么工具）**必须**接受 `designSystem` 对象作为参数：

```typescript
interface DesignSystem {
  colors: {
    primary: string;           // 主按钮背景、高亮强调
    primaryHover?: string;      // 主按钮 hover（可选，默认 primary 变亮 10%）
    primaryActive?: string;     // 主按钮 active（可选，默认 primary 变暗 10%）
    background: string;         // 页面背景
    surface: string;           // 卡片/容器背景
    text: string;              // 正文文字
    textSecondary: string;      // 次要文字、标签
    border: string;            // 边框、分隔线
    error: string;             // 错误/警告状态
    success: string;           // 成功状态
    [key: string]: string;     // 允许扩展其他色值
  };
  fonts: {
    display: string;           // 标题字体（CSS font-family）
    body: string;              // 正文字体
    chinese?: string;          // 中文字体（可选，不填则用 body）
  };
}
```

**设计系统来源：**
- 由调用方（如 `server.js`、CLI、AI 工具）负责传入
- PM-Craft 平台的 Settings 功能应提供配置界面，存储 `designSystem` 配置
- 生成原型时，调用方从 Settings 读取配置并传入

### 3.3 原型与需求文档的关联

原型文件必须能通过以下方式之一关联到需求：
1. **放在需求文件夹内**（推荐）：`products/{line}/REQ-{id}-{slug}/prototype-web.html`
2. **HTML 内嵌 meta 标签**：`<meta name="pm-craft-requirement-id" content="REQ-000001">`

### 3.4 交互要求

- 按钮：必须有 hover（背景变亮）和 active（背景变暗）状态
- 输入框：必须有 focus 状态（边框变主色 + ring 效果）
- 表单提交：显示加载状态（按钮文字变"加载中..." + disabled）
- 错误提示：使用 error 色
- 成功提示：使用 success 色
- 页面切换：使用条件渲染（显示/隐藏 div）模拟多页面状态

### 3.5 保真度要求

| 级别 | 要求 |
|------|------|
| 高保真 | 精确应用设计系统颜色/字体、精确间距、真实文案 |
| 可交互 | 按钮可点击、表单可输入、有状态反馈 |
| 演示级 | 能走通主要用户旅程，有加载和错误状态 |

---

## 4. 迭代数据规范

### 4.1 数据存储

迭代元数据存储在 `.sprints.json`：

```json
{
  "sprints": [
    {
      "name": "迭代2",
      "status": "active",
      "created": "2026-04-15",
      "closed": null
    }
  ]
}
```

需求与迭代的关联通过 `requirement.md` 的 `sprint` 字段实现（见 2.2 节）。

### 4.2 迭代状态

| 状态 | 说明 |
|------|------|
| `active` | 进行中，可接收新需求 |
| `closed` | 已结束，不能再分配需求 |

### 4.3 迭代归档

归档迭代时：
1. 将迭代下所有 `status !== "归档"` 的需求状态改为 `"已完成"`
2. 将文件夹从 `products/{product_line}/` 移动到 `archive/{product_line}/`
3. 将迭代状态改为 `closed`，`closed` 字段设为当前日期

### 4.4 API 端点定义

PM-Craft server 运行在 `http://localhost:3456`。

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/sprints` | GET | 获取所有迭代 |
| `/api/sprints` | POST | 创建新迭代 |
| `/api/sprints/:name/close` | POST | 关闭迭代 |
| `/api/sprints/:name/archive` | POST | 归档迭代下所有需求并关闭 |
| `/api/requirements` | GET | 获取所有需求（含 sprint 字段） |
| `/api/requirements/:id/sprint` | POST | 分配/移除需求到迭代 |
| `/api/drafts` | GET | 获取所有草稿列表 |
| `/api/drafts` | POST | 创建新草稿 |
| `/api/drafts/:id` | GET | 获取单个草稿 |
| `/api/drafts/:id` | PUT | 更新草稿 |
| `/api/drafts/:id/status` | POST | 更新草稿状态 |
| `/api/drafts/:id/publish` | POST | 发布草稿为正式需求 |
| `/api/drafts/:id` | DELETE | 删除草稿 |

---

## 5. 命令协议

### 5.1 命令格式

```
/command [args] [options]
```

### 5.2 支持的命令

| 命令 | 格式 | 说明 |
|------|------|------|
| `/prd-new` | `/prd-new <描述> [options]` | 创建新需求 |
| `/prd-update` | `/prd-update <ID> <描述>` | 更新已有需求 |
| `/prd-status` | `/prd-status <ID> <状态>` | 修改需求状态 |
| `/prd-priority` | `/prd-priority <ID> <优先级>` | 修改需求优先级 |
| `/prd-sprint` | `/prd-sprint <ID> <迭代名>` | 分配需求到迭代 |
| `/prd-sprint` | `/prd-sprint <ID> --clear` | 清除迭代分配 |
| `/prd-archive` | `/prd-archive <ID>` | 归档需求 |

### 5.3 命令选项

| 选项 | 适用于 | 说明 |
|------|--------|------|
| `--platform web\|mobile\|both` | `/prd-new` | 指定平台 |
| `--priority <值>` | `/prd-new` | 指定优先级（必须在 `priorityList` 中） |
| `--product-line <名称>` | `/prd-new` | 指定产品线 |
| `--skip-prototype` | `/prd-new` | 跳过原型生成 |
| `--style <名称>` | `/prd-new` | 指定设计系统风格（如 `pm-craft`） |

### 5.4 状态和优先级值来源

执行命令前，先调用 `GET http://localhost:3456/api/settings` 获取：
- `statusList`：可用状态列表
- `priorityList`：可用优先级列表

若用户输入的值不在列表中，应提示用户可用值。

### 5.5 `/prd-new` 执行流程（规范）

1. 读取文件协议（本节 1）
2. 分配 ID（算法见 1.3）
3. 生成 slug（算法见 1.4）
4. 确定产品线（优先使用 `--product-line`，否则询问用户）
5. 创建文件夹 `products/{product-line}/REQ-{id}-{slug}/`
6. 调用 PRD 生成器，生成 `requirement.md`
7. 除非 `--skip-prototype`，调用原型生成器，生成 `prototype-*.html`
8. 返回创建成功的需求 ID 和文件路径

---

## 6. 元数据校验规则

### 6.1 目的

确保外部工具（其他 AI、手动创建、导入脚本）生成的产物符合本规范，能被 PM-Craft 平台正确读取。

### 6.2 校验清单

导入 `requirement.md` 时，必须校验以下项目：

| 校验项 | 规则 | 修复方式 |
|--------|------|----------|
| `id` 存在且格式正确 | 匹配 `REQ-\d{6}` | 自动分配新 ID |
| `title` 存在且非空 | 非 `""` 或非空 | 从正文 H1 提取或设为 "无标题" |
| `status` 在 `statusList` 中 | 从 Settings 获取列表 | 设为 `"设计中"` |
| `priority` 在 `priorityList` 中 | 从 Settings 获取列表 | 设为 `"P2"` |
| `product_line` 是数组 | 类型为 array | string 自动包装为 `[value]` |
| `platform` 是数组 | 类型为 array | string 自动包装为 `[value]` |
| `tags` 是数组 | 类型为 array | 非数组则设为 `[]` |
| `created` 存在且格式正确 | `YYYY-MM-DD` | 设为今天 |
| `updated` 存在且格式正确 | `YYYY-MM-DD` | 设为今天 |
| `sprint` 是字符串 | 类型为 string | 非字符串则设为 `""` |

### 6.3 导入接口规范

平台应提供以下导入接口：

```
POST /api/requirements/import
Body: {
  "content": "...",      // 完整的 Markdown 内容（可带或不带 front matter）
  "options": {           // 可选，覆盖或补充元数据
    "product_line": ["产品线A"],
    "priority": "P1"
  }
}
```

**执行流程：**
1. 解析 Markdown，提取 YAML front matter
2. 执行本节 6.2 的校验清单，修复或补全缺失字段
3. 用 `options` 覆盖用户指定的字段
4. 分配 ID（若缺失）
5. 生成 slug，创建文件夹
6. 写入 `products/{line}/REQ-{id}-{slug}/requirement.md`
7. 返回 `{ success, id, path }`

---

## 7. 产物放置规则

### 7.1 需求产出物

```
products/{主产品线}/REQ-{id}-{slug}/
├── requirement.md          # 必须
├── prototype-web.html     # 可选，Web 端原型
├── prototype-mobile.html  # 可选，移动端原型
└── attachments/          # 可选，其他附件
```

- `{主产品线}` = `product_line` 数组的第一个元素
- 若 `product_line` 为空数组，放到 `products/未分类/`

### 7.2 归档后路径

```
archive/{产品线}/REQ-{id}-{slug}/
```

结构不变，仅根目录从 `products/` 变为 `archive/`。

### 7.3 原型文件命名

| 文件 | 命名 | 说明 |
|------|------|------|
| Web 端原型 | `prototype-web.html` | 固定名称 |
| 移动端原型 | `prototype-mobile.html` | 固定名称 |

### 7.4 设计系统配置文件（可选）

若设计系统配置不放在 Settings 数据库，可放在工作区根目录：

```
{workspace}/
├── .design-system.json    # 设计系统配置（可选）
└── ...
```

格式遵循本节 3.2 的 `DesignSystem` 接口定义。

---

## 附录：与旧版 Skill 的对应关系

| 旧 Skill | 合并到本节 |
|----------|-------------|
| `prd-generator` | 第 2 节 |
| `prototype-generator` | 第 3 节 |
| `workflow-orchestrator` | 第 1、5 节 |
| `sprint-manager` | 第 4 节 |
| （新增） | 第 6、7 节 |

---

> **版本历史**
> - v2.1.0（2026-05-11）：新增需求池（drafts）文件协议规范；新增 8 个草稿 API 端点；草稿文件格式定义；发布流程规范。
> - v2.0.0（2026-05-09）：合并 `prd-generator`、`prototype-generator`、`workflow-orchestrator`、`sprint-manager` 为一个规范文件；新增第 6 节（元数据校验规则）和第 7 节（产物放置规则）；更新 `product_line` 为 array 格式。
> - v1.x.x：各 Skill 独立版本，见各 SKILL.md 历史记录。
