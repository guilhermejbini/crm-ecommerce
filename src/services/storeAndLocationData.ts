import { Store } from '../types/crm';

/**
 * Identificação física das lojas (fonte única de verdade no front).
 *
 *   store-01 / LJ01 — Loja 01 — Astral Rodovia dos Minérios (matriz) — Travessa Paulo Bini, 250
 *   store-02 / LJ02 — Loja 02 — Astral Centro               — Avenida Emílio Johnson, 675
 *   store-03 / LJ03 — Loja 03 — Astral Bertolina            — Rua Bertolina Kendrick de Oliveira
 *
 * Até 29/09/2026 o CRM tinha store-01 = Emílio Johnson e store-02 = Paulo Bini (invertido).
 * Registros antigos são corrigidos por scripts/fix-store-ids.mjs.
 */
export const REAL_SUPER_ASTRAL_STORES: Store[] = [
  {
    id: 'store-01',
    code: 'LJ01',
    name: 'Astral Rodovia dos Minérios',
    address: 'Travessa Paulo Bini, 250',
    neighborhood: 'Vila Rachel',
    city: 'Almirante Tamandaré',
    state: 'PR',
    cep: '83501-630',
    totalPos: 8,
    posCount: 8,
    phone: '(41) 3797-8058',
    managerName: 'Mariana Guimarães',
    latitude: -25.3163582,
    longitude: -49.3008606
  },
  {
    id: 'store-02',
    code: 'LJ02',
    name: 'Astral Centro',
    address: 'Avenida Emílio Johnson, 675',
    neighborhood: 'Centro',
    city: 'Almirante Tamandaré',
    state: 'PR',
    cep: '83501-000',
    totalPos: 12,
    posCount: 12,
    phone: '(41) 3798-1756',
    managerName: 'Carlos Eduardo Silveira',
    latitude: -25.3115083,
    longitude: -49.298475
  },
  {
    id: 'store-03',
    code: 'LJ03',
    name: 'Astral Bertolina',
    address: 'Rua Bertolina Kendrick de Oliveira',
    neighborhood: 'Jardim São Domingos',
    city: 'Almirante Tamandaré',
    state: 'PR',
    cep: '83501-150',
    totalPos: 10,
    posCount: 10,
    phone: '(41) 3798-1756',
    managerName: 'Roberto Albuquerque',
    latitude: -25.3111413,
    longitude: -49.2945731
  }
];

export const SUPER_ASTRAL_STORES: Store[] = REAL_SUPER_ASTRAL_STORES;
export const DEMO_STORES: Store[] = REAL_SUPER_ASTRAL_STORES;

/**
 * Códigos só numéricos ("Loja 01", "LJ01") vindos de arquivos do RP Flex/PDV.
 * A numeração 01/02/03 acima é a informada pela gerência, mas ainda NÃO foi conferida contra
 * um arquivo do RP Flex que traga código e endereço juntos. Enquanto for false, um arquivo que
 * só informa o número da loja exige que o operador escolha a unidade na importação
 * (nada é atribuído por suposição). Depois de conferir, mude para true.
 */
export const RP_FLEX_NUMERIC_STORE_CODES_CONFIRMED = false;

/**
 * Códigos que o formulário do site (Quero ser Clube) envia para a função registerWebsiteCustomer,
 * na mesma ordem das lojas exibidas no site. Atenção: o código "paulo-bini" é a LOJA 02 (Astral Centro);
 * a loja da Travessa Paulo Bini é a matriz (Loja 01). Esses códigos não passam pelo resolveStoreId:
 * a função grava favoriteStoreId/favoriteStoreName já resolvidos.
 */
export const SITE_FORM_STORE_CODES: Record<string, string> = {
  matriz: 'store-01',
  'paulo-bini': 'store-02',
  bertolina: 'store-03'
};

interface StoreIdentity {
  id: string;
  /** Nome gravado em compras/uso de ofertas (storeName) */
  label: string;
  /** Indícios físicos inequívocos: rua, número, nome comercial, slug do site */
  physical: RegExp[];
  /** Códigos numéricos do RP Flex/PDV (só usados se RP_FLEX_NUMERIC_STORE_CODES_CONFIRMED) */
  numeric: RegExp[];
}

// Os padrões são aplicados sobre texto minúsculo e sem acentos.
export const STORE_IDENTITIES: StoreIdentity[] = [
  {
    id: 'store-01',
    label: 'Astral Rodovia dos Minérios - Travessa Paulo Bini, 250',
    physical: [/paulo\s*bini/, /\bminerios\b/, /\b250\b/, /\bmatriz\b/],
    numeric: [/\bloja\s*0?1\b/, /\blj\s*0?1\b/]
  },
  {
    id: 'store-02',
    label: 'Astral Centro - Avenida Emílio Johnson, 675',
    physical: [/\bemilio\b/, /\b675\b/, /\bastral\s*centro\b/],
    numeric: [/\bloja\s*0?2\b/, /\blj\s*0?2\b/]
  },
  {
    id: 'store-03',
    label: 'Astral Bertolina - Rua Bertolina Kendrick de Oliveira, 1025',
    physical: [/bertolina|kendrick/, /\b1025\b/],
    numeric: [/\bloja\s*0?3\b/, /\blj\s*0?3\b/]
  }
];

function normalizeStoreText(val: unknown): string {
  return String(val ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

function uniqueMatch(text: string, pick: (s: StoreIdentity) => RegExp[]): StoreIdentity | null | 'ambiguous' {
  const hits = STORE_IDENTITIES.filter(s => pick(s).some(re => re.test(text)));
  if (hits.length === 1) return hits[0];
  return hits.length > 1 ? 'ambiguous' : null;
}

/**
 * Identifica a loja física a partir de um texto livre (coluna de loja do PDV, slug do site,
 * nome gravado em um registro). Retorna null quando não há correspondência confiável
 * ou quando o texto aponta para mais de uma loja.
 */
export function resolveStoreId(
  val: unknown,
  options: { allowNumericCodes?: boolean } = {}
): string | null {
  const text = normalizeStoreText(val);
  if (!text) return null;

  // 1. Endereço / nome comercial (inequívoco)
  const physical = uniqueMatch(text, s => s.physical);
  if (physical === 'ambiguous') return null;
  if (physical) return physical.id;

  // 2. ID interno do CRM (store-01 ...)
  const internal = text.match(/\bstore-?0?(\d)\b/);
  if (internal) {
    const id = `store-0${internal[1]}`;
    if (STORE_IDENTITIES.some(s => s.id === id)) return id;
  }

  // 3. Código numérico do RP Flex (somente após conferência)
  const allowNumeric = options.allowNumericCodes ?? RP_FLEX_NUMERIC_STORE_CODES_CONFIRMED;
  if (allowNumeric) {
    const numeric = uniqueMatch(text, s => s.numeric);
    if (numeric && numeric !== 'ambiguous') return numeric.id;
  }
  return null;
}

export function getStoreLabel(storeId: string): string | undefined {
  return STORE_IDENTITIES.find(s => s.id === storeId)?.label;
}

/**
 * Loja de um registro já gravado (cliente, compra, uso de oferta).
 * O nome gravado (endereço) tem prioridade sobre o ID, porque registros anteriores à
 * correção de 29/09/2026 guardam o ID invertido mas o nome da loja física correta.
 * Códigos numéricos em nomes gravados não são usados (não são confiáveis).
 */
export function getRecordStoreId(storeId?: string | null, storeName?: string | null): string | null {
  const byName = resolveStoreId(storeName, { allowNumericCodes: false });
  if (byName) return byName;
  return storeId || null;
}

export function recordBelongsToStore(
  selectedStoreId: string,
  storeId?: string | null,
  storeName?: string | null
): boolean {
  if (!selectedStoreId || selectedStoreId === 'all') return true;
  return getRecordStoreId(storeId, storeName) === selectedStoreId;
}

/**
 * Alinha o cadastro de lojas lido do Firestore com a identidade física (somente em memória, não grava).
 * Antes da migração, o documento stores/store-01 ainda descreve a Emílio Johnson e stores/store-02 a
 * Paulo Bini; aqui cada documento passa a ser exibido sob o ID/código/nome da sua loja física.
 * Só reordena quando o resultado continua com IDs únicos; caso contrário devolve como veio.
 */
export function alignStoresWithPhysicalIdentity(stores: Store[]): Store[] {
  const aligned = stores.map(st => {
    const physicalId = resolveStoreId(`${st.name || ''} ${st.address || ''}`, { allowNumericCodes: false });
    const ref = physicalId ? REAL_SUPER_ASTRAL_STORES.find(r => r.id === physicalId) : undefined;
    if (!ref) return st;
    // Mesmo documento: só o nome/código comercial atual (endereço e demais dados do cadastro mantidos)
    if (physicalId === st.id) {
      return st.name === ref.name && st.code === ref.code ? st : { ...st, code: ref.code, name: ref.name };
    }
    return { ...st, id: ref.id, code: ref.code, name: ref.name, address: ref.address };
  });
  const ids = aligned.map(s => s.id);
  if (new Set(ids).size !== ids.length) return stores;
  return aligned.sort((a, b) => a.id.localeCompare(b.id));
}

/** Coordenadas da loja (do cadastro ou, na falta, da definição física acima). */
export function getStoreCoords(store: Pick<Store, 'id' | 'code' | 'latitude' | 'longitude'>): [number, number] {
  if (typeof store.latitude === 'number' && typeof store.longitude === 'number') {
    return [store.latitude, store.longitude];
  }
  const ref = REAL_SUPER_ASTRAL_STORES.find(s => s.id === store.id || s.code === store.code)
    || REAL_SUPER_ASTRAL_STORES[0];
  return [ref.latitude!, ref.longitude!];
}

export const NEIGHBORHOOD_COORDS: Record<string, { lat: number; lng: number }> = {
  'Centro': { lat: -25.311508, lng: -49.298475 },
  'Vila Rachel': { lat: -25.316358, lng: -49.300861 },
  'Jardim São Domingos': { lat: -25.311141, lng: -49.294573 },
  'Vila Santa Terezinha': { lat: -25.309500, lng: -49.299200 },
  'Jardim Graziele': { lat: -25.314800, lng: -49.288500 },
  'Prado': { lat: -25.319500, lng: -49.295200 },
  'Lamenha Grande': { lat: -25.334000, lng: -49.305000 },
  'Tanguá': { lat: -25.328000, lng: -49.289000 },
  'São Jorge': { lat: -25.304500, lng: -49.292500 },
  'Cachoeira': { lat: -25.325000, lng: -49.282000 }
};
