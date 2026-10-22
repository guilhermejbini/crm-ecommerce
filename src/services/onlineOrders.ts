// Pedidos da loja online (coleção shop_orders, gravada pelo servidor da loja-super-astral).
// O CRM só lê os pedidos: cada cliente do checkout vira (ou completa) um cliente do CRM e
// cada pedido concluído vira uma compra, passando pela mesma importação do PDV
// (deduplicação, vínculo por CPF e recálculo de RFM).

import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase';
import { Customer, Purchase, PurchaseItem, UserProfile } from '../types/crm';
import { cleanCpfDigits, formatCpf, isValidCpf } from '../utils/cpfValidator';
import { getStoreLabel } from './storeAndLocationData';
import {
  getCustomers,
  importPurchasesBatch,
  invalidateCache,
  logAuditEvent,
  pdvCustomerId,
  saveCustomersBatch,
  PDVImportResult
} from './firestoreService';

export const SHOP_ORDERS_COL = 'shop_orders';
export const ONLINE_ORIGIN = 'Loja Online';
export const ONLINE_TAG = 'loja-online';
export const ONLINE_POS = 'Loja Online';

export type ShopOrderStatus = 'recebido' | 'separando' | 'pronto_retirada' | 'saiu_entrega' | 'concluido' | 'cancelado';

/** Subconjunto do pedido da loja (shared/types.ts da loja) que o CRM usa. */
export interface ShopOrder {
  id: string;
  code: string;
  createdAt: string;
  updatedAt?: string;
  status: ShopOrderStatus;
  statusHistory?: { status: ShopOrderStatus; at: string; by?: string }[];
  storeId: string;
  mode: 'retirada' | 'entrega';
  slot?: { date: string; start: string; end: string };
  customer: { name: string; phone: string; email?: string; cpf?: string };
  address?: { cep: string; street: string; number: string; complement?: string; neighborhood: string; city: string };
  items: {
    sku: string;
    name: string;
    quantity: number;
    quantityMode?: 'un' | 'kg';
    unitPrice: number;
    lineTotal: number;
    isEstimate?: boolean;
    department?: string;
  }[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  hasEstimates?: boolean;
  payment?: { method: string };
}

export const ONLINE_STATUS_LABEL: Record<ShopOrderStatus, string> = {
  recebido: 'Recebido',
  separando: 'Separando',
  pronto_retirada: 'Pronto para retirada',
  saiu_entrega: 'Saiu para entrega',
  concluido: 'Concluído',
  cancelado: 'Cancelado'
};

const PAYMENT_MAP: Record<string, Purchase['paymentMethod']> = {
  pix: 'PIX',
  credito: 'Cartão Crédito',
  debito: 'Cartão Débito',
  dinheiro: 'Dinheiro',
  vale_alimentacao: 'Outro'
};

function onlyDigits(value: unknown): string {
  return String(value ?? '').replace(/\D/g, '');
}

function trimmed(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Hash estável (mesmo algoritmo do pdvCustomerId) para clientes sem CPF, identificados pelo celular. */
export function onlineCustomerIdByPhone(phoneDigits: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  const input = `online-phone:${phoneDigits}`;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `cust-online-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/** Data em que o pedido foi concluído (histórico de status), ou a última atualização. */
export function orderCompletedAt(order: ShopOrder): string {
  const done = (order.statusHistory || []).filter(h => h.status === 'concluido').map(h => h.at).sort();
  return done[done.length - 1] || order.updatedAt || order.createdAt;
}

/** ID estável da compra no CRM: um pedido online gera no máximo uma compra. */
export function onlinePurchaseId(order: Pick<ShopOrder, 'code'>): string {
  return `online_${trimmed(order.code).replace(/[^a-zA-Z0-9_-]/g, '')}`;
}

export function onlineOrderToPurchase(order: ShopOrder, customer: Pick<Customer, 'id' | 'name' | 'cpf'> | null): Purchase {
  const items: PurchaseItem[] = (order.items || []).map(line => ({
    sku: trimmed(line.sku),
    productName: trimmed(line.name),
    category: trimmed(line.department) || 'Loja Online',
    quantity: Number.isFinite(line.quantity) ? line.quantity : null,
    unitPrice: Number(line.unitPrice) || 0,
    totalPrice: Number(line.lineTotal) || 0
  }));
  const total = Number(order.total) || 0;
  const storeId = trimmed(order.storeId);
  return {
    id: onlinePurchaseId(order),
    customerId: customer?.id || '',
    customerName: customer?.name || trimmed(order.customer?.name),
    customerCpf: customer?.cpf || undefined,
    customerPhone: onlyDigits(order.customer?.phone) || undefined,
    storeId,
    storeName: getStoreLabel(storeId) || storeId,
    posNumber: ONLINE_POS,
    couponReceiptNumber: trimmed(order.code),
    purchaseDate: orderCompletedAt(order),
    totalAmount: total,
    discountAmount: 0,
    netAmount: total,
    paymentMethod: order.payment?.method ? PAYMENT_MAP[order.payment.method] || 'Outro' : undefined,
    items,
    itemsCount: items.length
  };
}

function emptyMetrics(): Pick<Customer,
  'totalSpent' | 'totalPurchases' | 'averageTicket' | 'daysSinceLastPurchase' | 'rfmSegment' |
  'recencyScore' | 'frequencyScore' | 'monetaryScore' | 'rfmScoreCode'> {
  return {
    totalSpent: 0,
    totalPurchases: 0,
    averageTicket: 0,
    daysSinceLastPurchase: 0,
    rfmSegment: 'UNCLASSIFIED',
    recencyScore: 0,
    frequencyScore: 0,
    monetaryScore: 0,
    rfmScoreCode: '000'
  };
}

/** Dados de contato e endereço do checkout no formato do cadastro do CRM. */
function contactFromOrder(order: ShopOrder): Partial<Customer> {
  const phone = onlyDigits(order.customer?.phone);
  const addr = order.mode === 'entrega' ? order.address : undefined;
  const contact: Partial<Customer> = {
    name: trimmed(order.customer?.name) || undefined,
    whatsapp: phone || undefined,
    phone: phone || undefined,
    email: trimmed(order.customer?.email).toLowerCase() || undefined
  };
  if (addr) {
    contact.address = trimmed(addr.street) || undefined;
    contact.number = trimmed(addr.number) || undefined;
    contact.complement = trimmed(addr.complement) || undefined;
    contact.neighborhood = trimmed(addr.neighborhood) || undefined;
    contact.city = trimmed(addr.city) || undefined;
    contact.cep = onlyDigits(addr.cep) || undefined;
  }
  return contact;
}

export interface OnlineSyncPlan {
  /** Clientes novos e clientes existentes completados (só campos vazios são preenchidos). */
  customersToSave: Customer[];
  newCustomersCount: number;
  updatedCustomersCount: number;
  /** Compras dos pedidos concluídos, já com o cliente vinculado. */
  purchases: Purchase[];
  /** Pedido -> cliente do CRM, para a tela de pedidos. */
  customerIdByOrder: Map<string, string>;
  skippedOrders: { code: string; reason: string }[];
}

/**
 * Monta o que a sincronização vai gravar, sem acessar o banco.
 * Regras:
 * - CPF válido identifica o cliente (mesmo ID da importação do PDV, então loja física e online se juntam).
 * - Sem CPF, o celular identifica um cliente da loja online (nunca é ligado a um cadastro de outra origem).
 * - Cliente existente só recebe campos que estão vazios; nada já cadastrado é sobrescrito.
 * - Consentimento de marketing nunca é marcado: o aceite do checkout é só para avisos do pedido.
 * - Só pedidos concluídos viram compras. Pedidos cancelados ainda geram o cadastro.
 */
export function planOnlineOrdersSync(orders: ShopOrder[], existingCustomers: Customer[], nowIso = new Date().toISOString()): OnlineSyncPlan {
  const byId = new Map(existingCustomers.map(c => [c.id, c]));
  const byCpf = new Map<string, Customer>();
  for (const c of existingCustomers) {
    const d = cleanCpfDigits(c.cpf);
    if (d) byCpf.set(d, c);
  }

  const touched = new Map<string, Customer>();
  const created = new Set<string>();
  const customerIdByOrder = new Map<string, string>();
  const skippedOrders: { code: string; reason: string }[] = [];
  const purchases: Purchase[] = [];

  const sorted = [...orders].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  for (const order of sorted) {
    const code = trimmed(order.code);
    if (!code) {
      skippedOrders.push({ code: order.id, reason: 'Pedido sem código.' });
      continue;
    }
    const cpfDigits = cleanCpfDigits(order.customer?.cpf);
    const hasCpf = isValidCpf(cpfDigits);
    const phone = onlyDigits(order.customer?.phone);
    if (!hasCpf && phone.length < 10) {
      skippedOrders.push({ code, reason: 'Pedido sem CPF válido e sem celular válido: não dá para identificar o cliente.' });
      continue;
    }

    let customer = touched.get(hasCpf ? pdvCustomerId(cpfDigits) : onlineCustomerIdByPhone(phone))
      || (hasCpf ? byCpf.get(cpfDigits) : byId.get(onlineCustomerIdByPhone(phone)));
    if (customer && touched.has(customer.id)) customer = touched.get(customer.id)!;

    const contact = contactFromOrder(order);

    if (!customer) {
      const id = hasCpf ? pdvCustomerId(cpfDigits) : onlineCustomerIdByPhone(phone);
      customer = {
        id,
        name: contact.name || '',
        cpf: hasCpf ? formatCpf(cpfDigits) : '',
        whatsapp: contact.whatsapp || '',
        origin: ONLINE_ORIGIN,
        createdAt: order.createdAt || nowIso,
        registeredAt: order.createdAt || nowIso,
        updatedAt: nowIso,
        createdBy: 'Loja Online',
        consent: {
          whatsappMarketing: false,
          emailMarketing: false,
          smsMarketing: false,
          origin: ONLINE_ORIGIN,
          purpose: 'Cadastro feito no checkout da loja online (sem autorização de ofertas)'
        },
        favoriteStoreId: trimmed(order.storeId) || undefined,
        favoriteStoreName: getStoreLabel(trimmed(order.storeId)) || undefined,
        tags: [ONLINE_TAG],
        // Comprar na loja online não inscreve no Clube Astral (a inscrição é a ficha do site)
        isClubMember: false,
        ...emptyMetrics()
      };
      for (const [k, v] of Object.entries(contact)) {
        if (v !== undefined && (customer as any)[k] === undefined) (customer as any)[k] = v;
      }
      created.add(id);
      touched.set(id, customer);
      if (hasCpf) byCpf.set(cpfDigits, customer);
    } else {
      const next: Customer = { ...customer, tags: [...(customer.tags || [])] };
      let changed = false;
      if (!customer.isAnonymized) {
        for (const [k, v] of Object.entries(contact)) {
          const current = (next as any)[k];
          if (v !== undefined && (current === undefined || current === null || String(current).trim() === '')) {
            (next as any)[k] = v;
            changed = true;
          }
        }
      }
      if (!customer.isAnonymized && !next.tags!.includes(ONLINE_TAG)) {
        next.tags!.push(ONLINE_TAG);
        changed = true;
      }
      if (changed) {
        next.updatedAt = nowIso;
        touched.set(next.id, next);
        if (hasCpf) byCpf.set(cpfDigits, next);
      }
      customer = next;
    }

    customerIdByOrder.set(code, customer.id);
    if (order.status === 'concluido' && !customer.isAnonymized) {
      purchases.push(onlineOrderToPurchase(order, customer));
    }
  }

  const customersToSave = Array.from(touched.values());
  return {
    customersToSave,
    newCustomersCount: created.size,
    updatedCustomersCount: customersToSave.length - created.size,
    purchases,
    customerIdByOrder,
    skippedOrders
  };
}

export async function getOnlineOrders(): Promise<ShopOrder[]> {
  const snap = await getDocs(collection(db, SHOP_ORDERS_COL));
  return snap.docs.map(d => ({ ...(d.data() as any), id: (d.data() as any)?.id || d.id }) as ShopOrder);
}

export interface OnlineSyncResult {
  ordersRead: number;
  newCustomersCount: number;
  updatedCustomersCount: number;
  purchasesImported: number;
  purchasesAlreadyInCRM: number;
  skippedOrders: { code: string; reason: string }[];
  importResult: PDVImportResult | null;
}

/** Lê os pedidos da loja e grava clientes e compras no CRM. Pode rodar quantas vezes quiser. */
export async function syncOnlineOrders(user: UserProfile, preloadedOrders?: ShopOrder[]): Promise<OnlineSyncResult> {
  const orders = preloadedOrders || await getOnlineOrders();
  const customers = await getCustomers({ forceRefresh: true });
  const plan = planOnlineOrdersSync(orders, customers);

  if (plan.customersToSave.length > 0) {
    await saveCustomersBatch(plan.customersToSave, user);
    invalidateCache('customers');
  }

  let importResult: PDVImportResult | null = null;
  if (plan.purchases.length > 0) {
    // Clientes já gravados acima: a importação só vincula pelo ID/CPF, nunca cria outro cadastro.
    importResult = await importPurchasesBatch(plan.purchases, user, false);
  }

  if (plan.customersToSave.length > 0 && !(importResult && importResult.persistedCount > 0)) {
    await logAuditEvent(
      'importação_clientes',
      `Loja online: ${plan.newCustomersCount} clientes novos e ${plan.updatedCustomersCount} cadastros completados.`,
      user,
      'customers'
    );
  }

  return {
    ordersRead: orders.length,
    newCustomersCount: plan.newCustomersCount,
    updatedCustomersCount: plan.updatedCustomersCount,
    purchasesImported: importResult?.persistedCount || 0,
    purchasesAlreadyInCRM: importResult?.duplicatesCount || 0,
    skippedOrders: plan.skippedOrders,
    importResult
  };
}
