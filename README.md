# Sandbox Hosting

IP制限付きの個人向けHTMLホスティング基盤。Vercel + Vercel Blob 上で動作し、
Slack slash command と Claude Code skill からアップロードする。

- 仕様: [docs/superpowers/specs/2026-06-04-sandbox-hosting-design.md](docs/superpowers/specs/2026-06-04-sandbox-hosting-design.md)
- Slack 設定: [docs/slack-setup.md](docs/slack-setup.md)
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

```bash
vercel link
vercel env add BLOB_READ_WRITE_TOKEN production
vercel env add ALLOWED_IPS production
vercel env add UPLOAD_TOKEN production
vercel env add SLACK_SIGNING_SECRET production
vercel env add CRON_SECRET production
vercel env add PUBLIC_BASE_URL production
vercel deploy --prod
```

## テスト

```bash
npm run test       # vitest 単体テスト
npm run typecheck  # TypeScript 型検査
```
