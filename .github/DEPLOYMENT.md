# Deployment Pipeline

## Architecture

```
master push ─→ build ─→ S3 (prod) ─→ CloudFront invalidation ─→ Slack
PR open/sync ─→ build ─→ S3 (staging/pr-N/) ─→ PR comment with preview URL
PR close    ─→ S3 rm staging/pr-N/
```

## Environments

| Environment | S3 Bucket | CloudFront | Trigger |
|---|---|---|---|
| **Production** | `campusgeo-frontend-prod-<account>` | Prod distribution | Push to `master` |
| **Staging** | `campusgeo-frontend-staging-<account>` | Staging distribution | PR open/sync |

Staging uses prefix-per-PR layout: `/pr-42/index.html`. Objects auto-expire after 30 days.

## Required GitHub Secrets

Configure these in **Settings → Secrets and variables → Actions**:

| Secret | Description | Example |
|---|---|---|
| `AWS_ACCOUNT_ID` | AWS account number | `491117467175` |
| `AWS_DEPLOY_ROLE_ARN` | OIDC role for GitHub Actions | `arn:aws:iam::491117467175:role/github-actions-deploy` |
| `CLOUDFRONT_PROD_DISTRIBUTION_ID` | Production CF distribution | `E3J65QFHW23IJZ` |
| `CLOUDFRONT_STAGING_DISTRIBUTION_ID` | Staging CF distribution | (from CDK output) |
| `SLACK_WEBHOOK_URL` | Incoming webhook for deploy notifications | `https://hooks.slack.com/services/...` |

## Required GitHub Environments

Create two environments in **Settings → Environments**:

1. **production** — add required reviewers if desired
2. **staging** — no restrictions needed

## AWS IAM Role Setup (OIDC)

Create an IAM role that GitHub Actions can assume via OIDC (no long-lived credentials):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:SANABI-LL/CGA:*"
        }
      }
    }
  ]
}
```

Attach a policy allowing:
- `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on both frontend buckets
- `cloudfront:CreateInvalidation`, `cloudfront:GetDistribution` on both distributions

## Provisioning Staging Infra

```bash
cd infra/cdk
npm run build
npx cdk deploy CampusGeoStaging
# Note the outputs: StagingDistributionId, StagingBucketName, StagingUrl
```

## Local Verification

To test the build locally before relying on CI:

```bash
node scripts/build-with-backend.mjs
# Outputs: CampusGeo-with-Backend.html
```
