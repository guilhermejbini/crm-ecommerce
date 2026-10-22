import * as XLSX from 'xlsx';

/** Monta um .xlsx em memória a partir de uma matriz de valores (fixtures artificiais). */
export function buildXlsx(rows: any[][], sheetName = 'Plan1'): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}

/**
 * Igual a buildXlsx, mas permite sobrescrever células específicas com tipo/formato
 * (ex.: { B2: { t: 'n', v: 45672, z: 'm/d/yy' } } para uma célula de data real do Excel).
 */
export function buildXlsxWithCells(rows: any[][], cells: Record<string, any>, sheetName = 'Plan1'): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  Object.entries(cells).forEach(([addr, cell]) => { ws[addr] = cell; });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
}
