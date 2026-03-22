import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from "aws-cdk-lib/aws-iam";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { defineApi } from "./api/resource";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Amplify Gen2 バックエンド定義
 * Requirements: 12.1, 12.5, 12.6
 *
 * すべてのAWSリソースに以下のタグを付与:
 *   Project:    character-generator
 *   ManagedBy:  amplify-gen2
 *   Owner:      team-gamedev
 *   CostCenter: gamedev-tools
 */
const backend = defineBackend({
  auth,
  data,
});

// リソースタグの付与 (Requirements 12.5)
const resourceTags = {
  Project: "character-generator",
  ManagedBy: "amplify-gen2",
  Owner: "team-gamedev",
  CostCenter: "gamedev-tools",
};

// Cognito User Pool にタグを付与
const { cfnUserPool } = backend.auth.resources.cfnResources;
Object.entries(resourceTags).forEach(([key, value]) => {
  cfnUserPool.addPropertyOverride(`UserPoolTags.${key}`, value);
});

// DynamoDB テーブルにタグを付与
const { amplifyDynamoDbTables } = backend.data.resources.cfnResources;
Object.values(amplifyDynamoDbTables).forEach((table) => {
  const tags = Object.entries(resourceTags).map(([key, value]) => ({
    Key: key,
    Value: value,
  }));
  table.addPropertyOverride("Tags", tags);
});

// ─── API Gateway + Lambda スタック ───────────────────────────────────────────
const apiStack = backend.createStack("ApiStack");

// Cognito User Pool ARN
const userPoolArn = backend.auth.resources.userPool.userPoolArn;

// DynamoDB テーブル名（環境変数として Lambda に渡す）
const tableNames = {
  PROJECTS_TABLE: "Projects_Table",
  CHARACTERS_TABLE: "Characters_Table",
  RELATIONSHIPS_TABLE: "Relationships_Table",
};

// 共通 Lambda 設定
const commonLambdaProps: Omit<lambda.FunctionProps, "handler" | "code"> = {
  runtime: lambda.Runtime.NODEJS_20_X,
  environment: {
    ...tableNames,
    REGION: apiStack.region,
  },
  memorySize: 256,
  timeout: cdk.Duration.seconds(30),
};

// Project Lambda
const projectLambda = new lambda.Function(apiStack, "ProjectLambda", {
  ...commonLambdaProps,
  handler: "handler.handler",
  code: lambda.Code.fromAsset(
    join(__dirname, "functions/project-lambda")
  ),
});

// Character Lambda
const characterLambda = new lambda.Function(apiStack, "CharacterLambda", {
  ...commonLambdaProps,
  handler: "handler.handler",
  code: lambda.Code.fromAsset(
    join(__dirname, "functions/character-lambda")
  ),
});

// Generate Lambda (Bedrock 呼び出しのため timeout を長めに設定)
const generateLambda = new lambda.Function(apiStack, "GenerateLambda", {
  ...commonLambdaProps,
  handler: "handler.handler",
  code: lambda.Code.fromAsset(
    join(__dirname, "functions/generate-lambda")
  ),
  timeout: cdk.Duration.seconds(60),
});

// Relationship Lambda
const relationshipLambda = new lambda.Function(apiStack, "RelationshipLambda", {
  ...commonLambdaProps,
  handler: "handler.handler",
  code: lambda.Code.fromAsset(
    join(__dirname, "functions/relationship-lambda")
  ),
});

// DynamoDB アクセス権限を付与
const dynamoPolicy = new iam.PolicyStatement({
  actions: [
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:DeleteItem",
    "dynamodb:Query",
    "dynamodb:Scan",
  ],
  resources: ["*"],
});
[projectLambda, characterLambda, generateLambda, relationshipLambda].forEach(
  (fn) => fn.addToRolePolicy(dynamoPolicy)
);

// Bedrock 権限を Generate Lambda と Character Lambda に付与 (Requirement 4.8)
const bedrockPolicy = new iam.PolicyStatement({
  actions: ["bedrock:InvokeModel"],
  resources: ["*"],
});
generateLambda.addToRolePolicy(bedrockPolicy);
characterLambda.addToRolePolicy(bedrockPolicy);

// API Gateway を定義 (Requirements 1.2, 1.3, 11.1)
defineApi(apiStack, userPoolArn, {
  projectLambda,
  characterLambda,
  generateLambda,
  relationshipLambda,
});

export { backend };
