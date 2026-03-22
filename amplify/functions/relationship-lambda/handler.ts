import type { APIGatewayProxyHandler, APIGatewayProxyEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  DeleteCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

/**
 * Relationship_Lambda - キャラクター間関係性管理
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6
 *
 * Endpoints:
 *   POST   /projects/{projectId}/relationships
 *   GET    /projects/{projectId}/relationships
 *   DELETE /projects/{projectId}/relationships/{relationshipId}
 *   POST   /projects/{projectId}/relationships/{relationshipId}/regenerate
 */

// ---- ULID (inline, no external dependency) ----
const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function ulid(): string {
  const now = Date.now();
  let timeStr = "";
  let t = now;
  for (let i = 9; i >= 0; i--) {
    timeStr = ENCODING[t % 32] + timeStr;
    t = Math.floor(t / 32);
  }
  let randStr = "";
  for (let i = 0; i < 16; i++) {
    randStr += ENCODING[Math.floor(Math.random() * 32)];
  }
  return timeStr + randStr;
}

// ---- Error helpers ----
type ErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "INTERNAL_ERROR"
  | "BEDROCK_UNAVAILABLE";

const ERROR_STATUS: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
  BEDROCK_UNAVAILABLE: 503,
};

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

function errorResponse(code: ErrorCode, message: string) {
  return {
    statusCode: ERROR_STATUS[code],
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: { code, message } }),
  };
}

// ---- DynamoDB client ----
const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

const RELATIONSHIPS_TABLE = process.env.RELATIONSHIPS_TABLE_NAME ?? "";
const CHARACTERS_TABLE = process.env.CHARACTERS_TABLE_NAME ?? "";
const PROJECTS_TABLE = process.env.PROJECTS_TABLE_NAME ?? "";

// ---- Bedrock client ----
const MODEL_ID = "amazon.nova-lite-v1:0";
const bedrockClient = new BedrockRuntimeClient({ region: "ap-northeast-1" });
const VALID_TYPES = ["仲間", "ライバル", "師弟", "恋人", "家族", "敵対"];

async function generateRelationshipWithBedrock(
  worldSetting: string,
  charA: Record<string, string>,
  charB: Record<string, string>
): Promise<{ relationshipType: string; description: string }> {
  const userMessage = `以下の2人のキャラクターの関係性を決めてください。

世界観: ${worldSetting}

キャラクターA:
- 性別: ${charA.gender} / 性格: ${charA.personality} / 年代: ${charA.age}
- 種族: ${charA.species} / 職業: ${charA.occupation}

キャラクターB:
- 性別: ${charB.gender} / 性格: ${charB.personality} / 年代: ${charB.age}
- 種族: ${charB.species} / 職業: ${charB.occupation}

以下のJSON形式のみで回答してください（説明不要）:
{"relationshipType": "<${VALID_TYPES.join(" | ")}>", "description": "<50文字程度の日本語説明>"}`;

  const command = new ConverseCommand({
    modelId: MODEL_ID,
    messages: [{ role: "user", content: [{ text: userMessage }] }],
    inferenceConfig: { maxTokens: 200 },
  });

  const response = await bedrockClient.send(command);
  const text = response.output?.message?.content?.[0]?.text;
  if (!text) throw new Error("No text in Bedrock response");

  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found in Bedrock response");
  const parsed = JSON.parse(match[0]) as { relationshipType: string; description: string };
  if (!VALID_TYPES.includes(parsed.relationshipType)) {
    parsed.relationshipType = "仲間";
  }
  return parsed;
}

// ---- Auth helper ----
function getUserId(event: APIGatewayProxyEvent): string | null {
  return event.requestContext?.authorizer?.claims?.sub ?? null;
}

// ---- POST /projects/{projectId}/relationships ----
// Requirements 7.1: save A→B and B→A symmetrically with the same relationshipId
async function createRelationship(event: APIGatewayProxyEvent) {
  const userId = getUserId(event);
  if (!userId) return errorResponse("UNAUTHORIZED", "認証が必要です");

  const projectId = event.pathParameters?.projectId;
  if (!projectId) return errorResponse("INVALID_REQUEST", "projectId が必要です");

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return errorResponse("INVALID_REQUEST", "リクエストボディが不正です");
  }

  const { characterIdA, characterIdB, relationshipType, description } = body as {
    characterIdA?: string;
    characterIdB?: string;
    relationshipType?: string;
    description?: string;
  };

  if (!characterIdA || !characterIdB || !relationshipType) {
    return errorResponse(
      "INVALID_REQUEST",
      "characterIdA, characterIdB, relationshipType は必須です"
    );
  }

  const VALID_TYPES = ["仲間", "ライバル", "師弟", "恋人", "家族", "敵対"];
  if (!VALID_TYPES.includes(relationshipType)) {
    return errorResponse(
      "INVALID_REQUEST",
      `relationshipType は ${VALID_TYPES.join(" / ")} のいずれかである必要があります`
    );
  }

  const relationshipId = ulid();
  const desc = description ?? "";

  // Record 1: A→B
  await ddb.send(
    new PutCommand({
      TableName: RELATIONSHIPS_TABLE,
      Item: {
        PK: `project#${projectId}#character#${characterIdA}`,
        SK: `relation#${characterIdB}`,
        relationshipId,
        relationshipType,
        description: desc,
        characterIdA,
        characterIdB,
      },
    })
  );

  // Record 2: B→A (Requirements 7.1 — symmetric)
  await ddb.send(
    new PutCommand({
      TableName: RELATIONSHIPS_TABLE,
      Item: {
        PK: `project#${projectId}#character#${characterIdB}`,
        SK: `relation#${characterIdA}`,
        relationshipId,
        relationshipType,
        description: desc,
        characterIdA: characterIdB,
        characterIdB: characterIdA,
      },
    })
  );

  return {
    statusCode: 201,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      relationshipId,
      characterIdA,
      characterIdB,
      relationshipType,
      description: desc,
    }),
  };
}

// ---- GET /projects/{projectId}/relationships ----
// Requirements 7.2: return all relationships in the project
async function listRelationships(event: APIGatewayProxyEvent) {
  const userId = getUserId(event);
  if (!userId) return errorResponse("UNAUTHORIZED", "認証が必要です");

  const projectId = event.pathParameters?.projectId;
  if (!projectId) return errorResponse("INVALID_REQUEST", "projectId が必要です");

  const prefix = `project#${projectId}#character#`;

  // Scan with FilterExpression begins_with(PK, :prefix)
  const result = await ddb.send(
    new ScanCommand({
      TableName: RELATIONSHIPS_TABLE,
      FilterExpression: "begins_with(PK, :prefix)",
      ExpressionAttributeValues: { ":prefix": prefix },
    })
  );

  const relationships = (result.Items ?? []).map((item: Record<string, unknown>) => ({
    relationshipId: item.relationshipId as string,
    characterIdA: item.characterIdA as string,
    characterIdB: item.characterIdB as string,
    relationshipType: item.relationshipType as string,
    description: item.description as string,
  }));

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify(relationships),
  };
}

// ---- DELETE /projects/{projectId}/relationships/{relationshipId} ----
// Requirements 7.3: delete both A→B and B→A records sharing the same relationshipId
async function deleteRelationship(event: APIGatewayProxyEvent) {
  const userId = getUserId(event);
  if (!userId) return errorResponse("UNAUTHORIZED", "認証が必要です");

  const { projectId, relationshipId } = event.pathParameters ?? {};
  if (!projectId || !relationshipId) {
    return errorResponse("INVALID_REQUEST", "projectId と relationshipId が必要です");
  }

  const prefix = `project#${projectId}#character#`;

  // Step 1: Scan for all records with this relationshipId in the project
  const result = await ddb.send(
    new ScanCommand({
      TableName: RELATIONSHIPS_TABLE,
      FilterExpression:
        "begins_with(PK, :prefix) AND relationshipId = :rid",
      ExpressionAttributeValues: {
        ":prefix": prefix,
        ":rid": relationshipId,
      },
    })
  );

  const items = result.Items ?? [];
  if (items.length === 0) {
    return errorResponse("NOT_FOUND", "関係性が見つかりません");
  }

  // Step 2: Delete all matching records (should be exactly 2: A→B and B→A)
  await Promise.all(
    items.map((item: Record<string, unknown>) =>
      ddb.send(
        new DeleteCommand({
          TableName: RELATIONSHIPS_TABLE,
          Key: { PK: item.PK as string, SK: item.SK as string },
        })
      )
    )
  );

  return {
    statusCode: 204,
    headers: CORS_HEADERS,
    body: "",
  };
}

// ---- POST /projects/{projectId}/relationships/{relationshipId}/regenerate ----
// Requirements 7.4: delete existing relationship and regenerate with Bedrock
async function regenerateRelationship(event: APIGatewayProxyEvent) {
  const userId = getUserId(event);
  if (!userId) return errorResponse("UNAUTHORIZED", "認証が必要です");

  const { projectId, relationshipId } = event.pathParameters ?? {};
  if (!projectId || !relationshipId) {
    return errorResponse("INVALID_REQUEST", "projectId と relationshipId が必要です");
  }

  const prefix = `project#${projectId}#character#`;

  // Step 1: 既存レコードを取得
  const scanResult = await ddb.send(
    new ScanCommand({
      TableName: RELATIONSHIPS_TABLE,
      FilterExpression: "begins_with(PK, :prefix) AND relationshipId = :rid",
      ExpressionAttributeValues: { ":prefix": prefix, ":rid": relationshipId },
    })
  );

  const items = scanResult.Items ?? [];
  if (items.length === 0) {
    return errorResponse("NOT_FOUND", "関係性が見つかりません");
  }

  // characterIdA/B を取得（A→B レコードから）
  const record = items[0] as Record<string, string>;
  const characterIdA = record.characterIdA;
  const characterIdB = record.characterIdB;

  // Step 2: キャラクター情報を取得
  const [charAResult, charBResult] = await Promise.all([
    ddb.send(new GetCommand({
      TableName: CHARACTERS_TABLE,
      Key: { PK: `project#${projectId}`, SK: `character#${characterIdA}` },
    })),
    ddb.send(new GetCommand({
      TableName: CHARACTERS_TABLE,
      Key: { PK: `project#${projectId}`, SK: `character#${characterIdB}` },
    })),
  ]);

  if (!charAResult.Item || !charBResult.Item) {
    return errorResponse("NOT_FOUND", "キャラクターが見つかりません");
  }

  // Step 3: プロジェクトの worldSetting を取得
  const projectResult = await ddb.send(new GetCommand({
    TableName: PROJECTS_TABLE,
    Key: { PK: userId, SK: `project#${projectId}` },
  }));

  if (!projectResult.Item) {
    return errorResponse("NOT_FOUND", "プロジェクトが見つかりません");
  }

  const worldSetting: string = projectResult.Item.worldSetting;

  // Step 4: 既存レコードを削除
  await Promise.all(
    items.map((item: Record<string, unknown>) =>
      ddb.send(new DeleteCommand({
        TableName: RELATIONSHIPS_TABLE,
        Key: { PK: item.PK as string, SK: item.SK as string },
      }))
    )
  );

  // Step 5: Bedrock で新しい関係性を生成
  let rel: { relationshipType: string; description: string };
  try {
    rel = await generateRelationshipWithBedrock(
      worldSetting,
      charAResult.Item as Record<string, string>,
      charBResult.Item as Record<string, string>
    );
  } catch (err) {
    console.error("Bedrock relationship regeneration failed:", err);
    return errorResponse("BEDROCK_UNAVAILABLE", "関係性の再生成に失敗しました");
  }

  // Step 6: 新しいレコードを保存（同じ relationshipId を再利用）
  const now = new Date().toISOString();
  await Promise.all([
    ddb.send(new PutCommand({
      TableName: RELATIONSHIPS_TABLE,
      Item: {
        PK: `project#${projectId}#character#${characterIdA}`,
        SK: `relation#${characterIdB}`,
        relationshipId,
        characterIdA,
        characterIdB,
        relationshipType: rel.relationshipType,
        description: rel.description,
        createdAt: now,
      },
    })),
    ddb.send(new PutCommand({
      TableName: RELATIONSHIPS_TABLE,
      Item: {
        PK: `project#${projectId}#character#${characterIdB}`,
        SK: `relation#${characterIdA}`,
        relationshipId,
        characterIdA: characterIdB,
        characterIdB: characterIdA,
        relationshipType: rel.relationshipType,
        description: rel.description,
        createdAt: now,
      },
    })),
  ]);

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      relationshipId,
      characterIdA,
      characterIdB,
      relationshipType: rel.relationshipType,
      description: rel.description,
    }),
  };
}

// ---- Main handler ----
export const handler: APIGatewayProxyHandler = async (event) => {
  const method = event.httpMethod;
  const path = event.resource ?? event.path;

  try {
    if (method === "POST" && path === "/projects/{projectId}/relationships") {
      return await createRelationship(event);
    }
    if (method === "GET" && path === "/projects/{projectId}/relationships") {
      return await listRelationships(event);
    }
    if (
      method === "DELETE" &&
      path === "/projects/{projectId}/relationships/{relationshipId}"
    ) {
      return await deleteRelationship(event);
    }
    if (
      method === "POST" &&
      path === "/projects/{projectId}/relationships/{relationshipId}/regenerate"
    ) {
      return await regenerateRelationship(event);
    }

    return errorResponse("NOT_FOUND", "エンドポイントが見つかりません");
  } catch (err) {
    console.error("Unhandled error:", err);
    return errorResponse("INTERNAL_ERROR", "内部エラーが発生しました");
  }
};
