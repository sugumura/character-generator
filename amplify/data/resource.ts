import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

/**
 * DynamoDBテーブルスキーマ定義
 * Requirements: 2.6, 2.7, 3.7, 6.5, 7.4, 12.3
 *
 * Projects_Table:   PK: userId,                              SK: project#{projectId}
 * Characters_Table: PK: project#{projectId},                 SK: character#{characterId}
 *                   GSI1: PK: project#{projectId},           SK: createdAt
 * Relationships_Table: PK: project#{projectId}#character#{characterIdA}, SK: relation#{characterIdB}
 *
 * Note: Amplify Gen2 defineData uses a model-based schema. The actual DynamoDB key patterns
 * (composite PK/SK with prefixes) are managed by the Lambda functions directly via the
 * AWS SDK. The models below define the attribute shapes and authorization rules.
 */

const schema = a.schema({
  // Projects_Table
  Project: a
    .model({
      // PK: userId (from Cognito identity), SK: project#{projectId}
      projectId: a.string().required(),
      projectName: a.string().required(),
      worldSetting: a.string().required(),
      maxCharacters: a.integer().required(),
      createdAt: a.string(),
      updatedAt: a.string(),
    })
    .authorization((allow) => [allow.owner()]),

  // Characters_Table
  Character: a
    .model({
      // PK: project#{projectId}, SK: character#{characterId}
      characterId: a.string().required(),
      projectId: a.string().required(),
      gender: a.string(),
      personality: a.string(),
      age: a.string(),
      species: a.string(),
      occupation: a.string(),
      hairColor: a.string(),
      skinColor: a.string(),
      specialNotes: a.string(),
      background: a.string(),
      generationStatus: a
        .enum(["pending", "generating", "completed", "failed"]),
      createdAt: a.string(),
      updatedAt: a.string(),
    })
    .authorization((allow) => [allow.owner()]),

  // Relationships_Table
  Relationship: a
    .model({
      // PK: project#{projectId}#character#{characterIdA}, SK: relation#{characterIdB}
      relationshipId: a.string().required(),
      projectId: a.string().required(),
      characterIdA: a.string().required(),
      characterIdB: a.string().required(),
      relationshipType: a.string().required(),
      description: a.string(),
    })
    .authorization((allow) => [allow.owner()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
