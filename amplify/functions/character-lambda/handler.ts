import type { APIGatewayProxyHandler, APIGatewayProxyEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from "@aws-sdk/lib-dynamodb";
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

/**
 * Character_Lambda - キャラクター管理・再生成処理
 * Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 6.3, 6.4, 6.5
 *
 * Endpoints:
 *   GET    /projects/{projectId}/characters
 *   GET    /projects/{projectId}/characters/{characterId}
 *   PUT    /projects/{projectId}/characters/{characterId}
 *   DELETE /projects/{projectId}/characters/{characterId}
 *   POST   /projects/{projectId}/characters/{characterId}/regenerate
 */

// ---- Error helpers ----
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

const CHARACTERS_TABLE = process.env.CHARACTERS_TABLE_NAME ?? "";
const PROJECTS_TABLE = process.env.PROJECTS_TABLE_NAME ?? "";

// ---- Bedrock client (inlined — Requirements 5.1) ----
const MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0";
const bedrockClient = new BedrockRuntimeClient({ region: "ap-northeast-1" });

async function generateBackground(
  worldSetting: string,
  character: {
    gender: string;
    personality: string;
    age: string;
    species: string;
    occupation: string;
    hairColor: string;
    skinColor: string;
  }
): Promise<string> {
  const systemPromptText = `あなたはゲームキャラクターのバックグラウンドストーリーを作成する専門家です。以下の世界観に基づいてキャラクターのバックグラウンドを作成してください。世界観: ${worldSetting} 制約: 日本語で300文字程度。キャラクターの過去・動機・目標を含めること。`;

  const userMessage = `以下のキャラクター属性に基づいてバックグラウンドストーリーを作成してください。
性別: ${character.gender}
性格: ${character.personality}
年代: ${character.age}
種族: ${character.species}
職業: ${character.occupation}
髪色: ${character.hairColor}
肌色: ${character.skinColor}`;

  const requestBody = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 500,
    system: systemPromptText,
    messages: [{ role: "user", content: userMessage }],
  };

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(requestBody),
  });

  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  return responseBody.content[0].text as string;
}

// ---- Auth helper ----
function getUserId(event: APIGatewayProxyEvent): string | null {
  return event.requestContext?.authorizer?.claims?.sub ?? null;
}

// ---- Updatable character fields (Requirements 6.3) ----
const UPDATABLE_FIELDS = [
  "gender",
  "personality",
  "age",
  "species",
  "occupation",
  "hairColor",
  "skinColor",
  "specialNotes",
  "background",
] as const;

// ---- GET /projects/{projectId}/characters ----
// Requirements 6.1: return all characters sorted by createdAt ascending
async function listCharacters(event: APIGatewayProxyEvent) {
  const userId = getUserId(event);
  if (!userId) return errorResponse("UNAUTHORIZED", "認証が必要です");

  const projectId = event.pathParameters?.projectId;
  if (!projectId) return errorResponse("INVALID_REQUEST", "projectId が必要です");

  const result = await ddb.send(
    new QueryCommand({
      TableName: CHARACTERS_TABLE,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": `project#${projectId}` },
    })
  );

  const characters = (result.Items ?? [])
    // Filter out rate-limit records (SK starts with "date#")
    .filter((item: Record<string, unknown>) => (item.SK as string).startsWith("character#"))
    .map((item: Record<string, unknown>) => ({
      characterId: item.characterId as string,
      gender: item.gender as string,
      personality: item.personality as string,
      age: item.age as string,
      species: item.species as string,
      occupation: item.occupation as string,
      hairColor: item.hairColor as string,
      skinColor: item.skinColor as string,
      specialNotes: item.specialNotes as string,
      background: item.background as string,
      generationStatus: item.generationStatus as string,
      createdAt: item.createdAt as string,
      updatedAt: item.updatedAt as string,
    }))
    // Sort ascending by createdAt (Requirements 6.1)
    .sort((a: { createdAt: string }, b: { createdAt: string }) =>
      a.createdAt.localeCompare(b.createdAt)
    );

  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify(characters),
  };
}

// ---- GET /projects/{projectId}/characters/{characterId} ----
// Requirements 6.2: return character details
async function getCharacter(event: APIGatewayProxyEvent) {
  const userId = getUserId(event);
  if (!userId) return errorResponse("UNAUTHORIZED", "認証が必要です");

  const { projectId, characterId } = event.pathParameters ?? {};
  if (!projectId || !characterId) {
    return errorResponse("INVALID_REQUEST", "projectId と characterId が必要です");
  }

  const result = await ddb.send(
    new GetCommand({
      TableName: CHARACTERS_TABLE,
      Key: { PK: `project#${projectId}`, SK: `character#${characterId}` },
    })
  );

  if (!result.Item) {
    return errorResponse("NOT_FOUND", "キャラクターが見つかりません");
  }

  const item = result.Item;
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      characterId: item.characterId,
      gender: item.gender,
      personality: item.personality,
      age: item.age,
      species: item.species,
      occupation: item.occupation,
      hairColor: item.hairColor,
      skinColor: item.skinColor,
      specialNotes: item.specialNotes,
      background: item.background,
      generationStatus: item.generationStatus,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }),
  };
}

// ---- PUT /projects/{projectId}/characters/{characterId} ----
// Requirements 6.3: update character attributes
async function updateCharacter(event: APIGatewayProxyEvent) {
  const userId = getUserId(event);
  if (!userId) return errorResponse("UNAUTHORIZED", "認証が必要です");

  const { projectId, characterId } = event.pathParameters ?? {};
  if (!projectId || !characterId) {
    return errorResponse("INVALID_REQUEST", "projectId と characterId が必要です");
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return errorResponse("INVALID_REQUEST", "リクエストボディが不正です");
  }

  // Build update expression from allowed fields only
  const updateParts: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, unknown> = {};

  for (const field of UPDATABLE_FIELDS) {
    if (field in body) {
      updateParts.push(`#${field} = :${field}`);
      expressionAttributeNames[`#${field}`] = field;
      expressionAttributeValues[`:${field}`] = body[field];
    }
  }

  if (updateParts.length === 0) {
    return errorResponse("INVALID_REQUEST", "更新するフィールドがありません");
  }

  const now = new Date().toISOString();
  updateParts.push("#updatedAt = :updatedAt");
  expressionAttributeNames["#updatedAt"] = "updatedAt";
  expressionAttributeValues[":updatedAt"] = now;

  await ddb.send(
    new UpdateCommand({
      TableName: CHARACTERS_TABLE,
      Key: { PK: `project#${projectId}`, SK: `character#${characterId}` },
      UpdateExpression: `SET ${updateParts.join(", ")}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );

  // Return updated character
  const result = await ddb.send(
    new GetCommand({
      TableName: CHARACTERS_TABLE,
      Key: { PK: `project#${projectId}`, SK: `character#${characterId}` },
    })
  );

  if (!result.Item) {
    return errorResponse("NOT_FOUND", "キャラクターが見つかりません");
  }

  const item = result.Item;
  return {
    statusCode: 200,
    headers: CORS_HEADERS,
    body: JSON.stringify({
      characterId: item.characterId,
      gender: item.gender,
      personality: item.personality,
      age: item.age,
      species: item.species,
      occupation: item.occupation,
      hairColor: item.hairColor,
      skinColor: item.skinColor,
      specialNotes: item.specialNotes,
      background: item.background,
      generationStatus: item.generationStatus,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    }),
  };
}

// ---- DELETE /projects/{projectId}/characters/{characterId} ----
// Requirements 6.4: delete character
async function deleteCharacter(event: APIGatewayProxyEvent) {
  const userId = getUserId(event);
  if (!userId) return errorResponse("UNAUTHORIZED", "認証が必要です");

  const { projectId, characterId } = event.pathParameters ?? {};
  if (!projectId || !characterId) {
    return errorResponse("INVALID_REQUEST", "projectId と characterId が必要です");
  }

  await ddb.send(
    new DeleteCommand({
      TableName: CHARACTERS_TABLE,
      Key: { PK: `project#${projectId}`, SK: `character#${characterId}` },
    })
  );

  return {
    statusCode: 204,
    headers: CORS_HEADERS,
    body: "",
  };
}

// ---- POST /projects/{projectId}/characters/{characterId}/regenerate ----
// Requirements 5.1, 5.2, 5.3
async function regenerateCharacter(event: APIGatewayProxyEvent) {
  const userId = getUserId(event);
  if (!userId) return errorResponse("UNAUTHORIZED", "認証が必要です");

  const { projectId, characterId } = event.pathParameters ?? {};
  if (!projectId || !characterId) {
    return errorResponse("INVALID_REQUEST", "projectId と characterId が必要です");
  }

  // Step 1: Get character
  const charResult = await ddb.send(
    new GetCommand({
      TableName: CHARACTERS_TABLE,
      Key: { PK: `project#${projectId}`, SK: `character#${characterId}` },
    })
  );

  if (!charResult.Item) {
    return errorResponse("NOT_FOUND", "キャラクターが見つかりません");
  }

  const character = charResult.Item;

  // Step 2: Get project for worldSetting
  const projectResult = await ddb.send(
    new GetCommand({
      TableName: PROJECTS_TABLE,
      Key: { PK: userId, SK: `project#${projectId}` },
    })
  );

  if (!projectResult.Item) {
    return errorResponse("NOT_FOUND", "プロジェクトが見つかりません");
  }

  const worldSetting: string = projectResult.Item.worldSetting;

  // Step 3: Reset generationStatus to pending (Requirements 5.1)
  const pendingAt = new Date().toISOString();
  await ddb.send(
    new UpdateCommand({
      TableName: CHARACTERS_TABLE,
      Key: { PK: `project#${projectId}`, SK: `character#${characterId}` },
      UpdateExpression: "SET generationStatus = :s, updatedAt = :u",
      ExpressionAttributeValues: { ":s": "pending", ":u": pendingAt },
    })
  );

  // Step 4: Update to generating
  const generatingAt = new Date().toISOString();
  await ddb.send(
    new UpdateCommand({
      TableName: CHARACTERS_TABLE,
      Key: { PK: `project#${projectId}`, SK: `character#${characterId}` },
      UpdateExpression: "SET generationStatus = :s, updatedAt = :u",
      ExpressionAttributeValues: { ":s": "generating", ":u": generatingAt },
    })
  );

  try {
    // Step 5: Call Bedrock (Requirements 5.1)
    const background = await generateBackground(worldSetting, {
      gender: character.gender as string,
      personality: character.personality as string,
      age: character.age as string,
      species: character.species as string,
      occupation: character.occupation as string,
      hairColor: character.hairColor as string,
      skinColor: character.skinColor as string,
    });

    const completedAt = new Date().toISOString();

    // Step 6: Update background + status → completed (Requirements 5.2)
    await ddb.send(
      new UpdateCommand({
        TableName: CHARACTERS_TABLE,
        Key: { PK: `project#${projectId}`, SK: `character#${characterId}` },
        UpdateExpression: "SET background = :b, generationStatus = :s, updatedAt = :u",
        ExpressionAttributeValues: {
          ":b": background,
          ":s": "completed",
          ":u": completedAt,
        },
      })
    );

    // Return updated character
    const updated = await ddb.send(
      new GetCommand({
        TableName: CHARACTERS_TABLE,
        Key: { PK: `project#${projectId}`, SK: `character#${characterId}` },
      })
    );

    const item = updated.Item!;
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        characterId: item.characterId,
        gender: item.gender,
        personality: item.personality,
        age: item.age,
        species: item.species,
        occupation: item.occupation,
        hairColor: item.hairColor,
        skinColor: item.skinColor,
        specialNotes: item.specialNotes,
        background: item.background,
        generationStatus: item.generationStatus,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      }),
    };
  } catch (err) {
    console.error(`Bedrock regeneration failed for character ${characterId}:`, err);
    const failedAt = new Date().toISOString();

    // Requirements 5.3: update status → failed on error
    await ddb.send(
      new UpdateCommand({
        TableName: CHARACTERS_TABLE,
        Key: { PK: `project#${projectId}`, SK: `character#${characterId}` },
        UpdateExpression: "SET generationStatus = :s, updatedAt = :u",
        ExpressionAttributeValues: { ":s": "failed", ":u": failedAt },
      })
    );

    return errorResponse("BEDROCK_UNAVAILABLE", "バックグラウンドストーリーの再生成に失敗しました");
  }
}

// ---- Main handler ----
export const handler: APIGatewayProxyHandler = async (event) => {
  const method = event.httpMethod;
  const path = event.resource ?? event.path;

  try {
    if (method === "GET" && path === "/projects/{projectId}/characters") {
      return await listCharacters(event);
    }
    if (method === "GET" && path === "/projects/{projectId}/characters/{characterId}") {
      return await getCharacter(event);
    }
    if (method === "PUT" && path === "/projects/{projectId}/characters/{characterId}") {
      return await updateCharacter(event);
    }
    if (method === "DELETE" && path === "/projects/{projectId}/characters/{characterId}") {
      return await deleteCharacter(event);
    }
    if (
      method === "POST" &&
      path === "/projects/{projectId}/characters/{characterId}/regenerate"
    ) {
      return await regenerateCharacter(event);
    }

    return errorResponse("NOT_FOUND", "エンドポイントが見つかりません");
  } catch (err) {
    console.error("Unhandled error:", err);
    return errorResponse("INTERNAL_ERROR", "内部エラーが発生しました");
  }
};
