import { defineAuth, secret } from "@aws-amplify/backend";

/**
 * Cognito認証設定
 * Requirements: 1.4, 1.5, 12.2
 * 認証方式: Googleソーシャルログイン（パスワード不要）
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
    externalProviders: {
      google: {
        clientId: secret("GOOGLE_CLIENT_ID"),
        clientSecret: secret("GOOGLE_CLIENT_SECRET"),
        scopes: ["email", "profile", "openid"],
      },
      callbackUrls: [
        "http://localhost:5173",
      ],
      logoutUrls: [
        "http://localhost:5173",
      ],
    },
  },
});
