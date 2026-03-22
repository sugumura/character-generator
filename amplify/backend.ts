import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import * as cdk from "aws-cdk-lib";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { defineApi } from "./api/resource";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Amplify Gen2 バックエンド定義
 * Requirements: 12.1, 12.5, 12.6
 */
const backend = defineBackend({
  auth,
});

// リソースタグ (Requirements 12.5)
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

// ─── DynamoDB + Lambda スタック ───────────────────────────────────────────────
const apiStack = backend.createStack("ApiStack");

// ---- DynamoDB テーブル定義 ----

// Projects_Table: PK=userId, SK=project#{projectId}
const projectsTable = new dynamodb.Table(apiStack, "ProjectsTable", {
  tableName: "Projects_Table",
  partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

// Characters_Table: PK=project#{projectId}, SK=character#{characterId}
const charactersTable = new dynamodb.Table(apiStack, "CharactersTable", {
  tableName: "Characters_Table",
  partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

// Relationships_Table: PK=project#{projectId}#character#{characterIdA}, SK=relation#{characterIdB}
const relationshipsTable = new dynamodb.Table(apiStack, "RelationshipsTable", {
  tableName: "Relationships_Table",
  partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});

// タグを付与
[projectsTable, charactersTable, relationshipsTable].forEach((table) => {
  Object.entries(resourceTags).forEach(([key, value]) => {
    cdk.Tags.of(table).add(key, value);
  });
});

// ---- Lambda 共通設定 ----
const userPoolArn = backend.auth.resources.userPool.userPoolArn;

const tableNames = {
  PROJECTS_TABLE_NAME: projectsTable.tableName,
  CHARACTERS_TABLE_NAME: charactersTable.tableName,
  RELATIONSHIPS_TABLE_NAME: relationshipsTable.tableName,
};

const commonLambdaProps: Omit<lambdaNodejs.NodejsFunctionProps, "entry"> = {
  runtime: lambda.Runtime.NODEJS_24_X,
  environment: {
    ...tableNames,
    REGION: apiStack.region,
  },
  memorySize: 256,
  timeout: cdk.Duration.seconds(30),
  bundling: {
    minify: true,
    sourceMap: false,
    target: "node24",
  },
};

// Project Lambda
const projectLambda = new lambdaNodejs.NodejsFunction(apiStack, "ProjectLambda", {
  ...commonLambdaProps,
  entry: join(__dirname, "functions/project-lambda/handler.ts"),
  handler: "handler",
});

// Character Lambda
const characterLambda = new lambdaNodejs.NodejsFunction(apiStack, "CharacterLambda", {
  ...commonLambdaProps,
  entry: join(__dirname, "functions/character-lambda/handler.ts"),
  handler: "handler",
});

// Generate Lambda (Bedrock 呼び出しのため timeout を長めに設定)
const generateLambda = new lambdaNodejs.NodejsFunction(apiStack, "GenerateLambda", {
  ...commonLambdaProps,
  entry: join(__dirname, "functions/generate-lambda/handler.ts"),
  handler: "handler",
  timeout: cdk.Duration.seconds(60),
});

// Relationship Lambda
const relationshipLambda = new lambdaNodejs.NodejsFunction(apiStack, "RelationshipLambda", {
  ...commonLambdaProps,
  entry: join(__dirname, "functions/relationship-lambda/handler.ts"),
  handler: "handler",
});

// ---- DynamoDB アクセス権限 ----
const allTables = [projectsTable, charactersTable, relationshipsTable];
const tableArns = allTables.flatMap((t) => [t.tableArn, `${t.tableArn}/index/*`]);

const dynamoPolicy = new iam.PolicyStatement({
  actions: [
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:DeleteItem",
    "dynamodb:Query",
    "dynamodb:Scan",
  ],
  resources: tableArns,
});

[projectLambda, characterLambda, generateLambda, relationshipLambda].forEach(
  (fn) => fn.addToRolePolicy(dynamoPolicy)
);

// ---- Bedrock 権限 (Requirement 4.8) ----
const bedrockPolicy = new iam.PolicyStatement({
  actions: ["bedrock:InvokeModel"],
  resources: ["*"],
});
generateLambda.addToRolePolicy(bedrockPolicy);
characterLambda.addToRolePolicy(bedrockPolicy);

// ---- API Gateway 定義 (Requirements 1.2, 1.3, 11.1) ----
defineApi(apiStack, userPoolArn, {
  projectLambda,
  characterLambda,
  generateLambda,
  relationshipLambda,
});

export { backend };
