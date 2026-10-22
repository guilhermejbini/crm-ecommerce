/**
 * Validador Centralizado de CNPJ para o CRM Super Astral
 * Regras:
 * 1. Remove qualquer máscara/formatação
 * 2. Exige exatamente 14 dígitos numéricos
 * 3. Rejeita sequências repetidas (00000000000000, 11111111111111, ...)
 * 4. Valida os dois dígitos verificadores (módulo 11)
 * 5. Mantém o CNPJ sempre como STRING (zeros à esquerda preservados)
 */

export function cleanCnpjDigits(val: any): string {
  if (val === null || val === undefined) return '';
  return String(val).replace(/\D/g, '');
}

function cnpjCheckDigit(base: string): number {
  const weights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2].slice(13 - base.length);
  let sum = 0;
  for (let i = 0; i < base.length; i++) {
    sum += parseInt(base.charAt(i), 10) * weights[i];
  }
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCnpj(val: any): boolean {
  const digits = cleanCnpjDigits(val);
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false;
  if (cnpjCheckDigit(digits.slice(0, 12)) !== parseInt(digits.charAt(12), 10)) return false;
  if (cnpjCheckDigit(digits.slice(0, 13)) !== parseInt(digits.charAt(13), 10)) return false;
  return true;
}

/**
 * Formata CNPJ com 14 dígitos para XX.XXX.XXX/XXXX-XX (não valida; use isValidCnpj antes)
 */
export function formatCnpj(val: any): string {
  const digits = cleanCnpjDigits(val);
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12, 14)}`;
  }
  return String(val ?? '').trim();
}
