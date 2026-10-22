/**
 * Validador Centralizado e Rigoroso de CPF para o CRM Super Astral
 * Regras:
 * 1. Remove qualquer máscara/formatação
 * 2. Exige exatamente 11 dígitos numéricos
 * 3. Rejeita sequências repetidas (00000000000, 11111111111, ..., 99999999999)
 * 4. Valida primeiro dígito verificador (DV1, módulo 11)
 * 5. Valida segundo dígito verificador (DV2, módulo 11)
 * 6. Preserva zeros à esquerda mantendo sempre o tipo STRING
 */

export function cleanCpfDigits(val: any): string {
  if (val === null || val === undefined) return '';
  return String(val).replace(/\D/g, '');
}

/**
 * Validação matemática oficial de CPF brasileiro (Receita Federal)
 */
export function isValidCpf(val: any): boolean {
  if (val === null || val === undefined) return false;

  let digits = cleanCpfDigits(val);

  // Exige exatamente 11 dígitos
  if (digits.length !== 11) {
    return false;
  }

  // Rejeita sequências repetidas conhecidas (00000000000, 11111111111, ..., 99999999999)
  if (/^(\d)\1{10}$/.test(digits)) {
    return false;
  }

  // Validação do Primeiro Dígito Verificador (DV1)
  let sum1 = 0;
  for (let i = 0; i < 9; i++) {
    sum1 += parseInt(digits.charAt(i), 10) * (10 - i);
  }
  let rest1 = 11 - (sum1 % 11);
  if (rest1 >= 10) rest1 = 0;
  if (rest1 !== parseInt(digits.charAt(9), 10)) {
    return false;
  }

  // Validação do Segundo Dígito Verificador (DV2)
  let sum2 = 0;
  for (let i = 0; i < 10; i++) {
    sum2 += parseInt(digits.charAt(i), 10) * (11 - i);
  }
  let rest2 = 11 - (sum2 % 11);
  if (rest2 >= 10) rest2 = 0;
  if (rest2 !== parseInt(digits.charAt(10), 10)) {
    return false;
  }

  return true;
}

/**
 * Formata CPF válido para XXX.XXX.XXX-XX preservando zeros à esquerda como STRING
 */
export function formatCpf(val: any): string {
  const digits = cleanCpfDigits(val);
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
  }
  return String(val ?? '').trim();
}
