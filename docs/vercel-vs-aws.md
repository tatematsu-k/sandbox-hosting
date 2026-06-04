# Vercel vs AWS — sandbox-hosting 用途での比較

- Date: 2026-06-05
- 評価対象ワークロード:
  - HTML sandbox ホスティング (100 sites, 平均100KB)
  - 閲覧 3,000 views/day (= 90k views/mo)
  - アップロード 100 件/mo (Slack + Claude Code 経由)
  - IP allowlist 必須
  - 単一運用者 + 数名の共同利用者

## TL;DR

| 観点 | Vercel | AWS |
| --- | --- | --- |
| **月額（実費）** | ~$20.15 | ~$1.0〜$7.0（構成次第） |
| **初期構築時間** | 30分 | 4〜16時間 |
| **月次運用時間** | ほぼゼロ | 1〜2時間 |
| **時給換算込み TCO** | ~$20/mo | ~$50〜150/mo |
| **Critical issue (S-1) 対応難易度** | 中（SDK upgrade + access mode変更） | 容易（S3 private + OAC が標準） |
| **本ユースケースの推奨** | ✅ 個人〜小チーム | △ 既存 AWS 資産があれば検討 |

**結論**: 月額だけ見れば AWS が圧勝に見えるが、運用時間を時給換算すると **$20/mo のVercel が総合最安**。
AWSは「既存に IaC・運用基盤・社内アカウント体系がある」または「Vercel seat 数 × $20 が無視できない規模」になってから検討する。

---

## 1. アーキテクチャ比較

### Vercel (現状)

```
Slack / Claude Code
  │
  ▼
Vercel Functions (Node.js, Fluid Compute)
  ├── middleware (IP allowlist)
  └── route handlers (upload/list/activate/delete/cron)
  │
  ▼
Vercel Blob (public access)
  ├── published/{path}/*
  ├── unpublished/{path}/*
  └── meta/{path}.json
```

### AWS-A: フル AWS マネージド（標準推奨）

```
Slack / Claude Code
  │
  ▼
API Gateway HTTP API
  │
  ▼
Lambda (Node.js 24)
  ├── upload / list / activate / delete
  └── EventBridge schedule → Lambda (cron)
  │
  ▼
DynamoDB (meta) + S3 (HTML, private)
                  │
                  ▼
              CloudFront (Origin Access Control)
                  │
                  ▼
              CloudFront Function (IP allowlist)
                  │
                  ▼
              Viewer
```

### AWS-B: Lightsail / EC2 シングルインスタンス（最安構成）

```
Slack / Claude Code → HTTPS → nginx (allow/deny + reverse proxy)
                                 │
                                 ▼
                              Node.js + ローカルファイルシステム
                              （or S3 同期）
                              + systemd timer (cron)
```

---

## 2. コスト試算

### 前提

| 指標 | 値 |
| --- | --- |
| 月間ページビュー | 90,000 |
| 平均ページサイズ | 100KB |
| 月間 egress | 9GB |
| アップロード回数 | 100/mo |
| API 呼び出し総数 | 約 95,000/mo |
| 保存 HTML 総量 | 10MB |
| メタデータ件数 | 100 |
| リージョン | Tokyo (ap-northeast-1) |

### 詳細試算

#### Vercel Pro

| 項目 | 単価 | 月額 |
| --- | --- | --- |
| Pro plan 基本料金 | $20/user/mo | $20.00 |
| Function invocations | $0.20/M | <$0.01 |
| Function Active CPU | $0.18/h | $0.05 |
| Blob storage 10MB | $0.023/GB-mo | <$0.01 |
| Blob bandwidth 9GB | $0.10/GB | $0.90 (Pro tier 内では1TB込み → **$0**) |
| Blob ops | $0.36/M | <$0.01 |
| **合計** | | **$20.15** |

#### AWS-A（フルマネージド）

| 項目 | 単価 | 月額 |
| --- | --- | --- |
| Lambda 95k 呼び出し | $0.20/M (1M無料枠込) | $0.00 |
| Lambda 実行時間 (250ms × 95k × 256MB) | $0.0000167/GB-s | $0.10 |
| API Gateway HTTP API | $1.00/M | $0.10 |
| S3 storage 10MB | $0.025/GB-mo | <$0.01 |
| S3 PUT/GET | $0.005/1k + $0.0004/1k | <$0.01 |
| DynamoDB on-demand (200 R/W ops) | $1.25 + $0.25/M | <$0.01 |
| CloudFront egress 9GB (Tokyo) | $0.114/GB (Tokyo) | $1.03 |
| CloudFront HTTPS リクエスト 95k | $0.012/10k | $0.11 |
| CloudFront Function | $0.10/M | <$0.01 |
| EventBridge cron (30 events) | $1.00/M | $0.00 |
| Route 53 hosted zone | $0.50/zone | $0.50 |
| ACM certificate | 無料 | $0 |
| **合計** | | **約 $1.85** |

#### AWS-B（Lightsail $5プラン）

| 項目 | 単価 | 月額 |
| --- | --- | --- |
| Lightsail 1GB RAM / 40GB SSD / 2TB transfer | flat | $5.00 |
| Route 53 | $0.50 | $0.50 |
| **合計** | | **$5.50** |

ただし TLS / nginx 設定 / バックアップ / OSパッチを自前。

#### AWS + WAF（IP 制限を WAF で実装する場合）

WAFv2 を使う場合 +$6〜7/mo（Web ACL $5 + ルール $1 + リクエスト課金 $1未満）。
**CloudFront Functions による IP 制限の方が圧倒的に安い**（90k req で月 $0.01 未満）。

### スケール別の月額カーブ

| Views/mo | Vercel Pro | AWS-A | AWS-B |
| --- | --- | --- | --- |
| 10k | $20 | $0.8 | $5.5 |
| 100k | $20 | $1.9 | $5.5 |
| 1M | $20 | $14 | $5.5 (帯域 2TB 込) |
| 10M | $20 + bandwidth超過分 ~$50 | $130 | $5.5（2TB超）+追加帯域 |

→ **2M views/mo を境に AWS-A が Vercel を上回り始める**。
それ以下なら AWS-A が圧倒的に安く、それ以上なら帯域単価のスケール特性で Vercel Pro の包括料金が有利になる。

---

## 3. 運用コストの内訳

| 項目 | Vercel | AWS-A | AWS-B |
| --- | --- | --- | --- |
| 初期構築時間 | 30min | 8–16h | 2–4h |
| TLS / 証明書管理 | 自動 | ACM 自動 | Let's Encrypt 自前 |
| 環境変数の出し入れ | dashboard or CLI | SSM / Parameter Store | .env ファイル |
| デプロイパイプライン | 標準装備 | CDK/Terraform 必要 | rsync + systemctl |
| IP allowlist 変更 | env 1個書き換え | WAF or CF Function 修正 + invalidation | nginx.conf 編集 + reload |
| OS / runtime パッチ | 自動 | 自動 (Lambda) | 自前 |
| 障害復旧 | プラットフォーム保証 | マルチ AZ 設定要 | 単一インスタンス = SPOF |
| 観測性 | dashboard 標準 | CloudWatch 設定要 | nginx access log 自前 |
| 月次運用時間（目安） | 0.1h | 1.5h | 2.5h |
| **時給 $50 換算** | $5/mo | $75/mo | $125/mo |

### 時給込みTCO

| 構成 | 実費 | 時間コスト | **合計 TCO/mo** |
| --- | --- | --- | --- |
| Vercel Pro | $20 | $5 | **$25** |
| AWS-A | $2 | $75 | **$77** |
| AWS-B | $5.5 | $125 | **$130** |

---

## 4. セキュリティポスチャ

[architecture-review.md](architecture-review.md) で指摘した **S-1 (Blob 直URL bypass)** が Vercel/AWS でどう変わるか。

| 観点 | Vercel | AWS-A |
| --- | --- | --- |
| 静的アセットへの直アクセス | Blob は public access が前提（SDK 0.x）。private 化には SDK 2.x へ更新 + 全 read を URL 取得経由に書き換え必要 | S3 private + CloudFront OAC が標準 — viewer から S3 直URLは一切到達不能 |
| IP allowlist の強制範囲 | Vercel middleware の matcher 内のみ。Blob CDN は対象外 | CloudFront Function は全 viewer リクエストに必ず通る |
| 単一秘密の管理 | Vercel env (環境別) | SSM Parameter Store / Secrets Manager（KMS暗号化、ローテーション可） |
| 監査ログ | Vercel logs (1h 保持、ドレイン要) | CloudTrail / CloudWatch (永続) |
| WAF | Vercel Firewall (基本機能) | AWS WAF (DDoS protection, managed rules) |

→ **本質的な静的アセット保護は AWS の方が素直に設計できる**。
Vercel で同等にするには SDK upgrade + 配信ルート経由化のリファクタが必要。

---

## 5. 機能差

| 機能 | Vercel | AWS |
| --- | --- | --- |
| プレビューデプロイ (PR単位) | 標準 | CDK pipeline で構築 |
| Edge での実行 | Functions / Routing Middleware | Lambda@Edge / CloudFront Functions |
| Cron | `vercel.ts` に1行 | EventBridge + Lambda |
| Blob/S3 | Blob (簡易) | S3 (高機能) |
| Queue | Vercel Queues (beta) | SQS, EventBridge |
| KV / DB | Marketplace (Neon, Upstash) | DynamoDB / RDS / Aurora |
| AI ゲートウェイ | Vercel AI Gateway | Bedrock |
| Sandbox 実行 | Vercel Sandbox | Lambda / Fargate |

→ 「アプリ開発の標準UI が欲しい」なら Vercel、「単なるバックエンドサービス群」なら AWS。

---

## 6. ロックイン

| 観点 | Vercel | AWS |
| --- | --- | --- |
| コード | Next.js は OSS、Lambda / Node.js でも動く | Node.js / 標準 |
| Functions ランタイム | フレームワーク準拠 (Next routes) | 単純な handler |
| 配信 | Vercel CDN | CloudFront / 他 CDN へ移行可能 |
| ストレージ | `@vercel/blob` SDK 依存 | S3 SDK 標準 |
| 移行難度 | route handler を Lambda + API GW に書き換え + S3 + middleware を CF Function に移植 = 1〜2人日 | プラットフォーム抽象が無い分そのまま動く |

---

## 7. 推奨

### 本ユースケース（個人 sandbox）の結論

✅ **Vercel を継続**。理由:

1. **TCO で勝る**: 運用時間を時給換算すると Vercel が最安
2. **Time to first ship が速い**: 30分で動く環境が手に入る
3. **観測性・preview deploy が標準**: 個人用途で価値が大きい
4. **唯一の弱点 (S-1)** は SDK upgrade で対処可能 → 改善PRに乗せる

### AWS を選ぶべきケース

- 既に社内 AWS アカウント・IaC・運用基盤がある（学習コストゼロ）
- Vercel seat × $20 が10人以上になりコスト圧力が出る
- 規制要件で audit log を CloudTrail に揃える必要がある
- 月間 2M views を超えるトラフィックを前提とする
- WAF managed rules や Shield Advanced の DDoS 防御が必要

### ハイブリッド

- 認証/ロジック層: Vercel
- 大量配信: CloudFront + S3
  → Vercel が CloudFront にプロキシ。アプリ開発体験は維持しつつ帯域単価を下げられる。
  ただし 2層になり運用複雑度↑。月間数百万views 以上で検討。

---

## 8. 移行を実施する場合のチェックリスト

1. Terraform / AWS CDK で IaC 化（手作業しない）
2. S3 + CloudFront + OAC を最初に設定（直アクセス遮断を確認）
3. CloudFront Function で IP allowlist を実装（IP リストは Parameter Store 経由）
4. Lambda + API Gateway で upload API を移植
5. DynamoDB に meta を移行（partition key: `path`）
6. EventBridge で cron を移植
7. CloudWatch アラートを設定（5xx、cron 失敗）
8. CloudTrail を有効化
9. 既存 Vercel Blob からデータマイグレーションスクリプト実行
10. DNS 切替（Route 53 or 既存 DNS）
