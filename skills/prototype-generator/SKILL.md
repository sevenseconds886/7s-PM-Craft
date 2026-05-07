---
name: prototype-generator
version: 1.1.0
description: 根据需求文档生成高保真 HTML 原型（web 端和移动端），设计系统由调用方通过 designSystem 参数传入
author: 7s-PM-Craft
---

# Prototype Generator

根据 requirement.md 的内容，生成可直接在浏览器中预览的高保真 HTML 原型。
**设计系统完全由调用方控制**，Skill 只负责生成规范的文件结构、交互逻辑和组件行为。

## 触发方式

由 workflow-orchestrator 调用，或独立使用。

## 输入

- `requirement`（object，必填）：已解析的需求文档对象，包含 front matter 和 body
- `platform`（enum，可选）："web" | "mobile" | "both"（默认 "both"）
- `designSystem`（object，可选）：设计系统配置，由调用方传入。若不传入，使用以下最小默认值（仅供预览）：
  ```json
  {
    "colors": {
      "primary": "#333333",
      "primaryHover": "#555555",
      "primaryActive": "#222222",
      "background": "#ffffff",
      "surface": "#f5f5f5",
      "text": "#333333",
      "textSecondary": "#666666",
      "border": "#e0e0e0",
      "error": "#cc0000",
      "success": "#2e7d32"
    },
    "fonts": {
      "display": "Georgia, serif",
      "body": "system-ui, sans-serif",
      "chinese": "PingFang SC, Microsoft YaHei, sans-serif"
    }
  }
  ```

**设计系统来源说明：**
- 调用 workflow-orchestrator 时：通过 `--style` 参数指定风格（如 `--style pm-craft`），orchestrator 读取对应风格配置文件后传入
- 直接使用本 Skill 时：由调用方自行构造 `designSystem` 对象传入
- 如需使用其他开源设计系统 Skill，直接替换本 Skill 即可

## 输出

根据 platform 参数，生成以下文件之一或全部：

- `prototype-web.html`：桌面端/Web 端高保真原型
- `prototype-mobile.html`：移动端高保真原型（375×667 视口）

## 生成规则

### 1. 文件规范

- 单个 HTML 文件，包含所有 CSS 和 JS（内联或 CDN）
- Web 端：响应式布局，支持 1024px+ 宽度
- 移动端：固定 375px 宽度，模拟 iPhone 尺寸
- 使用 Tailwind CSS（CDN 引入）进行样式设计
- 不在 HTML 里 hardcode 任何具体色值或字体，全部从 `designSystem` 参数中读取

### 2. HTML 基础模板

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[需求标题] - 原型</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    // 设计系统配置（由 designSystem 参数动态生成）
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            /* 根据 designSystem.colors 动态生成 Tailwind 色板 */
            primary:   '{PRIMARY_COLOR}',
            surface:   '{SURFACE_COLOR}',
            border:    '{BORDER_COLOR}',
            textMain:  '{TEXT_COLOR}',
            textSub:   '{TEXT_SECONDARY_COLOR}',
            error:     '{ERROR_COLOR}',
            success:   '{SUCCESS_COLOR}',
          },
          fontFamily: {
            display: ['{DISPLAY_FONT}', 'Georgia', 'serif'],
            body:    ['{BODY_FONT}', 'system-ui', 'sans-serif'],
          },
        },
      },
    }
  </script>
  <style>
    /* 允许补充自定义样式 */
  </style>
</head>
<body>
  <!-- 原型内容 -->
  <script>
    // 交互脚本：读取设计系统变量并应用
    const ds = {DESIGNSYSTEM_JSON};
  </script>
</body>
</html>
```

**模板变量说明：**

| 占位符 | 来源 | 说明 |
|--------|------|------|
| `{PRIMARY_COLOR}` | `designSystem.colors.primary` | 主色调 |
| `{SURFACE_COLOR}` | `designSystem.colors.background` | 背景/卡片底色 |
| `{BORDER_COLOR}` | `designSystem.colors.border` | 边框色 |
| `{TEXT_COLOR}` | `designSystem.colors.text` | 正文文字色 |
| `{TEXT_SECONDARY_COLOR}` | `designSystem.colors.textSecondary` | 次要文字色 |
| `{ERROR_COLOR}` | `designSystem.colors.error` | 错误状态色 |
| `{SUCCESS_COLOR}` | `designSystem.colors.success` | 成功状态色 |
| `{DISPLAY_FONT}` | `designSystem.fonts.display` | 标题字体 |
| `{BODY_FONT}` | `designSystem.fonts.body` + `designSystem.fonts.chinese` | 正文字体 |
| `{DESIGNSYSTEM_JSON}` | 整个 `designSystem` 对象序列化 | 用于 JS 交互脚本 |

**生成要求：**
- 将 `{PRIMARY_COLOR}` 等占位符替换为实际的十六进制颜色值
- 将 `{DESIGNSYSTEM_JSON}` 替换为完整的 JSON 对象字符串（供 JS 使用）
- 如果设计系统提供了扩展色板（如 `primaryLight`、`surfaceHover`），一并生成到 Tailwind config 中

### 3. 设计规范

#### 3.1 设计系统约定

本 Skill 约定设计系统必须包含以下字段，生成器按此约定读取：

```typescript
interface DesignSystem {
  colors: {
    primary: string;           // 主按钮背景、高亮强调
    primaryHover: string;       // 主按钮 hover（可选，默认 primary 变亮 10%）
    primaryActive: string;     // 主按钮 active（可选，默认 primary 变暗 10%）
    background: string;        // 页面背景
    surface: string;           // 卡片/容器背景
    text: string;              // 正文文字
    textSecondary: string;     // 次要文字、标签
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

**常见设计系统风格示例（仅作参考）：**

Apple Human Interface：
```
primary: #007AFF, background: #F5F5F7, surface: #FFFFFF,
text: #1D1D1F, textSecondary: #86868B, success: #34C759, error: #FF3B30
```

Material Design：
```
primary: #1976D2, background: #FAFAFA, surface: #FFFFFF,
text: #212121, textSecondary: #757575, success: #4CAF50, error: #F44336
```

#### 3.2 组件规范

以下组件规范使用设计系统变量描述，生成时替换为实际值：

| 组件 | 规范（生成时替换变量） |
|------|------------------------|
| 主按钮 | 背景 primary，hover 时变亮，active 时变暗，文字白色 |
| 次要按钮 | 背景 surface，文字 text，hover 时边框变主色 |
| 强调按钮 | 背景 primary，hover 时变亮 |
| 输入框 | 边框 border，背景 white，focus 时边框变 primary + ring（使用 primary/20 作为 ring 色） |
| 卡片 | 背景 surface，圆角 shadow，padding 合理 |
| 列表项 | 底部 border 分隔，hover 时背景 surface 变亮 |
| 导航栏 | 背景 surface，底部 border 分隔 |
| 标签/徽章 | 背景 primary/10，文字 primary，圆角全圆 |

**替换规则：**
- `primary` → `{PRIMARY_COLOR}`
- `surface` → `{SURFACE_COLOR}`
- `border` → `{BORDER_COLOR}`
- `text` → `{TEXT_COLOR}`
- `textSecondary` → `{TEXT_SECONDARY_COLOR}`
- `primary/20`（Tailwind opacity）→ 将 primary 色值透明度 20% 的值，或用 `rgba(primary, 0.2)`

#### 3.3 交互要求

- **按钮**：必须有 hover（背景变亮）和 active（背景变暗）状态
- **输入框**：必须有 focus 状态（边框变主色 + ring 效果）
- **表单提交**：显示加载状态（按钮文字变"加载中..." + disabled）
- **错误提示**：使用 error 色（如 `border-error`、`text-error`）
- **成功提示**：使用 success 色（如 `bg-success text-white`）
- **页面切换**：使用条件渲染（显示/隐藏 div）模拟多页面状态

### 4. Web 端 vs 移动端差异

#### Web 端

- 最大宽度 1200px，居中显示
- 导航栏水平排列，背景 surface，底部 border
- 表单标签左对齐
- 列表使用表格或网格布局
- 支持 hover 交互

#### 移动端

- 固定宽度 375px，模拟手机外壳
- 底部 Tab 导航（背景 surface，顶部 border）
- 全宽按钮
- 列表项更大（适合手指点击，min-height 44px）
- 使用底部弹出面板（bottom sheet）替代弹窗
- 使用 primary 作为底部 Tab 激活色

### 5. 原型保真度要求

| 级别 | 要求 |
|------|------|
| 高保真 | 精确应用设计系统颜色/字体、精确间距、真实文案 |
| 可交互 | 按钮可点击、表单可输入、有状态反馈 |
| 演示级 | 能走通主要用户旅程，有加载和错误状态 |

### 6. 输出检查清单

生成完成后，请自检：

- [ ] 单个 HTML 文件，无外部依赖（除 Tailwind CDN）
- [ ] 包含完整的 `<!DOCTYPE html>` 结构
- [ ] 所有颜色值来自 `designSystem` 参数，不在 HTML 中硬编码色值
- [ ] 所有按钮都有 hover/active 状态
- [ ] 输入框都有 focus 状态
- [ ] 主要用户旅程可以走通（至少 2-3 个页面状态）
- [ ] 有错误状态（如表单验证失败）和成功状态
- [ ] 使用真实文案，不用"示例文字""占位符"
- [ ] 标题使用 display font，正文使用 body font

## 示例

**输入：**
```yaml
requirement:
  title: 手机号验证码登录
  body: |
    ## 需求描述
    用户通过手机号和验证码登录系统。
  platform: ["web", "mobile"]
designSystem:
  colors:
    primary: "#007AFF"
    primaryHover: "#3297FF"
    primaryActive: "#0056CC"
    background: "#F5F5F7"
    surface: "#FFFFFF"
    text: "#1D1D1F"
    textSecondary: "#86868B"
    border: "#D2D2D7"
    error: "#FF3B30"
    success: "#34C759"
  fonts:
    display: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'"
    body: "-apple-system, BlinkMacSystemFont, 'SF Pro Text'"
    chinese: "PingFang SC"
```

**输出（prototype-web.html 关键结构）：**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>手机号验证码登录 - 原型</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            primary:   '#007AFF',
            surface:   '#FFFFFF',
            border:    '#D2D2D7',
            textMain:  '#1D1D1F',
            textSub:   '#86868B',
            error:     '#FF3B30',
            success:   '#34C759',
          },
          fontFamily: {
            display: ["-apple-system, BlinkMacSystemFont, 'SF Pro Display'", 'Georgia', 'serif'],
            body:    ["-apple-system, BlinkMacSystemFont, 'SF Pro Text'", 'PingFang SC', 'system-ui', 'sans-serif'],
          },
        },
      },
    }
  </script>
</head>
<body class="bg-blue-50 flex items-center justify-center p-4">
  <div class="bg-white rounded-xl shadow-md p-8 w-full max-w-md">
    <h1 class="text-2xl font-display font-semibold text-textMain mb-2">欢迎登录</h1>
    <p class="text-textSub text-sm mb-6">请使用手机号验证登录</p>

    <div class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-textMain mb-1">手机号</label>
        <input type="tel" placeholder="请输入 11 位手机号"
          class="w-full px-4 py-3 rounded-lg border border-border bg-white text-textMain
                 focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all">
      </div>

      <div class="flex gap-3">
        <div class="flex-1">
          <label class="block text-sm font-medium text-textMain mb-1">验证码</label>
          <input type="text" placeholder="6 位验证码" maxlength="6"
            class="w-full px-4 py-3 rounded-lg border border-border bg-white text-textMain
                   focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none transition-all">
        </div>
        <button id="sendCodeBtn"
          class="mt-6 px-4 py-3 bg-primary text-white rounded-lg font-medium
                 hover:bg-blue-400 active:bg-blue-700 transition-all whitespace-nowrap
                 disabled:opacity-50 disabled:cursor-not-allowed">
          获取验证码
        </button>
      </div>

      <button class="w-full py-3 bg-primary text-white rounded-lg font-medium
                     hover:bg-blue-400 active:bg-blue-700 transition-all">
        登录
      </button>
    </div>
  </div>

  <script>
    const ds = {
      colors: { primary: "#007AFF", primaryHover: "#3297FF", primaryActive: "#0056CC", background: "#F5F5F7", surface: "#FFFFFF", text: "#1D1D1F", textSecondary: "#86868B", border: "#D2D2D7", error: "#FF3B30", success: "#34C759" },
      fonts: { display: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'", body: "-apple-system, BlinkMacSystemFont, 'SF Pro Text'", chinese: "PingFang SC" }
    };
    // 交互逻辑：倒计时、提交验证等
  </script>
</body>
</html>
```
