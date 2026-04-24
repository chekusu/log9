# apps/api 状态机稳定性加固报告

- 任务 ID: `477c8b7c-e3bf-43af-81ee-c6c4232f75de`
- 日期: `2026-04-24 UTC`
- 基线参考:
  - `/workspace/project/cto/output/codebase-review-report.md`
  - `/workspace/project/devops/output/test-coverage-gate-report.md`

## 结论

已完成 `apps/api` 两个高风险点的加固与复验，并保持仓库级 coverage 门禁为 100%。

关闭的风险：

1. `ingest` 的异步持久化不再伪装成“已持久化成功”，而是改为显式 `202 Accepted` 语义，并保留后台失败可观测性。
2. `query` / `db9 gateway` 的 SQL 门禁已收紧为可证明的单语句、只读语义，并覆盖危险分号/注释边界以及会产生副作用的 `SELECT INTO`、锁定读。

## 最终失败语义

`/ingest/:project/{sdk|twilio|custom}` 现在的最终语义如下：

- 鉴权失败：返回 `401`。
- 请求被接受并进入后台持久化：返回 `202`，响应体为 `{ "accepted": <n>, "persistence": "deferred" }`。
- `202` 明确表示“已接收并排入后台持久化”，**不表示已经写入 DB9**。
- 若后台 `waitUntil(...)` 中的 DB9 持久化失败：
  - 会记录 `console.error("[ingest] background persistence failed for <context>", error)`；
  - 同时让 `waitUntil` 挂载的 promise 继续 reject，保留平台侧可观测性；
  - ��返回给客户端的 `202` 不会被改写，因此失败语义是：**accepted but not durably persisted**。

这关闭了此前“客户端收到 200/received，但后台静默丢数”的歧义风险。

## 最终 SQL 规则

`assertReadOnlySql()` 现在执行以下门禁规则，`query` 路由和 `Db9Gateway` 共用同一套限制：

1. SQL 不能为空。
2. 去除字符串字面量与注释后，只允许 **单语句**；多语句直接拒绝。
3. 语句起始只能是 `SELECT` 或 `WITH`。
4. 拒绝所有写语义关键字：`INSERT`、`UPDATE`、`DELETE`、`DROP`、`ALTER`、`TRUNCATE`、`CREATE`、`REPLACE`、`GRANT`、`REVOKE`、`MERGE`、`COPY`。
5. 显式拒绝 `SELECT ... INTO ...`，因为它会创建对象，不属于只读查询。
6. 显式拒绝锁定读：`FOR UPDATE`、`FOR NO KEY UPDATE`、`FOR SHARE`、`FOR KEY SHARE`。
7. 允许安全边界内的字面量/注释内容，例如字符串中的 `;` 不会被误判为多语句。
8. 在通过校验后，会去掉末��语句终止分号以及尾部注释后的终止分号，规范化后再发往 DB9。

## 测试与覆盖率

新增/更新的验证点：

- `ingest`：`202 accepted` 语义、`waitUntil` rejection 透传、后台失败日志可观测性。
- `sql-guard`：空 SQL、多语句、注释边界、字符串中的分号、`WITH`、写 CTE、`SELECT INTO`、锁定读。
- `db9-gateway`：同一套 SQL 门禁规则在网关入口复验。
- `query routes`：NL 生成 SQL 触发上述拒绝分支时返回 `400` 与明确错误信息。

执行命令：

```bash
cd /workspace/project
corepack pnpm --filter @log9/api test
corepack pnpm --filter @log9/api test:coverage
corepack pnpm test:coverage
```

最终 coverage 摘要：

- `apps/api`: statements `100%`, functions `100%`, branches `100%`, lines `100%`
- `@log9/core`: statements `100%`, functions `100%`, branches `100%`, lines `100%`
- `@log9/cloudflare`: statements `100%`, functions `100%`, branches `100%`, lines `100%`
- 仓库聚合: statements `100%`, functions `100%`, branches `100%`, lines `100%`

仓库聚合计数：

- statements: `607/607`
- functions: `46/46`
- branches: `209/209`
- lines: `607/607`

## 风险关闭说明

- 风险 1，ingest 异步持久化失败静默丢失：已通过“`202 accepted + deferred persistence` 明确语义”与“后台 rejection + error log 可观测”关闭。
- 风险 2，query/db9 gateway SQL 语义过宽：已通过共享 `sql-guard` 收紧到单语句、只读、禁止副作用选择语句，并补齐危险边界测试关闭。

## 变更文件

- `apps/api/src/routes/ingest.ts`
- `apps/api/src/lib/sql-guard.ts`
- `apps/api/test/routes.test.ts`
- `apps/api/test/sql-guard.test.ts`
- `apps/api/test/db9-gateway.test.ts`
