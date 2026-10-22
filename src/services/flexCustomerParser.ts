import * as XLSX from 'xlsx';
import { Customer, RFMSegmentType } from '../types/crm';
import { NEIGHBORHOOD_COORDS } from './storeAndLocationData';
import { isValidCpf, formatCpf, cleanCpfDigits } from '../utils/cpfValidator';
import { isValidCnpj, formatCnpj } from '../utils/cnpjValidator';
import { parseDate } from './pdvParser';

export interface FlexImportError {
  rowNumber: number;
  clientName?: string;
  cpfRaw?: string;
  reason: string;
}

export interface ParseFlexResult {
  sheetName: string;
  availableSheets: string[];
  headerRowNumber: number; // 1-based (e.g. 13)
  dataStartRowNumber: number; // 1-based (e.g. 14)
  totalRawRows: number;
  totalDataRows: number;
  identifiedColumns: string[];
  mappedFieldSummary: Record<string, string>;
  previewCustomers: Customer[];
  extractAllCustomers: (existingCustomers?: Customer[], onProgress?: (pct: number) => void) => Promise<{
    customers: Customer[];
    updatedCustomers: Customer[];
    duplicateCount: number;
    errors: FlexImportError[];
  }>;
}

export function normalizeHeaderString(str: any): string {
  if (str === null || str === undefined) return '';
  return String(str)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normaliza CPF ou CNPJ preservando zeros à esquerda e tratando números científicos do Excel
 */
export function normalizeDocument(rawVal: any): {
  digits: string;
  formatted: string;
  type: 'CPF' | 'CNPJ' | 'INVALIDO';
} {
  if (rawVal === null || rawVal === undefined || rawVal === '') {
    return { digits: '', formatted: '', type: 'INVALIDO' };
  }

  let strVal = String(rawVal).trim();

  // Tratamento específico se for número puro ou notação científica do Excel (ex: 6.78299293e+09)
  if (typeof rawVal === 'number') {
    try {
      strVal = BigInt(Math.round(rawVal)).toString();
    } catch {
      strVal = String(rawVal);
    }
  } else if (/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(strVal)) {
    try {
      const num = Number(strVal);
      if (!isNaN(num)) {
        strVal = BigInt(Math.round(num)).toString();
      }
    } catch {
      // mantém strVal original
    }
  }

  let digits = strVal.replace(/\D/g, '');

  if (!digits) {
    return { digits: '', formatted: strVal, type: 'INVALIDO' };
  }

  // Validação estrita de CPF com verificação matemática de dígitos (DV1 e DV2) e rejeição de repetidos
  if (digits.length <= 11 && digits.length >= 9) {
    const candidate = digits.padStart(11, '0');
    if (isValidCpf(candidate)) {
      return { digits: candidate, formatted: formatCpf(candidate), type: 'CPF' };
    }
  }

  // Se tem entre 12 e 14 dígitos, verificação de CNPJ
  if (digits.length <= 14 && digits.length >= 12) {
    const candidateCnpj = digits.padStart(14, '0');
    // Validação matemática central (DVs e sequências repetidas)
    if (isValidCnpj(candidateCnpj)) {
      return { digits: candidateCnpj, formatted: formatCnpj(candidateCnpj), type: 'CNPJ' };
    }
  }

  return { digits, formatted: strVal, type: 'INVALIDO' };
}

/**
 * Normaliza telefone ou celular sem nunca inventar números fictícios
 */
export function normalizePhone(rawVal: any): string {
  if (!rawVal) return '';
  const str = String(rawVal).trim();
  const digits = str.replace(/\D/g, '');
  if (!digits) return '';

  // 11 dígitos: (41) 98765-4321
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7, 11)}`;
  }
  // 10 dígitos: (41) 3657-1234
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6, 10)}`;
  }
  // 9 dígitos sem DDD (assume 41 Almirante Tamandaré / Região de Curitiba)
  if (digits.length === 9) {
    return `(41) ${digits.slice(0, 5)}-${digits.slice(5, 9)}`;
  }
  // 8 dígitos sem DDD
  if (digits.length === 8) {
    return `(41) ${digits.slice(0, 4)}-${digits.slice(4, 8)}`;
  }

  return str;
}

/**
 * Normaliza data de nascimento (número serial do Excel ou strings de data)
 */
export function normalizeDate(rawVal: any): string {
  if (!rawVal) return '';

  if (typeof rawVal === 'number') {
    try {
      const parsed = XLSX.SSF.parse_date_code(rawVal);
      if (parsed) {
        const y = String(parsed.y).padStart(4, '0');
        const m = String(parsed.m).padStart(2, '0');
        const d = String(parsed.d).padStart(2, '0');
        return `${y}-${m}-${d}`;
      }
    } catch {
      // ignore
    }
  }

  const str = String(rawVal).trim();
  // Se for ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    return str.slice(0, 10);
  }

  // Se for DD/MM/YYYY ou DD-MM-YYYY
  const brMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (brMatch) {
    const d = brMatch[1].padStart(2, '0');
    const m = brMatch[2].padStart(2, '0');
    const y = brMatch[3];
    return `${y}-${m}-${d}`;
  }

  return '';
}

/**
 * Normaliza CEP com 8 dígitos
 */
export function normalizeCEP(rawVal: any): string {
  if (!rawVal) return '';
  const digits = String(rawVal).replace(/\D/g, '');
  if (digits.length === 8) {
    return `${digits.slice(0, 5)}-${digits.slice(5, 8)}`;
  }
  if (digits.length === 7) {
    const padded = digits.padStart(8, '0');
    return `${padded.slice(0, 5)}-${padded.slice(5, 8)}`;
  }
  return String(rawVal).trim();
}

/**
 * Resolução ultra-rápida de índice de coluna com correspondência exata prioritária
 */
function resolveColumnIndex(colMap: Map<string, number>, candidateNames: string[]): number {
  // 1. Prioridade: correspondência exata
  for (const candidate of candidateNames) {
    const norm = normalizeHeaderString(candidate);
    if (colMap.has(norm)) {
      return colMap.get(norm)!;
    }
  }
  // 2. Correspondência por sub-string
  for (const candidate of candidateNames) {
    const norm = normalizeHeaderString(candidate);
    for (const [colName, idx] of colMap.entries()) {
      if (colName.includes(norm) || norm.includes(colName)) {
        return idx;
      }
    }
  }
  return -1;
}

/**
 * Analisa e processa o arquivo Excel exportado do sistema Flex / RP One
 */
export function parseFlexExcelFile(
  fileData: ArrayBuffer | Uint8Array,
  preferredSheetName?: string
): ParseFlexResult {
  const workbook = XLSX.read(fileData, { 
    type: 'array', 
    dense: true, 
    cellDates: false,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    raw: true
  });
  const availableSheets = workbook.SheetNames || [];

  if (availableSheets.length === 0) {
    throw new Error('O arquivo Excel não contém nenhuma planilha.');
  }

  // 1. Identificar a aba com dados (prioridade para 'Plan1')
  let selectedSheet = preferredSheetName;
  if (!selectedSheet || !workbook.Sheets[selectedSheet]) {
    const plan1 = availableSheets.find(s => normalizeHeaderString(s) === 'plan1');
    selectedSheet = plan1 || availableSheets[0];
  }

  const worksheet = workbook.Sheets[selectedSheet];
  if (!worksheet) {
    throw new Error(`A aba "${selectedSheet}" não pôde ser lida.`);
  }

  // 2. Ler todas as linhas brutas da planilha como matriz de valores
  const rawRows = XLSX.utils.sheet_to_json<any[]>(worksheet, {
    header: 1,
    defval: '',
    blankrows: false
  });

  if (rawRows.length === 0) {
    throw new Error(`A aba "${selectedSheet}" está completamente vazia.`);
  }

  // 3. Localizar dinamicamente a linha do cabeçalho verdadeiro (ex: Linha 13 da exportação RP One/Flex)
  let headerRowIndex = -1;
  let identifiedColumns: string[] = [];

  for (let i = 0; i < Math.min(rawRows.length, 60); i++) {
    const row = rawRows[i];
    if (!Array.isArray(row) || row.length === 0) continue;

    const normalizedRow = row.map(cell => normalizeHeaderString(cell));

    const hasClientName = normalizedRow.some(cell =>
      cell.includes('nome do cliente') || cell === 'nome cliente' || cell === 'nome'
    );
    const hasCpfCnpj = normalizedRow.some(cell =>
      cell.includes('cnpj cpf') || cell.includes('cpf cnpj') || cell === 'cpf' || cell === 'cnpj' || cell.includes('cnpj')
    );

    if (hasClientName && hasCpfCnpj) {
      headerRowIndex = i;
      identifiedColumns = row.map(cell => String(cell ?? '').trim());
      break;
    }
  }

  // Fallback caso não encontre ambos na mesma linha (busca por nome do cliente)
  if (headerRowIndex === -1) {
    for (let i = 0; i < Math.min(rawRows.length, 60); i++) {
      const row = rawRows[i];
      if (!Array.isArray(row) || row.length === 0) continue;
      const normalizedRow = row.map(cell => normalizeHeaderString(cell));
      if (normalizedRow.some(cell => cell.includes('nome do cliente') || cell === 'nome cliente')) {
        headerRowIndex = i;
        identifiedColumns = row.map(cell => String(cell ?? '').trim());
        break;
      }
    }
  }

  if (headerRowIndex === -1) {
    throw new Error(
      'Não foi possível identificar o cabeçalho com os campos "Nome Do Cliente" e "CNPJ / CPF" nas primeiras 60 linhas da planilha.'
    );
  }

  // Criar mapa normalizado de colunas
  const colMap = new Map<string, number>();
  identifiedColumns.forEach((col, idx) => {
    const norm = normalizeHeaderString(col);
    if (norm) {
      colMap.set(norm, idx);
    }
  });

  // Resolução prévia de índices (O(1) no loop de milhares de linhas para alta performance)
  const colIndices = {
    name: resolveColumnIndex(colMap, ['nome do cliente', 'nome cliente', 'nome']),
    code: resolveColumnIndex(colMap, ['codigo', 'cod cliente', 'codigo cliente']),
    document: resolveColumnIndex(colMap, ['cnpj cpf', 'cpf cnpj', 'cnpj / cpf', 'cpf', 'cnpj', 'cpf nota']),
    personType: resolveColumnIndex(colMap, ['f j', 'tipo pessoa', 'fj', 'fisica juridica']),
    phone: resolveColumnIndex(colMap, ['fone residencial', 'telefone residencial', 'telefone', 'fone', 'tel resid']),
    celular: resolveColumnIndex(colMap, ['fone celular', 'celular', 'whatsapp', 'tel celular', 'cel']),
    email: resolveColumnIndex(colMap, ['e mail', 'email', 'correio eletronico']),
    birthDate: resolveColumnIndex(colMap, ['data de nascimento', 'data nascimento', 'nascimento', 'dt nascimento']),
    address: resolveColumnIndex(colMap, ['endereco residencial', 'endereco', 'logradouro', 'rua']),
    number: resolveColumnIndex(colMap, ['numero end resid', 'numero residencial', 'numero', 'num']),
    complement: resolveColumnIndex(colMap, ['complemento end resid', 'complemento residencial', 'complemento']),
    neighborhood: resolveColumnIndex(colMap, ['bairro end resid', 'bairro residencial', 'bairro']),
    city: resolveColumnIndex(colMap, ['municipioresid', 'municipio residencial', 'cidade', 'municipio']),
    state: resolveColumnIndex(colMap, ['ufresid', 'uf resid', 'uf', 'estado']),
    cep: resolveColumnIndex(colMap, ['cep resid', 'cep residencial', 'cep']),
    cardName: resolveColumnIndex(colMap, ['nome cartao', 'nome no cartao', 'cartao']),
    companyName: resolveColumnIndex(colMap, ['razao social', 'razao']),
    rgIe: resolveColumnIndex(colMap, ['rg inscricao estadual', 'rg ie', 'rg', 'inscricao estadual', 'ie']),
    gender: resolveColumnIndex(colMap, ['sexo', 'genero']),
    regDate: resolveColumnIndex(colMap, ['data cadastro', 'dt cadastro', 'cadastro']),
    optInWhatsapp: resolveColumnIndex(colMap, ['whatsapp marketing', 'opt in whatsapp', 'autoriza whatsapp', 'autorizacao whatsapp', 'consentimento whatsapp', 'optin whatsapp', 'permite whatsapp']),
    optInEmail: resolveColumnIndex(colMap, ['email marketing', 'opt in email', 'autoriza email', 'autorizacao email', 'consentimento email', 'optin email']),
  };

  // Mapeamento descritivo para diagnóstico
  const mappedFieldSummary: Record<string, string> = {
    'Nome do Cliente': colIndices.name !== -1 ? identifiedColumns[colIndices.name] : 'Não localizada',
    'CPF / CNPJ': colIndices.document !== -1 ? identifiedColumns[colIndices.document] : 'Não localizada',
    'Celular': colIndices.celular !== -1 ? identifiedColumns[colIndices.celular] : 'Não localizada',
    'Telefone': colIndices.phone !== -1 ? identifiedColumns[colIndices.phone] : 'Não localizada',
    'Endereço': colIndices.address !== -1 ? identifiedColumns[colIndices.address] : 'Não localizada',
    'Bairro': colIndices.neighborhood !== -1 ? identifiedColumns[colIndices.neighborhood] : 'Não localizada',
    'Cidade': colIndices.city !== -1 ? identifiedColumns[colIndices.city] : 'Não localizada',
    'CEP': colIndices.cep !== -1 ? identifiedColumns[colIndices.cep] : 'Não localizada',
    'Nascimento': colIndices.birthDate !== -1 ? identifiedColumns[colIndices.birthDate] : 'Não localizada',
    'Opt-in WhatsApp': colIndices.optInWhatsapp !== -1 ? identifiedColumns[colIndices.optInWhatsapp] : 'Não localizada (Padrão: Sem Opt-in)'
  };

  const dataRows = rawRows.slice(headerRowIndex + 1);
  const totalDataRows = dataRows.length;

  // Conversão ultra-rápida de linha para modelo Customer
  const convertRowToCustomer = (
    row: any[],
    rowIdx: number,
    existingCustomerMap?: Map<string, Customer>
  ): { customer: Customer | null; error: FlexImportError | null } => {
    const rowNumber = headerRowIndex + 2 + rowIdx; // Linha real no Excel (1-based)

    const rawName = colIndices.name !== -1 ? row[colIndices.name] : '';
    const name = String(rawName ?? '').trim();
    if (!name || name.length < 2) {
      return {
        customer: null,
        error: {
          rowNumber,
          clientName: name || 'Sem Nome',
          reason: 'Linha sem Nome de Cliente preenchido.'
        }
      };
    }

    const rawCode = colIndices.code !== -1 ? row[colIndices.code] : '';
    const code = String(rawCode ?? '').trim();

    const rawDoc = colIndices.document !== -1 ? row[colIndices.document] : '';
    const docInfo = normalizeDocument(rawDoc);

    // Se um documento foi informado na linha mas é inválido (CPF matemático inválido ou CNPJ malformado),
    // reporta o erro com a linha e motivo sem descartar silenciosamente nem inventar dados.
    if (rawDoc !== null && rawDoc !== undefined && String(rawDoc).trim() !== '' && docInfo.type === 'INVALIDO') {
      return {
        customer: null,
        error: {
          rowNumber,
          clientName: name,
          cpfRaw: String(rawDoc).trim(),
          reason: `CPF/Documento inválido: "${String(rawDoc).trim()}". Formato inválido ou dígitos verificadores incorretos.`
        }
      };
    }

    const rawFj = colIndices.personType !== -1 ? String(row[colIndices.personType] ?? '').trim().toUpperCase() : '';
    const isPJ = rawFj === 'J' || docInfo.type === 'CNPJ';

    const rawPhone = colIndices.phone !== -1 ? row[colIndices.phone] : '';
    const rawCel = colIndices.celular !== -1 ? row[colIndices.celular] : '';
    const phone = normalizePhone(rawPhone);
    const cel = normalizePhone(rawCel);

    // Nunca inventa valores fictícios como '(41) 99999-9999'
    const whatsapp = cel || (phone.includes('9') ? phone : '');
    const regularPhone = phone || cel;

    const rawEmail = colIndices.email !== -1 ? row[colIndices.email] : '';
    const email = String(rawEmail ?? '').trim().toLowerCase();

    const rawBirthDate = colIndices.birthDate !== -1 ? row[colIndices.birthDate] : '';
    const birthDate = normalizeDate(rawBirthDate);

    const rawAddress = colIndices.address !== -1 ? row[colIndices.address] : '';
    const address = String(rawAddress ?? '').trim();

    const rawNumber = colIndices.number !== -1 ? row[colIndices.number] : '';
    const number = String(rawNumber ?? '').trim();

    const rawComplement = colIndices.complement !== -1 ? row[colIndices.complement] : '';
    const complement = String(rawComplement ?? '').trim();

    const rawNeighborhood = colIndices.neighborhood !== -1 ? row[colIndices.neighborhood] : '';
    const neighborhood = String(rawNeighborhood ?? '').trim();

    const rawCity = colIndices.city !== -1 ? row[colIndices.city] : '';
    const city = String(rawCity ?? '').trim();

    const rawState = colIndices.state !== -1 ? row[colIndices.state] : '';
    const state = String(rawState ?? '').trim().toUpperCase();

    const rawCep = colIndices.cep !== -1 ? row[colIndices.cep] : '';
    const cep = normalizeCEP(rawCep);

    const rawCardName = colIndices.cardName !== -1 ? row[colIndices.cardName] : '';
    const cardName = String(rawCardName ?? '').trim();

    const rawCompany = colIndices.companyName !== -1 ? row[colIndices.companyName] : '';
    const companyName = String(rawCompany ?? '').trim();

    const rawRgIe = colIndices.rgIe !== -1 ? row[colIndices.rgIe] : '';
    const rgIe = String(rawRgIe ?? '').trim();

    const rawGender = colIndices.gender !== -1 ? row[colIndices.gender] : '';
    const gender = String(rawGender ?? '').trim().toUpperCase();

    // Identificador único (CPF ou código ou ID gerado)
    let custId = '';
    const cleanCpfDigits = docInfo.digits;

    let existing: Customer | undefined;
    if (cleanCpfDigits && existingCustomerMap) {
      existing = existingCustomerMap.get(cleanCpfDigits);
    }

    if (existing) {
      custId = existing.id;
    } else if (cleanCpfDigits) {
      custId = `cust-flex-${cleanCpfDigits}`;
    } else if (code) {
      custId = `cust-flex-cod-${code}`;
    } else {
      custId = `cust-flex-${Date.now()}-${rowIdx}`;
    }

    // Regra 15 & 16: Não inventar coordenadas fictícias durante a importação
    const latitude: number | undefined = existing?.latitude;
    const longitude: number | undefined = existing?.longitude;
    const geocodeStatus: 'geocoded' | 'pending' | 'failed' = existing?.geocodeStatus || 'pending';

    const nowIso = new Date().toISOString();
    // "Data Cadastro" do Flex: data real de cadastro do cliente (createdAt continua sendo a entrada no CRM)
    const registeredAt = (colIndices.regDate !== -1 ? parseDate(row[colIndices.regDate]) : null) || existing?.registeredAt;

    let hasWaOptIn = false;
    if (colIndices.optInWhatsapp !== -1) {
      const rawWa = String(row[colIndices.optInWhatsapp] ?? '').trim().toLowerCase();
      hasWaOptIn = ['sim', 's', '1', 'true', 'ativo', 'autorizado', 'sim autorizo'].includes(rawWa);
    }

    let hasEmailOptIn = false;
    if (colIndices.optInEmail !== -1) {
      const rawEmail = String(row[colIndices.optInEmail] ?? '').trim().toLowerCase();
      hasEmailOptIn = ['sim', 's', '1', 'true', 'ativo', 'autorizado', 'sim autorizo'].includes(rawEmail);
    }

    const customer: Customer = {
      id: custId,
      name,
      cpf: docInfo.type === 'CPF' ? docInfo.formatted : (existing?.cpf || ''),
      cnpj: docInfo.type === 'CNPJ' ? docInfo.formatted : (existing?.cnpj || ''),
      personType: isPJ ? 'J' : 'F',
      code: code || existing?.code || '',
      rgIe: rgIe || existing?.rgIe || '',
      gender: gender || existing?.gender || '',
      cardName: cardName || existing?.cardName || '',
      companyName: companyName || existing?.companyName || '',
      whatsapp: whatsapp || existing?.whatsapp || '',
      phone: regularPhone || existing?.phone || '',
      email: email || existing?.email || '',
      birthDate: birthDate || existing?.birthDate || '',
      address: address || existing?.address || '',
      number: number || existing?.number || '',
      complement: complement || existing?.complement || '',
      neighborhood: neighborhood || existing?.neighborhood || '',
      city: city || existing?.city || '',
      state: state || existing?.state || '',
      cep: cep || existing?.cep || '',
      latitude,
      longitude,
      geocodeStatus,
      origin: 'Importação Flex',
      createdAt: existing?.createdAt || nowIso,
      ...(registeredAt ? { registeredAt } : {}),
      updatedAt: nowIso,
      consent: existing?.consent || {
        whatsappMarketing: hasWaOptIn,
        emailMarketing: hasEmailOptIn,
        smsMarketing: false,
        whatsappConsentDate: hasWaOptIn ? nowIso : undefined,
        emailConsentDate: hasEmailOptIn ? nowIso : undefined,
        origin: 'Importação Flex',
        purpose: 'Comunicação de ofertas e benefícios Astral Clube'
      },
      totalSpent: existing?.totalSpent || 0,
      totalPurchases: existing?.totalPurchases || 0,
      averageTicket: existing?.averageTicket || 0,
      daysSinceLastPurchase: existing?.daysSinceLastPurchase ?? 999, // 0 (comprou hoje) não pode virar 999
      firstPurchaseDate: existing?.firstPurchaseDate,
      lastPurchaseDate: existing?.lastPurchaseDate,
      rfmSegment: existing?.rfmSegment || 'UNCLASSIFIED',
      recencyScore: existing?.recencyScore || 0,
      frequencyScore: existing?.frequencyScore || 0,
      monetaryScore: existing?.monetaryScore || 0,
      rfmScoreCode: existing?.rfmScoreCode || '000',
      // Cadastrado no CRM entra no clube, mas reimportar não reativa quem foi desativado manualmente.
      isClubMember: existing?.isClubMember ?? true,
      clubJoinedAt: existing?.clubJoinedAt || (existing?.isClubMember === false ? undefined : (registeredAt || nowIso))
    };

    return { customer, error: null };
  };

  // Primeiras 10 linhas para pré-visualização instantânea
  const previewCustomers: Customer[] = [];
  for (let i = 0; i < Math.min(dataRows.length, 10); i++) {
    const res = convertRowToCustomer(dataRows[i], i);
    if (res.customer) {
      previewCustomers.push(res.customer);
    }
  }

  // Extração de todos os clientes com deduplicação rápida e yielding assíncrono para evitar travamento da página
  const extractAllCustomers = async (
    existingList: Customer[] = [],
    onProgress?: (pct: number) => void
  ) => {
    const existingCpfMap = new Map<string, Customer>();
    const existingIdMap = new Map<string, Customer>();

    existingList.forEach(c => {
      if (c.cpf) {
        const d = c.cpf.replace(/\D/g, '');
        if (d) existingCpfMap.set(d, c);
      }
      existingIdMap.set(c.id, c);
    });

    const customersMap = new Map<string, Customer>();
    const updatedMap = new Map<string, Customer>();
    const errors: FlexImportError[] = [];
    let duplicateCount = 0;

    for (let i = 0; i < dataRows.length; i++) {
      // Yield ao navegador a cada 300 linhas para manter a interface 100% fluida
      if (i > 0 && i % 300 === 0) {
        await new Promise(r => setTimeout(r, 0));
        if (onProgress) {
          onProgress(Math.round((i / dataRows.length) * 100));
        }
      }

      const row = dataRows[i];
      const { customer, error } = convertRowToCustomer(row, i, existingCpfMap);

      if (error) {
        errors.push(error);
        continue;
      }

      if (customer) {
        const cpfDigits = customer.cpf ? customer.cpf.replace(/\D/g, '') : '';
        const key = cpfDigits || customer.code || customer.id;

        const wasInDb = cpfDigits && existingCpfMap.has(cpfDigits);

        if (customersMap.has(key)) {
          duplicateCount++;
          const prev = customersMap.get(key)!;
          // Valores vazios da linha posterior não apagam dados já encontrados para o mesmo cliente
          const nonEmptyFromRow = Object.fromEntries(
            Object.entries(customer).filter(([, v]) => v !== undefined && v !== null && v !== '')
          ) as Partial<Customer>;
          const merged: Customer = {
            ...prev,
            ...nonEmptyFromRow,
            updatedAt: new Date().toISOString()
          };
          customersMap.set(key, merged);
          updatedMap.set(merged.id, merged);
        } else {
          customersMap.set(key, customer);
          if (wasInDb) {
            updatedMap.set(customer.id, customer);
          }
        }
      }
    }

    return {
      customers: Array.from(customersMap.values()),
      updatedCustomers: Array.from(updatedMap.values()),
      duplicateCount,
      errors
    };
  };

  return {
    sheetName: selectedSheet,
    availableSheets,
    headerRowNumber: headerRowIndex + 1,
    dataStartRowNumber: headerRowIndex + 2,
    totalRawRows: rawRows.length,
    totalDataRows,
    identifiedColumns,
    mappedFieldSummary,
    previewCustomers,
    extractAllCustomers
  };
}
