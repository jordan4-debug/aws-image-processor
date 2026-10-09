#!/usr/bin/env bash
set -euo pipefail
task_environment="${1:-dev}"
task_action="${2:-plan}"
case "$task_environment" in dev|qa|prod) ;; *) printf 'Entorno invalido\n'; exit 2;; esac
case "$task_action" in plan|apply|verify|destroy) ;; *) printf 'Accion invalida\n'; exit 2;; esac
cd "$(dirname "$0")/.."
export PATH="$HOME/image-processor-tools:$PATH"
export AWS_REGION=us-east-1
export AWS_DEFAULT_REGION=us-east-1
export AWS_PAGER=""
export TF_PLUGIN_CACHE_DIR=/tmp/image-processor-provider-cache
mkdir -p "$TF_PLUGIN_CACHE_DIR"
task_root="terraform/environments/$task_environment"
task_evidence="evidence/$task_environment"
mkdir -p "$task_evidence"
case "$task_action" in
  plan)
    terraform -chdir="$task_root" init -input=false
    terraform -chdir="$task_root" validate
    terraform -chdir="$task_root" plan -input=false -no-color -out=deployment.tfplan | tee "$task_evidence/plan.log"
    terraform -chdir="$task_root" show -json deployment.tfplan > "$task_evidence/plan.json"
    ;;
  apply)
    # Ejecutar solo despues de revisar y autorizar el plan: crea IAM, API publica y recursos con consumo de creditos.
    test -f "$task_root/deployment.tfplan"
    terraform -chdir="$task_root" apply -input=false -no-color deployment.tfplan | tee "$task_evidence/apply.log"
    terraform -chdir="$task_root" output -json deployment > "$task_evidence/deployment.json"
    ;;
  verify)
    test -f "$task_evidence/deployment.json"
    node scripts/demo.cjs "$task_environment" json
    node scripts/demo.cjs "$task_environment" multipart
    node scripts/demo.cjs "$task_environment" presigned
    node scripts/demo.cjs "$task_environment" large
    node scripts/collect-evidence.cjs "$task_environment"
    ;;
  destroy)
    # Elimina TODOS los recursos y las versiones de objetos del bucket de pruebas de ESTE entorno.
    terraform -chdir="$task_root" plan -destroy -input=false -no-color -out=destroy.tfplan | tee "$task_evidence/destroy-plan.log"
    terraform -chdir="$task_root" destroy -auto-approve -input=false -no-color | tee "$task_evidence/destroy.log"
    task_state=$(terraform -chdir="$task_root" state list)
    if [ -n "$task_state" ]; then printf 'Quedan recursos en el estado.\n'; exit 1; fi
    node scripts/verify-destroy.cjs "$task_environment"
    printf 'Estado de Terraform vacio: %s\n' "$task_environment"
    ;;
esac
