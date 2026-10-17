# MieGO

初心者向けの、地合い予測補助付きオンライン囲碁。9路盤・中国式面積計算・コミ7.5目。友人同士の招待URL対局を想定しています。

## 実装済み

- ブラウザ内の9路盤、中国式面積計算、取り、自殺手禁止、単純コウ、パス、投了
- 1手仮置き、確定・キャンセル、グラデーション、3種類のカラーマップ、不透明度
- Web Workerでの軽量な近傍影響分析（**KataGoではなく、確率や生死の判定でもありません**）
- Cloudflare Workers + Durable ObjectsでWebRTCシグナリング、DataChannelによるP2P着手同期
- 招待URL、ルームの2席制限、ホスト黒番・ゲスト白番、TURN認証情報のオプション取得
- 双方の死石指定・終局合意、中国式面積計算。ローカル練習はブラウザに保存

## 起動

Node.js 20以降が必要です。

```bash
npm install
npm test
npm run dev
```

Cloudflareにログイン後、`npm run deploy` でデプロイできます。実際のCloudflareへのデプロイは未実施です。

TURNを利用する場合、Cloudflare Realtime TURNのキーIDとAPIトークンをWorkersに設定します。

```bash
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_API_TOKEN
```

TURN未設定時はCloudflare STUNのみ利用するため、ネットワークによってP2P接続できません。TURN認証情報の配布制限・レート制限は本番公開前に追加してください。

## 現時点の制限

- AIは**近傍影響の簡易モデル**。正確な地合い予測、勝率、死活判定は未実装。KataGoのWASM/WebGPU統合が次の大きな課題です。
- 招待ルームは認証・レート制限・永続棋譜サーバーを備えていません。信頼できる友人との試用向けです。
- P2P切断後の自動復旧・同期競合の解決は限定的です。対局開始時はホストの盤面が正本です。
- 特殊な反復局面、厳密な中国式ルールの全例外、SGF出力UIは未対応です。
- 補助モードはホストが開始前に決めます。対局中の補助禁止を技術的に保証するものではありません。
- ブラウザでの手動E2Eテスト、Cloudflare上での実機テストは未実施です。

## 構成

- `public/core.mjs`: 盤面、合法手、終局、面積計算
- `public/analysis-worker.mjs`: 試験的な所有傾向の計算
- `public/app.mjs`: UIとWebRTC
- `src/worker.mjs`: Cloudflare WorkerとDurable Object
- `tests/core.test.mjs`: 盤面エンジンの単体テスト
