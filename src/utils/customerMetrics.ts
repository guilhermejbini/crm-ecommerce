import { Customer } from '../types/crm';
import { cleanCpfDigits } from './cpfValidator';

/**
 * Cliente com documento real (CPF/CNPJ). Não conta "Não informado", vazio
 * nem o CPF mascarado de clientes anonimizados (LGPD).
 */
export function hasIdentifiedDocument(c: Pick<Customer, 'cpf' | 'isAnonymized'>): boolean {
  if (c.isAnonymized) return false;
  const raw = String(c.cpf ?? '');
  if (!raw.trim() || raw.includes('*')) return false;
  const digits = cleanCpfDigits(raw);
  return digits.length === 11 || digits.length === 14;
}

/**
 * Cliente ativo = tem última compra conhecida dentro do período.
 * Cliente recém-cadastrado sem compra (dias = 0 por padrão) ou com -1 (sem compra válida) não é ativo.
 */
export function isActiveCustomer(
  c: Pick<Customer, 'daysSinceLastPurchase' | 'lastPurchaseDate'>,
  maxDays = 30
): boolean {
  const days = c.daysSinceLastPurchase;
  if (!c.lastPurchaseDate) return false;
  return typeof days === 'number' && days >= 0 && days <= maxDays;
}
