# min3 Chat

Render（Node.js）+ Supabase（PostgreSQL / Auth / Realtime）で動くチャットアプリです。
UIは付属のダークテーマHTMLをベースにしています。

## 構成

```
min3-chat/
├── package.json          # 依存関係 + startスクリプト
├── .env.example          # 環境変数のサンプル
├── server.js             # Express（API + 静的配信）
├── supabase.sql          # テーブル定義 + RLS
├── README.md
└── public/
    ├── index.html        # DOM
    ├── style.css         # 付属HTMLのスタイルをそのまま移設
    └── app.js            # フロントロジック（API + Realtime）
```

- **Render**: `server.js` がREST APIとフロント配信を担当
- **Supabase**: データ永続化 + Auth + Realtime
- フロントとAPIは同一オリジンなので CORS 設定は不要

---

## 1. Supabase のセットアップ

### 1-1. プロジェクト作成
1. https://supabase.com/ にログインし「New project」を作成
2. プロジェクト名・DBパスワード・リージョン（`Northeast Asia (Tokyo)` 推奨）を設定
3. 作成完了まで数分待つ

### 1-2. スキーマ適用
1. 左メニュー「SQL Editor」を開く
2. リポジトリの `supabase.sql` の内容を貼り付けて「Run」
3. 成功したら「Table Editor」で以下が作成されていることを確認
   - `profiles` / `rooms` / `room_members` / `messages`

### 1-3. Realtime 有効化の確認
1. 左メニュー「Database」→「Replication」
2. `supabase_realtime` publication に `messages` が含まれていることを確認
   （`supabase.sql` の `alter publication ... add table` で追加済み）

### 1-4. キーの取得
左メニュー「Project Settings」→「API」で以下を控える：

| 名前 | 用途 | 公開範囲 |
|---|---|---|
| `Project URL` | 接続先 | 公開OK |
| `anon public` key | フロントのRealtime購読 | 公開OK |
| `service_role` key | RenderのAPIからDB操作 | **絶対に非公開** |

---

## 2. ローカルでの動作確認

### 2-1. 依存関係のインストール
```bash
npm install
```

### 2-2. 環境変数の設定
`.env.example` をコピーして `.env` を作成：

```bash
cp .env.example .env
```

`.env` を編集：

```env
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...（service_role key）
JWT_SECRET=ローカル用のランダム文字列（例: openssl rand -hex 32 で生成）
PORT=3000
```

### 2-3. フロントのSupabase設定
`public/index.html` の `<head>` 内を編集：

```html
<script>
  window.__SUPABASE_URL__ = 'https://xxxxxxxxxxxx.supabase.co';
  window.__SUPABASE_ANON_KEY__ = 'eyJhbGciOi...（anon key）';
</script>
```

### 2-4. 起動
```bash
npm start
```

http://localhost:3000 を開き、以下を確認：

1. 「アカウント作成」でユーザー登録できる
2. ログイン後、全体チャットが表示される
3. メッセージを送信すると即時表示される
4. **別ブラウザ（シークレットウィンドウ等）で別ユーザーとしてログイン**し、同じルームでメッセージが相互に反映される（Realtime）
5. 「＋」からルーム作成できる
6. プライベートルームは作成者以外の一覧に出ない

---

## 3. Render へのデプロイ

### 3-1. GitHub リポジトリ作成
```bash
git init
git add .
git commit -m "initial commit"
git branch -M main
git remote add origin https://github.com/<your-name>/min3-chat.git
git push -u origin main
```

> `.env` は **コミットしない**（`.gitignore` に含める）。

### 3-2. Render で Web Service 作成
1. https://render.com/ にログイン
2. 「New」→「Web Service」
3. GitHub リポジトリを接続
4. 以下を設定：

| 項目 | 値 |
|---|---|
| Name | `min3-chat`（任意） |
| Region | `Singapore` または `Oregon` |
| Branch | `main` |
| Root Directory | （空欄） |
| Runtime | `Node` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | Free（動作確認用） |

5. 「Advanced」→「Add Environment Variable」で以下を追加：

| Key | Value |
|---|---|
| `SUPABASE_URL` | SupabaseのProject URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
| `JWT_SECRET` | `openssl rand -hex 32` などで生成したランダム文字列 |

> `PORT` はRenderが自動で注入するため設定不要です。`server.js` は `process.env.PORT` を参照します。

6. 「Health Check Path」に `/health` を設定
7. 「Create Web Service」でデプロイ開始

### 3-3. デプロイ後の確認
- 発行されたURL（例: `https://min3-chat.onrender.com`）を開く
- ローカルと同じ操作ができることを確認
- 別ユーザーでログインし、Realtimeが動作することを確認

> **Free プランの注意**: 15分間アクセスがないとスリープし、次回アクセス時に起動まで30秒ほどかかります。

---

## 4. 本番化に向けた改善ポイント

現状は動作確認用の最小構成です。本番運用時は以下を検討してください。

### セキュリティ
- **管理画面のパスワード**（`app.js` の `ADMIN_PASSWORD = 'admin'`）はクライアントに露出しています。本番では管理APIをサーバー側に移し、管理者ロールをDBで管理してください。
- **JWTの保存先**: 現在は `localStorage`。XSS耐性を高めるなら `HttpOnly` Cookie + CSRF対策に変更。
- **レート制限**: `express-rate-limit` で `/api/signup`・`/api/login`・`/api/messages` を制限。
- **入力サニタイズ**: 現状は `textContent` で描画しているためXSSは起きにくいですが、リンク化やMarkdown対応をする際は注意。

### 機能
- **メンバー一覧API**: `/api/rooms/:id/members` を追加し、詳細パネルに反映
- **退出API**: `DELETE /api/rooms/:id/members/me` を追加
- **リアクション永続化**: `reactions` テーブルを追加
- **既読管理**: `message_reads` テーブルを追加
- **ユーザー一覧API（管理画面用）**: `/api/admin/users` を追加し、管理者JWTで保護

### 運用
- **Realtimeの名前解決**: 現状は受信後に再取得していますが、`messages` に `username` を非正規化保存するか、Supabase Broadcast に切り替えると効率的です。
- **レンダーの有料プラン**: スリープ回避のため Starter 以上を推奨。
- **ログ**: `pino` などで構造化ログを出力し、Renderのログ画面で確認。

---

## 5. トラブルシューティング

| 症状 | 原因 / 対処 |
|---|---|
| ログインで「通信に失敗しました」 | `SUPABASE_URL` / `SERVICE_ROLE_KEY` の設定ミス。Renderの環境変数を確認 |
| メッセージが他ユーザーに届かない | `messages` テーブルのRealtimeがOFF。Supabaseの Replication 設定を確認 |
| プライベートルームが一覧に出ない | 仕様通り（参加者のみ表示）。`room_members` に自分がいるか確認 |
| デプロイ後500エラー | Renderのログで `Missing env` が出ていないか確認 |
| Realtimeで名前が「...」になる | 仕様（payloadにjoin結果が無いため）。300ms後に再取得して解決 |

---

## ライセンス

MIT
```

---

### 補足

- **`.gitignore`** を忘れずに作成してください。最低限以下を含めます：

```gitignore
node_modules/
.env
.DS_Store
*.log
```

- **`.env.example`** は既に提示済みの内容をそのまま配置してください。

---

セットアップ中にエラーが出た場合や、メンバー一覧API・退出APIなど次の機能拡張に進みたい場合は、いつでもお知らせください。
