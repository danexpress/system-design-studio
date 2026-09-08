# AWS deployment

The CloudFormation stack runs the app on ARM64 ECS Fargate behind an Application
Load Balancer and stores application data in a private RDS PostgreSQL instance.
Container images are kept in ECR. Database and JWT secrets are generated in AWS
Secrets Manager and injected into the task at runtime.

Build a development image, then deploy that already-published image as two
separate operations:

```sh
image_uri="$(make --no-print-directory aws-build-dev)"
make aws-deploy-dev IMAGE_URI="$image_uri"
```

Images use UTC `YYYYMMDD-HHMMSS-shortsha` tags, for example
`20260818-163457-83242da`. The deploy operation does not build an image: it
updates CloudFormation and ECS pulls the supplied image from ECR.

The default stacks are `system-design-studio` for development and
`system-design-studio-production` for production. Each stack owns a separate
VPC, load balancer, ECS service, ECR repository, RDS database, database secret,
and JWT secret. Stack names can be overridden:

```sh
image_uri="$(AWS_REGION=us-west-2 AWS_DEV_STACK=my-dev make --no-print-directory aws-build-dev)"
AWS_REGION=us-west-2 AWS_DEV_STACK=my-dev make aws-deploy-dev IMAGE_URI="$image_uri"
```

The CI/CD workflow expresses these as independent **Build image** and **Deploy**
jobs. The image URI is passed as a job output, so the deploy job serves exactly
the artifact produced by the build job.

The GitHub Actions pipeline deploys only the development stack automatically.
Routine production releases use the manual promotion workflow below. A direct
production deploy is available for recovery with
`make aws-deploy-production IMAGE_URI=<existing-production-ecr-image>`.

## Promote development to production

Run the **Promote dev to production** workflow manually from the GitHub Actions
page on the `main` branch. It reads the image reference currently deployed by the
development CloudFormation stack, copies that exact image into the independent
production ECR repository without rebuilding, updates the production stack,
waits for ECS stability, and checks `/api/health`.

The same promotion can be run locally:

```sh
make aws-promote-production
```

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

The trust policy accepts only the `development` and `production` GitHub
environments in `danexpress/system-design-studio`. It includes GitHub's
immutable organization and repository IDs because this organization uses a
customized OIDC subject template. The jobs themselves only run from `main`;
pull requests run tests but cannot assume the deployment role.
