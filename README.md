# character-generator

ゲームキャラクター設定サポートツール。プロジェクト単位で世界観を定義し、Amazon Bedrock (Claude 3 Haiku) を使って日本語のバックグラウンドストーリーを自動生成します。

## 機能

- **認証** — Google アカウントによるソーシャルログイン（パスワード不要）
- **プロジェクト管理** — 世界観（worldSetting）ごとにキャラクターを整理
- **キャラクター生成** — 属性（性別・性格・種族・職業など）をランダム生成し、Bedrock でバックグラウンドストーリーを自動生成
- **キャラクター編集** — Combobox で属性を選択 or 自由入力、specialNotes を手動記入
- **関係性マップ** — キャラクター間の関係性を SVG ネットワークグラフで可視化

## 技術スタック

| レイヤー | 技術 |
|---|---|
| フロントエンド | React 18 + TypeScript, Vite, AWS Amplify UI |
| バックエンド | AWS Lambda (Node.js 24), API Gateway REST API |
| データストア | Amazon DynamoDB (CDK 直接定義、PK/SK 複合キー設計) |
| AI 生成 | Amazon Bedrock — `anthropic.claude-3-haiku-20240307-v1:0` (ap-northeast-1) |
| 認証 | Amazon Cognito User Pool + Google OAuth 2.0 |
| インフラ | AWS Amplify Gen2 (CDK ベース) |

## ディレクトリ構成

```
.
├── amplify/
│   ├── auth/resource.ts          # Cognito 認証設定
│   ├── api/resource.ts           # API Gateway + Cognito Authorizer
│   ├── backend.ts                # Amplify Gen2 バックエンド定義 + DynamoDB テーブル定義
│   └── functions/
│       ├── project-lambda/       # プロジェクト CRUD
│       ├── character-lambda/     # キャラクター CRUD + 再生成
│       ├── generate-lambda/      # ランダム生成 + Bedrock 連携
│       └── relationship-lambda/  # 関係性 CRUD
└── src/
    ├── pages/
    │   ├── Dashboard.tsx         # プロジェクト一覧・作成
    │   ├── ProjectDetail.tsx     # キャラクター一覧・生成
    │   ├── CharacterDetail.tsx   # キャラクター詳細・編集
    │   └── RelationshipMap.tsx   # 関係性ネットワークグラフ
    ├── components/
    │   ├── Combobox.tsx          # 選択肢 + 自由入力コンポーネント
    │   └── CharacterCard.tsx     # キャラクターカード
    ├── hooks/
    │   └── usePolling.ts         # 生成状態ポーリングフック
    ├── types/index.ts            # 共通型定義
    ├── constants/attributeOptions.ts  # キャラクター属性の選択肢
    └── utils/
        ├── ulid.ts               # ULID 生成ユーティリティ
        └── errorResponse.ts      # エラーレスポンスヘルパー
```

## セットアップ

### 前提条件

- Node.js 24+
- AWS CLI（認証設定済み）
- `@aws-amplify/backend-cli` (`ampx`)

### Google OAuth の設定

認証に Google ログインを使用します。初回セットアップ時に以下の手順が必要です。

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを開く（または新規作成）
2. 「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuth 2.0 クライアント ID」を選択
3. アプリケーションの種類: **ウェブアプリケーション**
4. 承認済みリダイレクト URI に以下を追加:
   - `http://localhost:5173`（ローカル開発用）
   - Amplify sandbox デプロイ後に生成される Cognito Hosted UI の URL（後から追加可）
   - 本番・開発環境の Amplify URL（デプロイ後に追加）
5. 作成後に表示される **クライアント ID** と **クライアントシークレット** を控える

### インストール

```bash
npm install
```

### ローカル開発（Amplify Sandbox）

```bash
# バックエンドをサンドボックス環境にデプロイ
npm run amplify:sandbox

# AWS プロファイルを指定する場合
npm run amplify:sandbox -- --profile your-profile-name

# フロントエンド開発サーバーを起動（別ターミナル）
npm run dev
```

`amplify_outputs.json` が生成されたら、`src/amplifyconfiguration.json` に内容をコピーするか、Amplify の自動設定を利用してください。

### 環境変数

`.env.local` を作成し、以下を設定します（`.gitignore` に含まれているためコミットされません）。

```
VITE_API_BASE_URL=https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod
```

### Google OAuth シークレットの登録

`GOOGLE_CLIENT_ID` と `GOOGLE_CLIENT_SECRET` は Amplify の Secret Store で管理します。`.env.local` には書かないでください。

**ローカル（sandbox）:**

```bash
npx ampx sandbox secret set GOOGLE_CLIENT_ID
npx ampx sandbox secret set GOOGLE_CLIENT_SECRET
```

実行するとプロンプトが表示されるので値を入力してください。

**本番・開発環境:**

Amplify Console →「シークレット」セクションで同じキーを登録してください。

### ビルド

```bash
npm run build
```

## デプロイ戦略

| ブランチ | 環境 |
|---|---|
| `main` | Production |
| `develop` | Development |
| `feature/*` | Sandbox |

本番・開発環境へのデプロイは Git push で自動実行されます。事前に Amplify Console でリポジトリを接続してください。

```bash
git push origin main     # 本番デプロイ
git push origin develop  # 開発環境デプロイ
```

CI 環境からコマンドで直接デプロイする場合:

```bash
npm run amplify:deploy -- --branch main --app-id <AmplifyAppId>
```

## API ドキュメント

API の詳細仕様は [`docs/openapi.yaml`](docs/openapi.yaml) を参照してください。

すべてのエンドポイントは Cognito JWT (`Authorization: Bearer <token>`) が必要です。

[Swagger Editor](https://editor.swagger.io/) に `docs/openapi.yaml` を貼り付けると UI で確認できます。

## テスト

```bash
npm test
```

Lambda 関数のテストは Jest + ts-jest + aws-sdk-client-mock、フロントエンドのテストは Vitest + React Testing Library + MSW を使用します。
