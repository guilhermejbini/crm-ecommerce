import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToString } from 'react-dom/server';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), doc: vi.fn(), getDoc: vi.fn(), getDocs: vi.fn(), limit: vi.fn(),
  orderBy: vi.fn(), query: vi.fn(), setDoc: vi.fn(), where: vi.fn()
}));
vi.mock('../src/services/firebase', () => ({ db: {}, auth: {}, default: {} }));
vi.mock('../src/services/api', () => ({ apiFetch: vi.fn() }));
vi.mock('../src/context/CRMContext', () => ({
  useCRM: () => ({ currentUser: { role: 'admin', email: 'a@b.c' }, showToast: vi.fn(), openCustomer360: vi.fn() })
}));

import { SatisfactionSurveyView } from '../src/components/Satisfaction/SatisfactionSurveyView';

describe('tela da pesquisa de satisfação', () => {
  it('abre sem erro e mostra a mensagem e as regras', () => {
    const html = renderToString(<SatisfactionSurveyView />);
    expect(html).toContain('Pesquisa de satisfação');
    expect(html).toContain('Super Astral Centro');
    expect(html).toContain('Compras acima de (R$)');
    expect(html).toContain('Rodar agora');
  });
});
