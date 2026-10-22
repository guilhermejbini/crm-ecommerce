import { Coupon } from '../types/crm';

export function normalizeCouponCode(code: string | null | undefined): string {
  return String(code ?? '').trim().toUpperCase();
}

/** Cupom ativo e dentro da validade (validade vale até o fim do dia). Mesma regra da tela de Cupons. */
export function isCouponUsable(c: Coupon, now: Date = new Date()): boolean {
  const active = c.isActive === true || (c.isActive === undefined && c.status === 'Ativo');
  if (!active) return false;
  if (!c.validUntil) return true;
  const end = new Date(String(c.validUntil).split('T')[0] + 'T23:59:59');
  return isNaN(end.getTime()) || end >= now;
}

/** Cupom cadastrado, ativo e válido com este código; null se não existir. */
export function findUsableCoupon(code: string | null | undefined, coupons: Coupon[] = [], now: Date = new Date()): Coupon | null {
  const wanted = normalizeCouponCode(code);
  if (!wanted) return null;
  return coupons.find(c => normalizeCouponCode(c.code) === wanted && isCouponUsable(c, now)) || null;
}

/** Já existe cupom com este código (qualquer status), exceto o próprio. */
export function isCouponCodeTaken(code: string, coupons: Coupon[] = [], ownId?: string): boolean {
  const wanted = normalizeCouponCode(code);
  return !!wanted && coupons.some(c => c.id !== ownId && normalizeCouponCode(c.code) === wanted);
}
