# Instagram 2アカウント AI 自動投稿エンジン（安全な試作版）

この autopost/ ディレクトリは、既存の「Instagram→ホームページ」同期システムと別の Cloudflare Worker です。既存コード・既存 DB・既存デプロイには変更しません。タッチCDと喫煙カフェいっぷくを独立管理します。

## 実装内容

- Cloudflare Worker + Cron: 15分毎に定期実行。スケジュールは日本時間。
- Meta Llama 3.3 70B fast（Cloudflare Workers AI）: 2つの別々のルールで日本語のテーマ・文章を生成。
- 画像: 管理者が登録した本物のJPEG画像をローテーション。タッチCDのみ、許可設定によりFLUX.1 schnellで「抽象的なイラスト」を生成可能。AIイラストで実物の商品や店内を偽装しない。
- D1: 下書き、承認・拒否状態、投稿状況、指標、写真、暗号化済みアクセストークンを保存。
- R2: 写真・AI画像を保存し、公開メディアURLからMetaに配信。
- Instagram API with Instagram Login: 投稿コンテナ作成→処理状態確認→media_publish、公開した投稿の指標取得。
- 二重処理対策: アカウントと日付の組で下書きは一意。公開APIの結果が曖昧な場合は再送せず停止。
- 27日経過後のInstagram長期トークン更新を試行。失敗時はログで確認が必要。

| アカウント | 下書き生成 | 投稿曜日・時間（仮） | 投稿承認 |
| --- | --- | --- | --- |
| タッチCD | 投稿日の10:00 | 日・月・水・金 18:00 | 原則人間承認、試験後に自動承認へ変更可能 |
| いっぷく | 投稿日の10:00 | 火・木・土 12:00 | 常に人間承認（初期版） |

曜日・時間はテスト用の仮値です。投稿成果に基づいて後から調整します。

## 大切な安全仕様

- PUBLISH_ENABLED は最初から false。コードをGitHubに保存しても実際の投稿は開始しません。
- AUTO_APPROVE_TOUCHCD は最初から false。
- ENABLE_TOUCHCD_CONCEPT_ART も最初から false。使用前に生成品質・使用料金を検証してください。
- いっぷくは必ず本人提供の店内・飲食等の写真を使用。存在しない店内、未確認の営業時間、価格、メニューを創作しません。
- いっぷくの文章はたばこ・ニコチン・喫煙・購入誘導等を禁止するAI指示と単純なキーワード検査を実装していますが、法令・規約チェックの代わりにはなりません。初期版で完全自動公開は許可しません。
- 投稿素材がなくても無理に捏造せず blocked_assets 状態で停止します。
- 競合の非公開データやランキングを勝手に収集する実装は含めていません。現時点の改善根拠は自分の投稿指標です。
- 写真・APIトークン・暗号鍵・管理鍵はGitHubに置きません。

## Cloudflare / Meta 初期設定（まだ未実施）

1. 既存のInstagram同期用とは別のD1を新規作成し、autopost/schema.sql を適用。R2バケット two-account-instagram-media も作成。
2. autopost/wrangler.toml の database_id、PUBLIC_BASE_URL を新しい環境の実値へ変更。
3. Meta DevelopersでInstagram API with Instagram Loginのアプリ設定を確認。両方のプロアカウントに認可を行い、Instagram-scoped IDと適切な長期トークンを取得。
4. 必要なMeta権限は instagram_business_basic と instagram_business_content_publish。Insightsには instagram_business_manage_insights を追加。Facebook Login用の権限と混ぜない。
5. Cloudflare Secretsに ADMIN_API_KEY（32文字以上）, TOKEN_ENCRYPTION_KEY（64文字のhex）, IG_TOKEN_TOUCHCD, IG_TOKEN_IPPUKUを登録し、各IG_ACCOUNT_IDも設定する。ChatGPTやGitHubへトークンを貼らない。
6. 新しいWorkerとして autopost/ ディレクトリからデプロイ。GET /health が publishing_enabled の代わりに live:false を返すことを確認。
7. 動作テスト用のJPEGをAPIから登録。下書きを確認し、表示・承認・コンテナ作成・公開・分析までステージングで検証してから、初めて PUBLISH_ENABLED=true にする。

## 管理API

すべての /api/admin/ エンドポイントでは HTTP ヘッダー Authorization: Bearer <ADMIN_API_KEY> が必要。

- GET /api/admin/status : 稼働設定フラグと投稿件数。鍵の値は表示しない。
- GET /api/admin/posts : 最大80投稿の下書き、状態、画像URL、分析結果。
- POST /api/admin/posts/:id/approve : 下書きを承認する。
- POST /api/admin/posts/:id/reject : 下書きを却下する。
- GET /api/admin/assets : 本物の写真ライブラリ一覧。
- POST /api/admin/assets?account=touchcd または ippuku : JPEG画像の生データを送る。Content-Type:image/jpeg、最大5MB。認証した管理者本人が権利を持つ素材のみ登録する。
- GET /media/… : Instagramが取得できる画像配信用URL。
- GET /health : ヘルスチェック（認証不要）。

この版は管理API中心で、スマホ向け承認ダッシュボードは未実装です。日常運用前に追加する必要があります。

## 残りの工程

- Cloudflareへの独立デプロイ、D1とR2作成（Cloudflare権限・請求承認が必要）
- Meta Appとの正規OAuth連携と必要権限の確認
- 両アカウントの正式IDと本人権限で発行したInstagramトークンのCloudflare Secrets登録
- いっぷく・タッチCDの商品／店内写真と事実データの安全な登録
- スマホ向け承認画面、監視／異常通知、投稿実績の分析強化
- 実アカウントでのテスト、Metaの審査・制限確認後に公開を有効化

このコードはデプロイ・Meta認証・実投稿をまだ行っていない試作品です。GitHubへの保存だけでは稼働しません。

## 参考資料（2026年11月11日確認）

- https://www.postman.com/meta/instagram/folder/1z5vxzu/instagram-api-with-instagram-login
- https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/
- https://developers.cloudflare.com/workers-ai/platform/pricing/
