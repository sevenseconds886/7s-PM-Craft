# 7s-PM-Craft 文件协议

> 版本：v1.0  
> 所有 Skills 和管家必须遵循此协议读写文件。

---

## 目录结构

```
{workspace}/
├── products/{product-line}/REQ-{id}-{slug}/
│   ├── requirement.md
│   ├── prototype-web.html      # 可选
│   └── prototype-mobile.html   # 可选
├── archive/{product-line}/REQ-{id}-{slug}/
│   ├── requirement.md
│   ├── prototype-web.html
│   └── prototype-mobile.html
├── PROTOCOL.md
├── .sprints.json
└── .workflow-config.json       # 可选
```

## 命名规则

- `{id}`：6 位数字，全局自增，如 `000001`
- `{slug}`：英文或拼音，短横线连接，如 `login-page`
- 文件夹名：`REQ-{id}-{slug}`，如 `REQ-000001-login-page`

## requirement.md 格式

顶部 YAML Front Matter + Markdown 正文。

### 必填字段

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | REQ-000001 |
| title | string | 需求标题 |
| status | enum | 设计中/待评审/开发中/待验收/归档/挂起 |

### 可选字段

| 字段 | 类型 | 默认值 |
|------|------|--------|
| priority | enum | P2 |
| platform | array | ["web"] |
| product_line | string | "" |
| sprint | string | "" |
| developer | string | "" |
| requester | string | "" |
| created | date | 今天 |
| updated | date | 今天 |
| due_date | date | "" |
| tags | array | [] |

## 读取容错

- 缺失 status → 默认"设计中"
- 缺失 priority → 默认"P2"
- 缺失 platform → 默认["web"]
- 缺失 sprint → 默认""

## 迭代存储

迭代信息存储在 `.sprints.json`：

```json
{
  "sprints": [
    { "name": "迭代1", "status": "active", "created": "2026-04-01", "closed": null }
  ]
}
```
