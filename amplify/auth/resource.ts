import { defineAuth } from "@aws-amplify/backend";

/**
 * Cognito認証設定
 * Requirements: 1.4, 1.5, 12.2
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },
});
