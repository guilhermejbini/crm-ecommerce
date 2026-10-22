/**
 * CRM Super Astral Supermercados - Type Definitions
 */

export type UserRole = 'admin' | 'manager' | 'viewer' | 'support' | 'marketing';

export interface AuthorizedUser {
  id: string;
  uid?: string;
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'viewer';
  roleTitle?: string;
  active: boolean;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  lastLoginAt?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  roleTitle: string;
  avatarUrl?: string;
  storeAccess: string[]; // ['todas'] or store IDs
}

export type RFMSegmentType = 
  | 'CAMPEÕES' 
  | 'LEAIS' 
  | 'POTENCIAIS LEAIS' 
  | 'PROMISSORES' 
  | 'NOVOS' 
  | 'PRECISAM DE ATENÇÃO' 
  | 'EM RISCO' 
  | 'PRESTES A DORMIR' 
  | 'HIBERNANDO' 
  | 'PERDIDOS'
  | 'UNCLASSIFIED';

export interface CustomerConsent {
  whatsappMarketing: boolean;
  emailMarketing: boolean;
  smsMarketing: boolean;
  whatsappConsentDate?: string;
  emailConsentDate?: string;
  smsConsentDate?: string;
  origin: string; // 'PDV', 'Site', 'App Astral Clube', 'Balcão de Atendimento'
  purpose: string; // 'Comunicação de ofertas e benefícios personalizados Astral Clube'
  lastUpdated?: string;
  history?: {
    type: 'whatsapp' | 'email' | 'sms';
    status: boolean;
    date: string;
    origin: string;
    updatedBy: string;
  }[];
}

export interface Customer {
  id: string;
  name: string;
  cpf: string;
  whatsapp: string;
  phone?: string;
  email?: string;
  birthDate?: string; // YYYY-MM-DD
  
  // Flex extended fields
  code?: string;
  personType?: 'F' | 'J';
  cnpj?: string;
  rgIe?: string;
  gender?: string;
  cardName?: string;
  companyName?: string;

  // Address
  address?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  cep?: string;

  // Geolocation (Coordinates & Status)
  latitude?: number;
  longitude?: number;
  geocodeStatus?: 'geocoded' | 'pending' | 'failed';
  geocodeError?: string;
  
  notes?: string;
  isDemo?: boolean;
  origin: string; // 'PDV', 'App Astral', 'Campanha', 'Importação', 'Manual'
  createdAt: string;
  /** Data de cadastro na origem (ex.: "Data Cadastro" do RP Flex). createdAt é a data de entrada no CRM. */
  registeredAt?: string;
  updatedAt: string;
  createdBy?: string;
  
  // LGPD & Consents
  consent: CustomerConsent;
  /** @deprecated Utilizar customer.consent.whatsappMarketing como fonte única da verdade */
  consentWhatsApp?: boolean;
  
  // Metrics calculated / aggregated
  totalSpent: number;
  totalPurchases: number;
  averageTicket: number;
  firstPurchaseDate?: string;
  lastPurchaseDate?: string;
  daysSinceLastPurchase: number;
  
  // RFM
  rfmSegment: RFMSegmentType;
  recencyScore: number; // 1 to 5
  frequencyScore: number; // 1 to 5
  monetaryScore: number; // 1 to 5
  rfmScoreCode: string; // e.g. "555", "452"
  rfmFrequency?: number; // compras na janela móvel (ex: últimos 90 dias)
  rfmMonetary?: number; // valor gasto na janela móvel (ex: últimos 90 dias)
  rfmWindowDays?: number; // dias da janela móvel utilizada (ex: 90)
  
  // Fidelidade Clube (Preço Clube Exclusivo)
  isClubMember?: boolean;
  clubJoinedAt?: string;
  clubTotalSavings?: number;
  clubOffersUsedCount?: number;

  // Legacy / Historical Loyalty (kept for backward compatibility)
  loyaltyPoints?: number;
  loyaltyCashbackBalance?: number;
  
  // Anonymization / LGPD
  isAnonymized?: boolean;
  anonymizedAt?: string;
  
  // Tag / flags
  favoriteStoreId?: string;
  favoriteStoreName?: string;
  tags?: string[];
}

export interface PurchaseItem {
  id?: string;
  sku: string;
  productName: string;
  category: string;
  quantity: number | null; // null quando o arquivo não informa a quantidade
  unitPrice: number;
  totalPrice: number;
}

export interface Purchase {
  id: string;
  customerId: string;
  customerName: string;
  customerCpf?: string;
  customerPhone?: string;
  storeId: string;
  storeName: string;
  posNumber: string; // PDV 01, PDV 02
  couponReceiptNumber: string; // Número do Cupom Fiscal
  purchaseDate: string; // ISO string
  totalAmount: number;
  discountAmount: number;
  netAmount: number;
  paymentMethod?: 'Cartão Crédito' | 'Cartão Débito' | 'PIX' | 'Dinheiro' | 'Astral Vale' | 'Outro'; // ausente quando o arquivo não informa
  items: PurchaseItem[];
  itemsCount: number;
  loyaltyPointsEarned?: number;
  couponCodeUsed?: string;
}

export interface ProductSummary {
  sku: string;
  name: string;
  category: string;
  totalQuantity: number;
  totalRevenue: number;
  averagePrice: number;
  purchaseCount: number;
  lastPurchasedDate?: string;
}

export interface CategorySummary {
  category: string;
  totalRevenue: number;
  totalItems: number;
  purchaseCount: number;
  percentOfTotal: number;
}

export type InteractionType = 
  | 'dúvida' 
  | 'reclamação' 
  | 'sugestão' 
  | 'elogio' 
  | 'solicitação' 
  | 'devolução' 
  | 'troca' 
  | 'outro';

export type InteractionChannel = 'WhatsApp' | 'Balcão Loja' | 'Telefone' | 'E-mail' | 'App Astral';
export type InteractionStatus = 'Aberto' | 'Em Análise' | 'Concluído' | 'Cancelado';

export interface Interaction {
  id: string;
  customerId: string;
  customerName: string;
  date: string;
  employeeName: string;
  employeeEmail?: string;
  channel: InteractionChannel;
  type: InteractionType;
  subject: string;
  description: string;
  resolution?: string;
  status: InteractionStatus;
  storeName?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface CRMTask {
  id: string;
  customerId?: string;
  customerName?: string;
  title: string;
  description: string;
  assignedTo: string;
  dueDate: string;
  priority: 'Baixa' | 'Média' | 'Alta' | 'Urgente';
  status: 'Pendente' | 'Em Andamento' | 'Concluída';
  interactionId?: string;
  createdAt: string;
  completedAt?: string;
}

export type ClubOfferStatus = 'Ativa' | 'Agendada' | 'Encerrada' | 'Inativa';
export type ClubOfferAudienceType = 'all' | 'segment' | 'selected';

export interface ClubOffer {
  id: string;
  productSku: string;
  productName: string;
  productCategory: string;
  barcode?: string;
  normalPrice: number;
  clubPrice: number;
  discountValue: number; // normalPrice - clubPrice
  discountPercent: number; // ((normalPrice - clubPrice) / normalPrice) * 100
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  unitLimitPerCustomer?: number; // e.g. 3 unidades por cliente
  audienceType: ClubOfferAudienceType; // 'all' | 'segment' | 'selected'
  targetSegmentId?: string;
  targetSegmentName?: string;
  selectedCustomerIds?: string[];
  status: ClubOfferStatus;
  
  // Performance analytics
  clientsUsedCount?: number;
  unitsSold?: number;
  totalSavingsGranted?: number;
  totalRevenueGenerated?: number;
  
  createdAt: string;
  updatedAt?: string;
  createdBy?: string;
}

export interface ClubOfferUsage {
  id: string;
  offerId: string;
  productSku: string;
  productName: string;
  productCategory?: string;
  customerId: string;
  customerName: string;
  customerCpf?: string;
  quantity: number;
  normalPrice: number;
  clubPrice: number;
  unitDiscount: number;
  totalSavings: number;
  totalPaid: number;
  storeId?: string;
  storeName?: string;
  posNumber?: string;
  purchaseId?: string;
  usedAt: string; // ISO string
}

export interface LoyaltyProgramConfig {
  type: 'preco_clube' | 'pontos' | 'cashback' | 'compras_acumuladas';
  pointsPerReal?: number;
  pointsToRealConversion?: number;
  minPointsToRedeem?: number;
  cashbackPercentage?: number;
  expiryMonths?: number;
  isActive: boolean;
}

export interface LoyaltyTransaction {
  id: string;
  customerId: string;
  type: 'earn' | 'redeem' | 'expire' | 'adjust' | 'club_discount';
  points?: number;
  cashbackValue?: number;
  description: string;
  purchaseId?: string;
  couponReceiptNumber?: string;
  date: string;
  performedBy?: string;
}

export type CampaignChannel = 'WhatsApp' | 'SMS' | 'E-mail';
export type CampaignStatus = 'Rascunho' | 'Agendada' | 'Em Envio' | 'Enviada' | 'Cancelada' | 'Ativa' | 'Pausada' | 'Concluída';

export interface Campaign {
  id: string;
  name: string;
  objective?: string;
  segmentId?: string;
  segmentName?: string;
  targetSegment?: string;
  targetNeighborhood?: string;
  onlyOptIn?: boolean;
  channel: CampaignChannel;
  message: string;
  emailSubject?: string;
  couponCode?: string;
  discountValue?: string;
  validityDate?: string;
  scheduledDate?: string;
  sentDate?: string;
  status: CampaignStatus;
  
  // Metrics
  targetAudienceCount?: number;
  sentCount?: number;
  deliveredCount?: number;
  openedCount?: number;
  failedCount?: number;
  clickedCount?: number;
  convertedCount?: number;
  couponsUsedCount?: number;
  attributedRevenue?: number;
  revenueGenerated?: number;
  roi?: number;
  
  createdBy?: string;
  createdAt?: string;
}

export interface Coupon {
  id: string;
  code: string;
  description?: string;
  discountDescription?: string;
  discountType?: 'percentage' | 'fixed_value';
  discountValue?: number; // e.g. 10% or R$ 15
  minPurchaseValue?: number; // e.g. R$ 50
  minimumPurchaseAmount?: number;
  pointsRequired?: number;
  maxDiscountValue?: number;
  validUntil: string;
  targetAudience?: string; // 'Todos', 'Segmento RFM', 'Campeões', etc.
  maxUsageTotal?: number;
  maxUsagePerCustomer?: number;
  currentUsageCount?: number;
  usageLimit?: number;
  usageCount?: number;
  status?: 'Ativo' | 'Inativo' | 'Expirado';
  campaignId?: string;
  campaignName?: string;
  isActive?: boolean;
  createdAt: string;
}

export interface CouponRedemption {
  id: string;
  couponId: string;
  couponCode: string;
  customerId: string;
  customerName: string;
  purchaseId: string;
  discountApplied: number;
  purchaseTotal: number;
  storeName: string;
  redeemedAt: string;
}

export interface SegmentRule {
  field: 
    | 'rfmSegment'
    | 'daysSinceLastPurchase'
    | 'totalPurchases'
    | 'totalSpent'
    | 'averageTicket'
    | 'category'
    | 'product'
    | 'neighborhood'
    | 'city'
    | 'birthMonth'
    | 'optInWhatsApp'
    | 'optInEmail'
    | 'hasUsedCoupon';
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'in';
  value: any;
}

export interface Segment {
  id: string;
  name: string;
  description: string;
  rules: SegmentRule[];
  matchType: 'all' | 'any'; // AND or OR
  estimatedCount: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface AuditLog {
  id: string;
  action: 
    | 'criação_cliente' 
    | 'alteração_cliente' 
    | 'exclusão_cliente' 
    | 'anonimização_lgpd' 
    | 'importação_clientes'
    | 'importação_compras' 
    | 'alteração_consentimento' 
    | 'criação_campanha' 
    | 'alteração_campanha'
    | 'exclusão_campanha'
    | 'disparo_campanha' 
    | 'criação_cupom' 
    | 'alteração_cupom'
    | 'exclusão_cupom'
    | 'utilização_cupom' 
    | 'criação_oferta_clube'
    | 'alteração_oferta_clube'
    | 'exclusão_oferta_clube'
    | 'utilização_oferta_clube'
    | 'alteração_status_clube_cliente'
    | 'resgate_fidelidade' 
    | 'alteração_regras_rfm'
    | 'limpeza_base_demo'
    | 'login';
  userName: string;
  userEmail: string;
  userRole: UserRole;
  targetEntity: string;
  targetId?: string;
  description: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

export interface Store {
  id: string;
  code: string;
  name: string;
  address: string;
  neighborhood: string;
  city: string;
  state: string;
  cep?: string;
  totalPos: number;
  posCount?: number;
  phone: string;
  managerName: string;
  latitude?: number;
  longitude?: number;
}

export interface RFMConfig {
  recencyDaysThresholds: [number, number, number, number]; // e.g. [15, 30, 60, 90] -> R5, R4, R3, R2, R1
  frequencyThresholds: [number, number, number, number]; // e.g. [2, 5, 10, 20] -> F1..F5
  monetaryThresholds: [number, number, number, number]; // e.g. [200, 600, 1500, 3500] -> M1..M5
  periodMonths: number; // mantido por compatibilidade
  windowDays?: number; // default 90 dias (janela móvel RFM)
}

export interface NextBestAction {
  id: string;
  customerId: string;
  customerName: string;
  customerCpf?: string;
  customerPhone?: string;
  customerWhatsApp?: string;
  consentWhatsApp: boolean;
  whatsappMarketing?: boolean; // Alinhado com customer.consent.whatsappMarketing
  rfmSegment: RFMSegmentType;
  category: 'Recuperação' | 'Cross-sell' | 'Aniversário' | 'VIP/Fidelidade' | 'Queda de Frequência' | 'Boas-Vindas';
  reason: string;
  evidence: string;
  recommendedAction: string;
  suggestedOffer?: string;
  suggestedCouponCode?: string;
  /** Código sugerido pela regra que ainda não existe (ou não está ativo/válido) em Cupons. */
  missingCouponCode?: string;
  urgency: 'Alta' | 'Média' | 'Baixa';
}

export interface PaginatedResult<T> {
  data: T[];
  totalCount: number;
  hasMore: boolean;
  page: number;
  totalPages: number;
}

export interface GeoNeighborhoodSummary {
  neighborhood: string;
  lat: number;
  lng: number;
  customerCount: number;
  activeCount: number;
  totalRevenue: number;
  averageTicket: number;
}

export interface RFMSegmentSummary {
  segment: RFMSegmentType;
  name: string;
  count: number;
  totalRevenue: number;
  averageTicket: number;
  pctCustomers: number;
  pctRevenue: number;
  color: string;
}

export interface DashboardMetrics {
  totalCustomers: number;
  activeCustomers: number;
  newCustomersMonth: number;
  customersWithCpf: number;
  customersWithWhatsApp: number;
  customersWithWhatsAppOptIn: number;
  captureRatePercent: number;
  averageIdentifiedTicket: number;
  averageFrequency: number;
  totalIdentifiedRevenue: number;
  totalIdentifiedPurchases: number;
  
  rfmCounts: {
    champions: number;
    loyal: number;
    atRisk: number;
    lost: number;
    others: number;
  };
  
  rfmPercentages: {
    champions: number;
    loyal: number;
    atRisk: number;
    lost: number;
  };
}
