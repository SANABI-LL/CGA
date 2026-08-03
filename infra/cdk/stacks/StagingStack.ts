import * as cdk from 'aws-cdk-lib'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import { Construct } from 'constructs'

/**
 * Staging environment for PR preview deployments.
 *
 * Unlike prod (one index.html at root), staging uses a prefix-per-PR layout:
 *   s3://campusgeo-frontend-staging-<account>/pr-42/index.html
 *
 * CloudFront rewrites /pr-N/ → /pr-N/index.html so each PR is a self-contained
 * mini-deployment accessible at https://<cf-domain>/pr-42/
 *
 * GitHub Actions handles upload/cleanup; this stack only provisions infra.
 */
export class StagingStack extends cdk.Stack {
  public readonly bucketName: string
  public readonly distributionId: string
  public readonly distributionDomain: string

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const bucket = new s3.Bucket(this, 'StagingBucket', {
      bucketName: `campusgeo-frontend-staging-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        { expiration: cdk.Duration.days(30) },
      ],
    })

    const rewriteFn = new cloudfront.Function(this, 'StagingRewriteFn', {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var req = event.request;
  var uri = req.uri;
  // /pr-42/ → /pr-42/index.html
  if (uri.match(/^\\/pr-\\d+\\/?$/) || (uri.match(/^\\/pr-\\d+\\//) && !uri.includes('.'))) {
    var prefix = uri.match(/^\\/pr-\\d+/)[0];
    req.uri = prefix + '/index.html';
  }
  return req;
}
      `),
    })

    const distribution = new cloudfront.Distribution(this, 'StagingDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        functionAssociations: [
          {
            function: rewriteFn,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      defaultRootObject: 'index.html',
    })

    this.bucketName = bucket.bucketName
    this.distributionId = distribution.distributionId
    this.distributionDomain = distribution.distributionDomainName

    new cdk.CfnOutput(this, 'StagingUrl', {
      value: `https://${distribution.distributionDomainName}`,
    })
    new cdk.CfnOutput(this, 'StagingBucketName', { value: bucket.bucketName })
    new cdk.CfnOutput(this, 'StagingDistributionId', { value: distribution.distributionId })
  }
}
