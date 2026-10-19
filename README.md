# MieGO

9路盤・中国式面積計算（コミ7.5目）、友人同士の招待URLとWebRTC P2P対局、**KataGoニューラルネットによるOwnership・目数差・勝率のブラウザ内推定**を備えた試作アプリです。

## Cloudflareへの展開（ブラウザのみ）

すでにGitHubの`main`とCloudflare Workers Buildsを接続済みなら、リポジトリの更新により再ビルド・デプロイされます。

**Cloudflare Build commandは引き続き `npm test`、Deploy commandは `npx wrangler deploy`** を使用してください。npmの`pretest`工程が、ブラウザ用KataGo Workerのバンドル・モデルのダウンロード・整合性確認・TensorFlow.js WASMファイルのコピーを実行します。モデルの初回ダウンロードには時間がかかることがあります。

[Cloudflareデプロイ詳細](DEPLOY_CLOUDFLARE.md)

## 導入したKataGo

- [Web KaTrain](https://github.com/Sir-Teo/web-katrain) のMITライセンスのKataGoニューラル推論モジュールを`vendor/web-katrain/`へ固定バージョンで取り込み、TypeScript + esbuildで専用Workerにまとめます。
- モデル: Web KaTrainの`katago-small.bin.gz`（約3.8MB）。Cloudflareのビルド時に固定コミットから取得し、Git Blob SHA-1で検証して配置します。**テスト用の弱い小型モデルであり、本格的な棋力評価用ではありません。**
- 実行: WebGPUを優先し、利用できなければTensorFlow.js WASM、さらにCPUへフォールバックします。
- 推論結果: 黒視点のOwnership予測（-1〜+1）、KataGoのニューラル目数差、黒の予測勝率。**MCTS探索は行っていません。** Ownershipを勝敗確率と同一視しないでください。
- 中国式（簡易コウ）・9路盤・コミ7.5に対応。例外的な反復局面、全手順の完全なルール互換は未検証です。
- MieGOのヒートマップは引き続きブラウザ内で計算。正式な着手のみP2P同期し、分析結果をサーバーへ送信しません。

## 既存の操作

対局URL共有 → 別端末から参加 → 仮置きとOwnership表示 → 手の確定 → パス・終局確認。カラーマップと透明度を変更できます。

### 制限と注意

- Cloudflare本番のKataGo推論・スマホ2台E2Eは未検証です。起動失敗時には画面に**簡易近傍影響モデルへの切り替え**を明示します。
- KataGoの小型モデルは強さや予測精度を検証するためのものではなく、初期統合の実行確認用です。
- 一般公開前に`/api/ice`への参加者認証・レート制限が必要です。安全対策が終わるまでTURNのSecretsは設定しないでください。
- 切断復帰、全中国式例外、死活の精度保証、日本ルールは未完成です。

## 開発者向け

Node.js 20以降が必要です。以下はCloudflare内で自動実行され、ユーザーがブラウザ以外の操作を行う必要はありません。

```bash
npm install
npm test
npm run dev
```

追加のライセンス・由来情報: `vendor/web-katrain/NOTICE.md` と `vendor/web-katrain/LICENSE`。
