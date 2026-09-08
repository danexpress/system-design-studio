#!/usr/bin/env bash
set -euo pipefail

stack_name="${STACK_NAME:-system-design-studio}"
aws_region="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-west-2}}"
repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
short_sha="$(git -C "$repository_root" rev-parse --short=7 HEAD)"
image_tag="${IMAGE_TAG:-$(date -u +%Y%m%d-%H%M%S)-${short_sha}}"

if [[ ! "$image_tag" =~ ^[0-9]{8}-[0-9]{6}-[0-9a-f]{7}$ ]]; then
  echo "Image tag must use YYYYMMDD-HHMMSS-shortsha format: ${image_tag}" >&2
  exit 1
fi

repository_uri="$(aws cloudformation describe-stacks \
  --stack-name "$stack_name" \
  --region "$aws_region" \
  --query "Stacks[0].Outputs[?OutputKey=='RepositoryUri'].OutputValue" \
  --output text)"

if [[ -z "$repository_uri" || "$repository_uri" == "None" ]]; then
  echo "Stack ${stack_name} does not expose an ECR repository" >&2
  exit 1
fi

registry="${repository_uri%%/*}"
image_uri="${repository_uri}:${image_tag}"

aws ecr get-login-password --region "$aws_region" | \
  docker login --username AWS --password-stdin "$registry" >&2

echo "Building and pushing ${image_uri}..." >&2
docker buildx build \
  --platform linux/arm64 \
  --tag "$image_uri" \
  --push \
  "$repository_root" >&2

if [[ -n "${IMAGE_URI_FILE:-}" ]]; then
  printf '%s\n' "$image_uri" >"$IMAGE_URI_FILE"
fi
printf '%s\n' "$image_uri"
