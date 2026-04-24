# apps/api 状态机稳定性最终关闭报告

- 任务 ID: `477c8b7c-e3bf-43af-81ee-c6c4232f75de`
- 日期: `2026-04-24 UTC`
- 范围: `/workspace/project/apps/api`，并补录仓库级聚合覆盖率复验结果

## 结论

`477c8b7c` 已完成最终风险关闭复验。`apps/api` 的状态机稳定性加固保持有效，且在 `2026-04-24 UTC` 重新执行仓库根级门禁后，三包与仓库聚合的 `lines/statements/functions/branches` 均为 `100%`。

## 最终失败语义

`/ingest/:project/{sdk|twilio|custom}` 的持久化语义现已固定为：

1. 鉴权失败返回 `401`。
2. 请求被接受并转入后台持久化时返回 `202 Accepted`，响应体为 `{ "accepted": <n>, "persistence": "deferred" }`。
3. `202` 仅表示事件已被接受并安排异步持久化，不表示 DB9 已经落盘。
4. 若后台 `waitUntil(...)` 内的 DB9 持久化失败：
   - 记录 `console.error("[ingest] background persistence failed for <context>", error)`；
   - 保留 `waitUntil` promise rejection，维持平台侧可观测性；
   - 客户端已收到的 `202` 不回写为成功落盘，最终失败语义为 `accepted but not durably persisted`。

## SQL 安全门禁规则

`assertReadOnlySql()` 作为 `query` 与 `db9 gateway` 的共享门禁，当前规则为：

1. SQL 不可为空。
2. 去掉字符串字面量与注释后，仅允许单语句。
3. 入口关键字仅允许 `SELECT` 或 `WITH`。
4. 拒绝写语义关键字：`INSERT`、`UPDATE`、`DELETE`、`DROP`、`ALTER`、`TRUNCATE`、`CREATE`、`REPLACE`、`GRANT`、`REVOKE`、`MERGE`、`COPY`。
5. 拒绝 `SELECT ... INTO ...`。
6. 拒绝锁定读：`FOR UPDATE`、`FOR NO KEY UPDATE`、`FOR SHARE`、`FOR KEY SHARE`。
7. 允许安全边界内的字符串/注释内容，不会把字符串内��� `;` 误判成多语句。
8. 校验通过后，会去除尾部分号与尾部注释后的终止分号，再发送到 DB9。

## 测试与覆盖率复验

执行命令：

```bash
cd /workspace/project
corepack pnpm test:coverage
```

复验结果：

- `@log9/core`: lines/statements/functions/branches = `100/100/100/100`
- `@log9/api`: lines/statements/functions/branches = `100/100/100/100`
- `@log9/cloudflare`: lines/statements/functions/branches = `100/100/100/100`
- 仓库聚合: lines/statements/functions/branches = `100/100/100/100`

仓库聚合计数：

- lines: `607/607`
- statements: `607/607`
- functions: `46/46`
- branches: `209/209`

`apps/api/coverage/coverage-summary.json` 同步显示 `statements/functions/branches/lines = 100/100/100/100`，与根级聚合复验一致。

## 风险关闭说明

- `ingest` 异步持久化失败的状态机风险已关闭：客户端语义从“可能被误解为已持久化成功”收敛为明确的 `202 deferred persistence`���并保留后台失败日志与 rejection 可观测性。
- `query/db9 gateway` 的 SQL 注入与副作用语义风险已关闭：限制为单语句、只读、拒绝危险拼接边界与副作用变体，并由测试覆盖对应拒绝分支。
- 当前残余风险不在本任务范围内：若未来引入新的 SQL 方言特性或新的异步持久化后端，需要复用现有门禁与语义约束重新补测。
