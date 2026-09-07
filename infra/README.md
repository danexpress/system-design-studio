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
