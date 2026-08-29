# Architecture Review — Sandbox Hosting (AWS-A)

- Reviewer: Claude (Opus 4.7)
- Date: 2026-06-05
- Target: commit `7e0964b` (AWS-A migration)
- Scope: Security / Authn-Authz / SLO / Cost / Operations

## TL;DR

| 領域 | 状態 | 主要リスク |
| --- | --- | --- |
| Security | 🟢 1 High, 2 Med | API GW に WAF 未導入(単一共有トークン問題は解消) |
| Authn / Authz | 🟢 0 High, 1 Med | per-user トークンで client claim 問題を解消。`scope=all` の admin 制限(A-2)は未対応 |
| SLO | 🟢 概ね良好 | 観測項目はあるが alarm 抑制設定が不足 |
| Cost | 🟢 約 $2/mo | bandwidth tail risk は CloudFront 経由でも残る |
| Operations | 🟡 整備中 | Terraform state 集中管理・WAF未導入が次の山場 |

Vercel 期に比べて以下が **構造的に解消**:
- ✅ Blob 直URL 迂回 → S3 private + OAC で完全遮断
- ✅ 秘密情報の保存・ローテーション → SSM SecureString + KMS
- ✅ 観測性ゼロ → CloudWatch Logs + Alarms + SNS

---

## 1. Security

### S-1 🟡 Med: WAF 未導入（rate limit と DDoS 防御が薄い）

**現状**
- API Gateway HTTP API の throttling は burst 50 / rate 25 リクエスト/秒（設定済み）
- CloudFront 側はマネージドルール無し
- 攻撃者が漏洩した per-user トークンを入手した場合、API GW throttling 単独でしか守れない

**Mitigation**
- AWS WAF v2 を CloudFront に associate → IPレートリミット & マネージドルール（Core Rule Set, KnownBadInputs）
- API GW にも WAF を関連付け可能
- 月額 +$6（Web ACL $5 + ルール $1）

### S-2 ✅ Resolved: 単一共有 `UPLOAD_TOKEN` を per-user トークンに置き換え

- DynamoDB `tokens` テーブル(PK=`sha256(token)`)にユーザーごとのトークンを保存し、
  `verifyBearer` がハッシュ一致で検証済みの owner を返すようになった
  (`docs/superpowers/specs/2026-08-29-per-user-tokens-design.md`)
- 漏洩時は影響ユーザーの `manage-tokens.sh revoke <username>` だけで済み、
  他ユーザーへの影響はない
- `X-Sandbox-User` ヘッダーの自己申告問題(Authn/Authz 節)もこの変更で同時に解消

### S-3 🟡 Med: CloudFront Function 内の IP allowlist は デプロイ時固定

- Terraform で `viewer-request.js` に IP リストを埋め込み、CloudFront にデプロイ
- IP変更には `terraform apply` 必須 → 即時対応に時間がかかる
- 一方、SSM Parameter Store からの動的取得は CloudFront Function ではできない（外部 IO 不可）

**Mitigation**
- 緊急変更が必要な場合: Lambda@Edge に切り替えると SSM/DynamoDB 参照可能（CPU/価格上がる）
- もしくは IP allowlist を CloudFront WAF IP set に移管 → SDK/API で即時更新可

### S-4 🟢 Low: `viewer-request.js` の手書き CIDR/IPv6 パーサ

- 自前実装。テスト不在。
- 設計上は単純だが、edge case で誤判定して **意図せず通してしまう** リスク

**Mitigation**
- 既知の有効/無効 IP に対する自動テスト（Node から AWS CloudFront テスト関数を呼ぶ or pure JS のままユニットテストできるようリファクタ）

### S-5 🟢 Low: S3 lifecycle で旧バージョンは消えるが、現行版の長期保存ポリシーがない

- バージョニング ON、非カレント版は 30日で削除（lifecycle.tf）
- カレント版に対する世代管理ポリシーは無いため、誤削除や悪意による削除はバージョン保存ぶん復旧可

**Mitigation**
- 現状で OK（個人 sandbox なら十分）
- 業務利用なら MFA delete / Object Lock を検討

---

## 2. Authentication / Authorization

### A-1 ✅ Resolved: `X-Sandbox-User` ヘッダの client claim 問題

- per-user トークン(S-2)により、`verifyBearer` はクライアントが送る `X-Sandbox-User` を一切信用しなくなった
  (ヘッダー自体も送信/読み取りされない)。owner は DynamoDB `tokens` テーブルに保存された検証済みの値のみを使う
- 予告されていた「S-2と同時対処」の通りに解消

### A-2 🟡 Med: `scope=all` に admin 制限が無い

- Bearer token の所有者なら誰でも全サイトを enumerate 可能
- `ADMIN_USERS` 環境変数による whitelist 検証を追加すべき

### A-3 ✅ OK: Slack 署名検証（HMAC + 5分 window + timing-safe）
### A-4 ✅ OK: Cron は IAM 経由（EventBridge → Lambda）でゼロトラスト

---

## 3. SLO

### 観測ベースライン

| 指標 | 目標 | 現状の実装 |
| --- | --- | --- |
| 公開配信 availability | 99.9% / 30d | CloudFront + S3 = SLA 99.99% |
| API availability | 99.5% / 30d | API GW + Lambda = SLA 99.95% |
| 配信 P50 latency | < 100ms | CloudFront キャッシュヒット時 < 50ms 想定 |
| 配信 P95 latency | < 300ms | キャッシュミス + S3 fetch |
| API P95 latency | < 1s | Lambda cold start 含む |
| Cron 成功率 | 99% | CloudWatch alarm 設定済み |

### SLO-1 🟡 Med: アラームの抑制 (suppression) 設定なし

- `api_5xx` alarm は 5分間に 5件超で発火
- 連続発火時の SNS スパムを防ぐ throttling/composite alarm が無い

**Mitigation**
- Composite Alarm で OK/Alarm 状態遷移時のみ通知
- もしくは EventBridge Pipes 経由で重複抑制

### SLO-2 🟢 OK: ログは CloudWatch に集約

- Lambda 実行ログは `/aws/lambda/{name}` に 30日保持
- API GW アクセスログは JSON 形式で構造化済み

### SLO-3 🟢 OK: Cold start 影響は限定的

- API Lambda 512MB / 30s。Bundle ~1MB。
- Init ~150-300ms 想定。継続呼び出し（実用上）はキャッシュ済みインスタンスを使う

---

## 4. Cost

### 90k views/mo シナリオでの内訳

| 項目 | 月額 | 備考 |
| --- | --- | --- |
| Lambda invocations | <$0.01 | 95k req/mo、無料枠内 |
| Lambda 実行時間 | $0.10 | 平均 250ms × 256MB |
| API Gateway HTTP API | $0.10 | $1/M req |
| S3 storage 10MB | <$0.01 | |
| S3 PUT/GET | <$0.01 | |
| DynamoDB on-demand | <$0.01 | |
| CloudFront egress 9GB (Tokyo) | $1.03 | $0.114/GB |
| CloudFront HTTPS 95k req | $0.11 | $0.012/10k |
| CloudFront Function | <$0.01 | $0.10/M |
| EventBridge cron | $0.00 | 30 events/mo |
| Route 53 hosted zone | $0.50 | (任意) |
| **合計** | **~$1.85** | Route 53 なしなら ~$1.35 |

### C-1 🟡 Med: bandwidth tail risk

- Hot link 想定: 1サイト × 100k views = 50GB = **$5.70/mo 追加**
- 暴走時の自動制御は無い

**Mitigation**
- CloudFront 上に WAF rate limit ルール（IPあたり 1000req/5min 等）
- AWS Budgets でアラート設定

### C-2 🟢 OK: アイドル時のコスト

- 閲覧ゼロなら Lambda/API GW/Egress すべてゼロ、SSM/DynamoDB は無料枠内
- 固定費は Route 53 $0.50/mo のみ（任意）

### C-3 🟢 OK: WAF 追加時のコスト

- 月 +$6 程度。S-1 mitigation のため、トラフィック増えたら追加推奨

---

## 5. Operations

| ID | 区分 | 内容 | 状態 |
| --- | --- | --- | --- |
| O-1 | Terraform state | local state が初期値。team 運用は S3 backend 必須 | backend.tf.example を提供済み |
| O-2 | バックアップ | S3 versioning + DynamoDB PITR で実用上 OK | ✅ |
| O-3 | 監査ログ | CloudTrail 別途設定推奨 | ❌ 未対応 |
| O-4 | Disaster Recovery | ap-northeast-1 リージョン障害時の手順なし | ❌ 未対応 |
| O-5 | Secret rotation | 手順は docs にあるが自動化なし | ⚠️ 半対応 |
| O-6 | 監視ダッシュボード | CloudWatch dashboard 未作成 | ❌ 未対応 |
| O-7 | CI/CD | Terraform plan を PR に sticky comment | ✅ |

---

## 6. 推奨ロードマップ

| 優先 | アクション | 想定工数 |
| --- | --- | --- |
| 即時 | AWS Budgets で月次アラート (50% / 80% / 100%) | 15min |
| 即時 | CloudWatch Dashboard を Terraform で 1枚作成 | 30min |
| 1週内 | WAF v2 ACL + rate limit + Core Rule Set (S-1, C-1 対策) | 半日 |
| 1週内 | `viewer-request.js` の CIDR パーサに pure JS ユニットテスト (S-4) | 2h |
| 1ヶ月内 | per-user token (S-2, A-1) | 1日 |
| 1ヶ月内 | IP allowlist を WAF IP set へ移管 + SSM 動的更新 (S-3) | 半日 |
| 任意 | CloudTrail + Audit log dashboard (O-3) | 半日 |
| 任意 | 別リージョン読み取りフェイルオーバ (O-4) | 1日 |

---

## 7. 結論

- AWS-A 移行により **Vercel 期の Critical 1 件 + High 4 件のうち 3 件が構造的に解消**（Blob bypass、観測性、secret管理）
- 残課題は **共有 token と WAF 未導入** の 2 点が中心 → どちらも対応容易
- 個人 sandbox 用途としては production-ready なベースライン
- 1ヶ月以内に WAF + per-user token を入れれば、業務利用にも耐えうる構成になる
