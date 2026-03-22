import type { APIGatewayProxyHandler, APIGatewayProxyEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  ScanCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";

/**
 * Relationship_Lambda - キャラクター間関係性管理
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
 *
 * Endpoints:
 *   POST   /projects/{projectId}/relationships
 *   GET    /projects/{projectId}/relationships
 *   DELETE /projects/{projectId}/relationships/{relationshipId}
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
  | "INTERNAL_ERROR";

const ERROR_STATUS: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
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

    return errorResponse("NOT_FOUND", "エンドポイントが見つかりません");
  } catch (err) {
    console.error("Unhandled error:", err);
    return errorResponse("INTERNAL_ERROR", "内部エラーが発生しました");
  }
};
