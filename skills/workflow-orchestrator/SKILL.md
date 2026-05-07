---
name: workflow-orchestrator
version: 1.0.0
description: 7s-PM-Craft 工作流编排器 — 解析用户命令，协调 prd-generator 和 prototype-generator，按文件协议写入工作区
author: 7s-PM-Craft
---

# Workflow Orchestrator

7s-PM-Craft 的核心编排 Skill，负责：
1. 解析用户输入的命令
2. 读取 PROTOCOL.md 文件协议
3. 协调 prd-generator 和 prototype-generator
4. 管理文件系统（创建、更新、归档）

## 触发方式

**命令格式：** `/command [args] [options]`

支持的命令：

| 命令 | 说明 | 示例 |
|------|------|------|
| `/prd-new` | 创建新需求 | `/prd-new 登录页面，支持手机号+验证码登录` |
| `/prd-update` | 更新已有需求 | `/prd-update REQ-000001 增加微信登录方式` |
| `/prd-status` | 修改需求状态 | `/prd-status REQ-000001 开发中` |
| `/prd-priority` | 修改需求优先级 | `/prd-priority REQ-000001 P0` |
| `/prd-sprint` | 分配需求到迭代 | `/prd-sprint REQ-000001 迭代1` |
| `/prd-archive` | 归档需求 | `/prd-archive REQ-000001` |

## 工作流程

### 1. /prd-new — 创建新需求

```
输入: /prd-new <需求描述> [--platform web|mobile|both] [--priority <优先级值>] [--product-line <名称>] [--skip-prototype]
```

**执行流程：**

1. **读取协议**
   - 读取工作区根目录的 `PROTOCOL.md`
   - 确认目录结构规则

2. **分配 ID**
   - 扫描 `products/` 和 `archive/` 下所有 `REQ-*` 文件夹
   - 找到最大编号，+1 生成新 ID（6 位，如 `REQ-000042`）
   - 如果工作区为空，从 `REQ-000001` 开始

3. **生成 slug**
   - 从需求描述或标题提取关键词
   - 转换为英文或拼音，短横线连接
   - 示例：`手机号验证码登录` → `phone-login`

4. **确定产品线**
   - 优先使用 `--product-line` 参数
   - 若无参数，检查工作区已有产品线：
     - 只有 1 个 → 使用该产品线
     - 多个或无 → 询问用户

5. **创建文件夹**
   ```
   products/{product-line}/REQ-{id}-{slug}/
   ```

6. **调用 prd-generator**
   - 将需求描述 + 元数据传给 prd-generator
   - 优先级默认值：调用 `GET http://localhost:{PORT}/api/settings` 获取 `priorityList` 的第一个值；若用户指定了 `--priority`，使用用户指定的值（需在 priorityList 中）
   - 生成 `requirement.md` 内容
   - 填入分配的 id、created、updated 字段
   - 写入文件

7. **调用 prototype-generator**（除非 `--skip-prototype`）
   - 读取刚生成的 `requirement.md`
   - 根据 `platform` 字段决定生成哪些原型文件
   - 根据 `--style` 参数（如有）加载对应设计系统配置，传入 prototype-generator
   - 生成 `prototype-web.html` 和/或 `prototype-mobile.html`
   - 写入对应文件夹

8. **返回结果**
   - 输出创建成功的需求 ID 和文件路径
   - 提示用户下一步操作（查看、修改、生成原型）

### 2. /prd-update — 更新已有需求

```
输入: /prd-update <需求ID> <更新描述>
```

**执行流程：**

1. 根据 ID 找到对应的需求文件夹（扫描 products/ 和 archive/）
2. 读取现有的 `requirement.md`
3. 根据更新描述修改内容：
   - 修改需求描述 → 更新 body 部分
   - 修改元数据 → 更新 YAML front matter
4. 自动更新 `updated` 字段为当前日期
5. 写回文件

### 3. /prd-status — 修改需求状态

```
输入: /prd-status <需求ID> <新状态>
```

**执行流程：**

1. 根据 ID 找到需求文件夹
2. 读取 `requirement.md`
3. 修改 YAML front matter 中的 `status` 字段
4. 更新 `updated` 字段
5. 写回文件
6. 如果新状态为"归档"，同时执行归档操作（移动文件夹到 archive/）

**状态值来源：** 执行命令前，先调用 `GET http://localhost:{PORT}/api/settings` 获取 `statusList` 字段，使用返回数组中的值。若用户输入的状态不在列表中，应提示用户可用的状态列表。

### 4. /prd-priority — 修改需求优先级

```
输入: /prd-priority <需求ID> <优先级>
```

**执行流程：**

1. 根据 ID 找到需求文件夹
2. 读取 `requirement.md`
3. 修改 YAML front matter 中的 `priority` 字段
4. 更新 `updated` 字段
5. 写回文件

**优先级值来源：** 执行命令前，先调用 `GET http://localhost:{PORT}/api/settings` 获取 `priorityList` 字段，使用返回数组中的值。若用户输入的优先级不在列表中，应提示用户可用的优先级列表。

**优先级语义（参考）：**
- P0：最高，紧急且重要，阻断主流程
- P1：高，重要，不阻断主流程
- P2：中，常规需求
- P3：低，优化类需求
- P4/P5：极低，可延迟或取消

### 5. /prd-sprint — 分配需求到迭代

```
输入: /prd-sprint <需求ID> <迭代名称>
输入: /prd-sprint <需求ID> --clear  清除迭代分配
```

**执行流程：**

1. 根据 ID 找到需求文件夹
2. 读取 `requirement.md`
3. 修改 YAML front matter 中的 `sprint` 字段（`--clear` 时设为空字符串）
4. 更新 `updated` 字段
5. 写回文件
6. 如果指定了迭代名，检查 `.sprints.json` 是否已存在该迭代；若不存在，自动创建

**说明：** 一个需求只能属于一个迭代。使用 `--clear` 可将需求从当前迭代移出（变为"未分配"）。

### 6. /prd-archive — 归档需求

```
输入: /prd-archive <需求ID>
```

**执行流程：**

1. 根据 ID 找到需求文件夹
2. 修改 `status` 为"归档"
3. 更新 `updated` 字段
4. 将文件夹从 `products/{product-line}/` 移动到 `archive/{product-line}/`
5. 如果 archive/ 下不存在该产品线文件夹，自动创建

## 文件协议读取规则

1. 首先读取工作区根目录的 `PROTOCOL.md`
2. 如果 `PROTOCOL.md` 不存在，使用内置默认规则
3. 默认规则见本 Skill 的"目录结构"和"命名规范"章节

## 目录结构

```
{workspace}/
├── products/
│   └── {product-line}/
│       └── REQ-{id}-{slug}/
│           ├── requirement.md
│           ├── prototype-web.html
│           └── prototype-mobile.html
├── archive/
│   └── {product-line}/
│       └── REQ-{id}-{slug}/
│           ├── requirement.md
│           ├── prototype-web.html
│           └── prototype-mobile.html
├── PROTOCOL.md
└── .sprints.json
```

## 命名规范

- **ID 格式**：`REQ-` + 6 位数字（全局自增）
- **Slug 格式**：英文或拼音，短横线连接，全小写
- **文件夹名**：`REQ-{id}-{slug}`
- **文件名**：
  - `requirement.md`
  - `prototype-web.html`
  - `prototype-mobile.html`

## ID 分配算法

```
1. 扫描 products/ 和 archive/ 下所有目录
2. 提取所有匹配 REQ-(\d+) 的编号
3. 取最大编号，+1
4. 格式化为 6 位前导零（如 000042）
5. 拼接为 REQ-{编号}
```

**示例：**
- 已有 REQ-000001、REQ-000017 → 最大 17 → 下一个 18 → REQ-000018
- 工作区为空 → 从 REQ-000001 开始

**slug 生成算法：**
```
1. 取需求标题或描述的前 30 个字符
2. 去除所有非中英文/数字/空格的字符
3. 空格替换为短横线
4. 全部转为小写
5. 截取前 40 个字符
6. 若结果为空，使用 "untitled"
```

## CLI 命令参考

```
node cli.js prd-new <描述> [选项]
node cli.js prd-update <ID> <描述>
node cli.js prd-status <ID> <状态>
node cli.js prd-priority <ID> <优先级>
node cli.js prd-sprint <ID> <迭代名>|--clear
node cli.js prototype <ID>
node cli.js list
node cli.js help
```

**状态和优先级值：** 先调用 `GET http://localhost:{PORT}/api/settings` 获取当前的 `statusList` 和 `priorityList`。

**CLI 使用场景：**
- 快速创建草稿需求（比 Web 界面更快）
- 批量更新优先级/迭代
- 导出 AI Prompt（用于在 AI 工具中生成完整 PRD/原型）
