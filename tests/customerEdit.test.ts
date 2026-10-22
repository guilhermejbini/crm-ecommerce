import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { createFirestoreMock, MemStore } from './firestoreMock';
import { buildConsentUpdate, buildCustomerEditPatch, CustomerFormValues } from '../src/utils/customerEdit';

const mem = vi.hoisted(() => ({ store: new Map() as any }));
vi.mock('firebase/firestore', () => createFirestoreMock(mem.store));
vi.mock('../src/services/firebase', () => ({ db: {}, auth: {}, default: {} }));

const ADMIN = { id: 'u', name: 'Admin', email: 'admin@exemplo.test', role: 'admin' } as any;
const store = () => mem.store as MemStore;
const put = (col: string, id: string, data: any) => {
  if (!store().has(col)) store().set(col, new Map());
  store().get(col)!.set(id, { ...data });
};
const get = (col: string, id: string) => store().get(col)?.get(id);

const T0 = '2025-01-10T10:00:00.000Z';
const T1 = '2026-10-02T12:00:00.000Z';

/** Cliente vindo do RP Flex/site, com campos que o formulário não conhece. */
const flexCustomer = () => ({
  id: 'cust-flex-abc',
  name: 'Maria Souza',
  cpf: '529.982.247-25',
  whatsapp: '41999990000',
  email: 'maria@exemplo.test',
  address: 'Rua A',
  number: '10',
  neighborhood: 'Centro',
  city: 'Almirante Tamandaré',
  state: 'PR',
  cep: '83500-000',
  notes: 'Prefere entrega',
  origin: 'RP Flex',
  latitude: -25.3,
  longitude: -49.3,
  geocodeStatus: 'geocoded',
  code: '1234',
  personType: 'PF',
  cnpj: undefined,
  companyName: 'Mercadinho Souza',
  registeredAt: '2019-05-01',
  firstPurchaseDate: '2019-05-02',
  isClubMember: true,
  clubJoinedAt: '2020-01-01',
  clubTotalSavings: 87.5,
  favoriteStoreId: 'store-02',
  favoriteStoreName: 'Astral Centro',
  tags: ['vip'],
  totalSpent: 1500,
  totalPurchases: 30,
  averageTicket: 50,
  consent: {
    whatsappMarketing: true,
    emailMarketing: false,
    smsMarketing: false,
    whatsappConsentDate: T0,
    origin: 'Site',
    purpose: 'Ofertas',
    lastUpdated: T0,
    history: [{ type: 'whatsapp', status: true, date: T0, origin: 'Site', updatedBy: 'site' }]
  }
});

const formFrom = (c: any, over: Partial<CustomerFormValues> = {}): CustomerFormValues => ({
  name: c.name, cpf: c.cpf, whatsapp: c.whatsapp, phone: c.phone, email: c.email, birthDate: c.birthDate,
  address: c.address, number: c.number, complement: c.complement, neighborhood: c.neighborhood,
  city: c.city, state: c.state, cep: c.cep, notes: c.notes, origin: c.origin,
  consent: {
    whatsappMarketing: c.consent.whatsappMarketing,
    emailMarketing: c.consent.emailMarketing,
    smsMarketing: c.consent.smsMarketing,
    purpose: c.consent.purpose
  },
  ...over
});

beforeEach(async () => {
  store().clear();
  vi.resetModules();
  const svc = await import('../src/services/firestoreService');
  svc.invalidateCache('all');
});

describe('#2 consentimento: datas e histórico', () => {
  it('salvar sem mudar canais mantém datas, lastUpdated e histórico', () => {
    const c = flexCustomer();
    const r = buildConsentUpdate(c.consent as any, formFrom(c).consent, { nowIso: T1, updatedBy: 'Op', origin: 'CRM' });
    expect(r.whatsappConsentDate).toBe(T0);
    expect(r.lastUpdated).toBe(T0);
    expect(r.history).toEqual(c.consent.history);
  });

  it('mudança de um canal só altera aquele canal e acrescenta ao histórico', () => {
    const c = flexCustomer();
    const r = buildConsentUpdate(c.consent as any,
      { ...formFrom(c).consent, emailMarketing: true }, { nowIso: T1, updatedBy: 'Op', origin: 'CRM' });
    expect(r.whatsappConsentDate).toBe(T0);
    expect(r.emailConsentDate).toBe(T1);
    expect(r.lastUpdated).toBe(T1);
    expect(r.history).toHaveLength(2);
    expect(r.history![0]).toEqual(c.consent.history[0]);
    expect(r.history![1]).toMatchObject({ type: 'email', status: true, date: T1, updatedBy: 'Op' });
  });

  it('retirada de consentimento remove a data de opt-in e fica registrada no histórico', () => {
    const c = flexCustomer();
    const r = buildConsentUpdate(c.consent as any,
      { ...formFrom(c).consent, whatsappMarketing: false }, { nowIso: T1, updatedBy: 'Op', origin: 'CRM' });
    expect(r.whatsappMarketing).toBe(false);
    expect(r.whatsappConsentDate).toBeUndefined();
    expect(r.history!.at(-1)).toMatchObject({ type: 'whatsapp', status: false, date: T1 });
    expect(r.origin).toBe('Site');
  });

  it('cadastro novo registra no histórico só os canais aceitos', () => {
    const r = buildConsentUpdate(undefined,
      { whatsappMarketing: true, emailMarketing: false, smsMarketing: false, purpose: 'Ofertas' },
      { nowIso: T1, updatedBy: 'Op', origin: 'Formulário de Cadastro CRM' });
    expect(r.whatsappConsentDate).toBe(T1);
    expect(r.emailConsentDate).toBeUndefined();
    expect(r.history).toEqual([{ type: 'whatsapp', status: true, date: T1, origin: 'Formulário de Cadastro CRM', updatedBy: 'Op' }]);
  });
});

describe('#1 edição pelo formulário não apaga campos', () => {
  it('patch contém só campos do formulário que mudaram', () => {
    const c = flexCustomer();
    const { patch, clearFields } = buildCustomerEditPatch(c as any, formFrom(c, { name: 'Maria S. Souza' }), { nowIso: T1, updatedBy: 'Op' });
    expect(patch.name).toBe('Maria S. Souza');
    expect(clearFields).toEqual([]);
    for (const k of ['code', 'registeredAt', 'isClubMember', 'clubTotalSavings', 'favoriteStoreId', 'tags', 'totalSpent', 'companyName', 'latitude']) {
      expect(patch).not.toHaveProperty(k);
    }
  });

  it('editar no Firestore preserva Flex/site/clube/loja/totais', async () => {
    const svc = await import('../src/services/firestoreService');
    const c = flexCustomer();
    put('customers', c.id, c);
    const { patch, clearFields } = buildCustomerEditPatch(c as any, formFrom(c, { notes: 'Entrega às sextas' }), { nowIso: T1, updatedBy: 'Op' });
    await svc.updateCustomerFields(c.id, patch, clearFields, ADMIN);
    const doc = get('customers', c.id);
    expect(doc.notes).toBe('Entrega às sextas');
    expect(doc).toMatchObject({
      code: '1234', personType: 'PF', companyName: 'Mercadinho Souza', registeredAt: '2019-05-01',
      firstPurchaseDate: '2019-05-02', isClubMember: true, clubJoinedAt: '2020-01-01', clubTotalSavings: 87.5,
      favoriteStoreId: 'store-02', favoriteStoreName: 'Astral Centro', tags: ['vip'],
      totalSpent: 1500, totalPurchases: 30, latitude: -25.3, longitude: -49.3
    });
    expect(doc.consent.whatsappConsentDate).toBe(T0);
    expect(doc.consent.history).toHaveLength(1);
    expect(doc.updatedAt).toBe(T1);
  });

  it('esvaziar um campo opcional apaga o campo (deleteField), sem tocar no resto', async () => {
    const svc = await import('../src/services/firestoreService');
    const c = flexCustomer();
    put('customers', c.id, c);
    const { patch, clearFields } = buildCustomerEditPatch(c as any, formFrom(c, { email: '  ', notes: '' }), { nowIso: T1, updatedBy: 'Op' });
    expect(clearFields.sort()).toEqual(['email', 'notes']);
    await svc.updateCustomerFields(c.id, patch, clearFields, ADMIN);
    const doc = get('customers', c.id);
    expect(doc).not.toHaveProperty('email');
    expect(doc).not.toHaveProperty('notes');
    expect(doc.code).toBe('1234');
    // Cache em memória também sem os campos apagados
    const cached = (await svc.getCustomers()).find((x: any) => x.id === c.id);
    expect(cached).not.toHaveProperty('email');
  });

  it('campos obrigatórios nunca são apagados pelo formulário', () => {
    const c = flexCustomer();
    const { patch, clearFields } = buildCustomerEditPatch(c as any, formFrom(c, { name: '', whatsapp: '' }), { nowIso: T1, updatedBy: 'Op' });
    expect(clearFields).not.toContain('name');
    expect(clearFields).not.toContain('whatsapp');
    expect(patch).not.toHaveProperty('name');
  });

  it('mudar o endereço invalida a coordenada antiga e volta para a fila do mapa', async () => {
    const svc = await import('../src/services/firestoreService');
    const c = flexCustomer();
    put('customers', c.id, c);
    const { patch, clearFields } = buildCustomerEditPatch(c as any, formFrom(c, { address: 'Rua B' }), { nowIso: T1, updatedBy: 'Op' });
    await svc.updateCustomerFields(c.id, patch, clearFields, ADMIN);
    const doc = get('customers', c.id);
    expect(doc.address).toBe('Rua B');
    expect(doc).not.toHaveProperty('latitude');
    expect(doc).not.toHaveProperty('longitude');
    expect(doc.geocodeStatus).toBe('pending');
  });

  it('sem mudança de endereço a coordenada fica', () => {
    const c = flexCustomer();
    const { patch, clearFields } = buildCustomerEditPatch(c as any, formFrom(c), { nowIso: T1, updatedBy: 'Op' });
    expect(clearFields).toEqual([]);
    expect(patch).not.toHaveProperty('geocodeStatus');
  });

  it('cliente anonimizado não pode ser editado por este caminho', async () => {
    const svc = await import('../src/services/firestoreService');
    put('customers', 'cust-anon-1', { id: 'cust-anon-1', name: 'Cliente Anonimizado', isAnonymized: true });
    await expect(svc.updateCustomerFields('cust-anon-1', { name: 'X' }, [], ADMIN)).rejects.toThrow(/anonimizado/);
    expect(get('customers', 'cust-anon-1').name).toBe('Cliente Anonimizado');
  });

  it('patch não consegue mudar id nem flags de anonimização', async () => {
    const svc = await import('../src/services/firestoreService');
    const c = flexCustomer();
    put('customers', c.id, c);
    await svc.updateCustomerFields(c.id, { isAnonymized: true, id: 'outro' } as any, ['anonymizedAt'], ADMIN);
    const doc = get('customers', c.id);
    expect(doc.isAnonymized).toBeUndefined();
    expect(doc.id).toBe(c.id);
  });

  it('log de auditoria registra só nomes de campos, não valores', async () => {
    const svc = await import('../src/services/firestoreService');
    const c = flexCustomer();
    put('customers', c.id, c);
    const { patch, clearFields } = buildCustomerEditPatch(c as any, formFrom(c, { email: 'novo@exemplo.test' }), { nowIso: T1, updatedBy: 'Op' });
    await svc.updateCustomerFields(c.id, patch, clearFields, ADMIN);
    const logs = JSON.stringify(Array.from((store().get('audit_logs') || new Map()).values()));
    expect(logs).toContain('email');
    expect(logs).not.toContain('novo@exemplo.test');
  });
});

describe('#1 anonimização continua sobrescrevendo o documento inteiro', () => {
  it('nenhum dado pessoal de campos fora do formulário sobra após anonimizar', async () => {
    const svc = await import('../src/services/firestoreService');
    const c = { ...flexCustomer(), id: 'cust-xyz', cnpj: '11.222.333/0001-81', rgIe: '12.345.678-9', cardName: 'MARIA S', gender: 'F' };
    put('customers', c.id, c);
    const r = await svc.anonymizeCustomerLGPD(c.id, ADMIN);
    const doc = JSON.stringify(get('customers', r!.id));
    for (const v of ['Maria Souza', '529.982.247-25', 'maria@exemplo.test', 'Mercadinho Souza', '11.222.333/0001-81', '12.345.678-9', 'MARIA S', 'Rua A', '83500-000', '1234']) {
      expect(doc).not.toContain(v);
    }
  });

  it('a anonimização usa saveCustomer (setDoc sem merge), não o caminho de edição', () => {
    const src = readFileSync('src/services/firestoreService.ts', 'utf8');
    const fn = src.slice(src.indexOf('export async function anonymizeCustomerLGPD'), src.indexOf('export async function anonymizeCustomerLGPD') + 12000);
    expect(fn).toMatch(/await saveCustomer\(anonymized, user\)/);
    expect(fn).not.toMatch(/updateCustomerFields/);
    const save = src.slice(src.indexOf('export async function saveCustomer('), src.indexOf('export async function updateCustomerFields'));
    expect(save).toMatch(/setDoc\(doc\(db, CUSTOMERS_COL, cleanCustomer\.id\), sanitizeForFirestore\(cleanCustomer\)\)/);
  });

  it('o formulário de edição usa o caminho parcial e não usa mais o bairro "Centro" como padrão', () => {
    const src = readFileSync('src/components/Customers/CustomerModal.tsx', 'utf8');
    expect(src).toMatch(/handleUpdateCustomer\(customer\.id, patch, clearFields\)/);
    expect(src).not.toMatch(/'Centro'/);
  });
});

describe('#3 simulador do PDV não grava dados reais', () => {
  it('o simulador não chama o registro de uso de oferta nem grava economia', () => {
    const src = readFileSync('src/components/Loyalty/LoyaltyClubView.tsx', 'utf8');
    expect(src).not.toMatch(/handleRecordClubOfferUsage|recordClubOfferUsage/);
    expect(src).not.toMatch(/Gravar Economia/);
    const fn = src.slice(src.indexOf('const handleConfirmSimCheckout'), src.indexOf('const handleConfirmSimCheckout') + 1500);
    expect(fn).not.toMatch(/await |handleSave|setDoc|updateDoc/);
    expect(fn).toMatch(/Nada foi gravado/);
  });
});

describe('#4 CPF duplicado bloqueia o cadastro', () => {
  it('encontra duplicata no Firestore em formato com ou sem máscara, ignorando anonimizados', async () => {
    const svc = await import('../src/services/firestoreService');
    put('customers', 'a', { id: 'a', name: 'Com máscara', cpf: '529.982.247-25' });
    put('customers', 'b', { id: 'b', name: 'Sem máscara', cpf: '52998224725' });
    put('customers', 'c', { id: 'c', name: 'Cliente Anonimizado', cpf: '529.982.247-25', isAnonymized: true });
    const found = await svc.findCustomersByCpf('52998224725');
    expect(found.map((c: any) => c.id).sort()).toEqual(['a', 'b']);
    expect(await svc.findCustomersByCpf('111.444.777-35')).toEqual([]);
    expect(await svc.findCustomersByCpf('Não informado')).toEqual([]);
  });

  it('o formulário bloqueia (return) em vez de só avisar, e só quando o CPF é novo ou mudou', () => {
    const src = readFileSync('src/components/Customers/CustomerModal.tsx', 'utf8');
    const i = src.indexOf('findCustomersByCpf(validatedCpf)');
    expect(i).toBeGreaterThan(0);
    expect(src.slice(i, i + 500)).toMatch(/return;/);
    expect(src).toMatch(/const cpfChanged = !customer \|\|/);
  });
});

describe('#5 RFM envelhece com o tempo', () => {
  it('recência é recalculada pela data, mesmo sem compra nova, e só campos RFM mudam', async () => {
    const { recalculateCustomersRFM } = await import('../src/services/rfmCalculator');
    const now = new Date('2026-10-02T12:00:00Z');
    const c = {
      id: 'c1', name: 'Cliente', cpf: '529.982.247-25', totalPurchases: 1, totalSpent: 100,
      lastPurchaseDate: '2026-09-27T12:00:00Z', daysSinceLastPurchase: 0, recencyScore: 5, rfmSegment: 'NOVOS'
    } as any;
    const purchases = [{ customerId: 'c1', purchaseDate: '2026-09-27T12:00:00Z', netAmount: 100 }];
    const r1 = recalculateCustomersRFM([c], purchases, undefined, now);
    expect(r1.updated[0].daysSinceLastPurchase).toBe(5);

    const later = new Date('2027-01-15T12:00:00Z');
    const r2 = recalculateCustomersRFM(r1.updated, purchases, undefined, later);
    expect(r2.updated[0].daysSinceLastPurchase).toBe(110);
    expect(r2.updated[0].recencyScore).toBe(1);
    expect(r2.updated[0].rfmFrequency).toBe(0); // compra saiu da janela de 90 dias
    expect(Object.keys(r2.changes[0].patch)).not.toContain('name');
    expect(Object.keys(r2.changes[0].patch)).not.toContain('cpf');

    // Rodar de novo no mesmo dia não gera mudanças
    expect(recalculateCustomersRFM(r2.updated, purchases, undefined, later).changes).toHaveLength(0);
  });

  it('sem compras carregadas, envelhece a partir da última compra conhecida', async () => {
    const { recalculateCustomersRFM } = await import('../src/services/rfmCalculator');
    const c = { id: 'c2', totalPurchases: 3, totalSpent: 300, lastPurchaseDate: '2026-09-01T00:00:00Z', daysSinceLastPurchase: 2 } as any;
    const r = recalculateCustomersRFM([c], [], undefined, new Date('2026-10-02T00:00:00Z'));
    expect(r.updated[0].daysSinceLastPurchase).toBe(31);
  });

  it('gravação só dos campos RFM (merge) preserva o restante e marca o dia', async () => {
    const svc = await import('../src/services/firestoreService');
    const c = flexCustomer();
    put('customers', c.id, c);
    await svc.getCustomers();
    await svc.saveRFMChanges([{ id: c.id, patch: { daysSinceLastPurchase: 40, rfmSegment: 'EM RISCO' } }], ADMIN, 'automatica');
    const doc = get('customers', c.id);
    expect(doc.daysSinceLastPurchase).toBe(40);
    expect(doc.email).toBe('maria@exemplo.test');
    expect(doc.consent.history).toHaveLength(1);
    expect(get('rfm', 'status').day).toBe(svc.rfmDayKey());
    expect(await svc.getRFMLastRecalculatedDay()).toBe(svc.rfmDayKey());
  });

  it('listagem paginada de compras não guarda recorte de 300 como base inteira', () => {
    const src = readFileSync('src/services/firestoreService.ts', 'utf8');
    const fn = src.slice(src.indexOf('export async function getPurchasesPaginated'), src.indexOf('export async function getPurchasesPaginated') + 1200);
    expect(fn).not.toMatch(/limit\(300\)/);
  });

  it('o contexto agenda a recalculação diária automática para gestor/admin', () => {
    const src = readFileSync('src/context/CRMContext.tsx', 'utf8');
    expect(src).toMatch(/runRFMRecalculation\('automatica'\)/);
    expect(src).toMatch(/lastDay === rfmDayKey\(\)/);
  });
});
