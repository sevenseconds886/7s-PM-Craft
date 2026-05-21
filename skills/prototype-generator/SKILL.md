---
name: prototype-generator
version: 2.0.0
description: 读取需求文档（MD），生成高保真可交互HTML原型。采用多页源文件+组装单HTML架构，内置PM-Craft元数据，陶土色系设计系统，可选PM-Craft导入。
author: 7s-PM-Craft
agent_created: true
---

# Prototype Generator v2

从需求文档生成高保真可交互的 HTML 原型。**多页源文件生成 → 组装为单 HTML 输出**，兼顾 AI 修改效率和 PM-Craft 导入便利。

> **规范源**：原型文件格式、设计系统接口（DesignSystem）、meta 标签关联规范见 `pm-craft-rules` §3；YAML front matter 字段定义见 `pm-craft-rules` §2.2。本 Skill 侧重生成执行逻辑。

## 核心架构：多页源文件 + 组装

```
生成过程（AI 按页工作，上下文可控）：
  pages/
  ├── page-list.html      ← 列表页（AI独立生成/修改）
  ├── page-detail.html    ← 详情页
  └── page-form.html      ← 表单页

组装输出（PM-Craft 可直接导入）：
  prototype-web.html      ← 单文件，含所有页面 + 路由 + 共享样式
```

**为什么这么做**：
- 单 HTML >1500 行时 AI 难定位修改 → 源文件按页拆分，AI 改单页
- PM-Craft 只认 `prototype-web.html` 单文件 → 组装步骤拼成单文件
- 组装是纯机械拼接，AI 可靠执行不幻觉

---

## 执行流程

```
Step 1: 采集设计系统 → Step 2: 解析需求 → Step 3: 确认页面 → Step 4: 逐页生成 → Step 5: 组装 → Step 6: 可选导入
```

### Step 1: 采集设计系统

**优先级顺序**（高→低）：

1. **用户直接提供** designSystem 对象 → 直接使用
2. **项目根目录** `.design-system.json` 文件 → 读取使用
3. **PM-Craft Settings** → `GET http://localhost:3456/api/settings` 读取
4. **默认陶土色系** → 内置于本 Skill（见下方）

向用户确认设计系统来源：
```
🎨 设计系统：
- 检测到项目 .design-system.json → 使用项目配置
- 或使用 PM-Craft 默认陶土色系（terracotta + ink）
是否使用该配置？还是提供自定义设计系统？
```

**默认陶土色系**（详细规范见 `references/design-system.md`）：

> 注：默认陶土色系是 `pm-craft-rules` §3.2 `DesignSystem` 接口的一种具体实现。接口定义的是 `primary`/`background` 等语义 key，陶土色系映射为 `primary → #C4705A`、`background → #F7F6F4` 等。

| Token | 色值 | 用途 |
|-------|------|------|
| terracotta | #C4705A | 主按钮、导航激活、CTA |
| ink-50 | #F7F6F4 | 输入框背景 |
| ink-200 | #D8D5D0 | 边框 |
| ink-700 | #4A4540 | 正文 |
| ink-900 | #1C1A17 | 标题 |

### Step 2: 解析需求文档

读取 MD 需求文档，提取关键信息：

| 提取项 | 来源章节 | 用途 |
|--------|---------|------|
| 需求 ID / 标题 / 平台 | YAML front matter | 嵌入 meta + HTML title |
| 页面列表 | `## 页面设计` | 逐页生成依据 |
| 功能结构 | `## 功能结构` (flowchart LR) | 导航结构 |
| 业务流程 | `## 业务流程` (flowchart TD) | 交互逻辑依据 |
| 需求说明 | `## 需求说明` | 组件行为定义 |

**如果文档缺少 `## 页面设计`**：根据功能结构图和需求说明推导页面列表，向用户确认。

### Step 3: 确认页面列表

```
📐 根据需求文档，推导出以下页面：
1. 列表页 — 订单列表，含筛选/搜索/分页
2. 详情页 — 订单详情，含状态流转
3. 表单页 — 新建/编辑订单

请确认页面列表，或补充调整。
```

### Step 4: 逐页生成（源文件）

每个页面生成一个独立片段文件到 `pages/` 目录。

**源文件结构**（不是完整 HTML，是页面片段）：

```html
<!-- PAGE: 列表页 | ID: page-list -->
<div id="page-list" class="page-section">
  <!-- 顶部操作栏 -->
  <div class="flex items-center justify-between mb-6">
    <h1 class="text-2xl font-semibold text-ink-900">订单管理</h1>
    <button onclick="navigate('page-form')"
      class="bg-terracotta text-white rounded-full px-5 py-2.5 text-sm font-medium
             hover:bg-terracotta-light active:bg-terracotta-dark transition-colors">
      新建订单
    </button>
  </div>
  <!-- 筛选区 -->
  ...
  <!-- 表格区 -->
  ...
</div>

<script>
// page-list 专属交互逻辑
</script>
```

**生成规则**：
- 外层用 `<div id="page-xxx" class="page-section">` 包裹
- 使用 Tailwind 语义色名（`ink-*` / `terracotta`），**禁止硬编码 hex**
- 导航跳转用 `navigate('page-xxx')`
- 页面 JS 放 `<script>` 标签
- 不写 `<html>/<head>/<body>`
- 行内注释标记区块（`<!-- 搜索栏 -->`），方便后续定位

**组件代码参考** → 详见 `references/component-spec.md`，包含：
- 按钮（主/次/危险/图标）含 DO/DON'T
- 输入框（标准/搜索/下拉）含焦点状态
- 数据展示（表格/卡片/Badge）
- 导航（顶部/底部Tab）
- 反馈（Toast/Modal）
- 页面状态（空状态/骨架屏）

### Step 5: 组装为单 HTML

将所有页面片段组装为 `prototype-web.html`。

**组装模板关键部分**：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="pm-craft-requirement-id" content="{REQ_ID}">
  <title>{需求标题} - 原型</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: { extend: {
        colors: { terracotta: '#C4705A', 'terracotta-light': '#D4896F', ... },
        fontFamily: { display: ['Georgia','serif'], body: ['system-ui','sans-serif'] }
      }}
    }
  </script>
  <style>
    .page-section { display: none; }
    .page-section.active { display: block; }
  </style>
</head>
<body class="bg-ink-50 min-h-screen">
  <nav><!-- 顶部导航 --></nav>
  <main class="max-w-7xl mx-auto px-6 py-6">
    {{PAGE_FRAGMENTS}}
  </main>
  <div id="toast-container"></div>
  <script>
    function navigate(pageId) { /* 路由切换 */ }
    function showToast(msg, type) { /* 全局 Toast */ }
    navigate('page-list'); // 初始页面
  </script>
</body>
</html>
```

**组装规则**：
1. 页面 `<div>` 片段插入 `<main>`
2. 页面 `<script>` 合并到 `</body>` 前
3. 全局路由 `navigate()` + Toast
4. `<meta name="pm-craft-requirement-id">` 嵌入需求 ID
5. Tailwind config 填入设计系统色值

### Step 6: PM-Craft 桥接（可选）

```
若 http://localhost:3456 可达：
  POST /api/requirements/{id}/prototype/import
  Body: { "content": "<完整HTML>", "platform": "web" }

若不可达：
  保存 prototype-web.html 到当前工作目录
```

---

## 设计规范（精要）

详细规范见 `references/design-system.md`，这里只列核心规则：

### 圆角：只有两级
- `rounded-full`：按钮、Badge、Tab、导航标签
- `rounded-xl`：卡片、输入框、Modal、Toast、表格容器
- ❌ 不用 `rounded-lg` / `rounded-md`（中间值易不一致）

### 背景
- 输入框/select：`bg-ink-50`（不是 bg-white）
- 页面底色：`bg-ink-50`
- 卡片/surface：`bg-white`

### 字体
- 正文：`text-sm`（14px）
- 表头：`text-xs uppercase`
- 标题：`text-2xl font-semibold`

### 间距
- 紧凑（同组）：`gap-2` / `gap-3`
- 标准（区块间）：`mb-6` / `gap-6`
- 宽松（大区块）：`mb-8` / `py-6`

### 阴影
- 卡片默认：`shadow-sm`
- 卡片 hover：`shadow-md`
- Modal/Toast：`shadow-lg`

---

## 修改工作流

用户要求修改原型时：

1. **定位**：确定修改哪个页面（对应 `pages/page-xxx.html` 源文件）
2. **修改源文件**：只改该页面的片段文件
3. **重新组装**：将所有页面片段重新拼成 `prototype-web.html`
4. **可选导入**：如有 PM-Craft，调用 prototype import API

**若用户直接给修改指令未指定页面**：根据修改内容判断涉及哪个页面，明确告知。

---

## 移动端原型

`prototype-mobile.html` 默认不生成，用户显式要求时才生成。

| 差异点 | Web 端 | 移动端 |
|--------|--------|--------|
| 宽度 | 响应式 1024px+ | 固定 375px |
| 导航 | 顶部水平 | 底部 Tab |
| 按钮 | 胶囊 | 全宽 |
| 列表项 | 紧凑 | min-height 44px |
| 弹窗 | 居中 Modal | 底部 Bottom Sheet |

---

## AI Slop 防护（关键）

AI 生成原型时最常见的"AI味"错误，**绝对不能出现**：

- ❌ `bg-blue-500` / `bg-indigo-600` 等蓝紫色系（AI 默认偏好，用 terracotta 替代）
- ❌ 所有内容都包卡片（间距和对齐本身就能分组）
- ❌ 嵌套卡片
- ❌ `alert()` / `confirm()` / `prompt()`（用自定义 Modal/Toast）
- ❌ placeholder 当 label
- ❌ 纯文字空状态（必须带引导文案+操作按钮）
- ❌ 硬编码 hex 色值（用 Tailwind 语义 token）
- ❌ 每个按钮都是主按钮（要有主次层级）
- ❌ `rounded-lg` / `rounded-md`（只用 rounded-full 和 rounded-xl）

---

## 输出质量检查清单

组装完成后自检（必须全部通过）：

- [ ] 单个 `prototype-web.html`，可独立在浏览器打开
- [ ] `<meta name="pm-craft-requirement-id">` 已嵌入
- [ ] 所有页面通过 `navigate()` 可切换
- [ ] 按钮 hover/active/disabled 状态完整
- [ ] 输入框 focus 状态（ring 效果）
- [ ] 至少一个表单有提交→加载→成功/失败的交互
- [ ] 真实文案，无"示例文字""占位符"
- [ ] 色值用 Tailwind 语义类名，无硬编码 hex
- [ ] 圆角只有 rounded-full 和 rounded-xl
- [ ] 源文件 `pages/` 保留，方便后续修改

---

## 兼容性

标准 Agent Skill，兼容 WorkBuddy / Cursor / Trae / Claude Code / Codex。

## 与 prd-generator 的衔接

```
prd-generator 产出 requirement.md
  ↓ 读取
prototype-generator 提取页面列表 + 功能结构
  ↓ 逐页生成
pages/ → 组装 prototype-web.html
  ↓ 可选
PM-Craft import API
```
