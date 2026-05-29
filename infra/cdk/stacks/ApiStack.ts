import * as cdk from 'aws-cdk-lib'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as path from 'path'
import { Construct } from 'constructs'

interface ApiStackProps extends cdk.StackProps {
  stage: string
  userPool: cognito.UserPool
  queryTable: dynamodb.Table
  bookmarkTable: dynamodb.Table
}

export class ApiStack extends cdk.Stack {
  public readonly apiEndpoint: string

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props)

    const lambdaRoot = path.join(__dirname, '../../../backend/lambdas')

    // ── AI Agent Lambda (streaming) ──────────────────────────────
    const agentLambda = new lambda.Function(this, 'AiAgentFn', {
      functionName: `campusgeo-ai-agent-${props.stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(lambdaRoot, 'ai-agent')),
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: {
        BEDROCK_MODEL_ID:
          props.stage === 'prod'
            ? 'anthropic.claude-3-5-sonnet-20241022-v2:0'
            : 'anthropic.claude-3-haiku-20240307-v1:0',
        AWS_REGION: this.region,
        ALLOWED_ORIGIN: props.stage === 'prod' ? 'https://campusgeo.uchicago.edu' : '*',
        // TRANSLOC_API_KEY and TRANSLOC_AGENCY_ID injected via Secrets Manager in Phase 2
      },
    })

    // Grant Bedrock invoke permission
    agentLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [
          `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0`,
          `arn:aws:bedrock:${this.region}::foundation-model/anthropic.claude-3-haiku-20240307-v1:0`,
        ],
      })
    )

    // ── Query History Lambda ──────────────────────────────────────
    const queryHistoryLambda = new lambda.Function(this, 'QueryHistoryFn', {
      functionName: `campusgeo-query-history-${props.stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(lambdaRoot, 'query-history')),
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {
        TABLE_NAME: props.queryTable.tableName,
        ALLOWED_ORIGIN: props.stage === 'prod' ? 'https://campusgeo.uchicago.edu' : '*',
      },
    })
    props.queryTable.grantReadWriteData(queryHistoryLambda)

    // ── Bookmarks Lambda ─────────────────────────────────────────
    const bookmarksLambda = new lambda.Function(this, 'BookmarksFn', {
      functionName: `campusgeo-bookmarks-${props.stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(lambdaRoot, 'bookmarks')),
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
      environment: {
        TABLE_NAME: props.bookmarkTable.tableName,
        ALLOWED_ORIGIN: props.stage === 'prod' ? 'https://campusgeo.uchicago.edu' : '*',
      },
    })
    props.bookmarkTable.grantReadWriteData(bookmarksLambda)

    // ── ArcGIS Proxy Lambda ───────────────────────────────────────
    const arcgisProxyLambda = new lambda.Function(this, 'ArcGISProxyFn', {
      functionName: `campusgeo-arcgis-proxy-${props.stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(path.join(lambdaRoot, 'arcgis-proxy')),
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      environment: {
        ALLOWED_ORIGIN: props.stage === 'prod' ? 'https://campusgeo.uchicago.edu' : '*',
      },
    })

    // ── HTTP API Gateway v2 ───────────────────────────────────────
    const httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: `campusgeo-api-${props.stage}`,
      corsPreflight: {
        allowOrigins:
          props.stage === 'prod'
            ? ['https://campusgeo.uchicago.edu']
            : ['http://localhost:5173', 'http://localhost:5174', '*'],
        allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
        allowHeaders: ['Content-Type', 'Authorization'],
        maxAge: cdk.Duration.hours(1),
      },
    })

    // Routes
    httpApi.addRoutes({
      path: '/api/agent',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('AgentIntegration', agentLambda, {
        payloadFormatVersion: apigatewayv2.PayloadFormatVersion.VERSION_2_0,
      }),
    })

    httpApi.addRoutes({
      path: '/api/arcgis/{layer}',
      methods: [apigatewayv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('ArcGISIntegration', arcgisProxyLambda),
    })

    httpApi.addRoutes({
      path: '/api/queries',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('QueryHistoryIntegration', queryHistoryLambda),
    })

    httpApi.addRoutes({
      path: '/api/queries/{queryId}',
      methods: [apigatewayv2.HttpMethod.DELETE],
      integration: new integrations.HttpLambdaIntegration('QueryHistoryDeleteIntegration', queryHistoryLambda),
    })

    httpApi.addRoutes({
      path: '/api/bookmarks',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('BookmarksIntegration', bookmarksLambda),
    })

    httpApi.addRoutes({
      path: '/api/bookmarks/{bookmarkId}',
      methods: [apigatewayv2.HttpMethod.DELETE],
      integration: new integrations.HttpLambdaIntegration('BookmarksDeleteIntegration', bookmarksLambda),
    })

    this.apiEndpoint = httpApi.apiEndpoint

    new cdk.CfnOutput(this, 'ApiEndpoint', { value: httpApi.apiEndpoint })
  }
}
