import { describe, it, expect } from 'vitest';
import { isValidCpf, formatCpf, cleanCpfDigits } from '../src/utils/cpfValidator';

// CPFs sintéticos (gerados só para teste, não pertencem a clientes reais)
const VALID = '52998224725';
const VALID_LEADING_ZERO = '01234567890';

describe('cpfValidator', () => {
  it('aceita CPF válido sem máscara', () => {
    expect(isValidCpf(VALID)).toBe(true);
    expect(isValidCpf('11144477735')).toBe(true);
  });

  it('aceita CPF válido com máscara', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
  });

  it('rejeita CPF com dígito verificador incorreto', () => {
    expect(isValidCpf('52998224724')).toBe(false); // DV2 errado
    expect(isValidCpf('52998224715')).toBe(false); // DV1 errado
  });

  it('rejeita CPF com quantidade errada de dígitos', () => {
    expect(isValidCpf('5299822472')).toBe(false);
    expect(isValidCpf('529982247250')).toBe(false);
  });

  it('rejeita sequências repetidas', () => {
    for (let d = 0; d <= 9; d++) {
      expect(isValidCpf(String(d).repeat(11))).toBe(false);
    }
  });

  it('preserva zero à esquerda como string', () => {
    expect(isValidCpf(VALID_LEADING_ZERO)).toBe(true);
    expect(formatCpf(VALID_LEADING_ZERO)).toBe('012.345.678-90');
    expect(cleanCpfDigits('012.345.678-90')).toBe('01234567890');
  });

  it('não completa zeros à esquerda sozinho (exige 11 dígitos)', () => {
    expect(isValidCpf('1234567890')).toBe(false);
  });

  it('formata CPF e remove máscara', () => {
    expect(formatCpf(VALID)).toBe('529.982.247-25');
    expect(formatCpf('529.982.247-25')).toBe('529.982.247-25');
    expect(cleanCpfDigits(' 529.982.247-25 ')).toBe(VALID);
  });

  it('trata entrada vazia/nula', () => {
    expect(isValidCpf('')).toBe(false);
    expect(isValidCpf(null)).toBe(false);
    expect(isValidCpf(undefined)).toBe(false);
    expect(cleanCpfDigits(null)).toBe('');
    expect(cleanCpfDigits(undefined)).toBe('');
    expect(formatCpf('')).toBe('');
    expect(formatCpf(null)).toBe('');
  });

  it('formatCpf devolve o texto original quando não há 11 dígitos', () => {
    expect(formatCpf(' 123 ')).toBe('123');
  });
});
