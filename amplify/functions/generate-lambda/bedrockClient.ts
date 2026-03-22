import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";

/**
 * Bedrock_Client - Amazon Bedrockを使用してキャラクターのバックグラウンドストーリーを生成する
 * Requirements: 4.1, 4.2, 4.3, 4.8
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
