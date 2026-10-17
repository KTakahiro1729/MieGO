# MieGO

**ブラウザだけでデプロイ・対局・運用できる**、地合い予測補助付きオンライン囲碁の試作実装です。9路盤・中国式面積計算（コミ7.5目）、招待URLによる友人同士のWebRTC P2P対局を想定しています。

## デプロイ（推奨: ブラウザだけで完結）

**[Cloudflareのブラウザ完結デプロイマニュアル](DEPLOY_CLOUDFLARE.md)** を参照してください。PCへのNode.js、Git、Wranglerのインストールは不要です。

1. Cloudflareダッシュボードの **Workers & Pages → Create application → Import a repository** からGitHubの `KTakahiro1729/MieGO` を選択します。
2. Worker名 `miego`、Branch `main`、Build command `npm test`、Deploy command `npx wrangler deploy` を設定します。
3. **Save and Deploy** を押して、完了したら表示された `workers.dev` のURLを開きます。
4. `/api/health` から配信状態を確認し、招待URLを発行して友人と対局します。

以後のコード編集はGitHubのWeb編集画面から行えます。GitHub上の`main`へのコミットをCloudflareが自動検知して更新します。**手動でのGit PushやローカルCLI操作は不要**ですが、CloudflareとGitHubの連携許可は必要です。

## 現在の機能

- 9路盤の着手、石の捕獲、自殺手禁止、単純コウ、パス、投了
- 中国式面積計算、死石の指定、双方による終局確認
- 仮置き・着手確定・ヒートマップとカラーマップ
- 招待URL、WebRTC DataChannelによるP2P着手同期
- WorkersとDurable Objectsによるシグナリング、必要時のTURN設定口
- `/api/health`によるブラウザからの稼働確認

**重要:** 地合い表示は現段階でKataGoではなく**ブラウザ内の簡易影響モデル**です。正確な所有確率、勝率、生死の判定ではありません。

## 制限と安全性

- Cloudflare本番環境の実デプロイ・スマホ2台でのE2E接続検証は未実施です。
- `/api/ice` に参加者認証とレート制限はありません。安全対策を行うまで一般公開環境でTURNを有効化しないでください。
- 対局ルームは信頼できる友人との試用向けです。切断復旧などの安定化は未完成です。
- 日本式ルールは後回しです。中国式でも複雑な反復局面には未対応です。

## 開発者向け（任意、CLI使用）

ローカルで開発したい場合のみ以下を使用します。

```bash
npm install
npm test
npm run dev
```

ブラウザ完結ルートを利用する人には不要です。
