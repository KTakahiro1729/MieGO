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
4. **友人を招待**を開き、自分の色として**ランダム（初期値）・黒番・白番**を選びます。
5. **招待リンクを準備する**を押してTurnstileの人間確認を完了し、その後**招待リンクをコピー**します。画面のコピー操作を分けるのはスマートフォンのクリップボード権限を保つためです。
6. 友人が別のスマホ・別ブラウザプロファイルでリンクを開き、初回参加時だけTurnstileを完了します。黒白が作成者端末の選択どおりになることを確認します。
7. 双方で着手を交換し、2回パス→死石確認→双方同意まで確認します。
8. **対局途中で双方のページを順番にリロード**し、元の色と局面へ復帰することを確認します。相手との手順が矛盾する場合は自動上書きせずエラーを表示します。
9. 対局開始前に色設定を変更し、**新しい設定で招待リンクを作り直す**操作によって以前の招待リンクが失効することを確認します。

`/api/health` の `"turnstileConfigured":true` と `"durableObjectBinding":true` を確認してください。`"turnConfigured":false` は**STUNのみ・TURNなし**の想定動作です。Turnstile未設定では新規P2P対局を作成できません。

**同じブラウザの同じプロファイルで2人分のURLを開かず、2台のスマホまたは別プロファイルで検証してください。** 棋譜は両端末の`localStorage`だけに保存され、両者の保存が消失すると対局は復元できません。

## 5. すべてブラウザでできる更新・監視

- **コードの更新**: GitHub上のファイルを開く → 編集（鉛筆アイコン） → Commit changes。手動`git push`は不要です。
- **自動反映**: `main`へのコミットをCloudflare Workers Buildsが検知し、テスト → デプロイを実行します。
- **ビルド履歴**: Cloudflare → Workers & Pages → `miego` → **Builds / Deployments**。
- **設定・ログ**: 対象Worker → **Settings** / **Logs** などの画面で確認します（メニュー名はUIにより変わります）。
- **初回に既存Workerを選ぶ場合**: Worker → **Settings → Builds → Connect** でGitHubを接続します。ただし、接続だけではデプロイが開始されない場合があり、その際はCloudflareの画面から手動ビルドを開始するか、GitHub Web画面で新規コミットを作成してください。

なお、プロジェクトのランタイム構成の基準は`wrangler.jsonc`です。Cloudflareダッシュボードでランタイム設定を変更した場合、次回のGitHub連携デプロイで一部の設定が上書きされる可能性があります。

## 6. TurnstileをCloudflareダッシュボードだけで設定（P2Pには必須）

**`TURNSTILE_SITE_KEY`や`TURNSTILE_SECRET`の値はGitHubに書かれていません。** CloudflareでMieGO用Turnstileウィジェットを新しく作ると、そのウィジェット固有の**Site Key**と**Secret Key**が発行されます。変数名はMieGOコードが参照する固定名で、実際の値は自分のCloudflareアカウントで取得するものです。**ターミナルは使いません。**

### 6-1. Turnstileウィジェットを作り、キーを取得する

1. [Cloudflareダッシュボード](https://dash.cloudflare.com/) にログインし、アカウントの**Turnstile**画面を開きます。
2. **Add widget**（ウィジェットを追加）を押します。
3. **Widget name**は`MieGO P2P`など、用途が分かる名前にします。
4. **Hostname management**には、実際にMieGOを公開しているホスト名を設定します（例：`miego.<自分のworkers.devサブドメイン>.workers.dev`。**文字列をそのまま入力せず、デプロイ画面に表示された実際のホスト名を使ってください**）。独自ドメイン利用時はそのホスト名を指定します。Preview URLで試験する場合、Previewの実際のホスト名も許可する必要があります。ホスト名が違うと検証できません。
5. **Widget mode**を**Managed**に設定します。Pre-clearanceは不要なので無効のままにします。
6. **Create**を押し、表示された**Site Key（sitekey）**と**Secret Key（secret）**を取得します。Secret Keyは機密情報なのでGitHub・チャット・ブラウザコードに貼らず、次のWorkerのSecret設定に直接登録します。

参照：[Turnstile公式：ダッシュボードでのウィジェット作成](https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/)・[ホスト名管理](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/)。

### 6-2. Workerの「Variables and Secrets」へ登録する

1. 同じCloudflareダッシュボードで **Workers & Pages → `miego` → Settings → Variables and Secrets** に進みます。ダッシュボードの表示が多少異なる場合は対象Workerの**Settings**から変数・Secretの編集画面を探してください。
2. **Add variable**（またはAdd）から次の2つを、**名前は完全一致**させて登録します。

| Cloudflare Workerの変数名 | 種類 | 入力する値 | 公開可否 |
| --- | --- | --- | --- |
| `TURNSTILE_SITE_KEY` | Text | 6-1で発行された**Site Key** | ブラウザに渡される公開用の値 |
| `TURNSTILE_SECRET` | Secret（暗号化された機密変数） | 6-1で発行された**Secret Key** | **公開不可**、サーバーだけで使用 |

3. **Save** / **Deploy**等の画面上の確定操作を完了し、**変更が本番Workerへ反映されたこと**を確認します。Secretの登録をGitHubにコミットする必要はありません。
4. Previewを使う場合は、Preview環境に変数とSecretが引き継がれるかを確認し、必要ならPreviewにも登録します。異なるホスト名・別ウィジェットを使う場合は、それぞれに対応した組を登録してください。

MieGOでは`src/worker.mjs`の`env.TURNSTILE_SITE_KEY`と`env.TURNSTILE_SECRET`を参照します。Site Keyは`/api/p2p/config`経由でブラウザへ渡しますが、Secret KeyはSiteverifyによるサーバー側の確認にのみ使用します。

参照：[Cloudflare Workers公式：Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)・[Turnstile公式：検証](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)。

### 6-3. Cloudflareの画面で確認する

1. デプロイ後、**ブラウザ**で`https://<実際の公開ホスト>/api/health`を開き、`"turnstileConfigured":true`、`"durableObjectBinding":true`を確認します。これは必要な設定値が認識されたという確認であり、Turnstile認証成功を保証するものではありません。
2. MieGOで**URLで対戦**を選び、招待リンク作成時だけTurnstileが表示・実行されることを確認します。
3. 友人が初回に招待リンクを開くとTurnstileが要求され、その後の通常のページリロード・再接続では再要求されないことを確認します。
4. 失敗した場合はTurnstileウィジェットの**Hostname management**、Workerに登録した**変数名・種類・値**、**Builds / Deployments**および必要に応じてWorkerのログを確認します。ブラウザ・サイトキー・Secretが異なる環境に混在していないかも確かめます。

### 6-4. TURNを使わない方針

MieGOの本変更では**WebRTC DataChannel + STUNのみ**を使用します。TURN中継は使わず、認証情報を生成する`/api/ice`も使用しません。Cloudflareダッシュボードの`TURN_KEY_ID`と`TURN_API_TOKEN`は不要で、既存の設定があれば削除してください。直接P2P接続できないネットワークでは、通信環境を変えるなどの対処が必要です。

## 7. よくあるエラー

| 画面上の状況 | ブラウザで確認する箇所 |
| --- | --- |
| GitHubにリポジトリが表示されない | GitHubのCloudflareアプリ権限。必要なら対象リポジトリへのアクセスを許可 |
| Worker名が一致しない | CloudflareのWorker名が`miego`か確認 |
| `npm test` が失敗 | CloudflareのBuild logsを確認。デプロイしないまま修正 |
| Durable Objects移行エラー | `wrangler.jsonc`の`durable_objects` / `migrations` の設定と利用権限を確認 |
| HTMLだけ表示され、APIが404 | Workersとして配置されているか、`run_worker_first` と `/api/health` を確認 |
| /api/healthが開かない | Worker URL、Buildsでのデプロイ成功状態を確認 |
| P2Pの本人確認が失敗する | Turnstileウィジェットの許可ホスト名、Site Key／Secret Key、Workerの変数名とデプロイ反映を確認 |
| 招待URLは開くがP2Pにならない | 2台の端末で確認し、異なるWi-Fi・モバイル回線を試す。STUNだけでは接続不能なネットワークもある |
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

KataGo推論はブラウザWorkerで実行され、Cloudflare Workersのサーバー側でニューラルネットを実行するわけではありません。Cloudflare Workersは配信・招待URL・WebRTCシグナリングに使用します。TURNは今回の構成では使用しません。新規P2P対局の認証にはTurnstileを使用します。

## 8. 重要な制限

- MieGOの「地合い予測」は現状**ブラウザ内の簡易近傍影響モデル**です。KataGoの小型モデルを使用しますが、MCTS探索や正確な死活判定ではありません。
- 9路盤・中国式の試験実装です。例外的な反復局面や接続状況によっては復帰できない場合があります。
- 対局ルームは信頼できる友人と試す用途です。招待URLには参加権限となる秘密情報が含まれるため、第三者への再共有に注意してください。
- ここでの手順はCloudflare公式仕様に基づきますが、実Cloudflareアカウントへの初回デプロイとモバイル実機E2Eは未検証です。

## 参考資料（公式）

- https://developers.cloudflare.com/workers/get-started/dashboard/
- https://developers.cloudflare.com/workers/ci-cd/builds/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/configuration/secrets/
