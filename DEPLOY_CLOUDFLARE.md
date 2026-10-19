# MieGO — Cloudflareブラウザ完結デプロイマニュアル

更新日: 2026-10-18  
対象: [MieGO / main](https://github.com/KTakahiro1729/MieGO)  
構成: **Cloudflare Workers (Static Assets + Durable Objects)**、WebRTC DataChannel、ブラウザ内の試験的地合い推定

このマニュアルでは、**PCへのNode.js・Git・Wranglerのインストール、ターミナル操作、ZIPダウンロード、手動Git Pushが不要**な方法を案内します。GitHubのコードをCloudflareの**Workers Builds（GitHub連携）**に読み込ませ、Cloudflareが自動的にテストと配置を行います。

> この手順は「ブラウザだけでCloudflareへ初回デプロイし、その後の運用もブラウザで行う」ためのものです。Cloudflare/GitHubへのログインと両サービス間の接続許可は必要です。GitHubの変更をCloudflareが自動検知するため、**GitHub連携自体は使用します**。独立したCLIデプロイではありません。

## 1. Cloudflareにログイン

1. ブラウザで [Cloudflare Dashboard](https://dash.cloudflare.com/) にログインします。
2. **Workers & Pages** → **Create application** を開きます。
3. **Import a repository**（表記例: *Get started*）を選択します。
4. GitHubに接続し、Cloudflareによるリポジトリ参照を承認します。可能ならアクセス権限を **KTakahiro1729/MieGO** のみに絞ります。
5. リポジトリ **KTakahiro1729/MieGO** を選びます。

詳細: [Cloudflare公式: DashboardからWorkerを作成](https://developers.cloudflare.com/workers/get-started/dashboard/)

## 2. ビルド設定を入力

画面上の項目を次のとおりに設定します。

| 設定項目 | MieGOの値 |
| --- | --- |
| Project / Worker name | `miego` |
| Git provider | GitHub |
| Repository | `KTakahiro1729/MieGO` |
| Production branch | `main` |
| Root directory | `/`（リポジトリ直下、既定のまま） |
| Build command | `npm test` |
| Deploy command | `npx wrangler deploy` |
| Non-production branch builds / Preview | 初期段階は無効を推奨 |

**Build commandの `npm test` はCloudflare側で実行されます。** 手元でコマンドを打つ必要はありません。自動テストが失敗した場合はデプロイを止め、Cloudflareのビルドログで原因を確認してください。

`wrangler.jsonc` はすでにGitHubに存在し、`src/worker.mjs`、`public/`、Durable Objectsの`ROOMS`と移行設定を宣言しています。CloudflareダッシュボードのWorker名はファイル中の `"name": "miego"` と一致させます。

**Pagesの静的サイトのみとしてデプロイしないでください。** 対局ルームの作成・WebSocketシグナリングにWorkers/Durable Objectsが必要です。

参照: [Workers Builds設定](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)・[Git連携](https://developers.cloudflare.com/workers/ci-cd/builds/)

## 3. ブラウザのボタンでデプロイ

1. 設定を確認し、**Save and Deploy**（またはDeploy）を押します。
2. Cloudflareの**Builds / Deployments**で処理結果を確認します。初回は依存関係インストールとテストが自動的に実行されます。
3. 成功したらWorkerのURL（例: `https://miego.<subdomain>.workers.dev`）を開きます。**実際のURLは管理画面に表示されたもの**を使用してください。
4. ダッシュボードにWorkers.devの有効化が表示された場合は案内に従います。

※UIの名称はCloudflare側の変更で若干異なる場合があります。Builds画面の表示が異なる場合は、Workerの **Settings → Builds** を確認してください。

## 4. ブラウザだけで動作確認

デプロイ後のURLから下記を確認します。

1. `https://<実際のWorker URL>/api/health` をブラウザで開き、`"status":"ok"` と `"durableObjectBinding":true` を確認します（ブラウザからGET）。
2. Workerのトップページを開き、9路盤をタップして仮置き→確定します。
3. 地合いグラデーション、カラーマップ、不透明度を操作します。
4. **対局URLを作る**を押し、**招待リンクをコピー**します。
5. 別のスマホ・別ブラウザプロファイルでURLを開き、黒番と白番が接続できるか確認します。
6. 双方で着手を交換し、2回パス→死石確認→双方同意まで確認します。

`/api/health` の `"turnConfigured":false` は、TURNの秘密情報をまだ登録していないことを意味します。これはエラーではありません。STUNだけでP2P接続できるネットワークもあります。

**同じブラウザの同じプロファイルで招待リンクを開くと、セッショントークンを共有して正しく2人扱いされない場合があります。** 2端末または別プロファイルで検証してください。

## 5. すべてブラウザでできる更新・監視

- **コードの更新**: GitHub上のファイルを開く → 編集（鉛筆アイコン） → Commit changes。手動`git push`は不要です。
- **自動反映**: `main`へのコミットをCloudflare Workers Buildsが検知し、テスト → デプロイを実行します。
- **ビルド履歴**: Cloudflare → Workers & Pages → `miego` → **Builds / Deployments**。
- **設定・ログ**: 対象Worker → **Settings** / **Logs** などの画面で確認します（メニュー名はUIにより変わります）。
- **初回に既存Workerを選ぶ場合**: Worker → **Settings → Builds → Connect** でGitHubを接続します。ただし、接続だけではデプロイが開始されない場合があり、その際はCloudflareの画面から手動ビルドを開始するか、GitHub Web画面で新規コミットを作成してください。

なお、プロジェクトのランタイム構成の基準は`wrangler.jsonc`です。Cloudflareダッシュボードでランタイム設定を変更した場合、次回のGitHub連携デプロイで一部の設定が上書きされる可能性があります。

## 6. TURN（任意）をブラウザから設定する場合

MieGOはTURNなしでもSTUNで接続を試みます。NATの種類によってはTURNが必要ですが、**現行コードの `/api/ice` は参加者認証・レート制限が未実装**であり、一般公開状態でのTURN有効化は推奨しません。

対策を実装した後にTURNを使用する場合は、CloudflareダッシュボードでRealtime TURNキーを作成し、Workerの **Settings → Variables & Secrets**（Secretsの追加画面）から以下の**Secret**を登録します。

| Secret名 | 値 |
| --- | --- |
| `TURN_KEY_ID` | Realtime TURNのキーID |
| `TURN_API_TOKEN` | TURN用APIトークン |

**Secretの値はGitHubのコード、Wrangler設定ファイル、ブラウザのコンソールに書き込まないでください。** Cloudflareダッシュボード側の暗号化されたSecrets設定を使用します。これは任意の設定であり、最初の画面表示・局所的な動作確認には必要ありません。

参考: [Cloudflare Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)・[TURN認証情報の生成](https://developers.cloudflare.com/realtime/turn/generate-credentials/)

## 7. よくあるエラー

| 画面上の状況 | ブラウザで確認する箇所 |
| --- | --- |
| GitHubにリポジトリが表示されない | GitHubのCloudflareアプリ権限。必要なら対象リポジトリへのアクセスを許可 |
| Worker名が一致しない | CloudflareのWorker名が`miego`か確認 |
| `npm test` が失敗 | CloudflareのBuild logsを確認。デプロイしないまま修正 |
| Durable Objects移行エラー | `wrangler.jsonc`の`durable_objects` / `migrations` の設定と利用権限を確認 |
| HTMLだけ表示され、APIが404 | Workersとして配置されているか、`run_worker_first` と `/api/health` を確認 |
| /api/healthが開かない | Worker URL、Buildsでのデプロイ成功状態を確認 |
| 招待URLは開くがP2Pにならない | 別端末で再試行。ネットワーク環境によってTURNが必要 |
| 再デプロイ後も古い画面 | Deploymentsの日時、実際のURL、ブラウザのキャッシュを確認 |

## KataGo導入後のCloudflareビルド（2026-10-19）

ブラウザだけで管理できます。**GitHub連携済みの場合、`main`への今回の更新でCloudflare Buildsが起動します。** 設定は以前と同じです。

| 項目 | 値 |
| --- | --- |
| Build command | `npm test` |
| Deploy command | `npx wrangler deploy` |
| Root directory | リポジトリ直下 |
| Branch | `main` |

`npm test`前に実行される`pretest`が、TypeScriptのKataGoモジュールをesbuildで単一Workerにまとめます。約3.8MBのKataGo小型テストモデルを固定されたWeb KaTrain GitHubコミットから取得し、Git Blob SHA-1を検証します。TensorFlow.jsのWASM配布物もCloudflareの静的アセットとして配置されます。**KataGo実行にユーザー端末でのビルドやターミナル操作は不要です。**

CloudflareのBuild logsに`Browser KataGo worker built`、`KataGo model downloaded and verified`（またはcached）が出たことを確認してください。初回ビルドではモデル取得先の通信が必要です。ダウンロードまたはnpm installが失敗した場合はCloudflareがデプロイを中止するため、ログを確認してください。

公開後、AI補助をオンにして盤面を操作すると、初回はモデルをダウンロードします。解析中の表示が`KataGo NN単独評価 · webgpu` / `wasm` / `cpu` に変われば推論が完了しています。**`近傍影響モデルによる簡易推定` と表示された場合はKataGoが動いていません。** ブラウザの開発者ツールでエラーを確認してください。

WebGPUでの利用を優先しますが、非対応端末ではWASMまたはCPUで動きます。3.8MBのテストモデルは本格的な強さを目的としておらず、MCTS探索・棋力別補正はまだありません。Ownershipの色は推定値であって確定した地ではありません。

KataGo推論はブラウザWorkerで実行され、Cloudflare Workersのサーバー側でニューラルネットを実行するわけではありません。Cloudflare Workersは配信・招待URL・WebRTCシグナリングに使用します。TURN設定は引き続き一般公開前の認証・レート制限が必要です。

## 8. 重要な制限

- MieGOの「地合い予測」は現状**ブラウザ内の簡易近傍影響モデル**です。KataGoの小型モデルを使用しますが、MCTS探索や正確な死活判定ではありません。
- 9路盤・中国式の試験実装です。例外的な反復局面や切断時の復帰は未完成です。
- 対局ルームは信頼できる友人と試す用途であり、招待URLのみによる参加は堅牢なアクセス管理ではありません。
- ここでの手順はCloudflare公式仕様に基づきますが、実Cloudflareアカウントへの初回デプロイとモバイル実機E2Eは未検証です。

## 参考資料（公式）

- https://developers.cloudflare.com/workers/get-started/dashboard/
- https://developers.cloudflare.com/workers/ci-cd/builds/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/configuration/secrets/
