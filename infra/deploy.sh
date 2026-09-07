#!/usr/bin/env bash
set -euo pipefail

stack_name="${STACK_NAME:-system-design-studio}"
aws_region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-west-2}}"
template_file="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/cloudformation.yaml"
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
image_tag="${IMAGE_TAG:-$(git -C "$repository_root" rev-parse --short=12 HEAD)}"

stack_exists=false
if aws cloudformation describe-stacks --stack-name "$stack_name" --region "$aws_region" >/dev/null 2>&1; then
  stack_exists=true
fi

if [[ "$stack_exists" == false ]]; then
  echo "Creating the infrastructure (the initial RDS database can take several minutes)..."
  aws cloudformation deploy \
    --stack-name "$stack_name" \
    --region "$aws_region" \
    --template-file "$template_file" \
    --capabilities CAPABILITY_IAM \
    --parameter-overrides \
      DesiredCount=0 \
      ImageUri=public.ecr.aws/docker/library/python:3.13-slim \
    --no-fail-on-empty-changeset
fi

repository_uri="$(aws cloudformation describe-stacks \
  --stack-name "$stack_name" \
  --region "$aws_region" \
  --query "Stacks[0].Outputs[?OutputKey=='RepositoryUri'].OutputValue" \
  --output text)"
registry="${repository_uri%%/*}"
image_uri="${repository_uri}:${image_tag}"

aws ecr get-login-password --region "$aws_region" | \
  docker login --username AWS --password-stdin "$registry"

echo "Building and pushing ${image_uri}..."
docker buildx build \
  --platform linux/arm64 \
  --tag "$image_uri" \
  --push \
  "$repository_root"

echo "Deploying the application task..."
aws cloudformation deploy \
  --stack-name "$stack_name" \
  --region "$aws_region" \
  --template-file "$template_file" \
  --capabilities CAPABILITY_IAM \
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
