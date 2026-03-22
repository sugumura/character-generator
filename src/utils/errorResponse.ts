import type { ErrorCode, ErrorResponse } from "../types/index.js";

/**
 * Build a standard error response object.
 */
export function createErrorResponse(code: ErrorCode, message: string): ErrorResponse {
  return { error: { code, message } };
}

/** HTTP status codes mapped to each error code */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  MAX_CHARACTERS_EXCEEDED: 400,
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMIT_EXCEEDED: 429,
  INTERNAL_ERROR: 500,
  BEDROCK_UNAVAILABLE: 503,
};
