import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

// In AI Studio runtime environment, port 3000 and host 0.0.0.0 are strictly required.
const PORT = 3000;
const HOST = '0.0.0.0';
const MAX_AI_BODY = '512kb';

const app = express();

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Bloqueio rigoroso de arquivos confidenciais, planilhas e dumps de dados
app.use((req, res, next) => {
  const p = req.path.toLowerCase();
  if (
    p.includes('clientes_flex') ||
    p.includes('private_data') ||
    p.endsWith('.xlsx') ||
    p.endsWith('.xls') ||
    p.endsWith('.csv') ||
    p.endsWith('.sql') ||
    p.endsWith('.dump')
  ) {
    return res.status(403).json({ error: 'Acesso negado: Recursos de dados privados não podem ser acessados publicamente.' });
  }
  next();
});

app.use(express.json({ limit: MAX_AI_BODY }));

// -----------------------------
// Firebase Authentication & Authorization for server-side API protection
// -----------------------------
interface AuthenticatedRequest extends Request {
  authUser?: { uid: string; email?: string; role?: string };
}

const ROOT_ADMIN_EMAILS = [
  'guilhermejbini@gmail.com',
  'admin@superastral.com.br'
];

interface FirebaseAppConfig {
  projectId: string;
  firestoreDatabaseId: string;
  apiKey: string;
}

function getFirebaseConfig(): FirebaseAppConfig {
  let projectId = process.env.FIREBASE_PROJECT_ID || '';
  let firestoreDatabaseId = process.env.FIRESTORE_DATABASE_ID || '(default)';
  let apiKey = process.env.FIREBASE_API_KEY || '';

  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (!projectId && config.projectId) projectId = config.projectId;
      if (firestoreDatabaseId === '(default)' && config.firestoreDatabaseId) firestoreDatabaseId = config.firestoreDatabaseId;
      if (!apiKey && config.apiKey) apiKey = config.apiKey;
    }
  } catch (err) {
    console.warn('[Server Config] Aviso ao ler firebase-applet-config.json:', err);
  }

  return { projectId, firestoreDatabaseId, apiKey };
}

function getFirebaseWebApiKey(): string {
  const config = getFirebaseConfig();
  if (config.apiKey) return config.apiKey;
  throw new Error('FIREBASE_API_KEY não configurada.');
}

const tokenCache = new Map<string, { user: { uid: string; email?: string; emailVerified?: boolean }; expiresAt: number }>();
const authPermissionCache = new Map<string, { authorized: boolean; role: string; expiresAt: number }>();

async function verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; email?: string; emailVerified?: boolean }> {
  const cached = tokenCache.get(idToken);
  if (cached && cached.expiresAt > Date.now()) return cached.user;

  const apiKey = getFirebaseWebApiKey();
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken })
  });

  if (!response.ok) throw new Error('Token Firebase inválido ou expirado.');
  const data = await response.json() as { users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }> };
  const account = data.users?.[0];
  if (!account?.localId) throw new Error('Sessão Firebase não encontrada.');
  if (account.emailVerified !== true) throw new Error('Acesso negado: Conta Google não verificada.');

  const user = { uid: account.localId, email: account.email, emailVerified: account.emailVerified };
  tokenCache.set(idToken, { user, expiresAt: Date.now() + 5 * 60 * 1000 });
  return user;
}

/**
 * Validação de Autorização Server-Side:
 * Garante que a conta Google autenticada possui autorização prévia e ativa
 * na coleção 'authorized_users' do Firestore ou seja Administrador Raiz.
 */
async function checkUserAuthorizationServer(
  user: { uid: string; email?: string; emailVerified?: boolean },
  idToken: string
): Promise<{ authorized: boolean; role: string }> {
  const normalizedEmail = (user.email || '').trim().toLowerCase();

  // 1. Administrador Raiz Seguro (exige e-mail verificado)
  if (normalizedEmail && user.emailVerified === true && ROOT_ADMIN_EMAILS.includes(normalizedEmail)) {
    return { authorized: true, role: 'admin' };
  }

  // 2. Cache de autorização (2 minutos)
  const cacheKey = `${user.uid}:${normalizedEmail}`;
  const cached = authPermissionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  // 3. Consulta via REST API do Firestore utilizando o ID Token do próprio usuário
  try {
    const { projectId, firestoreDatabaseId } = getFirebaseConfig();
    if (!projectId) {
      console.warn('[Server Auth] Project ID não configurado para verificação Firestore.');
      return { authorized: false, role: '' };
    }

    const firestoreBase = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(firestoreDatabaseId)}/documents/authorized_users`;

    // Tenta primeiro consultar registro CANÔNICO por E-mail
    let res = normalizedEmail ? await fetch(`${firestoreBase}/${encodeURIComponent(normalizedEmail)}`, {
      headers: { Authorization: `Bearer ${idToken}` }
    }) : null;

    // Se não encontrou por E-mail, tenta por UID
    if ((!res || res.status === 404) && user.uid) {
      res = await fetch(`${firestoreBase}/${encodeURIComponent(user.uid)}`, {
        headers: { Authorization: `Bearer ${idToken}` }
      });
    }

    if (!res || !res.ok) {
      // Documento não existe ou regras de segurança negaram a leitura -> Não autorizado
      authPermissionCache.set(cacheKey, { authorized: false, role: '', expiresAt: Date.now() + 60 * 1000 });
      return { authorized: false, role: '' };
    }

    const doc = await res.json() as any;
    const fields = doc?.fields || {};
    const isActive = fields.active?.booleanValue === true;
    const role = fields.role?.stringValue || 'viewer';

    const result = { authorized: isActive, role };
    authPermissionCache.set(cacheKey, { ...result, expiresAt: Date.now() + 2 * 60 * 1000 });
    return result;
  } catch (err) {
    console.error('[Server Auth] Erro ao validar autorização server-side:', err);
    return { authorized: false, role: '' };
  }
}

async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return res.status(401).json({ error: 'Autenticação obrigatória. Token ausente ou inválido.' });
  }

  const idToken = match[1];

  try {
    const user = await verifyFirebaseIdToken(idToken);
    
    // Validação estrita de autorização server-side
    const authCheck = await checkUserAuthorizationServer(user, idToken);
    if (!authCheck.authorized) {
      console.warn(`[Server Auth] 403 Forbidden: Usuário autenticado mas NÃO autorizado tentou acessar ${req.path} (${user.email || user.uid})`);
      return res.status(403).json({ 
        error: 'Acesso negado: Sua conta não possui autorização ativa para acessar o CRM Super Astral.',
        code: 'UNAUTHORIZED_CRM_USER'
      });
    }

    req.authUser = {
      ...user,
      role: authCheck.role
    };
    next();
  } catch (error) {
    console.warn('Falha na autenticação da API:', error instanceof Error ? error.message : error);
    return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
  }
}

// Basic per-user rate limiter. Production deployments with multiple instances
// should additionally configure a shared gateway/WAF rate limit.
const rateBuckets = new Map<string, { startedAt: number; count: number }>();
function rateLimit(maxRequests: number, windowMs = 60_000) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const key = req.authUser?.uid || req.ip || 'unknown';
    const now = Date.now();
    const current = rateBuckets.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      rateBuckets.set(key, { startedAt: now, count: 1 });
      return next();
    }
    current.count += 1;
    if (current.count > maxRequests) {
      return res.status(429).json({ error: 'Limite temporário de requisições atingido. Aguarde um minuto.' });
    }
    next();
  };
}

// Limpeza periódica de entradas expiradas dos caches em memória.
// Só remove o que já não seria mais usado (mesmos TTLs/janelas acima).
// Todas as rotas usam a janela padrão de rateLimit (60s).
const RATE_LIMIT_WINDOW_MS = 60_000;
function purgeExpiredServerCaches(now = Date.now()) {
  for (const [key, entry] of tokenCache) {
    if (entry.expiresAt <= now) tokenCache.delete(key);
  }
  for (const [key, entry] of authPermissionCache) {
    if (entry.expiresAt <= now) authPermissionCache.delete(key);
  }
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.startedAt >= RATE_LIMIT_WINDOW_MS) rateBuckets.delete(key);
  }
}
const cacheCleanupInterval = setInterval(() => purgeExpiredServerCaches(), 60_000);
cacheCleanupInterval.unref?.();

// -----------------------------
// Gemini AI Initialization & Resilient Generation
// -----------------------------
let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.error('[API AI] ERRO CRÍTICO: GEMINI_API_KEY não configurada no ambiente.');
      throw new Error('GEMINI_API_KEY não configurada no ambiente.');
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
  }
  return aiClient;
}

async function generateWithGeminiFallback(params: {
  prompt: string;
  responseMimeType?: string;
  systemInstruction?: string;
}): Promise<{ text: string; modelUsed: string }> {
  const primaryModel = (process.env.GEMINI_MODEL || 'gemini-3.7-flash').trim();
  
  // Modelos suportados na ordem de preferência, excluindo modelos descontinuados
  const candidateModels = [
    primaryModel,
    'gemini-3.7-flash',
    'gemini-3.1-flash-lite',
    'gemini-flash-latest'
  ].filter((m, i, arr) => arr.indexOf(m) === i && !m.includes('1.5') && !m.includes('2.0') && !m.includes('2.5'));

  const ai = getAI();
  let lastError: any = null;

  for (const model of candidateModels) {
    try {
      const config: any = {};
      if (params.responseMimeType) {
        config.responseMimeType = params.responseMimeType;
      }
      if (params.systemInstruction) {
        config.systemInstruction = params.systemInstruction;
      }

      const response = await ai.models.generateContent({
        model,
        contents: params.prompt,
        config: Object.keys(config).length > 0 ? config : undefined
      });

      if (response.text) {
        return { text: response.text, modelUsed: model };
      }
    } catch (err: any) {
      lastError = err;
      console.warn(`[API AI] Falha com modelo ${model} (${err?.message || err}), tentando próximo candidato...`);
    }
  }

  throw lastError || new Error('Não foi possível obter resposta dos modelos Gemini.');
}

function parseJsonResponse(text: string): Record<string, any> {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error('A IA retornou uma resposta JSON inválida.');
  }
}

function clampString(value: unknown, max: number): string {
  return String(value ?? '').slice(0, max);
}

function sanitizeCustomerForAI(customer: any) {
  return {
    name: clampString(customer?.name, 120),
    neighborhood: clampString(customer?.neighborhood, 80),
    city: clampString(customer?.city, 80),
    state: clampString(customer?.state, 30),
    rfmSegment: clampString(customer?.rfmSegment, 60),
    recencyScore: Number(customer?.recencyScore || 0),
    frequencyScore: Number(customer?.frequencyScore || 0),
    monetaryScore: Number(customer?.monetaryScore || 0),
    totalSpent: Number(customer?.totalSpent || 0),
    totalPurchases: Number(customer?.totalPurchases || 0),
    averageTicket: Number(customer?.averageTicket || 0),
    daysSinceLastPurchase: Number(customer?.daysSinceLastPurchase || 0),
    lastPurchaseDate: clampString(customer?.lastPurchaseDate, 30),
    consentWhatsApp: Boolean(customer?.consentWhatsApp),
    loyaltyPoints: Number(customer?.loyaltyPoints || 0)
  };
}

function sanitizePurchases(purchases: any[]) {
  return (Array.isArray(purchases) ? purchases : []).slice(0, 8).map(p => ({
    date: clampString(p?.date || p?.purchaseDate, 30),
    netAmount: Number(p?.netAmount || p?.totalAmount || 0),
    storeName: clampString(p?.storeName, 100),
    items: Array.isArray(p?.items) ? p.items.slice(0, 15).map((i: any) => ({
      productName: clampString(i?.productName || i?.name, 100),
      category: clampString(i?.category, 80),
      quantity: Number(i?.quantity || 0),
      total: Number(i?.total || i?.netAmount || 0)
    })) : undefined
  }));
}

// -----------------------------
// Health
// -----------------------------
app.get(['/api/health', '/health', '/healthz'], (req, res) => {
  res.json({
    status: 'ok',
    app: 'CRM Super Astral Supermercados',
    port: PORT,
    host: HOST,
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    aiConfigured: Boolean(process.env.GEMINI_API_KEY)
  });
});

const protectedApi = [requireAuth, rateLimit(30)];

// -----------------------------
// AI: Customer 360
// -----------------------------
app.post('/api/ai/analyze-customer', ...protectedApi, async (req: AuthenticatedRequest, res: Response) => {
  const startTime = Date.now();
  console.log(`[API AI] POST /api/ai/analyze-customer - Solicitado por ${req.authUser?.email || req.authUser?.uid}`);
  try {
    const { customer, purchases, topCategories, topProducts, loyalty } = req.body;
    if (!customer) return res.status(400).json({ error: 'Dados do cliente obrigatórios.' });

    const safeCustomer = sanitizeCustomerForAI(customer);
    const prompt = `Você é o especialista sênior em CRM e Inteligência de Varejo Supermercadista da rede "Super Astral Supermercados".
Analise os dados do cliente e gere um diagnóstico comercial estruturado em JSON. Não solicite nem tente inferir CPF, telefone, endereço exato ou outros identificadores pessoais.

DADOS DO CLIENTE:
${JSON.stringify(safeCustomer, null, 2)}

CATEGORIAS MAIS COMPRADAS:
${JSON.stringify(Array.isArray(topCategories) ? topCategories.slice(0, 8) : [], null, 2)}

PRODUTOS MAIS COMPRADOS:
${JSON.stringify(Array.isArray(topProducts) ? topProducts.slice(0, 10) : [], null, 2)}

ÚLTIMAS COMPRAS:
${JSON.stringify(sanitizePurchases(purchases), null, 2)}

SALDO DE FIDELIDADE:
${Number(loyalty?.balance || safeCustomer.loyaltyPoints || 0)} pontos

Retorne EXCLUSIVAMENTE um objeto JSON válido com:
{
  "summary": "Resumo em 2 a 3 frases.",
  "buyingBehavior": "Análise de frequência, ticket, cesta e momentos de compra.",
  "churnRisk": "Baixo" | "Médio" | "Alto" | "Crítico",
  "churnReason": "Explicação objetiva.",
  "topCategoryInsights": "Principais categorias e oportunidades.",
  "crossSellOpportunities": [{ "product": "Produto ou categoria", "reason": "Motivo baseado nos dados" }],
  "nextBestAction": {
    "title": "Ação Comercial Recomendada",
    "channel": "WhatsApp" | "SMS" | "E-mail" | "Atendimento em Loja",
    "suggestedMessage": "Mensagem personalizada apenas se houver opt-in.",
    "discountOffer": "Sugestão de incentivo se aplicável.",
    "urgency": "Alta" | "Média" | "Baixa"
  }
}`;

    const { text, modelUsed } = await generateWithGeminiFallback({
      prompt,
      responseMimeType: 'application/json'
    });

    const elapsed = Date.now() - startTime;
    console.log(`[API AI] Diagnóstico de cliente gerado com sucesso via ${modelUsed} em ${elapsed}ms`);
    return res.json(parseJsonResponse(text || '{}'));
  } catch (error: any) {
    console.error('[API AI] Erro na análise de cliente com IA:', error?.message || error);
    return res.status(500).json({ error: 'Não foi possível concluir a análise com IA.' });
  }
});

// -----------------------------
// AI: Campaign generation
// -----------------------------
app.post('/api/ai/generate-campaign', ...protectedApi, async (req: AuthenticatedRequest, res: Response) => {
  const startTime = Date.now();
  console.log(`[API AI] POST /api/ai/generate-campaign - Solicitado por ${req.authUser?.email || req.authUser?.uid}`);
  try {
    const { objective, targetSegment, segment, channel, store, categoryFocus, metrics } = req.body;
    const cleanObjective = clampString(objective, 500).trim();
    if (!cleanObjective) {
      return res.status(400).json({ error: 'O objetivo da campanha é obrigatório.' });
    }
    const selectedSegment = targetSegment || segment || 'Clientes Ativos / Leais';

    const prompt = `Você é o Diretor de Marketing e CRM da rede "Super Astral Supermercados".
Gere uma estratégia de campanha de CRM baseada nos parâmetros abaixo.
Se faltar dados de produtos ou métricas, não invente dados falsos como faturamento histórico ou dados não existentes; utilize estratégias de varejo alimentício baseadas em boas práticas de supermercado.

OBJETIVO: "${cleanObjective}"
PÚBLICO-ALVO: "${clampString(selectedSegment, 100)}"
CANAL: "${clampString(channel || 'WhatsApp', 40)}"
LOJA: "${clampString(store || 'Todas as lojas', 100)}"
FOCO: "${clampString(categoryFocus || 'Geral', 100)}"
CONTEXTO: ${JSON.stringify(metrics || {}).slice(0, 5000)}

Retorne EXCLUSIVAMENTE JSON válido:
{
  "campaignName": "Nome comercial atrativo",
  "recommendedAudience": "Descrição do filtro",
  "commercialStrategy": "Mecânica e gatilhos",
  "suggestedCoupon": { "code": "ASTRAL10", "discountType": "percent" | "fixed", "discountValue": 10, "minPurchaseValue": 80, "validityDays": 5 },
  "messageTemplates": {
    "whatsapp": "Texto com {nome}, {cupom}, {validade}",
    "sms": "Texto de até 160 caracteres com {nome} e {cupom}",
    "email": { "subject": "Assunto instigante", "body": "Corpo do e-mail com detalhes" }
  },
  "keyArguments": ["Argumento 1", "Argumento 2", "Argumento 3"],
  "expectedImpact": "Previsão qualitativa esperada"
}`;

    const { text, modelUsed } = await generateWithGeminiFallback({
      prompt,
      responseMimeType: 'application/json'
    });

    const elapsed = Date.now() - startTime;
    console.log(`[API AI] Campanha gerada com sucesso via ${modelUsed} em ${elapsed}ms`);
    return res.json(parseJsonResponse(text || '{}'));
  } catch (error: any) {
    console.error('[API AI] Erro na geração de campanha com IA:', error?.message || error);
    return res.status(500).json({ error: 'Não foi possível obter resposta da IA. Tente novamente.' });
  }
});

// -----------------------------
// AI: CRM Copilot chat
// -----------------------------
app.post('/api/ai/crm-chat', ...protectedApi, async (req: AuthenticatedRequest, res: Response) => {
  const startTime = Date.now();
  console.log(`[API AI] POST /api/ai/crm-chat - Pergunta recebida de ${req.authUser?.email || req.authUser?.uid}`);
  try {
    const question = clampString(req.body.question, 1200).trim();
    const crmSummaryData = req.body.crmSummaryData || {};
    const history = Array.isArray(req.body.history) ? req.body.history.slice(-8) : [];
    if (!question) {
      return res.status(400).json({ error: 'Pergunta obrigatória.' });
    }

    const prompt = `Você é o Copiloto Comercial e Especialista em Varejo Supermercadista da rede "Super Astral Supermercados".
Você atua como consultor analítico de CRM e Estratégia Comercial para a diretoria, gerentes de loja e analistas de marketing.

DIRETRIZES:
1. Responda em português do Brasil, de forma clara, profissional, objetiva e orientada a resultados práticos no varejo supermercadista.
2. Se a pergunta for uma saudação ("Olá", "Oi", "Bom dia", etc.), responda cordialmente explicando como você pode ajudar na análise de clientes, RFM, faturamento, campanhas e retenção do Super Astral.
3. Se a pergunta envolver dados do CRM (clientes, faturamento, ticket médio, RFM, campanhas, fidelidade), utilize os dados fornecidos no RESUMO DO CRM abaixo. Nunca invente dados não fundamentados. Se determinada informação não estiver disponível no resumo fornecido, declare explicitamente que o dado não consta no resumo disponível no CRM no momento. Não invente vendas, clientes, faturamento, ticket médio, campanhas, produtos, unidades ou métricas.
4. Forneça sugestões táticas práticas quando relevante (ex: ações para dias de feira, ofertas personalizadas, retenção de clientes em risco, ativação de WhatsApp com opt-in).
5. Estruture a resposta com formatação Markdown limpa (títulos, marcadores e destaques).

RESUMO OPERACIONAL DO CRM SUPER ASTRAL:
${JSON.stringify(crmSummaryData, null, 2).slice(0, 12000)}

HISTÓRICO RECENTE DA CONVERSA:
${JSON.stringify(history, null, 2).slice(0, 5000)}

PERGUNTA DO USUÁRIO:
"${question}"`;

    const { text, modelUsed } = await generateWithGeminiFallback({ prompt });

    const answer = text || 'Não foi possível gerar uma resposta agora.';
    const elapsed = Date.now() - startTime;
    console.log(`[API AI] Resposta do Copiloto gerada com sucesso via ${modelUsed} em ${elapsed}ms (${answer.length} caracteres)`);

    return res.json({ 
      answer 
    });
  } catch (error: any) {
    console.error('[API AI] Erro no Chat com o Copiloto CRM:', error?.message || error);
    return res.status(500).json({ 
      error: 'Não foi possível obter resposta da IA. Tente novamente.'
    });
  }
});

// -----------------------------
// Approximate geocoding fallback (Almirante Tamandaré - PR)
// -----------------------------
const NEIGHBORHOOD_BASE_COORDS: Record<string, { lat: number; lng: number }> = {
  'Centro': { lat: -25.311508, lng: -49.298475 },
  'Vila Rachel': { lat: -25.316358, lng: -49.300861 },
  'Jardim São Domingos': { lat: -25.311141, lng: -49.294573 },
  'Vila Santa Terezinha': { lat: -25.309500, lng: -49.299200 },
  'Jardim Graziele': { lat: -25.314800, lng: -49.288500 },
  'Prado': { lat: -25.319500, lng: -49.295200 },
  'Lamenha Grande': { lat: -25.334000, lng: -49.305000 },
  'Tanguá': { lat: -25.328000, lng: -49.289000 },
  'São Jorge': { lat: -25.304500, lng: -49.292500 },
  'Cachoeira': { lat: -25.325000, lng: -49.282000 }
};

function approximateGeocode(input: any): Record<string, any> {
  const text = (v: unknown) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '');
  const address = text(input?.address);
  const number = text(input?.number);
  const neighborhood = text(input?.neighborhood);
  const city = text(input?.city);
  const state = text(input?.state);
  const cep = text(input?.cep);

  const fullAddr = [address, number, neighborhood, city, state, cep].filter(Boolean).join(' ').trim();
  if (!fullAddr || fullAddr.toLowerCase().includes('sem logradouro') || fullAddr.toLowerCase().includes('não informado')) {
    return { success: false, status: 'pending', error: 'Endereço incompleto ou ausente no cadastro do cliente.' };
  }

  const nKey = Object.keys(NEIGHBORHOOD_BASE_COORDS).find(k =>
    (neighborhood && neighborhood.toLowerCase().includes(k.toLowerCase())) ||
    (address && address.toLowerCase().includes(k.toLowerCase()))
  );
  const base = nKey
    ? NEIGHBORHOOD_BASE_COORDS[nKey]
    : { lat: -25.3115, lng: -49.2985 }; // Almirante Tamandaré - Centro

  let hash = 0;
  for (let i = 0; i < fullAddr.length; i++) {
    hash = (hash << 5) - hash + fullAddr.charCodeAt(i);
    hash |= 0;
  }
  const numVal = parseInt(number || '1', 10) || 1;
  const latOffset = (Math.sin(hash) * 0.007) + ((numVal % 50) * 0.0001);
  const lngOffset = (Math.cos(hash) * 0.007) + (((numVal * 3) % 50) * 0.0001);

  return {
    success: true,
    status: 'approximate',
    latitude: parseFloat((base.lat + latOffset).toFixed(6)),
    longitude: parseFloat((base.lng + lngOffset).toFixed(6)),
    precision: 'neighborhood',
    warning: 'Coordenada aproximada para visualização regional. Não representa a localização exata do cliente.',
    formattedAddress: `${address}, ${number || 's/n'} - ${neighborhood}, ${city} - ${state}`
  };
}

app.post('/api/geocode', requireAuth, rateLimit(60), async (req: AuthenticatedRequest, res: Response) => {
  try {
    return res.json(approximateGeocode(req.body));
  } catch (err) {
    console.error('Erro na geocodificação:', err);
    return res.status(500).json({ success: false, error: 'Erro interno ao calcular coordenada aproximada.' });
  }
});

// Lote: até 500 endereços por requisição (evita estourar o limite de 60 req/min ao geolocalizar uma base importada).
app.post('/api/geocode/batch', requireAuth, rateLimit(20), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 500) : [];
    if (items.length === 0) {
      return res.status(400).json({ error: 'Envie ao menos um item em "items".' });
    }
    const results = items.map((item: any) => ({ id: String(item?.id ?? ''), ...approximateGeocode(item) }));
    return res.json({ results });
  } catch (err) {
    console.error('Erro na geocodificação em lote:', err);
    return res.status(500).json({ error: 'Erro interno ao calcular coordenadas aproximadas.' });
  }
});

async function startServer() {
  const distPath = path.resolve(process.cwd(), 'dist');
  const indexHtmlPath = path.join(distPath, 'index.html');
  const isProduction = process.env.NODE_ENV === 'production' || (!fs.existsSync(path.resolve(process.cwd(), 'src', 'main.tsx')) && fs.existsSync(indexHtmlPath));

  if (!isProduction) {
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: {
          middlewareMode: true,
          hmr: false
        },
        appType: 'spa'
      });
      app.use(vite.middlewares);
      console.log('[CRM Super Astral] Middleware Vite anexado com sucesso.');
    } catch (viteError) {
      console.warn('[CRM Super Astral] Não foi possível iniciar middleware Vite, servindo arquivos estáticos:', viteError);
      if (fs.existsSync(distPath)) {
        app.use(express.static(distPath));
        app.get('*', (req, res) => res.sendFile(indexHtmlPath));
      }
    }
  } else {
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => res.sendFile(indexHtmlPath));
      console.log(`[CRM Super Astral] Servindo arquivos de produção de ${distPath}`);
    } else {
      console.warn(`[CRM Super Astral] Pasta dist não encontrada em ${distPath}.`);
    }
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`[CRM Super Astral] Servidor pronto e escutando em http://${HOST}:${PORT}`);
    console.log(`[CRM Super Astral] Ambiente: ${process.env.NODE_ENV || 'development'} | PID: ${process.pid}`);
  });

  server.on('error', (err: any) => {
    console.error('[CRM Super Astral] Erro fatal no servidor HTTP:', err);
    process.exit(1);
  });

  process.on('SIGTERM', () => {
    console.log('[CRM Super Astral] Recebido SIGTERM, encerrando servidor HTTP gracefully...');
    server.close(() => {
      console.log('[CRM Super Astral] Servidor HTTP encerrado com sucesso.');
      process.exit(0);
    });
  });

  process.on('SIGINT', () => {
    console.log('[CRM Super Astral] Recebido SIGINT, encerrando servidor HTTP...');
    server.close(() => {
      process.exit(0);
    });
  });
}

startServer();
