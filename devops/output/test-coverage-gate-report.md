# 全仓测试覆盖率聚合与 100% 门禁复验报告

任务 ID: `4ecb13c1-7780-4570-9007-239b70140cfa`
日期: `2026-04-24`
门禁基线: `/workspace/project/cto/output/codebase-review-report.md`

## 结论

以 CTO 基线报告为验收口径复验后，根级统一命令与统一阈值已经建立，但仓库当前 **未通过** 100% coverage 门禁。

- 统一执行命令已经固定为：`cd /workspace/project && corepack pnpm test:coverage`
- 统一阈值已经固定为：`lines/statements/functions/branches = 100%`
- 统一门禁行为已经生效：任一目标包未达 100%，根命令立即非零退出
- 当前失败点在 `apps/api`，因此仓库级聚合结论为 **failed**

这与 CTO 基线中的重点风险一致：`apps/api` 查询与 SQL 门禁逻辑仍在演进，新增分支必须被仓库级门禁拦住，不能只看单包局部结果。

## 与 CTO 基线的对应关系

`/workspace/project/cto/output/codebase-review-report.md` 明确把以下三处列为本次仓库覆盖率与稳定性验收的重点：

- `apps/api`
- `packages/core`
- `packages/sdk-cloudflare`

当前根脚本正是围绕这三者做统一验证：

1. `corepack pnpm --filter @log9/core test:coverage`
2. `corepack pnpm --filter @log9/api test:coverage`
3. `corepack pnpm --filter @log9/cloudflare test:coverage`
4. `node scripts/check-coverage.mjs`

其中第 4 步会读取三包各自的 `coverage/coverage-summary.json`，并要求：

- 每个包自身四项覆盖率都必须等于 `100`
- 三包的 `covered/total` 会再做一次仓库级加权汇总
- 汇总结果若任何一项不为 `100`，脚本继续失败

也就是说，验收不是“某个包单独 100% 即算通过”，而是“三包全部 100% 且仓库级汇总仍为 100%”。

## 当前复验结果

### 1. `packages/core`

- 命令执行成功：`corepack pnpm --filter @log9/core test:coverage`
- 当前结果：`lines 100 / statements 100 / functions 100 / branches 100`
- 证据文件：`/workspace/project/packages/core/coverage/coverage-summary.json`

### 2. `packages/sdk-cloudflare`

- 来自 `dev-3` 的补充消息显示该包任务已完成，且测试与类型检查通过
- 本地现存覆盖率摘要也显示：`lines 100 / statements 100 / functions 100 / branches 100`
- 证据文件：`/workspace/project/packages/sdk-cloudflare/coverage/coverage-summary.json`

注意：这次根级复验由于在 `apps/api` 处提前失败，没有重新跑到该包；因此这里的 100% 结论来自当前工作区覆盖率摘要与 `dev-3` 的交付结果共同佐证，而不是本次根命令的后半段输出。

### 3. `apps/api`

- 根级命令执行到该包时失败
- 当前结果：`lines 100 / statements 100 / functions 100 / branches 99.23`
- 失败热点：
  - `src/lib/sql-guard.ts` branches `91.66%`
- 证据文件：`/workspace/project/apps/api/coverage/coverage-summary.json`

Vitest 实际报错为：

```text
ERROR: Coverage for branches (97.7%) does not meet global threshold (100%)
```

说明：

- Vitest 控制台按全局阈值汇总时报的是运行期汇总值
- 覆盖率摘要文件中的最终持久化结果为 `branches 99.23`
- 两者都足以证明 `apps/api` 未达 100%，因此根门禁按预期失败

## 门禁实现核对

根 `package.json` 已提供统一入口：

```json
"test:coverage": "corepack pnpm --filter @log9/core test:coverage && corepack pnpm --filter @log9/api test:coverage && corepack pnpm --filter @log9/cloudflare test:coverage && node scripts/check-coverage.mjs"
```

三包各自 `vitest.config.ts` 已设置四项阈值均为 `100`，形成第一层单包门禁。

根脚本 `scripts/check-coverage.mjs` 再提供第二层仓库级门禁：

- 读取三包 `coverage-summary.json`
- 校验每包四项指标必须为 `100`
- 汇总三包 `covered/total`
- 输出根级 `coverage/coverage-summary.json`
- 任一包或仓库聚合不为 `100` 时抛错退出

因此，从机制上看，“仓库级统一命令、统一阈值、未达 100% 即失败”的门禁已经成立；当前未通过的原因不是门禁缺失，而是 `apps/api` 的覆盖率回退被门禁正确拦下。

## 最终执行命令

```bash
cd /workspace/project
corepack pnpm test:coverage
```

需要单独核对三包与聚合脚本时，可拆成：

```bash
corepack pnpm --filter @log9/core test:coverage
corepack pnpm --filter @log9/api test:coverage
corepack pnpm --filter @log9/cloudflare test:coverage
node scripts/check-coverage.mjs
```

## 当前验收状态

- `packages/core`：通过
- `packages/sdk-cloudflare`：通过
- `apps/api`：未通过
- 仓库级统一门禁：机制通过，当前结果失败

## 后续建议

需要由开发侧补齐 `apps/api/src/lib/sql-guard.ts` 新分支的测试覆盖，再重新执行：

```bash
cd /workspace/project
corepack pnpm test:coverage
```

只有当上述根命令完整跑过三包并成功执行 `node scripts/check-coverage.mjs` 产出根级 `coverage/coverage-summary.json` 且四项均为 `100`，本任务才算真正满足 CEO 的最终验收口径。
