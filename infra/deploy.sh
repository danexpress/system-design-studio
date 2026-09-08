#!/usr/bin/env bash
set -euo pipefail

stack_name="${STACK_NAME:-system-design-studio}"
deployment_environment="${DEPLOY_ENVIRONMENT:-development}"
aws_region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-west-2}}"
template_file="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cloudformation.yaml"
image_uri="${IMAGE_URI:?Set IMAGE_URI to an image already pushed to ECR}"

echo "Deploying ${image_uri}; ECS will pull it from ECR..."
aws cloudformation deploy \
  --stack-name "$stack_name" \
  --region "$aws_region" \
  --template-file "$template_file" \
  --capabilities CAPABILITY_IAM \
  --tags Application=system-design-studio Environment="$deployment_environment" \
  --parameter-overrides \
    DesiredCount=1 \
    ImageUri="$image_uri" \
  --no-fail-on-empty-changeset

cluster_name="$(aws cloudformation describe-stacks \
  --stack-name "$stack_name" \
  --region "$aws_region" \
  --query "Stacks[0].Outputs[?OutputKey=='ClusterName'].OutputValue" \
  --output text)"
service_name="$(aws cloudformation describe-stacks \
  --stack-name "$stack_name" \
  --region "$aws_region" \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceName'].OutputValue" \
  --output text)"

aws ecs wait services-stable \
  --cluster "$cluster_name" \
  --services "$service_name" \
  --region "$aws_region"

aws cloudformation describe-stacks \
  --stack-name "$stack_name" \
  --region "$aws_region" \
  --query "Stacks[0].Outputs[?OutputKey=='ApplicationUrl'].OutputValue" \
  --output text
