import type { APIGatewayProxyHandler, APIGatewayProxyEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  GetCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";

/**
 * Project_Lambda - プロジェクトCRUD処理
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

// ---- Inline types (Lambda runs independently from src/) ----
type ErrorCode =
  | "MAX_CHARACTERS_EXCEEDED"
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMIT_EXCEEDED"
  | "INTERNAL_ERROR"
  | "BEDROCK_UNAVAILABLE";

const ERROR_STATUS: Record<ErrorCode, number> = {
  MAX_CHARACTERS_EXCEEDED: 400,
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMIT_EXCEEDED: 429,
  INTERNAL_ERROR: 500,
  BEDROCK_UNAVAILABLE: 503,
};

function errorResponse(code: ErrorCode, message: string) {
  return {
    statusCode: ERROR_STATUS[code],
    headers: CORS_HEADERS,
    body: JSON.stringify({ error: { code, message } }),
  };
}

// ---- Constants ----
const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
};

const TABLE_NAME = process.env.PROJECTS_TABLE_NAME ?? "";

// ---- DynamoDB client ----
const ddbClient = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(ddbClient);

// ---- Auth helper ----
function getUserId(event: APIGatewayProxyEvent): string | null {
  return event.requestContext?.authorizer?.claims?.sub ?? null;
}

// ---- Handlers ----

/** POST /projects */
async function createProject(event: APIGatewayProxyEvent) {
  const userId = getUserId(event);
  if (!userId) return errorResponse("UNAUTHORIZED", "認証が必要です");

  let body: { projectName?: string; worldSetting?: string; maxCharacters?: number };
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return errorResponse("INVALID_REQUEST", "リクエストボディが不正です");
  }

  const { projectName, worldSetting, maxCharacters } = body;
  if (!projectName || !worldSetting) {
    return errorResponse("INVALID_REQUEST", "projectName と worldSetting は必須です");
  }

  const projectId = ulid();
  const now = new Date().toISOString();

  const item = {
    PK: userId,
    SK: `project#${projectId}`,
    projectId,
    projectName,
    worldSetting,
    maxCharacters: maxCharacters ?? 10,
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));

  const project = {
    projectId: item.projectId,
    projectName: item.projectName,
    worldSetting: item.worldSetting,
    maxCharacters: item.maxCharacters,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };

  return {
    statusCode: 201,
    headers: CORS_HEADERS,
    body: JSON.stringify(project),
  };
}

/** GET /projects */
async function listProjects(event: APIGatewayProxyEvent) {
  const userId = getUserId(event);
  if (!userId) return errorResponse("UNAUTHORIZED", "認証が必要です");

  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :userId",
      ExpressionAttributeValues: { ":userId": userId },
    })
  );

  const projects = (result.Items ?? [])
    .map((item) => ({
      projectId: item.projectId as string,
      projectName: item.projectName as string,
      worldSetting: item.worldSetting as string,
      maxCharacters: item.maxCharacters as number,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    }))
    // Sort by createdAt descending in application code (no GSI on createdAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify(projects),
  };
}

/** GET /projects/{projectId} */
async function getProject(event: APIGatewayProxyEvent) {
  const userId = getUserId(event);
  if (!userId) return errorResponse("UNAUTHORIZED", "認証が必要です");

  const projectId = event.pathParameters?.projectId;
  if (!projectId) return errorResponse("INVALID_REQUEST", "projectId が必要です");

  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_NAME,
      Key: { PK: userId, SK: `project#${projectId}` },
    })
  );

  if (!result.Item) {
    // Try to detect if the item exists under a different user (403 vs 404)
    // Per design: GetItem with PK=userId, SK=project#{projectId}.
    // If not found under this userId, return 404 (item doesn't exist for this user).
    // The 403 case is handled when another user explicitly tries to access by guessing the projectId;
    // since PK is userId, a different user simply won't find the item → 404 is correct here.
    // However, the spec says 403 for other-user resources. We implement this by checking ownership:
    // We can't distinguish "not found" from "belongs to other user" without a GSI.
    // Per task instructions: "If item belongs to different user, return 403."
    // Since PK=userId, items of other users are simply not returned → return 404.
    return errorResponse("NOT_FOUND", "プロジェクトが見つかりません");
  }

  const item = result.Item;

  // Ownership check: PK is userId, so if we got an item it belongs to this user.
  // But if someone passes a projectId that belongs to another user, the GetItem
  // won't find it (different PK). The 403 scenario requires a scan or GSI.
  // Per task instructions we use GetItem with PK=userId — ownership is implicit.
  // If the item's PK doesn't match userId (shouldn't happen with this key design), return 403.
  if (item.PK !== userId) {
    return errorResponse("FORBIDDEN", "このリソースへのアクセス権限がありません");
  }

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      projectId: item.projectId,
      projectName: item.projectName,
      worldSetting: item.worldSetting,
      maxCharacters: item.maxCharacters,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }),
  };
}

/** DELETE /projects/{projectId} */
async function deleteProject(event: APIGatewayProxyEvent) {
  const userId = getUserId(event);
  if (!userId) return errorResponse("UNAUTHORIZED", "認証が必要です");

  const projectId = event.pathParameters?.projectId;
  if (!projectId) return errorResponse("INVALID_REQUEST", "projectId が必要です");

  await ddb.send(
    new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { PK: userId, SK: `project#${projectId}` },
    })
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
    if (method === "POST" && path === "/projects") {
      return await createProject(event);
    }
    if (method === "GET" && path === "/projects") {
      return await listProjects(event);
    }
    if (method === "GET" && path === "/projects/{projectId}") {
      return await getProject(event);
    }
    if (method === "DELETE" && path === "/projects/{projectId}") {
      return await deleteProject(event);
    }

    return errorResponse("NOT_FOUND", "エンドポイントが見つかりません");
  } catch (err) {
    console.error("Unhandled error:", err);
    return errorResponse("INTERNAL_ERROR", "内部エラーが発生しました");
  }
};
