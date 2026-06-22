#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { FrontendStack } from '../stacks/FrontendStack'
import { ApiStack } from '../stacks/ApiStack'
import { AuthStack } from '../stacks/AuthStack'
import { DataStack } from '../stacks/DataStack'

const app = new cdk.App()
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1' }
const stage = app.node.tryGetContext('env') as string ?? 'dev'

// Always deploy DataStack
const dataStack = new DataStack(app, `CampusGeoData-${stage}`, { env, stage })

// Only deploy other stacks if explicitly requested (Phase 1: DataStack only)
const deployAll = app.node.tryGetContext('deployAll') === true

if (deployAll) {
  const authStack = new AuthStack(app, `CampusGeoAuth-${stage}`, { env, stage })
  const apiStack = new ApiStack(app, `CampusGeoApi-${stage}`, {
    env,
    stage,
    userPool: authStack.userPool,
    queryTable: dataStack.queryTable,
    bookmarkTable: dataStack.bookmarkTable,
  })
  new FrontendStack(app, `CampusGeoFrontend-${stage}`, {
    env,
    stage,
    apiEndpoint: apiStack.apiEndpoint,
  })
}
