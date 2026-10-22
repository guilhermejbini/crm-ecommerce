import { describe, it, expect, vi } from 'vitest';
import { createFirestoreMock } from './firestoreMock';

vi.mock('firebase/firestore', () => createFirestoreMock(new Map()));
vi.mock('../src/services/firebase', () => ({ db: {}, auth: {}, default: {} }));

import {
  isCustomerEligibleForWhatsAppCampaign,
  isCustomerEligibleForCampaign,
  isValidWhatsAppNumber
} from '../src/services/firestoreService';

const base = (overrides: any = {}) => ({
  id: 'cust-test',
  name: 'Cliente Teste',
  cpf: '',
  whatsapp: '(41) 98765-4321',
  isAnonymized: false,
  rfmSegment: 'LEAIS',
  consent: { whatsappMarketing: true, emailMarketing: false, smsMarketing: false },
  ...overrides
}) as any;

describe('elegibilidade WhatsApp', () => {
  it('número válido + consentimento true -> elegível', () => {
    expect(isCustomerEligibleForWhatsAppCampaign(base())).toBe(true);
  });

  it('número válido + consentimento false -> não elegível', () => {
    expect(isCustomerEligibleForWhatsAppCampaign(base({ consent: { whatsappMarketing: false } }))).toBe(false);
  });

  it('consentimento ausente -> não elegível', () => {
    expect(isCustomerEligibleForWhatsAppCampaign(base({ consent: undefined }))).toBe(false);
    expect(isCustomerEligibleForWhatsAppCampaign(base({ consent: {} }))).toBe(false);
  });

  it('consentimento "truthy" que não é exatamente true -> não elegível', () => {
    expect(isCustomerEligibleForWhatsAppCampaign(base({ consent: { whatsappMarketing: 'true' } }))).toBe(false);
    expect(isCustomerEligibleForWhatsAppCampaign(base({ consent: { whatsappMarketing: 1 } }))).toBe(false);
  });

  it('sem número + consentimento true -> não elegível', () => {
    expect(isCustomerEligibleForWhatsAppCampaign(base({ whatsapp: '' }))).toBe(false);
    expect(isCustomerEligibleForWhatsAppCampaign(base({ whatsapp: undefined }))).toBe(false);
    expect(isCustomerEligibleForWhatsAppCampaign(base({ whatsapp: '-' }))).toBe(false);
  });

  it('formato do número decide a elegibilidade (consentimento true)', () => {
    expect(isCustomerEligibleForWhatsAppCampaign(base({ whatsapp: '(41) 99999-9999' }))).toBe(true); // formato válido
    expect(isCustomerEligibleForWhatsAppCampaign(base({ whatsapp: '99999999999' }))).toBe(false);   // dígitos repetidos
    expect(isCustomerEligibleForWhatsAppCampaign(base({ whatsapp: '123' }))).toBe(false);
    expect(isCustomerEligibleForWhatsAppCampaign(base({ whatsapp: '(41) 88765-4321' }))).toBe(false); // celular sem 9
  });

  it('cliente anonimizado -> não elegível', () => {
    expect(isCustomerEligibleForWhatsAppCampaign(base({ isAnonymized: true }))).toBe(false);
    expect(isCustomerEligibleForCampaign(base({ isAnonymized: true }), 'WhatsApp' as any, false, 'all')).toBe(false);
  });

  it('cliente nulo -> não elegível', () => {
    expect(isCustomerEligibleForWhatsAppCampaign(null)).toBe(false);
    expect(isCustomerEligibleForWhatsAppCampaign(undefined)).toBe(false);
  });

  it('campanha WhatsApp exige consentimento mesmo com onlyOptIn=false', () => {
    expect(isCustomerEligibleForCampaign(base({ consent: { whatsappMarketing: false } }), 'WhatsApp' as any, false, 'all')).toBe(false);
    expect(isCustomerEligibleForCampaign(base(), 'WhatsApp' as any, false, 'all')).toBe(true);
  });

  it('isValidWhatsAppNumber aceita DDI 55 e fixo com 10 dígitos', () => {
    expect(isValidWhatsAppNumber('+55 41 98765-4321')).toBe(true);
    expect(isValidWhatsAppNumber('4136571234')).toBe(true);
    expect(isValidWhatsAppNumber('0036571234')).toBe(false);
  });
});
