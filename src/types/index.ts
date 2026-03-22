// generationStatus state machine: pending → generating → completed/failed
export type GenerationStatus = "pending" | "generating" | "completed" | "failed";

export type RelationshipType = "仲間" | "ライバル" | "師弟" | "恋人" | "家族" | "敵対";

export interface Project {
  projectId: string;
  projectName: string;
  worldSetting: string;
  maxCharacters: number;
  createdAt: string; // ISO8601
  updatedAt: string; // ISO8601
}

export interface Character {
  characterId: string;
  gender: string;
  personality: string;
  age: string;
  species: string;
  occupation: string;
  hairColor: string;
  skinColor: string;
  specialNotes: string; // max 200 chars
  background?: string;
  generationStatus: GenerationStatus;
  createdAt: string; // ISO8601
  updatedAt: string; // ISO8601
}

export interface Relationship {
  relationshipId: string;
  projectId: string;
  characterIdA: string;
  characterIdB: string;
  relationshipType: RelationshipType;
  description: string;
}

// Error response types
export type ErrorCode =
  | "MAX_CHARACTERS_EXCEEDED"
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMIT_EXCEEDED"
  | "INTERNAL_ERROR"
  | "BEDROCK_UNAVAILABLE";

export interface ErrorDetail {
  code: ErrorCode;
  message: string;
}

export interface ErrorResponse {
  error: ErrorDetail;
}

// Generic API response wrapper
export interface ApiResponse<T> {
  data: T;
}
