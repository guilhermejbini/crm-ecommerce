// Motor da pesquisa de satisfação: roda no SERVIDOR (server.ts).
// Não acessa Firebase diretamente: recebe um "store" (banco) e um "sender" (WhatsApp),
// o que permite testar tudo sem rede (tests/satisfactionSurvey.test.ts).

import {
  SurveySettings,
  SurveyPurchase,
  SurveyCustomer,
  SurveyContact,
  SatisfactionSurveyRecord,
  SurveySkipReason,
  normalizeSurveySettings,
  isWithinSendWindow,
  isPurchaseInScope,
  checkCustomer,
  purchaseAmount,
  recentPurchasesSinceIso,
  getLocalTime,
  buildSurveyTemplateMessage,
  parseSurveyReply,
  normalizeIncomingNumber,
  thankYouText,
  OPT_OUT_CONFIRMATION
} from './satisfactionSurveyRules';

export interface SurveyStore {
  getSettings(): Promise<Partial<SurveySettings> | null>;
  listPurchasesSince(sinceIso: string): Promise<SurveyPurchase[]>;
  existingSurveyIds(purchaseIds: string[]): Promise<Set<string>>;
  getCustomer(id: string): Promise<SurveyCustomer | null>;
  getContact(customerId: string): Promise<SurveyContact | null>;
  isPhoneOptedOut(phone: string): Promise<boolean>;
  hasOpenTicket(customerId: string): Promise<boolean>;
  countSentOnDay(dayKey: string): Promise<number>;
  /** Cria o registro; retorna false se já existir (evita envio duplicado). */
  createSurvey(record: SatisfactionSurveyRecord): Promise<boolean>;
  updateSurvey(id: string, patch: Partial<SatisfactionSurveyRecord>): Promise<void>;
  setContact(customerId: string, patch: Partial<SurveyContact> & Record<string, unknown>): Promise<void>;
  addPhoneOptOut(phone: string, customerId?: string): Promise<void>;
  findSurveyByMessageId(messageId: string): Promise<SatisfactionSurveyRecord | null>;
  findLatestSentSurveyByPhone(phone: string): Promise<SatisfactionSurveyRecord | null>;
  /** Trava simples para dois servidores não rodarem o ciclo ao mesmo tempo. */
  acquireLock(ttlMs: number): Promise<boolean>;
  releaseLock(): Promise<void>;
}

export interface SendResult { ok: boolean; messageId?: string; error?: string }

export interface SurveySender {
  /** true quando o WhatsApp está configurado e as mensagens saem de verdade. */
  live: boolean;
  sendTemplate(message: ReturnType<typeof buildSurveyTemplateMessage>): Promise<SendResult>;
  sendText(to: string, text: string): Promise<SendResult>;
}

export interface CycleSummary {
  status: 'ok' | 'desligado' | 'fora_do_horario' | 'em_andamento' | 'limite_diario';
  mode: 'live' | 'simulation';
  checked: number;
  sent: number;
  simulated: number;
  failed: number;
  skipped: number;
  skippedByReason: Partial<Record<SurveySkipReason, number>>;
  ranAt: string;
}

export async function runSurveyCycle(store: SurveyStore, sender: SurveySender, now = new Date()): Promise<CycleSummary> {
  const settings = normalizeSurveySettings(await store.getSettings());
  const summary: CycleSummary = {
    status: 'ok', mode: sender.live ? 'live' : 'simulation',
    checked: 0, sent: 0, simulated: 0, failed: 0, skipped: 0, skippedByReason: {}, ranAt: now.toISOString()
  };
  if (!settings.enabled) return { ...summary, status: 'desligado' };
  if (!isWithinSendWindow(now, settings)) return { ...summary, status: 'fora_do_horario' };
  if (!(await store.acquireLock(10 * 60 * 1000))) return { ...summary, status: 'em_andamento' };

  try {
    const dayKey = getLocalTime(now).dayKey;
    let sentToday = await store.countSentOnDay(dayKey);
    if (sentToday >= settings.dailyLimit) return { ...summary, status: 'limite_diario' };

    const purchases = (await store.listPurchasesSince(recentPurchasesSinceIso(now, settings)))
      .filter(p => p.customerId && !isPurchaseInScope(p, settings, now));
    if (purchases.length === 0) return summary;

    const existing = await store.existingSurveyIds(purchases.map(p => p.id));
    const pending = purchases
      .filter(p => !existing.has(p.id))
      .sort((a, b) => String(b.purchaseDate).localeCompare(String(a.purchaseDate)));

    const seenCustomers = new Set<string>();
    for (const purchase of pending) {
      if (sentToday >= settings.dailyLimit) { summary.status = 'limite_diario'; break; }
      summary.checked++;
      const customerId = purchase.customerId as string;
      const base = baseRecord(purchase, now, dayKey);

      const skip = async (reason: SurveySkipReason, customerName?: string) => {
        if (await store.createSurvey({ ...base, customerName: customerName || '', status: 'skipped', skipReason: reason })) {
          summary.skipped++;
          summary.skippedByReason[reason] = (summary.skippedByReason[reason] || 0) + 1;
        }
      };

      // Uma pesquisa por cliente: a compra mais recente vale, as outras do mesmo período não geram mensagem.
      if (seenCustomers.has(customerId)) { await skip('outra_compra_mesmo_dia'); continue; }
      seenCustomers.add(customerId);

      const customer = await store.getCustomer(customerId);
      const contact = customer ? await store.getContact(customerId) : null;
      const check = checkCustomer({
        customer,
        contact,
        phoneOptedOut: false,
        hasOpenTicket: false,
        settings,
        now
      });
      if ('reason' in check) { await skip(check.reason, customer?.name); continue; }
      if (await store.isPhoneOptedOut(check.phone)) { await skip('pediu_para_parar', customer?.name); continue; }
      if (settings.skipWithOpenTicket && await store.hasOpenTicket(customerId)) { await skip('chamado_aberto', customer?.name); continue; }

      const record: SatisfactionSurveyRecord = {
        ...base,
        customerName: customer?.name || '',
        status: 'sending',
        phone: check.phone,
        mode: sender.live ? 'live' : 'simulation'
      };
      if (!(await store.createSurvey(record))) continue; // outro servidor já tratou esta compra

      if (!sender.live) {
        await store.updateSurvey(record.id, { status: 'simulated' });
        summary.simulated++;
        continue;
      }

      const result = await sender.sendTemplate(buildSurveyTemplateMessage({
        to: check.phone,
        templateName: settings.templateName,
        language: settings.templateLanguage,
        customerName: customer?.name,
        storeName: purchase.storeName
      }));
      const sentAt = new Date().toISOString();
      if (result.ok) {
        await store.updateSurvey(record.id, { status: 'sent', sentAt, waMessageId: result.messageId || '' });
        await store.setContact(customerId, { lastSentAt: sentAt, lastSurveyId: record.id });
        summary.sent++;
        sentToday++;
      } else {
        // Falha não é repetida automaticamente (melhor perder uma pesquisa do que mandar duas).
        await store.updateSurvey(record.id, { status: 'failed', error: (result.error || 'Erro desconhecido').slice(0, 300) });
        summary.failed++;
      }
    }
    return summary;
  } finally {
    await store.releaseLock();
  }
}

function baseRecord(p: SurveyPurchase, now: Date, dayKey: string): SatisfactionSurveyRecord {
  return {
    id: p.id,
    purchaseId: p.id,
    customerId: p.customerId || '',
    customerName: '',
    storeId: p.storeId || '',
    storeName: p.storeName || '',
    purchaseDate: p.purchaseDate,
    amount: Math.round(purchaseAmount(p) * 100) / 100,
    status: 'skipped',
    createdAt: now.toISOString(),
    dayKey
  };
}

// ---------------------------------------------------------------
// Webhook: o que o cliente respondeu e o status das mensagens
// ---------------------------------------------------------------

export interface IncomingMessage {
  from: string;
  /** id da mensagem original quando o cliente toca no botão ou responde citando. */
  contextId?: string;
  payload?: string;
  text?: string;
}

const ANSWER_WINDOW_MS = 3 * 86400000;
const COMMENT_WINDOW_MS = 24 * 3600000;
const COMMENT_MAX_CHARS = 2000;

export async function handleIncomingMessage(
  store: SurveyStore, sender: SurveySender, msg: IncomingMessage, now = new Date()
): Promise<'rating' | 'comment' | 'optout' | 'ignored'> {
  const phone = normalizeIncomingNumber(msg.from);
  const reply = parseSurveyReply({ payload: msg.payload, text: msg.text });
  if (reply.kind === 'ignore') return 'ignored';

  let survey = msg.contextId ? await store.findSurveyByMessageId(msg.contextId) : null;
  if (!survey) {
    const latest = await store.findLatestSentSurveyByPhone(phone);
    if (latest?.sentAt && now.getTime() - new Date(latest.sentAt).getTime() <= ANSWER_WINDOW_MS) survey = latest;
  }

  if (reply.kind === 'optout') {
    // Vale mesmo sem pesquisa encontrada: quem pede para parar não recebe mais.
    await store.addPhoneOptOut(phone, survey?.customerId);
    if (survey?.customerId) await store.setContact(survey.customerId, { optedOut: true, optedOutAt: now.toISOString() });
    if (survey) await store.updateSurvey(survey.id, { optedOut: true });
    if (sender.live) await sender.sendText(phone, OPT_OUT_CONFIRMATION);
    return 'optout';
  }

  // Mensagem que não é resposta a uma pesquisa nossa fica para o atendimento humano.
  if (!survey) return 'ignored';

  if (reply.kind === 'rating') {
    const firstAnswer = typeof survey.rating !== 'number';
    await store.updateSurvey(survey.id, { rating: reply.rating, answeredAt: now.toISOString() });
    if (firstAnswer && sender.live) await sender.sendText(phone, thankYouText(reply.rating));
    return 'rating';
  }

  // Detalhe opcional: guarda sem responder (para não virar conversa automática).
  // Quem escreve em várias mensagens seguidas tem tudo juntado, até 24h depois da nota.
  const ref = survey.answeredAt || survey.sentAt;
  if (ref && now.getTime() - new Date(ref).getTime() > COMMENT_WINDOW_MS) return 'ignored';
  const previous = survey.comment || '';
  if (previous.length >= COMMENT_MAX_CHARS) return 'ignored';
  const comment = (previous ? `${previous}\n${reply.text}` : reply.text).slice(0, COMMENT_MAX_CHARS);
  await store.updateSurvey(survey.id, { comment, commentAt: now.toISOString() });
  return 'comment';
}

export async function handleStatusUpdate(store: SurveyStore, messageId: string, status: string, errorTitle?: string): Promise<void> {
  const survey = await store.findSurveyByMessageId(messageId);
  if (!survey) return;
  const patch: Partial<SatisfactionSurveyRecord> = { deliveryStatus: status };
  if (status === 'failed') { patch.status = 'failed'; patch.error = (errorTitle || 'Falha na entrega').slice(0, 300); }
  await store.updateSurvey(survey.id, patch);
}
