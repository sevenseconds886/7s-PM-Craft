---
name: sprint-manager
version: 2.0.0
description: 7s-PM-Craft 迭代管理器 — 创建、查看、关闭、归档迭代，查看迭代下的需求分布
author: 7s-PM-Craft
agent_created: true
---

# Sprint Manager v2

7s-PM-Craft 的迭代管理 Skill，与 PM-Craft Web 平台（server.js）集成。

> **规范源**：迭代数据格式、API 端点定义、归档流程的完整规范见 `pm-craft-rules` §4。本 Skill 侧重操作指引和工作流。

## 核心概念

**迭代（Sprint）**是需求的容器。一个需求只能属于一个迭代，也可以不属于任何迭代（"未分配"）。

**迭代状态：**
- `active`：进行中，可接收新需求
- `closed`：已结束，不能再分配需求

**迭代归档**：关闭迭代时，可选择将迭代下所有需求一并归档（移动到 `archive/`）。

## 数据存储

> 详细格式见 `pm-craft-rules` §4.1-4.2

- 迭代元数据：`.sprints.json`（见 pm-craft-rules §4.1）
- 需求-迭代关联：`requirement.md` 的 `sprint` 字段（见 pm-craft-rules §2.2）

## API 端点

> 完整端点列表见 `pm-craft-rules` §4.4

PM-Craft server 运行在 `http://localhost:3300`。本 Skill 常用端点：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/sprints` | GET | 获取所有迭代 |
| `/api/sprints` | POST | 创建新迭代 |
| `/api/sprints/:name/close` | POST | 关闭迭代 |
| `/api/sprints/:name/archive` | POST | 归档迭代下所有需求并关闭 |
| `/api/requirements` | GET | 获取所有需求（含 sprint 字段） |
| `/api/requirements/:id/sprint` | POST | 分配/移除需求到迭代 |

## 命令参考

### 1. 列出所有迭代

```
GET /api/sprints
```

**输出示例：**

```json
{
  "sprints": [
    { "name": "迭代2", "status": "active", "created": "2026-04-15", "closed": null },
    { "name": "迭代1", "status": "closed", "created": "2026-04-01", "closed": "2026-05-06" }
  ]
}
```

### 2. 查看迭代需求概览

```
GET /api/requirements → 客户端过滤 sprint === 迭代名 → 按状态分组统计
```

> 注：当前无 `/api/sprints/:name/requirements` 端点，需通过 `GET /api/requirements` 全量获取后客户端过滤。

**输出格式：**

```
## 迭代2 需求概览

| 状态 | 数量 |
|------|------|
| 设计中 | 3 |
| 待评审 | 1 |
| 开发中 | 5 |
| 待验收 | 2 |
| 归档 | 0 |
| 挂起 | 0 |
| **合计** | **11** |
```

### 3. 创建新迭代

```
POST /api/sprints
Body: { "name": "迭代3" }
```

**执行流程：**

1. 验证迭代名不能为空，不能与已有迭代重名
2. 读取 `.sprints.json`
3. 添加 `{ name, status: "active", created: <today>, closed: null }`
4. 写回文件
5. 返回新迭代信息

**错误处理：**
- 迭代名已存在 → 返回 400 错误
- 迭代名为空 → 返回 400 错误

### 4. 关闭迭代

```
POST /api/sprints/:name/close
```

**执行流程：**

1. 找到指定迭代
2. 将 `status` 改为 `"closed"`，`closed` 设为当前日期
3. 写回 `.sprints.json`
4. 返回更新后的迭代

**注意：** 关闭迭代不会归档其中的需求，需求仍保留在迭代中（但迭代状态变为 closed）。

### 5. 归档迭代

```
POST /api/sprints/:name/archive
```

> 详细规范见 `pm-craft-rules` §4.3

**执行流程：**

1. 调用 `GET /api/requirements`，过滤 `sprint === name && status !== 归档`
2. 对每个未归档的需求：
   - 读取 `requirement.md`，将 `status` 改为 `"已完成"`
   - 将 `updated` 更新为当前日期
   - 将文件夹从 `products/{product_line}/` 移动到 `archive/{product_line}/`
3. 关闭迭代（status → closed，closed → today）
4. 返回 `{ success, archivedCount, failedItems }`

**说明：** 归档会同时将需求状态改为"已完成"并移动到 archive 目录。已归档的需求不受影响。

### 6. 将需求分配到迭代

```
POST /api/requirements/:id/sprint
Body: { "sprint": "迭代2" }   # sprint 字段可设为 ""（空字符串）来移除分配
```

**执行流程：**

1. 根据 ID 找到需求文件夹
2. 读取 `requirement.md`
3. 修改 `sprint` 字段（支持空字符串表示"未分配"）
4. 更新 `updated` 字段
5. 写回文件

**注意：** 如果指定了一个 `status` 为 `"closed"` 的迭代，系统应返回错误提示。

## 与 PM-Craft Web 平台的集成

Sprint Manager 的 API 端点与 PM-Craft Web 平台共用同一个 server.js：

- Web 界面通过 `server.js` 调用这些端点
- Skill 直接调用 REST API 或操作 `.sprints.json` + `requirement.md` 文件
- **数据一致性**：两者都能读写同一套文件，使用前确保 server.js 正在运行

**启动 server：**
```bash
node server.js
# 默认端口 3300
```

## 常用工作流

### 创建迭代并分配需求

1. `POST /api/sprints` → 创建新迭代
2. `GET /api/requirements` → 查看未分配的需求（`sprint === ""`）
3. `POST /api/requirements/:id/sprint` → 逐个分配到迭代

### 迭代收尾

1. `GET /api/requirements` → 客户端过滤 `sprint === 迭代名` 查看所有需求
2. 检查是否有未完成的需求 → 决定是否归档
3. 如果确认归档 → `POST /api/sprints/:name/archive`
4. 或者仅关闭迭代 → `POST /api/sprints/:name/close`

### 查看迭代进度

1. `GET /api/sprints` → 获取迭代列表
2. `GET /api/requirements` → 获取所有需求
3. 按迭代分组统计 → 展示各迭代的需求数量和状态分布

## 输出质量检查清单

操作完成后自检（必须全部通过）：

- [ ] 迭代名不能为空，不能与其他迭代重名
- [ ] 不能将需求分配到已关闭的迭代（`status === "closed"`）
- [ ] 分配需求时更新 `updated` 字段
- [ ] 归档迭代时统计成功/失败数量，报告给用户
- [ ] 关闭迭代不等于归档需求，两者是独立操作
- [ ] 未分配的需求（`sprint === ""`）显示在"未分配"分组
- [ ] 创建迭代时 `status` 固定为 `"active"`，`closed` 为 `null`
- [ ] 归档后的需求 `status` 改为 `"已完成"`，文件夹移动到 `archive/`
- [ ] 归档迭代返回 `archivedCount` 和 `failedItems`，失败项需报告给用户
- [ ] `.sprints.json` 写入后格式合法（JSON 可解析）
- [ ] 多产品线需求归档时，`product_line` 兼容 string/array（见 pm-craft-rules §2.3）

---

> **版本历史**
> - v2.0.0（2026-05-20）：去重（重复内容改为引用 pm-craft-rules）；修复幽灵端点引用；新增 `/api/requirements/:id/sprint` 端点；增强质量检查清单（11项）；添加 `agent_created` 标记。
> - v1.0.0：初始版本。
