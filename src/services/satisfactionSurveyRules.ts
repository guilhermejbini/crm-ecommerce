// Pesquisa de satisfação pós-compra (WhatsApp).
// Regras puras, sem Firebase: usadas pelo servidor (envio automático e respostas)
// e pela tela do CRM (rótulos e configurações). Testes em tests/satisfactionSurvey.test.ts.

export const SURVEY_SETTINGS_DOC = 'satisfaction_survey';
export const SURVEY_STATUS_DOC = 'satisfaction_survey_status';
export const SURVEYS_COL = 'satisfaction_surveys';
export const SURVEY_CONTACTS_COL = 'survey_contacts';
export const SURVEY_OPTOUTS_COL = 'survey_optouts';
export const SURVEY_TIMEZONE = 'America/Sao_Paulo';

export interface SurveySettings {
  /** Liga/desliga o envio automático. */
  enabled: boolean;
  /** Só compras com valor MAIOR que este (R$). */
  minAmount: number;
  /** Intervalo mínimo entre duas pesquisas para o mesmo cliente (dias). */
  cooldownDays: number;
  /** Só pergunta sobre compras de até N dias atrás (hoje conta como 0). */
  maxPurchaseAgeDays: number;
  /** Dias da semana com envio (0 = domingo ... 6 = sábado). */
  sendWeekdays: number[];
  /** Horário de envio, no fuso de Brasília: início (inclusive) e fim (exclusive). */
  startHour: number;
  endHour: number;
  /** Máximo de pesquisas enviadas por dia (proteção contra importação errada). */
  dailyLimit: number;
  /** Não envia para quem tem chamado/tarefa aberta no Atendimento. */
  skipWithOpenTicket: boolean;
  /** Nome e idioma do modelo de mensagem aprovado na Meta. */
  templateName: string;
  templateLanguage: string;
}

export const DEFAULT_SURVEY_SETTINGS: SurveySettings = {
  enabled: true,
  minAmount: 80,
  cooldownDays: 30,
  maxPurchaseAgeDays: 2,
  sendWeekdays: [1, 2, 3, 4, 5, 6],
  startHour: 9,
  endHour: 19,
  dailyLimit: 200,
  skipWithOpenTicket: true,
  templateName: 'pesquisa_satisfacao',
  templateLanguage: 'pt_BR'
};

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Junta o que está salvo com os padrões, corrigindo valores fora da faixa. */
export function normalizeSurveySettings(raw: Partial<SurveySettings> | null | undefined): SurveySettings {
  const r = raw || {};
  const d = DEFAULT_SURVEY_SETTINGS;
  const weekdays = Array.isArray(r.sendWeekdays)
    ? Array.from(new Set(r.sendWeekdays.map(Number).filter(w => Number.isInteger(w) && w >= 0 && w <= 6))).sort()
    : d.sendWeekdays;
  const startHour = Math.round(num(r.startHour, d.startHour, 0, 23));
  let endHour = Math.round(num(r.endHour, d.endHour, 1, 24));
  if (endHour <= startHour) endHour = Math.min(24, startHour + 1);
  const templateName = typeof r.templateName === 'string' && /^[a-z0-9_]{1,512}$/.test(r.templateName.trim())
    ? r.templateName.trim() : d.templateName;
  const templateLanguage = typeof r.templateLanguage === 'string' && /^[a-z]{2}(_[A-Z]{2})?$/.test(r.templateLanguage.trim())
    ? r.templateLanguage.trim() : d.templateLanguage;
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : d.enabled,
    minAmount: num(r.minAmount, d.minAmount, 0, 100000),
    cooldownDays: Math.round(num(r.cooldownDays, d.cooldownDays, 1, 365)),
    maxPurchaseAgeDays: Math.round(num(r.maxPurchaseAgeDays, d.maxPurchaseAgeDays, 0, 7)),
    sendWeekdays: weekdays,
    startHour,
    endHour,
    dailyLimit: Math.round(num(r.dailyLimit, d.dailyLimit, 1, 5000)),
    skipWithOpenTicket: typeof r.skipWithOpenTicket === 'boolean' ? r.skipWithOpenTicket : d.skipWithOpenTicket,
    templateName,
    templateLanguage
  };
}

// ---------------------------------------------------------------
// Data e hora em Brasília
// ---------------------------------------------------------------

export interface LocalTime { year: number; month: number; day: number; hour: number; weekday: number; dayKey: string }

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function getLocalTime(date: Date, timeZone = SURVEY_TIMEZONE): LocalTime {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short'
  }).formatToParts(date);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  const hour = Number(get('hour')) % 24;
  const weekday = WEEKDAYS[get('weekday')] ?? 0;
  const dayKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { year, month, day, hour, weekday, dayKey };
}

export function isWithinSendWindow(now: Date, settings: SurveySettings): boolean {
  const t = getLocalTime(now);
  return settings.sendWeekdays.includes(t.weekday) && t.hour >= settings.startHour && t.hour < settings.endHour;
}

/** Dia local (AAAA-MM-DD) da compra. Datas só com dia são lidas como estão. */
export function purchaseDayKey(purchaseDate: string): string | null {
  if (!purchaseDate) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(purchaseDate)) return purchaseDate;
  const d = new Date(purchaseDate);
  if (Number.isNaN(d.getTime())) return null;
  return getLocalTime(d).dayKey;
}

function dayKeyToUtc(dayKey: string): number {
  const [y, m, d] = dayKey.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Dias de calendário entre a compra e hoje (Brasília). Hoje = 0. */
export function purchaseAgeDays(purchaseDate: string, now: Date): number | null {
  const key = purchaseDayKey(purchaseDate);
  if (!key) return null;
  return Math.round((dayKeyToUtc(getLocalTime(now).dayKey) - dayKeyToUtc(key)) / 86400000);
}

/** Limite inferior (ISO, com folga de 1 dia) para buscar compras recentes no banco. */
export function recentPurchasesSinceIso(now: Date, settings: SurveySettings): string {
  return new Date(now.getTime() - (settings.maxPurchaseAgeDays + 1) * 86400000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------
// Telefone
// ---------------------------------------------------------------

/** Converte para o formato do WhatsApp (55 + DDD + número). Só celulares (9 dígitos). */
export function toWhatsAppNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, '');
  while (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) digits = digits.slice(2);
  if (digits.length !== 11) return null; // fixo (10 dígitos) não tem WhatsApp confiável
  if (/^(\d)\1+$/.test(digits)) return null;
  const ddd = Number(digits.slice(0, 2));
  if (ddd < 11 || ddd > 99) return null;
  if (digits[2] !== '9') return null;
  return `55${digits}`;
}

/** Número que o WhatsApp manda no webhook (às vezes sem o 9) para o mesmo formato acima. */
export function normalizeIncomingNumber(raw: string): string {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length === 12 && /[6-9]/.test(digits[4])) {
    digits = `${digits.slice(0, 4)}9${digits.slice(4)}`;
  }
  return digits;
}

export function maskPhone(phone: string): string {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 6) return '***';
  return `(${d.slice(-11, -9)}) *****-${d.slice(-4)}`;
}

// ---------------------------------------------------------------
// Quem recebe
// ---------------------------------------------------------------

export type SurveySkipReason =
  | 'sem_cliente'
  | 'cliente_nao_encontrado'
  | 'anonimizado'
  | 'sem_consentimento'
  | 'telefone_invalido'
  | 'pediu_para_parar'
  | 'pesquisa_recente'
  | 'chamado_aberto'
  | 'outra_compra_mesmo_dia'
  | 'compra_antiga'
  | 'valor_abaixo_minimo';

export const SKIP_REASON_LABELS: Record<SurveySkipReason, string> = {
  sem_cliente: 'Compra sem cliente identificado',
  cliente_nao_encontrado: 'Cliente não encontrado no cadastro',
  anonimizado: 'Cliente anonimizado (LGPD)',
  sem_consentimento: 'Não autorizou mensagens no WhatsApp',
  telefone_invalido: 'Sem celular válido',
  pediu_para_parar: 'Pediu para não receber pesquisas',
  pesquisa_recente: 'Já recebeu pesquisa nos últimos dias',
  chamado_aberto: 'Tem atendimento em aberto',
  outra_compra_mesmo_dia: 'Já vai receber por outra compra',
  compra_antiga: 'Compra antiga',
  valor_abaixo_minimo: 'Valor abaixo do mínimo'
};

export interface SurveyPurchase {
  id: string;
  customerId?: string;
  storeId?: string;
  storeName?: string;
  purchaseDate: string;
  netAmount?: number;
  totalAmount?: number;
}

export interface SurveyCustomer {
  id: string;
  name?: string;
  whatsapp?: string;
  phone?: string;
  isAnonymized?: boolean;
  consent?: { whatsappMarketing?: unknown } | null;
}

export interface SurveyContact {
  lastSentAt?: string;
  optedOut?: boolean;
}

export function purchaseAmount(p: SurveyPurchase): number {
  const v = typeof p.netAmount === 'number' && Number.isFinite(p.netAmount) ? p.netAmount : p.totalAmount;
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** A compra em si entra na pesquisa? (valor e data; não olha o cliente). */
export function isPurchaseInScope(p: SurveyPurchase, settings: SurveySettings, now: Date): SurveySkipReason | null {
  if (!(purchaseAmount(p) > settings.minAmount)) return 'valor_abaixo_minimo';
  const age = purchaseAgeDays(p.purchaseDate, now);
  if (age === null || age < 0 || age > settings.maxPurchaseAgeDays) return 'compra_antiga';
  return null;
}

export interface CustomerCheckInput {
  customer: SurveyCustomer | null;
  contact: SurveyContact | null;
  phoneOptedOut: boolean;
  hasOpenTicket: boolean;
  settings: SurveySettings;
  now: Date;
}

/** O cliente pode receber agora? Retorna o motivo para não enviar, ou o celular. */
export function checkCustomer(input: CustomerCheckInput): { ok: true; phone: string } | { ok: false; reason: SurveySkipReason } {
  const { customer, contact, settings, now } = input;
  if (!customer) return { ok: false, reason: 'cliente_nao_encontrado' };
  if (customer.isAnonymized) return { ok: false, reason: 'anonimizado' };
  if (customer.consent?.whatsappMarketing !== true) return { ok: false, reason: 'sem_consentimento' };
  const phone = toWhatsAppNumber(customer.whatsapp) || toWhatsAppNumber(customer.phone);
  if (!phone) return { ok: false, reason: 'telefone_invalido' };
  if (contact?.optedOut || input.phoneOptedOut) return { ok: false, reason: 'pediu_para_parar' };
  if (contact?.lastSentAt) {
    const last = new Date(contact.lastSentAt).getTime();
    if (Number.isFinite(last) && now.getTime() - last < settings.cooldownDays * 86400000) {
      return { ok: false, reason: 'pesquisa_recente' };
    }
  }
  if (settings.skipWithOpenTicket && input.hasOpenTicket) return { ok: false, reason: 'chamado_aberto' };
  return { ok: true, phone };
}

// ---------------------------------------------------------------
// Mensagem enviada (modelo aprovado na Meta)
// ---------------------------------------------------------------

/** Botões do modelo, na mesma ordem cadastrada na Meta. */
export const SURVEY_BUTTONS = [
  { text: 'Gostei', payload: 'NOTA_5', rating: 5 },
  { text: 'Mais ou menos', payload: 'NOTA_3', rating: 3 },
  { text: 'Não gostei', payload: 'NOTA_1', rating: 1 }
] as const;

export const SURVEY_TEMPLATE_PREVIEW =
  'Olá, {{1}}! Obrigado por comprar no {{2}}. Como foi sua experiência hoje?\n\n' +
  'Toque em uma opção abaixo. Para não receber mais esta pesquisa, responda PARAR.';

export function firstName(name: string | undefined): string {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  if (!first || /\d/.test(first)) return 'cliente';
  return first.charAt(0).toLocaleUpperCase('pt-BR') + first.slice(1).toLocaleLowerCase('pt-BR');
}

export function storeDisplayName(storeName: string | undefined): string {
  const s = String(storeName || '').trim();
  if (!s) return 'Super Astral';
  return /astral/i.test(s) ? s.replace(/^astral\b/i, 'Super Astral') : `Super Astral ${s}`;
}

export function buildSurveyTemplateMessage(args: {
  to: string;
  templateName: string;
  language: string;
  customerName?: string;
  storeName?: string;
}) {
  return {
    messaging_product: 'whatsapp',
    to: args.to,
    type: 'template',
    template: {
      name: args.templateName,
      language: { code: args.language },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: firstName(args.customerName) },
            { type: 'text', text: storeDisplayName(args.storeName) }
          ]
        },
        ...SURVEY_BUTTONS.map((b, index) => ({
          type: 'button',
          sub_type: 'quick_reply',
          index: String(index),
          parameters: [{ type: 'payload', payload: b.payload }]
        }))
      ]
    }
  };
}

// ---------------------------------------------------------------
// Respostas do cliente
// ---------------------------------------------------------------

export type SurveyReply =
  | { kind: 'rating'; rating: number }
  | { kind: 'optout' }
  | { kind: 'comment'; text: string }
  | { kind: 'ignore' };

function plain(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

const OPT_OUT_WORDS = new Set(['parar', 'pare', 'para', 'sair', 'stop', 'cancelar', 'nao quero', 'nao quero receber', 'nao quero mais', 'nao quero mais receber', 'descadastrar']);

export function parseSurveyReply(input: { payload?: string; text?: string }): SurveyReply {
  const payload = String(input.payload || '').trim().toUpperCase();
  const m = payload.match(/^NOTA_([1-5])$/);
  if (m) return { kind: 'rating', rating: Number(m[1]) };
  if (payload === 'PARAR') return { kind: 'optout' };

  const raw = String(input.text || '').trim();
  if (!raw) return { kind: 'ignore' };
  const p = plain(raw);
  if (OPT_OUT_WORDS.has(p)) return { kind: 'optout' };
  const n = p.match(/^(?:nota )?([1-5])(?: estrelas?)?$/);
  if (n) return { kind: 'rating', rating: Number(n[1]) };
  const button = SURVEY_BUTTONS.find(b => plain(b.text) === p);
  if (button) return { kind: 'rating', rating: button.rating };
  return { kind: 'comment', text: raw.slice(0, 1000) };
}

/** Resposta curta depois da nota. Só uma mensagem, para não incomodar. */
export function thankYouText(rating: number): string {
  if (rating >= 4) return 'Que bom! Obrigado pela sua avaliação. Esperamos você de novo no Super Astral.';
  return 'Obrigado por avisar. Se quiser, conte em uma mensagem o que podemos melhorar. Sua resposta vai direto para a gerência da loja.';
}

export const OPT_OUT_CONFIRMATION = 'Pronto. Você não vai mais receber esta pesquisa do Super Astral.';

// ---------------------------------------------------------------
// Registro de cada pesquisa
// ---------------------------------------------------------------

export type SurveyStatus = 'sending' | 'sent' | 'simulated' | 'failed' | 'skipped';

export const SURVEY_STATUS_LABELS: Record<SurveyStatus, string> = {
  sending: 'Enviando',
  sent: 'Enviada',
  simulated: 'Modo teste (não enviada)',
  failed: 'Falhou',
  skipped: 'Não enviada'
};

export interface SatisfactionSurveyRecord {
  id: string; // = id da compra
  purchaseId: string;
  customerId: string;
  customerName: string;
  storeId?: string;
  storeName?: string;
  purchaseDate: string;
  amount: number;
  status: SurveyStatus;
  skipReason?: SurveySkipReason;
  phone?: string;
  mode?: 'live' | 'simulation';
  createdAt: string;
  dayKey: string;
  sentAt?: string;
  waMessageId?: string;
  deliveryStatus?: string;
  error?: string;
  rating?: number;
  answeredAt?: string;
  comment?: string;
  commentAt?: string;
  optedOut?: boolean;
}
