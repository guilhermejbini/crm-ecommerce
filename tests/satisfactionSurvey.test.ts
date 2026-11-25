import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  normalizeSurveySettings,
  isWithinSendWindow,
  isPurchaseInScope,
  checkCustomer,
  toWhatsAppNumber,
  normalizeIncomingNumber,
  parseSurveyReply,
  buildSurveyTemplateMessage,
  firstName,
  storeDisplayName,
  DEFAULT_SURVEY_SETTINGS,
  SatisfactionSurveyRecord,
  SurveyPurchase,
  SurveyCustomer,
  SurveyContact
} from '../src/services/satisfactionSurveyRules';
import { runSurveyCycle, handleIncomingMessage, SurveyStore, SurveySender } from '../src/services/satisfactionSurveyEngine';
import { isValidMetaSignature, parseWebhookBody } from '../src/services/satisfactionSurveyServer';

const S = DEFAULT_SURVEY_SETTINGS;
// Quarta-feira, 25/11/2026, 10h em Brasília (13h UTC)
const WED_10H = new Date('2026-11-25T13:00:00Z');

function memoryStore(init: {
  settings?: any;
  purchases?: SurveyPurchase[];
  customers?: SurveyCustomer[];
  contacts?: Record<string, SurveyContact>;
  optouts?: string[];
  openTickets?: string[];
} = {}) {
  const surveys = new Map<string, SatisfactionSurveyRecord>();
  const contacts = new Map(Object.entries(init.contacts || {}));
  const optouts = new Set(init.optouts || []);
  let locked = false;
  const store: SurveyStore = {
    async getSettings() { return init.settings || null; },
    async listPurchasesSince(since) { return (init.purchases || []).filter(p => p.purchaseDate >= since); },
    async existingSurveyIds(ids) { return new Set(ids.filter(id => surveys.has(id))); },
    async getCustomer(id) { return (init.customers || []).find(c => c.id === id) || null; },
    async getContact(id) { return contacts.get(id) || null; },
    async isPhoneOptedOut(phone) { return optouts.has(phone); },
    async hasOpenTicket(id) { return (init.openTickets || []).includes(id); },
    async countSentOnDay(day) { return [...surveys.values()].filter(s => s.dayKey === day && s.status === 'sent').length; },
    async createSurvey(r) { if (surveys.has(r.id)) return false; surveys.set(r.id, { ...r }); return true; },
    async updateSurvey(id, patch) { surveys.set(id, { ...(surveys.get(id) as any), ...patch }); },
    async setContact(id, patch) { contacts.set(id, { ...(contacts.get(id) || {}), ...patch }); },
    async addPhoneOptOut(phone) { optouts.add(phone); },
    async findSurveyByMessageId(mid) { return [...surveys.values()].find(s => s.waMessageId === mid) || null; },
    async findLatestSentSurveyByPhone(phone) {
      return [...surveys.values()].filter(s => s.phone === phone && s.status === 'sent')
        .sort((a, b) => String(b.sentAt).localeCompare(String(a.sentAt)))[0] || null;
    },
    async acquireLock() { if (locked) return false; locked = true; return true; },
    async releaseLock() { locked = false; }
  };
  return { store, surveys, contacts, optouts };
}

function fakeSender(live = true, fail = false) {
  const sent: any[] = [];
  const texts: Array<{ to: string; text: string }> = [];
  let n = 0;
  const sender: SurveySender = {
    live,
    async sendTemplate(m) { sent.push(m); return fail ? { ok: false, error: 'Template não aprovado' } : { ok: true, messageId: `wamid.${++n}` }; },
    async sendText(to, text) { texts.push({ to, text }); return { ok: true }; }
  };
  return { sender, sent, texts };
}

const maria: SurveyCustomer = {
  id: 'c1', name: 'MARIA APARECIDA', whatsapp: '(41) 98765-4321', consent: { whatsappMarketing: true }
};
const purchase = (over: Partial<SurveyPurchase> = {}): SurveyPurchase => ({
  id: 'p1', customerId: 'c1', storeId: 'store-02', storeName: 'Astral Centro',
  purchaseDate: '2026-11-25T09:30:00.000Z', netAmount: 120, totalAmount: 120, ...over
});

describe('configurações', () => {
  it('padrão: compras acima de R$ 80, 30 dias, seg a sáb, 9h às 19h', () => {
    expect(S.minAmount).toBe(80);
    expect(S.cooldownDays).toBe(30);
    expect(S.sendWeekdays).toEqual([1, 2, 3, 4, 5, 6]);
    expect([S.startHour, S.endHour]).toEqual([9, 19]);
  });

  it('corrige valores inválidos', () => {
    const s = normalizeSurveySettings({ minAmount: -5 as any, startHour: 20, endHour: 8, sendWeekdays: [9, 1, 1] as any, templateName: 'Nome Errado!' });
    expect(s.minAmount).toBe(0);
    expect(s.endHour).toBe(21);
    expect(s.sendWeekdays).toEqual([1]);
    expect(s.templateName).toBe('pesquisa_satisfacao');
  });
});

describe('horário de envio (Brasília)', () => {
  it('quarta 10h: pode', () => expect(isWithinSendWindow(WED_10H, S)).toBe(true));
  it('quarta 8h59: não pode', () => expect(isWithinSendWindow(new Date('2026-11-25T11:59:00Z'), S)).toBe(false));
  it('quarta 19h: não pode', () => expect(isWithinSendWindow(new Date('2026-11-25T22:00:00Z'), S)).toBe(false));
  it('domingo 10h: não pode', () => expect(isWithinSendWindow(new Date('2026-11-29T13:00:00Z'), S)).toBe(false));
  it('sábado 10h: pode', () => expect(isWithinSendWindow(new Date('2026-11-28T13:00:00Z'), S)).toBe(true));
});

describe('compra entra na pesquisa', () => {
  it('R$ 80,00 exatos não entra (precisa ser mais de 80)', () => {
    expect(isPurchaseInScope(purchase({ netAmount: 80 }), S, WED_10H)).toBe('valor_abaixo_minimo');
    expect(isPurchaseInScope(purchase({ netAmount: 80.01 }), S, WED_10H)).toBeNull();
  });
  it('usa o valor líquido (com desconto)', () => {
    expect(isPurchaseInScope(purchase({ totalAmount: 100, netAmount: 75 }), S, WED_10H)).toBe('valor_abaixo_minimo');
  });
  it('compra de 3 dias atrás é antiga; de 2 dias ainda vale', () => {
    expect(isPurchaseInScope(purchase({ purchaseDate: '2026-11-22T15:00:00.000Z' }), S, WED_10H)).toBe('compra_antiga');
    expect(isPurchaseInScope(purchase({ purchaseDate: '2026-11-23T15:00:00.000Z' }), S, WED_10H)).toBeNull();
  });
});

describe('telefone', () => {
  it('aceita celular com DDD e devolve com 55', () => {
    expect(toWhatsAppNumber('(41) 98765-4321')).toBe('5541987654321');
    expect(toWhatsAppNumber('+55 41 98765-4321')).toBe('5541987654321');
    expect(toWhatsAppNumber('041987654321')).toBe('5541987654321');
  });
  it('recusa fixo, número curto e repetido', () => {
    expect(toWhatsAppNumber('(41) 3333-4444')).toBeNull();
    expect(toWhatsAppNumber('123')).toBeNull();
    expect(toWhatsAppNumber('99999999999')).toBeNull();
  });
  it('número do webhook sem o 9 vira o formato do cadastro', () => {
    expect(normalizeIncomingNumber('554187654321')).toBe('5541987654321');
    expect(normalizeIncomingNumber('5541987654321')).toBe('5541987654321');
  });
});

describe('quem recebe', () => {
  const base = { contact: null, phoneOptedOut: false, hasOpenTicket: false, settings: S, now: WED_10H };
  it('cliente com consentimento e celular: recebe', () => {
    expect(checkCustomer({ ...base, customer: maria })).toEqual({ ok: true, phone: '5541987654321' });
  });
  it('sem consentimento, anonimizado ou sem celular: não recebe', () => {
    expect(checkCustomer({ ...base, customer: { ...maria, consent: { whatsappMarketing: false } } })).toMatchObject({ reason: 'sem_consentimento' });
    expect(checkCustomer({ ...base, customer: { ...maria, consent: { whatsappMarketing: 'true' } } })).toMatchObject({ reason: 'sem_consentimento' });
    expect(checkCustomer({ ...base, customer: { ...maria, isAnonymized: true } })).toMatchObject({ reason: 'anonimizado' });
    expect(checkCustomer({ ...base, customer: { ...maria, whatsapp: '' } })).toMatchObject({ reason: 'telefone_invalido' });
  });
  it('pediu para parar: não recebe', () => {
    expect(checkCustomer({ ...base, customer: maria, contact: { optedOut: true } })).toMatchObject({ reason: 'pediu_para_parar' });
  });
  it('recebeu há 29 dias: não recebe; há 31 dias: recebe', () => {
    const d = (days: number) => new Date(WED_10H.getTime() - days * 86400000).toISOString();
    expect(checkCustomer({ ...base, customer: maria, contact: { lastSentAt: d(29) } })).toMatchObject({ reason: 'pesquisa_recente' });
    expect(checkCustomer({ ...base, customer: maria, contact: { lastSentAt: d(31) } })).toMatchObject({ ok: true });
  });
});

describe('mensagem', () => {
  it('nome e loja ficam legíveis', () => {
    expect(firstName('MARIA APARECIDA')).toBe('Maria');
    expect(firstName('')).toBe('cliente');
    expect(storeDisplayName('Astral Centro')).toBe('Super Astral Centro');
    expect(storeDisplayName('')).toBe('Super Astral');
  });
  it('modelo tem nome, loja e os 3 botões na ordem', () => {
    const m = buildSurveyTemplateMessage({ to: '5541987654321', templateName: 'pesquisa_satisfacao', language: 'pt_BR', customerName: 'JOÃO', storeName: 'Astral Centro' });
    expect(m.template.components[0].parameters.map((p: any) => p.text)).toEqual(['João', 'Super Astral Centro']);
    expect(m.template.components.slice(1).map((c: any) => c.parameters[0].payload)).toEqual(['NOTA_5', 'NOTA_3', 'NOTA_1']);
  });
});

describe('respostas', () => {
  it('botões e números viram nota', () => {
    expect(parseSurveyReply({ payload: 'NOTA_5' })).toEqual({ kind: 'rating', rating: 5 });
    expect(parseSurveyReply({ text: '4' })).toEqual({ kind: 'rating', rating: 4 });
    expect(parseSurveyReply({ text: 'Nota 2' })).toEqual({ kind: 'rating', rating: 2 });
    expect(parseSurveyReply({ text: 'Não gostei' })).toEqual({ kind: 'rating', rating: 1 });
  });
  it('PARAR e variações viram opt-out', () => {
    for (const t of ['PARAR', 'parar.', 'Não quero receber', 'sair', 'Stop']) {
      expect(parseSurveyReply({ text: t })).toEqual({ kind: 'optout' });
    }
  });
  it('outro texto vira comentário', () => {
    expect(parseSurveyReply({ text: 'A fila do caixa estava grande' })).toEqual({ kind: 'comment', text: 'A fila do caixa estava grande' });
  });
});

describe('ciclo de envio automático', () => {
  it('envia para compra acima de R$ 80 e registra', async () => {
    const { store, surveys, contacts } = memoryStore({ purchases: [purchase()], customers: [maria] });
    const { sender, sent } = fakeSender();
    const r = await runSurveyCycle(store, sender, WED_10H);
    expect(r).toMatchObject({ status: 'ok', sent: 1 });
    expect(sent[0].to).toBe('5541987654321');
    expect(surveys.get('p1')).toMatchObject({ status: 'sent', waMessageId: 'wamid.1', amount: 120 });
    expect(contacts.get('c1')?.lastSentAt).toBeTruthy();
  });

  it('não envia compra de R$ 80 ou menos (nem registra)', async () => {
    const { store, surveys } = memoryStore({ purchases: [purchase({ netAmount: 50 })], customers: [maria] });
    const { sender, sent } = fakeSender();
    await runSurveyCycle(store, sender, WED_10H);
    expect(sent).toHaveLength(0);
    expect(surveys.size).toBe(0);
  });

  it('rodar duas vezes não manda duas mensagens', async () => {
    const { store } = memoryStore({ purchases: [purchase()], customers: [maria] });
    const { sender, sent } = fakeSender();
    await runSurveyCycle(store, sender, WED_10H);
    await runSurveyCycle(store, sender, WED_10H);
    expect(sent).toHaveLength(1);
  });

  it('duas compras no mesmo dia: uma mensagem só (a mais recente)', async () => {
    const { store, surveys } = memoryStore({
      purchases: [purchase({ id: 'p1', purchaseDate: '2026-11-25T09:00:00.000Z' }), purchase({ id: 'p2', purchaseDate: '2026-11-25T12:00:00.000Z' })],
      customers: [maria]
    });
    const { sender, sent } = fakeSender();
    await runSurveyCycle(store, sender, WED_10H);
    expect(sent).toHaveLength(1);
    expect(surveys.get('p2')?.status).toBe('sent');
    expect(surveys.get('p1')).toMatchObject({ status: 'skipped', skipReason: 'outra_compra_mesmo_dia' });
  });

  it('compra nova 10 dias depois: não envia (30 dias)', async () => {
    const { store, surveys } = memoryStore({
      purchases: [purchase()], customers: [maria],
      contacts: { c1: { lastSentAt: new Date(WED_10H.getTime() - 10 * 86400000).toISOString() } }
    });
    const { sender, sent } = fakeSender();
    await runSurveyCycle(store, sender, WED_10H);
    expect(sent).toHaveLength(0);
    expect(surveys.get('p1')?.skipReason).toBe('pesquisa_recente');
  });

  it('fora do horário e desligado: não faz nada', async () => {
    const a = memoryStore({ purchases: [purchase()], customers: [maria] });
    const f = fakeSender();
    expect((await runSurveyCycle(a.store, f.sender, new Date('2026-11-29T13:00:00Z'))).status).toBe('fora_do_horario');
    const b = memoryStore({ purchases: [purchase()], customers: [maria], settings: { enabled: false } });
    expect((await runSurveyCycle(b.store, f.sender, WED_10H)).status).toBe('desligado');
    expect(f.sent).toHaveLength(0);
  });

  it('atendimento aberto e telefone que pediu para parar: não envia', async () => {
    const t = memoryStore({ purchases: [purchase()], customers: [maria], openTickets: ['c1'] });
    const o = memoryStore({ purchases: [purchase()], customers: [maria], optouts: ['5541987654321'] });
    const f = fakeSender();
    await runSurveyCycle(t.store, f.sender, WED_10H);
    await runSurveyCycle(o.store, f.sender, WED_10H);
    expect(f.sent).toHaveLength(0);
    expect(t.surveys.get('p1')?.skipReason).toBe('chamado_aberto');
    expect(o.surveys.get('p1')?.skipReason).toBe('pediu_para_parar');
  });

  it('respeita o limite diário', async () => {
    const customers = [1, 2, 3].map(i => ({ ...maria, id: `c${i}`, whatsapp: `(41) 98765-432${i}` }));
    const purchases = [1, 2, 3].map(i => purchase({ id: `p${i}`, customerId: `c${i}` }));
    const { store } = memoryStore({ purchases, customers, settings: { dailyLimit: 2 } });
    const { sender, sent } = fakeSender();
    const r = await runSurveyCycle(store, sender, WED_10H);
    expect(sent).toHaveLength(2);
    expect(r.status).toBe('limite_diario');
  });

  it('modo teste (sem WhatsApp configurado): registra e não envia, sem contar os 30 dias', async () => {
    const { store, surveys, contacts } = memoryStore({ purchases: [purchase()], customers: [maria] });
    const { sender, sent } = fakeSender(false);
    const r = await runSurveyCycle(store, sender, WED_10H);
    expect(r.mode).toBe('simulation');
    expect(sent).toHaveLength(0);
    expect(surveys.get('p1')?.status).toBe('simulated');
    expect(contacts.get('c1')).toBeUndefined();
  });

  it('falha no envio fica registrada e não é repetida', async () => {
    const { store, surveys } = memoryStore({ purchases: [purchase()], customers: [maria] });
    const f = fakeSender(true, true);
    await runSurveyCycle(store, f.sender, WED_10H);
    await runSurveyCycle(store, f.sender, WED_10H);
    expect(f.sent).toHaveLength(1);
    expect(surveys.get('p1')).toMatchObject({ status: 'failed', error: 'Template não aprovado' });
  });
});

describe('respostas pelo webhook', () => {
  async function sentSurvey() {
    const m = memoryStore({ purchases: [purchase()], customers: [maria] });
    const f = fakeSender();
    await runSurveyCycle(m.store, f.sender, WED_10H);
    return { ...m, ...f };
  }
  const later = new Date(WED_10H.getTime() + 3600000);

  it('toque no botão grava a nota e agradece uma vez', async () => {
    const { store, sender, surveys, texts } = await sentSurvey();
    await handleIncomingMessage(store, sender, { from: '5541987654321', contextId: 'wamid.1', payload: 'NOTA_1', text: 'Não gostei' }, later);
    await handleIncomingMessage(store, sender, { from: '5541987654321', contextId: 'wamid.1', payload: 'NOTA_3' }, later);
    expect(surveys.get('p1')?.rating).toBe(3);
    expect(texts).toHaveLength(1);
  });

  it('detalhe depois de 24h não é guardado', async () => {
    const { store, sender, surveys } = await sentSurvey();
    await handleIncomingMessage(store, sender, { from: '5541987654321', payload: 'NOTA_5' }, later);
    const twoDays = new Date(later.getTime() + 2 * 86400000);
    expect(await handleIncomingMessage(store, sender, { from: '5541987654321', text: 'oi' }, twoDays)).toBe('ignored');
    expect(surveys.get('p1')?.comment).toBeUndefined();
  });

  it('comentário depois da nota fica guardado, sem resposta automática', async () => {
    const { store, sender, surveys, texts } = await sentSurvey();
    await handleIncomingMessage(store, sender, { from: '554187654321', payload: 'NOTA_1' }, later);
    expect(await handleIncomingMessage(store, sender, { from: '554187654321', text: 'Faltou pão francês' }, later)).toBe('comment');
    expect(surveys.get('p1')).toMatchObject({ rating: 1, comment: 'Faltou pão francês' });
    expect(texts).toHaveLength(1);
  });

  it('agradecimento convida a escrever um detalhe, para nota boa e ruim', async () => {
    const { thankYouText } = await import('../src/services/satisfactionSurveyRules');
    expect(thankYouText(5)).toMatch(/escreva aqui algum detalhe/);
    expect(thankYouText(1)).toMatch(/escreva aqui o que aconteceu/);
    expect(thankYouText(5)).toMatch(/Não precisa responder/);
  });

  it('detalhe depois de "Gostei" também fica guardado', async () => {
    const { store, sender, surveys, texts } = await sentSurvey();
    await handleIncomingMessage(store, sender, { from: '5541987654321', contextId: 'wamid.1', payload: 'NOTA_5' }, later);
    expect(texts[0].text).toMatch(/algum detalhe/);
    await handleIncomingMessage(store, sender, { from: '5541987654321', text: 'A moça do açougue foi muito atenciosa' }, later);
    await handleIncomingMessage(store, sender, { from: '5541987654321', text: 'e o pão estava quentinho' }, later);
    expect(surveys.get('p1')).toMatchObject({ rating: 5, comment: 'A moça do açougue foi muito atenciosa\ne o pão estava quentinho' });
    expect(texts).toHaveLength(1);
  });

  it('PARAR bloqueia o telefone e o cliente', async () => {
    const { store, sender, contacts, optouts } = await sentSurvey();
    expect(await handleIncomingMessage(store, sender, { from: '5541987654321', text: 'PARAR' }, later)).toBe('optout');
    expect(optouts.has('5541987654321')).toBe(true);
    expect(contacts.get('c1')?.optedOut).toBe(true);
  });

  it('mensagem de quem não recebeu pesquisa é ignorada', async () => {
    const { store } = memoryStore();
    const { sender } = fakeSender();
    expect(await handleIncomingMessage(store, sender, { from: '5541911112222', text: 'Bom dia' }, later)).toBe('ignored');
  });
});

describe('segurança do webhook', () => {
  it('assinatura da Meta', () => {
    const body = Buffer.from('{"a":1}');
    const sig = 'sha256=' + crypto.createHmac('sha256', 'segredo').update(body).digest('hex');
    expect(isValidMetaSignature(body, sig, 'segredo')).toBe(true);
    expect(isValidMetaSignature(body, sig, 'outro')).toBe(false);
    expect(isValidMetaSignature(body, undefined, 'segredo')).toBe(false);
    expect(isValidMetaSignature(body, sig, '')).toBe(false);
  });

  it('lê botões, textos e status do corpo do webhook', () => {
    const r = parseWebhookBody({ entry: [{ changes: [{ value: {
      messages: [{ from: '5541987654321', context: { id: 'wamid.1' }, type: 'button', button: { payload: 'NOTA_5', text: 'Gostei' } }],
      statuses: [{ id: 'wamid.1', status: 'read' }]
    } }] }] });
    expect(r.messages[0]).toMatchObject({ from: '5541987654321', contextId: 'wamid.1', payload: 'NOTA_5' });
    expect(r.statuses[0]).toEqual({ id: 'wamid.1', status: 'read', error: undefined });
  });
});
