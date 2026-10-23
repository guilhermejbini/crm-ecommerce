# CRM Super Astral Supermercados

Aplicação React + Express + Firebase/Firestore + Gemini para CRM e inteligência comercial.

## O que foi corrigido nesta versão

- Login com Google (Firebase Authentication), exigindo e-mail verificado.
- Remoção do seletor de "troca de perfil" que permitia elevar privilégios apenas pela interface.
- Regras do Firestore com autenticação e RBAC por coleção.
- APIs do servidor protegidas por token Firebase.
- Rate limit básico nas rotas de IA e geocodificação.
- Chave Gemini mantida somente no servidor.
- CRM Chat corrigido para usar `question`, `crmSummaryData`, `history` e retornar `answer`.
- Geração de campanhas corrigida para usar o contrato real (`campaignName`, `messageTemplates`, `suggestedCoupon`).
- CPF e outros identificadores diretos não são enviados ao Gemini no diagnóstico Cliente 360.
- Banco vazio não dispara seed automático de dados de demonstração.
- Falhas de gravação críticas não são mais silenciosamente tratadas como sucesso.
- Geocodificação aproximada passou a ser explicitamente marcada como `approximate`, evitando a falsa impressão de precisão de endereço.

## Configuração

1. Instale Node.js.
2. Rode `npm install`.
3. Configure as variáveis do `.env` usando `.env.example`.
4. No Firebase Console, ative Authentication > **Google**.
5. Publique `firestore.rules`.
6. Rode `npm run dev` para desenvolvimento ou `npm run build && npm start` para produção.
7. Rode `npm test` para executar os testes automatizados.

### Acesso e perfis

- Login somente com conta Google com e-mail verificado. Não existe login público por e-mail/senha.
- Só entra quem foi **previamente cadastrado e ativo** na coleção `authorized_users` (documento com o e-mail como ID). Não há autorização automática: um usuário autenticado que não está em `authorized_users` vê a tela de acesso negado.
- Perfis: `admin`, `manager` (gestor) e `viewer` (consulta).
- Os administradores raiz (bootstrap) estão em `ROOT_ADMIN_EMAILS`, repetidos em `src/services/authService.ts`, `server.ts` e `firestore.rules`. Os demais usuários são cadastrados por um administrador em Configurações.

### RFM

- **Recência:** última compra histórica válida.
- **Frequência e Valor (RFM):** somente compras dentro da janela móvel configurável, hoje de **90 dias**.
- Totais históricos (`totalPurchases`, `totalSpent`) continuam separados e não entram na classificação F/M.
- Clientes sem histórico válido ficam como `UNCLASSIFIED`.
- Os limites (thresholds) ainda estão pendentes de calibração com dados reais (`RFM_THRESHOLDS_PENDING_CALIBRATION`).

## Integrações futuras

WhatsApp e RP Flex devem ser integrados no backend, nunca expondo tokens ou credenciais no frontend.

Consulte `PRODUCAO_CHECKLIST.md` antes da publicação.
