# Instagram Web Auto Sync

複数の店舗・事業者のInstagramを、それぞれのホームページへ自動表示するための共通プラットフォームです。

銀のフライパン専用ではありません。飲食店、美容室、運送会社、小売店など、複数のお客様を1つのCloudflare Worker + D1で管理できます。

## できること

- 管理ページをパスワード保護
- 店舗名とホームページURLを登録
- 店舗ごとのInstagram接続URLを自動発行
- 店主はInstagram公式認証画面で「許可」するだけ
- Instagramのパスワードを制作側で預からない
- 投稿・Reels・取得可能なStoriesを定期同期
- 各ホームページに貼る埋め込みコードを自動発行
- 10分ごとに自動同期
- InstagramアクセストークンをD1へ暗号化保存
- 複数店舗を1つの管理画面で管理

---

## 最終的な運用

### 制作者側

1. `/admin` にアクセス
2. 管理パスワードでログイン
3. 「店舗名」と「ホームページURL」を入力
4. 発行された「Instagram接続URL」を店主へLINE等で送る
5. 接続完了後、表示された埋め込みコードを店舗HPへ貼る

### 店主側

1. 送られてきたURLを開く
2. 「Instagramと接続する」を押す
3. Instagram / Meta公式画面で自分の店舗アカウントを選ぶ
4. 「許可」する
5. 完了

店主のInstagramパスワードを制作会社へ渡す必要はありません。

---

# 初回セットアップ

## 1. Cloudflare D1を1つ作る

Cloudflare DashboardでD1 Databaseを作成します。

推奨名:

```text
instagram-web-auto-sync-db
```

作成後、Database IDをコピーして `wrangler.toml` の

```toml
database_id = "REPLACE_WITH_D1_DATABASE_ID"
```

を置き換えます。

またはCloudflare DashboardからWorkerへD1 Bindingを追加しても構いません。

Binding名は必ず:

```text
DB
```

です。

## 2. D1のテーブルを作る

このリポジトリには以下があります。

```text
migrations/0001_init.sql
```

Wranglerを使う場合:

```bash
npm install
npx wrangler d1 migrations apply instagram-web-auto-sync-db --remote
```

Cloudflare DashboardのD1 Consoleから `migrations/0001_init.sql` のSQLを実行しても構いません。

## 3. Cloudflare Workerを作る / GitHub接続

このGitHubリポジトリをCloudflare Workersへ接続します。

Worker名の例:

```text
instagram-web-auto-sync
```

デプロイ後の例:

```text
https://instagram-web-auto-sync.example.workers.dev
```

## 4. Variables and Secrets

Workerの `Settings > Variables and Secrets` に以下を登録します。

### Secret

```text
ADMIN_PASSWORD
```

管理画面へログインするパスワードです。

```text
ADMIN_SESSION_SECRET
```

32文字以上の十分にランダムな値。

```text
TOKEN_ENCRYPTION_KEY
```

64文字の16進数（32 bytes）。Instagramトークン暗号化用です。

例を作る場合、ローカル環境で:

```bash
openssl rand -hex 32
```

```text
IG_APP_SECRET
```

Meta DevelopersのInstagram App Secret。

### Text

```text
IG_APP_ID
```

Meta DevelopersのInstagram App ID。

```text
IG_REDIRECT_URI
```

WorkerのURLが

```text
https://instagram-web-auto-sync.example.workers.dev
```

なら:

```text
https://instagram-web-auto-sync.example.workers.dev/oauth/callback
```

```text
PUBLIC_BASE_URL
```

```text
https://instagram-web-auto-sync.example.workers.dev
```

必要に応じて:

```text
IG_API_VERSION = v25.0
```

Meta側の現行サポートバージョンに合わせて変更してください。

## 5. Meta Developers

このサービス専用のMetaアプリを **1つだけ** 使用します。

店舗ごとにMetaアプリを作る必要はありません。

Instagram API with Instagram Loginを設定し、OAuth Redirect URIにCloudflareと同じ値を登録します。

```text
https://instagram-web-auto-sync.example.workers.dev/oauth/callback
```

基本取得で使用するscope:

```text
instagram_business_basic
```

この方式はInstagram Professionalアカウント（Business / Creator）向けです。

### 開発中

MetaアプリがDevelopment Modeの場合、テスター等として許可されたInstagramアカウントのみ接続できる場合があります。

### 事業として一般のお客様へ提供する場合

Meta側のApp Review / 必要な権限の承認 / アプリ公開設定を完了してください。

これが完了すると、一般のお客様も「接続URLを開く → Instagramで許可」の流れにできます。

---

# 管理ページ

デプロイ後:

```text
https://あなたのWorkerURL/admin
```

管理画面で入力するもの:

- 店舗名・サイト名
- ホームページURL
- 投稿表示ON/OFF
- Reels表示ON/OFF
- Stories表示ON/OFF
- 表示件数

登録すると自動で以下が生成されます。

### お客様用Instagram接続URL

```text
https://あなたのWorkerURL/connect/ランダムトークン
```

### ホームページ用埋め込みコード

```html
<div data-instagram-auto-sync></div>
<script
  src="https://あなたのWorkerURL/embed.js"
  data-site="サイトID"
  defer>
</script>
```

この2行をお客様のホームページへ貼ります。

---

# 自動同期

`wrangler.toml` では10分ごとのCronを設定しています。

```text
*/10 * * * *
```

接続済みサイトを古い順に同期します。

初期値では1回あたり最大25サイトです。

```toml
SYNC_BATCH_SIZE = "25"
```

顧客数が増えた場合は、APIレート制限やWorker実行時間を見ながら設計を拡張してください。

---

# セキュリティ設計

- Instagramパスワードは保存しない
- Instagram公式OAuthのみ使用
- Instagram Access TokenはAES-GCMで暗号化してD1保存
- App SecretはCloudflare Secretに保存
- 管理パスワードはCloudflare Secretに保存
- 各店舗のFeed APIは登録されたホームページOriginからのアクセスを基本とする
- OAuth stateをD1に一時保存してCSRF対策

**GitHubへApp Secret、管理パスワード、Access Token、暗号化キーをコミットしないでください。**

---

# ファイル構成

```text
instagram-web-auto-sync/
├─ src/
│  └─ index.js
├─ migrations/
│  └─ 0001_init.sql
├─ wrangler.toml
├─ package.json
├─ .gitignore
└─ README.md
```

---

# 動作確認

Workerデプロイ後:

```text
https://あなたのWorkerURL/health
```

正常なら:

```json
{"ok":true,"service":"instagram-web-auto-sync"}
```

次に:

```text
https://あなたのWorkerURL/admin
```

を開いて管理パスワードでログインします。
