# [ARCHIVED] Architecture Review — Sandbox Hosting (Vercel era)

> **NOTE**: このドキュメントは Vercel + Vercel Blob 構成 (commit `ebebe1b`) に対するレビューです。
> その後 AWS-A 構成へ移行した（commit `7e0964b`）ため、内容は **歴史的記録** として保持しています。
> 現行構成のレビューは [architecture-review.md](architecture-review.md) を参照してください。

- Reviewer: Claude (Opus 4.7)
- Date: 2026-06-05
- Target: commit `ebebe1b`
- Scope: Security / Authn-Authz / SLO / Cost

## TL;DR

| 領域 | 状態 | 主要リスク |
| --- | --- | --- |
| Security | ⚠️ 1 Critical, 3 High | **Blob 直URL で IP allowlist を迂回可能**（最重要） |
| Authn / Authz | ⚠️ 1 High, 2 Med | 単一共有 `UPLOAD_TOKEN` で username spoofable / `scope=all` 制限なし |
| SLO | ℹ️ 設計だけ完了 | 観測性ゼロ、cron 失敗を検知できない |
| Cost | 🟢 Pro tier で月 ~$20 | bandwidth tail risk（hot-link で青天井） |

詳細を以下に示す。

---

## 1. Security

### S-1 ⛔ Critical: Blob 直URLで IP allowlist を迂回できる

**現状**

- `lib/blob.ts` の `putBlob` は `access: "public"` + `addRandomSuffix: false` を使用。
- 結果: `https://{store-id}.public.blob.vercel-storage.com/published/{path}/index.html` が完全に予測可能で、誰でも直アクセスできる。
- middleware は **このサーバを経由しない** Blob CDN への直接アクセスを止められない。

**Impact**

- IP allowlist が設計上の砦だが、実質「URL知ってる人なら誰でも閲覧可能」。
- 個人 sandbox とはいえ、社外秘の PoC や顧客名入りの資料を上げると外部流出する。

**Mitigation 候補（推奨順）**

1. **Blob を private にする**（`@vercel/blob` ≥ 2.x で対応。現在 0.27.0 → アップグレード必要）。サーバが signed URL を生成して返す。
2. **`addRandomSuffix: true`** に戻し、`meta/{path}.json` に actual URL を保存。URLは推測不能（128bit級）になる。簡易だがあくまで obscurity。
3. **Cloudflare Worker / Vercel Edge Network 前段にカスタムドメインを置き**、Blob URL を完全に隠蔽（追加コストあり）。

→ v0.5 で (1) または (2) を採用、現状は **README で「Blob URLは漏らせば誰でも閲覧可」と明示**して限定運用すべき。

### S-2 🔴 High: アップロードされた HTML が same-origin で実行される

- 任意の JavaScript / iframe / form を含む HTML を public path に置く。
- 将来 `/api/*` に Cookie認証等が入ると CSRF / セッション窃盗の温床になる。
- 現状でも、悪意あるHTMLが `fetch('/api/list', { headers: {...} })` を試みる経路は閉じてある（Bearer は CookieJar に入らない）ので **今は緊急性は低い**。

**Mitigation**

- 将来サブドメインを分離（例: `sandbox.example.com` → 配信、`api.example.com` → 認証付き API）。
- 配信ルートに **`Content-Security-Policy: sandbox allow-scripts allow-forms`** を付与すると same-origin escape を制限できる。

### S-3 🔴 High: レートリミットが完全に欠落

- `/api/upload` `/api/list` `/api/delete` `/api/slack/upload` いずれも 1秒あたりの上限なし。
- 攻撃者が `UPLOAD_TOKEN` を入手すれば数秒で Blob を埋め尽くせる（容量・課金ともに）。
- IP制限下でも、社内端末が踏み台になった場合は壁にならない。

**Mitigation**

- 短期: Vercel Firewall の rate limit ルール（`/api/*` で 60req/min 等）。
- 中期: `@upstash/ratelimit` などで token + IP 単位の sliding window を実装。

### S-4 🔴 High: zip bomb の総量チェックは入っているが時間制限がない

- `MAX_TOTAL_BYTES = 10MB` は OK。
- ただし unzipper の deflate は CPU bound。極端なエントロピーで 60s function 時間を食い潰す DoS は可能。

**Mitigation**

- 解凍前に `entry.uncompressedSize` を見てスキップ判定（unzipper API で取れる）。
- ファイルあたり 5MB の独立上限を設ける（現状: 合計 10MB のみ）。

### S-5 🟡 Med: 観測性ゼロ（ログ・アラート無し）

- `console.error` のみ。Vercel Logs は 1h で expire。
- 失敗を後追いできない。

**Mitigation**

- Vercel Log Drains で Datadog/Logflare へ転送。
- 主要メトリクス: `upload_count{source,status}`, `view_count{status}`, `cron_runs{result}`.

### S-6 🟡 Med: `meta/*.json` が public access

- `meta/{path}.json` も Blob public で置いている。`addRandomSuffix: false` なので予測可能。
- 内部 owner/source/createdAt が公開状態になる。

**Mitigation**

- 設計上 meta は server-only。Blob private 化 (S-1) と同時に対処。

---

## 2. Authentication / Authorization

### A-1 🔴 High: `UPLOAD_TOKEN` は全員共通の単一秘密

- ローテーションは全クライアントを一斉切り替えするしかない。
- 1人がうっかり GitHub にコミット → 全員リセット。

**Mitigation**

- 短期: ENV を `UPLOAD_TOKENS=tok1:user1,tok2:user2,...` のリスト化、verifyBearer 内で match。
- 中期: KMS or Vercel KV/Marketplace KV に key→user_id mapping を保存。
- 長期: OIDC（Sign in with Vercel）or magic link → 短命 JWT 発行。

### A-2 🟡 Med: `X-Sandbox-User` ヘッダは client claim

- Bearer が正しければ任意の username を名乗れる。
- `owner !== identity.username` の owner check は **善意の運用前提**。
- Slack 経路は HMAC payload から user_name を取るのでこちらは安全。

**Mitigation**

- (A-1) の per-user token に切り替えれば自動的に解決（token→user の固定 mapping）。

### A-3 🟡 Med: `scope=all` で誰でも全サイト列挙可能

- メンバー間ではOK、外部委託者には危ない。
- 仕様としてallow設計でも、`scope=all` は admin role を別途要求する設計が望ましい。

**Mitigation**

- 環境変数 `ADMIN_USERS=tatematsu,foo` 等で whitelist。一致しなければ `scope=all` を `scope=mine` に降格。

### A-4 ✅ OK: Slack 認証

- HMAC-SHA256 + 5min replay window + timing-safe compare。
- Slack 公式ガイドラインに準拠。

### A-5 ✅ OK: Cron 認証（Cycle 1 修正後）

- Bearer `CRON_SECRET` 必須に修正済み。spoofable ヘッダ依存を廃止。

---

## 3. SLO

### S目標（提案）

| 指標 | 目標 | 現状の実装 |
| --- | --- | --- |
| Read availability | 99.9% / 30d | Vercel Functions + Blob = 計算上 99.99% |
| Read latency P50 | < 200ms | `dynamic = "force-dynamic"` で Blob 2-hop |
| Read latency P95 | < 800ms | Blob fetch + serialize で実測 600-1000ms 想定 |
| Write availability | 99.5% / 30d | Function + Blob × 2 (HTML + meta) |
| Cron success rate | 99% / 30d | 失敗時に再試行・通知なし |

### SLO-1 🟡 Med: 配信が常に `force-dynamic`

- 全 view リクエストが function を呼び、Blob を fetch する → 二重トラフィック・課金。
- IP allowlist チェックがあるので CDN cache はできない（IP 単位で edge cache 必要）。

**Mitigation**

- Vercel の **Cache Components / runtime cache** を使い、`(path, file)` キーで 60s ほどキャッシュ。Blob fetch 削減 & latency 改善。

### SLO-2 🟡 Med: 観測ゼロ → SLO 計測不可能

- Vercel Analytics は user-facing メトリクスのみ。
- 関数レベルのlatency / error rate / 5xx率 を Datadog 等で計測すべき。

### SLO-3 🟢 OK: コンカレンシ

- Vercel Functions の Fluid Compute は同一インスタンスで複数リクエスト処理可能。コールドスタートはほぼ無視できる。
- Blob: 公称 10k req/min。個人用途では十分。

### SLO-4 🔴 High: Cron 失敗が無検知

- `expire-ttl` cron が失敗してもどこにも通知が行かない。
- TTL 期限切れサイトが残り続け、想定外の公開状態になる。

**Mitigation**

- Cron 完了時にチェックインを `healthchecks.io` / `Better Stack` に POST。
- Vercel Log Drains で `[sandbox/cron]` プレフィックスをアラート設定。

---

## 4. Cost

### Vercel pricing model（2026, Pro tier 想定）

| Resource | 単価 | 個人想定 (100 sites, 30 views/day each) |
| --- | --- | --- |
| Plan base | $20/user/mo | $20 |
| Function invocations | $0.20/M | (100 upload + 3,000 view + 30 cron op)/月 ≈ < $0.001 |
| Function Active CPU | $0.18/h | 〃 ≈ ~$0.05 |
| Blob storage | $0.023/GB-mo | 100×100KB = 10MB → $0.0002 |
| Blob ops | $0.36/M | ~$0.001 |
| Blob bandwidth | $0.10/GB | 3,000 views × 100KB × 30 = 900MB → $0.09 |
| **Total / mo** | | **~$20.15** |

→ 個人〜小チーム規模ではフラットに $20/mo + α。

### C-1 🔴 High: bandwidth tail risk

- 1サイトがhotlink/SNS拡散すると一気に GB/TB 規模に。
- 例: 1ページ 500KB × 100k views = 50GB = **$5** (許容範囲)。1M views = **$50**。
- 攻撃シナリオ: 漏洩した Blob URL に対して継続的 GET → 月単位で数百ドル。

**Mitigation**

- Vercel Firewall で rate limit + Anomaly Detection。
- 配信ルートに `Cache-Control: max-age=60` + Edge cache。同一クライアントの再フェッチ削減。
- (S-1) を解消すれば直 Blob URL アクセスを止められる → bandwidth は Function 経由のみになる。

### C-2 🟡 Med: function 二重トラフィック

- `app/[...path]/route.ts` で Blob を fetch → クライアントに返却。Vercel 側で Blob→Function と Function→Client の2方向で bandwidth 計上。
- 個人規模では誤差だが、views 増えると効く。

**Mitigation**

- Cache Components で hot path を memoize（同一 path × 60s）。

### C-3 🟡 Med: meta storage が線形拡大

- `meta/*.json` を毎回 list して全件 read（`listAllMeta`）。
- 1000 sites 超えると cron 1回あたり 1000 Blob fetch = $0.0003 + latency 3-5s。

**Mitigation**

- 中規模超えで Upstash Redis / Vercel Marketplace KV に meta index を移管。

### C-4 🟢 OK: idle cost

- view が無ければほぼ $0 (Pro base のみ)。

---

## 5. Operational gaps

| ID | 区分 | 内容 |
| --- | --- | --- |
| O-1 | バックアップ | Blob のスナップショット運用なし。誤 delete でロスト |
| O-2 | 監査ログ | upload/delete の who/when を別ストレージに残してない（meta のみ） |
| O-3 | DR | リージョン全断時の手順なし |
| O-4 | CICD | テスト/型/lint の CI 未整備（次フェーズで対応） |
| O-5 | Secret rotation | 手順ドキュメント未整備 |

---

## 6. 推奨ロードマップ

| 優先 | アクション | 想定工数 |
| --- | --- | --- |
| 即時 | README に Blob URL 直アクセスのリスクを明記 (S-1) | 15min |
| 即時 | Vercel Firewall で `/api/*` に rate limit ルール (S-3) | 30min |
| 即時 | Cron failure を healthchecks.io へチェックイン (SLO-4) | 30min |
| 1週内 | Per-user token (A-1, A-2) | 半日 |
| 1週内 | CSP + sandbox 配信 (S-2) | 半日 |
| 1ヶ月内 | `@vercel/blob` を 2.x へ上げて private access に移行 (S-1, S-6) | 1日 |
| 1ヶ月内 | Cache Components で配信 cache (SLO-1, C-2) | 半日 |
| 任意 | Datadog / Logflare 連携 (SLO-2, S-5) | 半日 |

---

## 7. 結論

- **個人用 sandbox としての設計意図**は適切で、用途とのギャップは小さい。
- 一方で **「IP allowlist の砦」が Blob 直URL で迂回されている** 点は、用途と矛盾する致命的ギャップ。
- Per-user token 化と Blob private 化の 2 点を次回 PR で対処すれば、用途とセキュリティ要件は揃う。
