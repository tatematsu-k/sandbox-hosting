# CI/CD セットアップ

`./.github/workflows/` 配下のワークフローを動かすために必要な GitHub Secrets / Variables。

## 必須 secrets

`Settings → Secrets and variables → Actions → New repository secret` で登録する。

| Secret | 取得元 | 用途 |
| --- | --- | --- |
| `VERCEL_TOKEN` | <https://vercel.com/account/tokens> | CLI 認証 |
| `VERCEL_ORG_ID` | `.vercel/project.json` の `orgId` | プロジェクト紐付け |
| `VERCEL_PROJECT_ID` | `.vercel/project.json` の `projectId` | プロジェクト紐付け |
| `SANDBOX_BASE_URL` | デプロイ済みURL | 日次healthcheck |
| `SANDBOX_HEALTHCHECK_TOKEN` | 本番 `UPLOAD_TOKEN` または専用token | healthcheck の Bearer |

> ローカルで `vercel link` 後 `cat .vercel/project.json` で `orgId` `projectId` を確認できる。

## 任意 environment 設定

`Settings → Environments → New environment → production`:

- Protection rules: `Required reviewers` を 1人以上設定すると、main への push 後の production deploy を承認待ちにできる
- 自動デプロイを止めたい場合は `Wait timer` や `Deployment branches` を絞る

## ワークフロー一覧

| File | Trigger | 役割 |
| --- | --- | --- |
| `ci.yml` | push to main / pull_request / workflow_call | typecheck・unit test・shellcheck |
| `deploy-preview.yml` | pull_request | Vercel preview をビルド & デプロイ、PRに自動コメント |
| `deploy-production.yml` | push to main | CI 通過後に prod デプロイ |
| `cron-healthcheck.yml` | 毎日 04:00 UTC / 手動 | 本番への smoke test |

## ローカル動作確認

```bash
npm run typecheck
npm test
bash scripts/healthcheck.sh   # 環境変数を export 済みで
```

## 初回 main マージ前の確認チェックリスト

- [ ] `vercel link` で `.vercel/project.json` を作成
- [ ] 上表の 5 secrets を GitHub に登録
- [ ] `vercel deploy` を一度ローカル/手動で実行し、Production 環境が存在することを確認
- [ ] Vercel Blob ストアを作成し production 環境にリンク
- [ ] `./scripts/setup-vercel.sh` で env を埋め切る
- [ ] PR を 1つ作って preview が立ち上がることを確認
