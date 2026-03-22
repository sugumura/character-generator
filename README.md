# character-generator

ゲームキャラクター設定サポートツール。プロジェクト単位で世界観を定義し、Amazon Bedrock (Claude 3 Haiku) を使って日本語のバックグラウンドストーリーを自動生成します。

## 機能

- **認証** — Amazon Cognito によるサインアップ・ログイン
- **プロジェクト管理** — 世界観（worldSetting）ごとにキャラクターを整理
- **キャラクター生成** — 属性（性別・性格・種族・職業など）をランダム生成し、Bedrock でバックグラウンドストーリーを自動生成
- **キャラクター編集** — Combobox で属性を選択 or 自由入力、specialNotes を手動記入
- **関係性マップ** — キャラクター間の関係性を SVG ネットワークグラフで可視化

## 技術スタック

| レイヤー | 技術 |
|---|---|
| フロントエンド | React 18 + TypeScript, Vite, AWS Amplify UI |
| バックエンド | AWS Lambda (Node.js 20), API Gateway REST API |
| データストア | Amazon DynamoDB |
| AI 生成 | Amazon Bedrock — `anthropic.claude-3-haiku-20240307-v1:0` (ap-northeast-1) |
| 認証 | Amazon Cognito User Pool |
| インフラ | AWS Amplify Gen2 (CDK ベース) |

## ディレクトリ構成

```
.
├── amplify/
│   ├── auth/resource.ts          # Cognito 認証設定
│   ├── data/resource.ts          # DynamoDB スキーマ定義
│   ├── api/resource.ts           # API Gateway + Cognito Authorizer
│   ├── backend.ts                # Amplify Gen2 バックエンド定義
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

- Node.js 20+
- AWS CLI（認証設定済み）
- `@aws-amplify/backend-cli` (`ampx`)

### インストール

```bash
npm install
```

### ローカル開発（Amplify Sandbox）

```bash
# バックエンドをサンドボックス環境にデプロイ
npm run amplify:sandbox

# フロントエンド開発サーバーを起動（別ターミナル）
npm run dev
```

`amplify_outputs.json` が生成されたら、`src/amplifyconfiguration.json` に内容をコピーするか、Amplify の自動設定を利用してください。

### 環境変数

`.env.local` を作成し、API Gateway の URL を設定します。

```
VITE_API_BASE_URL=https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod
```

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

## API エンドポイント

すべてのエンドポイントは Cognito JWT (`Authorization: Bearer <token>`) が必要です。

| Method | Path | 説明 |
|---|---|---|
| POST | `/projects` | プロジェクト作成 |
| GET | `/projects` | プロジェクト一覧（降順） |
| GET | `/projects/{projectId}` | プロジェクト詳細 |
| DELETE | `/projects/{projectId}` | プロジェクト削除 |
| POST | `/projects/{projectId}/characters/generate` | キャラクター一括生成 |
| GET | `/projects/{projectId}/characters` | キャラクター一覧（昇順） |
| GET | `/projects/{projectId}/characters/{characterId}` | キャラクター詳細 |
| PUT | `/projects/{projectId}/characters/{characterId}` | キャラクター更新 |
| DELETE | `/projects/{projectId}/characters/{characterId}` | キャラクター削除 |
| POST | `/projects/{projectId}/characters/{characterId}/regenerate` | バックグラウンド再生成 |
| POST | `/projects/{projectId}/relationships` | 関係性作成 |
| GET | `/projects/{projectId}/relationships` | 関係性一覧 |
| DELETE | `/projects/{projectId}/relationships/{relationshipId}` | 関係性削除 |

## テスト

```bash
npm test
```

Lambda 関数のテストは Jest + ts-jest + aws-sdk-client-mock、フロントエンドのテストは Vitest + React Testing Library + MSW を使用します。
