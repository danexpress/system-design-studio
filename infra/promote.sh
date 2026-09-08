#!/usr/bin/env bash
set -euo pipefail

development_stack="${DEV_STACK_NAME:-system-design-studio}"
production_stack="${PRODUCTION_STACK_NAME:-system-design-studio-production}"
aws_region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-west-2}}"
template_file="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cloudformation.yaml"

development_image="$(aws cloudformation describe-stacks \
  --stack-name "$development_stack" \
  --region "$aws_region" \
  --query "Stacks[0].Parameters[?ParameterKey=='ImageUri'].ParameterValue" \
  --output text)"
development_repository="$(aws cloudformation describe-stacks \
  --stack-name "$development_stack" \
  --region "$aws_region" \
  --query "Stacks[0].Outputs[?OutputKey=='RepositoryUri'].OutputValue" \
  --output text)"
production_repository="$(aws cloudformation describe-stacks \
  --stack-name "$production_stack" \
  --region "$aws_region" \
  --query "Stacks[0].Outputs[?OutputKey=='RepositoryUri'].OutputValue" \
  --output text)"

if [[ "$development_image" != "$development_repository:"* ]]; then
  echo "Development stack image is not from its managed ECR repository" >&2
  exit 1
fi

source_tag="${development_image#${development_repository}:}"
production_image="${production_repository}:${source_tag}"
registry="${production_repository%%/*}"

aws ecr get-login-password --region "$aws_region" | \
  docker login --username AWS --password-stdin "$registry"

echo "Promoting ${development_image} to ${production_image} without rebuilding..."
docker buildx imagetools create --tag "$production_image" "$development_image"

aws cloudformation deploy \
  --stack-name "$production_stack" \
  --region "$aws_region" \
  --template-file "$template_file" \
  --capabilities CAPABILITY_IAM \
  --tags Application=system-design-studio Environment=production \
  --parameter-overrides \
    DesiredCount=1 \
    ImageUri="$production_image" \
  --no-fail-on-empty-changeset

cluster_name="$(aws cloudformation describe-stacks \
  --stack-name "$production_stack" \
  --region "$aws_region" \
  --query "Stacks[0].Outputs[?OutputKey=='ClusterName'].OutputValue" \
  --output text)"
service_name="$(aws cloudformation describe-stacks \
  --stack-name "$production_stack" \
  --region "$aws_region" \
  --query "Stacks[0].Outputs[?OutputKey=='ServiceName'].OutputValue" \
  --output text)"

aws ecs wait services-stable \
  --cluster "$cluster_name" \
  --services "$service_name" \
  --region "$aws_region"

aws cloudformation describe-stacks \
  --stack-name "$production_stack" \
  --region "$aws_region" \
  --query "Stacks[0].Outputs[?OutputKey=='ApplicationUrl'].OutputValue" \
  --output text
