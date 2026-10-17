# MieGO — Cloudflare Workers デプロイマニュアル

更新日: 2026-10-17  
対象: [KTakahiro1729/MieGO](https://github.com/KTakahiro1729/MieGO) `main` ブランチ  
構成: Workers Static Assets + Durable Objects + WebRTC DataChannel（P2P）

**GitHubへのPushは不要です。** GitHubからコードを取得し、Wrangler CLIでCloudflareへ直接配置します。以前配布した「復元キット」は不要です。必要なファイルはリポジトリに同梱済みです。

## 1. 事前準備

- Cloudflareアカウントを準備し、Workers利用を有効にする: https://dash.cloudflare.com/
- Node.js 20以降、npm、Gitをインストール（`node -v`、`npm -v`、`git --version`）。
- Workersの利用枠・課金を事前確認。TURN利用は別途Cloudflare Realtimeの料金に注意。
- 使用予定のWorkers名 `miego` が既存Workerと重複しないことを確認。必要なら `wrangler.jsonc` の `name` を変更する。

## 2. ソースを取得

```bash
git clone https://github.com/KTakahiro1729/MieGO.git
cd MieGO
```

`git clone` は取得のみの操作です。GitHubへのPushは発生しません。Gitを使わない場合は GitHub の **Code → Download ZIP** を展開してください。

次のファイルがあることを確認してください。

```text
MieGO/
├─ package.json
├─ wrangler.jsonc
├─ src/worker.mjs
├─ public/
│  ├─ index.html
│  ├─ style.css
│  ├─ app.mjs
│  ├─ analysis-worker.mjs
│  ├─ core.mjs
│  └─ _headers
└─ tests/core.test.mjs
```

## 3. テストとローカル起動

```bash
npm install
npm test
npm run dev
```

通常は `http://localhost:8787` にアクセスします。9路盤が表示され、着手の仮置き・確定、地合いヒートマップの色の切り替えができるか確認します。

ローカル起動を停止する場合は `Ctrl+C`。スマホからの接続検証は、HTTPSが使えるデプロイ後のURLで実施することを推奨します。

## 4. Cloudflare認証

```bash
npx wrangler login
npx wrangler whoami
```

ブラウザで認証を完了し、`whoami` にCloudflareアカウント情報が表示されることを確認します。ログインするアカウントを間違えないよう注意してください。

## 5. デプロイ

```bash
npm run deploy
```

このコマンドは `wrangler deploy` を実行します。初回は `workers.dev` の利用設定を求められる場合があります。成功すると概ね次の形式のURLが発行されます。

```text
https://miego.<YOUR_SUBDOMAIN>.workers.dev
```

※実際のURLはWranglerが表示した値を使用してください。`wrangler.jsonc` の `new_sqlite_classes` は新規Durable Objects用のSQLiteバックエンドを指定しています。Cloudflareダッシュボードと既存環境により移行状況は異なります。

## 6. 公開URLでの動作確認

1. 公開URLにアクセスして、盤面が表示されるか確認。
2. 石を仮置きし、試験的地合いグラデーションが変わることを確認。
3. 着手確定を行い、手番が切り替わることを確認。
4. 「対局URLを作る」で招待URLを取得。
5. 別ブラウザまたはスマホで招待URLを開き、黒番・白番で接続。
6. 着手が相手に届くか確認。
7. 双方パス → 死石指定 → 双方の終局同意を試す。

API確認例（`<YOUR_SUBDOMAIN>` を置き換える）:

```bash
curl -X POST 'https://miego.<YOUR_SUBDOMAIN>.workers.dev/api/rooms'
```

成功時には `room` と `url` を含むJSONが返ります。PowerShellでは `Invoke-RestMethod -Method Post -Uri 'https://...'` も利用できます。

## 7. TURN: 接続できない環境向け（初期状態では未設定）

MieGOは初期状態でSTUNを使います。厳しいNATやモバイル回線等ではP2P接続できない場合があり、その場合Cloudflare Realtime TURNを設定します。

Cloudflare RealtimeでTURNキーを発行した上で、必要な値を**サーバー側の秘密情報**として登録します。

```bash
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_API_TOKEN
```

上記の秘密情報を `public/` やGitHubに記載しないでください。ローカル開発ではGit管理外の `.dev.vars` を使います。

**セキュリティ上の重要事項:** 現在の `/api/ice` にはルーム参加者認証とレート制限がありません。公開環境でこのままTURNを有効化すると、第三者に認証情報の大量発行を試みられるおそれがあります。TURN利用前に参加者認証と発行制限を実装してください。

## 8. 更新・ログ確認

ローカルでコードを変更したら再度テストしてデプロイします。

```bash
npm test
npm run deploy
```

ログ確認:

```bash
npx wrangler tail
```

GitHubへのPush・GitHub連携は必須ではありません。Cloudflareアカウントの設定が必要な場合は管理画面の **Workers & Pages** から該当Workerを確認してください。

## 9. トラブルシューティング

| 状況 | 対応 |
| --- | --- |
| `Missing script: deploy` | `MieGO/` 直下に `package.json` があるか確認 |
| `core.mjs` の読み込みに失敗 | `public/core.mjs` を確認。ブラウザキャッシュを更新 |
| `Unauthorized` | `npx wrangler login` と `npx wrangler whoami` |
| Durable Objects関連のエラー | `wrangler.jsonc` の `ROOMS` / `GameRoom` / migration設定を照合 |
| 招待URLは開くが接続できない | WebSocketとWebRTC ICE状態を確認。STUNのみでは接続不可の場合あり |
| `turnEnabled: false` | TURN未設定、または認証情報発行に失敗。STUNでの動作を確認 |
| デプロイ後も古い画面 | Workers名、表示されたURL、ブラウザキャッシュを確認 |

## 10. 既知の制限

- AI予測はKataGoではなく**ブラウザ内の近傍影響の簡易推定**。所有確率、正確な死活判定、勝率の推定ではありません。
- 9路盤の試験運用向けであり、反復局面など中国式ルールの全例外は未網羅です。
- ルームは信頼できる友人との試用を想定。参加者認証、濫用対策、堅牢な再同期は未完成です。
- このリポジトリの内容をCloudflare本番環境にデプロイしての実機E2E検証はまだ行っていません。

## 公式資料

- Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/
- Wrangler設定: https://developers.cloudflare.com/workers/wrangler/configuration/
- Durable Objects migrations: https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/
- Realtime TURN認証情報: https://developers.cloudflare.com/realtime/turn/generate-credentials/
- Workers Secrets: https://developers.cloudflare.com/workers/configuration/secrets/
