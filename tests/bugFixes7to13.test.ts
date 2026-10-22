import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { createFirestoreMock, MemStore } from './firestoreMock';
import { hasIdentifiedDocument, isActiveCustomer } from '../src/utils/customerMetrics';
import { findUsableCoupon, isCouponCodeTaken } from '../src/utils/couponUtils';
import { canEditCustomer, canWriteCustomers } from '../src/utils/permissions';

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
const src = (f: string) => readFileSync(f, 'utf8');
const future = '2099-12-31';

beforeEach(async () => {
  store().clear();
  vi.resetModules();
  const svc = await import('../src/services/firestoreService');
  svc.invalidateCache('all');
});

describe('#7 base de clientes vazia não esconde o resto', () => {
  it('campanhas, cupons, ofertas e compras existentes aparecem mesmo sem clientes', async () => {
    put('campaigns', 'camp-1', { id: 'camp-1', name: 'Campanha', channel: 'WhatsApp' });
    put('coupons', 'coup-1', { id: 'coup-1', code: 'X10', validUntil: future, createdAt: '2026-01-01' });
    put('club_offers', 'off-1', { id: 'off-1', productName: 'Arroz' });
    put('purchases', 'p-1', { id: 'p-1', purchaseDate: '2026-09-01', netAmount: 10 });
    const svc = await import('../src/services/firestoreService');
    expect(await svc.initializeDatabase()).toEqual({ isSeeded: false, count: 0 });
    expect((await svc.getCampaigns()).map((c: any) => c.id)).toEqual(['camp-1']);
    expect((await svc.getCoupons()).map((c: any) => c.id)).toEqual(['coup-1']);
    expect((await svc.getClubOffers()).map((c: any) => c.id)).toEqual(['off-1']);
    expect((await svc.getPurchases()).map((p: any) => p.id)).toEqual(['p-1']);
  });
});

describe('#8 métricas do Dashboard', () => {
  it('"Não informado", vazio e CPF mascarado não contam como CPF', () => {
    expect(hasIdentifiedDocument({ cpf: '529.982.247-25' } as any)).toBe(true);
    expect(hasIdentifiedDocument({ cpf: '11.222.333/0001-81' } as any)).toBe(true);
    expect(hasIdentifiedDocument({ cpf: 'Não informado' } as any)).toBe(false);
    expect(hasIdentifiedDocument({ cpf: '' } as any)).toBe(false);
    expect(hasIdentifiedDocument({ cpf: '***.***.***-**' } as any)).toBe(false);
    expect(hasIdentifiedDocument({ cpf: '529.982.247-25', isAnonymized: true } as any)).toBe(false);
  });

  it('cliente sem compra (dias 0 ou -1) não é ativo', () => {
    expect(isActiveCustomer({ daysSinceLastPurchase: 0 } as any)).toBe(false);
    expect(isActiveCustomer({ daysSinceLastPurchase: -1, lastPurchaseDate: '2026-09-01' } as any)).toBe(false);
    expect(isActiveCustomer({ daysSinceLastPurchase: 10, lastPurchaseDate: '2026-09-20' } as any)).toBe(true);
    expect(isActiveCustomer({ daysSinceLastPurchase: 31, lastPurchaseDate: '2026-09-01' } as any)).toBe(false);
  });

  it('Dashboard, serviço e mapa usam as mesmas regras', () => {
    expect(src('src/components/Dashboard/DashboardView.tsx')).toMatch(/filter\(hasIdentifiedDocument\)/);
    expect(src('src/services/firestoreService.ts')).toMatch(/filter\(hasIdentifiedDocument\)/);
    for (const f of ['src/components/Dashboard/DashboardView.tsx', 'src/components/Map/CustomerMapView.tsx', 'src/services/firestoreService.ts']) {
      expect(src(f)).not.toMatch(/daysSinceLastPurchase <= 30/);
    }
  });

  it('cliente do site sem totais não quebra a tela (campos numéricos viram 0 só em memória)', async () => {
    put('customers', 'cust-site-1', { id: 'cust-site-1', name: 'Site', cpf: '529.982.247-25' });
    const svc = await import('../src/services/firestoreService');
    const [c] = await svc.getCustomers({ forceRefresh: true });
    expect(c.totalSpent).toBe(0);
    expect(c.averageTicket).toBe(0);
    expect(c.rfmSegment).toBe('UNCLASSIFIED');
    expect(get('customers', 'cust-site-1')).not.toHaveProperty('totalSpent');
  });
});

describe('#9 NBA só cita cupom que existe', () => {
  const customer = {
    id: 'c1', name: 'Ana Souza', cpf: '529.982.247-25', whatsapp: '41999990000',
    birthDate: `1990-${String(new Date().getMonth() + 1).padStart(2, '0')}-10`,
    totalPurchases: 2, totalSpent: 100, consent: { whatsappMarketing: true }
  } as any;

  it('sem cupom cadastrado: ação sem suggestedCouponCode, mensagem sem cupom, aviso de cupom faltando', async () => {
    const { generateNextBestActions, buildNBAWhatsAppMessage } = await import('../src/services/nbaEngine');
    const [a] = generateNextBestActions([customer], [], []);
    expect(a.suggestedCouponCode).toBeUndefined();
    expect(a.missingCouponCode).toBe('NIVER-ASTRAL20');
    expect(buildNBAWhatsAppMessage(a)).not.toMatch(/cupom/i);
    expect(buildNBAWhatsAppMessage(a, true)).not.toMatch(/ASTRALVIP|cupom/i);
  });

  it('com cupom ativo e válido: usa o cupom real', async () => {
    const { generateNextBestActions, buildNBAWhatsAppMessage } = await import('../src/services/nbaEngine');
    const coupons = [{ id: 'k', code: 'niver-astral20', isActive: true, validUntil: future, createdAt: '' }] as any;
    const [a] = generateNextBestActions([customer], [], coupons);
    expect(a.suggestedCouponCode).toBe('niver-astral20');
    expect(buildNBAWhatsAppMessage(a)).toContain('niver-astral20');
  });

  it('cupom inativo ou vencido não vale', () => {
    expect(findUsableCoupon('X', [{ id: '1', code: 'X', isActive: false, validUntil: future } as any])).toBeNull();
    expect(findUsableCoupon('X', [{ id: '1', code: 'X', isActive: true, validUntil: '2020-01-01' } as any])).toBeNull();
  });

  it('nenhuma tela usa mais o cupom fixo ASTRALVIP', () => {
    for (const f of ['src/components/NBA/NBAView.tsx', 'src/components/Campaigns/CampaignListView.tsx']) {
      expect(src(f)).not.toMatch(/ASTRALVIP/);
    }
    expect(src('src/components/Campaigns/CampaignListView.tsx')).toMatch(/findUsableCoupon\(couponCode, coupons\)/);
  });
});

describe('#10 código de cupom único', () => {
  it('helper compara sem diferenciar maiúsculas/espaços e ignora o próprio cupom', () => {
    const list = [{ id: 'a', code: 'VOLTA10' }] as any;
    expect(isCouponCodeTaken(' volta10 ', list)).toBe(true);
    expect(isCouponCodeTaken('VOLTA10', list, 'a')).toBe(false);
    expect(isCouponCodeTaken('OUTRO', list)).toBe(false);
  });

  it('serviço recusa segundo cupom com o mesmo código', async () => {
    put('coupons', 'a', { id: 'a', code: 'VOLTA10', validUntil: future, createdAt: '' });
    const svc = await import('../src/services/firestoreService');
    await expect(svc.saveCoupon({ id: 'b', code: 'volta10', validUntil: future, createdAt: '' } as any, ADMIN)).rejects.toThrow(/Já existe/);
    expect(get('coupons', 'b')).toBeUndefined();
    // editar o próprio cupom continua permitido
    await svc.saveCoupon({ id: 'a', code: 'VOLTA10', validUntil: future, createdAt: '', description: 'x' } as any, ADMIN);
    expect(get('coupons', 'a').description).toBe('x');
  });
});

describe('#11 edição só para quem pode gravar e nunca em anonimizado', () => {
  it('regras de permissão espelham o firestore.rules', () => {
    expect(canWriteCustomers('viewer')).toBe(false);
    expect(canWriteCustomers('marketing')).toBe(false);
    expect(canWriteCustomers('support')).toBe(false);
    expect(canWriteCustomers('manager')).toBe(true);
    expect(canEditCustomer('admin', { isAnonymized: true })).toBe(false);
    expect(canEditCustomer('manager', {})).toBe(true);
  });

  it('lista, 360 e modal global usam as regras', () => {
    expect(src('src/components/Customers/CustomerListView.tsx')).toMatch(/canEditCustomer\(currentUser\.role, c\)/);
    expect(src('src/components/Customers/CustomerListView.tsx')).not.toMatch(/role !== 'marketing'/);
    expect(src('src/components/Customers/Customer360View.tsx')).toMatch(/canEditCustomer\(currentUser\.role, customer\)/);
    expect(src('src/App.tsx')).toMatch(/isNewCustomerModalOpen && canWriteCustomers\(currentUser\.role\)/);
  });

  it('ativar/desativar clube grava só os campos do clube', async () => {
    put('customers', 'c1', { id: 'c1', name: 'Ana', email: 'ana@exemplo.test', isClubMember: false });
    const svc = await import('../src/services/firestoreService');
    await svc.getCustomers();
    store().get('customers')!.get('c1').notes = 'gravado por outra sessão';
    await svc.toggleCustomerClubStatus('c1', true, ADMIN);
    const doc = get('customers', 'c1');
    expect(doc.isClubMember).toBe(true);
    expect(doc.notes).toBe('gravado por outra sessão');
  });
});

describe('#12 seletor de loja do cabeçalho', () => {
  it('cabeçalho não tem mais seletor de loja sem efeito', () => {
    const h = src('src/components/Layout/Header.tsx');
    expect(h).not.toMatch(/selectedStoreId/);
    expect(h).not.toMatch(/Todas as Lojas/);
  });
});

describe('#13 Cliente 360 sem dados inventados', () => {
  it('ticket não grava "Super Astral" como loja e endereço não inventa bairro/cidade', () => {
    const s = src('src/components/Customers/Customer360View.tsx');
    expect(s).not.toMatch(/favoriteStoreName \|\| 'Super Astral'/);
    expect(s).not.toMatch(/'Almirante Tamandaré'/);
    expect(s).not.toMatch(/neighborhood \|\| 'Centro'/);
  });

  it('atendimento com campos vazios é gravado (undefined não chega ao Firestore)', async () => {
    const svc = await import('../src/services/firestoreService');
    await svc.saveInteraction({ id: 'int-1', customerId: 'c1', subject: 'Teste', resolution: undefined, storeName: undefined } as any, ADMIN);
    const doc = get('interactions', 'int-1');
    expect(doc).not.toHaveProperty('resolution');
    expect(doc).not.toHaveProperty('storeName');
  });
});
