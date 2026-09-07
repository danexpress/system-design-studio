# AWS deployment

The CloudFormation stack runs the app on ARM64 ECS Fargate behind an Application
Load Balancer and stores application data in a private RDS PostgreSQL instance.
Container images are kept in ECR. Database and JWT secrets are generated in AWS
Secrets Manager and injected into the task at runtime.

Deploy using the configured AWS CLI account and region:

```sh
make aws-deploy
```

Defaults can be overridden:

```sh
AWS_REGION=us-west-2 STACK_NAME=system-design-studio make aws-deploy
```

The script creates the stack with zero tasks on its first run, pushes the image
to the newly created ECR repository, updates the service to one task, waits for
ECS to stabilize, and prints the public URL.

This stack creates billable resources, including an Application Load Balancer,
an ECS Fargate task, RDS PostgreSQL, CloudWatch Logs, ECR, and Secrets Manager.
RDS snapshots and the ECR repository are retained if the stack is deleted.

## GitHub Actions OIDC

The CI/CD workflow uses short-lived AWS credentials issued through GitHub OIDC.
Bootstrap the account once, then store its output as a repository variable:

```sh
aws cloudformation deploy \
  --stack-name system-design-studio-github-oidc \
  --template-file infra/github-oidc.yaml \
  --capabilities CAPABILITY_IAM

role_arn="$(aws cloudformation describe-stacks \
  --stack-name system-design-studio-github-oidc \
  --query "Stacks[0].Outputs[?OutputKey=='RoleArn'].OutputValue" \
  --output text)"
gh variable set AWS_DEPLOY_ROLE_ARN --body "$role_arn"
```

The trust policy only accepts runs from the `main` branch of
`danexpress/system-design-studio`. It includes GitHub's immutable organization
and repository IDs because this organization uses a customized OIDC subject
template. Pull requests run tests but cannot assume the deployment role.
