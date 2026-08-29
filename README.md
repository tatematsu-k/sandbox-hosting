# Sandbox Hosting (AWS)

IP制限付きの個人向けHTMLホスティング。AWS S3 + CloudFront + Lambda + DynamoDB 構成。
Slack slash command と Claude Code skill からアップロードする。

- アーキテクチャレビュー: [docs/architecture-review.md](docs/architecture-review.md)
- 運用者ガイド: <https://tatematsu-k.github.io/sandbox-hosting/>（ソース: [docs/site/index.html](docs/site/index.html)）
- Slack 設定: [docs/slack-setup.md](docs/slack-setup.md)
- CI/CD 設定: [docs/cicd-setup.md](docs/cicd-setup.md)
- Claude Code skill: [skills/sandbox-upload/SKILL.md](skills/sandbox-upload/SKILL.md)

## アーキテクチャ

```
Viewer ──HTTPS──► CloudFront ──OAC──► S3 (private)
                       │
                       └─ CloudFront Function (viewer-request)
                            ├─ IP allowlist (CIDR/v4/v6)
                            └─ URI rewrite (/foo/ → /published/foo/index.html)

Slack / Claude Code ──HTTPS──► API Gateway HTTP API ──► Lambda (api)
                                                            │
                                                            ├─ S3 (read/write)
                                                            ├─ DynamoDB (meta)
                                                            └─ SSM Parameter Store (secrets)

EventBridge daily ──► Lambda (cron)
                          └─ scan DynamoDB → unpublish expired
```

## エンドポイント

| Method | Path | 認証 | 用途 |
| --- | --- | --- | --- |
| GET | `https://{cdn}/{path}/[file]` | CloudFront Function | 公開HTML/アセット配信 |
| POST | `https://{api}/upload` | Bearer `UPLOAD_TOKEN` | Claude Code からアップロード |
| POST | `https://{api}/list` | 同上 | サイト一覧 |
| POST | `https://{api}/activate` | 同上 (owner一致) | 再公開 / TTLリセット |
| POST | `https://{api}/delete` | 同上 (owner一致) | 完全削除 |
| POST | `https://{api}/slack/upload` | Slack 署名 | slash command 受け口 |

## ストレージレイアウト

S3 `${CONTENT_BUCKET}`:
- `published/{path}/index.html` 他のアセット
- `unpublished/{path}/...` TTL切れ後の退避

DynamoDB `${META_TABLE}`:
- PK: `path`
- GSI `owner-index`: PK=`owner`
- Item: `{path, owner, type, status, createdAt, updatedAt, ttlExpiresAt, files, source}`

## ローカル開発

```bash
npm install
npm run typecheck
npm test
npm run build   # esbuild で dist/{api,cron}/index.mjs を生成
```

## デプロイ

### 初回（運用者）

```bash
aws configure            # アクセスキー or SSO
cd terraform
cp terraform.tfvars.example terraform.tfvars
# allowed_ips, alarm_email を編集
cd ..
./scripts/setup-aws.sh   # ビルド → terraform apply まで一括
```

apply 後、以下を手動で実施:

1. **Slack signing secret を SSM に投入** （初期値は `REPLACE_ME` のまま）
   ```bash
   aws ssm put-parameter --name "/sandbox-hosting/SLACK_SIGNING_SECRET" \
     --type SecureString --overwrite --value "<signing secret>"
   ```

2. **（任意）Slack bot token** （files.slack.com のプライベートファイル取得時のみ必要）
   ```bash
   aws ssm put-parameter --name "/sandbox-hosting/SLACK_BOT_TOKEN" \
     --type SecureString --overwrite --value "xoxb-..."
   ```
   未設定（`REPLACE_ME` のまま）の場合、Slack 経路の zip 取得は public file のみ対応。

3. **利用者ごとにトークンを発行**（Claude Code クライアントに個別配布）
   ```bash
   ./scripts/manage-tokens.sh issue <username>
   ```
   トークンは発行時に一度だけ表示される。一覧確認は `list`、失効は
   `revoke <username>`。

4. （任意）独自ドメインを当てる場合は `var.public_base_url` を実値で更新し、
   ACM 証明書を us-east-1 に発行、CloudFront に紐付け（次フェーズで Terraform 拡張予定）

## 既知の制約

- **Slack 3秒タイムアウト**: アップロード処理が cold start + S3 + DynamoDB で 3秒を超えると Slack 側がタイムアウト表示する。warm時は通常 < 1秒。
- **Slack `<URL>` 形式**: Slack はテキスト中の URL を `<https://...|表示名>` で wrap することがあるが、現状の `parseSlackText` は raw URL のみ対応。`file_url` パラメータ経由を推奨。
- **Custom path concurrent upload**: 同一 custom path に対する複数同時 upload は競合 → 最後勝ち。普通の運用では発生しない想定。
- **CloudFront Function サイズ上限 10KB**: IP allowlist の CIDR が極端に多い（数百件超）と上限に当たる可能性。その場合は WAF IP set への移管を検討。

### クライアント初期設定（各利用者）

```bash
./scripts/setup-client.sh
./scripts/healthcheck.sh
```

### 継続的インテグレーション

`.github/workflows/`:
- `ci.yml`: PR / push で typecheck + vitest + terraform fmt/validate + shellcheck
- `pages.yml`: `docs/site/**` の変更で運用ガイドを GitHub Pages へ自動 deploy
- `dependabot-auto-merge.yml`: patch / minor の Dependabot PR を CI 通過後に squash auto-merge

本番デプロイは `vercel deploy` ではなくローカルから `./scripts/setup-aws.sh`
（または `terraform -chdir=terraform apply`）で実行する運用。

## TTL ルール

- auto path (timestamp_username): 90日後に EventBridge cron が unpublish
- custom path: TTL対象外
- `POST /activate` で再公開 + TTLリセット

## テスト

```bash
npm run typecheck   # tsc
npm test            # vitest
npm run lint:tf     # terraform fmt -check
```
