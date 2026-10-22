import * as XLSX from 'xlsx';
import { Purchase, PurchaseItem } from '../types/crm';
import { resolveStoreId, getStoreLabel } from './storeAndLocationData';
import { isValidCpf, formatCpf as canonicalFormatCpf, cleanCpfDigits } from '../utils/cpfValidator';
import { isValidCnpj, formatCnpj } from '../utils/cnpjValidator';

export interface PDVImportError {
  rowNumber: number;
  receiptNo?: string;
  reason: string;
}

export interface ParsePDVResult {
  fileName: string;
  sheetName: string;
  availableSheets: string[];
  headerRowNumber: number;
  dataStartRowNumber: number;
  totalDataRows: number;
  totalReceiptsCount: number;
  totalReceipts?: number;
  totalItemsCount: number;
  totalRevenueCalculated: number;
  previewPurchases: Purchase[];
  detectedColumns: {
    receiptCol?: string;
    dateCol?: string;
    cpfCol?: string;
    customerNameCol?: string;
    phoneCol?: string;
    skuCol?: string;
    productCol?: string;
    categoryCol?: string;
    qtyCol?: string;
    unitPriceCol?: string;
    totalPriceCol?: string;
    storeCol?: string;
    posCol?: string;
    paymentCol?: string;
  };
  /** Situação da loja no arquivo: cupons sem loja reconhecida exigem escolha manual do operador */
  storeResolution: {
    storeColumnFound: boolean;
    unresolvedReceiptsCount: number;
    unrecognizedValues: string[];
  };
  /** manualStore: loja escolhida pelo operador, aplicada só aos cupons sem loja reconhecida e só nesta importação */
  extractAllPurchases: (options?: { manualStore?: ManualStoreSelection | null }) => {
    purchases: Purchase[];
    errors: PDVImportError[];
  };
}

export interface ManualStoreSelection {
  id: string;
  name: string;
}

/**
 * Motivo que impede iniciar a importação (ou null se pode importar).
 * Cupons sem loja reconhecida exigem que o operador escolha explicitamente a unidade.
 */
export function getPDVImportBlockReason(
  result: Pick<ParsePDVResult, 'storeResolution'>,
  manualStore: ManualStoreSelection | null | undefined
): string | null {
  const sr = result.storeResolution;
  if (!sr || sr.unresolvedReceiptsCount === 0) return null;
  // Mais de uma loja não reconhecida no mesmo arquivo: uma escolha manual única atribuiria
  // vendas de lojas diferentes à mesma unidade. Exige um arquivo por loja.
  if (sr.unrecognizedValues.length > 1) {
    return `O arquivo tem mais de uma loja não reconhecida (${sr.unrecognizedValues.map(v => `"${v}"`).join(', ')}). Exporte e importe um arquivo por loja.`;
  }
  if (manualStore?.id) return null;
  if (!sr.storeColumnFound) {
    return 'Este arquivo não informa a loja. Selecione a unidade correspondente.';
  }
  if (sr.unrecognizedValues.length > 0) {
    return `Loja não reconhecida no arquivo: ${sr.unrecognizedValues.map(v => `"${v}"`).join(', ')}. Selecione a unidade correspondente.`;
  }
  return 'Há cupons sem loja informada no arquivo. Selecione a unidade correspondente.';
}

// Format CPF to standard XXX.XXX.XXX-XX using strict validation
export function formatCpf(val: any): string {
  if (!val) return '';
  const digits = cleanCpfDigits(val);
  if (digits.length === 11 && isValidCpf(digits)) {
    return canonicalFormatCpf(digits);
  }
  if (digits.length === 14 && isValidCnpj(digits)) {
    return formatCnpj(digits);
  }
  return '';
}

// Clean number parser (handles Brazilian currency format R$ 1.250,50 or 1250.50)
export function parseNumber(val: any, defaultVal = 0): number {
  if (val === null || val === undefined || val === '') return defaultVal;
  if (typeof val === 'number') return isNaN(val) ? defaultVal : val;
  
  let str = String(val).trim().replace(/[R$\s]/g, '');
  if (!str) return defaultVal;

  // If contains comma and dot, e.g. 1.250,50
  if (str.includes(',') && str.includes('.')) {
    str = str.replace(/\./g, '').replace(',', '.');
  } else if (str.includes(',')) {
    str = str.replace(',', '.');
  }

  const num = parseFloat(str);
  return isNaN(num) ? defaultVal : num;
}

export type PDVDateResult =
  | { ok: true; iso: string; hasTime: boolean }
  | { ok: false; reason: 'empty' | 'invalid' };

// Monta data local validando cada componente (sem "rolar" 31/02 para março, por exemplo)
function buildLocalDate(y: number, mo: number, d: number, h: number, mi: number, se: number): Date | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h < 0 || h > 23 || mi < 0 || mi > 59 || se < 0 || se > 59) return null;
  const dt = new Date(y, mo - 1, d, h, mi, se);
  if (isNaN(dt.getTime()) || dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

/**
 * Normalização central da data da compra no PDV.
 * Aceita: célula de data/serial do Excel, Date, texto BR DD/MM/AAAA [HH:mm[:ss]] e ISO (AAAA-MM-DD...).
 * Nunca assume MM/DD e nunca inventa data: vazio ou inválido retorna ok=false.
 * Datas sem horário recebem 12:00 no horário local (mesma regra histórica do texto BR).
 */
export function parsePDVDate(val: any): PDVDateResult {
  if (val === null || val === undefined) return { ok: false, reason: 'empty' };

  if (val instanceof Date) {
    if (isNaN(val.getTime())) return { ok: false, reason: 'invalid' };
    const hasTime = val.getHours() !== 0 || val.getMinutes() !== 0 || val.getSeconds() !== 0;
    const dt = hasTime ? val : new Date(val.getFullYear(), val.getMonth(), val.getDate(), 12, 0, 0);
    return { ok: true, iso: dt.toISOString(), hasTime };
  }

  // Serial de data do Excel (ex.: 45672 = 15/01/2025)
  if (typeof val === 'number') {
    if (!isFinite(val) || val < 1 || val >= 2958466) return { ok: false, reason: 'invalid' };
    const parsed = XLSX.SSF.parse_date_code(val);
    if (!parsed) return { ok: false, reason: 'invalid' };
    const hasTime = parsed.H !== 0 || parsed.M !== 0 || parsed.S !== 0;
    const dt = hasTime
      ? buildLocalDate(parsed.y, parsed.m, parsed.d, parsed.H, parsed.M, parsed.S)
      : buildLocalDate(parsed.y, parsed.m, parsed.d, 12, 0, 0);
    return dt ? { ok: true, iso: dt.toISOString(), hasTime } : { ok: false, reason: 'invalid' };
  }

  const str = String(val).trim();
  if (!str) return { ok: false, reason: 'empty' };

  // Formato brasileiro DD/MM/AAAA ou DD/MM/AAAA HH:mm[:ss]
  const brMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4}|\d{2})(?!\d)(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (brMatch) {
    let year = parseInt(brMatch[3], 10);
    if (year < 100) year += 2000;
    const hasTime = brMatch[4] !== undefined;
    const dt = buildLocalDate(
      year,
      parseInt(brMatch[2], 10),
      parseInt(brMatch[1], 10),
      hasTime ? parseInt(brMatch[4], 10) : 12,
      hasTime ? parseInt(brMatch[5], 10) : 0,
      brMatch[6] ? parseInt(brMatch[6], 10) : 0
    );
    return dt ? { ok: true, iso: dt.toISOString(), hasTime } : { ok: false, reason: 'invalid' };
  }

  // ISO AAAA-MM-DD[THH:mm[:ss[.sss]]][Z|±HH:mm]
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const mo = parseInt(isoMatch[2], 10);
    const d = parseInt(isoMatch[3], 10);
    if (!buildLocalDate(y, mo, d, 12, 0, 0)) return { ok: false, reason: 'invalid' };
    const hasTime = isoMatch[4] !== undefined;
    if (isoMatch[7]) {
      const dt = new Date(str);
      return isNaN(dt.getTime()) ? { ok: false, reason: 'invalid' } : { ok: true, iso: dt.toISOString(), hasTime };
    }
    const dt = buildLocalDate(
      y, mo, d,
      hasTime ? parseInt(isoMatch[4], 10) : 12,
      hasTime ? parseInt(isoMatch[5], 10) : 0,
      isoMatch[6] ? parseInt(isoMatch[6], 10) : 0
    );
    return dt ? { ok: true, iso: dt.toISOString(), hasTime } : { ok: false, reason: 'invalid' };
  }

  return { ok: false, reason: 'invalid' };
}

// Parse Excel date or string date into ISO string. Retorna null quando a data não é confiável.
export function parseDate(val: any): string | null {
  const res = parsePDVDate(val);
  return res.ok ? res.iso : null;
}

// Mapeia a loja do arquivo para uma loja conhecida (regras em storeAndLocationData.ts:
// endereço/nome comercial > ID interno > código numérico do RP Flex, este último só após conferência).
// Sem correspondência confiável retorna null (nunca atribui a venda a outra unidade por padrão).
export function normalizeStore(val: any): { id: string; name: string } | null {
  const id = resolveStoreId(val);
  if (!id) return null;
  return { id, name: getStoreLabel(id) || id };
}

// Hash determinístico (FNV-1a, 2 x 32 bits) para identificar cupons sem número a partir de dados estáveis
function stableHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

// Normalize payment method
export function normalizePaymentMethod(val: any): Purchase['paymentMethod'] {
  const str = String(val ?? '').toLowerCase().trim();
  if (!str) return undefined; // ausência de dado não vira forma de pagamento inventada
  if (str.includes('crédito') || str.includes('credito')) return 'Cartão Crédito';
  if (str.includes('débito') || str.includes('debito')) return 'Cartão Débito';
  if (str.includes('pix')) return 'PIX';
  if (str.includes('dinheiro')) return 'Dinheiro';
  if (str.includes('astral') || str.includes('vale')) return 'Astral Vale';
  return 'Outro';
}

function normalizeHeaderKey(key: string): string {
  return String(key)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export async function parsePDVExcelFile(
  buffer: ArrayBuffer, 
  preferredSheet?: string,
  onProgress?: (pct: number) => void
): Promise<ParsePDVResult> {
  const workbook = XLSX.read(buffer, { 
    type: 'array',
    dense: true,
    cellDates: false,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    raw: true
  });
  const availableSheets = workbook.SheetNames;
  if (!availableSheets || availableSheets.length === 0) {
    throw new Error('Nenhuma planilha encontrada no arquivo.');
  }

  const sheetName = preferredSheet && availableSheets.includes(preferredSheet)
    ? preferredSheet
    : availableSheets[0];

  const worksheet = workbook.Sheets[sheetName];
  if (!worksheet) {
    throw new Error(`Aba "${sheetName}" não foi encontrada no arquivo.`);
  }

  // Convert to rows array (array of arrays)
  const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false
  });

  // Mesmas linhas com os valores brutos tipados (serial de data do Excel continua número).
  // Usado somente para a coluna de data, evitando ler "1/15/25" (formato m/d/aa da célula) como DD/MM.
  const rawValueRows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: true,
    blankrows: false
  });

  if (!rows || rows.length === 0) {
    throw new Error(`A aba "${sheetName}" está vazia.`);
  }

  // Search for the header row dynamically in the first 25 rows
  let headerRowIndex = -1;
  const pdvKeywords = ['cupom', 'produto', 'cpf', 'valor', 'data', 'quantidade', 'sku', 'loja', 'pdv', 'cliente', 'total'];

  for (let r = 0; r < Math.min(rows.length, 25); r++) {
    const row = rows[r];
    if (!Array.isArray(row)) continue;

    let matches = 0;
    for (const cell of row) {
      const norm = normalizeHeaderKey(String(cell));
      if (pdvKeywords.some(kw => norm.includes(kw))) {
        matches++;
      }
    }

    if (matches >= 2) {
      headerRowIndex = r;
      break;
    }
  }

  // Fallback to row 0 if no clear header was found
  if (headerRowIndex === -1) {
    headerRowIndex = 0;
  }

  const rawHeaderRow = rows[headerRowIndex] || [];
  const headerCols = rawHeaderRow.map((c: any) => String(c || '').trim());

  // Map columns to standard fields
  let receiptColIdx = -1;
  let dateColIdx = -1;
  let cpfColIdx = -1;
  let nameColIdx = -1;
  let phoneColIdx = -1;
  let skuColIdx = -1;
  let productColIdx = -1;
  let categoryColIdx = -1;
  let qtyColIdx = -1;
  let unitPriceColIdx = -1;
  let totalPriceColIdx = -1;
  let storeColIdx = -1;
  let posColIdx = -1;
  let paymentColIdx = -1;

  headerCols.forEach((colName, idx) => {
    const norm = normalizeHeaderKey(colName);

    // Cupom / Receipt
    if (receiptColIdx === -1 && (
      norm.includes('cupom') || norm.includes('coo') || norm.includes('nfce') || norm.includes('cf') ||
      norm.includes('documentofiscal') || norm.includes('recibo') || norm === 'doc'
    )) {
      receiptColIdx = idx;
    }

    // Data
    if (dateColIdx === -1 && (
      norm.includes('data') || norm.includes('emissao') || norm.includes('dt') || norm === 'data'
    )) {
      dateColIdx = idx;
    }

    // CPF / Documento
    if (cpfColIdx === -1 && (
      norm.includes('cpf') || norm.includes('cnpj') || norm.includes('documento') || norm === 'doccliente'
    )) {
      cpfColIdx = idx;
    }

    // Nome Cliente
    if (nameColIdx === -1 && (
      norm.includes('nome') || norm.includes('cliente') || norm.includes('consumidor') || norm.includes('razao')
    )) {
      nameColIdx = idx;
    }

    // Telefone
    if (phoneColIdx === -1 && (
      norm.includes('telefone') || norm.includes('celular') || norm.includes('whatsapp') || norm.includes('fone') || norm.includes('contato')
    )) {
      phoneColIdx = idx;
    }

    // SKU / Código
    if (skuColIdx === -1 && (
      norm.includes('sku') || norm.includes('codigo') || norm.includes('plu') || norm.includes('codproduto') || norm.includes('cod')
    )) {
      skuColIdx = idx;
    }

    // Produto
    if (productColIdx === -1 && (
      norm.includes('produto') || norm.includes('descricao') || norm.includes('item') || norm.includes('mercadoria')
    )) {
      productColIdx = idx;
    }

    // Categoria
    if (categoryColIdx === -1 && (
      norm.includes('categoria') || norm.includes('departamento') || norm.includes('secao') || norm.includes('depto') || norm.includes('grupo')
    )) {
      categoryColIdx = idx;
    }

    // Quantidade
    if (qtyColIdx === -1 && (
      norm.includes('quantidade') || norm.includes('qtd') || norm.includes('qtde') || norm.includes('quant')
    )) {
      qtyColIdx = idx;
    }

    // Valor Unitario
    if (unitPriceColIdx === -1 && (
      norm.includes('unitario') || norm.includes('unit') || norm.includes('vlunit') || norm.includes('precounit')
    )) {
      unitPriceColIdx = idx;
    }

    // Valor Total
    if (totalPriceColIdx === -1 && (
      norm.includes('valortotal') || norm.includes('vltotal') || norm.includes('subtotal') || norm.includes('totalliquido') || norm === 'total' || norm === 'valor'
    )) {
      totalPriceColIdx = idx;
    }

    // Loja
    if (storeColIdx === -1 && (
      norm.includes('loja') || norm.includes('unidade') || norm.includes('filial') || norm.includes('estabelecimento')
    )) {
      storeColIdx = idx;
    }

    // PDV / Caixa
    if (posColIdx === -1 && (
      norm.includes('pdv') || norm.includes('caixa') || norm.includes('terminal') || norm.includes('checkout')
    )) {
      posColIdx = idx;
    }

    // Forma de Pagamento
    if (paymentColIdx === -1 && (
      norm.includes('pagamento') || norm.includes('formapagamento') || norm.includes('meiopagamento')
    )) {
      paymentColIdx = idx;
    }
  });

  const dataStartRowIndex = headerRowIndex + 1;
  const dataRows = rows.slice(dataStartRowIndex);

  // Group items by Receipt / Cupom Number
  const receiptGroups = new Map<string, {
    rowNumbers: number[];
    receiptNo: string;
    date: string | null;
    rawDateText: string;
    cpf: string;
    name: string;
    phone: string;
    storeVal: string;
    posVal: string;
    paymentVal: string;
    items: PurchaseItem[];
    // Cupom sem número: partes estáveis usadas para o identificador depois que a loja é resolvida
    noReceiptKey?: { iso: string; pos: string; cpf: string };
  }>();

  // Erros de linha (independentes da loja escolhida)
  const rowErrors: PDVImportError[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    // Yield ao navegador a cada 300 linhas para não travar a interface
    if (i > 0 && i % 300 === 0) {
      await new Promise(r => setTimeout(r, 0));
      if (onProgress) onProgress(Math.round((i / dataRows.length) * 100));
    }

    const row = dataRows[i];
    const physicalRowNumber = dataStartRowIndex + i + 1;

    // Check if row is blank
    if (!row || row.length === 0 || row.every((c: any) => String(c).trim() === '')) {
      continue;
    }

    const rawReceipt = receiptColIdx !== -1 ? String(row[receiptColIdx] || '').trim() : '';
    const rawDate = dateColIdx !== -1 ? (rawValueRows[dataStartRowIndex + i]?.[dateColIdx] ?? row[dateColIdx]) : '';
    const rawDateText = dateColIdx !== -1 ? String(row[dateColIdx] ?? '').trim() : '';
    const dateRes = parsePDVDate(rawDate);
    const rawCpf = cpfColIdx !== -1 ? String(row[cpfColIdx] || '').trim() : '';
    const rawName = nameColIdx !== -1 ? String(row[nameColIdx] || '').trim() : '';
    const rawPhone = phoneColIdx !== -1 ? String(row[phoneColIdx] || '').trim() : '';
    const rawSku = skuColIdx !== -1 ? String(row[skuColIdx] || '').trim() : '';
    const rawProduct = productColIdx !== -1 ? String(row[productColIdx] || '').trim() : '';
    const rawCategory = categoryColIdx !== -1 ? String(row[categoryColIdx] || '').trim() : '';
    const rawQty = qtyColIdx !== -1 ? row[qtyColIdx] : '';
    const rawUnit = unitPriceColIdx !== -1 ? row[unitPriceColIdx] : 0;
    const rawTotal = totalPriceColIdx !== -1 ? row[totalPriceColIdx] : 0;
    const rawStore = storeColIdx !== -1 ? row[storeColIdx] : '';
    const rawPos = posColIdx !== -1 ? row[posColIdx] : '';
    const rawPayment = paymentColIdx !== -1 ? row[paymentColIdx] : '';

    // Quantidade ausente/inválida fica null (nunca assume 1 nem recalcula valores com quantidade inventada)
    const parsedQty = parseNumber(rawQty, NaN);
    const qty: number | null = isFinite(parsedQty) && parsedQty > 0 ? parsedQty : null;
    let unitPrice = parseNumber(rawUnit, 0);
    let itemTotal = parseNumber(rawTotal, 0);

    if (qty !== null && itemTotal === 0 && unitPrice > 0) {
      itemTotal = parseFloat((unitPrice * qty).toFixed(2));
    } else if (qty !== null && unitPrice === 0 && itemTotal > 0) {
      unitPrice = parseFloat((itemTotal / qty).toFixed(2));
    }

    const rowCpf = formatCpf(rawCpf);

    // Cupom sem número: identificador determinístico só com dados estáveis da transação
    // (loja + data/hora + PDV/CPF). Nunca usa número da linha, índice ou horário da importação.
    // A loja pode ser escolhida manualmente depois; aqui o cupom é agrupado pela loja do arquivo.
    let receiptNo = rawReceipt;
    let noReceiptKey: { iso: string; pos: string; cpf: string } | undefined;
    if (!rawReceipt.replace(/[^a-zA-Z0-9_-]/g, '')) {
      const posForKey = String(rawPos ?? '').trim();
      const cpfDigitsForKey = cleanCpfDigits(rowCpf);
      const validCpfForKey = cpfDigitsForKey.length === 11 && isValidCpf(cpfDigitsForKey) ? cpfDigitsForKey : '';
      if (!dateRes.ok || !dateRes.hasTime || (!posForKey && !validCpfForKey)) {
        rowErrors.push({
          rowNumber: physicalRowNumber,
          reason: 'Cupom sem número e sem dados suficientes para identificação estável (exige loja, data com horário e PDV ou CPF válido).'
        });
        continue;
      }
      noReceiptKey = { iso: dateRes.iso, pos: posForKey.toLowerCase(), cpf: validCpfForKey };
      const fileStoreKey = normalizeStore(rawStore)?.id || `arquivo:${String(rawStore ?? '').trim().toLowerCase()}`;
      receiptNo = `SEM-CUPOM|${fileStoreKey}|${noReceiptKey.iso}|${noReceiptKey.pos}|${noReceiptKey.cpf}`;
    }

    const existingGroup = receiptGroups.get(receiptNo);
    const item: PurchaseItem = {
      sku: rawSku,
      productName: rawProduct,
      category: rawCategory,
      quantity: qty,
      unitPrice: unitPrice >= 0 ? unitPrice : 0,
      totalPrice: itemTotal >= 0 ? itemTotal : 0
    };

    if (existingGroup) {
      existingGroup.rowNumbers.push(physicalRowNumber);
      existingGroup.items.push(item);
      if (!existingGroup.cpf && rowCpf) existingGroup.cpf = rowCpf;
      if (!existingGroup.date && dateRes.ok) existingGroup.date = dateRes.iso;
      if (!existingGroup.rawDateText && rawDateText) existingGroup.rawDateText = rawDateText;
      if (!existingGroup.name && rawName) existingGroup.name = rawName;
      if (!existingGroup.phone && rawPhone) existingGroup.phone = rawPhone;
    } else {
      receiptGroups.set(receiptNo, {
        rowNumbers: [physicalRowNumber],
        receiptNo,
        date: dateRes.ok ? dateRes.iso : null,
        rawDateText,
        cpf: rowCpf,
        name: rawName, // nome ausente permanece vazio (nunca um nome fictício)
        phone: rawPhone || '',
        storeVal: rawStore || '',
        posVal: rawPos || '',
        paymentVal: rawPayment || '',
        items: [item],
        noReceiptKey
      });
    }
  }

  // Resolução de loja: loja do arquivo quando reconhecida; caso contrário, somente a loja escolhida
  // manualmente pelo operador para esta importação (nunca um padrão silencioso).
  const unresolvedGroups = Array.from(receiptGroups.values()).filter(g => !normalizeStore(g.storeVal));
  const storeResolution = {
    storeColumnFound: storeColIdx !== -1,
    unresolvedReceiptsCount: unresolvedGroups.length,
    unrecognizedValues: Array.from(new Set(
      unresolvedGroups.map(g => String(g.storeVal ?? '').trim()).filter(Boolean)
    ))
  };

  // Convert groups into valid Purchase objects
  const buildPurchases = (manualStore?: ManualStoreSelection | null) => {
    const purchasesList: Purchase[] = [];
    const parseErrors: PDVImportError[] = [...rowErrors];
    let totalRevenue = 0;
    let totalItemsCount = 0;

    receiptGroups.forEach((group) => {
      const isNoReceipt = Boolean(group.noReceiptKey);
      const displayReceipt = isNoReceipt ? undefined : group.receiptNo;

      // Sem data confiável a compra não é gravada (não inventa "hoje")
      if (!group.date) {
        parseErrors.push({
          rowNumber: group.rowNumbers[0],
          receiptNo: displayReceipt,
          reason: group.rawDateText
            ? `Data da compra inválida: "${group.rawDateText}".`
            : 'Data da compra ausente.'
        });
        return;
      }
      const purchaseDate = group.date;

      // Loja sem correspondência confiável não é atribuída a outra unidade
      const storeInfo = normalizeStore(group.storeVal) || (manualStore?.id ? manualStore : null);
      if (!storeInfo) {
        const rawStoreText = String(group.storeVal ?? '').trim();
        parseErrors.push({
          rowNumber: group.rowNumbers[0],
          receiptNo: displayReceipt,
          reason: `${isNoReceipt ? 'Cupom sem número: ' : ''}${rawStoreText
            ? `Loja/unidade não reconhecida: "${rawStoreText}".`
            : 'Loja/unidade não informada no arquivo.'} Selecione a unidade correspondente na importação.`
        });
        return;
      }
      const subtotal = parseFloat(
        group.items.reduce((sum, it) => sum + it.totalPrice, 0).toFixed(2)
      );

      const receiptNo = group.noReceiptKey
        ? `SEM-CUPOM-${stableHash([storeInfo.id, group.noReceiptKey.iso, group.noReceiptKey.pos, group.noReceiptKey.cpf].join('|'))}`
        : group.receiptNo;

      if (subtotal <= 0) {
        parseErrors.push({
          rowNumber: group.rowNumbers[0],
          receiptNo,
          reason: 'Cupom com valor total zerado ou inválido'
        });
        return;
      }

      totalRevenue += subtotal;
      totalItemsCount += group.items.length;

      // Identificador determinístico estável: loja + cupom + data (garante idempotência na reimportação)
      // (cupom sempre tem número ou identificador estável SEM-CUPOM-<hash>; nunca a linha)
      const cleanStore = storeInfo.id.replace(/[^a-zA-Z0-9_-]/g, '');
      const cleanReceipt = receiptNo.replace(/[^a-zA-Z0-9_-]/g, '');
      const cleanDate = purchaseDate.slice(0, 10).replace(/[^0-9]/g, '');
      const deterministicPurchaseId = `pdv_${cleanStore}_${cleanReceipt}_${cleanDate}`;

      const purchase: Purchase = {
        id: deterministicPurchaseId,
        customerId: '', // Vinculado no lote de persistência
        customerName: group.name,
        customerCpf: group.cpf,
        customerPhone: group.phone,
        storeId: storeInfo.id,
        storeName: storeInfo.name,
        posNumber: String(group.posVal ?? '').trim(),
        couponReceiptNumber: receiptNo,
        purchaseDate,
        totalAmount: subtotal,
        discountAmount: 0,
        netAmount: subtotal,
        paymentMethod: normalizePaymentMethod(group.paymentVal),
        items: group.items,
        itemsCount: group.items.length,
        loyaltyPointsEarned: Math.floor(subtotal)
      };

      purchasesList.push(purchase);
    });

    return { purchases: purchasesList, errors: parseErrors, totalRevenue, totalItemsCount };
  };

  // Resumo/pré-visualização sem loja manual (cupons sem loja resolvida ficam pendentes)
  const initial = buildPurchases(null);

  return {
    fileName: '',
    sheetName,
    availableSheets,
    headerRowNumber: headerRowIndex + 1,
    dataStartRowNumber: dataStartRowIndex + 1,
    totalDataRows: dataRows.length,
    totalReceiptsCount: initial.purchases.length,
    totalReceipts: initial.purchases.length,
    totalItemsCount: initial.totalItemsCount,
    totalRevenueCalculated: initial.totalRevenue,
    previewPurchases: initial.purchases.slice(0, 10),
    storeResolution,
    detectedColumns: {
      receiptCol: receiptColIdx !== -1 ? headerCols[receiptColIdx] : undefined,
      dateCol: dateColIdx !== -1 ? headerCols[dateColIdx] : undefined,
      cpfCol: cpfColIdx !== -1 ? headerCols[cpfColIdx] : undefined,
      customerNameCol: nameColIdx !== -1 ? headerCols[nameColIdx] : undefined,
      phoneCol: phoneColIdx !== -1 ? headerCols[phoneColIdx] : undefined,
      skuCol: skuColIdx !== -1 ? headerCols[skuColIdx] : undefined,
      productCol: productColIdx !== -1 ? headerCols[productColIdx] : undefined,
      categoryCol: categoryColIdx !== -1 ? headerCols[categoryColIdx] : undefined,
      qtyCol: qtyColIdx !== -1 ? headerCols[qtyColIdx] : undefined,
      unitPriceCol: unitPriceColIdx !== -1 ? headerCols[unitPriceColIdx] : undefined,
      totalPriceCol: totalPriceColIdx !== -1 ? headerCols[totalPriceColIdx] : undefined,
      storeCol: storeColIdx !== -1 ? headerCols[storeColIdx] : undefined,
      posCol: posColIdx !== -1 ? headerCols[posColIdx] : undefined,
      paymentCol: paymentColIdx !== -1 ? headerCols[paymentColIdx] : undefined
    },
    extractAllPurchases: (options?: { manualStore?: ManualStoreSelection | null }) => {
      const res = buildPurchases(options?.manualStore);
      return { purchases: res.purchases, errors: res.errors };
    }
  };
}
