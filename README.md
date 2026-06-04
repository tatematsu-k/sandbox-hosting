# Sandbox Hosting

IP制限付きの個人向けHTMLホスティング基盤。Vercel + Vercel Blob 上で動作し、
Slack slash command と Claude Code skill からアップロードする。

- 仕様: [docs/superpowers/specs/2026-06-04-sandbox-hosting-design.md](docs/superpowers/specs/2026-06-04-sandbox-hosting-design.md)
- アーキテクチャレビュー: [docs/architecture-review.md](docs/architecture-review.md)
- 運用者ガイド (HTML): [docs/site/index.html](docs/site/index.html)
- Slack 設定: [docs/slack-setup.md](docs/slack-setup.md)
- CI/CD 設定: [docs/cicd-setup.md](docs/cicd-setup.md)
- Claude Code skill: [skills/sandbox-upload/SKILL.md](skills/sandbox-upload/SKILL.md)

## エンドポイント概要

| Method | Path | 認証 | 用途 |
| --- | --- | --- | --- |
| GET | `/{path}/[file]` | IP allowlist (middleware) | 公開HTML/アセット配信 |
| POST | `/api/upload` | `Authorization: Bearer ${UPLOAD_TOKEN}` | Claude Code からのアップロード |
| POST | `/api/list` | 同上 | サイト一覧 |
| POST | `/api/activate` | 同上 | TTL再開 / unpublish解除 |
| POST | `/api/delete` | 同上 | 完全削除 |
| POST | `/api/slack/upload` | Slack signing secret | Slack slash command 受け口 |
| GET | `/api/cron/expire-ttl` | `X-Vercel-Cron` または `Bearer CRON_SECRET` | 日次TTL監視 |

## アップロード仕様

- 認証成功時、`X-Sandbox-Path` ヘッダ（または JSON `path` フィールド）に
  カスタムpathを指定すると、その slug で上書き公開する。
- 省略した場合は `{ISO8601 timestamp}_{username}` 形式の auto path で
  新規ページとして公開する。
- Content-Type:
  - `text/html` または `text/*` → 単一HTML
  - `application/zip` → 展開し配下を `published/{path}/...` に保存
  - `application/json` → `{ "html": "..." }` か `{ "zipBase64": "..." }`

## TTL ルール

- auto path: 90日後に自動で unpublish（`published/` → `unpublished/` に移動）
- custom path: TTL 対象外
- `POST /api/activate` で再公開・TTLリセット可能

## ローカル開発

```bash
npm install
cp .env.example .env.local
# .env.local を編集
npm run dev
```

ローカルでBlobを使うには `BLOB_READ_WRITE_TOKEN` を Vercel dashboard か
`vercel env pull` で取得して `.env.local` に入れる。

## デプロイ

### 初回（運用者）

```bash
./scripts/setup-vercel.sh    # vercel link + 全 env を対話で投入
vercel deploy --prod
```

### クライアント初期設定（各利用者）

```bash
./scripts/setup-client.sh    # ~/.config/sandbox-hosting/env を生成
./scripts/healthcheck.sh     # 公開→閲覧の往復チェック
```

### 継続的デプロイ

`.github/workflows/` 配下に以下を用意済み:

- `ci.yml`: PR / push で typecheck + test + shellcheck
- `deploy-preview.yml`: PR 単位で Vercel preview を自動デプロイ + コメント
- `deploy-production.yml`: main への push で本番デプロイ
- `cron-healthcheck.yml`: 日次の本番 smoke test

必要な GitHub Secrets は [docs/cicd-setup.md](docs/cicd-setup.md) を参照。

## テスト

```bash
npm run test       # vitest 単体テスト
npm run typecheck  # TypeScript 型検査
```
