# CI / GitHub Pages セットアップ

ローカル開発と GitHub 上の自動チェック・公開設定。本番デプロイは AWS への
直接実行（`./scripts/setup-aws.sh` または `terraform apply`）で行うため、
GitHub Actions から AWS への OIDC は不要。

## 1. Terraform state バックエンド

初回は local state で構築し、後から S3 バックエンドに移行するのが楽。

S3 バックエンドにする場合:

```bash
aws s3 mb s3://my-tf-state-sandbox-hosting --region ap-northeast-1
aws dynamodb create-table --table-name my-tf-locks \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region ap-northeast-1
cp terraform/backend.tf.example terraform/backend.tf
# 編集
terraform -chdir=terraform init -migrate-state
```

## 2. ワークフロー一覧

| File | Trigger | 役割 |
| --- | --- | --- |
| `ci.yml` | push to main / PR / workflow_call | typecheck・vitest・tf fmt/validate・shellcheck |
| `pages.yml` | push to main 触る `docs/site/**` | 運用ガイドを GitHub Pages へ deploy |
| `dependabot-auto-merge.yml` | dependabot PR | `version-update:semver-patch` / `semver-minor` を CI 通過後 squash auto-merge |

本番デプロイは GitHub Actions ではなく **ローカルから** 実行する。
日次 smoke test が必要になったら `scripts/healthcheck.sh` を ローカル cron /
launchd に仕込むか、ワークフローを再追加する。

## 3. GitHub Pages

- 公開 URL: <https://tatematsu-k.github.io/sandbox-hosting/>
- ソース: `docs/site/index.html`
- 設定: Repository Settings → Pages → Build and deployment → Source: **GitHub Actions**
  （`gh api -X POST /repos/<owner>/<repo>/pages -f build_type=workflow` で投入済み）
- 次回以降 `docs/site/**` を変更してmainに push すれば自動 deploy される

## 4. Dependabot 運用

- 設定ファイル: [`.github/dependabot.yml`](../.github/dependabot.yml)
- スケジュール: npm 週次（月曜 08:00 JST）、Terraform / GitHub Actions 月次
- グループ化: `@aws-sdk/*` / `@types/*` / dev tooling / security patches
- 無視ポリシー: `@aws-sdk/*` と `@types/node` の major bump は手動
- Auto-merge:
  - [`dependabot-auto-merge.yml`](../.github/workflows/dependabot-auto-merge.yml) が patch/minor の PR を CI 通過後に自動squash merge
  - **前提**: リポジトリ設定で `Settings → General → Pull Requests → Allow auto-merge` を ON
  - **前提**: branch protection で `Require status checks to pass before merging` に `CI / test` を含める

## 5. 初回 main マージ前のチェックリスト

- [ ] `terraform.tfvars` を編集（allowed_ips など）
- [ ] `./scripts/setup-aws.sh` をローカルで成功させる
- [ ] `aws ssm put-parameter` で Slack signing secret を投入
- [ ] CloudFront ディストリビューションの propagation を待つ（15-30min）
- [ ] `./scripts/healthcheck.sh` で 200 が返ることを確認
- [ ] PR を 1つ作って `ci.yml` の typecheck + tests + terraform fmt/validate が green になることを確認
