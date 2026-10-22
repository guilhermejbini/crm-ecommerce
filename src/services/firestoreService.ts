import { 
  collection, 
  doc, 
  getDocs, 
  getDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc, 
  query, 
  where, 
  orderBy, 
  limit, 
  startAfter,
  writeBatch,
  serverTimestamp,
  getCountFromServer,
  documentId,
  deleteField
} from 'firebase/firestore';
import { db } from './firebase';
import { 
  Customer, 
  CustomerConsent,
  Purchase, 
  Campaign, 
  Coupon, 
  Interaction, 
  CRMTask, 
  AuditLog, 
  Segment, 
  Store, 
  DashboardMetrics,
  UserRole,
  UserProfile,
  LoyaltyProgramConfig,
  PaginatedResult,
  GeoNeighborhoodSummary,
  RFMSegmentSummary,
  RFMSegmentType,
  ClubOffer,
  ClubOfferUsage,
  ClubOfferStatus,
  CampaignChannel
} from '../types/crm';
import { DEMO_STORES, NEIGHBORHOOD_COORDS, getRecordStoreId, getStoreLabel, alignStoresWithPhysicalIdentity } from './storeAndLocationData';
import { 
  RFM_SEGMENTS_INFO, 
  DEFAULT_RFM_CONFIG, 
  calculateRecencyScore, 
  calculateFrequencyScore, 
  calculateMonetaryScore, 
  determineRFMSegment,
  calculateCustomerRFM,
  computeRFMWindowMetrics,
  getRFMWindowDays
} from './rfmCalculator';
import { isValidCpf, formatCpf, cleanCpfDigits } from '../utils/cpfValidator';
import { hasIdentifiedDocument, isActiveCustomer } from '../utils/customerMetrics';
import { isCouponCodeTaken } from '../utils/couponUtils';

const CUSTOMERS_COL = 'customers';
const PURCHASES_COL = 'purchases';
const CAMPAIGNS_COL = 'campaigns';
const COUPONS_COL = 'coupons';
const INTERACTIONS_COL = 'interactions';
const TASKS_COL = 'tasks';
const AUDIT_LOGS_COL = 'audit_logs';
const SEGMENTS_COL = 'segments';
const STORES_COL = 'stores';
const SETTINGS_COL = 'settings';
const CLUB_OFFERS_COL = 'club_offers';
const CLUB_OFFER_USAGES_COL = 'club_offer_usages';

export function sanitizeForFirestore<T>(data: T): T {
  if (data === null || data === undefined) {
    return null as any;
  }
  if (Array.isArray(data)) {
    return data.map(item => sanitizeForFirestore(item)) as any;
  }
  if (typeof data === 'object' && !(data instanceof Date)) {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(data as Record<string, any>)) {
      if (value !== undefined) {
        cleaned[key] = sanitizeForFirestore(value);
      }
    }
    return cleaned as T;
  }
  return data;
}

export const SYSTEM_USER: UserProfile = {
  id: 'system',
  email: 'sistema@superastral.com.br',
  name: 'Sistema CRM',
  role: 'viewer',
  roleTitle: 'Sistema',
  storeAccess: ['todas']
};

export const DEFAULT_LOYALTY_CONFIG: LoyaltyProgramConfig = {
  type: 'pontos',
  pointsPerReal: 1, // 1 ponto por R$ 1
  pointsToRealConversion: 0.05, // 100 pontos = R$ 5 de desconto
  minPointsToRedeem: 100,
  cashbackPercentage: 2,
  expiryMonths: 12,
  isActive: true
};

// In-Memory cache for speed and targeted view hydration
let cachedCustomers: Customer[] | null = null;
let cachedPurchases: Purchase[] | null = null;
let cachedCampaigns: Campaign[] | null = null;
let cachedCoupons: Coupon[] | null = null;
let cachedInteractions: Interaction[] | null = null;
let cachedTasks: CRMTask[] | null = null;
let cachedSegments: Segment[] | null = null;
let cachedStores: Store[] | null = null;
let cachedClubOffers: ClubOffer[] | null = null;
let cachedClubOfferUsages: ClubOfferUsage[] | null = null;
let cachedAuditLogs: AuditLog[] = [];
let cachedDashboardMetrics: DashboardMetrics | null = null;
let cachedRFMSummaries: RFMSegmentSummary[] | null = null;
let cachedGeoSummaries: GeoNeighborhoodSummary[] | null = null;

let isDatabaseInitialized = false;

export type CacheDomain = 
  | 'all' 
  | 'customers' 
  | 'purchases' 
  | 'campaigns' 
  | 'coupons' 
  | 'clubOffers' 
  | 'clubOfferUsages' 
  | 'interactions' 
  | 'tasks' 
  | 'segments' 
  | 'stores' 
  | 'auditLogs' 
  | 'metrics';

/**
 * Invalidação granular de cache por domínio
 */
export function invalidateCache(domain: CacheDomain = 'all'): void {
  if (domain === 'all' || domain === 'customers') {
    cachedCustomers = null;
  }
  if (domain === 'all' || domain === 'purchases') {
    cachedPurchases = null;
  }
  if (domain === 'all' || domain === 'campaigns') {
    cachedCampaigns = null;
  }
  if (domain === 'all' || domain === 'coupons') {
    cachedCoupons = null;
  }
  if (domain === 'all' || domain === 'clubOffers') {
    cachedClubOffers = null;
  }
  if (domain === 'all' || domain === 'clubOfferUsages') {
    cachedClubOfferUsages = null;
  }
  if (domain === 'all' || domain === 'interactions') {
    cachedInteractions = null;
  }
  if (domain === 'all' || domain === 'tasks') {
    cachedTasks = null;
  }
  if (domain === 'all' || domain === 'segments') {
    cachedSegments = null;
  }
  if (domain === 'all' || domain === 'stores') {
    cachedStores = null;
  }
  if (domain === 'all' || domain === 'auditLogs') {
    cachedAuditLogs = [];
  }
  if (domain === 'all' || domain === 'metrics') {
    cachedDashboardMetrics = null;
    cachedRFMSummaries = null;
    cachedGeoSummaries = null;
  }
}

/**
 * Helper para interpretar opções de forceRefresh (aceita boolean direto ou objeto de opções)
 */
export function isForceRefresh(options?: { forceRefresh?: boolean } | boolean): boolean {
  if (typeof options === 'boolean') return options;
  return options?.forceRefresh === true;
}

// Helper to log audit events
export async function logAuditEvent(
  action: AuditLog['action'],
  description: string,
  user: UserProfile,
  targetEntity: string,
  targetId?: string,
  metadata?: Record<string, any>
): Promise<boolean> {
  const log: AuditLog = {
    id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
    action,
    userName: user.name,
    userEmail: user.email,
    userRole: user.role,
    targetEntity,
    targetId,
    description,
    metadata,
    timestamp: new Date().toISOString()
  };

  try {
    const docRef = doc(db, AUDIT_LOGS_COL, log.id);
    await setDoc(docRef, sanitizeForFirestore(log));
    cachedAuditLogs.unshift(log);
    return true;
  } catch (err) {
    console.error('[Audit Log Error] Falha ao persistir log de auditoria no Firestore:', err);
    return false;
  }
}

// ----------------------------------------------------
// DATABASE INITIALIZATION (REAL DATA ONLY - NO DEMO GENERATION/SEEDING)
// ----------------------------------------------------

export async function initializeDatabase(): Promise<{ isSeeded: boolean; count: number }> {
  // Se já foi inicializado e os clientes estão em memória, não reexecuta varredura de bootstrap
  if (isDatabaseInitialized && cachedCustomers !== null) {
    return { isSeeded: cachedCustomers.length > 0, count: cachedCustomers.length };
  }

  // Garantir e preservar sempre as 3 unidades reais do Super Astral
  cachedStores = await ensureRealSuperAstralStoresInFirestore();

  try {
    // 1. Consultar clientes reais existentes no Firestore (paginando com startAfter até esgotar)
    const rawCusts: Customer[] = [];
    let lastCustDoc: any = null;
    while (true) {
      const custQuery = lastCustDoc
        ? query(collection(db, CUSTOMERS_COL), startAfter(lastCustDoc), limit(1000))
        : query(collection(db, CUSTOMERS_COL), limit(1000));
      const custSnapshot = await getDocs(custQuery);
      if (custSnapshot.empty) break;
      custSnapshot.docs.forEach(d => {
        rawCusts.push(normalizeLoadedCustomer(d.data(), d.id));
      });
      lastCustDoc = custSnapshot.docs[custSnapshot.docs.length - 1];
      if (custSnapshot.docs.length < 1000) break;
    }
    
    if (rawCusts.length > 0) {
      cachedCustomers = rawCusts;

      // Carregar compras existentes (paginando com startAfter até esgotar)
      try {
        const rawPurchases: Purchase[] = [];
        let lastPurDoc: any = null;
        while (true) {
          const purchasesQuery = lastPurDoc
            ? query(collection(db, PURCHASES_COL), orderBy('purchaseDate', 'desc'), startAfter(lastPurDoc), limit(1000))
            : query(collection(db, PURCHASES_COL), orderBy('purchaseDate', 'desc'), limit(1000));
          const purchasesSnap = await getDocs(purchasesQuery);
          if (purchasesSnap.empty) break;
          purchasesSnap.docs.forEach(d => {
            rawPurchases.push({ ...d.data(), id: d.data().id || d.id } as Purchase);
          });
          lastPurDoc = purchasesSnap.docs[purchasesSnap.docs.length - 1];
          if (purchasesSnap.docs.length < 1000) break;
        }
        cachedPurchases = rawPurchases;
      } catch (pErr) {
        console.warn('Aviso ao carregar compras existentes:', pErr);
        cachedPurchases = [];
      }

      // Coleções auxiliares (campanhas, cupons, ofertas, atendimentos, tarefas, segmentos, uso de ofertas)
      // são carregadas pelos getX na sequência do refreshData, com as regras completas de cada uma.
      // Antes eram lidas aqui com limit(100) sem ordenação, o que deixava itens de fora.
      cachedCampaigns = null;
      cachedCoupons = null;
      cachedClubOffers = null;
      cachedClubOfferUsages = null;
      cachedInteractions = null;
      cachedTasks = null;
      cachedSegments = null;

      cachedDashboardMetrics = calculateDashboardMetrics(cachedCustomers, cachedPurchases || []);
      cachedRFMSummaries = computeRFMSegmentSummaries(cachedCustomers);
      cachedGeoSummaries = computeGeoNeighborhoodSummaries(cachedCustomers);

      isDatabaseInitialized = true;
      return { isSeeded: true, count: cachedCustomers.length };
    } else {
      // 2. Firestore sem clientes: mantém CRM limpo sem gerar dados fictícios
      console.log('[CRM Init] Firestore sem clientes cadastrados: operando com base limpa.');
      cachedCustomers = [];
      // Sem clientes não significa sem campanhas, cupons, ofertas, compras sem CPF etc.
      // Esses caches ficam null para serem lidos do Firestore (antes viravam [] e o que
      // existia ou fosse criado não aparecia enquanto a base de clientes estivesse vazia).
      cachedPurchases = null;
      cachedCampaigns = null;
      cachedCoupons = null;
      cachedClubOffers = null;
      cachedClubOfferUsages = null;
      cachedInteractions = null;
      cachedTasks = null;
      cachedSegments = null;
      cachedDashboardMetrics = calculateDashboardMetrics([], []);
      cachedRFMSummaries = computeRFMSegmentSummaries([]);
      cachedGeoSummaries = computeGeoNeighborhoodSummaries([]);
      isDatabaseInitialized = true;
      return { isSeeded: false, count: 0 };
    }
  } catch (err: any) {
    console.error('[CRM Init] Erro ao consultar Firestore na inicialização:', err?.message || err);
    throw err;
  }
}

// ----------------------------------------------------
// CUSTOMERS: PAGINATED & TARGETED QUERIES
// ----------------------------------------------------
export interface CustomerQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  segment?: string;
  optIn?: string;
  neighborhood?: string;
  sortBy?: 'totalSpent' | 'totalPurchases' | 'daysSinceLastPurchase' | 'name';
  sortOrder?: 'asc' | 'desc';
}

export async function getCustomersPaginated(params: CustomerQueryParams = {}): Promise<PaginatedResult<Customer>> {
  const {
    page = 1,
    pageSize = 25,
    search = '',
    segment = 'all',
    optIn = 'all',
    neighborhood = 'all',
    sortBy = 'totalSpent',
    sortOrder = 'desc'
  } = params;

  // If in-memory cache not populated, fetch initial working window
  if (!cachedCustomers) {
    try {
      const snap = await getDocs(query(collection(db, CUSTOMERS_COL), limit(200)));
      cachedCustomers = snap.docs.map(d => d.data() as Customer);
    } catch (err) {
      console.error('Erro ao carregar clientes do Firestore:', err);
      throw err;
    }
  }

  let filtered = cachedCustomers || [];

  // Filter by Search Query
  if (search.trim()) {
    const q = search.toLowerCase().replace(/[^a-z0-9]/g, '');
    filtered = filtered.filter(c => {
      const nameMatch = c.name.toLowerCase().includes(search.toLowerCase());
      const cpfMatch = c.cpf ? c.cpf.replace(/[^0-9]/g, '').includes(q) : false;
      const phoneMatch = c.whatsapp ? c.whatsapp.replace(/[^0-9]/g, '').includes(q) : false;
      const emailMatch = c.email ? c.email.toLowerCase().includes(search.toLowerCase()) : false;
      return nameMatch || cpfMatch || phoneMatch || emailMatch;
    });
  }

  // Filter by Segment
  if (segment !== 'all') {
    filtered = filtered.filter(c => c.rfmSegment === segment);
  }

  // Filter by Opt-In
  if (optIn === 'whatsapp_yes') {
    filtered = filtered.filter(c => c.consent?.whatsappMarketing);
  } else if (optIn === 'whatsapp_no') {
    filtered = filtered.filter(c => !c.consent?.whatsappMarketing);
  }

  // Filter by Neighborhood
  if (neighborhood !== 'all') {
    filtered = filtered.filter(c => c.neighborhood === neighborhood);
  }

  // Sort
  filtered.sort((a, b) => {
    let valA: any = a[sortBy] ?? 0;
    let valB: any = b[sortBy] ?? 0;
    if (typeof valA === 'string') {
      return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
    }
    return sortOrder === 'asc' ? valA - valB : valB - valA;
  });

  const totalCount = filtered.length;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const startIndex = (page - 1) * pageSize;
  const paginatedData = filtered.slice(startIndex, startIndex + pageSize);

  return {
    data: paginatedData,
    totalCount,
    hasMore: page < totalPages,
    page,
    totalPages
  };
}

export function normalizeCustomerConsent(raw: any, customerOrigin?: string): CustomerConsent {
  const existingConsent = raw?.consent;
  // Fonte única da verdade: consent.whatsappMarketing
  // Suporte a migração segura se o registro possuir consentWhatsApp legado na raiz
  const wa = typeof existingConsent?.whatsappMarketing === 'boolean'
    ? existingConsent.whatsappMarketing
    : (typeof raw?.consentWhatsApp === 'boolean' ? raw.consentWhatsApp : false);

  const em = typeof existingConsent?.emailMarketing === 'boolean' ? existingConsent.emailMarketing : false;
  const sms = typeof existingConsent?.smsMarketing === 'boolean' ? existingConsent.smsMarketing : false;

  return {
    whatsappMarketing: wa,
    emailMarketing: em,
    smsMarketing: sms,
    whatsappConsentDate: existingConsent?.whatsappConsentDate,
    emailConsentDate: existingConsent?.emailConsentDate,
    smsConsentDate: existingConsent?.smsConsentDate,
    origin: existingConsent?.origin || customerOrigin || raw?.origin || 'Cadastro',
    purpose: existingConsent?.purpose || 'Comunicação de ofertas e benefícios exclusivos Astral Clube',
    lastUpdated: existingConsent?.lastUpdated,
    history: existingConsent?.history || []
  };
}

/**
 * Validação rigorosa de número de WhatsApp / telefone celular brasileiro
 * Rejeita vazios, traços, zeros repetidos ou quantidades inválidas de dígitos.
 */
export function isValidWhatsAppNumber(rawVal: string | null | undefined): boolean {
  if (!rawVal) return false;
  const str = String(rawVal).trim();
  if (!str || str === '-' || str === '0') return false;
  const digits = str.replace(/\D/g, '');

  // Padrões aceitáveis:
  // - 10 dígitos: DDD (2) + 8 dígitos
  // - 11 dígitos: DDD (2) + 9 dígitos (padrão móvel/WhatsApp Brasil)
  // - 12 ou 13 dígitos: DDI 55 + DDD (2) + 8 ou 9 dígitos
  if (digits.length < 10 || digits.length > 13) {
    return false;
  }

  const effectiveDigits = (digits.startsWith('55') && digits.length >= 12)
    ? digits.slice(2)
    : digits;

  if (effectiveDigits.length !== 10 && effectiveDigits.length !== 11) {
    return false;
  }

  // Rejeita sequências de dígitos todos iguais (ex: 00000000000, 11111111111, 99999999999)
  if (/^(\d)\1+$/.test(effectiveDigits)) {
    return false;
  }

  // Validação do DDD brasileiro (11 a 99)
  const ddd = parseInt(effectiveDigits.slice(0, 2), 10);
  if (ddd < 11 || ddd > 99) {
    return false;
  }

  // Se tiver 11 dígitos (celular nacional), o primeiro dígito do número deve ser 9
  if (effectiveDigits.length === 11 && effectiveDigits[2] !== '9') {
    return false;
  }

  return true;
}

/**
 * Verifica se o cliente possui número de WhatsApp válido cadastrado
 */
export function possuiWhatsAppValido(customer: Customer | null | undefined): boolean {
  if (!customer) return false;
  return isValidWhatsAppNumber(customer.whatsapp);
}

/**
 * Regra ÚNICA de Elegibilidade para Campanhas de WhatsApp:
 * !customer.isAnonymized && customer.consent?.whatsappMarketing === true && possuiWhatsAppValido(customer)
 */
export function isCustomerEligibleForWhatsAppCampaign(customer: Customer | null | undefined): boolean {
  if (!customer) return false;
  if (customer.isAnonymized) return false;
  if (customer.consent?.whatsappMarketing !== true) return false;
  return possuiWhatsAppValido(customer);
}

/**
 * Regra unificada de elegibilidade de público para qualquer canal de campanha
 */
export function isCustomerEligibleForCampaign(
  customer: Customer,
  channel: CampaignChannel,
  onlyOptIn: boolean,
  targetSegment: string,
  targetNeighborhood?: string
): boolean {
  if (customer.isAnonymized) return false;
  if (targetSegment !== 'all' && customer.rfmSegment !== targetSegment) return false;
  if (targetNeighborhood && targetNeighborhood !== 'all' && customer.neighborhood !== targetNeighborhood) return false;

  if (channel === 'WhatsApp') {
    return isCustomerEligibleForWhatsAppCampaign(customer);
  }

  if (channel === 'E-mail') {
    const hasEmail = Boolean(customer.email && customer.email.trim() && customer.email.includes('@'));
    if (!hasEmail) return false;
    if (onlyOptIn && !customer.consent?.emailMarketing) return false;
    return true;
  }

  if (channel === 'SMS') {
    const hasPhone = isValidWhatsAppNumber(customer.phone || customer.whatsapp);
    if (!hasPhone) return false;
    if (onlyOptIn && !customer.consent?.smsMarketing) return false;
    return true;
  }

  return true;
}

const NUMERIC_CUSTOMER_FIELDS = [
  'totalSpent', 'totalPurchases', 'averageTicket', 'loyaltyPoints', 'loyaltyCashbackBalance',
  'recencyScore', 'frequencyScore', 'monetaryScore'
] as const;

/**
 * Cadastro lido do Firestore pronto para a tela. Clientes vindos do site ou de versões antigas
 * podem não ter os campos numéricos (a tela chamava .toFixed e quebrava); aqui viram 0 só em
 * memória, sem gravar nada. Consentimento passa pelo normalizador padrão.
 */
export function normalizeLoadedCustomer(raw: any, docId: string): Customer {
  const cust: any = {
    ...raw,
    id: raw?.id || docId,
    consent: normalizeCustomerConsent(raw, raw?.origin)
  };
  for (const f of NUMERIC_CUSTOMER_FIELDS) {
    const n = Number(cust[f]);
    cust[f] = Number.isFinite(n) ? n : 0;
  }
  if (!cust.rfmSegment) cust.rfmSegment = 'UNCLASSIFIED';
  if (!cust.rfmScoreCode) cust.rfmScoreCode = '000';
  delete cust.consentWhatsApp;
  return cust as Customer;
}

export async function getCustomers(options?: { forceRefresh?: boolean } | boolean): Promise<Customer[]> {
  const force = isForceRefresh(options);
  if (!cachedCustomers || force) {
    try {
      const snap = await getDocs(collection(db, CUSTOMERS_COL));
      cachedCustomers = snap.docs.map(d => normalizeLoadedCustomer(d.data(), d.id));
    } catch (err) {
      console.error('[Firestore Error] Falha ao carregar clientes do Firestore:', err);
      throw err;
    }
  }
  return cachedCustomers;
}

export async function getCustomerById(id: string): Promise<Customer | null> {
  if (cachedCustomers) {
    const found = cachedCustomers.find(c => c.id === id);
    if (found) return found;
  }

  try {
    const docSnap = await getDoc(doc(db, CUSTOMERS_COL, id));
    if (docSnap.exists()) {
      const raw = docSnap.data();
      const cust: Customer = {
        ...raw,
        id: raw.id || docSnap.id,
        consent: normalizeCustomerConsent(raw, raw.origin)
      } as Customer;
      delete (cust as any).consentWhatsApp;
      return cust;
    }
    return null;
  } catch (err) {
    console.error(`[Firestore Error] Erro ao buscar cliente ${id}:`, err);
    throw err;
  }
}

export async function getCustomersBySegment(segment: RFMSegmentType, limitCount = 50): Promise<Customer[]> {
  if (cachedCustomers) {
    const filtered = cachedCustomers.filter(c => c.rfmSegment === segment);
    if (filtered.length > 0) return filtered.slice(0, limitCount);
  }

  try {
    const q = query(
      collection(db, CUSTOMERS_COL),
      where('rfmSegment', '==', segment),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as Customer);
  } catch (err) {
    console.error(`[Firestore Error] Erro ao buscar clientes do segmento ${segment}:`, err);
    throw err;
  }
}

export async function saveCustomer(customer: Customer, user: UserProfile): Promise<Customer> {
  const normalizedConsent = normalizeCustomerConsent(customer, customer.origin);
  const cleanCustomer: Customer = {
    ...customer,
    consent: normalizedConsent
  };
  delete (cleanCustomer as any).consentWhatsApp;

  // 1. Grava no Firestore PRIMEIRO (não altera cache antes da confirmação da nuvem)
  try {
    await setDoc(doc(db, CUSTOMERS_COL, cleanCustomer.id), sanitizeForFirestore(cleanCustomer));
  } catch (err) {
    console.error('[Firestore Error] Falha ao salvar cliente no Firestore:', err);
    throw err;
  }

  // 2. Atualiza cache local SOMENTE após confirmação de sucesso do Firestore
  if (!cachedCustomers) cachedCustomers = [];
  const existingIdx = cachedCustomers.findIndex(c => c.id === cleanCustomer.id);
  const isNew = existingIdx === -1;

  if (isNew) cachedCustomers.unshift(cleanCustomer);
  else cachedCustomers[existingIdx] = cleanCustomer;

  // Atualiza métricas agregadas em cache
  if (cachedDashboardMetrics) {
    cachedDashboardMetrics = calculateDashboardMetrics(cachedCustomers, cachedPurchases || []);
  }

  await logAuditEvent(
    isNew ? 'criação_cliente' : 'alteração_cliente',
    `${isNew ? 'Cadastro de novo cliente' : 'Atualização de dados de cliente'}: ${cleanCustomer.name}`,
    user,
    'customers',
    cleanCustomer.id,
    { customerName: cleanCustomer.name }
  );

  return cleanCustomer;
}

/**
 * Clientes com o mesmo CPF (formatado ou só dígitos), consultando o Firestore e não só o cache,
 * para que o cadastro manual não crie duplicata de cliente que ainda não foi carregado na tela.
 */
export async function findCustomersByCpf(cpf: string): Promise<Customer[]> {
  const digits = cleanCpfDigits(cpf);
  if (digits.length !== 11) return [];
  const variants = Array.from(new Set([formatCpf(digits), digits]));
  const found = new Map<string, Customer>();
  for (const v of variants) {
    const snap = await getDocs(query(collection(db, CUSTOMERS_COL), where('cpf', '==', v), limit(5)));
    snap.docs.forEach(d => found.set(d.id, { ...(d.data() as Customer), id: d.id }));
  }
  (cachedCustomers || []).forEach(c => {
    if (cleanCpfDigits(c.cpf || '') === digits) found.set(c.id, c);
  });
  return Array.from(found.values()).filter(c => !c.isAnonymized);
}

/**
 * Atualiza só os campos informados de um cadastro existente (edição pelo formulário, geocodificação).
 * Usa updateDoc: campos fora do patch ficam intactos no Firestore; clearFields são apagados com deleteField().
 * A anonimização LGPD NÃO usa este caminho: ela precisa sobrescrever o documento inteiro (saveCustomer).
 */
export async function updateCustomerFields(
  id: string,
  patch: Partial<Customer>,
  clearFields: string[],
  user: UserProfile
): Promise<Customer> {
  let existing = cachedCustomers?.find(c => c.id === id);
  if (!existing) {
    const snap = await getDoc(doc(db, CUSTOMERS_COL, id));
    if (!snap.exists()) throw new Error('Cliente não encontrado para atualização.');
    existing = { ...(snap.data() as Customer), id };
  }
  if (existing.isAnonymized) {
    throw new Error('Cliente anonimizado (LGPD) não pode ser editado.');
  }

  const forbidden = ['id', 'isAnonymized', 'anonymizedAt'];
  const cleanPatch: Record<string, any> = sanitizeForFirestore({ ...patch }) as any;
  for (const f of forbidden) delete cleanPatch[f];
  const toClear = clearFields.filter(f => !forbidden.includes(f) && !(f in cleanPatch));

  const payload: Record<string, any> = { ...cleanPatch };
  for (const f of toClear) payload[f] = deleteField();
  if (Object.keys(payload).length === 0) return existing;

  try {
    await updateDoc(doc(db, CUSTOMERS_COL, id), payload);
  } catch (err) {
    console.error('[Firestore Error] Falha ao atualizar cliente no Firestore:', err);
    throw err;
  }

  const merged: Customer = { ...existing, ...cleanPatch } as Customer;
  for (const f of toClear) delete (merged as any)[f];

  if (cachedCustomers) {
    const idx = cachedCustomers.findIndex(c => c.id === id);
    if (idx >= 0) cachedCustomers[idx] = merged;
    else cachedCustomers.unshift(merged);
    if (cachedDashboardMetrics) {
      cachedDashboardMetrics = calculateDashboardMetrics(cachedCustomers, cachedPurchases || []);
    }
  }

  await logAuditEvent(
    'alteração_cliente',
    `Atualização de dados de cliente: ${merged.name}`,
    user,
    'customers',
    id,
    // Só os nomes dos campos, nunca os valores (evita dado pessoal no log).
    { customerName: merged.name, changedFields: Object.keys(cleanPatch), clearedFields: toClear }
  );

  return merged;
}

const RFM_STATUS_DOC = 'status';

/** Data (fuso de Brasília) da última recalculação RFM gravada. */
export async function getRFMLastRecalculatedDay(): Promise<string | null> {
  try {
    const snap = await getDoc(doc(db, 'rfm', RFM_STATUS_DOC));
    return snap.exists() ? (snap.data() as any)?.day || null : null;
  } catch (err) {
    console.warn('Falha ao ler status do RFM:', err);
    return null;
  }
}

export function rfmDayKey(date: Date = new Date()): string {
  return date.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
}

/**
 * Grava só os campos RFM que mudaram (merge), em lotes de 450, e marca o dia da recalculação.
 * Não regrava o cadastro inteiro: dados pessoais, consentimento e clube ficam intactos.
 */
export async function saveRFMChanges(
  changes: { id: string; patch: Record<string, any> }[],
  user: UserProfile,
  mode: 'manual' | 'automatica'
): Promise<void> {
  const CHUNK_SIZE = 450;
  for (let i = 0; i < changes.length; i += CHUNK_SIZE) {
    const batch = writeBatch(db);
    for (const ch of changes.slice(i, i + CHUNK_SIZE)) {
      batch.set(doc(db, CUSTOMERS_COL, ch.id), sanitizeForFirestore(ch.patch), { merge: true });
    }
    await batch.commit();
  }

  if (cachedCustomers) {
    const byId = new Map(changes.map(c => [c.id, c.patch]));
    cachedCustomers = cachedCustomers.map(c => (byId.has(c.id) ? { ...c, ...byId.get(c.id) } : c));
    cachedDashboardMetrics = calculateDashboardMetrics(cachedCustomers, cachedPurchases || []);
    cachedRFMSummaries = computeRFMSegmentSummaries(cachedCustomers);
  }

  await setDoc(doc(db, 'rfm', RFM_STATUS_DOC), {
    day: rfmDayKey(),
    recalculatedAt: new Date().toISOString(),
    by: user.name,
    mode,
    changedCustomers: changes.length
  });
}

export async function saveCustomersBatch(customers: Customer[], user?: UserProfile): Promise<void> {
  if (customers.length === 0) return;
  const CHUNK_SIZE = 450;
  const totalBatches = Math.ceil(customers.length / CHUNK_SIZE);

  for (let b = 0; b < totalBatches; b++) {
    const chunk = customers.slice(b * CHUNK_SIZE, (b + 1) * CHUNK_SIZE);
    const batch = writeBatch(db);
    for (const c of chunk) {
      const normalizedConsent = normalizeCustomerConsent(c, c.origin);
      const cleanCustomer: Customer = {
        ...c,
        consent: normalizedConsent
      };
      delete (cleanCustomer as any).consentWhatsApp;
      batch.set(doc(db, CUSTOMERS_COL, cleanCustomer.id), sanitizeForFirestore(cleanCustomer), { merge: true });
    }
    await batch.commit();
  }

  // Atualiza cache em memória
  if (cachedCustomers) {
    const custMap = new Map(customers.map(c => [c.id, c]));
    cachedCustomers = cachedCustomers.map(c => custMap.get(c.id) || c);
  }
}

export async function deleteCustomer(id: string, user: UserProfile): Promise<void> {
  // 1. Deleta PRIMEIRO no Firestore (não altera cache antes da confirmação da nuvem)
  try {
    await deleteDoc(doc(db, CUSTOMERS_COL, id));
  } catch (err) {
    console.error('[Firestore Error] Falha ao deletar cliente no Firestore:', err);
    throw err;
  }

  // 2. Remove do cache SOMENTE após confirmação de sucesso do Firestore
  if (cachedCustomers) {
    cachedCustomers = cachedCustomers.filter(c => c.id !== id);
  }

  if (cachedDashboardMetrics && cachedCustomers) {
    cachedDashboardMetrics = calculateDashboardMetrics(cachedCustomers, cachedPurchases || []);
  }

  await logAuditEvent('exclusão_cliente', `Exclusão do cliente (ID: ${id})`, user, 'customers', id);
}

/** ID do cliente criado na importação do PDV: derivado do CPF (estável), sem expor o CPF. */
export function pdvCustomerId(cpfDigits: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  const input = `pdv-cpf:${cpfDigits}`;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `cust-pdv-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/** Rótulo curto e estável para o titular anonimizado, sem conter o ID original (que pode ter CPF). */
export function anonymizationLabel(customerId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < customerId.length; i++) {
    h = Math.imul(h ^ customerId.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h.toString(36).toUpperCase().padStart(7, '0').slice(-7);
}

/** Remove de textos livres o nome e o CPF/CNPJ do titular. */
export function buildPersonalDataRedactor(customer: Pick<Customer, 'name' | 'cpf' | 'cnpj' | 'whatsapp' | 'phone' | 'email'>, replacement: string) {
  const escape = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns: RegExp[] = [];
  const name = (customer.name || '').trim();
  if (name.length >= 3) patterns.push(new RegExp(escape(name), 'gi'));
  for (const doc of [customer.cpf, customer.cnpj, customer.whatsapp, customer.phone]) {
    const digits = String(doc || '').replace(/\D/g, '');
    if (digits.length >= 8) {
      // casa os dígitos com ou sem pontuação entre eles
      patterns.push(new RegExp(digits.split('').map(escape).join('[\\s.\\-/()]*'), 'g'));
    }
  }
  const email = (customer.email || '').trim();
  if (email.includes('@')) patterns.push(new RegExp(escape(email), 'gi'));
  return (text: unknown): string | null => {
    if (text === undefined || text === null) return null;
    let out = String(text);
    for (const re of patterns) out = out.replace(re, replacement);
    return out;
  };
}

/** Atualiza, em lotes, todos os documentos de uma coleção ligados ao titular. Lança erro se falhar. */
async function anonymizeDocsByCustomerId(
  colName: string,
  customerId: string,
  build: (data: any) => Record<string, any>,
  movesOutOfQuery = false
): Promise<number> {
  const BATCH = 150;
  let processed = 0;
  let last: any = null;
  let rounds = 0;
  while (true) {
    if (++rounds > 100000) throw new Error(`Anonimização LGPD interrompida em ${colName}: número de lotes acima do esperado.`);
    const constraints: any[] = [where('customerId', '==', customerId), orderBy(documentId()), limit(BATCH)];
    // Se o update troca o customerId, os documentos tratados saem da consulta (sem cursor)
    if (last && !movesOutOfQuery) constraints.push(startAfter(last));
    let snap;
    try {
      snap = await getDocs(query(collection(db, colName), ...constraints));
    } catch (err: any) {
      throw new Error(`Anonimização LGPD incompleta: falha ao consultar ${colName} (${err?.code || err?.message || err}). Documentos processados: ${processed}.`);
    }
    if (snap.empty) break;
    const batch = writeBatch(db);
    snap.docs.forEach(d => {
      const update = build(d.data());
      Object.keys(update).forEach(k => update[k] === undefined && delete update[k]);
      batch.update(d.ref, update);
    });
    try {
      await batch.commit();
    } catch (err: any) {
      throw new Error(`Anonimização LGPD incompleta: falha ao gravar ${colName} (${err?.code || err?.message || err}). Documentos processados: ${processed}.`);
    }
    processed += snap.docs.length;
    last = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < BATCH) break;
  }
  return processed;
}

export async function anonymizeCustomerLGPD(id: string, user: UserProfile): Promise<Customer | null> {
  const customer = await getCustomerById(id);
  if (!customer) return null;

  const nowIso = new Date().toISOString();
  // Rótulo sem dado pessoal: IDs como cust-flex-<CPF> não podem aparecer no nome anonimizado
  const anonymizedLabel = anonymizationLabel(customer.id);
  const anonymizedName = `Titular Anonimizado #${anonymizedLabel}`;
  // IDs com sequência numérica longa (ex.: cust-flex-<CPF>) recebem um ID novo, e todas as referências
  // (compras, atendimentos, tarefas, uso/seleção de ofertas) passam para ele.
  const ownDocs = [customer.cpf, customer.cnpj].map(v => String(v || '').replace(/\D/g, '')).filter(d => d.length >= 11);
  const idHasPersonalData =
    ownDocs.some(d => customer.id.includes(d)) || /(^|\D)(\d{11}|\d{14})(\D|$)/.test(customer.id);
  const newId = idHasPersonalData ? `cust-anon-${pdvCustomerId(`anon:${customer.id}`).slice('cust-pdv-'.length)}` : customer.id;
  const rekeying = newId !== customer.id;

  const anonymized: Customer = {
    ...customer,
    id: newId,
    name: anonymizedName,
    cpf: '***.***.***-**',
    whatsapp: '',
    phone: undefined,
    email: undefined,
    birthDate: undefined,
    code: undefined,
    personType: undefined,
    cnpj: undefined,
    rgIe: undefined,
    gender: undefined,
    cardName: undefined,
    companyName: undefined,
    address: 'Endereço Anonimizado conforme LGPD',
    number: undefined,
    complement: undefined,
    neighborhood: undefined,
    city: undefined,
    state: undefined,
    cep: undefined,
    latitude: undefined,
    longitude: undefined,
    geocodeStatus: undefined,
    geocodeError: undefined,
    notes: 'Dados pessoais anonimizados a pedido do titular conforme Art. 18 da LGPD (Direito ao Esquecimento).',
    isAnonymized: true,
    anonymizedAt: nowIso,
    isClubMember: false,
    tags: [],
    consent: {
      whatsappMarketing: false,
      emailMarketing: false,
      smsMarketing: false,
      origin: 'Direito ao Esquecimento LGPD',
      purpose: 'Anonimização realizada',
      lastUpdated: nowIso,
      history: [
        ...(customer.consent?.history || []),
        {
          type: 'whatsapp',
          status: false,
          date: nowIso,
          origin: 'Direito ao Esquecimento LGPD',
          updatedBy: user?.name || 'Encarregado DPO / LGPD'
        }
      ]
    }
  };

  // Anonimiza dados pessoais no histórico de compras do titular em memória e no Firestore
  if (cachedPurchases) {
    cachedPurchases.forEach(p => {
      if (p.customerId === id) {
        p.customerId = newId;
        p.customerName = anonymizedName;
        p.customerCpf = '***.***.***-**';
        p.customerPhone = undefined;
      }
    });
  }

  // Anonimização paginada de todas as compras vinculadas ao titular no Firestore
  let totalPurchasesCount = 0;
  try {
    const countSnap = await getCountFromServer(
      query(collection(db, PURCHASES_COL), where('customerId', '==', id))
    );
    totalPurchasesCount = countSnap.data().count;
  } catch (countErr) {
    console.warn('[LGPD] Contagem prévia de compras via getCountFromServer não disponível, prosseguindo com paginação dinâmica:', countErr);
    totalPurchasesCount = -1;
  }

  const BATCH_SIZE = 150;
  let totalProcessed = 0;
  let batchIndex = 0;
  let lastDocSnap: any = null;

  while (true) {
    batchIndex++;
    if (batchIndex > 100000) throw new Error('Anonimização LGPD interrompida: número de lotes acima do esperado.');
    const constraints: any[] = [
      where('customerId', '==', id),
      orderBy(documentId()),
      limit(BATCH_SIZE)
    ];

    // Ao trocar o customerId as compras já tratadas saem da consulta; sem cursor nesse caso.
    if (lastDocSnap && !rekeying) {
      constraints.push(startAfter(lastDocSnap));
    }

    const q = query(collection(db, PURCHASES_COL), ...constraints);
    let pSnap;
    try {
      pSnap = await getDocs(q);
    } catch (queryErr: any) {
      const errInfo = {
        batchIndex,
        totalProcessed,
        errorCode: queryErr?.code || 'PURCHASE_QUERY_ERROR',
        errorMessage: queryErr?.message || String(queryErr)
      };
      console.error(`[LGPD] Erro ao consultar compras no lote ${batchIndex}:`, errInfo);
      throw new Error(`Anonimização LGPD incompleta. Falha na consulta do lote ${batchIndex} (${errInfo.errorCode}: ${errInfo.errorMessage}). Compras processadas até o erro: ${totalProcessed}.`);
    }

    if (pSnap.empty) {
      break;
    }

    const batch = writeBatch(db);
    pSnap.docs.forEach(docSnap => {
      batch.update(docSnap.ref, {
        customerId: newId,
        customerName: anonymizedName,
        customerCpf: '***.***.***-**',
        customerPhone: null
      });
    });

    try {
      await batch.commit();
    } catch (batchErr: any) {
      const errInfo = {
        batchIndex,
        totalProcessed,
        batchCount: pSnap.docs.length,
        errorCode: batchErr?.code || 'BATCH_COMMIT_ERROR',
        errorMessage: batchErr?.message || String(batchErr)
      };
      console.error(`[LGPD] Falha ao comitar lote ${batchIndex} da anonimização de compras:`, errInfo);
      throw new Error(`Anonimização LGPD incompleta. Falha no commit do lote ${batchIndex} (${errInfo.errorCode}: ${errInfo.errorMessage}). Compras processadas até o erro: ${totalProcessed}.`);
    }

    totalProcessed += pSnap.docs.length;
    lastDocSnap = pSnap.docs[pSnap.docs.length - 1];

    if (pSnap.docs.length < BATCH_SIZE) {
      break;
    }
  }

  if (totalPurchasesCount > 0 && totalProcessed < totalPurchasesCount) {
    throw new Error(`Anonimização LGPD incompleta. Esperadas ${totalPurchasesCount} compras, mas apenas ${totalProcessed} foram processadas.`);
  }

  // Demais coleções com dados do titular (atendimentos, tarefas, uso de ofertas do clube).
  // Nome/CPF/telefone viram o rótulo anônimo; textos livres têm nome e CPF do titular removidos.
  const redactText = buildPersonalDataRedactor(customer, anonymizedName);
  const relatedCounts: Record<string, number> = {};
  const relatedTargets: Array<{ col: string; build: (data: any) => Record<string, any> }> = [
    {
      col: INTERACTIONS_COL,
      build: d => ({
        customerId: newId,
        customerName: anonymizedName,
        subject: redactText(d.subject),
        description: redactText(d.description),
        resolution: d.resolution === undefined ? null : redactText(d.resolution)
      })
    },
    {
      col: TASKS_COL,
      build: d => ({
        customerId: newId,
        customerName: anonymizedName,
        title: redactText(d.title),
        description: redactText(d.description)
      })
    },
    {
      col: CLUB_OFFER_USAGES_COL,
      build: () => ({ customerId: newId, customerName: anonymizedName, customerCpf: '***.***.***-**' })
    }
  ];
  for (const target of relatedTargets) {
    relatedCounts[target.col] = await anonymizeDocsByCustomerId(target.col, id, target.build, rekeying);
  }

  // Ofertas do clube com o titular na lista de selecionados
  if (rekeying) {
    try {
      const offersSnap = await getDocs(collection(db, CLUB_OFFERS_COL));
      const offerBatch = writeBatch(db);
      let offersToUpdate = 0;
      offersSnap.docs.forEach(d => {
        const ids: string[] = (d.data() as any).selectedCustomerIds || [];
        if (ids.includes(id)) {
          offerBatch.update(d.ref, { selectedCustomerIds: ids.map(x => (x === id ? newId : x)) });
          offersToUpdate++;
        }
      });
      if (offersToUpdate > 0) await offerBatch.commit();
      relatedCounts[CLUB_OFFERS_COL] = offersToUpdate;
    } catch (err: any) {
      throw new Error(`Anonimização LGPD incompleta: falha ao atualizar ofertas do clube (${err?.code || err?.message || err}).`);
    }
    cachedClubOffers?.forEach(o => {
      if (o.selectedCustomerIds?.includes(id)) o.selectedCustomerIds = o.selectedCustomerIds.map(x => (x === id ? newId : x));
    });
  }

  // Caches em memória
  cachedInteractions?.forEach(i => {
    if (i.customerId === id) {
      i.customerId = newId;
      i.customerName = anonymizedName;
      i.subject = redactText(i.subject) as any;
      i.description = redactText(i.description) as any;
      if (i.resolution !== undefined) i.resolution = redactText(i.resolution) as any;
    }
  });
  cachedTasks?.forEach(t => {
    if (t.customerId === id) {
      t.customerId = newId;
      t.customerName = anonymizedName;
      t.title = redactText(t.title) as any;
      t.description = redactText(t.description) as any;
    }
  });
  cachedClubOfferUsages?.forEach(u => {
    if (u.customerId === id) {
      u.customerId = newId;
      u.customerName = anonymizedName;
      u.customerCpf = '***.***.***-**';
    }
  });

  // Por último o cadastro: as referências já apontam para o ID novo. Se algo falhar antes daqui,
  // o cadastro antigo continua existindo e repetir a anonimização retoma o processo (ID novo é determinístico).
  // Salva no Firestore sobrescrevendo o documento completamente com apenas os campos anonimizados (sem merge)
  await saveCustomer(anonymized, user);
  if (rekeying) {
    // Remove o documento antigo (o ID dele continha dado pessoal). Sem deleteCustomer para não
    // registrar o ID antigo em um novo log de auditoria.
    try {
      await deleteDoc(doc(db, CUSTOMERS_COL, id));
    } catch (err: any) {
      throw new Error(`Anonimização LGPD incompleta para o cliente: o novo registro foi criado, mas o antigo não pôde ser removido (${err?.code || err?.message || err}).`);
    }
    if (cachedCustomers) cachedCustomers = cachedCustomers.filter(c => c.id !== id);
  }

  await logAuditEvent(
    'anonimização_lgpd',
    `Direito ao esquecimento executado: anonimização do titular ${anonymizedName} conforme Art. 18 da LGPD (${totalProcessed} compras despersonalizadas em ${batchIndex} lotes).`,
    user,
    'customers',
    newId,
    {
      anonymizedAt: nowIso,
      totalPurchasesAnonymized: totalProcessed,
      batchesCount: batchIndex,
      interactionsAnonymized: relatedCounts[INTERACTIONS_COL] || 0,
      tasksAnonymized: relatedCounts[TASKS_COL] || 0,
      clubOfferUsagesAnonymized: relatedCounts[CLUB_OFFER_USAGES_COL] || 0
    }
  );

  return anonymized;
}

// ----------------------------------------------------
// PURCHASES: PAGINATED & TARGETED QUERIES
// ----------------------------------------------------
export interface PurchaseQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  storeId?: string;
  paymentMethod?: string;
  customerId?: string;
  startDate?: string;
  endDate?: string;
}

export async function getPurchasesPaginated(params: PurchaseQueryParams = {}): Promise<PaginatedResult<Purchase> & { totalRevenue: number }> {
  const {
    page = 1,
    pageSize = 25,
    search = '',
    storeId = 'all',
    paymentMethod = 'all',
    customerId,
    startDate,
    endDate
  } = params;

  // Usa a base completa. Antes, sem cache, carregava só 300 compras e guardava esse recorte como
  // se fosse a base inteira (cachedPurchases), o que contaminava RFM e totais calculados depois.
  let filtered = await getPurchases();

  if (customerId) {
    filtered = filtered.filter(p => p.customerId === customerId);
  }

  if (search.trim()) {
    const q = search.toLowerCase();
    filtered = filtered.filter(p => {
      const matchName = p.customerName.toLowerCase().includes(q);
      const matchCpf = p.customerCpf ? p.customerCpf.includes(q) : false;
      const matchCupom = p.couponReceiptNumber.toLowerCase().includes(q);
      return matchName || matchCpf || matchCupom;
    });
  }

  if (storeId !== 'all') {
    filtered = filtered.filter(p => p.storeId === storeId || p.storeName === storeId);
  }

  if (paymentMethod !== 'all') {
    filtered = filtered.filter(p => p.paymentMethod === paymentMethod);
  }

  if (startDate) {
    filtered = filtered.filter(p => p.purchaseDate >= startDate);
  }

  if (endDate) {
    filtered = filtered.filter(p => p.purchaseDate <= endDate);
  }

  filtered.sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime());

  const totalRevenue = filtered.reduce((acc, p) => acc + (p.netAmount || 0), 0);
  const totalCount = filtered.length;
  const totalPages = Math.ceil(totalCount / pageSize) || 1;
  const startIndex = (page - 1) * pageSize;
  const paginatedData = filtered.slice(startIndex, startIndex + pageSize);

  return {
    data: paginatedData,
    totalCount,
    hasMore: page < totalPages,
    page,
    totalPages,
    totalRevenue
  };
}

export async function getPurchases(options?: { forceRefresh?: boolean } | boolean): Promise<Purchase[]> {
  const force = isForceRefresh(options);
  if (!cachedPurchases || force) {
    try {
      const snap = await getDocs(query(collection(db, PURCHASES_COL), orderBy('purchaseDate', 'desc')));
      cachedPurchases = snap.docs.map(d => ({ ...d.data(), id: d.data().id || d.id } as Purchase));
    } catch (err) {
      console.error('Erro ao carregar compras:', err);
      throw err;
    }
  }
  return cachedPurchases || [];
}

export async function getPurchasesByCustomerId(customerId: string, limitCount = 50): Promise<Purchase[]> {
  if (cachedPurchases) {
    const filtered = cachedPurchases.filter(p => p.customerId === customerId);
    if (filtered.length > 0) {
      return filtered
        .sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime())
        .slice(0, limitCount);
    }
  }

  try {
    const q = query(
      collection(db, PURCHASES_COL),
      where('customerId', '==', customerId),
      orderBy('purchaseDate', 'desc'),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as Purchase);
  } catch (err) {
    console.warn(`Erro ao buscar compras do cliente ${customerId}:`, err);
    return [];
  }
}

export interface PDVImportProgress {
  processed: number;
  total: number;
  imported: number;
  newCustomers: number;
  linkedCustomers: number;
  itemsProcessed: number;
  duplicates?: number;
  errors: number;
  percentage: number;
  currentBatch: number;
  totalBatches: number;
  currentStep: string;
}

export interface PDVImportResult {
  totalFound: number;
  validCount: number;
  persistedCount: number;
  importedCount: number;
  duplicatesCount: number;
  ignoredCount: number;
  newCustomersCount: number;
  linkedCustomersCount: number;
  itemsProcessedCount: number;
  errorsCount: number;
  batchesSucceeded: number;
  batchesFailed: number;
  lastErrorMessage?: string;
  stageSummary: {
    readSuccess: boolean;
    parseSuccess: boolean;
    dbWriteSuccess: boolean;
  };
  errorsList: { rowNumber: number; receiptNo?: string; reason: string }[];
}

export async function importPurchasesBatch(
  newPurchases: Purchase[], 
  user: UserProfile,
  autoCreateCustomers = true,
  onProgress?: (progress: PDVImportProgress) => void
): Promise<PDVImportResult> {
  const allCustomers = await getCustomers();
  const allPurchases = await getPurchases();
  
  // Index existing customers by clean CPF digits and ID
  const customerByCpf = new Map<string, Customer>();
  const customerById = new Map<string, Customer>();
  for (const c of allCustomers) {
    if (c.cpf) {
      const d = c.cpf.replace(/\D/g, '');
      if (d) customerByCpf.set(d, c);
    }
    customerById.set(c.id, c);
  }

  // Index existing purchases for deterministic deduplication.
  // A loja de cada compra existente é a loja física (nome/endereço gravado), não só o storeId:
  // compras gravadas antes da correção de 29/09/2026 têm store-01/store-02 invertidos.
  const existingPurchasesMap = new Map<string, Purchase>();
  const existingPurchaseById = new Map<string, Purchase>();
  for (const p of allPurchases) {
    if (p.id) {
      existingPurchasesMap.set(p.id, p);
      existingPurchaseById.set(p.id, p);
    }
    if (p.couponReceiptNumber) {
      const cleanStore = (getRecordStoreId(p.storeId, p.storeName) || 'sem-loja').replace(/[^a-zA-Z0-9_-]/g, '');
      const cleanReceipt = p.couponReceiptNumber.replace(/[^a-zA-Z0-9_-]/g, '');
      const cleanDate = p.purchaseDate ? p.purchaseDate.slice(0, 10).replace(/[^0-9]/g, '') : '';
      existingPurchasesMap.set(`${cleanStore}_${cleanReceipt}_${cleanDate}`, p);
    }
  }

  const totalFound = newPurchases.length;
  let validCount = 0;
  let duplicatesCount = 0;
  let ignoredCount = 0;
  let newCustCount = 0;
  let linkedCustCount = 0;
  let itemsCount = 0;
  let batchesSucceeded = 0;
  let batchesFailed = 0;
  let lastErrorMessage = '';

  const errorsList: { rowNumber: number; receiptNo?: string; reason: string }[] = [];
  const purchasesToInsert: Purchase[] = [];
  const newlyCreatedCustomers = new Map<string, Customer>();
  const affectedCustomerIds = new Set<string>();

  // 1. Filtragem, deduplicação e vinculação de clientes
  for (let i = 0; i < newPurchases.length; i++) {
    const p = newPurchases[i];
    const totalVal = p.netAmount > 0 ? p.netAmount : (p.totalAmount > 0 ? p.totalAmount : 0);

    if (totalVal <= 0) {
      ignoredCount++;
      errorsList.push({
        rowNumber: i + 1,
        receiptNo: p.couponReceiptNumber,
        reason: 'Cupom fiscal com valor total zerado ou inválido (R$ 0,00)'
      });
      continue;
    }

    // ID determinístico estável para idempotência absoluta
    const cleanStore = (p.storeId || 'sem-loja').replace(/[^a-zA-Z0-9_-]/g, '');
    const cleanReceipt = (p.couponReceiptNumber || '').replace(/[^a-zA-Z0-9_-]/g, '');
    // Sem ID do importador e sem número de cupom não há identificador estável (nunca usar a posição na lista)
    // IDs estáveis aceitos: pdv_ (importador do PDV) e online_ (pedidos da loja online)
    const hasStableId = !!p.id && (p.id.startsWith('pdv_') || p.id.startsWith('online_'));
    if (!hasStableId && !cleanReceipt) {
      ignoredCount++;
      errorsList.push({
        rowNumber: i + 1,
        reason: 'Cupom sem número e sem identificador estável; compra não gravada.'
      });
      continue;
    }

    validCount++;
    itemsCount += p.items ? p.items.length : (p.itemsCount || 1);
    const cleanDate = p.purchaseDate ? p.purchaseDate.slice(0, 10).replace(/[^0-9]/g, '') : 'nodate';
    const deterministicId = hasStableId ? p.id : `pdv_${cleanStore}_${cleanReceipt}_${cleanDate}`;
    p.id = deterministicId;

    // Sem número de cupom a deduplicação é feita só pelo ID (evita chave genérica loja+data)
    const dedupeKey = cleanReceipt ? `${cleanStore}_${cleanReceipt}_${cleanDate}` : deterministicId;

    // Verificação de compra já existente (evita duplicar compras e métricas se o arquivo for reimportado)
    // Mesmo ID gravado para OUTRA loja física (registro anterior à correção das lojas ainda não migrado):
    // gravar sobrescreveria a venda da outra loja. Não grava e pede a migração.
    const sameIdPurchase = existingPurchaseById.get(deterministicId);
    if (sameIdPurchase && getRecordStoreId(sameIdPurchase.storeId, sameIdPurchase.storeName) !== getRecordStoreId(p.storeId, p.storeName)) {
      ignoredCount++;
      errorsList.push({
        rowNumber: i + 1,
        receiptNo: p.couponReceiptNumber,
        reason: `O identificador ${deterministicId} já pertence a uma compra de outra loja (registro anterior à correção das lojas). Execute scripts/fix-store-ids.mjs e importe novamente.`
      });
      continue;
    }
    if (existingPurchasesMap.has(deterministicId) || existingPurchasesMap.has(dedupeKey)) {
      duplicatesCount++;
      continue;
    }

    // Identificação de cliente por CPF válido
    const cpfDigits = cleanCpfDigits(p.customerCpf);
    const hasValidCpf = isValidCpf(cpfDigits);
    let customer = (hasValidCpf ? customerByCpf.get(cpfDigits) : undefined) || 
                   (p.customerId ? customerById.get(p.customerId) : undefined);

    // Criação de novo cliente apenas se possuir CPF comprovadamente VÁLIDO e autoCreateCustomers ativado
    if (!customer && autoCreateCustomers && hasValidCpf) {
      const formattedCpf = formatCpf(cpfDigits);
      // ID determinístico pelo CPF (mesma pessoa => mesmo documento, inclusive em importações
      // simultâneas) e sem o CPF em texto no ID. Nunca reaproveita o ID de outro cliente.
      let newId = pdvCustomerId(cpfDigits);
      for (let attempt = 1; customerById.has(newId) && cleanCpfDigits(customerById.get(newId)!.cpf) !== cpfDigits; attempt++) {
        newId = `${pdvCustomerId(cpfDigits)}-${attempt}`;
      }
      const nowIso = p.purchaseDate || new Date().toISOString();

      customer = {
        id: newId,
        name: (p.customerName || '').trim(), // sem nome no cupom: permanece vazio até Flex/cadastro manual
        cpf: formattedCpf,
        phone: p.customerPhone || undefined,
        whatsapp: p.customerPhone || '',
        origin: 'PDV Importação',
        createdAt: nowIso,
        updatedAt: new Date().toISOString(),
        createdBy: user?.name || 'Sistema PDV',
        consent: {
          whatsappMarketing: false,
          emailMarketing: false,
          smsMarketing: false,
          origin: 'PDV Identificado',
          purpose: 'Identificação no Cupom Fiscal'
        },
        totalSpent: 0,
        totalPurchases: 0,
        averageTicket: 0,
        daysSinceLastPurchase: 0,
        lastPurchaseDate: p.purchaseDate,
        rfmSegment: 'UNCLASSIFIED',
        recencyScore: 0,
        frequencyScore: 0,
        monetaryScore: 0,
        rfmScoreCode: '000',
        loyaltyPoints: 0,
        loyaltyCashbackBalance: 0
      };

      allCustomers.push(customer);
      customerByCpf.set(cpfDigits, customer);
      customerById.set(newId, customer);
      newlyCreatedCustomers.set(newId, customer);
      newCustCount++;
    }

    if (customer) {
      p.customerId = customer.id;
      p.customerName = customer.name;
      p.customerCpf = customer.cpf;
      affectedCustomerIds.add(customer.id);
      if (!newlyCreatedCustomers.has(customer.id)) {
        linkedCustCount++;
      }
    } else {
      // Cupom não identificado (sem CPF ou cliente não cadastrado)
      p.customerId = '';
    }

    purchasesToInsert.push(p);
    existingPurchasesMap.set(deterministicId, p);
    existingPurchasesMap.set(dedupeKey, p);
  }

  const totalToSave = purchasesToInsert.length;
  const CHUNK_SIZE = 200; // Limite seguro para Firestore writeBatch
  const totalBatches = Math.max(1, Math.ceil(totalToSave / CHUNK_SIZE));
  const actuallySavedPurchases: Purchase[] = [];

  // 2. Gravação em lotes das compras no Firestore
  if (totalToSave > 0) {
    if (onProgress) {
      onProgress({
        processed: 0,
        total: totalFound,
        imported: 0,
        newCustomers: newCustCount,
        linkedCustomers: linkedCustCount,
        itemsProcessed: itemsCount,
        duplicates: duplicatesCount,
        errors: errorsList.length,
        percentage: 0,
        currentBatch: 0,
        totalBatches,
        currentStep: `Iniciando gravação de ${totalToSave.toLocaleString('pt-BR')} compras em ${totalBatches} lote(s)...`
      });
    }

    for (let b = 0; b < totalBatches; b++) {
      const start = b * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalToSave);
      const chunk = purchasesToInsert.slice(start, end);

      if (chunk.length > 0) {
        try {
          const batch = writeBatch(db);
          for (const item of chunk) {
            batch.set(doc(db, PURCHASES_COL, item.id), sanitizeForFirestore(item), { merge: true });
          }
          await batch.commit();
          batchesSucceeded++;
          actuallySavedPurchases.push(...chunk);
        } catch (batchErr: any) {
          batchesFailed++;
          const batchCode = batchErr?.code || 'error';
          const errMsg = `Lote ${b + 1}/${totalBatches} (${chunk.length} cupons) falhou [${batchCode}]: ${batchErr?.message || String(batchErr)}`;
          lastErrorMessage = errMsg;
          console.error(`[Firestore PDV] ${errMsg}`);
          errorsList.push({
            rowNumber: start + 1,
            reason: errMsg
          });
        }
      }

      const processedCount = Math.min(end, totalToSave);
      const pct = totalFound > 0 ? Math.round((processedCount / totalFound) * 100) : 100;

      if (onProgress) {
        onProgress({
          processed: processedCount,
          total: totalFound,
          imported: actuallySavedPurchases.length,
          newCustomers: newCustCount,
          linkedCustomers: linkedCustCount,
          itemsProcessed: itemsCount,
          duplicates: duplicatesCount,
          errors: errorsList.length,
          percentage: pct,
          currentBatch: b + 1,
          totalBatches,
          currentStep: `Gravando lote ${b + 1} de ${totalBatches} (${actuallySavedPurchases.length.toLocaleString('pt-BR')} cupons confirmados no Firestore)...`
        });
      }

      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }

  // 3. Recálculo cirúrgico e persistência de clientes afetados no Firestore
  const savedCustomerIds = new Set(actuallySavedPurchases.map(p => p.customerId).filter(Boolean));
  const customersToPersist: Customer[] = [];

  for (const customerId of savedCustomerIds) {
    const cust = customerById.get(customerId);
    if (!cust) continue;

    // Agrupa compras existentes + compras recém-gravadas deste cliente
    const custPurchasesMap = new Map<string, Purchase>();
    for (const ep of allPurchases) {
      if (ep.customerId === customerId) custPurchasesMap.set(ep.id, ep);
    }
    for (const np of actuallySavedPurchases) {
      if (np.customerId === customerId) custPurchasesMap.set(np.id, np);
    }

    const custPurchases = Array.from(custPurchasesMap.values());
    if (custPurchases.length === 0) continue;

    const now = new Date();
    const windowMetrics = computeRFMWindowMetrics(
      custPurchases,
      getRFMWindowDays(DEFAULT_RFM_CONFIG),
      now
    );

    const sortedDates = custPurchases
      .map(p => p.purchaseDate)
      .filter(Boolean)
      .sort();
    const firstPurchaseDate = sortedDates[0] || cust.createdAt;
    const lastPurchaseDate = windowMetrics.lastPurchaseDate || sortedDates[sortedDates.length - 1] || cust.createdAt;

    const totalSpent = windowMetrics.totalSpent;
    const totalPurchases = windowMetrics.totalPurchases;
    const averageTicket = totalPurchases > 0 ? parseFloat((totalSpent / totalPurchases).toFixed(2)) : 0;
    const daysSinceLastPurchase = windowMetrics.daysSinceLastPurchase;

    // Recálculo RFM centralizado com suporte a janela móvel
    const rfm = calculateCustomerRFM({
      totalPurchases,
      totalSpent,
      daysSinceLastPurchase,
      lastPurchaseDate,
      rfmFrequency: windowMetrics.rfmFrequency,
      rfmMonetary: windowMetrics.rfmMonetary
    }, DEFAULT_RFM_CONFIG);
    const recencyScore = rfm.recencyScore;
    const frequencyScore = rfm.frequencyScore;
    const monetaryScore = rfm.monetaryScore;
    const rfmSegment = rfm.rfmSegment;

    // Loja de maior frequência
    const storeCount = new Map<string, { id: string; name: string; count: number }>();
    for (const cp of custPurchases) {
      // Loja física da compra (corrige compras antigas com store-01/store-02 invertidos)
      const physicalStoreId = getRecordStoreId(cp.storeId, cp.storeName);
      if (physicalStoreId) {
        const cur = storeCount.get(physicalStoreId) || {
          id: physicalStoreId,
          name: getStoreLabel(physicalStoreId) || cp.storeName || physicalStoreId,
          count: 0
        };
        cur.count++;
        storeCount.set(physicalStoreId, cur);
      }
    }
    let favoriteStoreId = cust.favoriteStoreId;
    let favoriteStoreName = cust.favoriteStoreName;
    let maxStoreCount = 0;
    for (const sInfo of storeCount.values()) {
      if (sInfo.count > maxStoreCount) {
        maxStoreCount = sInfo.count;
        favoriteStoreId = sInfo.id;
        favoriteStoreName = sInfo.name;
      }
    }

    cust.totalSpent = totalSpent;
    cust.totalPurchases = totalPurchases;
    cust.averageTicket = averageTicket;
    cust.firstPurchaseDate = firstPurchaseDate;
    cust.lastPurchaseDate = lastPurchaseDate;
    cust.daysSinceLastPurchase = daysSinceLastPurchase < 0 ? 999 : daysSinceLastPurchase;
    cust.rfmFrequency = windowMetrics.rfmFrequency;
    cust.rfmMonetary = windowMetrics.rfmMonetary;
    cust.rfmWindowDays = rfm.rfmWindowDays;
    cust.recencyScore = recencyScore;
    cust.frequencyScore = frequencyScore;
    cust.monetaryScore = monetaryScore;
    cust.rfmScoreCode = rfm.rfmScoreCode;
    cust.rfmSegment = rfm.rfmSegment;
    if (favoriteStoreId) cust.favoriteStoreId = favoriteStoreId;
    if (favoriteStoreName) cust.favoriteStoreName = favoriteStoreName;
    cust.loyaltyPoints = Math.floor(totalSpent);
    cust.loyaltyCashbackBalance = parseFloat((totalSpent * 0.02).toFixed(2));
    cust.updatedAt = new Date().toISOString();

    customersToPersist.push(cust);
  }

  // Persiste tanto novos clientes quanto clientes atualizados em lotes no Firestore
  if (customersToPersist.length > 0) {
    const custBatches = Math.ceil(customersToPersist.length / CHUNK_SIZE);
    for (let cb = 0; cb < custBatches; cb++) {
      const cChunk = customersToPersist.slice(cb * CHUNK_SIZE, (cb + 1) * CHUNK_SIZE);
      try {
        const cBatch = writeBatch(db);
        for (const c of cChunk) {
          cBatch.set(doc(db, CUSTOMERS_COL, c.id), sanitizeForFirestore(c), { merge: true });
        }
        await cBatch.commit();
      } catch (cErr: any) {
        batchesFailed++;
        const errMsg = `Falha ao persistir clientes no Firestore: ${cErr?.message || String(cErr)}`;
        lastErrorMessage = errMsg;
        console.error(`[Firestore Clientes PDV] ${errMsg}`);
        errorsList.push({ rowNumber: 0, reason: errMsg });
      }
    }
  }

  const actuallyPersistedCount = actuallySavedPurchases.length;

  if (actuallyPersistedCount > 0 || duplicatesCount > 0) {
    // Atualização de cache em memória
    const finalPurchasesMap = new Map<string, Purchase>();
    for (const p of allPurchases) finalPurchasesMap.set(p.id, p);
    for (const p of actuallySavedPurchases) finalPurchasesMap.set(p.id, p);

    cachedPurchases = Array.from(finalPurchasesMap.values());
    cachedCustomers = allCustomers;
    cachedDashboardMetrics = calculateDashboardMetrics(allCustomers, cachedPurchases);

    if (actuallyPersistedCount > 0) {
      await logAuditEvent(
        'importação_compras',
        `Importação PDV: ${actuallyPersistedCount} cupons gravados, ${newCustCount} novos clientes e ${customersToPersist.length} clientes atualizados no Firestore.`,
        user,
        'purchases',
        undefined,
        { 
          total: totalFound,
          persisted: actuallyPersistedCount,
          duplicates: duplicatesCount,
          newCustomers: newCustCount,
          updatedCustomers: customersToPersist.length,
          itemsCount
        }
      );
    }
  }

  return {
    totalFound,
    validCount,
    persistedCount: actuallyPersistedCount,
    importedCount: actuallyPersistedCount,
    duplicatesCount,
    ignoredCount,
    newCustomersCount: newCustCount,
    linkedCustomersCount: linkedCustCount,
    itemsProcessedCount: itemsCount,
    errorsCount: errorsList.length,
    batchesSucceeded,
    batchesFailed,
    lastErrorMessage,
    stageSummary: {
      readSuccess: true,
      parseSuccess: true,
      dbWriteSuccess: actuallyPersistedCount > 0
    },
    errorsList
  };
}

export interface CustomerImportProgress {
  processed: number;
  total: number;
  imported: number;
  updated: number;
  duplicates: number;
  errors: number;
  percentage: number;
  currentBatch: number;
  totalBatches: number;
  currentStep: string;
}

export interface CustomerImportResult {
  totalFound: number;
  persistedCount: number;
  importedCount: number;
  updatedCount: number;
  duplicatesCount: number;
  errorsCount: number;
  batchesSucceeded: number;
  batchesFailed: number;
  lastErrorMessage?: string;
  stageSummary: {
    readSuccess: boolean;
    parseSuccess: boolean;
    dbWriteSuccess: boolean;
  };
}

export async function importCustomersBatch(
  newCustomers: Customer[],
  user: UserProfile,
  onProgress?: (progress: CustomerImportProgress) => void
): Promise<CustomerImportResult> {
  const currentDbCusts = await getCustomers();
  
  // Index existing by clean CPF digits and ID
  const existingByCpf = new Map<string, Customer>();
  const existingById = new Map<string, Customer>();
  for (const c of currentDbCusts) {
    if (c.cpf) {
      const d = c.cpf.replace(/\D/g, '');
      if (d) existingByCpf.set(d, c);
    }
    existingById.set(c.id, c);
  }

  let importedCount = 0;
  let updatedCount = 0;
  let duplicatesCount = 0;
  let errorsCount = 0;
  let batchesSucceeded = 0;
  let batchesFailed = 0;
  let lastErrorMessage = '';

  const customersToPersist: Customer[] = [];
  const processedKeys = new Set<string>();
  const keyToPersistIndex = new Map<string, number>();

  // Deduplicate and merge against existing records com busca O(1)
  for (let i = 0; i < newCustomers.length; i++) {
    const cust = newCustomers[i];
    const cpfDigits = cust.cpf ? cust.cpf.replace(/\D/g, '') : '';
    const key = cpfDigits || cust.code || cust.id;

    if (processedKeys.has(key)) {
      duplicatesCount++;
      const existingIdx = keyToPersistIndex.get(key);
      if (existingIdx !== undefined && customersToPersist[existingIdx]) {
        customersToPersist[existingIdx] = {
          ...customersToPersist[existingIdx],
          ...cust,
          updatedAt: new Date().toISOString()
        };
      }
      continue;
    }

    processedKeys.add(key);
    keyToPersistIndex.set(key, customersToPersist.length);

    const existingMatch = (cpfDigits ? existingByCpf.get(cpfDigits) : undefined) || existingById.get(cust.id);
    if (existingMatch) {
      updatedCount++;
      customersToPersist.push({
        ...existingMatch,
        ...cust,
        id: existingMatch.id,
        createdAt: existingMatch.createdAt,
        updatedAt: new Date().toISOString()
      });
    } else {
      importedCount++;
      customersToPersist.push(cust);
    }
  }

  const totalToSave = customersToPersist.length;
  const CHUNK_SIZE = 200; // Lotes seguros de 200 documentos conforme Regra 8
  const totalBatches = Math.max(1, Math.ceil(totalToSave / CHUNK_SIZE));
  const actuallySavedCustomers: Customer[] = [];
  const savedCustomerIds = new Set<string>();

  // REGRA 6: FAZER UM TESTE REAL DE ESCRITA NO FIRESTORE COM O 1º CLIENTE VÁLIDO
  if (totalToSave > 0) {
    const firstCust = customersToPersist[0];
    if (onProgress) {
      onProgress({
        processed: 0,
        total: totalToSave,
        imported: 0,
        updated: 0,
        duplicates: duplicatesCount,
        errors: 0,
        percentage: 0,
        currentBatch: 0,
        totalBatches,
        currentStep: `ETAPA 7: Testando gravação do 1º cliente (${firstCust.name}) no Firestore...`
      });
    }

    try {
      const firstRef = doc(db, CUSTOMERS_COL, firstCust.id);
      await setDoc(firstRef, sanitizeForFirestore(firstCust), { merge: true });
      actuallySavedCustomers.push(firstCust);
      savedCustomerIds.add(firstCust.id);
      console.log(`[Firestore Teste] 1º cliente "${firstCust.name}" (ID: ${firstCust.id}) gravado com sucesso!`);
    } catch (testErr: any) {
      const errCode = testErr?.code || 'unknown-error';
      const errMsg = testErr?.message || String(testErr);
      const formattedErr = `Falha no 1º teste de gravação Firestore [${errCode}]: ${errMsg}`;
      console.error(formattedErr, testErr);

      if (onProgress) {
        onProgress({
          processed: 0,
          total: totalToSave,
          imported: 0,
          updated: 0,
          duplicates: duplicatesCount,
          errors: totalToSave,
          percentage: 0,
          currentBatch: 0,
          totalBatches,
          currentStep: formattedErr
        });
      }

      return {
        totalFound: totalToSave,
        persistedCount: 0,
        importedCount: 0,
        updatedCount: 0,
        duplicatesCount,
        errorsCount: totalToSave,
        batchesSucceeded: 0,
        batchesFailed: 1,
        lastErrorMessage: `${errCode}: ${errMsg}`,
        stageSummary: {
          readSuccess: true,
          parseSuccess: true,
          dbWriteSuccess: false
        }
      };
    }
  }

  if (onProgress) {
    onProgress({
      processed: actuallySavedCustomers.length,
      total: totalToSave,
      imported: importedCount,
      updated: updatedCount,
      duplicates: duplicatesCount,
      errors: 0,
      percentage: 0,
      currentBatch: 0,
      totalBatches,
      currentStep: `ETAPA 8: Iniciando gravação em ${totalBatches} lotes de 200 documentos...`
    });
  }

  for (let b = 0; b < totalBatches; b++) {
    const start = b * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, totalToSave);
    const chunk = customersToPersist.slice(start, end);

    if (chunk.length > 0) {
      try {
        const batch = writeBatch(db);
        for (const item of chunk) {
          batch.set(doc(db, CUSTOMERS_COL, item.id), sanitizeForFirestore(item), { merge: true });
        }
        await batch.commit();
        batchesSucceeded++;
        for (const item of chunk) {
          if (!savedCustomerIds.has(item.id)) {
            savedCustomerIds.add(item.id);
            actuallySavedCustomers.push(item);
          }
        }
      } catch (batchErr: any) {
        batchesFailed++;
        const batchCode = batchErr?.code || '';
        const errMsg = `Lote ${b + 1}/${totalBatches} falhou${batchCode ? ` [${batchCode}]` : ''}: ${batchErr?.message || String(batchErr)}`;
        lastErrorMessage = errMsg;
        console.error(`Erro ao gravar lote ${b + 1}/${totalBatches} no Firestore:`, errMsg);
        errorsCount += chunk.length;
      }
    }

    const processed = end;
    const pct = totalToSave > 0 ? Math.round((processed / totalToSave) * 100) : 100;

    if (onProgress) {
      onProgress({
        processed,
        total: totalToSave,
        imported: actuallySavedCustomers.length,
        updated: updatedCount,
        duplicates: duplicatesCount,
        errors: errorsCount,
        percentage: pct,
        currentBatch: b + 1,
        totalBatches,
        currentStep: `Gravando lote ${b + 1} de ${totalBatches} (${processed.toLocaleString('pt-BR')} de ${totalToSave.toLocaleString('pt-BR')})...`
      });
    }

    // Yield control to UI thread to keep browser fluid
    await new Promise(resolve => setTimeout(resolve, 35));
  }

  const actuallyPersistedCount = actuallySavedCustomers.length;

  if (actuallyPersistedCount > 0) {
    // Update in-memory cached customers with genuinely saved records
    const finalCustomersMap = new Map<string, Customer>();
    for (const c of currentDbCusts) {
      finalCustomersMap.set(c.id, c);
    }
    for (const c of actuallySavedCustomers) {
      finalCustomersMap.set(c.id, c);
    }

    cachedCustomers = Array.from(finalCustomersMap.values());

    // Recalculate dashboard metrics and summaries
    cachedDashboardMetrics = calculateDashboardMetrics(cachedCustomers, cachedPurchases || []);
    cachedRFMSummaries = computeRFMSegmentSummaries(cachedCustomers);
    cachedGeoSummaries = computeGeoNeighborhoodSummaries(cachedCustomers);

    await logAuditEvent(
      'importação_clientes',
      `Importação de ${actuallyPersistedCount} clientes via Flex gravada no Firestore com sucesso (${actuallyPersistedCount} persistidos).`,
      user,
      'customers',
      undefined,
      {
        total: customersToPersist.length,
        persisted: actuallyPersistedCount,
        imported: importedCount,
        updated: updatedCount,
        duplicates: duplicatesCount,
        errors: errorsCount
      }
    );
  }

  const dbWriteSuccess = actuallyPersistedCount > 0;
  const realImported = dbWriteSuccess ? Math.min(importedCount, actuallyPersistedCount) : 0;
  const realUpdated = dbWriteSuccess ? Math.max(0, actuallyPersistedCount - realImported) : 0;

  return {
    totalFound: newCustomers.length,
    persistedCount: actuallyPersistedCount,
    importedCount: realImported,
    updatedCount: realUpdated,
    duplicatesCount,
    errorsCount,
    batchesSucceeded,
    batchesFailed,
    lastErrorMessage: lastErrorMessage || undefined,
    stageSummary: {
      readSuccess: true,
      parseSuccess: true,
      dbWriteSuccess
    }
  };
}

// ----------------------------------------------------
// CAMPAIGNS & COUPONS
// ----------------------------------------------------
export async function getCampaigns(options?: { forceRefresh?: boolean } | boolean): Promise<Campaign[]> {
  const force = isForceRefresh(options);
  if (!cachedCampaigns || force) {
    try {
      const snap = await getDocs(collection(db, CAMPAIGNS_COL));
      cachedCampaigns = snap.docs.map(d => ({ ...d.data(), id: d.data().id || d.id } as Campaign));
    } catch (err) {
      console.error('Erro ao carregar campanhas:', err);
      throw err;
    }
  }
  return cachedCampaigns || [];
}

export async function saveCampaign(campaign: Campaign, user: UserProfile): Promise<Campaign> {
  const all = await getCampaigns();
  const idx = all.findIndex(c => c.id === campaign.id);
  const isNew = idx === -1;

  // 1. Grava no Firestore PRIMEIRO (não altera cache antes da confirmação da nuvem)
  try {
    await setDoc(doc(db, CAMPAIGNS_COL, campaign.id), sanitizeForFirestore(campaign));
  } catch (err) {
    console.error('Erro ao salvar campanha no Firestore:', err);
    throw err;
  }

  // 2. Atualiza cache local SOMENTE após confirmação de sucesso
  if (isNew) all.unshift(campaign); else all[idx] = campaign;
  cachedCampaigns = [...all];

  await logAuditEvent(isNew ? 'criação_campanha' : 'alteração_campanha', `${isNew ? 'Criação da campanha' : 'Atualização da campanha'}: ${campaign.name} (${campaign.channel})`, user, 'campaigns', campaign.id);
  return campaign;
}

export async function deleteCampaign(id: string, user: UserProfile): Promise<void> {
  const all = await getCampaigns();
  
  // 1. Deleta no Firestore PRIMEIRO
  try {
    await deleteDoc(doc(db, CAMPAIGNS_COL, id));
  } catch (err) {
    console.error('Erro ao excluir campanha no Firestore:', err);
    throw err;
  }

  // 2. Atualiza cache local SOMENTE após confirmação
  cachedCampaigns = all.filter(c => c.id !== id);
  await logAuditEvent('exclusão_campanha', `Campanha excluída: ID ${id}`, user, 'campaigns', id);
}

export async function toggleCampaignStatus(id: string, user: UserProfile): Promise<Campaign | undefined> {
  const all = await getCampaigns();
  const camp = all.find(c => c.id === id);
  if (!camp) return undefined;
  camp.status = camp.status === 'Ativa' ? 'Pausada' : 'Ativa';
  return saveCampaign(camp, user);
}

export async function getCoupons(options?: { forceRefresh?: boolean } | boolean): Promise<Coupon[]> {
  const force = isForceRefresh(options);
  if (!cachedCoupons || force) {
    try {
      const snap = await getDocs(collection(db, COUPONS_COL));
      cachedCoupons = snap.docs.map(d => ({ ...d.data(), id: d.data().id || d.id } as Coupon));
    } catch (err) {
      console.error('Erro ao carregar cupons:', err);
      throw err;
    }
  }
  return cachedCoupons || [];
}

export async function saveCoupon(coupon: Coupon, user: UserProfile): Promise<Coupon> {
  const all = await getCoupons();
  const idx = all.findIndex(c => c.id === coupon.id);
  const isNew = idx === -1;

  // Código de cupom é único: dois cupons com o mesmo código tornam a validação no PDV ambígua.
  if (isCouponCodeTaken(coupon.code, all, coupon.id)) {
    throw new Error(`Já existe um cupom com o código ${String(coupon.code).trim().toUpperCase()}.`);
  }

  // 1. Grava no Firestore PRIMEIRO
  try {
    await setDoc(doc(db, COUPONS_COL, coupon.id), sanitizeForFirestore(coupon));
  } catch (err) {
    console.error('Erro ao salvar cupom no Firestore:', err);
    throw err;
  }

  // 2. Atualiza cache local SOMENTE após confirmação
  if (isNew) all.unshift(coupon); else all[idx] = coupon;
  cachedCoupons = [...all];

  await logAuditEvent('criação_cupom', `Cupom cadastrado: ${coupon.code}`, user, 'coupons', coupon.id);
  return coupon;
}

export async function deleteCoupon(id: string, user: UserProfile): Promise<void> {
  const all = await getCoupons();

  // 1. Deleta no Firestore PRIMEIRO
  try {
    await deleteDoc(doc(db, COUPONS_COL, id));
  } catch (err) {
    console.error('Erro ao excluir cupom no Firestore:', err);
    throw err;
  }

  // 2. Atualiza cache local SOMENTE após confirmação
  cachedCoupons = all.filter(c => c.id !== id);
  await logAuditEvent('exclusão_cupom', `Cupom excluído: ID ${id}`, user, 'coupons', id);
}

export async function toggleCouponStatus(id: string, user: UserProfile): Promise<Coupon | undefined> {
  const all = await getCoupons();
  const coup = all.find(c => c.id === id);
  if (!coup) return undefined;
  coup.isActive = !coup.isActive;
  coup.status = coup.isActive ? 'Ativo' : 'Inativo';
  return saveCoupon(coup, user);
}

// ----------------------------------------------------
// FIDELIDADE CLUBE - PREÇO CLUBE (OFERTAS E USOS)
// ----------------------------------------------------
export async function getClubOffers(options?: { forceRefresh?: boolean } | boolean): Promise<ClubOffer[]> {
  const force = isForceRefresh(options);
  if (!cachedClubOffers || force) {
    try {
      const snap = await getDocs(collection(db, CLUB_OFFERS_COL));
      cachedClubOffers = snap.docs.map(d => ({ ...d.data(), id: d.data().id || d.id } as ClubOffer));
    } catch (err) {
      console.error('Erro ao carregar ofertas do Clube:', err);
      throw err;
    }
  }
  return cachedClubOffers || [];
}

export async function saveClubOffer(offer: ClubOffer, user: UserProfile = SYSTEM_USER): Promise<ClubOffer> {
  const all = await getClubOffers();
  const idx = all.findIndex(o => o.id === offer.id);
  const isNew = idx === -1;
  
  // Calculate discount metrics accurately
  const discountVal = Math.max(0, offer.normalPrice - offer.clubPrice);
  const discountPct = offer.normalPrice > 0 ? (discountVal / offer.normalPrice) * 100 : 0;
  
  const preparedOffer: ClubOffer = {
    ...offer,
    discountValue: parseFloat(discountVal.toFixed(2)),
    discountPercent: parseFloat(discountPct.toFixed(2)),
    clientsUsedCount: offer.clientsUsedCount ?? 0,
    unitsSold: offer.unitsSold ?? 0,
    totalSavingsGranted: offer.totalSavingsGranted ?? 0,
    totalRevenueGenerated: offer.totalRevenueGenerated ?? 0,
    updatedAt: new Date().toISOString()
  };

  // 1. Grava no Firestore PRIMEIRO
  try {
    await setDoc(doc(db, CLUB_OFFERS_COL, preparedOffer.id), sanitizeForFirestore(preparedOffer));
  } catch (err) {
    console.error('Erro ao salvar oferta do Clube no Firestore:', err);
    throw err;
  }

  // 2. Atualiza cache local SOMENTE após confirmação
  if (isNew) {
    all.unshift(preparedOffer);
  } else {
    all[idx] = preparedOffer;
  }
  cachedClubOffers = [...all];

  await logAuditEvent(
    isNew ? 'criação_oferta_clube' : 'alteração_oferta_clube',
    `Oferta Preço Clube ${isNew ? 'criada' : 'atualizada'}: ${preparedOffer.productName} (De R$ ${preparedOffer.normalPrice.toFixed(2)} por R$ ${preparedOffer.clubPrice.toFixed(2)})`,
    user,
    'club_offers',
    preparedOffer.id,
    { productSku: preparedOffer.productSku, clubPrice: preparedOffer.clubPrice, status: preparedOffer.status }
  );

  return preparedOffer;
}

export async function deleteClubOffer(id: string, user: UserProfile = SYSTEM_USER): Promise<void> {
  const all = await getClubOffers();
  const target = all.find(o => o.id === id);

  // 1. Deleta no Firestore PRIMEIRO
  try {
    await deleteDoc(doc(db, CLUB_OFFERS_COL, id));
  } catch (err) {
    console.error('Erro ao excluir oferta do Clube no Firestore:', err);
    throw err;
  }

  // 2. Atualiza cache local SOMENTE após confirmação
  cachedClubOffers = all.filter(o => o.id !== id);

  if (target) {
    await logAuditEvent(
      'exclusão_oferta_clube',
      `Oferta Preço Clube removida: ${target.productName} (${target.productSku})`,
      user,
      'club_offers',
      id
    );
  }
}

export async function toggleClubOfferStatus(id: string, status: ClubOfferStatus, user: UserProfile = SYSTEM_USER): Promise<ClubOffer | null> {
  const all = await getClubOffers();
  const target = all.find(o => o.id === id);
  if (!target) return null;

  const updatedTarget: ClubOffer = {
    ...target,
    status,
    updatedAt: new Date().toISOString()
  };

  // 1. Grava no Firestore PRIMEIRO
  try {
    await setDoc(doc(db, CLUB_OFFERS_COL, id), sanitizeForFirestore(updatedTarget));
  } catch (err) {
    console.error('Erro ao atualizar status da oferta no Firestore:', err);
    throw err;
  }

  // 2. Atualiza cache local SOMENTE após confirmação
  const targetIdx = all.findIndex(o => o.id === id);
  if (targetIdx !== -1) {
    all[targetIdx] = updatedTarget;
    cachedClubOffers = [...all];
  }

  await logAuditEvent(
    'alteração_oferta_clube',
    `Status da oferta ${target.productName} alterado para "${status}"`,
    user,
    'club_offers',
    id,
    { newStatus: status }
  );

  return target;
}

export async function duplicateClubOffer(id: string, user: UserProfile = SYSTEM_USER): Promise<ClubOffer | null> {
  const all = await getClubOffers();
  const target = all.find(o => o.id === id);
  if (!target) return null;

  const now = new Date();
  const newOffer: ClubOffer = {
    ...target,
    id: `offer-${Date.now()}`,
    productName: `${target.productName} (Cópia)`,
    status: 'Inativa',
    clientsUsedCount: 0,
    unitsSold: 0,
    totalSavingsGranted: 0,
    totalRevenueGenerated: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    createdBy: user.name
  };

  return await saveClubOffer(newOffer, user);
}

export async function getClubOfferUsages(
  offerId?: string, 
  customerId?: string, 
  options?: { forceRefresh?: boolean } | boolean
): Promise<ClubOfferUsage[]> {
  const force = isForceRefresh(options);
  if (!cachedClubOfferUsages || force) {
    try {
      const snap = await getDocs(query(collection(db, CLUB_OFFER_USAGES_COL), orderBy('usedAt', 'desc'), limit(200)));
      cachedClubOfferUsages = snap.docs.map(d => ({ ...d.data(), id: d.data().id || d.id } as ClubOfferUsage));
    } catch (err) {
      console.error('Erro ao carregar utilizações de oferta:', err);
      throw err;
    }
  }

  let results = cachedClubOfferUsages || [];
  if (offerId) {
    results = results.filter(u => u.offerId === offerId);
  }
  if (customerId) {
    results = results.filter(u => u.customerId === customerId);
  }
  return results;
}

export async function recordClubOfferUsage(
  usageData: Omit<ClubOfferUsage, 'id' | 'usedAt'>,
  user: UserProfile = SYSTEM_USER
): Promise<ClubOfferUsage> {
  const usageId = `usage-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const nowIso = new Date().toISOString();

  const newUsage: ClubOfferUsage = {
    ...usageData,
    id: usageId,
    usedAt: nowIso
  };

  // 1. Grava no Firestore PRIMEIRO
  try {
    await setDoc(doc(db, CLUB_OFFER_USAGES_COL, usageId), sanitizeForFirestore(newUsage));
  } catch (err) {
    console.error('Erro ao registrar uso de oferta no Firestore:', err);
    throw err;
  }

  // 2. Atualiza cache local SOMENTE após confirmação
  const allUsages = await getClubOfferUsages();
  allUsages.unshift(newUsage);
  cachedClubOfferUsages = [...allUsages];

  // Update offer cumulative metrics
  const offers = await getClubOffers();
  const offerIdx = offers.findIndex(o => o.id === usageData.offerId);
  if (offerIdx !== -1) {
    const offer = offers[offerIdx];
    offer.unitsSold = (offer.unitsSold || 0) + usageData.quantity;
    offer.totalSavingsGranted = parseFloat(((offer.totalSavingsGranted || 0) + usageData.totalSavings).toFixed(2));
    offer.totalRevenueGenerated = parseFloat(((offer.totalRevenueGenerated || 0) + usageData.totalPaid).toFixed(2));
    
    // Check distinct customer count
    const distinctClients = new Set(allUsages.filter(u => u.offerId === offer.id).map(u => u.customerId));
    offer.clientsUsedCount = distinctClients.size;

    try {
      await setDoc(doc(db, CLUB_OFFERS_COL, offer.id), sanitizeForFirestore(offer));
    } catch (e) {
      console.warn('Erro ao atualizar métricas da oferta:', e);
    }
  }

  // Update customer cumulative savings
  const customers = await getCustomers();
  const cust = customers.find(c => c.id === usageData.customerId);
  if (cust) {
    cust.clubTotalSavings = parseFloat(((cust.clubTotalSavings || 0) + usageData.totalSavings).toFixed(2));
    cust.clubOffersUsedCount = (cust.clubOffersUsedCount || 0) + 1;
    try {
      await setDoc(doc(db, CUSTOMERS_COL, cust.id), sanitizeForFirestore(cust));
    } catch (e) {
      console.warn('Erro ao atualizar economia do cliente:', e);
    }
  }

  await logAuditEvent(
    'utilização_oferta_clube',
    `Preço Clube aplicado: ${usageData.quantity}x ${usageData.productName} para ${usageData.customerName} (Economia de R$ ${usageData.totalSavings.toFixed(2)})`,
    user,
    'club_offer_usages',
    usageId,
    { offerId: usageData.offerId, customerId: usageData.customerId, totalSavings: usageData.totalSavings }
  );

  return newUsage;
}

export async function toggleCustomerClubStatus(
  customerId: string,
  isClubMember: boolean,
  user: UserProfile = SYSTEM_USER
): Promise<Customer | null> {
  const customers = await getCustomers();
  const target = customers.find(c => c.id === customerId);
  if (!target) return null;

  if (target.isAnonymized) throw new Error('Cliente anonimizado (LGPD) não pode ser alterado.');

  // Só os campos do clube (antes regravava o cadastro inteiro a partir do cache).
  const patch: Partial<Customer> = { isClubMember };
  if (isClubMember && !target.clubJoinedAt) patch.clubJoinedAt = new Date().toISOString();

  try {
    await updateDoc(doc(db, CUSTOMERS_COL, customerId), sanitizeForFirestore(patch) as any);
  } catch (err) {
    console.error('Erro ao atualizar status de Clube do cliente:', err);
    throw err;
  }
  Object.assign(target, patch);

  await logAuditEvent(
    'alteração_status_clube_cliente',
    `Cliente ${target.name} ${isClubMember ? 'ativado' : 'desativado'} no Fidelidade Clube`,
    user,
    'customers',
    customerId,
    { isClubMember }
  );

  return target;
}

// ----------------------------------------------------
// INTERACTIONS & TASKS
// ----------------------------------------------------
export async function getInteractions(options?: { forceRefresh?: boolean } | boolean): Promise<Interaction[]> {
  const force = isForceRefresh(options);
  if (!cachedInteractions || force) {
    try {
      const snap = await getDocs(query(collection(db, INTERACTIONS_COL), orderBy('date', 'desc'), limit(150)));
      const raw = snap.docs.map(d => d.data() as Interaction);
      cachedInteractions = raw;
    } catch (err) {
      console.error('Erro ao carregar interações:', err);
      throw err;
    }
  }
  return cachedInteractions || [];
}

export async function getInteractionsByCustomerId(customerId: string, limitCount = 50): Promise<Interaction[]> {
  if (cachedInteractions) {
    const filtered = cachedInteractions.filter(i => i.customerId === customerId);
    if (filtered.length > 0) return filtered.slice(0, limitCount);
  }

  try {
    const q = query(
      collection(db, INTERACTIONS_COL),
      where('customerId', '==', customerId),
      orderBy('date', 'desc'),
      limit(limitCount)
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data() as Interaction);
  } catch (err) {
    console.warn(`Erro ao buscar interações do cliente ${customerId}:`, err);
    return [];
  }
}

export async function saveInteraction(interaction: Interaction, user: UserProfile): Promise<Interaction> {
  const all = await getInteractions();

  // 1. Grava no Firestore PRIMEIRO
  try {
    await setDoc(doc(db, INTERACTIONS_COL, interaction.id), sanitizeForFirestore(interaction));
  } catch (err) {
    console.error('Erro ao salvar interação no Firestore:', err);
    throw err;
  }

  // 2. Atualiza cache local SOMENTE após confirmação
  all.unshift(interaction);
  cachedInteractions = [...all];

  return interaction;
}

export async function getTasks(options?: { forceRefresh?: boolean } | boolean): Promise<CRMTask[]> {
  const force = isForceRefresh(options);
  if (!cachedTasks || force) {
    try {
      const snap = await getDocs(collection(db, TASKS_COL));
      const raw = snap.docs.map(d => d.data() as CRMTask);
      cachedTasks = raw;
    } catch (err) {
      console.error('Erro ao carregar tarefas:', err);
      throw err;
    }
  }
  return cachedTasks || [];
}

export async function saveTask(task: CRMTask, user: UserProfile): Promise<CRMTask> {
  const all = await getTasks();
  const idx = all.findIndex(t => t.id === task.id);
  const isNew = idx === -1;

  // 1. Grava no Firestore PRIMEIRO
  try {
    await setDoc(doc(db, TASKS_COL, task.id), sanitizeForFirestore(task));
  } catch (err) {
    console.error('Erro ao salvar tarefa no Firestore:', err);
    throw err;
  }

  // 2. Atualiza cache local SOMENTE após confirmação
  if (isNew) all.unshift(task); else all[idx] = task;
  cachedTasks = [...all];

  return task;
}

// ----------------------------------------------------
// SEGMENTS
// ----------------------------------------------------
export async function getSegments(options?: { forceRefresh?: boolean } | boolean): Promise<Segment[]> {
  const force = isForceRefresh(options);
  if (!cachedSegments || force) {
    try {
      const snap = await getDocs(collection(db, SEGMENTS_COL));
      const raw = snap.docs.map(d => d.data() as Segment);
      cachedSegments = raw;
    } catch (err) {
      console.error('Erro ao carregar segmentos:', err);
      throw err;
    }
  }
  return cachedSegments || [];
}

export async function saveSegment(segment: Segment, user: UserProfile): Promise<Segment> {
  const all = await getSegments();
  const idx = all.findIndex(s => s.id === segment.id);
  const isNew = idx === -1;

  // 1. Grava no Firestore PRIMEIRO
  try {
    await setDoc(doc(db, SEGMENTS_COL, segment.id), sanitizeForFirestore(segment));
  } catch (err) {
    console.error('Erro ao salvar segmento no Firestore:', err);
    throw err;
  }

  // 2. Atualiza cache local SOMENTE após confirmação
  if (isNew) all.unshift(segment); else all[idx] = segment;
  cachedSegments = [...all];

  return segment;
}

// ----------------------------------------------------
// AUDIT LOGS
// ----------------------------------------------------
export async function getAuditLogs(options?: { forceRefresh?: boolean } | boolean): Promise<AuditLog[]> {
  const force = isForceRefresh(options);
  if (cachedAuditLogs.length === 0 || force) {
    try {
      const snap = await getDocs(query(collection(db, AUDIT_LOGS_COL), orderBy('timestamp', 'desc'), limit(100)));
      if (!snap.empty) {
        cachedAuditLogs = snap.docs.map(d => d.data() as AuditLog);
      }
    } catch (err) {
      console.error('Erro ao carregar audit logs:', err);
      if (cachedAuditLogs.length > 0) return cachedAuditLogs;
      throw err;
    }
  }
  return cachedAuditLogs;
}

// ----------------------------------------------------
// STORES
// ----------------------------------------------------
export async function ensureRealSuperAstralStoresInFirestore(): Promise<Store[]> {
  if (cachedStores && cachedStores.length > 0) {
    return cachedStores;
  }

  try {
    const snap = await getDocs(collection(db, STORES_COL));
    if (!snap.empty) {
      // Exibe cada documento sob a sua loja física (cobre cadastros ainda não migrados; não grava nada)
      cachedStores = alignStoresWithPhysicalIdentity(snap.docs.map(d => ({ ...d.data(), id: d.id } as Store)));
      return cachedStores;
    }

    // Inicializa as lojas padrão apenas se a coleção estiver completamente vazia no Firestore
    try {
      console.log('[Firestore] Inicializando lojas padrão no Firestore...');
      const batch = writeBatch(db);
      DEMO_STORES.forEach(st => {
        batch.set(doc(db, STORES_COL, st.id), sanitizeForFirestore(st));
      });
      await batch.commit();
      cachedStores = [...DEMO_STORES];
    } catch (writeErr: any) {
      console.warn('Aviso ao inicializar lojas no Firestore (usando padrão local):', writeErr?.message || writeErr);
      cachedStores = [...DEMO_STORES];
    }
  } catch (err: any) {
    console.error('Falha ao verificar unidades no Firestore:', err?.message || err);
    if (cachedStores && cachedStores.length > 0) return cachedStores;
    throw err;
  }

  return cachedStores || DEMO_STORES;
}

export async function getStores(options?: { forceRefresh?: boolean } | boolean): Promise<Store[]> {
  const force = isForceRefresh(options);
  if (!cachedStores || force) {
    cachedStores = await ensureRealSuperAstralStoresInFirestore();
  }
  return cachedStores || DEMO_STORES;
}

// ----------------------------------------------------
// AGGREGATED METRICS ENGINES (FOR DASHBOARD, RFM & MAP)
// ----------------------------------------------------
export function calculateDashboardMetrics(customers: Customer[], purchases: Purchase[]): DashboardMetrics {
  const total = customers.length;
  if (total === 0) {
    return {
      totalCustomers: 0,
      activeCustomers: 0,
      newCustomersMonth: 0,
      customersWithCpf: 0,
      customersWithWhatsApp: 0,
      customersWithWhatsAppOptIn: 0,
      captureRatePercent: 0,
      averageIdentifiedTicket: 0,
      averageFrequency: 0,
      totalIdentifiedRevenue: 0,
      totalIdentifiedPurchases: 0,
      rfmCounts: { champions: 0, loyal: 0, atRisk: 0, lost: 0, others: 0 },
      rfmPercentages: { champions: 0, loyal: 0, atRisk: 0, lost: 0 }
    };
  }

  const active = customers.filter(c => isActiveCustomer(c)).length;
  const withCpf = customers.filter(hasIdentifiedDocument).length;
  const withWhatsApp = customers.filter(c => Boolean(c.whatsapp)).length;
  const withWhatsAppOptIn = customers.filter(c => !c.isAnonymized && c.consent?.whatsappMarketing === true).length;
  // Novos = cadastrados no mês atual (data de cadastro de origem ou de entrada no CRM)
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const newThisMonth = customers.filter(c => {
    const d = new Date(c.registeredAt || c.createdAt || '');
    return !isNaN(d.getTime()) && d >= monthStart;
  }).length;

  const totalRevenue = purchases.reduce((acc, p) => acc + (p.netAmount || 0), 0);
  const totalPurchasesCount = purchases.length;
  const avgTicket = totalPurchasesCount > 0 ? totalRevenue / totalPurchasesCount : 0;
  const avgFreq = total > 0 ? totalPurchasesCount / total : 0;

  const champions = customers.filter(c => c.rfmSegment === 'CAMPEÕES').length;
  const loyal = customers.filter(c => c.rfmSegment === 'LEAIS').length;
  const atRisk = customers.filter(c => c.rfmSegment === 'EM RISCO').length;
  const lost = customers.filter(c => c.rfmSegment === 'PERDIDOS').length;
  const others = total - (champions + loyal + atRisk + lost);

  return {
    totalCustomers: total,
    activeCustomers: active,
    newCustomersMonth: newThisMonth,
    customersWithCpf: withCpf,
    customersWithWhatsApp: withWhatsApp,
    customersWithWhatsAppOptIn: withWhatsAppOptIn,
    captureRatePercent: parseFloat(((withCpf / Math.max(1, total)) * 100).toFixed(1)),
    averageIdentifiedTicket: parseFloat(avgTicket.toFixed(2)),
    averageFrequency: parseFloat(avgFreq.toFixed(1)),
    totalIdentifiedRevenue: parseFloat(totalRevenue.toFixed(2)),
    totalIdentifiedPurchases: totalPurchasesCount,
    rfmCounts: { champions, loyal, atRisk, lost, others },
    rfmPercentages: {
      champions: parseFloat(((champions / total) * 100).toFixed(1)),
      loyal: parseFloat(((loyal / total) * 100).toFixed(1)),
      atRisk: parseFloat(((atRisk / total) * 100).toFixed(1)),
      lost: parseFloat(((lost / total) * 100).toFixed(1))
    }
  };
}

export function computeRFMSegmentSummaries(customers: Customer[]): RFMSegmentSummary[] {
  const map = new Map<RFMSegmentType, { count: number; totalRevenue: number; totalPurchases: number }>();
  
  Object.keys(RFM_SEGMENTS_INFO).forEach(seg => {
    map.set(seg as RFMSegmentType, { count: 0, totalRevenue: 0, totalPurchases: 0 });
  });

  let totalRev = 0;
  customers.forEach(c => {
    totalRev += c.totalSpent || 0;
    const cur = map.get(c.rfmSegment) || { count: 0, totalRevenue: 0, totalPurchases: 0 };
    cur.count += 1;
    cur.totalRevenue += c.totalSpent || 0;
    cur.totalPurchases += c.totalPurchases || 0;
    map.set(c.rfmSegment, cur);
  });

  return Object.entries(RFM_SEGMENTS_INFO).map(([key, info]) => {
    const data = map.get(key as RFMSegmentType) || { count: 0, totalRevenue: 0, totalPurchases: 0 };
    const avgTicket = data.totalPurchases > 0 ? data.totalRevenue / data.totalPurchases : 0;
    const pctCustomers = customers.length > 0 ? (data.count / customers.length) * 100 : 0;
    const pctRevenue = totalRev > 0 ? (data.totalRevenue / totalRev) * 100 : 0;

    return {
      segment: key as RFMSegmentType,
      name: info.name,
      count: data.count,
      totalRevenue: data.totalRevenue,
      averageTicket: avgTicket,
      pctCustomers: parseFloat(pctCustomers.toFixed(1)),
      pctRevenue: parseFloat(pctRevenue.toFixed(1)),
      color: info.dotColor.replace('bg-', '')
    };
  });
}

export function computeGeoNeighborhoodSummaries(customers: Customer[]): GeoNeighborhoodSummary[] {
  const neighborhoodMap = new Map<string, { count: number; activeCount: number; totalRevenue: number; purchasesCount: number }>();

  customers.forEach(c => {
    const n = c.neighborhood || 'Outros';
    const cur = neighborhoodMap.get(n) || { count: 0, activeCount: 0, totalRevenue: 0, purchasesCount: 0 };
    cur.count += 1;
    if (isActiveCustomer(c)) cur.activeCount += 1;
    cur.totalRevenue += c.totalSpent || 0;
    cur.purchasesCount += c.totalPurchases || 0;
    neighborhoodMap.set(n, cur);
  });

  return Array.from(neighborhoodMap.entries()).map(([neighborhood, data]) => {
    const coords = NEIGHBORHOOD_COORDS[neighborhood] || { lat: -25.311508, lng: -49.298475 };
    const avgTicket = data.purchasesCount > 0 ? data.totalRevenue / data.purchasesCount : 0;
    return {
      neighborhood,
      lat: coords.lat,
      lng: coords.lng,
      customerCount: data.count,
      activeCount: data.activeCount,
      totalRevenue: data.totalRevenue,
      averageTicket: avgTicket
    };
  });
}

export async function getDashboardMetrics(options?: { forceRefresh?: boolean } | boolean): Promise<DashboardMetrics> {
  const force = isForceRefresh(options);
  if (cachedDashboardMetrics && !force) return cachedDashboardMetrics;

  try {
    const docSnap = await getDoc(doc(db, SETTINGS_COL, 'crm_summary'));
    if (docSnap.exists() && !force) {
      cachedDashboardMetrics = docSnap.data() as DashboardMetrics;
      return cachedDashboardMetrics;
    }
  } catch (err) {
    console.warn('Falha ao ler crm_summary do Firestore:', err);
  }

  // Fallback calculate
  const custs = await getCustomers(options);
  const pur = await getPurchases(options);
  cachedDashboardMetrics = calculateDashboardMetrics(custs, pur);
  return cachedDashboardMetrics;
}

export async function getRFMSummaries(options?: { forceRefresh?: boolean } | boolean): Promise<RFMSegmentSummary[]> {
  const force = isForceRefresh(options);
  if (cachedRFMSummaries && !force) return cachedRFMSummaries;

  try {
    const docSnap = await getDoc(doc(db, SETTINGS_COL, 'rfm_summary'));
    if (docSnap.exists() && !force) {
      const data = docSnap.data();
      if (data?.items) {
        cachedRFMSummaries = data.items;
        return cachedRFMSummaries!;
      }
    }
  } catch (err) {
    console.warn('Falha ao ler rfm_summary:', err);
  }

  const custs = await getCustomers(options);
  cachedRFMSummaries = computeRFMSegmentSummaries(custs);
  return cachedRFMSummaries;
}

export async function getGeoNeighborhoodSummaries(options?: { forceRefresh?: boolean } | boolean): Promise<GeoNeighborhoodSummary[]> {
  const force = isForceRefresh(options);
  if (cachedGeoSummaries && !force) return cachedGeoSummaries;

  try {
    const docSnap = await getDoc(doc(db, SETTINGS_COL, 'geo_summary'));
    if (docSnap.exists() && !force) {
      const data = docSnap.data();
      if (data?.items) {
        cachedGeoSummaries = data.items;
        return cachedGeoSummaries!;
      }
    }
  } catch (err) {
    console.warn('Falha ao ler geo_summary:', err);
  }

  const custs = await getCustomers(options);
  cachedGeoSummaries = computeGeoNeighborhoodSummaries(custs);
  return cachedGeoSummaries;
}

