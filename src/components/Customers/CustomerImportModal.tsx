import React, { useState, useRef } from 'react';
import { 
  X, 
  UploadCloud, 
  FileSpreadsheet, 
  CheckCircle2, 
  AlertTriangle, 
  ArrowRight, 
  RefreshCw, 
  Database,
  Building2,
  FileCheck,
  Users,
  Eye,
  ChevronDown,
  ChevronUp,
  Info,
  ShieldCheck
} from 'lucide-react';
import { useCRM } from '../../context/CRMContext';
import { Customer } from '../../types/crm';
import { 
  parseFlexExcelFile, 
  ParseFlexResult, 
  FlexImportError 
} from '../../services/flexCustomerParser';
import { CustomerImportProgress } from '../../services/firestoreService';

interface CustomerImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CustomerImportModal: React.FC<CustomerImportModalProps> = ({ isOpen, onClose }) => {
  const { handleImportCustomers, customers: existingCustomers, stores, showToast } = useCRM();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  // 1: Upload, 2: Preview & Validation, 3: Processing, 4: Summary

  const [fileName, setFileName] = useState<string>('');
  const [fileSize, setFileSize] = useState<string>('');
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [parseResult, setParseResult] = useState<ParseFlexResult | null>(null);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Progress state
  const [progress, setProgress] = useState<CustomerImportProgress | null>(null);

  // Final summary
  const [importSummary, setImportSummary] = useState<{
    totalFound: number;
    persistedCount: number;
    importedCount: number;
    updatedCount: number;
    duplicatesCount: number;
    errorsCount: number;
    batchesSucceeded: number;
    batchesFailed: number;
    lastErrorMessage?: string;
    errorsList: FlexImportError[];
  } | null>(null);

  const [showErrorsList, setShowErrorsList] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const resetModal = () => {
    setStep(1);
    setFileName('');
    setFileSize('');
    setFileBuffer(null);
    setParseResult(null);
    setSelectedSheet('');
    setIsParsing(false);
    setParseError(null);
    setProgress(null);
    setImportSummary(null);
    setShowErrorsList(false);
  };

  const handleClose = () => {
    if (step === 3) {
      if (!confirm('A importação está em andamento. Fechar o modal continuará o processamento em segundo plano. Deseja fechar?')) {
        return;
      }
    }
    resetModal();
    onClose();
  };

  const processBuffer = async (buffer: ArrayBuffer, name: string, sizeStr: string, preferredSheet?: string) => {
    setIsParsing(true);
    setParseError(null);
    // Yield para permitir que o React renderize o estado de carregamento antes do processamento pesado
    await new Promise(r => setTimeout(r, 60));
    try {
      const res = parseFlexExcelFile(buffer, preferredSheet);
      setFileBuffer(buffer);
      setFileName(name);
      setFileSize(sizeStr);
      setParseResult(res);
      setSelectedSheet(res.sheetName);
      setStep(2); // Move to Preview
    } catch (err: any) {
      console.error('Erro ao processar arquivo Flex:', err);
      setParseError(err.message || 'Falha ao ler arquivo Excel. Verifique o formato e tente novamente.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const sizeInMb = (file.size / (1024 * 1024)).toFixed(2);
    const sizeStr = `${sizeInMb} MB`;

    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target?.result as ArrayBuffer;
      if (buffer) {
        processBuffer(buffer, file.name, sizeStr);
      }
    };
    reader.onerror = () => {
      setParseError('Falha ao ler o arquivo selecionado.');
    };
    reader.readAsArrayBuffer(file);
  };

  const handleSheetChange = (newSheet: string) => {
    if (!fileBuffer) return;
    setSelectedSheet(newSheet);
    processBuffer(fileBuffer, fileName, fileSize, newSheet);
  };

  const handleStartImport = async () => {
    if (!parseResult) return;

    setStep(3); // Processing step
    setProgress({
      processed: 0,
      total: parseResult.totalDataRows,
      imported: 0,
      updated: 0,
      duplicates: 0,
      errors: 0,
      percentage: 0,
      currentBatch: 0,
      totalBatches: Math.max(1, Math.ceil(parseResult.totalDataRows / 200)),
      currentStep: 'Processando e validando linhas da planilha...'
    });

    // Permite que o React renderize a tela da Etapa 3 imediatamente
    await new Promise(r => setTimeout(r, 60));

    try {
      // Extrai todos os clientes convertidos com yielding assíncrono
      const { customers, updatedCustomers, duplicateCount, errors } = await parseResult.extractAllCustomers(
        existingCustomers,
        (pct) => {
          setProgress(prev => prev ? {
            ...prev,
            currentStep: `Validando linhas da planilha (${pct}%)...`
          } : null);
        }
      );

      // Inicia a gravação em lotes através do context/firestoreService
      const res = await handleImportCustomers(customers, (prog) => {
        setProgress(prog);
      });

      setImportSummary({
        totalFound: parseResult.totalDataRows,
        persistedCount: res.persistedCount,
        importedCount: res.importedCount,
        updatedCount: res.updatedCount,
        duplicatesCount: res.duplicatesCount + duplicateCount,
        errorsCount: res.errorsCount + errors.length,
        batchesSucceeded: res.batchesSucceeded,
        batchesFailed: res.batchesFailed,
        lastErrorMessage: res.lastErrorMessage,
        errorsList: errors
      });

      setStep(4); // Summary step
    } catch (err: any) {
      console.error('Falha durante a importação em lotes:', err);
      showToast('Erro ao importar clientes. Verifique o console.', 'error');
      setImportSummary({
        totalFound: parseResult.totalDataRows,
        persistedCount: 0,
        importedCount: 0,
        updatedCount: 0,
        duplicatesCount: 0,
        errorsCount: parseResult.totalDataRows,
        batchesSucceeded: 0,
        batchesFailed: 1,
        lastErrorMessage: err.message || 'Falha de comunicação com o Firestore',
        errorsList: [{ rowNumber: 0, reason: err.message || 'Falha de comunicação com o Firestore' }]
      });
      setStep(4);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-800 text-base">
                  Importação de Clientes (Arquivo Flex / Excel)
                </h3>
                <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-md text-[10px] font-bold">
                  Compatível com Flex
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Importação em lote de clientes com detecção dinâmica de cabeçalho na Linha 13 da aba Plan1.
              </p>
            </div>
          </div>

          <button
            onClick={handleClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step Indicator */}
        <div className="px-6 py-2.5 bg-white border-b border-slate-100 flex items-center justify-between text-xs">
          <div className="flex items-center gap-6">
            <div className={`flex items-center gap-2 font-medium ${step === 1 ? 'text-emerald-700 font-bold' : step > 1 ? 'text-slate-600' : 'text-slate-400'}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${step === 1 ? 'bg-emerald-600 text-white' : step > 1 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                {step > 1 ? '✓' : '1'}
              </div>
              <span>1. Selecionar Arquivo</span>
            </div>

            <div className={`flex items-center gap-2 font-medium ${step === 2 ? 'text-emerald-700 font-bold' : step > 2 ? 'text-slate-600' : 'text-slate-400'}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${step === 2 ? 'bg-emerald-600 text-white' : step > 2 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                {step > 2 ? '✓' : '2'}
              </div>
              <span>2. Pré-visualização & Mapeamento</span>
            </div>

            <div className={`flex items-center gap-2 font-medium ${step === 3 ? 'text-emerald-700 font-bold' : step > 3 ? 'text-slate-600' : 'text-slate-400'}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${step === 3 ? 'bg-emerald-600 text-white' : step > 3 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>
                {step > 3 ? '✓' : '3'}
              </div>
              <span>3. Gravação em Lote</span>
            </div>

            <div className={`flex items-center gap-2 font-medium ${step === 4 ? 'text-emerald-700 font-bold' : 'text-slate-400'}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${step === 4 ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                4
              </div>
              <span>4. Resumo Concluído</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-[11px] text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
            <Building2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>3 Unidades Super Astral preservadas</span>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 flex-1 overflow-y-auto space-y-6">

          {/* STEP 1: UPLOAD */}
          {step === 1 && (
            <div className="space-y-5">
              {parseError && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 text-rose-700 text-xs">
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-rose-600" />
                  <div>
                    <strong className="block font-bold">Não foi possível processar o arquivo:</strong>
                    <span>{parseError}</span>
                  </div>
                </div>
              )}

              {/* Upload Dropzone */}
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-slate-300 hover:border-emerald-500 rounded-2xl p-8 text-center cursor-pointer transition-all bg-slate-50/50 hover:bg-emerald-50/20 group"
              >
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={handleFileChange} 
                  accept=".xlsx, .xls, .csv" 
                  className="hidden" 
                />
                <div className="w-14 h-14 rounded-2xl bg-white shadow-sm border border-slate-200 flex items-center justify-center mx-auto mb-3 text-emerald-600 group-hover:scale-105 transition-transform">
                  <UploadCloud className="w-7 h-7" />
                </div>
                <h4 className="font-bold text-slate-800 text-sm mb-1">
                  Clique ou arraste o arquivo exportado do Flex aqui
                </h4>
                <p className="text-xs text-slate-500 max-w-md mx-auto mb-3">
                  Formatos aceitos: <strong>.xlsx</strong>, <strong>.xls</strong> ou <strong>.csv</strong>. O arquivo pode ter até 30.000 registros.
                </p>
                <div className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
                  <FileSpreadsheet className="w-3.5 h-3.5" />
                  Selecionar Planilha no Computador
                </div>
              </div>

              {/* Flex System Specifics Explanation */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-slate-800">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Cabeçalho Inteligente (Linha 13)</span>
                  </div>
                  <p className="text-slate-500 text-[11px] leading-relaxed">
                    Ignora as 12 primeiras linhas informativas do relatório Flex e localiza dinamicamente as colunas <strong>Nome Do Cliente</strong> e <strong>CNPJ / CPF</strong>.
                  </p>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-slate-800">
                    <ShieldCheck className="w-4 h-4 text-emerald-600" />
                    <span>Preservação de Zeros em CPFs</span>
                  </div>
                  <p className="text-slate-500 text-[11px] leading-relaxed">
                    Trata CPFs numéricos e com texto, preenchendo zeros à esquerda com 11 dígitos e separando empresas (CNPJs).
                  </p>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-slate-800">
                    <RefreshCw className="w-4 h-4 text-emerald-600" />
                    <span>Deduplicação Automática</span>
                  </div>
                  <p className="text-slate-500 text-[11px] leading-relaxed">
                    Clientes com o mesmo CPF são atualizados em vez de criar duplicados, preservando o histórico de compras existente.
                  </p>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                  <div className="flex items-center gap-1.5 font-bold text-slate-800">
                    <Database className="w-4 h-4 text-emerald-600" />
                    <span>Lotes Fluidos sem Congelamento</span>
                  </div>
                  <p className="text-slate-500 text-[11px] leading-relaxed">
                    Gravação fracionada de 200 em 200 registros no Firestore com barra de progresso em tempo real.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: PREVIEW & VALIDATION */}
          {step === 2 && parseResult && (
            <div className="space-y-5">
              {/* File details banner */}
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold">
                      <FileSpreadsheet className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-emerald-950 text-sm">
                        Arquivo Identificado: {fileName}
                      </h4>
                      <div className="flex flex-wrap items-center gap-3 text-emerald-800 text-[11px] mt-0.5">
                        <span>Tamanho: <strong>{fileSize}</strong></span>
                        <span>•</span>
                        <span>Linha do Cabeçalho: <strong>Linha {parseResult.headerRowNumber}</strong></span>
                        <span>•</span>
                        <span>Início dos Dados: <strong>Linha {parseResult.dataStartRowNumber}</strong></span>
                        <span>•</span>
                        <span>Registros Encontrados: <strong>{parseResult.totalDataRows.toLocaleString('pt-BR')}</strong></span>
                      </div>
                    </div>
                  </div>

                  {/* Sheet Selector if multiple sheets */}
                  {parseResult.availableSheets.length > 1 && (
                    <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-emerald-200">
                      <span className="font-medium text-slate-600">Aba:</span>
                      <select
                        value={selectedSheet}
                        onChange={(e) => handleSheetChange(e.target.value)}
                        className="text-emerald-800 font-bold bg-transparent outline-none cursor-pointer"
                      >
                        {parseResult.availableSheets.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  {parseResult.availableSheets.length <= 1 && (
                    <div className="bg-white/80 px-3 py-1.5 rounded-lg border border-emerald-200 font-bold text-emerald-900">
                      Aba: {parseResult.sheetName}
                    </div>
                  )}
                </div>

                {/* Audit Confirmation Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-3 bg-white/90 border border-emerald-200 rounded-lg text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Arquivo lido</span>
                    <strong className="text-emerald-700 font-bold">SIM ({fileName})</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Planilha encontrada</span>
                    <strong className="text-slate-800 font-bold">{parseResult.sheetName}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Cabeçalho encontrado</span>
                    <strong className="text-slate-800 font-bold">Linha {parseResult.headerRowNumber}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Registros encontrados</span>
                    <strong className="text-emerald-700 font-bold">{parseResult.totalDataRows.toLocaleString('pt-BR')}</strong>
                  </div>
                </div>
              </div>

              {/* Preview Table Notice */}
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-slate-700">
                  <Eye className="w-4 h-4 text-emerald-600" />
                  <span className="font-bold">
                    Pré-visualização dos Primeiros 10 Clientes (Convertidos para o CRM):
                  </span>
                </div>
                <span className="text-slate-400 text-[11px]">
                  Exibindo {Math.min(parseResult.previewCustomers.length, 10)} de {parseResult.totalDataRows.toLocaleString('pt-BR')} registros
                </span>
              </div>

              {/* Preview Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                <div className="overflow-x-auto max-h-72">
                  <table className="w-full text-left text-xs text-slate-700">
                    <thead className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200 sticky top-0">
                      <tr>
                        <th className="px-3 py-2.5">Nome do Cliente</th>
                        <th className="px-3 py-2.5">CPF / CNPJ</th>
                        <th className="px-3 py-2.5">Telefone / Celular</th>
                        <th className="px-3 py-2.5">CEP</th>
                        <th className="px-3 py-2.5">Bairro</th>
                        <th className="px-3 py-2.5">Cidade</th>
                        <th className="px-3 py-2.5 text-center">Tipo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {parseResult.previewCustomers.map((cust, idx) => (
                        <tr key={cust.id || idx} className="hover:bg-slate-50 transition-colors">
                          <td className="px-3 py-2 font-medium text-slate-900">
                            <div>{cust.name}</div>
                            {cust.companyName && cust.companyName !== cust.name && (
                              <div className="text-[10px] text-slate-400">{cust.companyName}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-slate-600 text-[11px]">
                            {cust.cpf || cust.cnpj || '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-600 text-[11px]">
                            {cust.whatsapp || cust.phone || '—'}
                          </td>
                          <td className="px-3 py-2 font-mono text-slate-500 text-[11px]">
                            {cust.cep || '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {cust.neighborhood || '—'}
                          </td>
                          <td className="px-3 py-2 text-slate-600">
                            {cust.city || '—'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${cust.personType === 'J' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                              {cust.personType === 'J' ? 'PJ' : 'PF'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Info about stores and data safety */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl flex items-start gap-3 text-xs text-slate-600">
                <Info className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-slate-800">Regras de Segurança da Importação:</span>
                  <ul className="list-disc list-inside mt-1 space-y-0.5 text-[11px] text-slate-500">
                    <li>As 3 lojas reais do Super Astral cadastradas permanecerão intactas.</li>
                    <li>Clientes com CPF já presente no banco de dados serão atualizados com os novos dados de contato e endereço.</li>
                    <li>Nenhum cliente real anterior será excluído.</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: PROCESSING WITH PROGRESS BAR */}
          {step === 3 && (
            <div className="py-8 space-y-6 max-w-lg mx-auto text-center">
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto animate-pulse">
                <RefreshCw className="w-8 h-8 animate-spin" />
              </div>

              <div>
                <h4 className="text-lg font-bold text-slate-800">
                  Importando Clientes...
                </h4>
                <p className="text-xs text-slate-500 mt-1">
                  Gravando registros de forma otimizada no Firestore. Por favor, aguarde.
                </p>
              </div>

              {/* Progress Counters */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                  <span>Progresso da Gravação:</span>
                  <span className="font-mono text-emerald-700 text-sm">
                    {progress?.processed.toLocaleString('pt-BR') || 0} / {progress?.total.toLocaleString('pt-BR') || parseResult?.totalDataRows.toLocaleString('pt-BR')} ({progress?.percentage || 0}%)
                  </span>
                </div>

                {/* Bar */}
                <div className="w-full h-3.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                  <div 
                    className="h-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-300 rounded-full"
                    style={{ width: `${Math.max(5, progress?.percentage || 0)}%` }}
                  />
                </div>

                <div className="text-[11px] text-slate-400 italic">
                  {progress?.currentStep || 'Preparando lotes...'}
                </div>
              </div>

              {/* Live metrics */}
              <div className="grid grid-cols-4 gap-2 pt-2">
                <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Novos</div>
                  <div className="text-sm font-black text-emerald-600 font-mono">
                    {progress?.imported.toLocaleString('pt-BR') || 0}
                  </div>
                </div>

                <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Atualizados</div>
                  <div className="text-sm font-black text-blue-600 font-mono">
                    {progress?.updated.toLocaleString('pt-BR') || 0}
                  </div>
                </div>

                <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Duplicados</div>
                  <div className="text-sm font-black text-slate-600 font-mono">
                    {progress?.duplicates.toLocaleString('pt-BR') || 0}
                  </div>
                </div>

                <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="text-[10px] text-slate-500 font-bold uppercase">Erros</div>
                  <div className="text-sm font-black text-rose-600 font-mono">
                    {progress?.errors.toLocaleString('pt-BR') || 0}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: SUMMARY */}
          {step === 4 && importSummary && (
            <div className="space-y-6">
              {importSummary.persistedCount === 0 ? (
                <div className="p-6 bg-amber-50/90 border border-amber-300 rounded-2xl text-center space-y-3">
                  <div className="w-14 h-14 rounded-2xl bg-amber-500 text-white flex items-center justify-center mx-auto shadow-md shadow-amber-500/20">
                    <AlertTriangle className="w-8 h-8" />
                  </div>
                  <div>
                    <h4 className="text-lg font-black text-amber-950">
                      ⚠️ A leitura do arquivo funcionou, mas nenhum cliente foi gravado no banco.
                    </h4>
                    <p className="text-xs text-amber-900 max-w-lg mx-auto mt-1 leading-relaxed">
                      O arquivo <strong>{fileName}</strong> foi lido com sucesso ({importSummary.totalFound.toLocaleString('pt-BR')} registros na aba {parseResult?.sheetName}, cabeçalho na linha {parseResult?.headerRowNumber}), porém a gravação no Firestore retornou 0 clientes gravados.
                    </p>
                  </div>
                  {importSummary.lastErrorMessage && (
                    <div className="mt-2 p-3 bg-white/90 border border-amber-200 rounded-xl text-left text-[11px] text-rose-700 font-mono break-all max-w-lg mx-auto">
                      <strong>Motivo retornado:</strong> {importSummary.lastErrorMessage}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 bg-emerald-50/70 border border-emerald-200 rounded-2xl text-center space-y-3">
                  <div className="w-14 h-14 rounded-2xl bg-emerald-600 text-white flex items-center justify-center mx-auto shadow-md shadow-emerald-600/20">
                    <CheckCircle2 className="w-8 h-8" />
                  </div>
                  <div>
                    <h4 className="text-lg font-black text-slate-900">
                      Importação Concluída com Sucesso!
                    </h4>
                    <p className="text-xs text-slate-600 max-w-md mx-auto mt-1">
                      Foram gravados <strong>{importSummary.persistedCount.toLocaleString('pt-BR')} clientes</strong> no Firestore com sucesso ({importSummary.importedCount.toLocaleString('pt-BR')} novos cadastros e {importSummary.updatedCount.toLocaleString('pt-BR')} atualizados). Os dados do Dashboard, busca e mapa já estão sincronizados.
                    </p>
                  </div>
                </div>
              )}

              {/* Diagnostic 10-Stage Pipeline Overview (Regra 5) */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-3">
                <div className="font-bold text-slate-800 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-emerald-600" />
                    <span>Diagnóstico Detalhado das 10 Etapas:</span>
                  </div>
                  <span className="text-[11px] text-slate-500 font-normal">
                    {importSummary.persistedCount > 0 ? 'Todas as 10 etapas concluídas' : 'Falha identificada na persistência'}
                  </span>
                </div>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-200">
                    <span className="font-medium text-slate-700">ETAPA 1: Arquivo selecionado</span>
                    <span className="text-emerald-700 font-bold">✓ {fileName}</span>
                  </div>

                  <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-200">
                    <span className="font-medium text-slate-700">ETAPA 2: Arquivo XLSX aberto</span>
                    <span className="text-emerald-700 font-bold">✓ Lido com sucesso</span>
                  </div>

                  <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-200">
                    <span className="font-medium text-slate-700">ETAPA 3: Planilha encontrada</span>
                    <span className="text-emerald-700 font-bold">✓ Aba {parseResult?.sheetName}</span>
                  </div>

                  <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-200">
                    <span className="font-medium text-slate-700">ETAPA 4: Cabeçalho identificado</span>
                    <span className="text-emerald-700 font-bold">✓ Linha {parseResult?.headerRowNumber}</span>
                  </div>

                  <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-200">
                    <span className="font-medium text-slate-700">ETAPA 5: Clientes convertidos</span>
                    <span className="text-emerald-700 font-bold">✓ {importSummary.totalFound.toLocaleString('pt-BR')} registros</span>
                  </div>

                  <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-200">
                    <span className="font-medium text-slate-700">ETAPA 6: Clientes validados</span>
                    <span className="text-emerald-700 font-bold">✓ CPFs e dados validados</span>
                  </div>

                  <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-200">
                    <span className="font-medium text-slate-700">ETAPA 7: Primeiro teste Firestore</span>
                    <span className={importSummary.persistedCount > 0 ? "text-emerald-700 font-bold" : "text-rose-600 font-bold"}>
                      {importSummary.persistedCount > 0 ? '✓ 1º cliente gravado' : '⚠️ Falha no teste'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-200">
                    <span className="font-medium text-slate-700">ETAPA 8: Gravação em lotes</span>
                    <span className={importSummary.batchesFailed === 0 ? "text-emerald-700 font-bold" : "text-amber-700 font-bold"}>
                      {importSummary.batchesSucceeded || 0} lotes OK {importSummary.batchesFailed > 0 ? `(${importSummary.batchesFailed} erros)` : ''}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-200">
                    <span className="font-medium text-slate-700">ETAPA 9: Clientes persistidos</span>
                    <span className={importSummary.persistedCount > 0 ? "text-emerald-700 font-bold" : "text-rose-600 font-bold"}>
                      {importSummary.persistedCount > 0 ? `✓ ${importSummary.persistedCount.toLocaleString('pt-BR')} gravados` : '⚠️ 0 gravados'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-2 bg-white rounded-lg border border-slate-200">
                    <span className="font-medium text-slate-700">ETAPA 10: Lista do CRM atualizada</span>
                    <span className={importSummary.persistedCount > 0 ? "text-emerald-700 font-bold" : "text-slate-400 font-bold"}>
                      {importSummary.persistedCount > 0 ? '✓ CRM sincronizado' : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Statistics Cards (Regra 18) */}
              <div>
                <h5 className="text-xs font-bold text-slate-700 mb-2">Relatório Consolidado da Importação:</h5>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div className="p-3.5 bg-white border border-slate-200 rounded-xl shadow-2xs">
                    <div className="text-[11px] text-slate-500 font-semibold mb-0.5">Registros encontrados</div>
                    <div className="text-xl font-black text-slate-800 font-mono">
                      {importSummary.totalFound.toLocaleString('pt-BR')}
                    </div>
                    <span className="text-[10px] text-slate-400">no arquivo Flex</span>
                  </div>

                  <div className="p-3.5 bg-emerald-50/50 border border-emerald-200 rounded-xl shadow-2xs">
                    <div className="text-[11px] text-emerald-800 font-semibold mb-0.5">Realmente gravados</div>
                    <div className="text-xl font-black text-emerald-700 font-mono">
                      {importSummary.persistedCount.toLocaleString('pt-BR')}
                    </div>
                    <span className="text-[10px] text-emerald-600">no Firestore</span>
                  </div>

                  <div className="p-3.5 bg-emerald-50/30 border border-slate-200 rounded-xl shadow-2xs">
                    <div className="text-[11px] text-slate-600 font-semibold mb-0.5">Novos clientes</div>
                    <div className="text-xl font-black text-slate-800 font-mono">
                      {importSummary.importedCount.toLocaleString('pt-BR')}
                    </div>
                    <span className="text-[10px] text-slate-400">cadastros criados</span>
                  </div>

                  <div className="p-3.5 bg-blue-50/50 border border-blue-200 rounded-xl shadow-2xs">
                    <div className="text-[11px] text-blue-800 font-semibold mb-0.5">Clientes atualizados</div>
                    <div className="text-xl font-black text-blue-700 font-mono">
                      {importSummary.updatedCount.toLocaleString('pt-BR')}
                    </div>
                    <span className="text-[10px] text-blue-600">mesclados por CPF</span>
                  </div>

                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl shadow-2xs">
                    <div className="text-[11px] text-slate-500 font-semibold mb-0.5">Duplicidades</div>
                    <div className="text-xl font-black text-slate-700 font-mono">
                      {importSummary.duplicatesCount.toLocaleString('pt-BR')}
                    </div>
                    <span className="text-[10px] text-slate-400">tratadas no arquivo</span>
                  </div>

                  <div className="p-3.5 bg-rose-50/40 border border-rose-200 rounded-xl shadow-2xs">
                    <div className="text-[11px] text-rose-800 font-semibold mb-0.5">Erros</div>
                    <div className="text-xl font-black text-rose-700 font-mono">
                      {importSummary.errorsCount.toLocaleString('pt-BR')}
                    </div>
                    <span className="text-[10px] text-rose-500">linhas com falha</span>
                  </div>

                  <div className="p-3.5 bg-emerald-50/40 border border-emerald-200 rounded-xl shadow-2xs">
                    <div className="text-[11px] text-emerald-800 font-semibold mb-0.5">Lotes concluídos</div>
                    <div className="text-xl font-black text-emerald-700 font-mono">
                      {importSummary.batchesSucceeded || 0}
                    </div>
                    <span className="text-[10px] text-emerald-600">lotes de 200 docs</span>
                  </div>

                  <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl shadow-2xs">
                    <div className="text-[11px] text-slate-500 font-semibold mb-0.5">Lotes com erro</div>
                    <div className={`text-xl font-black font-mono ${importSummary.batchesFailed > 0 ? 'text-rose-600' : 'text-slate-700'}`}>
                      {importSummary.batchesFailed || 0}
                    </div>
                    <span className="text-[10px] text-slate-400">falhas de conexão</span>
                  </div>
                </div>
              </div>

              {/* Errors report section */}
              {importSummary.errorsCount > 0 ? (
                <div className="border border-rose-200 rounded-xl bg-rose-50/30 overflow-hidden text-xs">
                  <div 
                    onClick={() => setShowErrorsList(!showErrorsList)}
                    className="p-3.5 flex items-center justify-between cursor-pointer hover:bg-rose-50/70 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-rose-800 font-bold">
                      <AlertTriangle className="w-4 h-4 text-rose-600" />
                      <span>{importSummary.errorsCount} registro(s) com erro ou inconsistência</span>
                    </div>
                    <div className="flex items-center gap-1 text-rose-700 font-semibold text-[11px]">
                      <span>{showErrorsList ? 'Ocultar detalhes' : 'Visualizar detalhes dos erros'}</span>
                      {showErrorsList ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </div>

                  {showErrorsList && (
                    <div className="p-3 border-t border-rose-200 bg-white max-h-48 overflow-y-auto">
                      <table className="w-full text-left text-[11px]">
                        <thead>
                          <tr className="text-slate-400 font-bold border-b border-slate-100">
                            <th className="pb-1.5">Linha</th>
                            <th className="pb-1.5">Cliente</th>
                            <th className="pb-1.5">Motivo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {importSummary.errorsList.slice(0, 100).map((err, i) => (
                            <tr key={i} className="text-slate-700">
                              <td className="py-1 font-mono text-slate-500">Linha {err.rowNumber}</td>
                              <td className="py-1 font-medium">{err.clientName || 'Não identificado'}</td>
                              <td className="py-1 text-rose-600">{err.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center gap-2 text-xs text-emerald-800">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Nenhum registro apresentou erro de importação. Todos os dados foram processados perfeitamente.</span>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
          {step === 1 && (
            <>
              <button
                onClick={handleClose}
                className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded-xl transition-colors"
              >
                Cancelar
              </button>
              <div className="text-xs text-slate-400 italic">
                Aba Plan1 • Cabeçalho na Linha 13 • Dados na Linha 14
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded-xl transition-colors"
              >
                Voltar / Trocar Arquivo
              </button>

              <button
                onClick={handleStartImport}
                className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md shadow-emerald-600/20 transition-all hover:scale-[1.01]"
              >
                <span>Importar Clientes ({parseResult?.totalDataRows.toLocaleString('pt-BR')} registros)</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </>
          )}

          {step === 3 && (
            <div className="w-full flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Processando lotes em segundo plano...
              </span>
              <button
                disabled
                className="px-4 py-2 bg-slate-200 text-slate-500 text-xs font-bold rounded-xl cursor-not-allowed"
              >
                Gravando...
              </button>
            </div>
          )}

          {step === 4 && (
            <div className="w-full flex items-center justify-between gap-3">
              {importSummary?.persistedCount === 0 ? (
                <>
                  <button
                    onClick={() => setStep(2)}
                    className="px-4 py-2 border border-slate-200 hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded-xl transition-colors"
                  >
                    Voltar para Revisão
                  </button>
                  <button
                    onClick={handleStartImport}
                    className="flex items-center gap-1.5 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-md transition-all"
                  >
                    <RefreshCw className="w-4 h-4" />
                    <span>Tentar Gravar Novamente</span>
                  </button>
                </>
              ) : (
                <div className="w-full flex items-center justify-end">
                  <button
                    onClick={handleClose}
                    className="flex items-center gap-1.5 px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md shadow-emerald-600/20 transition-all"
                  >
                    <Users className="w-4 h-4" />
                    <span>Ver Clientes no CRM</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
