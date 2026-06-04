# CI/CD セットアップ (AWS / OIDC)

GitHub Actions から AWS にデプロイするための準備。

## 1. AWS 側: GitHub OIDC プロバイダと IAM ロール

### 1.1 OIDC provider 登録（既にあればスキップ）

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

### 1.2 デプロイ用 IAM ロール作成

`trust-policy.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": "repo:<OWNER>/<REPO>:*"
      }
    }
  }]
}
```

```bash
aws iam create-role --role-name sandbox-hosting-deploy \
  --assume-role-policy-document file://trust-policy.json

# 最小権限を理想だが、初期は PowerUser から始めて段階的に絞り込む
aws iam attach-role-policy --role-name sandbox-hosting-deploy \
  --policy-arn arn:aws:iam::aws:policy/PowerUserAccess
aws iam attach-role-policy --role-name sandbox-hosting-deploy \
  --policy-arn arn:aws:iam::aws:policy/IAMFullAccess
```

権限の最小化指針（次フェーズ）:
- S3 / DynamoDB / Lambda / API Gateway / CloudFront / EventBridge / SSM Parameter Store / CloudWatch Logs / IAM (project配下のみ) / KMS

## 2. GitHub Secrets

`Settings → Secrets and variables → Actions → New repository secret`

| Secret | 値 |
| --- | --- |
| `AWS_DEPLOY_ROLE_ARN` | `arn:aws:iam::<ACCOUNT_ID>:role/sandbox-hosting-deploy` |
| `AWS_REGION` | `ap-northeast-1` |
| `SANDBOX_API_URL` | terraform output `api_endpoint` の値 |
| `SANDBOX_VIEW_URL` | `https://<cdn_domain>` |
| `SANDBOX_HEALTHCHECK_TOKEN` | 本番 `UPLOAD_TOKEN` または専用 token |

## 3. Terraform state バックエンド

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

## 4. ワークフロー一覧

| File | Trigger | 役割 |
| --- | --- | --- |
| `ci.yml` | push to main / PR / workflow_call | typecheck・vitest・tf fmt/validate・shellcheck |
| `terraform-plan.yml` | PR with terraform/src changes | OIDC で assume role → `terraform plan` → PR にsticky comment |
| `terraform-apply.yml` | push to main with terraform/src changes | OIDC で assume role → `terraform apply -auto-approve` |
| `cron-healthcheck.yml` | 日次 04:00 UTC / 手動 | 本番への smoke test |

## 5. 環境分離（任意）

dev / prod を分ける場合は Terraform workspace か直 directory 分割を採用:

```
terraform/
├── envs/
│   ├── dev/
│   └── prod/
└── modules/
    └── ... (現在の .tf を module 化)
```

個人用途では single environment + branch protection で十分なケースが多い。

## 6. 初回 main マージ前のチェックリスト

- [ ] AWS アカウントで OIDC provider と IAM role を作成
- [ ] `terraform.tfvars` を編集（allowed_ips など）
- [ ] `./scripts/setup-aws.sh` をローカルで成功させる
- [ ] `aws ssm put-parameter` で Slack signing secret を投入
- [ ] CloudFront ディストリビューションの propagation を待つ（15-30min）
- [ ] `./scripts/healthcheck.sh` で 200 が返ることを確認
- [ ] PR を 1つ作って `terraform-plan.yml` が動くことを確認
