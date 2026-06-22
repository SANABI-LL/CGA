import * as cdk from 'aws-cdk-lib'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import { Construct } from 'constructs'

interface AuthStackProps extends cdk.StackProps {
  stage: string
}

export class AuthStack extends cdk.Stack {
  public readonly userPool: cognito.UserPool
  public readonly userPoolClient: cognito.UserPoolClient

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props)

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `campusgeo-users-${props.stage}`,
      signInAliases: { email: true },
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireDigits: true,
        requireUppercase: false,
        requireSymbols: false,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy:
        props.stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    })

    const callbackUrls =
      props.stage === 'prod'
        ? ['https://campusgeo.uchicago.edu/auth/callback']
        : ['http://localhost:5173/auth/callback', 'http://localhost:5174/auth/callback']

    this.userPoolClient = this.userPool.addClient('WebClient', {
      userPoolClientName: `campusgeo-web-${props.stage}`,
      authFlows: { userSrp: true, userPassword: false },
      generateSecret: false,
      oAuth: {
        flows: { authorizationCodeGrant: true },
        callbackUrls,
        logoutUrls:
          props.stage === 'prod'
            ? ['https://campusgeo.uchicago.edu']
            : ['http://localhost:5173', 'http://localhost:5174'],
      },
      accessTokenValidity: cdk.Duration.hours(8),
      refreshTokenValidity: cdk.Duration.days(30),
    })

    // Output values for frontend configuration
    new cdk.CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId })
    new cdk.CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId })
  }
}
