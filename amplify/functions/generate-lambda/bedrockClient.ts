import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

/**
 * Bedrock_Client - Amazon Bedrockを使用してキャラクターのバックグラウンドストーリーと関係性を生成する
 * Requirements: 4.1, 4.2, 4.3, 4.8, 3.8, 3.9
 */

const MODEL_ID = "amazon.nova-lite-v1:0";
const REGION = "ap-northeast-1";

const client = new BedrockRuntimeClient({ region: REGION });

export interface GenerateBackgroundParams {
  worldSetting: string;
  character: {
    gender: string;
    personality: string;
    age: string;
    species: string;
    occupation: string;
    hairColor: string;
    skinColor: string;
  };
}

/**
 * キャラクターのバックグラウンドストーリーを生成する (Converse API)
 */
export async function generateBackground(
  params: GenerateBackgroundParams
): Promise<string> {
  const { worldSetting, character } = params;

  // Requirements 4.2: システムプロンプトにworldSettingを埋め込む
  const systemPrompt = `あなたはゲームキャラクターのバックグラウンドストーリーを作成する専門家です。以下の世界観に基づいてキャラクターのバックグラウンドを作成してください。世界観: ${worldSetting} 制約: 日本語で300文字程度。キャラクターの過去・動機・目標を含めること。`;

  const userMessage = `以下のキャラクター属性に基づいてバックグラウンドストーリーを作成してください。
性別: ${character.gender}
性格: ${character.personality}
年代: ${character.age}
種族: ${character.species}
職業: ${character.occupation}
髪色: ${character.hairColor}
肌色: ${character.skinColor}`;

  const command = new ConverseCommand({
    modelId: MODEL_ID,
    system: [{ text: systemPrompt }],
    messages: [{ role: "user", content: [{ text: userMessage }] }],
    inferenceConfig: { maxTokens: 500 },
  });

  const response = await client.send(command);
  const text = response.output?.message?.content?.[0]?.text;
  if (!text) throw new Error("No text in Bedrock response");
  return text;
}

export interface CharacterAttrs {
  characterId: string;
  gender: string;
  personality: string;
  age: string;
  species: string;
  occupation: string;
  hairColor: string;
  skinColor: string;
}

export interface GeneratedRelationship {
  relationshipType: string;
  description: string;
}

const RELATIONSHIP_TYPES = ["仲間", "ライバル", "師弟", "恋人", "家族", "敵対"];

/**
 * 2体のキャラクター間の関係性をBedrockで生成する (Requirements 3.9)
 */
export async function generateRelationship(
  worldSetting: string,
  charA: CharacterAttrs,
  charB: CharacterAttrs
): Promise<GeneratedRelationship> {
  const userMessage = `以下の2人のキャラクターの関係性を決めてください。

世界観: ${worldSetting}

キャラクターA:
- 性別: ${charA.gender} / 性格: ${charA.personality} / 年代: ${charA.age}
- 種族: ${charA.species} / 職業: ${charA.occupation}

キャラクターB:
- 性別: ${charB.gender} / 性格: ${charB.personality} / 年代: ${charB.age}
- 種族: ${charB.species} / 職業: ${charB.occupation}

以下のJSON形式のみで回答してください（説明不要）:
{"relationshipType": "<${RELATIONSHIP_TYPES.join(" | ")}>", "description": "<50文字程度の日本語説明>"}`;

  const command = new ConverseCommand({
    modelId: MODEL_ID,
    messages: [{ role: "user", content: [{ text: userMessage }] }],
    inferenceConfig: { maxTokens: 200 },
  });

  const response = await client.send(command);
  const text = response.output?.message?.content?.[0]?.text;
  if (!text) throw new Error("No text in Bedrock response");

  // JSON部分を抽出してパース
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("No JSON found in Bedrock response");
  const parsed = JSON.parse(match[0]) as GeneratedRelationship;

  // relationshipType が有効値かチェック、無効なら「仲間」にフォールバック
  if (!RELATIONSHIP_TYPES.includes(parsed.relationshipType)) {
    parsed.relationshipType = "仲間";
  }

  return parsed;
}
