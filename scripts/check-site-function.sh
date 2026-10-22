#!/usr/bin/env bash
# Verifica (somente leitura) como a função de cadastro do site mapeia as lojas.
# Não altera nada, não imprime valores de variáveis de ambiente nem segredos.
#
# Uso no Cloud Shell, dentro da pasta do projeto:
#   bash scripts/check-site-function.sh
# Opcional: FUNCTION=registerWebsiteCustomer REGION=southamerica-east1 bash scripts/check-site-function.sh
#
# Correspondência esperada (CRM corrigido em 29/09/2026):
#   matriz     -> store-01 (LJ01, Astral Rodovia dos Minérios, Travessa Paulo Bini, 250)
#   paulo-bini -> store-02 (LJ02, Astral Centro, Avenida Emílio Johnson, 675)  [código do formulário, ordem do site]
#   bertolina  -> store-03 (LJ03, Astral Bertolina)
set -euo pipefail

FUNCTION="${FUNCTION:-registerWebsiteCustomer}"
REGION="${REGION:-southamerica-east1}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "== Função: $FUNCTION ($REGION)"
gcloud functions describe "$FUNCTION" --region="$REGION" --format=json > "$WORK/describe.json"

echo "== Runtime / entry point / atualização"
jq -r '"runtime=\(.buildConfig.runtime // "?") entryPoint=\(.buildConfig.entryPoint // "?") updateTime=\(.updateTime // "?")"' "$WORK/describe.json"

echo "== Nomes das variáveis de ambiente e segredos (somente nomes, nunca valores)"
jq -r '(.serviceConfig.environmentVariables // {} | keys[] | "env: " + .),
       (.serviceConfig.secretEnvironmentVariables // [] | .[] | "secret: " + .key + " (Secret Manager: " + .secret + ")")' "$WORK/describe.json"

BUCKET="$(jq -r '.buildConfig.source.storageSource.bucket // empty' "$WORK/describe.json")"
OBJECT="$(jq -r '.buildConfig.source.storageSource.object // empty' "$WORK/describe.json")"
# Cloud Functions 1ª geração: sourceArchiveUrl = gs://bucket/objeto
if [[ -z "$BUCKET" ]]; then
  ARCHIVE="$(jq -r '.sourceArchiveUrl // empty' "$WORK/describe.json")"
  if [[ "$ARCHIVE" == gs://* ]]; then BUCKET="${ARCHIVE#gs://}"; OBJECT="${BUCKET#*/}"; BUCKET="${BUCKET%%/*}"; fi
fi
if [[ -z "$BUCKET" || -z "$OBJECT" ]]; then
  echo "!! Código-fonte não está em Cloud Storage (ex.: publicado de repositório). Verifique a origem em:"
  jq -r '.buildConfig.source' "$WORK/describe.json"
  exit 0
fi

gcloud storage cp "gs://$BUCKET/$OBJECT" "$WORK/src.zip" --quiet >/dev/null
mkdir -p "$WORK/src" && unzip -q "$WORK/src.zip" -d "$WORK/src"

echo "== Arquivos do código publicado"
(cd "$WORK/src" && find . -type f -not -path '*/node_modules/*' | sort)

echo "== Linhas com lojas (segredos mascarados; linhas com chave/senha/token omitidas)"
(cd "$WORK/src" && grep -rniE "paulo[-_ ]?bini|matriz|bertolina|emilio|emílio|minerios|minérios|store-0[1-9]|LJ0[1-9]|favoriteStore|storeId|storeName|loja" \
    --include='*.js' --include='*.mjs' --include='*.cjs' --include='*.ts' --include='*.py' --include='*.json' . \
    | grep -v node_modules \
    | sed -E '/(secret|senha|password|token|apikey|api_key|x-api-key|authorization)/I s/:([0-9]+):.*/:\1: [linha omitida: pode conter segredo]/' \
    | sed -E 's/[A-Za-z0-9_\-]{32,}/***/g') || echo "(nenhuma linha encontrada)"

echo
echo "Confira nas linhas acima se: matriz -> store-01 (Rodovia dos Minérios), paulo-bini -> store-02 (Astral Centro), bertolina -> store-03."
