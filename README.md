# MieGO

9路盤・中国式面積計算（コミ7.5目）、友人同士の招待URLとWebRTC P2P対局、**KataGoニューラルネットによるOwnership・目数差・勝率のブラウザ内推定**を備えた試作アプリです。

## Cloudflareへのデプロイと運用（ブラウザのみ）

このREADMEにデプロイ手順を統合しています。**手元でのターミナル操作、Node.js・Git・Wranglerのインストール、ZIPダウンロード、手動のGit Pushは不要**です。GitHubとCloudflareのWeb画面だけを使用します。GitHubのリポジトリとCloudflare Workers Buildsを連携して、Cloudflare側でビルドと配置を実施します。

既に`main`とCloudflare Workers Buildsを連携済みの場合、初回作成を繰り返す必要はありません。今回のP2P仕様変更はまだDraft PRであり、**CI・2端末検証前には`main`へマージしないでください**。

### 1. Cloudflareにログイン

1. ブラウザで [Cloudflare Dashboard](https://dash.cloudflare.com/) にログインします。
2. **Workers & Pages** → **Create application** を開きます。
3. **Import a repository**（表記例: *Get started*）を選択します。
4. GitHubに接続し、Cloudflareによるリポジトリ参照を承認します。可能ならアクセス権限を **KTakahiro1729/MieGO** のみに絞ります。
5. リポジトリ **KTakahiro1729/MieGO** を選びます。

詳細: [Cloudflare公式: DashboardからWorkerを作成](https://developers.cloudflare.com/workers/get-started/dashboard/)

### 2. ビルド設定を入力

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

### 3. ブラウザのボタンでデプロイ

1. 設定を確認し、**Save and Deploy**（またはDeploy）を押します。
2. Cloudflareの**Builds / Deployments**で処理結果を確認します。初回は依存関係インストールとテストが自動的に実行されます。
3. 成功したらWorkerのURL（例: `https://miego.<subdomain>.workers.dev`）を開きます。**実際のURLは管理画面に表示されたもの**を使用してください。
4. ダッシュボードにWorkers.devの有効化が表示された場合は案内に従います。

※UIの名称はCloudflare側の変更で若干異なる場合があります。Builds画面の表示が異なる場合は、Workerの **Settings → Builds** を確認してください。

### 4. ブラウザだけで動作確認

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

### 5. すべてブラウザでできる更新・監視

- **コードの更新**: GitHub上のファイルを開く → 編集（鉛筆アイコン） → Commit changes。手動`git push`は不要です。
- **自動反映**: `main`へのコミットをCloudflare Workers Buildsが検知し、テスト → デプロイを実行します。
- **ビルド履歴**: Cloudflare → Workers & Pages → `miego` → **Builds / Deployments**。
- **設定・ログ**: 対象Worker → **Settings** / **Logs** などの画面で確認します（メニュー名はUIにより変わります）。
- **初回に既存Workerを選ぶ場合**: Worker → **Settings → Builds → Connect** でGitHubを接続します。ただし、接続だけではデプロイが開始されない場合があり、その際はCloudflareの画面から手動ビルドを開始するか、GitHub Web画面で新規コミットを作成してください。

なお、プロジェクトのランタイム構成の基準は`wrangler.jsonc`です。Cloudflareダッシュボードでランタイム設定を変更した場合、次回のGitHub連携デプロイで一部の設定が上書きされる可能性があります。

### 6. TurnstileをCloudflareダッシュボードだけで設定（P2Pには必須）

**`TURNSTILE_SITE_KEY`や`TURNSTILE_SECRET`の値はGitHubに書かれていません。** CloudflareでMieGO用Turnstileウィジェットを新しく作ると、そのウィジェット固有の**Site Key**と**Secret Key**が発行されます。変数名はMieGOコードが参照する固定名で、実際の値は自分のCloudflareアカウントで取得するものです。**ターミナルは使いません。**

#### 6-1. Turnstileウィジェットを作り、キーを取得する

1. [Cloudflareダッシュボード](https://dash.cloudflare.com/) にログインし、アカウントの**Turnstile**画面を開きます。
2. **Add widget**（ウィジェットを追加）を押します。
3. **Widget name**は`MieGO P2P`など、用途が分かる名前にします。
4. **Hostname management**には、実際にMieGOを公開しているホスト名を設定します（例：`miego.<自分のworkers.devサブドメイン>.workers.dev`。**文字列をそのまま入力せず、デプロイ画面に表示された実際のホスト名を使ってください**）。独自ドメイン利用時はそのホスト名を指定します。Preview URLで試験する場合、Previewの実際のホスト名も許可する必要があります。ホスト名が違うと検証できません。
5. **Widget mode**を**Managed**に設定します。Pre-clearanceは不要なので無効のままにします。
6. **Create**を押し、表示された**Site Key（sitekey）**と**Secret Key（secret）**を取得します。Secret Keyは機密情報なのでGitHub・チャット・ブラウザコードに貼らず、次のWorkerのSecret設定に直接登録します。

参照：[Turnstile公式：ダッシュボードでのウィジェット作成](https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/)・[ホスト名管理](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/)。

#### 6-2. Workerの「Variables and Secrets」へ登録する

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

#### 6-3. Cloudflareの画面で確認する

1. デプロイ後、**ブラウザ**で`https://<実際の公開ホスト>/api/health`を開き、`"turnstileConfigured":true`、`"durableObjectBinding":true`を確認します。これは必要な設定値が認識されたという確認であり、Turnstile認証成功を保証するものではありません。
2. MieGOで**URLで対戦**を選び、招待リンク作成時だけTurnstileが表示・実行されることを確認します。
3. 友人が初回に招待リンクを開くとTurnstileが要求され、その後の通常のページリロード・再接続では再要求されないことを確認します。
4. 失敗した場合はTurnstileウィジェットの**Hostname management**、Workerに登録した**変数名・種類・値**、**Builds / Deployments**および必要に応じてWorkerのログを確認します。ブラウザ・サイトキー・Secretが異なる環境に混在していないかも確かめます。

#### 6-4. TURNを使わない方針

MieGOの本変更では**WebRTC DataChannel + STUNのみ**を使用します。TURN中継は使わず、認証情報を生成する`/api/ice`も使用しません。Cloudflareダッシュボードの`TURN_KEY_ID`と`TURN_API_TOKEN`は不要で、既存の設定があれば削除してください。直接P2P接続できないネットワークでは、通信環境を変えるなどの対処が必要です。

### 7. よくあるエラー

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

### KataGoのクラウドビルドを確認

Cloudflare Workers BuildsのBuild commandは`npm test`、Deploy commandは`npx wrangler deploy`です。どちらもCloudflare側が実行します。`npm test`前の`pretest`がKataGoのブラウザWorkerをesbuildで生成し、固定コミットから小型モデル（約3.8MB）を取得・SHA-1で検証してTensorFlow.js WASMファイルを配置します。

CloudflareのBuild logsで`Browser KataGo worker built`および`KataGo model downloaded and verified`（またはcached）の表示を確認してください。モデルの取得や依存ライブラリの導入が失敗した場合にはデプロイされません。公開後、ブラウザで推論エンジンが`KataGo NN単独評価 · webgpu` / `wasm` / `cpu`と表示されるか確認します。`近傍影響モデルによる簡易推定`の場合はKataGoが動作していません。推論はユーザー端末内で実行し、Cloudflare Workersで推論するわけではありません。

### 本番デプロイ前に確認する制約

- P2P参加者の招待URLには参加資格が含まれます。招待先以外には転送しないでください。
- 両端末の`localStorage`を失った場合、サーバーに対局棋譜を残さない設計のため復元できません。
- STUNのみで直接P2P接続できないネットワークでは、通信回線を切り替える必要があります。TURNにはフォールバックしません。
- Cloudflare上のTurnstile設定と2台の実端末を用いる接続・リロード試験は、マージ前に別途実施してください。

### 参考資料（公式）

- https://developers.cloudflare.com/workers/get-started/dashboard/
- https://developers.cloudflare.com/workers/ci-cd/builds/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/configuration/secrets/


## 導入したKataGo

- [Web KaTrain](https://github.com/Sir-Teo/web-katrain) のMITライセンスのKataGoニューラル推論モジュールを`vendor/web-katrain/`へ固定バージョンで取り込み、TypeScript + esbuildで専用Workerにまとめます。
- モデル: Web KaTrainの`katago-small.bin.gz`（約3.8MB）。Cloudflareのビルド時に固定コミットから取得し、Git Blob SHA-1で検証して配置します。**テスト用の弱い小型モデルであり、本格的な棋力評価用ではありません。**
- 実行: WebGPUを優先し、利用できなければTensorFlow.js WASM、さらにCPUへフォールバックします。
- 推論結果: 黒視点のOwnership予測（-1〜+1）、KataGoのニューラル目数差、黒の予測勝率。**MCTS探索は行っていません。** Ownershipを勝敗確率と同一視しないでください。
- 中国式（簡易コウ）・9路盤・コミ7.5に対応。例外的な反復局面、全手順の完全なルール互換は未検証です。
- MieGOのヒートマップは引き続きブラウザ内で計算。正式な着手のみP2P同期し、分析結果をサーバーへ送信しません。

## 既存の操作

対局URL共有 → 別端末から参加 → 仮置きとOwnership表示 → 手の確定 → パス・終局確認。カラーマップと透明度を変更できます。

### 招待URLとコピー操作

作成者はP2P対局の準備画面で、自分の色を「ランダム（初期値）／黒番／白番」から選びます。ランダムの抽選は**作成者端末だけ**で新規ルーム発行時に実施し、再コピーでは変わりません。作成者用と参加者用で異なる秘密URLを使い、接続した順番は色に影響しません。

初回は「招待リンクを準備する」→Turnstile確認→「招待リンクをコピー」の2段階です。iPhone等では検証の通信後にクリップボード権限が失われる場合があるため、コピーをユーザー操作として独立させます。コピー拒否時は表示されたURLを手動でコピーできます。参加する友人も初回のみTurnstile確認が必要です。認証済み再接続時には原則不要です。

作成者が設定を変更した場合、ボタンは「新しい設定で招待リンクを作り直す」となり、対局開始前に限り、旧招待を無効化して新しいルームを発行します。局面は双方のブラウザ`localStorage`にのみ保存し、リロード後は双方の履歴を照合して再同期します。


## 制限と注意

- Cloudflare本番のKataGo推論・スマホ2台E2Eは未検証です。起動失敗時には画面に**簡易近傍影響モデルへの切り替え**を明示します。
- KataGoの小型モデルは強さや予測精度を検証するためのものではなく、初期統合の実行確認用です。
- このブランチではTURNおよび旧`/api/ice`を使いません。P2Pの新規作成・初回参加にTurnstile確認、再接続に参加資格が必要です。Workerに到達した不正な要求はWorkers Free枠を消費するため、分散DoS攻撃への完全な耐性はありません。
- 切断復帰の処理は実装ブランチに追加済みですが、実機の接続・復帰試験はまだ未実施です。両端末の保存データが失われると対局は復元できません。全中国式例外、死活の精度保証、日本ルールは未完成です。

## 開発者向け

Node.js 20以降が必要です。以下はCloudflare内で自動実行され、ユーザーがブラウザ以外の操作を行う必要はありません。

```bash
npm install
npm test
npm run dev
```

追加のライセンス・由来情報: `vendor/web-katrain/NOTICE.md` と `vendor/web-katrain/LICENSE`。

## ダークな碁盤中心デザイン

対局画面はスマートフォンを優先し、碁盤と地合いグラデーションを常時表示します。予測勝率・予測目数差などの数値パネルは表示しません（終局時の実際の採点は別）。仮置きの石には点線の輪郭を付け、確定の操作と区別しています。

地合いの初期カラーマップは**白〜灰〜黒**。設定から紫〜緑・青〜赤に変更でき、濃さも変更できます。配色は端末のブラウザに保存されます。グラデーションは新しいOwnership評価を受け取った際に短時間で変化し、動きを減らす端末設定にも対応します。

画面はあくまで所有傾向の可視化です。確率や予測目数差は表示せず、KataGoが利用できない場合は簡易モデル使用を通知します。

### CloudflareのPR Preview

Cloudflare Workers BuildsのPRデプロイコマンドが `npx wrangler preview` の場合、`wrangler.jsonc` の `previews.durable_objects.bindings` が必要です。MieGOは `env.ROOMS` を使うため、`GameRoom` をPreviewにも宣言しています。CloudflareはPreviewごとに独立したDurable Object名前空間とストレージを作成します。Build commandは `npm test`、Preview deploy commandは `npx wrangler preview` のままで構いません。Productionへのデプロイには `npx wrangler deploy` を使用してください。

Cloudflare公式仕様: https://developers.cloudflare.com/workers/previews/resources/#durable-objects

## 対AI戦と棋風パラメータ（PR #2）

`main`の碁盤中心デザインを保持し、ヘッダーの「AIと対局」から設定パネルを開きます。KataGoの小型モデルで対AI戦を行う場合、自分の色と**侵入度**・**補強度**をそれぞれ0〜100%で設定できます。50%が中立で、0%はその傾向を控え、100%は優先度を高くします。設定はブラウザ内に保存し、次の着手から適用します。

侵入度は相手が支配しそうな空点を選好する重み、補強度は自石の呼吸点改善や未確定の自陣境界の強化を選好する重みです。KataGoの方針logitsを基準に補正し、元の上位候補から大幅に外れた手・違法手は採用しません。**Ownershipは生存率を意味せず**、棋風調整は試験的な近似です。将来は候補ごとに局面評価し、実際に相手の地を削減できた量・自石の安定化を測る方法へ進めます。

棋力は本設定から独立させます。現在の「着手のばらつき」は棋力（段級位）を保証するものではありません。KataGoが使えない場合は対AI戦を開始・続行できず、代替AIへ切り替えません。

[AIの性格と棋力設計](docs/AI_PERSONALITIES.md)

## スマホの画面とモード導線
ヘッダーのプルダウンで「1台で打つ」「URLで対戦」「AIと対戦」を選びます。URL対戦では招待用シート、AI対戦では自分の色と任意の「AIの打ち方」詳細設定シートを開きます。設定シートは地合いの表示（白〜黒が初期配色）・濃さ・表示ON/OFF・クレジットに限定しました。対局中の投了は別の対局メニューにあります。盤面の180度回転は実装していません。
ローカルとAIの棋譜は別々のブラウザ保存先に置き、対局中のモード変更では確認します。P2P対局は各端末の`localStorage`へ保存し、切断復帰時は着手履歴と改訂番号を照合します。実機E2E試験は未実施です。

## 終局の提案（A＋D）

碁盤の下にある既存の地合いステータスと**同じ1行**で、AIの「終局の目安」を表示します。タップすると終局の相談がインラインで開き、通常の着手操作や碁盤の大きさは維持します。新しい常設の操作バーやポップアップは追加しません。

- **パスと終局の提案は別操作**です。提案は着手順とパス回数を変えません。
- AIによる「終局を検討できます」はKataGoのOwnership変化が複数の確定着手で落ち着き、明白なアタリがない場合だけ表示する**参考通知**です。確定した死活・地合いを保証しません。
- 地合い補助がオフでも、終局判定にはKataGoを使用します。KataGoが使えない場合、終局の目安は利用できません（対AI戦は利用不可）。通常のオンライン対局やパスは続けられます。
- **友人対局**では片方の終局提案が相手に届き、相手が明示的に同意したときだけ採点に進みます。拒否・取り下げ・着手続行も可能です。
- **対AI戦・ローカル練習**ではプレイヤーの終局提案後に自分で採点への移行を確認します。AIによる独立した死石判定は実装していません。
- 従来どおり、双方パスによる終局と死石確認・中国式面積計算も残しています。

## 最新モードUIと死石の自動仮判定（PR #3）

最新の`main`デザインとモード選択をマージ済みです。ヘッダーの「1台で打つ／URLで対戦／AIと対戦」からAIモードを選び、対局の準備シートで開始できます。KataGoが準備完了なら、招待ルームに参加中でもAIモードへ切り替え可能です（進行中の対局を離れる場合は確認します）。

終局の相談は既存の地合いステータスと同じ1行を使用します。死石候補は**KataGoのOwnershipから石の連ごとに保守的に自動仮指定**します。推定が強く相手有利な場合だけ盤上の石に印を付け、既存の採点パネル内で「AIが仮指定」と説明します。追加の常設UI・ポップアップはありません。

**重要:** 現在の小型モデルは生死を保証しないため、「自動指定＝死石の確定」ではありません。間違いは石をタップして修正できます。対局相手との最終合意（ローカル／AI戦では本人による確認）を経て勝敗確定となります。KataGoを利用できない場合は自動指定せず、手動指定に戻ります。

採点確定後は同じ採点欄に最終目数と勝敗を残します。投了時は目数を捏造せず、投了による勝敗だけ表示します。自動候補の追加と採点の確認で手番数やパス数は増えません。

### 中立の表示は透明
所有傾向が0の地点には色を塗りません。白寄り・黒寄りへの傾向が強いほど、その色が濃くなります。中立は灰色ではなく碁盤の色がそのまま見えます。凡例と設定見本も碁盤色を背景にした透明グラデーションで表示し、濃さスライダーは不透明度の上限を調整します。

## 友人対局の招待と復旧（実装ブランチの仕様）

- 作成者が「ランダム／黒番／白番」を選択します。ランダムの抽選は作成者の端末で一度だけ実行し、再コピーでは再抽選しません。
- 「招待リンクを準備する」→ Turnstile検証 → 「招待リンクをコピー」の順です。初回参加者もTurnstileを通過する必要があります。ローカル・AI対局、認証済み再接続には要求しません。
- 相手用の招待URLには参加者ごとの秘密キーをフラグメントに配置します。作成者のURLは別で、黒白の座席は接続順と無関係です。
- 色を変えた場合は「新しい設定で招待リンクを作り直す」となり、対局開始前のみ旧招待を失効させて新規ルームを発行します。
- 碁盤・手順・採点状態は両端末の localStorage に保存します。Durable Objectsには認可情報と短期WebSocketチケットだけを保存し、着手データは保存しません。両端末の保存が失われた場合は復旧できません。
- 再接続では同じ参加権限を利用し、WebRTCの再交渉後に双方の履歴と改訂番号を照合します。不一致時は自動上書きを停止します。
- 通信はCloudflare STUNとWebRTC DataChannelのみで行います。TURN利用・対局データのサーバー中継は行いません。

### Cloudflare Dashboardの設定（ターミナル不要）

**キーの取得・Workerへの登録・動作確認の詳細手順は、このREADME冒頭の「Cloudflareへのデプロイと運用（ブラウザのみ）」の第6章を参照してください。**

1. Turnstile → Add widget → Managed。MieGOの本番ホスト名を登録します。開発用Previewホストは必要に応じて別途登録します。
2. Workers & Pages → miego → Settings → Variables and Secretsで `TURNSTILE_SITE_KEY`（Text）と `TURNSTILE_SECRET`（Secret）を登録します。GitHubへSecretを書き込まないでください。
3. TURN用の `TURN_KEY_ID` と `TURN_API_TOKEN` は不要です。既存設定があれば不要な課金経路を避けるため削除します。
4. PRのCIを確認し、ブラウザ実機のP2P・リロード・旧リンク失効を確認後、GitHubのUIからmainにマージします。GitHub連携されたWorkers Buildsで自動デプロイします。
5. `/api/health`で `turnstileConfigured:true`、`durableObjectBinding:true`を確認します。2端末で招待・着手・途中リロード・切断復帰をテストします。

本番のCloudflare設定前にはルーム作成が本人確認エラーとなります。Previewおよび本番環境の実機検証は別途必要です。
