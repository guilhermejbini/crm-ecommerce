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

## Pesquisa de satisfação pós-compra (WhatsApp)

Tela: menu **Pesquisa de satisfação**. Regras padrão (alteráveis na tela pelo administrador): compras com valor líquido **acima de R$ 80**, no máximo **1 pesquisa a cada 30 dias** por cliente, só compras de até 2 dias atrás, **segunda a sábado das 9h às 19h** (Brasília), no máximo 200 por dia, só clientes com consentimento de WhatsApp, celular válido e sem atendimento em aberto. Quem responde PARAR (ou é bloqueado na tela) não recebe mais.

Sem as variáveis do WhatsApp, tudo roda em **modo teste**: o CRM registra quem receberia, mas não envia nada.

1. **Acesso do servidor ao banco.** O envio automático roda sem ninguém logado, então usa a conta de serviço do Cloud Run. Dê a ela o papel **Cloud Datastore User** (`roles/datastore.user`) no projeto `moonlit-azimuth-ldtd0`:
   `gcloud projects add-iam-policy-binding moonlit-azimuth-ldtd0 --member=serviceAccount:<conta-do-cloud-run> --role=roles/datastore.user`
   A tela mostra um aviso vermelho enquanto isso não estiver feito.
2. **Modelo de mensagem na Meta** (WhatsApp Manager > Modelos de mensagem): nome `pesquisa_satisfacao`, idioma Português (BR), texto:
   `Olá, {{1}}! Obrigado por comprar no {{2}}. Como foi sua experiência hoje?` + linha em branco + `Toque em uma opção abaixo. Para não receber mais esta pesquisa, responda PARAR.`
   Três botões de resposta rápida, nesta ordem: **Gostei**, **Mais ou menos**, **Não gostei**. Envie para aprovação e espere o status "Aprovado".
3. **Variáveis no Cloud Run** (como segredo, nunca no front): `WHATSAPP_TOKEN` (token permanente de usuário do sistema), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `SURVEY_CRON_TOKEN`. Use `--update-secrets`/`--update-env-vars` para não apagar as variáveis que já existem.
4. **Webhook** (app da Meta > WhatsApp > Configuração): URL `https://<endereço-do-crm>/api/whatsapp/webhook`, token de verificação = `WHATSAPP_VERIFY_TOKEN`, assinar o campo `messages`.
5. **Agendamento** (Cloud Scheduler), a cada 15 minutos:
   `gcloud scheduler jobs create http pesquisa-satisfacao --location=southamerica-east1 --schedule="*/15 * * * *" --time-zone="America/Sao_Paulo" --uri="https://<endereço-do-crm>/api/survey/run" --http-method=POST --headers="X-Survey-Cron-Token=<SURVEY_CRON_TOKEN>"`
   Fora do horário a chamada não faz nada. O botão **Rodar agora** da tela faz o mesmo na hora (gestor ou administrador).
6. Publicar as regras novas do Firestore (`firestore.rules`): coleções `satisfaction_surveys` (só o servidor grava), `survey_contacts` e `survey_optouts`.
