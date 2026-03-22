# 要件ドキュメント

## はじめに

本ドキュメントは、ゲームキャラクター設定サポートツール「character-generator」の要件を定義する。
ユーザーはプロジェクトを作成し、プロジェクト内で指定人数のゲームキャラクターをランダム生成できる。
各キャラクターにはAmazon Bedrockを用いて日本語のバックグラウンドストーリーが自動生成される。
フロントエンドはAWS Amplify（React + TypeScript）、バックエンドはAPI Gateway + Lambda (Node.js 24) + DynamoDB + Bedrockで構成される。DynamoDBテーブルはCDKで直接定義し、PK/SK複合キー設計を採用する。

## 用語集

- **System**: character-generatorシステム全体
- **Auth_Service**: Amazon Cognitoによる認証・認可サービス
- **API**: Amazon API Gatewayで公開されるREST API
- **Project_Lambda**: プロジェクトCRUDを処理するLambda関数
- **Character_Lambda**: キャラクター生成・管理を処理するLambda関数
- **Relationship_Lambda**: 関係性管理を処理するLambda関数
- **Generate_Lambda**: キャラクターのランダム属性生成とBedrock呼び出しを担当するLambda関数
- **Bedrock_Client**: Amazon Bedrockへのリクエストを行うクライアントモジュール
- **DynamoDB**: データストアとして使用するAmazon DynamoDB
- **Projects_Table**: プロジェクト情報を格納するDynamoDBテーブル
- **Characters_Table**: キャラクター情報を格納するDynamoDBテーブル
- **Relationships_Table**: キャラクター間の関係性を格納するDynamoDBテーブル
- **Frontend**: AWS Amplify上で動作するReact + TypeScriptのWebアプリケーション
- **Authenticator**: Amplify UIのAuthenticatorコンポーネント
- **Dashboard**: プロジェクト一覧を表示するフロントエンド画面
- **Project_Detail_Page**: プロジェクト詳細を表示するフロントエンド画面
- **Character_Detail_Page**: キャラクター詳細を表示・編集するフロントエンド画面
- **Relationship_Map_Page**: キャラクター間の関係性をネットワークグラフで可視化するフロントエンド画面
- **Combobox**: デフォルト選択肢からの選択と自由入力の両方に対応するUIコンポーネント
- **ULID**: Universally Unique Lexicographically Sortable Identifierの略。プロジェクトIDおよびキャラクターIDに使用する
- **generationStatus**: キャラクターのバックグラウンド生成状態（pending / generating / completed / failed）
- **worldSetting**: プロジェクトに設定する世界観の説明テキスト

---

## 要件

### 要件1: ユーザー認証

**ユーザーストーリー:** 開発者として、Googleアカウントでシステムにログインしたい。そうすることで、パスワード管理不要で安全にアクセスできる。

#### 受け入れ基準

1. THE **Authenticator** SHALL Amplify UIのAuthenticatorコンポーネントを使用してGoogleログインボタンを提供する
2. WHEN 未認証ユーザーがAPIエンドポイントにアクセスしたとき、THE **API** SHALL HTTPステータス401を返す
3. WHEN 認証済みユーザーがCognitoトークンをAuthorizationヘッダーに付与してAPIにアクセスしたとき、THE **API** SHALL リクエストを処理する
4. THE **Auth_Service** SHALL CognitoユーザープールとGoogleのOAuthフェデレーションを使用してユーザーの認証情報を管理する
5. THE **System** SHALL `amplify/auth/resource.ts` でCognito認証設定（Googleソーシャルプロバイダー）を定義する
6. THE **System** SHALL GoogleのOAuthクライアントID・シークレットを環境変数（GOOGLE_CLIENT_ID、GOOGLE_CLIENT_SECRET）で管理する
7. THE **System** SHALL コールバックURLとログアウトURLをローカル開発環境（localhost:5173）と本番環境の両方に対応させる

---

### 要件2: プロジェクト管理

**ユーザーストーリー:** ゲームデザイナーとして、プロジェクトを作成・管理したい。そうすることで、複数のゲーム世界観ごとにキャラクターを整理できる。

#### 受け入れ基準

1. WHEN 認証済みユーザーが `POST /projects` にprojectNameとworldSettingを送信したとき、THE **Project_Lambda** SHALL ULIDをprojectIdとして生成し、Projects_Tableに新規プロジェクトを保存する
2. WHEN 認証済みユーザーが `GET /projects` にアクセスしたとき、THE **Project_Lambda** SHALL そのユーザーのプロジェクト一覧をcreatedAtの降順で返す
3. WHEN 認証済みユーザーが `GET /projects/{projectId}` にアクセスしたとき、THE **Project_Lambda** SHALL 指定プロジェクトの詳細情報を返す
4. WHEN 認証済みユーザーが他のユーザーのプロジェクトIDで `GET /projects/{projectId}` にアクセスしたとき、THE **Project_Lambda** SHALL HTTPステータス403を返す
5. WHEN 認証済みユーザーが `PUT /projects/{projectId}` にworldSettingを送信したとき、THE **Project_Lambda** SHALL 指定プロジェクトのworldSettingを更新し、更新後のプロジェクト情報を返す
6. WHEN 認証済みユーザーが `DELETE /projects/{projectId}` にアクセスしたとき、THE **Project_Lambda** SHALL 指定プロジェクトをProjects_Tableから削除する
7. THE **Projects_Table** SHALL `PK: userId, SK: project#{projectId}` のキー構造でデータを格納する
8. THE **Projects_Table** SHALL projectId、projectName、worldSetting、maxCharacters、createdAt（ISO8601）、updatedAt（ISO8601）の属性を保持する

---

### 要件3: キャラクターランダム生成

**ユーザーストーリー:** ゲームデザイナーとして、指定した人数のキャラクターをランダムに生成したい。そうすることで、多様なキャラクター候補を素早く得られる。

#### 受け入れ基準

1. WHEN 認証済みユーザーが `POST /projects/{projectId}/characters/generate` に `{"count": N}` を送信したとき、THE **Generate_Lambda** SHALL N体分のキャラクター基本属性をランダムに決定しCharacters_Tableに保存する（generationStatus: pending）
2. WHEN Generate_Lambdaがキャラクター基本属性を保存したとき、THE **Generate_Lambda** SHALL 生成されたcharacterIdのリストを即座にレスポンスとして返す
3. THE **Generate_Lambda** SHALL gender、personality、age、species、occupation、hairColor、skinColorの各属性を以下の選択肢からランダムに選択する:
   - gender: ["男性", "女性", "その他"]
   - personality: ["冷静沈着", "熱血漢", "臆病", "好奇心旺盛", "慎重", "楽天的", "皮肉屋", "優しい", "厳格", "自由奔放"]
   - age: ["10代", "20代", "30代", "40代", "50代", "60代", "70代", "80代"]
   - species: ["人間", "エルフ", "ドワーフ", "獣人", "竜人", "半霊", "機械人形"]
   - occupation: ["剣士", "魔法使い", "弓使い", "盗賊", "僧侶", "商人", "鍛冶師", "学者", "吟遊詩人", "農民", "貴族", "傭兵"]
   - hairColor: ["黒", "白", "金", "銀", "赤", "青", "緑", "茶", "紫"]
   - skinColor: ["色白", "小麦色", "褐色", "灰色", "青白い", "緑がかった"]
4. WHEN プロジェクト内のキャラクター数がmaxCharactersに達しているとき、THE **Generate_Lambda** SHALL HTTPステータス400とエラーメッセージを返す
5. WHEN 1ユーザーの当日の生成回数が100回に達しているとき、THE **Generate_Lambda** SHALL HTTPステータス429とエラーメッセージを返す
6. THE **Generate_Lambda** SHALL ランダム生成時にspecialNotesを空文字列で初期化する
7. THE **Characters_Table** SHALL `PK: project#{projectId}, SK: character#{characterId}` のキー構造でデータを格納する
8. WHEN バックグラウンドストーリー生成完了後、プロジェクト内に2体以上のキャラクターが存在するとき、THE **Generate_Lambda** SHALL 新規キャラクターと既存の各キャラクターの間の関係性をBedrockで自動生成し、Relationships_Tableに保存する
9. WHEN Bedrockが関係性を生成するとき、THE **Generate_Lambda** SHALL 2体のキャラクター属性と世界観を渡し、relationshipType（仲間 / ライバル / 師弟 / 恋人 / 家族 / 敵対 のいずれか）と日本語のdescription（50文字程度）をJSON形式で返させる
10. IF 関係性の自動生成に失敗したとき、THEN THE **Generate_Lambda** SHALL エラーをログに記録するが、キャラクター生成全体はエラーにしない（関係性生成はベストエフォート）

---

### 要件4: Bedrockによるバックグラウンドストーリー生成

**ユーザーストーリー:** ゲームデザイナーとして、各キャラクターに日本語のバックグラウンドストーリーを自動生成したい。そうすることで、キャラクターに深みを持たせる設定を効率的に作成できる。

#### 受け入れ基準

1. WHEN Generate_LambdaがキャラクターをCharacters_Tableに保存した後、THE **Bedrock_Client** SHALL `amazon.nova-lite-v1:0`（ap-northeast-1リージョン）を使用してバックグラウンドストーリーを生成する
2. WHEN Bedrock_Clientがリクエストを送信するとき、THE **Bedrock_Client** SHALL Bedrock Converse APIを使用してリクエストを送信する
2. WHEN Bedrock_Clientがリクエストを送信するとき、THE **Bedrock_Client** SHALL 以下のシステムプロンプトを使用する: 「あなたはゲームキャラクターのバックグラウンドストーリーを作成する専門家です。以下の世界観に基づいてキャラクターのバックグラウンドを作成してください。世界観: {worldSetting} 制約: 日本語で300文字程度。キャラクターの過去・動機・目標を含めること。」
3. WHEN Bedrock_Clientがリクエストを送信するとき、THE **Bedrock_Client** SHALL max_tokensを500に設定する
4. WHEN 同一プロジェクト内で複数のキャラクターを生成するとき、THE **Bedrock_Client** SHALL Prompt Cachingを活用してシステムプロンプト（worldSettingを含む）をキャッシュする
5. WHEN Bedrock_Clientがバックグラウンドストーリーの生成を開始するとき、THE **Generate_Lambda** SHALL 対象キャラクターのgenerationStatusをgeneratingに更新する
6. WHEN Bedrock_Clientがバックグラウンドストーリーの生成に成功したとき、THE **Generate_Lambda** SHALL backgroundフィールドを生成されたテキストで更新し、generationStatusをcompletedに更新する
7. IF Bedrock_Clientがバックグラウンドストーリーの生成に失敗したとき、THEN THE **Generate_Lambda** SHALL 対象キャラクターのgenerationStatusをfailedに更新する
8. THE **Generate_Lambda** SHALL IAMロールのBedrockInvokeModel権限を使用してBedrockに認証する（AWS Secrets Managerは使用しない）
9. THE **Generate_Lambda** SHALL Bedrock呼び出しを同期的に `await` して完了を待つため、Lambda タイムアウトを300秒に設定する

---

### 要件5: バックグラウンドストーリーの再生成

**ユーザーストーリー:** ゲームデザイナーとして、気に入らないバックグラウンドストーリーを再生成したい。そうすることで、より適切な設定を得られるまで試行できる。

#### 受け入れ基準

1. WHEN 認証済みユーザーが `POST /projects/{projectId}/characters/{characterId}/regenerate` にアクセスしたとき、THE **Character_Lambda** SHALL 対象キャラクターのgenerationStatusをpendingにリセットし、Bedrock_Clientを呼び出してバックグラウンドストーリーを再生成する
2. WHEN 再生成が完了したとき、THE **Character_Lambda** SHALL backgroundフィールドを新しいテキストで更新し、generationStatusをcompletedに更新する
3. IF 再生成中にエラーが発生したとき、THEN THE **Character_Lambda** SHALL generationStatusをfailedに更新する
4. THE **Character_Lambda** SHALL Bedrock呼び出しを同期的に `await` して完了を待つため、Lambda タイムアウトを120秒に設定する

---

### 要件6: キャラクター管理

**ユーザーストーリー:** ゲームデザイナーとして、生成されたキャラクターを閲覧・編集・削除したい。そうすることで、キャラクター設定を自分の意図に合わせて調整できる。

#### 受け入れ基準

1. WHEN 認証済みユーザーが `GET /projects/{projectId}/characters` にアクセスしたとき、THE **Character_Lambda** SHALL プロジェクト内の全キャラクターをcreatedAtの昇順で返す
2. WHEN 認証済みユーザーが `GET /projects/{projectId}/characters/{characterId}` にアクセスしたとき、THE **Character_Lambda** SHALL 指定キャラクターの全属性を返す
3. WHEN 認証済みユーザーが `PUT /projects/{projectId}/characters/{characterId}` に更新データを送信したとき、THE **Character_Lambda** SHALL 指定キャラクターの属性を更新する
4. WHEN 認証済みユーザーが `DELETE /projects/{projectId}/characters/{characterId}` にアクセスしたとき、THE **Character_Lambda** SHALL 指定キャラクターをCharacters_Tableから削除する
5. THE **Characters_Table** SHALL GSI1として `PK: project#{projectId}, SK: createdAt` のインデックスを持ち、キャラクター一覧取得に使用する

---

### 要件7: 関係性管理

**ユーザーストーリー:** ゲームデザイナーとして、キャラクター間の関係性を登録・管理したい。そうすることで、キャラクター同士のつながりを整理できる。

#### 受け入れ基準

1. WHEN 認証済みユーザーが `POST /projects/{projectId}/relationships` にcharacterIdA、characterIdB、relationshipType、descriptionを送信したとき、THE **Relationship_Lambda** SHALL AからBへの関係性レコードとBからAへの関係性レコードの両方をRelationships_Tableに保存する
2. WHEN 認証済みユーザーが `GET /projects/{projectId}/relationships` にアクセスしたとき、THE **Relationship_Lambda** SHALL プロジェクト内の全関係性を返す
3. WHEN 認証済みユーザーが `DELETE /projects/{projectId}/relationships/{relationshipId}` にアクセスしたとき、THE **Relationship_Lambda** SHALL 対応するAからBおよびBからAの両方の関係性レコードをRelationships_Tableから削除する
4. WHEN 認証済みユーザーが `POST /projects/{projectId}/relationships/{relationshipId}/regenerate` にアクセスしたとき、THE **Relationship_Lambda** SHALL 既存の関係性を削除し、Bedrockを使用して同じキャラクターペアの新しい関係性を生成してRelationships_Tableに保存する
5. THE **Relationships_Table** SHALL `PK: project#{projectId}#character#{characterIdA}, SK: relation#{characterIdB}` のキー構造で関係性を格納する
6. THE **Relationships_Table** SHALL relationshipType（仲間 / ライバル / 師弟 / 恋人 / 家族 / 敵対）とdescriptionの属性を保持する

---

### 要件8: フロントエンド画面構成

**ユーザーストーリー:** ゲームデザイナーとして、直感的なWebUIでキャラクターを管理したい。そうすることで、ツールを効率的に活用できる。

#### 受け入れ基準

1. THE **Dashboard** SHALL 認証済みユーザーのプロジェクト一覧をカード形式で表示する
2. THE **Project_Detail_Page** SHALL プロジェクトの世界観（worldSetting）の表示・編集機能とキャラクター一覧を提供する
3. THE **Character_Detail_Page** SHALL キャラクターの全属性表示、バックグラウンドストーリーの表示、および属性の手動編集フォームを提供する
4. THE **Relationship_Map_Page** SHALL プロジェクト内のキャラクター間の関係性をネットワークグラフ形式で可視化する
5. WHEN キャラクターのgenerationStatusがpendingまたはgeneratingのとき、THE **Character_Detail_Page** SHALL 生成中であることを示すローディング表示を行う
6. WHEN キャラクターのgenerationStatusがfailedのとき、THE **Character_Detail_Page** SHALL エラー状態と再生成ボタンを表示する

---

### 要件9: キャラクター属性のコンボボックス入力

**ユーザーストーリー:** ゲームデザイナーとして、キャラクター属性をデフォルト選択肢から選ぶか自由入力できるようにしたい。そうすることで、標準的な設定と独自の設定の両方に対応できる。

#### 受け入れ基準

1. THE **Character_Detail_Page** SHALL gender、personality、age、species、occupation、hairColor、skinColorの各属性フィールドをCombobox形式で実装する
2. THE **Combobox** SHALL ドロップダウンにデフォルト選択肢の一覧を表示する
3. THE **Combobox** SHALL テキストボックスへの直接入力によるカスタム値の設定を許可する
4. WHEN ユーザーがComboboxに文字を入力したとき、THE **Combobox** SHALL 入力文字列に基づいてデフォルト選択肢をインクリメンタルサーチでフィルタリングする
5. THE **Character_Detail_Page** SHALL specialNotesフィールドをテキストエリア形式（複数行入力可能）で実装し、最大200文字の制限を設ける
6. THE **Character_Detail_Page** SHALL specialNotesフィールドのプレースホルダーとして「例: 左目に傷がある、常に仮面をつけている、王族の血を引く」を表示する

---

### 要件10: ポーリングによる生成状態の同期

**ユーザーストーリー:** ゲームデザイナーとして、バックグラウンドストーリーの生成完了を自動的に画面に反映させたい。そうすることで、手動でページを更新せずに結果を確認できる。

#### 受け入れ基準

1. WHEN キャラクター生成リクエストが送信された後、THE **Frontend** SHALL 5秒間隔で `GET /projects/{projectId}/characters` をポーリングする
2. WHEN プロジェクト内の全キャラクターのgenerationStatusがcompletedまたはfailedになったとき、THE **Frontend** SHALL ポーリングを停止する
3. WHEN ポーリングによって取得したキャラクターデータが更新されたとき、THE **Frontend** SHALL 画面表示を最新の状態に更新する

---

### 要件11: レート制限とスロットリング

**ユーザーストーリー:** システム管理者として、APIの過剰利用を防ぎたい。そうすることで、システムの安定性とコストを管理できる。

#### 受け入れ基準

1. THE **API** SHALL API Gatewayのスロットリング設定として1ユーザーあたり10リクエスト/秒の上限を設ける
2. WHEN 1ユーザーの当日のキャラクター生成回数が100回に達したとき、THE **Generate_Lambda** SHALL HTTPステータス429とエラーメッセージを返す
3. WHEN 1プロジェクト内のキャラクター数がmaxCharactersに達したとき、THE **Generate_Lambda** SHALL HTTPステータス400とエラーメッセージを返す

---

### 要件12: インフラ構成管理

**ユーザーストーリー:** 開発チームとして、Amplify Gen2のCDKベースでインフラを一元管理したい。そうすることで、外部IaCツールなしに環境を再現・管理できる。

#### 受け入れ基準

1. THE **System** SHALL Amplify Gen2のCDKベースのインフラ定義をすべてのAWSリソース管理の基盤として使用する
2. THE **System** SHALL `amplify/auth/resource.ts` でCognito認証設定を定義する
3. THE **System** SHALL `amplify/backend.ts` で `aws-cdk-lib/aws-dynamodb` を使用してDynamoDBテーブル（Projects_Table、Characters_Table、Relationships_Table）をPK/SK複合キー設計で直接定義する（Amplify defineDataは使用しない）
4. THE **System** SHALL `amplify/functions/` 配下にLambda関数ごとのディレクトリを作成する
5. THE **System** SHALL すべてのAWSリソースに以下のタグを付与する: `Project: character-generator`、`ManagedBy: amplify-gen2`、`Owner: team-gamedev`、`CostCenter: gamedev-tools`
6. THE **System** SHALL mainブランチを本番（Production）、developブランチを開発（Development）、feature/*ブランチをサンドボックスとしてデプロイする
