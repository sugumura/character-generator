# 実装計画: character-generator

## 概要

Amplify Gen2をベースに、認証・プロジェクト管理・キャラクター生成・Bedrock連携・関係性管理・フロントエンドUIを段階的に実装する。各ステップは前のステップの成果物を前提とし、最終的にすべてのコンポーネントを統合する。

## タスク

- [x] 1. プロジェクト基盤とインフラ定義
  - Amplify Gen2プロジェクトを初期化し、`amplify/auth/resource.ts` でCognito認証設定を定義する
  - `amplify/data/resource.ts` でDynamoDBテーブル（Projects_Table・Characters_Table・Relationships_Table）のスキーマを定義する（GSI1含む）
  - `amplify/functions/` 配下にProject_Lambda・Character_Lambda・Relationship_Lambda・Generate_Lambdaのディレクトリを作成し、各Lambda関数のエントリポイントを作成する
  - すべてのAWSリソースに必要なタグ（Project・ManagedBy・Owner・CostCenter）を付与する
  - _Requirements: 1.4, 1.5, 2.6, 2.7, 3.7, 7.4, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

- [ ] 2. 共通モジュールとデータモデル定義
  - [x] 2.1 共通型定義・ユーティリティの実装
    - TypeScriptの型定義（Project・Character・Relationship・generationStatus・エラーレスポンス形式）を `src/types/` に作成する
    - ULID生成ユーティリティを実装する
    - `ATTRIBUTE_OPTIONS` 定数（gender・personality・age・species・occupation・hairColor・skinColor）を定義する
    - エラーレスポンス生成ヘルパー関数を実装する
    - _Requirements: 2.7, 3.3, 3.6_

  - [ ]* 2.2 ATTRIBUTE_OPTIONSのプロパティテストを作成する
    - **Property 7: 生成されたキャラクター属性は定義済み選択肢内に収まる**
    - **Validates: Requirements 3.3, 3.6**

- [ ] 3. Project_Lambda実装
  - [x] 3.1 Project_LambdaのCRUD処理を実装する
    - `POST /projects`: ULIDでprojectIdを生成し、Projects_Tableに保存する
    - `GET /projects`: ユーザーのプロジェクト一覧をcreatedAtの降順で返す
    - `GET /projects/{projectId}`: プロジェクト詳細を返す（他ユーザーのリソースは403）
    - `DELETE /projects/{projectId}`: プロジェクトを削除する
    - Cognito JWTからuserIdを取得する認証ミドルウェアを実装する
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 3.2 Project_Lambdaのプロパティテストを作成する（fast-check）
    - **Property 2: プロジェクト作成のラウンドトリップ**
    - **Validates: Requirements 2.1, 2.3, 2.7**

  - [ ]* 3.3 Project_Lambdaのプロパティテストを作成する（fast-check）
    - **Property 3: プロジェクト一覧は降順で返される**
    - **Validates: Requirements 2.2**

  - [ ]* 3.4 Project_Lambdaのプロパティテストを作成する（fast-check）
    - **Property 4: 他ユーザーのプロジェクトへのアクセスは拒否される**
    - **Validates: Requirements 2.4**

  - [ ]* 3.5 Project_Lambdaのプロパティテストを作成する（fast-check）
    - **Property 5: プロジェクト削除のラウンドトリップ**
    - **Validates: Requirements 2.5**

  - [ ]* 3.6 Project_Lambdaのユニットテストを作成する（Jest + ts-jest）
    - DynamoDBをaws-sdk-client-mockでモックし、各エンドポイントの正常系・異常系を検証する
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 4. Bedrock_Clientモジュール実装
  - [x] 4.1 Bedrock_Clientを実装する
    - `anthropic.claude-3-haiku-20240307-v1:0`（ap-northeast-1）を使用するクライアントを実装する
    - システムプロンプト（worldSettingを含む）とmax_tokens=500を設定する
    - Prompt Cachingを活用してシステムプロンプトをキャッシュする実装を追加する
    - IAMロールのBedrockInvokeModel権限を使用する（Secrets Manager不使用）
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.8_

  - [ ]* 4.2 Bedrock_Clientのユニットテストを作成する（Jest + ts-jest、モック使用）
    - システムプロンプトの内容（worldSetting埋め込み）を確認する
    - max_tokens=500が設定されていることを確認する
    - _Requirements: 4.2, 4.3_

- [ ] 5. Generate_Lambda実装
  - [x] 5.1 Generate_Lambdaのランダム属性生成とBedrock連携を実装する
    - `POST /projects/{projectId}/characters/generate` エンドポイントを実装する
    - N体分の属性をATTRIBUTE_OPTIONSからランダムに選択し、specialNotesを空文字列で初期化してCharacters_Tableに保存する（generationStatus: pending）
    - characterIdリストを即座にレスポンスとして返す
    - maxCharacters上限チェック（400）とレート制限チェック（429）を実装する
    - レート制限カウントを `PK: rateLimit#{userId}, SK: date#{YYYY-MM-DD}` 形式でDynamoDBに保存し、TTLを翌日0時に設定する
    - 非同期でBedrock_Clientを呼び出し、generationStatusをgenerating→completed/failedに更新する
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.5, 4.6, 4.7, 11.2, 11.3_

  - [ ]* 5.2 Generate_Lambdaのプロパティテストを作成する（fast-check）
    - **Property 6: キャラクター生成数の一致**
    - **Validates: Requirements 3.1, 3.2**

  - [ ]* 5.3 Generate_Lambdaのプロパティテストを作成する（fast-check）
    - **Property 7: 生成されたキャラクター属性は定義済み選択肢内に収まる**
    - **Validates: Requirements 3.3, 3.6**

  - [ ]* 5.4 Generate_Lambdaのプロパティテストを作成する（fast-check）
    - **Property 8: maxCharacters超過時は400を返す**
    - **Validates: Requirements 3.4, 11.3**

  - [ ]* 5.5 Generate_Lambdaのプロパティテストを作成する（fast-check）
    - **Property 9: バックグラウンドストーリー生成完了後の状態**
    - **Validates: Requirements 4.1, 4.5, 4.6**

  - [ ]* 5.6 Generate_Lambdaのユニットテストを作成する（Jest + ts-jest）
    - DynamoDBとBedrockをモックし、正常系・異常系（Bedrock失敗時のfailed更新）を検証する
    - _Requirements: 3.1, 3.4, 3.5, 4.7_

- [x] 6. チェックポイント - バックエンドコアのテストを確認する
  - すべてのテストが通ることを確認する。問題があればユーザーに確認する。

- [ ] 7. Character_Lambda実装
  - [x] 7.1 Character_LambdaのCRUD処理と再生成を実装する
    - `GET /projects/{projectId}/characters`: GSI1を使用してcreatedAtの昇順で返す
    - `GET /projects/{projectId}/characters/{characterId}`: キャラクター詳細を返す
    - `PUT /projects/{projectId}/characters/{characterId}`: キャラクター属性を更新する
    - `DELETE /projects/{projectId}/characters/{characterId}`: キャラクターを削除する
    - `POST /projects/{projectId}/characters/{characterId}/regenerate`: generationStatusをpendingにリセットし、Bedrock_Clientを呼び出して再生成する
    - _Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 7.2 Character_Lambdaのプロパティテストを作成する（fast-check）
    - **Property 10: バックグラウンドストーリー再生成のラウンドトリップ**
    - **Validates: Requirements 5.1, 5.2**

  - [ ]* 7.3 Character_Lambdaのプロパティテストを作成する（fast-check）
    - **Property 11: キャラクター一覧は昇順で返される**
    - **Validates: Requirements 6.1**

  - [ ]* 7.4 Character_Lambdaのプロパティテストを作成する（fast-check）
    - **Property 12: キャラクター更新のラウンドトリップ**
    - **Validates: Requirements 6.2, 6.3**

  - [ ]* 7.5 Character_Lambdaのプロパティテストを作成する（fast-check）
    - **Property 13: キャラクター削除のラウンドトリップ**
    - **Validates: Requirements 6.4**

  - [ ]* 7.6 Character_Lambdaのユニットテストを作成する（Jest + ts-jest）
    - DynamoDBとBedrockをモックし、各エンドポイントの正常系・異常系を検証する
    - _Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4_

- [ ] 8. Relationship_Lambda実装
  - [x] 8.1 Relationship_LambdaのCRUD処理を実装する
    - `POST /projects/{projectId}/relationships`: A→BとB→Aの2レコードを対称的に保存する
    - `GET /projects/{projectId}/relationships`: プロジェクト内の全関係性を返す
    - `DELETE /projects/{projectId}/relationships/{relationshipId}`: A→BとB→Aの両方を削除する
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 8.2 Relationship_Lambdaのプロパティテストを作成する（fast-check）
    - **Property 14: 関係性は双方向に保存される**
    - **Validates: Requirements 7.1, 7.2**

  - [ ]* 8.3 Relationship_Lambdaのプロパティテストを作成する（fast-check）
    - **Property 15: 関係性削除は双方向に削除される**
    - **Validates: Requirements 7.3**

  - [ ]* 8.4 Relationship_Lambdaのユニットテストを作成する（Jest + ts-jest）
    - DynamoDBをモックし、双方向保存・削除の正常系・異常系を検証する
    - _Requirements: 7.1, 7.2, 7.3_

- [ ] 9. API Gateway認証設定
  - [x] 9.1 API GatewayにCognito Authorizerを設定する
    - すべてのエンドポイントにCognito Authorizerを適用し、未認証リクエストに401を返す設定を実装する
    - API Gatewayのスロットリング設定（10リクエスト/秒/ユーザー）を実装する
    - _Requirements: 1.2, 1.3, 11.1_

  - [ ]* 9.2 認証のプロパティテストを作成する（fast-check）
    - **Property 1: 未認証リクエストは拒否される**
    - **Validates: Requirements 1.2**

- [x] 10. チェックポイント - バックエンド全体のテストを確認する
  - すべてのテストが通ることを確認する。問題があればユーザーに確認する。

- [ ] 11. フロントエンド基盤とComboboxコンポーネント実装
  - [x] 11.1 フロントエンドのディレクトリ構造とAmplify認証を設定する
    - `src/pages/` と `src/components/` と `src/hooks/` のディレクトリ構造を作成する
    - Amplify UIのAuthenticatorコンポーネントをアプリのルートに組み込む
    - _Requirements: 1.1, 8.1_

  - [x] 11.2 Comboboxコンポーネントを実装する
    - `ComboboxProps`（options・value・onChange・placeholder）インターフェースに従ってComboboxコンポーネントを実装する
    - ドロップダウンにデフォルト選択肢を表示し、テキスト入力によるカスタム値設定を許可する
    - 入力文字列によるインクリメンタルサーチフィルタリングを実装する
    - _Requirements: 9.2, 9.3, 9.4_

  - [ ]* 11.3 Comboboxのプロパティテストを作成する（fast-check + Vitest）
    - **Property 17: Comboboxのフィルタリング**
    - **Validates: Requirements 9.2, 9.4**

  - [ ]* 11.4 Comboboxのプロパティテストを作成する（fast-check + Vitest）
    - **Property 18: Comboboxはカスタム値を受け入れる**
    - **Validates: Requirements 9.3**

  - [ ]* 11.5 Comboboxのユニットテストを作成する（Vitest + React Testing Library）
    - フィルタリング動作とカスタム値入力の正常系・異常系を検証する
    - _Requirements: 9.2, 9.3, 9.4_

- [ ] 12. usePollingフック実装
  - [x] 12.1 usePollingカスタムフックを実装する
    - 5秒間隔で `GET /projects/{projectId}/characters` をポーリングする
    - 全キャラクターのgenerationStatusがcompletedまたはfailedになったときにポーリングを停止する
    - ポーリングで取得したデータで画面表示を更新する
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ]* 12.2 usePollingのプロパティテストを作成する（fast-check + Vitest）
    - **Property 19: ポーリングは完了時に停止する**
    - **Validates: Requirements 10.1, 10.2**

  - [ ]* 12.3 usePollingのユニットテストを作成する（Vitest + React Testing Library）
    - APIをMSWでモックし、ポーリング開始・停止の動作を検証する
    - _Requirements: 10.1, 10.2, 10.3_

- [ ] 13. フロントエンドページ実装
  - [x] 13.1 Dashboardページを実装する
    - プロジェクト一覧をカード形式で表示する
    - プロジェクト作成フォームを実装する
    - _Requirements: 8.1_

  - [x] 13.2 ProjectDetailページを実装する
    - worldSettingの表示・編集機能を実装する
    - キャラクター一覧（CharacterCard）を表示し、キャラクター生成フォーム（count入力）を実装する
    - usePollingフックを組み込んで生成状態をリアルタイムに反映する
    - _Requirements: 8.2, 10.1, 10.2, 10.3_

  - [ ] 13.3 CharacterDetailページを実装する
    - キャラクターの全属性をComboboxフォームで表示・編集できるようにする
    - specialNotesをテキストエリア（最大200文字、プレースホルダーあり）で実装する
    - generationStatusに応じたローディング表示・エラー表示・再生成ボタンを実装する
    - _Requirements: 8.3, 8.5, 8.6, 9.1, 9.5, 9.6_

  - [ ] 13.4 RelationshipMapページを実装する
    - キャラクター間の関係性をネットワークグラフ形式で可視化する
    - 関係性の作成・削除UIを実装する
    - _Requirements: 8.4, 7.1, 7.2, 7.3_

  - [ ]* 13.5 CharacterDetailのUI状態プロパティテストを作成する（fast-check + Vitest）
    - **Property 16: generationStatusに応じたUI表示**
    - **Validates: Requirements 8.5, 8.6**

  - [ ]* 13.6 フロントエンドページのユニットテストを作成する（Vitest + React Testing Library）
    - APIをMSWでモックし、各ページのコンポーネント存在確認・インタラクションを検証する
    - specialNotesの200文字制限バリデーションを確認する
    - プレースホルダーテキストの表示を確認する
    - _Requirements: 8.2, 8.3, 9.5, 9.6_

- [ ] 14. 最終チェックポイント - 全テストを確認する
  - すべてのテストが通ることを確認する。問題があればユーザーに確認する。

## 注意事項

- `*` が付いたタスクはオプションであり、MVPを優先する場合はスキップ可能
- 各タスクは対応する要件番号を参照しており、トレーサビリティを確保している
- プロパティテストはfast-checkを使用し、各テストに `Feature: character-generator, Property N` のタグを付与する
- Lambda関数のテストはJest + ts-jest + aws-sdk-client-mock、フロントエンドのテストはVitest + React Testing Library + MSWを使用する
