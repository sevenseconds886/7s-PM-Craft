# 设计规范参考
# prototype-generator references — 陶土色系设计系统详细规范
# 灵感来源：impeccable-style-universal + frontend-design + PM-Craft v2.4

## 色值体系

### 主色（Terracotta 陶土色）
| Token | 色值 | 用途 |
|-------|------|------|
| terracotta | #C4705A | 主按钮、导航激活、链接、CTA |
| terracotta-light | #D4896F | hover 状态 |
| terracotta-dark | #A85A46 | active 状态 |
| terracotta/20 | rgba(196,112,90,0.2) | focus ring |

### 墨色系（Ink 墨色）
| Token | 色值 | 用途 |
|-------|------|------|
| ink-50 | #F7F6F4 | 输入框背景、次级背景 |
| ink-100 | #EDEBE8 | hover 背景、分隔 |
| ink-200 | #D8D5D0 | 边框、分隔线 |
| ink-400 | #9B968E | 次要文字、标签 |
| ink-500 | #7A756D | 正文辅助 |
| ink-700 | #4A4540 | 正文主色 |
| ink-900 | #1C1A17 | 标题、强调 |

### 语义色
| Token | 色值 | 用途 |
|-------|------|------|
| emerald-500 | #10B981 | 成功状态 |
| emerald-50 | #ECFDF5 | 成功背景 |
| amber-500 | #F59E0B | 进行中/警告 |
| amber-50 | #FFFBEB | 进行中背景 |
| red-500 | #EF4444 | 错误/危险 |
| red-50 | #FEF2F2 | 错误背景 |

### 设计原则
- **不使用纯黑 #000 和纯白 #fff**：标题用 ink-900 而非黑，背景用 ink-50 而非白
- **灰色有暖色调**：ink 系列偏暖（棕灰），不是冷灰
- **60-30-10 法则**：ink 中性色占 60%，terracotta 强调占 10%，语义色按需占 30%

## 圆角体系

| 元素 | 圆角 | Tailwind |
|------|------|---------|
| 按钮、Badge、Tab | 胶囊 | `rounded-full` |
| 卡片、容器 | 大圆角 | `rounded-xl` |
| 输入框、选择框 | 大圆角 | `rounded-xl` |
| Modal | 大圆角 | `rounded-xl` |
| Toast | 大圆角 | `rounded-xl` |
| 表格容器 | 大圆角 | `rounded-xl`（外层容器） |

❌ DON'T: `rounded-lg` / `rounded-md`（中间值容易不一致）
✅ DO: 只用 `rounded-full` 和 `rounded-xl` 两级

## 阴影体系

| 级别 | Tailwind | 用途 |
|------|---------|------|
| sm | `shadow-sm` | 卡片默认态 |
| md | `shadow-md` | 卡片 hover、下拉面板 |
| lg | `shadow-lg` | Modal、Toast |
| xl | `shadow-xl` | 仅用于浮层最顶级 |

## 字体体系

| 角色 | 字号 | 字重 | 用途 |
|------|------|------|------|
| 页面标题 | text-2xl | font-semibold | 页面级 H1 |
| 区块标题 | text-base | font-semibold | 区块 H3 |
| 正文 | text-sm | font-normal | 大部分文字 |
| 表头 | text-xs uppercase | font-medium | 表格列头 |
| 辅助文字 | text-xs | font-normal | 时间、提示、元数据 |

✅ DO: 字号阶梯用 2xl → base → sm → xs，层级分明
❌ DON'T: 14px 和 15px 太近——用 sm (14px) 和 base (16px) 拉开差距

## 间距体系（4pt 基准）

| Token | 值 | 用途 |
|-------|---|------|
| 1 | 4px | 极小间距 |
| 1.5 | 6px | Badge 内间距 |
| 2 | 8px | 紧凑元素间 |
| 2.5 | 10px | 图标与文字 |
| 3 | 12px | 同组元素 |
| 4 | 16px | 卡片内 padding |
| 5 | 20px | 区块间小间距 |
| 6 | 24px | 区块间标准间距 |
| 8 | 32px | 大区块间 |
| 12 | 48px | 页面级分隔 |

## 交互状态规范

### 按钮 8 态
| 状态 | 视觉处理 |
|------|---------|
| Default | bg-terracotta text-white |
| Hover | bg-terracotta-light |
| Active | bg-terracotta-dark |
| Focus | ring-2 ring-terracotta/20 |
| Disabled | opacity-50 cursor-not-allowed |
| Loading | 文字变"加载中..." + disabled |
| Error | bg-red-500（破坏性按钮） |
| Success | bg-emerald-500（确认按钮） |

### 输入框 4 态
| 状态 | 视觉处理 |
|------|---------|
| Default | bg-ink-50 border-ink-200 |
| Focus | border-terracotta + ring-2 ring-terracotta/20 |
| Error | border-red-500 + 下方错误文字 |
| Disabled | bg-ink-100 text-ink-400 cursor-not-allowed |

## AI Slop 防护清单

这些是 AI 生成原型时最容易犯的"AI味"错误：

❌ 绝对不要：
- 用 `bg-blue-500` / `bg-indigo-600` 等蓝紫色系（AI 默认偏好）
- 所有内容都包在卡片里
- 嵌套卡片（卡片内放卡片）
- 用 `alert()` / `confirm()` 代替自定义弹窗
- placeholder 当 label
- 纯文字空状态（必须带引导）
- 纯 spinner 加载（优先用骨架屏）
- `rounded-lg` / `rounded-md` 中间圆角值
- 硬编码 hex 色值（用 Tailwind 语义 token）
- 每个按钮都是主按钮（要有主次层级）
