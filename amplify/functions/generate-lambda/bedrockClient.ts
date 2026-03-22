import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

/**
 * Bedrock_Client - Amazon Bedrockを使用してキャラクターのバックグラウンドストーリーを生成する
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.8
 */

const MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0";
const REGION = "ap-northeast-1";

// IAMロールのデフォルト認証情報チェーンを使用（Secrets Manager不使用）
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
 * キャラクターのバックグラウンドストーリーを生成する
 * Prompt Cachingを活用してシステムプロンプト（worldSetting含む）をキャッシュする（Requirements 4.4）
 */
export async function generateBackground(
  params: GenerateBackgroundParams
): Promise<string> {
  const { worldSetting, character } = params;

  // Requirements 4.2: システムプロンプトにworldSettingを埋め込む
  const systemPromptText = `あなたはゲームキャラクターのバックグラウンドストーリーを作成する専門家です。以下の世界観に基づいてキャラクターのバックグラウンドを作成してください。世界観: ${worldSetting} 制約: 日本語で300文字程度。キャラクターの過去・動機・目標を含めること。`;

  const userMessage = `以下のキャラクター属性に基づいてバックグラウンドストーリーを作成してください。
性別: ${character.gender}
性格: ${character.personality}
年代: ${character.age}
種族: ${character.species}
職業: ${character.occupation}
髪色: ${character.hairColor}
肌色: ${character.skinColor}`;

  // Requirements 4.3: max_tokens=500
  // Requirements 4.4: Prompt Cachingのためにsystemプロンプトブロックにcache_controlを付与
  const requestBody = {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 500,
    system: [
      {
        type: "text",
        text: systemPromptText,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: userMessage,
      },
    ],
  };

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(requestBody),
  });

  const response = await client.send(command);

  const responseBody = JSON.parse(new TextDecoder().decode(response.body));
  const generatedText: string = responseBody.content[0].text;

  return generatedText;
}
