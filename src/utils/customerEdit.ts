import { Customer, CustomerConsent } from '../types/crm';

/**
 * Edição de cadastro pelo formulário do CRM.
 *
 * O formulário só conhece parte do cadastro. Campos vindos do RP Flex, do site, do PDV ou do clube
 * (código, CNPJ, data de cadastro, totais, clube, loja favorita, tags...) não aparecem nele e não
 * podem ser apagados ao salvar. Por isso a edição gera apenas um "patch" com os campos do
 * formulário que mudaram, mais a lista de campos que o operador esvaziou (apagados com deleteField).
 */

export const FORM_OWNED_FIELDS = [
  'name', 'cpf', 'whatsapp', 'phone', 'email', 'birthDate',
  'address', 'number', 'complement', 'neighborhood', 'city', 'state', 'cep',
  'notes', 'origin'
] as const;

export type FormOwnedField = typeof FORM_OWNED_FIELDS[number];

/** Campos que, se mudarem, invalidam a coordenada do mapa. */
const LOCATION_FIELDS: FormOwnedField[] = ['address', 'number', 'neighborhood', 'city', 'state', 'cep'];

/** Campos que nunca podem ser apagados pelo formulário (obrigatórios no cadastro). */
const REQUIRED_FIELDS: FormOwnedField[] = ['name', 'cpf', 'whatsapp', 'origin'];

export type ConsentChannel = 'whatsapp' | 'email' | 'sms';

export interface ConsentChoice {
  whatsappMarketing: boolean;
  emailMarketing: boolean;
  smsMarketing: boolean;
  purpose: string;
}

export type CustomerFormValues = Record<FormOwnedField, string | undefined> & { consent: ConsentChoice };

const CHANNELS: { channel: ConsentChannel; flag: 'whatsappMarketing' | 'emailMarketing' | 'smsMarketing'; date: 'whatsappConsentDate' | 'emailConsentDate' | 'smsConsentDate' }[] = [
  { channel: 'whatsapp', flag: 'whatsappMarketing', date: 'whatsappConsentDate' },
  { channel: 'email', flag: 'emailMarketing', date: 'emailConsentDate' },
  { channel: 'sms', flag: 'smsMarketing', date: 'smsConsentDate' }
];

/**
 * Consentimento LGPD: a data de um canal só muda quando aquele canal muda, e cada mudança
 * é acrescentada ao histórico (o histórico anterior nunca é descartado).
 * Retirada de consentimento remove a data de opt-in do canal; o registro da retirada fica no histórico.
 */
export function buildConsentUpdate(
  prev: CustomerConsent | undefined,
  next: ConsentChoice,
  ctx: { nowIso: string; updatedBy: string; origin: string }
): CustomerConsent {
  const history = [...(prev?.history || [])];
  const result: CustomerConsent = {
    whatsappMarketing: next.whatsappMarketing,
    emailMarketing: next.emailMarketing,
    smsMarketing: next.smsMarketing,
    origin: prev?.origin || ctx.origin,
    purpose: next.purpose,
    lastUpdated: prev?.lastUpdated,
    history
  };

  let changed = (prev?.purpose ?? next.purpose) !== next.purpose;
  for (const { channel, flag, date } of CHANNELS) {
    const before = prev?.[flag] === true;
    const after = next[flag] === true;
    if (before === after) {
      if (prev?.[date]) result[date] = prev[date];
      continue;
    }
    changed = true;
    if (after) result[date] = ctx.nowIso;
    history.push({ type: channel, status: after, date: ctx.nowIso, origin: ctx.origin, updatedBy: ctx.updatedBy });
  }
  if (changed || !prev) result.lastUpdated = ctx.nowIso;
  if (!result.lastUpdated) delete result.lastUpdated;
  return result;
}

const normalize = (v: string | undefined) => {
  const s = String(v ?? '').trim();
  return s ? s : undefined;
};

/**
 * Monta a alteração de um cadastro existente a partir do formulário.
 * - patch: só os campos do formulário que mudaram (+ consentimento e updatedAt)
 * - clearFields: campos que o operador esvaziou e devem ser apagados no Firestore
 * Campos fora do formulário nunca entram no patch, então não são tocados.
 */
export function buildCustomerEditPatch(
  existing: Customer,
  values: CustomerFormValues,
  ctx: { nowIso: string; updatedBy: string }
): { patch: Partial<Customer>; clearFields: string[] } {
  const patch: Record<string, any> = {};
  const clearFields: string[] = [];
  const current = existing as unknown as Record<string, any>;

  let locationChanged = false;
  for (const field of FORM_OWNED_FIELDS) {
    const value = normalize(values[field]);
    const before = current[field] === undefined || current[field] === null ? undefined : String(current[field]);
    if (value === before) continue;
    if (value === undefined) {
      if (REQUIRED_FIELDS.includes(field)) continue; // nunca apaga campo obrigatório
      if (before !== undefined) clearFields.push(field);
    } else {
      patch[field] = value;
    }
    if (LOCATION_FIELDS.includes(field)) locationChanged = true;
  }

  // Endereço mudou: a coordenada antiga deixa de valer e o cliente volta para a fila do mapa.
  if (locationChanged) {
    for (const f of ['latitude', 'longitude', 'geocodeError']) {
      if (current[f] !== undefined && current[f] !== null) clearFields.push(f);
    }
    patch.geocodeStatus = 'pending';
  }

  const consent = buildConsentUpdate(existing.consent, values.consent, {
    nowIso: ctx.nowIso,
    updatedBy: ctx.updatedBy,
    origin: existing.consent?.origin || 'Formulário de Cadastro CRM'
  });
  // O consentimento vai sempre inteiro (substitui o mapa), mas datas e histórico só mudam se um canal mudou.
  patch.consent = consent;
  patch.updatedAt = ctx.nowIso;
  return { patch: patch as Partial<Customer>, clearFields };
}
