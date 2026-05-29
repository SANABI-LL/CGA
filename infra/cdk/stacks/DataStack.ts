import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import { Construct } from 'constructs'

interface DataStackProps extends cdk.StackProps {
  stage: string
}

export class DataStack extends cdk.Stack {
  public readonly queryTable: dynamodb.Table
  public readonly bookmarkTable: dynamodb.Table

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props)

    this.queryTable = new dynamodb.Table(this, 'QueryTable', {
      tableName: `campusgeo-queries-${props.stage}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'queryId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy:
        props.stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    })

    // GSI for session-based lookups
    this.queryTable.addGlobalSecondaryIndex({
      indexName: 'by-session',
      partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.NUMBER },
    })

    this.bookmarkTable = new dynamodb.Table(this, 'BookmarkTable', {
      tableName: `campusgeo-bookmarks-${props.stage}`,
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'bookmarkId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy:
        props.stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    })
  }
}
