# CRM Super Astral - Checklist antes de publicar

## 1. Firebase Authentication
1. No Firebase Console, abra Authentication > Sign-in method.
2. Ative **Google**. Não há login público por e-mail/senha.
3. Revise `ROOT_ADMIN_EMAILS` (em `src/services/authService.ts`, `server.ts` e `firestore.rules`): só esses e-mails entram como administrador raiz.
4. Cadastre os demais usuários em Configurações (coleção `authorized_users`), com o perfil `admin`, `manager` ou `viewer`.
5. Não há autorização automática: conta Google autenticada, mas não cadastrada/ativa em `authorized_users` (ou com e-mail não verificado), fica bloqueada.

## 2. Firestore
Publique as regras de `firestore.rules`. A versão anterior com `allow read, write: if true` NÃO deve ser usada.

## 3. Gemini
Configure no ambiente do servidor:
- `GEMINI_API_KEY`
- `GEMINI_MODEL=gemini-3.7-flash`

A chave não é enviada para o navegador. As rotas de IA exigem um token Firebase válido.

## 4. Banco vazio
A aplicação não cria dados de demonstração automaticamente. Os dados entram pelas importações (Flex/PDV) ou por cadastro manual.

Antes da primeira carga real, limpe os dados de teste com `scripts/demo-cleanup.mjs` (precisa de acesso de dono/editor ao projeto via `gcloud`):

1. Dry run (só leitura): `GOOGLE_ACCESS_TOKEN="$(gcloud auth print-access-token)" node scripts/demo-cleanup.mjs`
2. Revise contagens e exemplos. Se tudo for teste: acrescente `--execute --confirm-no-real-data` (e `--include-audit-logs` se quiser apagar também o histórico de auditoria de teste).

O script nunca apaga `authorized_users`, `stores`, `settings` ou `users`, e se recusa a executar se houver coleção desconhecida.

## 5. WhatsApp e RP Flex
As integrações ainda devem ser conectadas por backend/webhooks autenticados. Não coloque tokens do WhatsApp, RP Flex ou outras APIs no frontend.

## 6. Geolocalização
A rota atual usa coordenada aproximada por bairro para manter o mapa funcional. O status retornado é `approximate` e a interface não deve tratar essa coordenada como endereço exato. Para produção, conecte um serviço de geocodificação apropriado antes de usar os pontos para decisões de localização precisa.

## 7. Escala
A versão atual ainda carrega grandes coleções em memória no navegador. Antes de uma base muito grande (dezenas de milhares de clientes e grande volume de compras), migrar listas para paginação e consultas agregadas.

## 8. Lojas (correção de 29/09/2026)
Identificação correta usada pelo CRM:

| ID | Código | Loja | Endereço |
|---|---|---|---|
| `store-01` | LJ01 | Astral Rodovia dos Minérios (matriz) | Travessa Paulo Bini, 250 |
| `store-02` | LJ02 | Astral Centro | Avenida Emílio Johnson, 675 |
| `store-03` | LJ03 | Astral Bertolina | Rua Bertolina Kendrick de Oliveira |

Até essa data o CRM tinha `store-01` = Emílio Johnson e `store-02` = Paulo Bini. Para corrigir os registros já gravados (lojas, compras, clientes, uso de ofertas, atendimentos), no Cloud Shell:

1. Simulação (só leitura, mostra contagens e exemplos): `GOOGLE_ACCESS_TOKEN="$(gcloud auth print-access-token)" node scripts/fix-store-ids.mjs`
2. Revise o resultado. Se houver "referências em campos que este script NÃO trata", revise antes de seguir.
3. Execução: acrescente `--execute` (e `--accept-unknown-refs` somente depois de revisar o item 2). Um backup é gravado em `$HOME`; para desfazer: `--rollback <arquivo>`.
4. Rodar de novo não altera nada (idempotente).

Arquivos do RP Flex/PDV: endereço ou nome da loja (Paulo Bini, Minérios, matriz, Emílio Johnson, Astral Centro, Bertolina) é reconhecido automaticamente. Códigos só numéricos ("Loja 01", "LJ02") **não** são atribuídos automaticamente enquanto a numeração do RP Flex não for conferida: a importação pede a escolha da unidade. Depois de conferir que o RP Flex usa 01 = Paulo Bini, 02 = Emílio Johnson e 03 = Bertolina, mude `RP_FLEX_NUMERIC_STORE_CODES_CONFIRMED` para `true` em `src/services/storeAndLocationData.ts`.

Função de cadastro do site (`registerWebsiteCustomer`, fora deste repositório): os códigos do formulário seguem a ordem do site — `matriz` → `store-01` (Astral Rodovia dos Minérios), `paulo-bini` → `store-02` (Astral Centro), `bertolina` → `store-03`. Os IDs já estavam certos; os nomes gravados (favoriteStoreName) estavam trocados. Para conferir sem expor segredos: `FUNCTION=registerWebsiteCustomer bash scripts/check-site-function.sh`. Ao republicar a função, não passe `--set-env-vars`/`--set-secrets`, assim a chave atual é mantida.
