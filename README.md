# MieGO

初心者向けの「地合い予測補助付きオンライン囲碁」の試作実装です。9路盤・中国式面積計算（コミ7.5目）、招待URLによる友人同士のWebRTC P2P対局を想定しています。

## ローカル実行

```bash
npm install
npm test
npm run dev
```

詳しい手順とセキュリティ上の注意点は **[Cloudflare展開マニュアル](DEPLOY_CLOUDFLARE.md)** にまとめています。

Cloudflareへ直接デプロイする場合:

```bash
npx wrangler login
npm run deploy
```

CloudflareへのデプロイにGitHubへのPushは必要ありません。

## 現在の実装

- 9路盤、中国式面積計算、石の捕獲、自殺手禁止、単純コウ、パス、投了
- 仮置きと確定、地合いヒートマップ、3種類のカラーマップと透明度設定
- Cloudflare Workers、Durable ObjectsのWebRTCシグナリングとDataChannelによる対局同期
- 2人ルーム、招待URL、STUN、任意のTURN設定
- 死石の指定と双方による終局確認

**AI推定に関する注意:** ヒートマップは現時点ではKataGoではなく、周辺の石の影響を利用した簡易な推定です。領域所有確率や生死の正確な判定ではありません。

## 未検証・未完成

- Cloudflare本番デプロイ、複数端末のWebRTC対戦E2E
- KataGo / WebGPU / WASMによる高精度なブラウザAI推論
- 切断復帰・対局同期の堅牢化、対局ルームの認証と濫用対策
- 中国式ルールの特殊な反復局面への完全対応
- 日本式ルール（将来対応）

**TURNを一般公開環境で有効化する前に** `/api/ice` の参加者認証とレート制限を実装してください。

## ファイル構成

- `public/core.mjs` — ルールエンジン、面積計算、SGF変換関数
- `public/analysis-worker.mjs` — 地合い傾向の簡易推定
- `public/app.mjs` — UI・WebRTC
- `src/worker.mjs` — Cloudflare Workers、Durable Objects
- `tests/core.test.mjs` — Node.jsでのルール単体テスト
- `wrangler.jsonc` — Cloudflare設定
