import type { APIGatewayProxyHandler, APIGatewayProxyEvent } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { ulid } from "ulid";
import { generateBackground } from "./bedrockClient";

/**
 * Generate_Lambda - キャラクターランダム属性生成 + Bedrock連携
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.5, 4.6, 4.7, 11.2, 11.3
 */

// ---- Inline ATTRIBUTE_OPTIONS (Requirements 3.3) ----
const ATTRIBUTE_OPTIONS = {
  gender: ["男性", "女性", "その他"],
  personality: ["冷静沈着", "熱血漢", "臆病", "好奇心旺盛", "慎重", "楽天的", "皮肉屋", "優しい", "厳格", "自由奔放"],
  age: ["10代", "20代", "30代", "40代", "50代", "60代", "70代", "80代"],
  species: ["人間", "エルフ", "ドワーフ", "獣人", "竜人", "半霊", "機械人形"],
  occupation: ["剣士", "魔法使い", "弓使い", "盗賊", "僧侶", "商人", "鍛冶師", "学者", "吟遊詩人", "農民", "貴族", "傭兵"],
  hairColor: ["黒", "白", "金", "銀", "赤", "青", "緑", "茶", "紫"],
  skinColor: ["色白", "小麦色", "褐色", "灰色", "青白い", "緑がかった"],
} as const;

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

// ---- Auth helper ----
function getUserId(event: APIGatewayProxyEvent): string | null {
  return event.requestContext?.authorizer?.claims?.sub ?? null;
}

// ---- Random attribute picker ----
function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---- Today's date string YYYY-MM-DD (UTC) ----
function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---- Next day midnight epoch (UTC) for TTL ----
function nextDayMidnightEpoch(): number {
  const now = new Date();
  const nextMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  return Math.floor(nextMidnight.getTime() / 1000);
}

// ---- Background processing: update status → generating → call Bedrock → completed/failed ----
async function processCharacterBackground(
  characterId: string,
  projectId: string,
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
): Promise<void> {
  const now = new Date().toISOString();

  // Requirements 4.5: update status → generating
  await ddb.send(
    new UpdateCommand({
      TableName: CHARACTERS_TABLE,
      Key: { PK: `project#${projectId}`, SK: `character#${characterId}` },
      UpdateExpression: "SET generationStatus = :s, updatedAt = :u",
      ExpressionAttributeValues: { ":s": "generating", ":u": now },
    })
  );

  try {
    // Requirements 4.1: call Bedrock
    const background = await generateBackground({ worldSetting, character });
    const completedAt = new Date().toISOString();

    // Requirements 4.6: update background + status → completed
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
  } catch (err) {
    console.error(`Bedrock generation failed for character ${characterId}:`, err);
    const failedAt = new Date().toISOString();

    // Requirements 4.7: update status → failed
    await ddb.send(
      new UpdateCommand({
        TableName: CHARACTERS_TABLE,
        Key: { PK: `project#${projectId}`, SK: `character#${characterId}` },
        UpdateExpression: "SET generationStatus = :s, updatedAt = :u",
        ExpressionAttributeValues: { ":s": "failed", ":u": failedAt },
      })
    );
  }
}

// ---- Main generate handler ----
async function generateCharacters(event: APIGatewayProxyEvent) {
  // Step 1: Auth check (Requirements 1.2)
  const userId = getUserId(event);
  if (!userId) return errorResponse("UNAUTHORIZED", "認証が必要です");

  // Step 2: Parse body
  const projectId = event.pathParameters?.projectId;
  if (!projectId) return errorResponse("INVALID_REQUEST", "projectId が必要です");

  let body: { count?: number };
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return errorResponse("INVALID_REQUEST", "リクエストボディが不正です");
  }

  const count = body.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
    return errorResponse("INVALID_REQUEST", "count は1以上の整数である必要があります");
  }

  // Step 3: Get project from Projects_Table (worldSetting + maxCharacters)
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
  const maxCharacters: number = projectResult.Item.maxCharacters ?? 10;

  // Step 4: Count existing characters
  const existingResult = await ddb.send(
    new QueryCommand({
      TableName: CHARACTERS_TABLE,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: { ":pk": `project#${projectId}` },
      Select: "COUNT",
    })
  );
  const existingCount = existingResult.Count ?? 0;

  // Step 5: maxCharacters check (Requirements 3.4, 11.3)
  if (existingCount + count > maxCharacters) {
    return errorResponse(
      "MAX_CHARACTERS_EXCEEDED",
      `キャラクター数の上限（${maxCharacters}）を超えています`
    );
  }

  // Step 6: Rate limit check (Requirements 3.5, 11.2)
  const today = todayString();
  const rateLimitPK = `rateLimit#${userId}`;
  const rateLimitSK = `date#${today}`;

  const rateLimitResult = await ddb.send(
    new GetCommand({
      TableName: CHARACTERS_TABLE,
      Key: { PK: rateLimitPK, SK: rateLimitSK },
    })
  );
  const currentRateCount: number = rateLimitResult.Item?.count ?? 0;

  // Step 7: Rate limit exceeded check
  if (currentRateCount >= 100) {
    return errorResponse("RATE_LIMIT_EXCEEDED", "本日の生成回数上限（100回）に達しました");
  }

  // Step 8: Generate N characters with random attributes, save as pending (Requirements 3.1, 3.3, 3.6)
  const now = new Date().toISOString();
  const characters: Array<{
    characterId: string;
    gender: string;
    personality: string;
    age: string;
    species: string;
    occupation: string;
    hairColor: string;
    skinColor: string;
  }> = [];

  for (let i = 0; i < count; i++) {
    const characterId = ulid();
    const attrs = {
      gender: pickRandom(ATTRIBUTE_OPTIONS.gender),
      personality: pickRandom(ATTRIBUTE_OPTIONS.personality),
      age: pickRandom(ATTRIBUTE_OPTIONS.age),
      species: pickRandom(ATTRIBUTE_OPTIONS.species),
      occupation: pickRandom(ATTRIBUTE_OPTIONS.occupation),
      hairColor: pickRandom(ATTRIBUTE_OPTIONS.hairColor),
      skinColor: pickRandom(ATTRIBUTE_OPTIONS.skinColor),
    };

    await ddb.send(
      new PutCommand({
        TableName: CHARACTERS_TABLE,
        Item: {
          PK: `project#${projectId}`,
          SK: `character#${characterId}`,
          characterId,
          ...attrs,
          specialNotes: "",
          background: "",
          generationStatus: "pending",
          createdAt: now,
          updatedAt: now,
        },
      })
    );

    characters.push({ characterId, ...attrs });
  }

  // Step 9: Increment rate limit counter with TTL (Requirements 3.5)
  const ttl = nextDayMidnightEpoch();
  await ddb.send(
    new UpdateCommand({
      TableName: CHARACTERS_TABLE,
      Key: { PK: rateLimitPK, SK: rateLimitSK },
      UpdateExpression: "ADD #count :inc SET #ttl = :ttl",
      ExpressionAttributeNames: { "#count": "count", "#ttl": "TTL" },
      ExpressionAttributeValues: { ":inc": count, ":ttl": ttl },
    })
  );

  const characterIds = characters.map((c) => c.characterId);

  // Step 11: Kick off background Bedrock processing (don't await — Lambda continues after response)
  // Requirements 4.1, 4.5, 4.6, 4.7
  Promise.allSettled(
    characters.map((c) =>
      processCharacterBackground(c.characterId, projectId, worldSetting, {
        gender: c.gender,
        personality: c.personality,
        age: c.age,
        species: c.species,
        occupation: c.occupation,
        hairColor: c.hairColor,
        skinColor: c.skinColor,
      })
    )
  ).catch((err: unknown) => console.error("Background processing error:", err));

  // Step 10: Return characterIds immediately (Requirements 3.2)
  return {
    statusCode: 201,
    headers: CORS_HEADERS,
    body: JSON.stringify({ characterIds }),
  };
}

// ---- Main handler ----
export const handler: APIGatewayProxyHandler = async (event) => {
  const method = event.httpMethod;
  const path = event.resource ?? event.path;

  try {
    if (
      method === "POST" &&
      path === "/projects/{projectId}/characters/generate"
    ) {
      return await generateCharacters(event);
    }

    return errorResponse("NOT_FOUND", "エンドポイントが見つかりません");
  } catch (err) {
    console.error("Unhandled error:", err);
    return errorResponse("INTERNAL_ERROR", "内部エラーが発生しました");
  }
};
