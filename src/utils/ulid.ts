import { ulid } from "ulid";

/**
 * Generate a new ULID string.
 * ULIDs are lexicographically sortable and URL-safe.
 */
export function generateUlid(): string {
  return ulid();
}
