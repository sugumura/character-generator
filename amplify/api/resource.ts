import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";

/**
 * Lambda関数の参照をまとめた型
 */
export interface ApiLambdaFunctions {
  projectLambda: lambda.IFunction;
  characterLambda: lambda.IFunction;
  generateLambda: lambda.IFunction;
  relationshipLambda: lambda.IFunction;
}

/**
 * API Gateway REST API を定義する
 *
 * - Cognito User Pool Authorizer をすべてのエンドポイントに適用 (Requirements 1.2, 1.3)
 * - UsagePlan でスロットリング 10 req/s/ユーザー を設定 (Requirement 11.1)
 *
 * @param scope       CDK Construct スコープ
 * @param userPoolArn Cognito User Pool の ARN
 * @param fns         各 Lambda 関数の参照
 */
export function defineApi(
  scope: Construct,
  userPoolArn: string,
  fns: ApiLambdaFunctions
): apigw.RestApi {
  // REST API
  const api = new apigw.RestApi(scope, "CharacterGeneratorApi", {
    restApiName: "character-generator-api",
    description: "Character Generator REST API",
    deployOptions: {
      stageName: "prod",
    },
    defaultCorsPreflightOptions: {
      allowOrigins: apigw.Cors.ALL_ORIGINS,
      allowMethods: apigw.Cors.ALL_METHODS,
      allowHeaders: ["Content-Type", "Authorization"],
    },
  });

  // Cognito Authorizer (Requirements 1.2, 1.3)
  const userPool = cognito.UserPool.fromUserPoolArn(
    scope,
    "ImportedUserPool",
    userPoolArn
  );
  const authorizer = new apigw.CognitoUserPoolsAuthorizer(
    scope,
    "CognitoAuthorizer",
    {
      cognitoUserPools: [userPool],
      authorizerName: "CognitoAuthorizer",
      identitySource: "method.request.header.Authorization",
    }
  );

  // 認証必須のメソッドオプション
  const authMethodOptions: apigw.MethodOptions = {
    authorizer,
    authorizationType: apigw.AuthorizationType.COGNITO,
  };

  // Lambda インテグレーション
  const projectIntegration = new apigw.LambdaIntegration(fns.projectLambda);
  const characterIntegration = new apigw.LambdaIntegration(fns.characterLambda);
  const generateIntegration = new apigw.LambdaIntegration(fns.generateLambda);
  const relationshipIntegration = new apigw.LambdaIntegration(fns.relationshipLambda);

  // /projects
  const projects = api.root.addResource("projects");
  projects.addMethod("POST", projectIntegration, authMethodOptions);
  projects.addMethod("GET", projectIntegration, authMethodOptions);

  // /projects/{projectId}
  const project = projects.addResource("{projectId}");
  project.addMethod("GET", projectIntegration, authMethodOptions);
  project.addMethod("DELETE", projectIntegration, authMethodOptions);

  // /projects/{projectId}/characters
  const characters = project.addResource("characters");
  characters.addMethod("GET", characterIntegration, authMethodOptions);

  // /projects/{projectId}/characters/generate
  const generate = characters.addResource("generate");
  generate.addMethod("POST", generateIntegration, authMethodOptions);

  // /projects/{projectId}/characters/{characterId}
  const character = characters.addResource("{characterId}");
  character.addMethod("GET", characterIntegration, authMethodOptions);
  character.addMethod("PUT", characterIntegration, authMethodOptions);
  character.addMethod("DELETE", characterIntegration, authMethodOptions);

  // /projects/{projectId}/characters/{characterId}/regenerate
  const regenerate = character.addResource("regenerate");
  regenerate.addMethod("POST", characterIntegration, authMethodOptions);

  // /projects/{projectId}/relationships
  const relationships = project.addResource("relationships");
  relationships.addMethod("POST", relationshipIntegration, authMethodOptions);
  relationships.addMethod("GET", relationshipIntegration, authMethodOptions);

  // /projects/{projectId}/relationships/{relationshipId}
  const relationship = relationships.addResource("{relationshipId}");
  relationship.addMethod("DELETE", relationshipIntegration, authMethodOptions);

  // UsagePlan: スロットリング 10 req/s/ユーザー (Requirement 11.1)
  const usagePlan = api.addUsagePlan("DefaultUsagePlan", {
    name: "DefaultUsagePlan",
    throttle: {
      rateLimit: 10,   // 10 req/s
      burstLimit: 20,  // バースト上限
    },
  });
  usagePlan.addApiStage({
    stage: api.deploymentStage,
  });

  return api;
}
