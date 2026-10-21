# MieGO

スマートフォン優先のブラウザ囲碁アプリです（https://miego.fun）。9路・13路・19路盤で、1台で打つ・対COM・COM同士の観戦・友人との招待URL対局（WebRTC P2P）ができます。ルールは中国式（互先コミ7.5目）・日本式（互先コミ6.5目、アゲハマ表示・セキの地は数えない）・五目並べ（禁じ手の有無を選択）・ルールのない「自由」盤から選べ、置き碁・持ち時間と秒読み・石を隠す対局にも対応します。**KataGoのニューラルネットで地合い（Ownership）と目数差をブラウザ内で推定**し、盤上のグラデーションとして表示します。

## Cloudflareへのデプロイと運用（ブラウザのみ）

このREADMEにデプロイ手順を統合しています。**手元でのターミナル操作、Node.js・Git・Wranglerのインストール、ZIPダウンロード、手動のGit Pushは不要**です。GitHubとCloudflareのWeb画面だけを使用します。GitHubのリポジトリとCloudflare Workers Buildsを連携して、Cloudflare側でビルドと配置を実施します。

既に`main`とCloudflare Workers Buildsを連携済みの場合、初回作成を繰り返す必要はありません。

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
| Non-production branch builds / Preview | 有効にする場合は下の「CloudflareのPR Preview」を参照 |

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
3. 設定（歯車）で地合いの配色と濃さを操作します。
4. **新規対戦**を開いて**対友人**を選び、「自分の石」で**黒・ランダム・白**のどれかを選びます。
5. **新しい対局を始める**を押してTurnstileの人間確認を完了し、もう一度押して**招待リンクをコピー**します。押す操作を分けるのはスマートフォンのクリップボード権限を保つためです。
6. 友人が別のスマホ・別ブラウザプロファイルでリンクを開き、初回参加時だけTurnstileを完了します。黒白が作成者端末の選択どおりになることを確認します。
7. 双方で着手を交換し、2回パス→死石確認→双方同意まで確認します。
8. **対局途中で双方のページを順番にリロード**し、元の色と局面へ復帰することを確認します。相手との手順が矛盾する場合は自動上書きせずエラーを表示します。
9. 対局開始前に色などの設定を変更し、**新しい設定で招待リンクを作り直す**操作によって以前の招待リンクが失効することを確認します。

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

**Site Keyは公開用の値であり、`wrangler.jsonc`の本番`vars`と`previews.vars`に登録済みです。** GitHub連携からデプロイすれば反映されます。`TURNSTILE_SECRET`は機密情報なのでコードに記載せず、CloudflareダッシュボードのSecretとして別途設定してください。ターミナル操作は不要です。

#### 6-1. Turnstileウィジェットを作り、キーを取得する

1. [Cloudflareダッシュボード](https://dash.cloudflare.com/) にログインし、アカウントの**Turnstile**画面を開きます。
2. **Add widget**（ウィジェットを追加）を押します。
3. **Widget name**は`MieGO P2P`など、用途が分かる名前にします。
4. **Hostname management**の本番ホスト名は`miego.poet-takahiro1234.workers.dev`です（`https://`と末尾`/`を除く）。Preview URLでテストするなら、該当Previewの**実際のホスト名**もウィジェットの許可対象に登録してください。ホスト名が違うと検証できません。
5. **Widget mode**を**Managed**に設定します。Pre-clearanceは不要なので無効のままにします。
6. **Create**を押し、表示された**Site Key（sitekey）**と**Secret Key（secret）**を取得します。Secret Keyは機密情報なのでGitHub・チャット・ブラウザコードに貼らず、次のWorkerのSecret設定に直接登録します。

参照：[Turnstile公式：ダッシュボードでのウィジェット作成](https://developers.cloudflare.com/turnstile/get-started/widget-management/dashboard/)・[ホスト名管理](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/)。

#### 6-2. Workerの「Variables and Secrets」へ登録する

1. 公開用`TURNSTILE_SITE_KEY`は、`wrangler.jsonc`の`vars`（Production）と`previews.vars`（Preview）に**同じSite Key**を定義してあります。Cloudflareの画面に入力し直す必要はありません。**Wrangler設定を公開変数の正とする**ため、ダッシュボードで別のSite Keyに書き換えないでください。
2. **Workers & Pages → `miego` → Settings → Variables and Secrets** で機密変数`TURNSTILE_SECRET`を**Secret**として登録してください。これは6-1で発行した**Secret Key**です。Textにはしないでください。
3. **Previews Base**（または該当Preview）の設定にも`TURNSTILE_SECRET`があるか確認してください。**Previewは本番Secretを継承しません**。Preview用に同じウィジェットを使用するなら、そのSecret KeyをPreview側にも個別に登録します。
4. Save / Deployを画面で完了してください。Secretの値をGitHubへコミットする必要はありません。Wranglerの通常のデプロイは既存のSecretを消去しません。

MieGOでは`src/worker.mjs`の`env.TURNSTILE_SITE_KEY`と`env.TURNSTILE_SECRET`を参照します。Site Keyは`/api/p2p/config`経由でブラウザへ渡し、Secret KeyはSiteverifyによるサーバー側の確認にのみ使用します。`wrangler.jsonc`にはSecret値を書き込みません。

参照：[Cloudflare Workers公式：Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)・[Turnstile公式：検証](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)。

#### 6-3. Cloudflareの画面で確認する

1. デプロイ後、**ブラウザ**で`https://<実際の公開ホスト>/api/health`を開き、`"turnstileConfigured":true`、`"durableObjectBinding":true`を確認します。これは必要な設定値が認識されたという確認であり、Turnstile認証成功を保証するものではありません。
2. MieGOの「新規対戦」で**対友人**を選び、招待リンク作成時だけTurnstileが表示・実行されることを確認します。
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
| P2PのTurnstile確認が失敗する | Turnstileウィジェットの許可ホスト名、Site Key／Secret Key、Workerの変数名とデプロイ反映を確認 |
| 招待URLは開くがP2Pにならない | 2台の端末で確認し、異なるWi-Fi・モバイル回線を試す。STUNだけでは接続不能なネットワークもある |
| 再デプロイ後も古い画面 | Deploymentsの日時、実際のURL、ブラウザのキャッシュを確認 |

### KataGoのクラウドビルドを確認

Cloudflare Workers BuildsのBuild commandは`npm test`、Deploy commandは`npx wrangler deploy`です。どちらもCloudflare側が実行します。`npm test`前の`pretest`がKataGoのブラウザWorkerをesbuildで生成し、固定コミットから小型モデル（約3.8MB）を取得・SHA-1で検証してTensorFlow.js WASMファイルを配置します。

CloudflareのBuild logsで`Browser KataGo worker built`および`KataGo model downloaded and verified`（またはcached）の表示を確認してください。モデルの取得や依存ライブラリの導入が失敗した場合にはデプロイされません。公開後、ブラウザで盤下の表示が「地合いを表示中 · KataGoによる試験的推定」になるか確認します。「地合いを表示中 · 簡易影響モデル」の場合はKataGoが動作していません。推論はユーザー端末内で実行し、Cloudflare Workersで推論するわけではありません。

### 本番デプロイ前に確認する制約

- P2P参加者の招待URLには参加資格が含まれます。招待先以外には転送しないでください。
- 両端末の`localStorage`を失った場合、サーバーに対局棋譜を残さない設計のため復元できません。
- STUNのみで直接P2P接続できないネットワークでは、通信回線を切り替える必要があります。TURNにはフォールバックしません。
- P2Pの通信や招待に関わる変更では、Cloudflare上のTurnstile設定と2台の実端末を用いる接続・リロード試験を推奨します。

### 参考資料（公式）

- https://developers.cloudflare.com/workers/get-started/dashboard/
- https://developers.cloudflare.com/workers/ci-cd/builds/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/
- https://developers.cloudflare.com/workers/wrangler/configuration/
- https://developers.cloudflare.com/workers/configuration/secrets/


## 導入したKataGo

- [Web KaTrain](https://github.com/Sir-Teo/web-katrain) のMITライセンスのKataGoニューラル推論モジュールを`vendor/web-katrain/`へ固定バージョンで取り込み、TypeScript + esbuildで専用Workerにまとめます。
- モデル: Web KaTrainの`katago-small.bin.gz`（約3.8MB）。Cloudflareのビルド時に固定コミットから取得し、Git Blob SHA-1で検証したうえで、大きな重みをfloat16に丸めた`katago-small.f16.bin.gz`（約1.9MB）として配置します。地合いの推定と「最強」以外のCOMに使います。**小型モデルなので、推定や棋力は参考程度です。**
- 実行: WebGPUを優先し、利用できなければTensorFlow.js WASM、さらにCPUへフォールバックします。
- **「最強」**: 9路はKataGo作者が配布する9路専用ネット [kata9x9-b18c384nbt-20231025](https://github.com/lightvector/KataGo/releases/tag/v1.13.2-kata9x9)（約98MB、作者は9路以外での使用を勧めていません）、13路・19路はKataGo本流の [kata1-b18c384nbt-s9996604416-d4316597426](https://katagotraining.org/networks/)（約96MB、Web KaTrainがブラウザ向けに勧めるもの）を使います（`public/strong-networks.mjs`）。ビルド時に固定URLから取得してSHA-256で検証し（b18のハッシュはHomebrewのkatago定義が固定している値）、Cloudflareの1ファイル25MiB制限に合わせて`public/models/<key>/`へ24MiBずつ分割して置きます。ページを開いただけでは読み込まず、「最強」の対局が始まったときに別のWorkerでその盤の大きさのネットを読み込みます。ふだんは探索せず方針の最上位の手を打ちます（性格の補正は使いません）。手番側がKataGoの予測目数差で2目以上負けているなら、方針の上位8手の合法手を実際に打ってそれぞれ評価し、目数差が最もよい手を選ぶ「1手読み」をします。6目以上なら上位5手それぞれに相手の方針上位3手の応手を読み、相手の最善の応手での目数差が最もよい手を選ぶ「2手読み」（最大20回の評価）にします。勝率でなく目数差を使うのは、9路・コミ7.5では初手から黒の勝率が6%前後（0.5目負け）と出て、勝率では判断がつかないためです。「最強」の番の間は手番の表示が「AIが思考中です」になってその右で金色の弧が回り、その下の行に何をしているかを出します（「AIをダウンロード中 51%」「AIを準備中」「次の一手を計算中」「2手先を読み中 35%・約5秒」。読みの%は評価した局面の割合、秒数は残りの評価回数×1回の評価時間の移動平均）。読み込めなかった場合は小型モデルで打ち続けます。
- 推論結果: 黒視点のOwnership予測（-1〜+1）、KataGoのニューラル目数差、黒の予測勝率。**地合いの推定と「最強」以外のCOMではMCTS探索を行っていません。** Ownershipを勝敗確率と同一視しないでください。
- ルール: 中国式（互先コミ7.5、KataGoの`chinese`ルール）と日本式（互先コミ6.5、KataGoの`japanese`ルール）に対応し、盤の大きさによらずコミは同じです。置き碁（9路は2〜5子・13路と19路は2〜9子、星に固定配置）はコミ0.5で、中国式のみ置き石数を白に加算します（KataGoの`whiteHandicapBonus=N`と同じ）。コウは簡易コウ（直前の局面に戻る手を禁止）で、例外的な反復局面の完全なルール互換は未検証です。
- 五目並べのCOMはKataGoを使わず、並びの長さを数える簡単な読みで打ちます。
- ヒートマップは引き続きブラウザ内で計算します。正式な着手のみP2P同期し、分析結果をサーバーへ送信しません。

## 新規対戦のシート

ヘッダーには「新規対戦」と、共有・ヘルプ・設定（歯車）のアイコンがあります。「新規対戦」を押すとシートが開きます。

- 上段で種類を選びます：**対COM**／**観戦**／**対友人**、その下に**1台で打つ**。「現在の対局に戻る」でシートを閉じて盤上の対局へ戻り（棋譜を再生中なら再生も終えます）、「対戦履歴を見る」で同じシートの中に履歴の一覧とSGF読み込みを開きます。
- その下のタブで設定します：**自分の石**（黒・ランダム・白）／**COMのキャラ**／**盤**（9・13・19路）／**ルール**（中国式・日本式・五目並べ・自由。置き石・五目並べの禁じ手・石を隠すは「ルールの追加設定」）／**時間**（持ち時間・秒読み・観戦の速さ）。そのモードで使わない設定はグレーアウトします。
- 一番下の「新しい対局を始める」で始めます。対友人では、この押下で招待リンクを作ります（「友人対局の招待と復旧」参照）。
- いまの対局は履歴に残ります。別の種類を選ぶと「途中のAI対局に戻る」「途中の1台の対局に戻る」でそのモードの終わっていない対局を再開できます。友人対局へは履歴から戻ります。
- 終局後の「もう一局」は、盤・ルール・置き石と、対COMならCOMと自分の石の選び方も同じにして次の対局を始めます。

対局中の操作列には「待った」「パス」「投了」などが並びます。投了は二度押し（1回目で「投了？」に変化）で確定し、パスは1回で確定します。盤面の180度回転は実装していません。ローカルとAIの棋譜は別々のブラウザ保存先に置き、対局中のモード変更では確認します。

## 対COMと観戦

- **COMのキャラ**：ひよこ／石橋／荒らし屋／喧嘩屋／大場好き／本気／名人／カスタム（新規の既定は「ひよこ」）。キャラは強さと3つの打ち方の好みの組み合わせで、「カスタム」では自分で選べます（`public/ai-characters.mjs`）。
- **AIの強さ**（はじめて／やさしい／ふつう／つよい／最強）：5段階のバーは「カスタム」のときだけ表示されます。弱い3段階は[KaTrain](https://github.com/sanderland/katrain)の校正済みランク戦略（MIT）の式を移植し、「合法手からN手を無作為に選び、その中でKataGoの方針が最も高い手を打つ」方式です。完全なランダム手ではなく形の良い候補から外れていくため、ミスが人間らしく見えやすいことを狙っています。方針確率が突出した手（取る・逃げるなど緊急の手）やパスが妥当な局面では最善の方針手を選びます。弱い段階でも自分の眼を埋める手は抽選から外します。「つよい」は温度付き方針サンプリングで、強さ導入前に保存されたAI棋譜は「つよい」として再開します。「最強」は大きいネットを使います（「導入したKataGo」参照）。
- KaTrainの定数は19路盤・フルサイズのネットワークで校正されたものです。MieGOの小型モデルでは**段階の順序のみ**を意図しており、段級位の目安ではありません。
- **打ち方の好み**（各3段階）：「戦い方」（守る／ふつう／攻め込む）、「序盤」（地を取る／ふつう／勢力を作る）、「相手の手に」（応じる／ふつう／手を抜く）。読みはせず、KataGoの方針logitsを補正して好みに合う手を少し選びやすくするだけで、元の上位候補から大きく外れた手・違法手は採用しません（`public/ai-personality.mjs`）。以前の侵入度・補強度の保存値は「戦い方」に換算します。設計の詳細は[AIの性格と棋力設計](docs/AI_PERSONALITIES.md)。
- **置き石**：「ルール」タブで「なし／2子〜9子」を選べます（9路盤は5子まで）。AI対戦では置き石があるとあなたが黒になり、AIが白で先に打ちます。置き石は星に置き、右上・左下・右下・左上の順で、5子以上の奇数は天元、6子・8子は辺の星を加えます。
- **観戦**：黒も白もCOMが打ちます。黒と白それぞれのキャラを「COMのキャラ」タブで、手の間の長さを「時間」タブの「観戦の速さ」で決めます。「一時停止」で止められ、「介入する」を押して盤をタップすると、その手番の色を引き継いでCOMと対戦を続けられます。
- KataGoが使えない場合は囲碁の対COM・観戦を開始・続行できず、代替AIへ切り替えません。

## 待った

仮置きがないとき、操作列左端の「待った」を1回押すと戻します。1台＝直前の1手、対COM＝自分の直前の手（とその後のAIの応手）まで、対友人＝相手が受け入れたら自分の直前の手まで。棋譜は残りの手を最初から打ち直して再構築するため、アゲハマ・コウ履歴も整合します。パスも待ったで戻せます。

## 盤の大きさ（9路・13路・19路）

「新規対戦」の「盤」タブで選びます。友人対局は招待を作る側の選択（盤の大きさ・ルール・置き石・持ち時間）で始まり、着手前に限って招待された側の盤を合わせます。招待後に設定を変えると「新しい設定で招待リンクを作り直す」になります。

盤の大きさは盤面データの長さから求めるため、保存形式は変えておらず、これまでの9路の棋譜はそのまま読めます。KataGoは同じ小型モデルを各サイズで使います（ネットワークは盤サイズに依存しない構造）。13路・19路での推定の質は9路以上に参考程度です。19路は9路の約4.5倍の交点を評価するため、端末によってはAIの応答や地合い表示が遅くなります。

## 盤面のピンチ拡大

碁盤は2本の指で広げると拡大、指で動かすと移動できます（トラックパッドのピンチにも対応）。拡大中は拡大した盤が画面全体まで広がり、元の盤の範囲だけをくっきり、その外側はぼかして他の操作部品の下に表示します。右上の「全体を表示」で元に戻ります。AIや友人が着手すると自動的に全体表示へ戻ります（観戦中は拡大を保ちます）。13路盤以上で同じあたりを繰り返しタップしている場合だけ、操作を妨げない「広げる」ヒントを一度だけ表示します。

## 地合いの表示と盤の見た目

対局画面は碁盤と地合いグラデーションを常時表示します。予測勝率・予測目数差の数値パネルは表示しません（終局時の実際の採点は別）。棋譜をさかのぼると、手数のバーが推定目数差の形勢グラフになります。仮置きの石には点線の輪郭を付け、確定の操作と区別しています。KataGoが利用できない場合は簡易影響モデルの使用を盤下に表示します。

所有傾向が0の地点には色を塗らず、碁盤の色がそのまま見えます。白寄り・黒寄りへの傾向が強いほど、その色が濃くなります。

設定（歯車）のシートでは、碁盤（木目／ライト／ダーク／カスタム）、地合いの配色（白〜黒が初期配色、緑〜紫、カスタム（4色を選ぶ）、表示しない）と濃さ（V字／U字、いちばん濃い所）、効果音（既定はオフ）を選べます。「表示しない」は対局中でもいつでも切り替えられる端末ごとの設定です。配色は端末のブラウザに保存されます。グラデーションは新しいOwnership評価を受け取った際に短時間で変化し、動きを減らす端末設定にも対応します。

## 終局と採点

- 盤下の終局のバーに、AIの目安（「終局はまだまだです」「そろそろ終局です」「終局をご検討ください」）とボタンを表示します。1台・対COMは「採点を始める」→「採点へ進む」、対友人は「終局を提案」し、相手が受け入れると採点に進みます。続けて2回パスしても採点に進みます。
- 目安はKataGoのOwnership変化が複数の確定着手で落ち着いた場合に出す**参考通知**です。確定した死活・地合いを保証しません。カラーマップが「表示しない」でも目安にはKataGoを使用し、KataGoが使えない場合は「終局は自分で判断してください。目安を出せません」と表示します。
- 採点に入ると、AIが盤のコピーでダメを詰め（決着手順、中国式では死石も打って取る）、死石の候補を出します。境目が閉じていない所には打たず、どちらの地にもしません（日本囲碁規約の第八条・第九条に合わせる）。対局の棋譜は変わりません。途中で「スキップ」でき、「決着手順を再生」でもう一度見られます（`public/settle-playout.mjs`）。
- 死石候補は石をタップして直せます。中国式は面積計算、日本式は地とアゲハマで数えます。納得したら「この計算に同意」で確定し、対友人は2人とも同意すると確定します。採点中でも「対局を再開」で打ち続けられます。
- **重要:** 小型モデルは生死を保証しないため、死石候補は確定ではありません。投了時は目数を捏造せず、投了による勝敗だけ表示します。

## 打てない場所（禁止手）

囲碁の禁じ手（自殺手・直前の局面に戻るコウ）は、**盤上へ事前にマークしません**。自分の手番で空点を選択すると、合法手でも禁止手でも半透明の石を仮置きできます。禁止手を選んでも正式な着手・棋譜・盤面・通信内容は変わりません。

- 合法手を選択：「ここに打つ」を押して確定します。
- 禁止手を選択：確定は無効となり、盤下に理由（コウ・自殺手、五目並べでは三三・四四・長連の禁じ手）を表示し、「AIに質問」（質問文をコピー）を出します。禁止手の仮置き中は終局のボタンを一時的に隠します。
- コピーした文章：**確定済みの棋譜のSGF URL**・**●（黒石）／○（白石）／・（空点）**の座標ラベルなし文字図・手番・判定理由、コウの場合は一手前の盤面を含みます。打とうとした禁止点は◇で示します。友人招待URLや認証情報は含めません。MieGO自身がAIへ送信するわけではありません。
- コピーがブラウザに拒否された場合のみ、文章を選択・手動コピーできる小さなパネルを開きます。

棋譜の確定に関する判定は常に `public/core.mjs` の `play()`（五目並べは `public/gomoku.mjs`）に委ね、仮置きと質問文生成は `public/illegal-moves.mjs`、表示は `public/board-renderer.mjs`、操作切替は `public/app.mjs` が担当します。

## 友人対局の招待と復旧

- 作成者が「自分の石」で「黒／ランダム／白」を選択します。ランダムの抽選は作成者の端末で新規ルーム発行時に一度だけ実行し、再コピーでは再抽選しません。
- 「新しい対局を始める」→ Turnstile検証 → もう一度押して「招待リンクをコピー」の順です。iPhone等では検証の通信後にクリップボード権限が失われる場合があるため、コピーをユーザー操作として独立させます。コピー拒否時は表示されたURLを手動でコピーできます。初回参加者もTurnstileを通過する必要があります。ローカル・AI対局、認証済み再接続には要求しません。
- 相手用の招待URLには参加者ごとの秘密キーをフラグメントに配置します。作成者のURLは別で、黒白の座席は接続順と無関係です。アドレスバーには参加用の鍵を残さず、別の端末で続けるときは「別の端末で続ける」から自分用の再入室リンクをコピーします。
- 設定を変えた場合は「新しい設定で招待リンクを作り直す」となり、対局開始前のみ旧招待を失効させて新規ルームを発行します。
- 碁盤・手順・採点状態は両端末の`localStorage`に保存します。Durable Objectsには認可情報と短期WebSocketチケットだけを保存し、着手データは保存しません。両端末の保存が失われた場合は復旧できません。
- 再接続では同じ参加権限を利用し、WebRTCの再交渉後に双方の履歴と改訂番号を照合します。不一致時は自動上書きを停止します。
- 通信はCloudflare STUNとWebRTC DataChannelのみで行います。TURN利用・対局データのサーバー中継は行いません。Workerに到達した不正な要求はWorkers Free枠を消費するため、分散DoS攻撃への完全な耐性はありません。

Cloudflare側の設定は冒頭の「Cloudflareへのデプロイと運用（ブラウザのみ）」の第6章を参照してください。

## 対局の保存と履歴

確定した着手・パス・終局相談・採点などの変更を、対局IDごとにブラウザの`localStorage`へ保存します。「新規対戦」→「対戦履歴を見る」で対局の一覧と最終盤面を閲覧でき、進行中の1台／AI対局は「続きを打つ」で再開できます。新しい対局では旧棋譜を残したまま別の対局IDを作ります。友人対局は両端末がそれぞれ局面を保存し、履歴では**閲覧専用**です。

保存容量が足りないときは、お気に入り（☆）と進行中の対局を除いて古い棋譜から自動で削除し、件数を表示します。形勢の推定は、対局中の棋譜では全手、ほかの棋譜では最終局面だけを保存し、再生時は表示中の手に近い局面から裏で推定し直します。

## SGFと棋譜の再生

履歴からSGFファイル（最大512KB）を取り込み、一覧に保存できます。取り込んだ棋譜は閲覧専用です。SGFの書き出しは共有シートの「SGFを保存」です。

SGF入力は**9路・13路・19路盤（`SZ`必須）・SGF FF[4]・交互着手（パスは`[]`または`[tt]`）**を対象とします。`GM[1]`の囲碁（`RU`がJapanese／Koreanなら日本式、それ以外は中国式）と`GM[4]`の五目並べ（`RU[Renju]`なら禁じ手あり）を読み込みます。分岐は最初の変化だけを読み込みます。MieGOと同じ星への置き石（ルート節点の`AB`、`HA`と一致）は読み込め、着手のない初期配置（`AB`／`AW`）は「自由」の盤として開きます。それ以外の置き石配置・途中の盤面編集・複数対局を含むファイル・それ以外の盤サイズは未対応としてエラー表示します。コメントやその他のSGF付帯情報は保持しません。

棋譜の再生中は、盤下の操作列が◁▷と形勢グラフ（手数のスライダーを兼ねる）に切り替わり、「対局に戻る」で現在の対局へ復帰します。友人とのP2P対局やAI戦は、棋譜再生中も内部で進行し、表示している局面を勝手に動かしません。過去局面の地合いもKataGoで推定します（使えない場合だけ簡易影響モデル）。「ここから打つ」を押すと新規対戦のシートが開き、表示中の局面から対COM・観戦・1台で続けられます（元の棋譜は変わりません）。

### 試し打ち

棋譜を再生中でも、**表示している碁盤を直接タップして次の手を仮置き**でき、「試しに打つ」で確定するとその局面から別の手順（試し打ち）が始まります。同じ元棋譜の次の手を打った場合は、新しい試し打ちを作らず元の手順を進めます。試し打ちでも石取り・コウ・自殺手の検証とパスが動作します。

- 元の棋譜、棋譜URL、進行中のAI/友人対局には**一切書き込まない**。P2P送信、AI思考の状態管理、ゲームの自動保存を試し打ちの着手で呼び出さない。
- 「元の棋譜に戻る」で元の手順へ、「試し打ちを見る」で同じ試し打ちへ戻れます。
- 必要な場合だけ「試し打ちを保存」で履歴に独立保存します。閲覧だけでは保存記録を増やしません。

## SGF棋譜URLと自分のAIでの相談

ヘッダーの共有アイコンで共有シートを開くと、画像（静止画・棋譜アニメGIF）の保存とSNS共有、「この局面のURLをコピー」「AI向けにコピー」「SGFを保存」が使えます。

**「この局面のURLをコピー」**で棋譜全体（SGF）と選択した手数（`move`）を含むリンクを作成します。`/?sgf=<URLエンコードしたSGF>&move=42`を開くと、42手目直後の局面で再生モードが開きます。`move`省略で最終局面、`move=0`で初期局面です。

**「AI向けにコピー」**では、そのURLとURLの読み方・生成方法を簡潔に説明する文章、選択手数の●○・による座標ラベルなし文字図（盤の大きさと同じ行数・列数）、公開仕様書`/ai.md`へのリンクをコピーします。SGF本文の別貼り付けは不要です。ユーザーが自分の好きな生成AIに貼り付け、自由に質問し、別タブのMieGOでAIの説明に沿って局面を行き来できます。AIも同形式のURLを生成できます。サイトに`/llms.txt`と`/skills/miego/SKILL.md`も公開します。

見出しの「?」から開くヘルプシートの「初心者の方へ」では、**ルールの質問**と**今の局面の質問**（進行中の対局の棋譜URL・手番・同じ文字図）をコピーできます。AIには場所を「上から○行目・左から○列目」で答えるよう頼みます。禁止手の質問・AI向けコピーと同じく、棋譜URLの検査（`sgf-link.mjs`の`shareableReviewUrl`）、文字図の並び（`board-text.mjs`の`formatBoardSection`）、クリップボードと手動コピーの処理（`clipboard.mjs`の`copyWithFallback`）を共有します。

共有URLは約8KBを上限とします。個人情報を含む棋譜を公開しないでください。SGFクエリ文字列はHTTPリクエストにも含まれます。MieGOから外部AIへの通信や生成AIの組み込みは行いません。友人招待`?room=`と併記された場合は招待を優先します。

## 開発者向け

Node.js 20以降が必要です。以下はCloudflare内で自動実行され、ユーザーがブラウザ以外の操作を行う必要はありません。

```bash
npm ci
npm test
npm run dev
```

依存関係は`package-lock.json`で固定しています。CIは`npm ci`で、ロックファイルどおりの版だけを導入します。依存を追加・更新するときは`npm install <パッケージ>`を実行し、更新された`package-lock.json`も一緒にコミットしてください。

並行して作業するときの決まりは`CLAUDE.md`、モジュールごとの担当と境界は[`docs/MODULE_BOUNDARIES.md`](docs/MODULE_BOUNDARIES.md)、画面と文言の仕様（何がどこにあるか）は[`docs/UX_SPEC.md`](docs/UX_SPEC.md)、その原則（なぜそうするか）は[`docs/UX_PRINCIPLES.md`](docs/UX_PRINCIPLES.md)にあります。

### 文言の管理

画面の文言・状態表示・エラー・ヘルプ・AIへの質問文は、すべて **`public/texts.mjs`** にまとめています。文言を変えるときはこのファイルだけを編集します。

- JavaScriptの各モジュールは `TEXT.*` を参照します。
- `public/index.html` は `src/index.template.html` と `texts.mjs` から `scripts/build-html.mjs` が生成します（`npm test`・`npm run dev`・`npm run deploy` の前に自動生成）。`public/index.html` はGitで管理しません（`.gitignore` 対象）。マークアップは `src/index.template.html` を編集してください。GitHubのWeb画面で `texts.mjs` を編集した場合も、Cloudflareのビルドで再生成されます。
- テスト `tests/texts.test.mjs` が、モジュールへの日本語リテラルの再混入と、生成した `index.html` がテンプレートと一致することを確かめます。

### Content-Security-Policy

`public/_headers` でフレーム内表示を禁止し、Content-Security-Policyを設定しています。外部から読み込むのはTurnstile（`challenges.cloudflare.com`）とGoogle Fontsだけです。外部のスクリプト・接続先を増やすときは、このファイルも更新してください。

### CloudflareのPR Preview

PRのPreviewは `wrangler.preview.jsonc` から作ります。Cloudflare Workers Buildsの設定は、Build commandを `npm test`、**Preview deploy commandを `npx wrangler preview -c wrangler.preview.jsonc`** にしてください。Productionへのデプロイは今までどおり `npx wrangler deploy`（`wrangler.jsonc`）です。

`wrangler.preview.jsonc` は `wrangler.jsonc` から対局ルーム（Durable Objectの`GameRoom`と移行設定）だけを除いた写しです（`tests/deployment.test.mjs` がずれを検出します）。CloudflareはDurable Objectを持つPreviewごとに専用の名前空間を作り、無料プランでは1アカウント100個までなので、ブランチごとにPreviewを作るとすぐ上限に達してビルドが失敗します。そのためPreviewでは対友人の対局は作れず、画面に「miego.fun でお試しください」と表示します。対友人の確認は本番で行います。

この設定にする前に作られたPreviewの名前空間は、そのPreviewを削除すると一緒に消えます。無料プランのPreviewは1 Workerあたり100個までで、超えると最後のデプロイが最も古いものから自動で削除されるため、放っておいても順に減ります。すぐ空けたいときは `npx wrangler preview delete --name <Preview名>`（またはダッシュボードのPreview画面）で古いPreviewを削除してください。本番（Production）のWorkerやその名前空間は削除しないでください。

Cloudflare公式仕様: https://developers.cloudflare.com/workers/previews/resources/#durable-objects 、 https://developers.cloudflare.com/durable-objects/platform/limits/

## 制限と注意

- KataGoの小型モデルは強さや予測精度を保証しません。起動失敗時には画面に簡易影響モデルへの切り替えを明示します。
- 全ルール例外の互換と死活の精度は保証しません。
- 両端末の保存データが失われると友人対局は復元できません。

## ライセンス

MieGO は [MIT ライセンス](LICENSE) です。サイトが配信している第三者のコードとAIのネットワーク（KataGo のネットワーク、Web KaTrain、KaTrain から移植した式、TensorFlow.js、pako など）の著作権表示とライセンス文は [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) にあります。`scripts/build-html.mjs` が `LICENSE` とこのファイルをつないだ `public/licenses.txt` を生成し、サイトでは `/licenses.txt`（ヘルプの「このアプリについて」からリンク）で読めます。依存を足したり「最強」のネットワークを替えたりしたときは、`THIRD_PARTY_NOTICES.md` にも足してください（`tests/licenses.test.mjs` が確かめます）。
