# log9.ai

AIネイティブな集中オブザーバビリティプラットフォーム。

すべてのログは単一の Cloudflare Worker (Log Worker) を経由して db9.ai PostgreSQL データベースに集約される。SDK はデータベースに直接接続せず、JSON を Log Worker に POST する設計になっている。

---

## アーキテクチャ概要

```
+-----------------+       +-------------------+       +----------+
|  あなたの Worker |  -->  |  Log Worker       |  -->  |  db9.ai  |
|  (@log9/sdk)    | POST  |  (受信 + クエリ)   |  SQL  | PostgreSQL|
+-----------------+       +-------------------+       +----------+
                                  ^
                                  |  POST /query
                          +-------+-------+
                          |  Log9 Agent   |
                          | (wanman.ai)   |
                          +---------------+
```

3つのコンポーネントで構成される:

| コンポーネント | 役割 |
|----------------|------|
| **SDK** (`@log9/core` + `@log9/cloudflare`) | ログ収集 |
| **Log Worker** (Cloudflare Worker, Hono) | ログ受信 + クエリ |
| **Log9 Agent** (wanman.ai ランタイム) | ログ分析 + 自動修正 |

---

## コンポーネント詳細

### 1. @log9/sdk

Sentry風の SDK で、Cloudflare Workers 向けに設計されている。`@log9/core`(型定義、トランスポート、イベントビルダー)と `@log9/cloudflare`(Workers 自動計装)の2パッケージで構成される。

**1行で導入できる:**

```ts
import { withLog9 } from "@log9/cloudflare";

export default withLog9(
  {
    dsn: "https://log.example.com/ingest/my-project/sdk",
    key: "your-log9-key",
  },
  {
    async fetch(request, env, ctx) {
      // あなたの Worker ロジック
      return new Response("OK");
    },
  }
);
```

**自動キャプチャ:**

- 未捕捉の例外
- リクエスト/レスポンスのロギング (スパン)
- ブレッドクラム
- パフォーマンスメトリクス

**手動ロギング:**

```ts
log9.info("ユーザーがログインしました", { userId: "abc" });
log9.warn("レート制限に近づいています");
log9.error("決済処理に失敗しました", { orderId: "xyz" });
log9.captureException(new Error("予期しないエラー"));
```

**バッチ送信:** イベントはバッファされ、バッチ単位でフラッシュされる。

---

### 2. Log Worker

Cloudflare Worker 上で動作する Hono アプリケーション。ログ受信とクエリの2つの機能を持つ。

#### 受信ルート

すべてのログの統一的なエントリーポイント。

| ルート | 用途 |
|--------|------|
| `POST /ingest/:project/sdk` | SDK イベント + スパン |
| `POST /ingest/:project/twilio` | Twilio ステータスコールバック |
| `POST /ingest/:project/custom` | 任意のサービスからの汎用 JSON |

認証は `X-Log9-Key` ヘッダーで行う。

#### クエリルート

人間とエージェントの両方に対応する統一クエリインターフェース。

**自然言語クエリ** -- Claude Haiku が SQL を生成して実行する:

```bash
curl -X POST https://log.example.com/query \
  -H "Content-Type: application/json" \
  -d '{"q": "過去1時間のエラーを全て表示"}'
```

**構造化クエリ** -- LLM コストなしで直接 SQL を組み立てる:

```bash
curl -X POST https://log.example.com/query \
  -H "Content-Type: application/json" \
  -d '{"project": "tuwa", "level": ["error"], "since": "1h"}'
```

- `format: "json"` -- API レスポンス
- `format: "html"` -- ブラウザ向けダークテーブル表示
- 安全性: `SELECT` / `WITH` クエリのみ許可

---

### 3. Log9 Agent

wanman.ai ランタイム上で動作する 24時間365日稼働のキープアライブエージェント。wanman.ai のエージェントマトリクスに接続し、AGENT.md スキルファイルで定義される。

**動作サイクル (10分間隔):**

1. ログをクエリ
2. パターンを分析
3. 検出結果をレポート
4. 必要に応じて修正をトリガー

**優先度に応じたアクション:**

| 重要度 | アクション |
|--------|------------|
| Critical | 開発を誘導 (steer dev) |
| High | DevOps に通知 |
| Medium | タスクを作成 |
| Low | 追跡のみ |

---

### 4. db9 スキーマ

`events` テーブルと `spans` テーブルで構成される。タグと追加データは JSONB カラムに格納し、GIN インデックスで高速検索を実現する。

スキーマの初期化は `scripts/bootstrap-db9.sql` で行う。

---

## 技術スタック

| カテゴリ | 技術 |
|----------|------|
| 言語 | TypeScript 5.7 |
| パッケージ管理 | pnpm + Turborepo |
| ランタイム | Cloudflare Workers |
| Web フレームワーク | Hono |
| データベース | db9.ai (PostgreSQL) |
| AI (クエリ生成) | Claude Haiku |
| AI (エージェント) | wanman.ai |

---

## プロジェクト構成

```
log9.ai/
├── packages/
│   ├── core/              # @log9/core — 型定義、トランスポート、イベントビルダー
│   └── sdk-cloudflare/    # @log9/cloudflare — Workers 自動計装
├── apps/
│   └── api/               # Log Worker (ログ受信 + クエリ)
├── agent/                 # wanman agent スキルファイル
├── scripts/               # db9 スキーマ初期化
├── docs/plans/            # 設計ドキュメント
├── turbo.json             # Turborepo 設定
├── pnpm-workspace.yaml    # ワークスペース定義
└── tsconfig.base.json     # 共通 TypeScript 設定
```

---

## クイックスタート

### 前提条件

- Node.js >= 20
- pnpm >= 10.28

### 1. SDK のインストールと導入

対象の Cloudflare Worker プロジェクトに SDK を追加する:

```bash
pnpm add @log9/core @log9/cloudflare
```

Worker のエントリーポイントを `withLog9` でラップする:

```ts
import { withLog9 } from "@log9/cloudflare";

export default withLog9(
  {
    dsn: "https://log.example.com/ingest/your-project/sdk",
    key: "your-log9-key",
  },
  yourWorker
);
```

### 2. Log Worker のシークレット設定

Log Worker に必要な環境変数を設定する:

```bash
wrangler secret put DB9_CONNECTION_STRING
wrangler secret put LOG9_API_KEY
wrangler secret put ANTHROPIC_API_KEY
```

### 3. db9 スキーマの初期化

db9.ai の PostgreSQL データベースに対してスキーマを適用する:

```bash
psql "$DB9_CONNECTION_STRING" -f scripts/bootstrap-db9.sql
```

### 4. デプロイ

```bash
pnpm build
cd apps/api && pnpm deploy
```

---

## 開発

```bash
# 依存関係のインストール
pnpm install

# 全パッケージの開発サーバーを起動
pnpm dev

# ビルド
pnpm build

# 型チェック
pnpm typecheck

# クリーンアップ
pnpm clean
```

Log Worker の開発サーバーはポート `3151` で起動する。

---

## ライセンス

Private
