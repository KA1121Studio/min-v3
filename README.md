# min3 Chat

Node.js+ Supabase（PostgreSQL / Auth / Realtime）で動くチャットアプリです。
UIはmin2のHTMLをベースにしています。

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
