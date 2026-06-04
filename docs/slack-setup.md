# Slack Slash Command 設定 (AWS版)

`/sandbox` で sandbox-hosting に HTML を上げるためのセットアップ手順。

## 1. Slack App 作成

1. <https://api.slack.com/apps> → "Create New App" → From scratch
2. App Name: `sandbox-hosting`、ワークスペースを選択

## 2. Slash Command 追加

`Features → Slash Commands → Create New Command`

| Field | Value |
| --- | --- |
| Command | `/sandbox` |
| Request URL | `https://<API_GW_DOMAIN>/slack/upload` |
| Short Description | Publish HTML to private sandbox |
| Usage Hint | `[custom-path] <html or file URL>` |

API Gateway のドメインは `terraform output api_endpoint` で確認。

## 3. Signing Secret 投入

`Settings → Basic Information → App Credentials → Signing Secret` を SSM Parameter Store に登録:

```bash
aws ssm put-parameter \
  --name "/sandbox-hosting/SLACK_SIGNING_SECRET" \
  --type SecureString --overwrite \
  --value "<signing secret>"
```

## 4. ファイルアップロード対応（任意）

Slack の file upload で zip を共有 → Bot がそのURLを slash command の `file_url`
パラメータで渡す。`files:read` スコープを付与した Bot Token を SSM に登録すると
`files.slack.com` のプライベートファイルが取得できる。

```bash
aws ssm put-parameter \
  --name "/sandbox-hosting/SLACK_BOT_TOKEN" \
  --type SecureString --overwrite \
  --value "xoxb-..."
```

## 5. 使い方

```
/sandbox
<!DOCTYPE html><html><body><h1>Hello</h1></body></html>
```

カスタムpathを指定する場合:

```
/sandbox demo-foo
<!DOCTYPE html>...
```

ファイルURL（Slack上のzipなど）を貼る:

```
/sandbox https://files.slack.com/.../site.zip
```

成功時、ephemeral でURL が返る:

```
:white_check_mark: published https://<CDN>/20260605T120000Z_tatematsu/
```

## 6. IP 制限の説明

公開URLは `allowed_ips` (Terraform変数) に含まれるIPからのみ閲覧できる。
社外から見たい場合は社内VPN経由でアクセスするか、明示的に CIDR を追加して `terraform apply`。
