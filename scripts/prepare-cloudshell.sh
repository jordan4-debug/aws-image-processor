#!/usr/bin/env bash
set -euo pipefail
task_tools="$HOME/image-processor-tools"
mkdir -p "$task_tools"
terraform_version="1.16.2"
if [ ! -x "$task_tools/terraform" ]; then
  curl -fsSL "https://releases.hashicorp.com/terraform/${terraform_version}/terraform_${terraform_version}_linux_amd64.zip" -o "$task_tools/terraform.zip"
  curl -fsSL "https://releases.hashicorp.com/terraform/${terraform_version}/terraform_${terraform_version}_SHA256SUMS" -o "$task_tools/SHA256SUMS"
  task_expected=$(awk '/linux_amd64.zip$/ {print $1}' "$task_tools/SHA256SUMS")
  printf '%s  %s\n' "$task_expected" "$task_tools/terraform.zip" | sha256sum -c -
  unzip -o "$task_tools/terraform.zip" -d "$task_tools"
fi
export PATH="$task_tools:$PATH"
export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION=us-east-1
export AWS_PAGER=""
export TF_PLUGIN_CACHE_DIR=/tmp/image-processor-provider-cache
mkdir -p "$TF_PLUGIN_CACHE_DIR"
aws sts get-caller-identity
npm ci --no-audit --no-fund
npm --prefix src/upload ci --no-audit --no-fund
npm --prefix src/crop ci --include=optional --no-audit --no-fund
npm test
# .build puede venir incluido en el paquete preparado en Windows; recompilar es opcional.
if [ ! -f .build/upload.zip ] || [ ! -f .build/crop.zip ]; then npm run build; fi
for task_environment in dev qa prod; do
  terraform -chdir="terraform/environments/$task_environment" init -input=false
  terraform -chdir="terraform/environments/$task_environment" validate
done
printf 'Preparacion terminada. No se han creado recursos de la arquitectura.\n'
