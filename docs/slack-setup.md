# Slack 連携設定 (AWS版)

sandbox-hosting に HTML/Markdown/zip をアップロードする方法は2通り。

- `/sandbox` slash command: テキストで直接HTMLを貼る、またはファイルURLを貼る
- メッセージショートカット「社内に公開」: html/md/zipファイルを添付したメッセージから直接公開(推奨)

## 1. Slack App 作成

[docs/slack-app-manifest.yml](slack-app-manifest.yml) を使うと、Slash Command・
メッセージショートカット・Bot Token Scope が設定済みの状態でアプリを作成できる
(手順1・2をまとめてスキップ可能)。

1. `terraform output api_endpoint` で API Gateway のドメインを確認し、
   `slack-app-manifest.yml` 内の `<API_GW_DOMAIN>` を置き換える
2. <https://api.slack.com/apps> → "Create New App" → **From an app manifest**
3. ワークスペースを選択 → 編集後の manifest を貼り付けて作成

> **社内Slackでカスタムアプリの導入に管理者承認が必要な場合**、インストール後も
> ショートカットが一般メンバーのメッセージメニューに出ないことがある。その場合は
> ワークスペース管理者に承認状況を確認する(コード側の問題ではない)。

手動で作る場合は以下。

### 1a. Slack App 作成(手動)

1. <https://api.slack.com/apps> → "Create New App" → From scratch
2. App Name: `sandbox-hosting`、ワークスペースを選択

### 2a. Slash Command 追加(手動)

`Features → Slash Commands → Create New Command`

| Field | Value |
| --- | --- |
| Command | `/sandbox` |
| Request URL | `https://<API_GW_DOMAIN>/slack/upload` |
| Short Description | Publish HTML to private sandbox |
| Usage Hint | `[custom-path] <html or file URL>` |

API Gateway のドメインは `terraform output api_endpoint` で確認。

### 2b. メッセージショートカット追加(手動)

`Features → Interactivity & Shortcuts` を有効化し、Request URL に
`https://<API_GW_DOMAIN>/slack/interactivity` を設定。同じページの
`Shortcuts → Create New Shortcut` で以下を追加。

| Field | Value |
| --- | --- |
| Shortcut Type | On messages |
| Name | 社内に公開 |
| Callback ID | `publish_to_sandbox` |

## 3. Signing Secret 投入

`Settings → Basic Information → App Credentials → Signing Secret` を控えておく
（投入方法は手順4でまとめて行う）。

## 4. Bot Token 発行とスコープ付与

`OAuth & Permissions → Scopes → Bot Token Scopes` で以下を追加し、ワークスペースに
インストールして `Bot User OAuth Token`(`xoxb-...`)を取得する。

| スコープ | 用途 |
| --- | --- |
| `commands` | Slash Command(`/sandbox`)を受け付けるために必須 |
| `users:read` | `users:read.email` の前提スコープ(単体では不足、必須) |
| `users:read.email` | 許可リスト登録時にメールアドレスを取得するために必須 |
| `files:read` | Slack にアップロードされた zip（`files.slack.com`）を取得する場合のみ必要（任意） |

`manifest.yml`([docs/slack-app-manifest.yml](slack-app-manifest.yml))を使って
アプリを作成した場合、この2つのスコープは既に設定済み。

Signing Secret / Bot Token を SSM Parameter Store にまとめて投入する:

```bash
./scripts/setup-slack-secrets.sh
```

非表示プロンプトで値を入力する（シェル履歴に残らない）。個別に投入したい場合は
従来通り `aws ssm put-parameter --name "/sandbox-hosting/SLACK_SIGNING_SECRET" ...`
でも良い。

`files:read` を付与しなくても `users:read.email` があれば許可リスト登録は動く。
`files.slack.com` のプライベートファイル取得のみが無効になる（public file URL は
そのまま使える）。

## 5. 利用可能ユーザーの許可リスト登録（必須）

`/sandbox` は Slack user ID ベースの許可リストにあるユーザーのみ実行できる。未登録の
ユーザーは `Unauthorized` で弾かれる。

利用者の Slack member ID は、Slack プロフィール →「…」→ `Copy member ID` で確認できる
（`U0123ABCD` の形式）。

```bash
./scripts/manage-slack-users.sh allow U0123ABCD
```

内部で Bot Token(`users:read.email`)を使って Slack からメールアドレスを取得し、
DynamoDB にキャッシュする。以後、この Slack ユーザーがアップロードしたサイトの
`owner` にはこのメールアドレスが表示される。

```bash
./scripts/manage-slack-users.sh list          # 登録済みユーザー一覧
./scripts/manage-slack-users.sh revoke U0123ABCD  # 許可を取り消す
```

メールアドレスは登録時に一度だけ取得してキャッシュする（都度 Slack API は叩かない）。
本人のメールアドレスが変わった場合は `revoke` してから再度 `allow` する。

### Claude Code トークンとの紐付け（任意）

Slackと `manage-tokens.sh issue` で発行した Claude Code のusernameを紐付けると、
Slack経由でアップロードしたサイトの `owner` がキャッシュ済みメールアドレスではなく
そのusernameになり、Claude Code側の `upload.sh list` にも同じ一覧として出てくる
ようになる。

```bash
./scripts/manage-slack-users.sh link U0123ABCD tatematsu-k
./scripts/manage-slack-users.sh unlink U0123ABCD  # 紐付け解除（表示はメールに戻る）
```

紐付け前にアップロード済みのサイトの `owner` は遡って変わらない（以後のアップロード
のみ反映される）。

## 6. 使い方(slash command)

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

## 6a. 使い方(メッセージショートカット「社内に公開」)

1. チャンネルに html、md、または zip ファイルを添付してメッセージを送信
2. そのメッセージの「…」→「社内に公開」を選択
3. 実行者にだけ見えるephemeralメッセージで結果が返る

```
:white_check_mark: index.html -> https://<CDN>/20260605T120000Z_tatematsu/
```

- 添付ファイルのうち html/md/zip 以外は無視される(mdはHTMLへ自動変換して公開)
- 複数ファイルを添付した場合は全件を個別に公開し、成功/失敗を1件ずつ列挙して返す
- html/md/zip の添付が無いメッセージで実行すると、公開はせずにその旨だけ返す

## 7. IP 制限の説明

公開URLは `allowed_ips` (Terraform変数) に含まれるIPからのみ閲覧できる。
社外から見たい場合は社内VPN経由でアクセスするか、明示的に CIDR を追加して `terraform apply`。
