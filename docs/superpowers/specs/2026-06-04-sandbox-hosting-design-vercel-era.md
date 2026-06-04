# [ARCHIVED] Sandbox Hosting — Design Spec (Vercel era)

> **NOTE**: 当初の Vercel + Vercel Blob 設計です。AWS-A 構成への移行後、ファイル名通り
> アーカイブ扱いになりました。現行設計は AWS の Terraform コードと README に反映されています。

- Date: 2026-06-04
- Owner: tatematsu-k
- Status: Archived (superseded by AWS-A migration on 2026-06-05)

## 1. Purpose

Claude Code や Slack から生成した HTML を、IP 制限付きで簡単に公開・共有できる個人向け sandbox ホスティング基盤を構築する。完全な PaaS ではなく、自分と限られたメンバーが内輪で URL を共有する用途を想定。

## 2. Functional Requirements

### 2.1 アップロード
- ソース: Slack slash command（後段で webhook 経由）、Claude Code skill（CLI スクリプト）
- ペイロード: 既定は単一 `index.html`。CSS/JS を分けたい場合は zip（クライアント側がラップして送信）
- パス生成:
  - **auto path**: `{timestamp}_{username}` (例: `20260604T120000Z_tatematsu`)
  - **custom path**: クライアントが任意指定可能。`/^[a-z0-9][a-z0-9-_]{1,63}$/` に限定
- 上書きルール:
  - auto: 同一path（同タイムスタンプ&同ユーザー）は通常出現しないので衝突無し
  - custom: 同名 path は **必ず上書き**。古い blob は削除
- 副次資産: zip 展開した場合、`{path}/` 配下に元の階層を保ったまま配置

### 2.2 公開・閲覧
- URL: `https://{host}/{path}/`（末尾なし `/{path}` も同等にリダイレクト or 直接配信）
- IP 制限: `ALLOWED_IPS`（CIDR 対応のカンマ区切り）に一致するクライアントIP のみ許可。不一致は 403
- 403 / 404 はシンプルなテキストレスポンス
- 配信は Vercel Functions（middleware → route handler）経由で Blob を fetch して返す

### 2.3 TTL（auto path のみ）
- 既定 TTL: 3か月（90日）
- TTL 経過時、cron が `published/` → `unpublished/` に Blob を移動し meta を更新
- 非公開化したサイトはアクセスすると 404
- custom path は TTL 対象外（明示コマンドがない限り公開維持）

### 2.4 コマンド
| Command | 引数 | 説明 | 認証 |
| --- | --- | --- | --- |
| `upload` | content / path? / type=html\|zip | ファイル受け取り→公開 | Slack 署名 / Bearer |
| `list` | scope=mine\|all? | 自分の（or 全）サイト一覧 | 同上 |
| `activate` | path | unpublish → publish に復帰、TTL を 90 日リセット | 同上 |
| `delete` | path | blob と meta を完全削除 | 同上 |

### 2.5 認証
- **Slack**: `X-Slack-Signature` を `SLACK_SIGNING_SECRET` で HMAC 検証。username は payload の `user_name` を使用。タイムスタンプは 5 分以内
- **Claude Code (CLI)**: `Authorization: Bearer ${UPLOAD_TOKEN}` を検証。username は `X-Sandbox-User` ヘッダで指定（CLI ラッパー側で OS user / 引数から付与）
- アップロード API 自体は IP 制限の対象外（Slack サーバの IP からも到達する必要があるため）

## 3. Architecture

```
+-----------------------+       +--------------------------------+
| Claude Code skill /   |       |  Vercel (Next.js App Router)   |
| Slack slash command   |  -->  |                                 |
+-----------+-----------+       |  middleware.ts (IP allowlist)   |
            |                   |                                 |
            v                   |  /[...path]/  -> Blob fetch      |
+-----------------------+       |  /api/upload  /api/list          |
| HTTPS POST /api/*     |  -->  |  /api/activate /api/delete       |
| (Bearer / Slack sig)  |       |  /api/cron/expire-ttl (daily)   |
+-----------------------+       +-------------+------------------+
                                              |
                                              v
                                +--------------------------------+
                                |  Vercel Blob                   |
                                |  published/{path}/*            |
                                |  unpublished/{path}/*          |
                                |  meta/{path}.json              |
                                +--------------------------------+
```

## 4. Components

- `middleware.ts` — public path への IP allowlist 適用
- `app/[...path]/route.ts` — Blob 取得して HTML 配信
- `app/api/upload/route.ts` — Bearer 認証→受領→保存
- `app/api/slack/upload/route.ts` — Slack 署名検証→受領→保存
- `app/api/list/route.ts` — `meta/` を一覧
- `app/api/activate/route.ts` — unpublish → publish に戻す
- `app/api/delete/route.ts` — blob + meta 削除
- `app/api/cron/expire-ttl/route.ts` — TTL 切れ auto path を unpublish
- `lib/auth.ts` — Bearer / Slack 検証
- `lib/blob.ts` — Vercel Blob 薄いラッパー（put/get/move/del/list）
- `lib/meta.ts` — メタデータの read/write/list
- `lib/path.ts` — auto path 生成、custom path バリデーション
- `lib/ip.ts` — CIDR マッチング
- `lib/zip.ts` — zip 展開（unzipper）
- `vercel.ts` — cron 定義

## 5. Data Model

`meta/{path}.json`:
```json
{
  "path": "20260604T120000Z_tatematsu",
  "owner": "tatematsu",
  "type": "auto",
  "status": "published",
  "createdAt": "2026-06-04T12:00:00.000Z",
  "updatedAt": "2026-06-04T12:00:00.000Z",
  "ttlExpiresAt": "2026-09-02T12:00:00.000Z",
  "files": ["index.html"],
  "source": "claude-code"
}
```

- `type`: `"auto" | "custom"`
- `status`: `"published" | "unpublished" | "expired"`
- `ttlExpiresAt`: `type==="custom"` の場合 `null`
- `files`: 配信ルート直下のファイル名（zip 展開時に複数）
- `source`: `"slack" | "claude-code"`

## 6. Error Handling

- 上流入力エラー（path 形式違反、空 body 等）: 400 + JSON
- 認証失敗: 401
- IP 不一致: 403
- 存在しない path / unpublish 済: 404
- Blob / Network 障害: 502 + JSON、内部はログのみ

## 7. Testing

- ユニット: `path` バリデーション、`ip` CIDR マッチ、`zip` 展開
- 結合: ローカル `vercel dev` で `/api/upload` → `/{path}/` の往復
- 認証分岐: Slack 署名（正常 / 改ざん / 期限切れ）、Bearer（正常 / 異 token）

## 8. Security / Privacy

- `ALLOWED_IPS`、`UPLOAD_TOKEN`、`SLACK_SIGNING_SECRET`、`CRON_SECRET`、`BLOB_READ_WRITE_TOKEN` は全て Vercel env で管理
- Blob は `public` access だが `addRandomSuffix: false` でパス制御。Blob 直 URL の漏洩は二次的リスクとして許容（個人 sandbox 前提）
- HTML はあくまで信頼できる発行者のみがアップロード可能（認証で保証）
- アップロード上限: 1 ファイル 5MB / zip 10MB（Function 制限内）

## 9. Out of Scope

- 大規模マルチテナント・課金
- カスタムドメイン
- HTML 以外のフレームワーク向け SPA ホスティング（必要なら zip で対応可）
- 詳細なアクセスログ・分析ダッシュボード
