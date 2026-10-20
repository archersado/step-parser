#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

image="${IMAGE:-step2gltf-service:latest}"
platforms="${PLATFORMS:-linux/amd64}"
jobs="${BUILD_JOBS:-4}"
version="${VERSION:-$(git describe --always --dirty 2>/dev/null || printf dev)}"

args=(
  buildx build
  --platform "$platforms"
  --build-arg "BUILD_JOBS=$jobs"
  --build-arg "VERSION=$version"
  --tag "$image"
)

if [[ "$platforms" == *,* ]]; then
  args+=(--push)
else
  args+=(--load)
fi

docker "${args[@]}" .
