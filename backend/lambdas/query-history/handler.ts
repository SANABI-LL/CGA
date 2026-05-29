import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'

const TABLE_NAME = process.env.TABLE_NAME!
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*'

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}))

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Content-Type': 'application/json',
  }
}

function getUserId(event: APIGatewayProxyEventV2): string {
  // In production, extract from Cognito JWT claims
  // For now, use session ID from header or anonymous
  return event.headers?.['x-user-id'] ?? `anon-${event.requestContext.http.sourceIp?.replace(/\./g, '-') ?? 'unknown'}`
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  if (event.requestContext.http.method === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders(), body: '' }
  }

  const method = event.requestContext.http.method
  const userId = getUserId(event)

  if (method === 'GET') {
    const result = await ddb.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': userId },
      ScanIndexForward: false,
      Limit: 50,
    }))

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ queries: result.Items ?? [] }),
    }
  }

  if (method === 'POST') {
    const body = JSON.parse(event.body ?? '{}') as {
      queryId?: string
      queryText?: string
      aiResponse?: string
      sessionId?: string
    }

    const item = {
      userId,
      queryId: body.queryId ?? `q-${Date.now()}`,
      queryText: body.queryText ?? '',
      aiResponse: body.aiResponse ?? '',
      sessionId: body.sessionId ?? 'unknown',
      timestamp: Date.now(),
      ttl: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 days TTL
    }

    await ddb.send(new PutCommand({ TableName: TABLE_NAME, Item: item }))
    return { statusCode: 201, headers: corsHeaders(), body: JSON.stringify(item) }
  }

  if (method === 'DELETE') {
    const queryId = event.pathParameters?.queryId
    if (!queryId) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'queryId required' }) }
    }

    await ddb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { userId, queryId },
    }))

    return { statusCode: 204, headers: corsHeaders(), body: '' }
  }

  return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) }
}
