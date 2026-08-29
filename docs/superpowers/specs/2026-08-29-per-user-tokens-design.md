# Per-user upload tokens — design

## 背景・目的

現在、`/upload` `/list` `/activate` `/delete` API は単一の共有シークレット
(`UPLOAD_TOKEN`, SSM SecureString, `terraform/secrets.tf`)で保護されている。
アップロード者のユーザー名は `X-Sandbox-User` ヘッダーの自己申告(未検証)で決まり、
トークン自体はユーザーに紐付いていない。

利用者が複数人になるにあたり、以下を実現したい:

- ユーザーごとに個別のトークンを発行できる
- トークンから検証済みのユーザー名を導出できる(なりすまし防止)
- 個々のユーザーのアクセスを他人に影響を与えずに失効させられる

Slack経由の投稿(`verifySlack`, Slack署名検証)は対象外。今回の変更はClaude Code
クライアント(`verifyBearer`)のみに関係する。

## データモデル

新規DynamoDBテーブル `${local.name}-tokens` (PAY_PER_REQUEST) を追加する。
既存の `meta` テーブル(サイトメタデータ、PK=`path`)とは責務を分離する。

| 属性 | 型 | 内容 |
|---|---|---|
| `tokenHash` (PK) | S | 生トークンのSHA-256ハッシュ(hex)。生トークンは保存しない |
| `owner` | S | ユーザー名 |
| `createdAt` | S | ISO8601 |

GSIは設置しない。`list`/`revoke`はテーブルスキャンで十分な規模(数〜数十ユーザー想定)。

## 認証フロー変更 (`src/lib/auth.ts`)

```ts
export async function verifyBearer(authorization: string | undefined): Promise<Identity> {
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  if (!match) throw new Unauthorized("missing bearer token");
  const tokenHash = createHash("sha256").update(match[1].trim()).digest("hex");
  const item = await getTokenOwner(tokenHash); // GetItem on tokens table
  if (!item) throw new Unauthorized("invalid token");
  return { username: item.owner, source: "claude-code" };
}
```

- 第2引数 `claimedUser` を削除。`src/handlers/api.ts` の4箇所の呼び出しから
  `headers["x-sandbox-user"]` の受け渡しを削除する
- `normalizeUsername()` は `owner` 保存時(issue時)に適用し、読み取り時は素通しでよい
- `timingSafeEqual` は不要(ハッシュ完全一致のキー検索に置き換わる)
- `verifySlack` は無変更

## Terraform変更

- `terraform/storage.tf`: `aws_dynamodb_table.tokens` を追加
- `terraform/iam.tf`: `lambda_app` ポリシーの `DynamoTable` statement に
  tokensテーブルへの `dynamodb:GetItem` を追加(Lambdaは読み取りのみ。
  issue/revokeは管理者がAWS CLIで直接書き込むためLambdaに書き込み権限は不要)
- `terraform/secrets.tf`: `random_password.upload_token` と
  `aws_ssm_parameter.upload_token` を削除
- `terraform/lambda.tf`: 環境変数 `UPLOAD_TOKEN_PARAM` を削除し、
  `TOKENS_TABLE = aws_dynamodb_table.tokens.name` を追加
- `terraform/outputs.tf`: `upload_token_param` outputを削除
- `src/lib/config.ts`: `uploadTokenParam()` を削除、`tokensTable()` を追加

## 管理用CLIツール `scripts/manage-tokens.sh`

管理者のAWS CLI認証情報でDynamoDBに直接読み書きする(Lambda経由ではない)。

```bash
./scripts/manage-tokens.sh issue <username>
./scripts/manage-tokens.sh list
./scripts/manage-tokens.sh revoke <username>
```

- `issue`: `openssl rand -hex 32` で生トークンを生成 → SHA-256計算 →
  `aws dynamodb put-item` で `{tokenHash, owner, createdAt}` を書き込み →
  生トークンを1度だけ標準出力に表示(以後取得不可なことを明示するメッセージを出す)
- `list`: `aws dynamodb scan` して `owner` / `createdAt` を一覧表示(トークン値・ハッシュは表示しない)
- `revoke <username>`: `owner` でスキャンしてマッチした全item(複数トークン発行済みなら全部)を
  `aws dynamodb delete-item` で削除
- 同一ユーザーに対して複数回 `issue` した場合、複数トークンが併存可能
  (ローテーションしたい場合は `revoke` 後に `issue` する運用)

## クライアント側変更

- `skills/sandbox-upload/scripts/upload.sh`: `X-Sandbox-User` ヘッダー送信を削除
  (サーバー側で無視されるため不要)。`SANDBOX_TOKEN` の扱いは変更なし
- `scripts/setup-client.sh`: `SANDBOX_USER` の入力プロンプトを削除。
  `UPLOAD_TOKEN` のプロンプト文言を「管理者から発行されたトークンを貼り付け」に変更
- `skills/sandbox-upload/SKILL.md`: 環境変数説明を更新(`SANDBOX_USER` の記述を削除)

## 移行方針

完全置き換え(段階移行なし)。既存の共有 `UPLOAD_TOKEN` は `terraform apply` で
SSMパラメータごと削除される。現時点でこの共有トークンを使っているのは本人のみのため、
影響は小さい。適用後、本人用トークンを `manage-tokens.sh issue tatematsu` で再発行し、
`~/.config/sandbox-hosting/env` を更新する。

## テスト

- `src/lib/auth.ts` の既存テストを更新: 単一トークン比較のケースを、
  tokensテーブルのモック(有効ハッシュ/無効ハッシュ/存在しないハッシュ)に置き換える
- `manage-tokens.sh` は手動確認(shellcheckは既存CIの `ci.yml` でカバー)

## スコープ外

- トークンのTTL/自動失効
- ユーザーのセルフサービス発行API
- 1ユーザー1トークンの強制
