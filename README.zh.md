# log9.ai

AI 原生的集中式可观测性平台。所有日志通过单一 Cloudflare Worker（Log Worker）统一接收，写入 db9.ai PostgreSQL 数据库。SDK 不直接连接数据库，而是将 JSON 数据 POST 到 Log Worker。

[English](README.md) | [日本語](README.ja.md)

## 架构概览

```
你的 Worker          Log Worker (Hono)         db9.ai
+-----------+        +------------------+       +------------+
| @log9/sdk | -----> | /ingest/:project | ----> | PostgreSQL |
| (POST JSON)|       |                  |       | events     |
+-----------+        | /query           | ----> | spans      |
                     +------------------+       +------------+
                            ^
                            |  每 10 分钟轮询
                     +------+-------+
                     | Log9 Agent   |
                     | (wanman.ai)  |
                     +--------------+
```

三个核心组件：

| 组件 | 职责 |
|------|------|
| SDK | 采集 -- 在你的 Worker 中自动捕获错误、请求、性能数据 |
| Log Worker | 接收 + 查询 -- 统一日志入口，支持自然语言和结构化查询 |
| Agent | 分析 + 修复 -- 7x24 小时自动巡检，按严重级别触发响应 |

## 组件详解

### 1. @log9/sdk（@log9/core + @log9/cloudflare）

面向 Cloudflare Workers 的 Sentry 风格 SDK，一行代码完成接入：

```typescript
import { withLog9 } from "@log9/cloudflare";

export default withLog9(
  { dsn: "https://log.example.com/ingest/my-project/sdk", key: "your-key" },
  {
    async fetch(request, env, ctx) {
      return new Response("Hello");
    },
  }
);
```

自动捕获能力：

- 未捕获异常（uncaught errors）
- 请求/响应日志（spans）
- 面包屑（breadcrumbs）
- 性能指标（耗时、状态码等）

手动日志接口：

```typescript
log9.info("用户登录成功", { userId: "u_123" });
log9.warn("速率接近限额", { current: 95, limit: 100 });
log9.error("支付回调失败", { orderId: "ord_456" });
log9.captureException(new Error("意外的空值"));
```

传输策略：事件在内存中缓冲，批量刷入 Log Worker，减少网络开销。

### 2. Log Worker（Cloudflare Worker，基于 Hono）

#### 日志接收路由

所有日志的统一入口，通过 `X-Log9-Key` 请求头鉴权：

| 路由 | 用途 |
|------|------|
| `POST /ingest/:project/sdk` | SDK 上报的事件和 spans |
| `POST /ingest/:project/twilio` | Twilio 状态回调 |
| `POST /ingest/:project/custom` | 任意服务的通用 JSON 日志 |

每种来源都有对应的适配器（adapter），将原始数据标准化为统一的事件 schema。

#### 查询路由

统一查询接口，同时服务于人类和 Agent：

```bash
# 自然语言查询 -- Claude Haiku 生成 SQL 并执行
curl -X POST https://log.example.com/query \
  -H "X-Log9-Key: your-key" \
  -d '{"q": "过去一小时有哪些 500 错误？"}'

# 结构化查询 -- 直接构建 SQL，无 LLM 开销
curl -X POST https://log.example.com/query \
  -H "X-Log9-Key: your-key" \
  -d '{"project": "tuwa", "level": ["error"], "since": "1h"}'
```

- 支持 `format: "json"`（API 调用）和 `format: "html"`（浏览器暗色表格）
- 安全限制：仅允许 SELECT / WITH 语句

### 3. Log9 Agent（运行在 wanman.ai 中）

7x24 小时常驻代理，以 AGENT.md 技能文件的形式接入 wanman.ai 的 Agent 矩阵。

运行周期（每 10 分钟）：

1. 查询最新日志
2. 分析异常模式
3. 生成发现报告
4. 根据严重级别触发响应

响应策略：

| 级别 | 动作 |
|------|------|
| Critical | 引导开发方向，立即干预 |
| High | 通知运维团队 |
| Medium | 创建待办任务 |
| Low | 记录并持续跟踪 |

### 4. db9 数据库 Schema

两张核心表：

- `events` -- 日志事件，包含 JSONB 类型的 tags 和 extra 字段，配有 GIN 索引
- `spans` -- 请求链路追踪，同样使用 JSONB + GIN 索引

初始化脚本：`scripts/bootstrap-db9.sql`

## 技术栈

| 类别 | 技术 |
|------|------|
| 语言 | TypeScript 5.7 |
| 包管理 | pnpm + Turborepo |
| 运行时 | Cloudflare Workers |
| Web 框架 | Hono |
| 数据库 | db9.ai（PostgreSQL） |
| AI | Claude Haiku（自然语言查询） |
| Agent 运行时 | wanman.ai |

## 项目结构

```
log9.ai/
├── packages/
│   ├── core/              # @log9/core -- 类型定义、transport、事件构建器
│   └── sdk-cloudflare/    # @log9/cloudflare -- Workers 自动埋点
├── apps/
│   └── api/               # Log Worker（日志接收 + 查询服务）
├── agent/                 # wanman agent 技能文件
├── scripts/               # db9 数据库初始化脚本
└── docs/plans/            # 设计文档
```

## 快速开始

### 1. 安装 SDK

在你的 Cloudflare Worker 项目中添加依赖：

```bash
pnpm add @log9/cloudflare
```

用 `withLog9` 包裹你的 Worker：

```typescript
import { withLog9 } from "@log9/cloudflare";

export default withLog9(
  {
    dsn: "https://your-log-worker.workers.dev/ingest/your-project/sdk",
    key: "your-log9-key",
  },
  yourWorker
);
```

### 2. 配置 Log Worker Secrets

```bash
cd apps/api

# 数据库连接
wrangler secret put DB9_URL          # db9.ai PostgreSQL 连接字符串

# 鉴权
wrangler secret put LOG9_API_KEY     # 用于验证 SDK 和查询请求

# 自然语言查询（可选）
wrangler secret put ANTHROPIC_API_KEY  # Claude Haiku，用于自然语言转 SQL
```

### 3. 初始化数据库

将 `scripts/bootstrap-db9.sql` 在你的 db9.ai PostgreSQL 实例上执行：

```bash
psql "$DB9_URL" -f scripts/bootstrap-db9.sql
```

### 4. 部署

```bash
# 构建所有包
pnpm build

# 部署 Log Worker
cd apps/api
pnpm deploy
```

## 本地开发

```bash
# 安装依赖
pnpm install

# 启动所有包的开发模式（watch）
pnpm dev

# 单独启动 Log Worker（端口 3151）
cd apps/api
pnpm dev

# 类型检查
pnpm typecheck
```

## 许可证

私有项目，保留所有权利。
