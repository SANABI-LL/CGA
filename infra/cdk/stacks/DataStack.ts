import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as s3 from 'aws-cdk-lib/aws-s3'
import { Construct } from 'constructs'

interface DataStackProps extends cdk.StackProps {
  stage: string
}

export class DataStack extends cdk.Stack {
  public readonly queryTable: dynamodb.Table
  public readonly bookmarkTable: dynamodb.Table
  public readonly geodataBucket: s3.Bucket
  public readonly layersTable: dynamodb.Table

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props)

    // GeoJSON 数据存储桶（自托管数据架构）
    this.geodataBucket = new s3.Bucket(this, 'GeodataBucket', {
      bucketName: `campusgeo-geodata-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      lifecycleRules: [
        {
          id: 'delete-old-versions',
          noncurrentVersionExpiration: cdk.Duration.days(90),
        },
      ],
      removalPolicy: props.stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: props.stage !== 'prod',
    })

    // 图层元数据表（全局共享，不分 stage）
    this.layersTable = new dynamodb.Table(this, 'LayersTable', {
      tableName: 'campusgeo-geojson-layers',
      partitionKey: { name: 'layerId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecovery: true,
    })

    this.layersTable.addGlobalSecondaryIndex({
      indexName: 'category-index',
      partitionKey: { name: 'category', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'priority', type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    })

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
