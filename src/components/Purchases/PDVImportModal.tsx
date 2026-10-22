import React, { useState, useRef } from 'react';
import { 
  UploadCloud, 
  FileSpreadsheet, 
  CheckCircle2, 
  AlertTriangle, 
  RefreshCw, 
  X, 
  ArrowRight, 
  ChevronDown, 
  ChevronUp, 
  ShieldCheck, 
  Layers, 
  Store, 
  Users, 
  Info, 
  Sparkles,
  ShoppingCart,
  Receipt,
  Calendar,
  Building2,
  DollarSign
} from 'lucide-react';
import { useCRM } from '../../context/CRMContext';
import { displayCustomerName } from '../../utils/customerFormUtils';
import { Purchase } from '../../types/crm';
import { parsePDVExcelFile, ParsePDVResult, formatCpf, getPDVImportBlockReason, ManualStoreSelection } from '../../services/pdvParser';
import { getRecordStoreId, getStoreLabel } from '../../services/storeAndLocationData';
import { PDVImportProgress, PDVImportResult } from '../../services/firestoreService';
import { DEMO_STORES } from '../../services/storeAndLocationData';

interface PDVImportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PDVImportModal: React.FC<PDVImportModalProps> = ({ isOpen, onClose }) => {
  const { handleImportPurchases, refreshData, stores } = useCRM();

  // Step state: 1 = Upload, 2 = Preview, 3 = Recording/Progress, 4 = Final Summary
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // File states
  const [file, setFile] = useState<File | null>(null);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [isReadingFile, setIsReadingFile] = useState(false);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const [parseResult, setParseResult] = useState<ParsePDVResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  // Import options
  const [autoCreateCustomers, setAutoCreateCustomers] = useState(true);
  // Loja escolhida pelo operador para cupons sem loja reconhecida (vale só para esta importação)
  const [manualStoreId, setManualStoreId] = useState('');

  // Live progress during step 3
  const [progress, setProgress] = useState<PDVImportProgress>({
    processed: 0,
    total: 0,
    imported: 0,
    newCustomers: 0,
    linkedCustomers: 0,
    itemsProcessed: 0,
    errors: 0,
    percentage: 0,
    currentBatch: 0,
    totalBatches: 0,
    currentStep: 'Preparando importação de vendas do PDV...'
  });

  // Final summary result
  const [importSummary, setImportSummary] = useState<PDVImportResult | null>(null);
  const [showErrorsList, setShowErrorsList] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const selectedManualStore: ManualStoreSelection | null = (() => {
    const st = (stores || []).find(s => s.id === manualStoreId);
    if (!st) return null;
    // Grava pela loja física (endereço), não só pelo ID do cadastro: evita herdar a inversão
    // store-01/store-02 de cadastros de loja ainda não migrados.
    const physicalId = getRecordStoreId(st.id, `${st.name} ${st.address || ''}`) || st.id;
    return { id: physicalId, name: getStoreLabel(physicalId) || st.name };
  })();
  const importBlockReason = parseResult ? getPDVImportBlockReason(parseResult, selectedManualStore) : null;
  // Arquivo com mais de uma loja não reconhecida: não se escolhe uma unidade única para todas
  const hasMultipleUnrecognizedStores = (parseResult?.storeResolution?.unrecognizedValues?.length || 0) > 1;
  const unresolvedStoreCount = parseResult?.storeResolution?.unresolvedReceiptsCount || 0;

  const resetAll = () => {
    setStep(1);
    setFile(null);
    setFileBuffer(null);
    setIsReadingFile(false);
    setSelectedSheet('');
    setParseResult(null);
    setParseError(null);
    setAutoCreateCustomers(true);
    setManualStoreId('');
    setProgress({
      processed: 0,
      total: 0,
      imported: 0,
      newCustomers: 0,
      linkedCustomers: 0,
      itemsProcessed: 0,
      errors: 0,
      percentage: 0,
      currentBatch: 0,
      totalBatches: 0,
      currentStep: 'Preparando importação de vendas do PDV...'
    });
    setImportSummary(null);
    setShowErrorsList(false);
  };

  const handleClose = () => {
    resetAll();
    onClose();
  };

  // Process uploaded or generated file buffer
  const processBuffer = async (buffer: ArrayBuffer, fileName: string, sheetOverride?: string) => {
    setIsReadingFile(true);
    setParseError(null);
    setManualStoreId('');
    // Yield para permitir que o React renderize o estado de carregamento antes do processamento pesado
    await new Promise(r => setTimeout(r, 60));

    try {
      const res = await parsePDVExcelFile(buffer, sheetOverride);
      res.fileName = fileName;
      setParseResult(res);
      setSelectedSheet(res.sheetName);
      setStep(2);
    } catch (err: any) {
      console.error('Erro ao analisar arquivo PDV:', err);
      setParseError(err?.message || 'Falha ao processar arquivo de vendas do PDV.');
    } finally {
      setIsReadingFile(false);
    }
  };

  // Handle file input change
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setIsReadingFile(true);
    setParseError(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      const buffer = evt.target?.result as ArrayBuffer;
      setFileBuffer(buffer);
      processBuffer(buffer, selectedFile.name);
    };
    reader.onerror = () => {
      setParseError('Falha ao ler o arquivo selecionado no navegador.');
      setIsReadingFile(false);
    };
    reader.readAsArrayBuffer(selectedFile);
  };

  // Switch sheet if multiple sheets exist
  const handleSheetChange = (newSheet: string) => {
    if (!fileBuffer || !file) return;
    processBuffer(fileBuffer, file.name, newSheet);
  };

  // Start batch import into Firestore
  const handleStartImport = async () => {
    if (!parseResult) return;
    // Sem loja reconhecida e sem escolha explícita do operador: não importa
    if (getPDVImportBlockReason(parseResult, selectedManualStore)) return;

    setStep(3);
    const totalReceipts = parseResult.totalReceiptsCount || (parseResult as any).totalReceipts || 0;
    setProgress({
      processed: 0,
      total: totalReceipts,
      imported: 0,
      newCustomers: 0,
      linkedCustomers: 0,
      itemsProcessed: 0,
      duplicates: 0,
      errors: 0,
      percentage: 0,
      currentBatch: 0,
      totalBatches: Math.max(1, Math.ceil(totalReceipts / 200)),
      currentStep: 'Agrupando cupons e preparando dados para gravação...'
    });

    // Permite que o React renderize a tela da Etapa 3 antes do início da gravação
    await new Promise(r => setTimeout(r, 60));

    const { purchases, errors } = parseResult.extractAllPurchases({ manualStore: selectedManualStore });

    try {
      const res = await handleImportPurchases(
        purchases,
        autoCreateCustomers,
        (p) => setProgress(p)
      );

      // Consolidate any parse errors with firestore errors
      const combinedErrors = [
        ...errors,
        ...(res.errorsList || [])
      ];

      const finalResult: PDVImportResult = {
        ...res,
        errorsCount: combinedErrors.length,
        errorsList: combinedErrors
      };

      setImportSummary(finalResult);
      setStep(4);
      await refreshData();
    } catch (err: any) {
      console.error('Falha geral na importação do PDV:', err);
      setImportSummary({
        totalFound: purchases.length,
        persistedCount: 0,
        importedCount: 0,
        newCustomersCount: 0,
        linkedCustomersCount: 0,
        itemsProcessedCount: 0,
        errorsCount: purchases.length,
        batchesSucceeded: 0,
        batchesFailed: 1,
        lastErrorMessage: err?.message || String(err),
        stageSummary: {
          readSuccess: true,
          parseSuccess: true,
          dbWriteSuccess: false
        },
        errorsList: [{ rowNumber: 1, reason: err?.message || 'Erro inesperado no processo de gravação.' }]
      });
      setStep(4);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden rounded-2xl shadow-2xl border border-slate-200">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-100 text-teal-700 flex items-center justify-center shadow-xs">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-800">
                  Importação de Vendas & Cupons (PDV / Super Astral)
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-50 text-teal-700 border border-teal-200 uppercase tracking-wide">
                  Compatível com PDV & ERP
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Importação em lote de cupons fiscais e itens de venda com agregação por cupom e vínculo de clientes.
              </p>
            </div>
          </div>

          <button 
            onClick={handleClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Wizard Steps Navigation Bar */}
        <div className="px-6 py-2.5 bg-slate-50/80 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-1.5 sm:gap-2 text-xs font-semibold">
            <span className={`flex items-center gap-1 px-2.5 py-1 rounded-lg ${step === 1 ? 'bg-teal-600 text-white shadow-xs' : 'text-slate-500'}`}>
              <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px] font-black">1</span>
              Selecionar Arquivo
            </span>
            <span className="text-slate-300">›</span>
            <span className={`flex items-center gap-1 px-2.5 py-1 rounded-lg ${step === 2 ? 'bg-teal-600 text-white shadow-xs' : 'text-slate-500'}`}>
              <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px] font-black">2</span>
              Pré-visualização & Validação
            </span>
            <span className="text-slate-300">›</span>
            <span className={`flex items-center gap-1 px-2.5 py-1 rounded-lg ${step === 3 ? 'bg-teal-600 text-white shadow-xs' : 'text-slate-500'}`}>
              <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px] font-black">3</span>
              Gravação em Lotes
            </span>
            <span className="text-slate-300">›</span>
            <span className={`flex items-center gap-1 px-2.5 py-1 rounded-lg ${step === 4 ? 'bg-teal-600 text-white shadow-xs' : 'text-slate-500'}`}>
              <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center text-[10px] font-black">4</span>
              Relatório Concluído
            </span>
          </div>

          <div className="hidden md:flex items-center gap-1 text-[11px] text-slate-500 font-medium">
            <Store className="w-3.5 h-3.5 text-teal-600" />
            <span>3 Unidades Super Astral preservadas</span>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto max-h-[calc(92vh-180px)] space-y-6">

          {/* STEP 1: Upload File or Load Sample */}
          {step === 1 && (
            <div className="space-y-6">
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-teal-200 hover:border-teal-400 bg-teal-50/20 hover:bg-teal-50/40 rounded-2xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all group"
              >
                <input 
                  type="file" 
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".xlsx, .xls, .csv" 
                  className="hidden" 
                />

                <div className="w-14 h-14 rounded-2xl bg-teal-100 text-teal-700 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform shadow-xs">
                  {isReadingFile ? (
                    <RefreshCw className="w-7 h-7 animate-spin text-teal-600" />
                  ) : (
                    <UploadCloud className="w-7 h-7" />
                  )}
                </div>

                <h4 className="text-sm font-bold text-slate-800 mb-1">
                  {isReadingFile ? 'Lendo planilha de vendas...' : 'Arraste ou clique para selecionar a planilha de vendas'}
                </h4>
                <p className="text-xs text-slate-500 max-w-md mb-3">
                  Compatível com planilhas de PDV, Frente de Caixa, NFC-e e ERP nos formatos <strong>.xlsx</strong>, <strong>.xls</strong> ou <strong>.csv</strong>.
                </p>

                <div className="flex items-center gap-2 text-[11px] text-teal-700 bg-white px-3 py-1.5 rounded-full border border-teal-200 shadow-2xs font-medium">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-teal-600" />
                  <span>Suporta arquivos com múltiplos itens e cupons</span>
                </div>
              </div>

              {parseError && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-3 text-rose-800 text-xs">
                  <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <div className="font-bold mb-0.5">Erro ao processar o arquivo</div>
                    <div>{parseError}</div>
                  </div>
                </div>
              )}

              {/* Feature Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 rounded-xl border border-slate-200 bg-white">
                  <div className="font-bold text-slate-800 flex items-center gap-1.5 mb-1">
                    <Receipt className="w-4 h-4 text-teal-600" />
                    <span>Agrupamento por Cupom Fiscal</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Múltiplas linhas do mesmo número de cupom são unificadas em uma única compra contendo todos os seus itens.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 bg-white">
                  <div className="font-bold text-slate-800 flex items-center gap-1.5 mb-1">
                    <Users className="w-4 h-4 text-teal-600" />
                    <span>Vínculo Automático por CPF</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Associa a compra a clientes já cadastrados ou cria automaticamente novos cadastros com cálculo de fidelidade.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 bg-white">
                  <div className="font-bold text-slate-800 flex items-center gap-1.5 mb-1">
                    <DollarSign className="w-4 h-4 text-teal-600" />
                    <span>Cálculo Automático de Valores</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Converte SKUs, quantidades fracionadas (kg), valores unitários e totaliza automaticamente cada cupom fiscal.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl border border-slate-200 bg-white">
                  <div className="font-bold text-slate-800 flex items-center gap-1.5 mb-1">
                    <ShieldCheck className="w-4 h-4 text-teal-600" />
                    <span>Gravação Segura em Lotes</span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Processamento fracionado em lotes de 200 documentos no Firestore com barra de progresso em tempo real.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Preview & Validation */}
          {step === 2 && parseResult && (
            <div className="space-y-5">
              {/* File details banner */}
              <div className="p-4 bg-teal-50/50 border border-teal-200 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center font-bold">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-slate-800">{parseResult.fileName || 'Arquivo PDV Carregado'}</div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-2">
                      <span>Cabeçalho: <strong>Linha {parseResult.headerRowNumber}</strong></span>
                      <span>•</span>
                      <span>Início dos dados: <strong>Linha {parseResult.dataStartRowNumber}</strong></span>
                      <span>•</span>
                      <span>Total de itens: <strong>{parseResult.totalItemsCount.toLocaleString('pt-BR')}</strong></span>
                    </div>
                  </div>
                </div>

                {/* Sheet selector if multiple */}
                {parseResult.availableSheets.length > 1 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-slate-500 font-semibold">Planilha:</span>
                    <select
                      value={selectedSheet}
                      onChange={(e) => handleSheetChange(e.target.value)}
                      className="px-2.5 py-1 bg-white border border-teal-200 rounded-lg text-xs font-semibold text-slate-700"
                    >
                      {parseResult.availableSheets.map(s => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Audit Confirmation Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <span className="text-[11px] text-slate-500 font-medium">Arquivo lido</span>
                  <div className="font-bold text-slate-800 truncate mt-0.5" title={parseResult.fileName}>
                    {parseResult.fileName || 'Planilha PDV'}
                  </div>
                  <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1 mt-1">
                    <CheckCircle2 className="w-3 h-3" /> Processado
                  </span>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <span className="text-[11px] text-slate-500 font-medium">Planilha encontrada</span>
                  <div className="font-bold text-slate-800 truncate mt-0.5">
                    {parseResult.sheetName}
                  </div>
                  <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1 mt-1">
                    <CheckCircle2 className="w-3 h-3" /> Aba ativa
                  </span>
                </div>

                <div className="p-3 bg-teal-50/60 border border-teal-200 rounded-xl">
                  <span className="text-[11px] text-teal-800 font-medium">Cupons identificados</span>
                  <div className="text-lg font-black text-teal-700 font-mono mt-0.5">
                    {parseResult.totalReceiptsCount.toLocaleString('pt-BR')}
                  </div>
                  <span className="text-[10px] text-teal-600">cupons prontos</span>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <span className="text-[11px] text-slate-500 font-medium">Faturamento somado</span>
                  <div className="text-lg font-black text-slate-800 font-mono mt-0.5">
                    {parseResult.totalRevenueCalculated.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </div>
                  <span className="text-[10px] text-slate-400">total dos cupons</span>
                </div>
              </div>

              {/* Preview Notice */}
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-700 flex items-center gap-1.5">
                  <Receipt className="w-4 h-4 text-teal-600" />
                  <span>Pré-visualização dos 10 primeiros cupons fiscais identificados</span>
                </span>
                <span className="text-[11px] text-slate-400">
                  Mostrando {parseResult.previewPurchases.length} de {parseResult.totalReceiptsCount}
                </span>
              </div>

              {/* Preview Table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                <div className="overflow-x-auto max-h-64">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 sticky top-0">
                      <tr>
                        <th className="py-2.5 px-3 font-bold">Data</th>
                        <th className="py-2.5 px-3 font-bold">Cupom</th>
                        <th className="py-2.5 px-3 font-bold">CPF Cliente</th>
                        <th className="py-2.5 px-3 font-bold">Nome Cliente</th>
                        <th className="py-2.5 px-3 font-bold">Loja Super Astral</th>
                        <th className="py-2.5 px-3 font-bold">PDV</th>
                        <th className="py-2.5 px-3 font-bold text-center">Itens</th>
                        <th className="py-2.5 px-3 font-bold text-right">Valor Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {parseResult.previewPurchases.map((p, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-2 px-3 text-slate-500 whitespace-nowrap font-mono">
                            {new Date(p.purchaseDate).toLocaleDateString('pt-BR')}
                          </td>
                          <td className="py-2 px-3 font-mono font-bold text-slate-700 whitespace-nowrap">
                            {p.couponReceiptNumber}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-600 whitespace-nowrap">
                            {p.customerCpf ? formatCpf(p.customerCpf) : <span className="text-slate-400 italic">Não informado</span>}
                          </td>
                          <td className="py-2 px-3 font-medium text-slate-800 whitespace-nowrap">
                            {displayCustomerName(p.customerName)}
                          </td>
                          <td className="py-2 px-3 text-slate-600 whitespace-nowrap">
                            {p.storeName}
                          </td>
                          <td className="py-2 px-3 text-slate-500 whitespace-nowrap">
                            {p.posNumber}
                          </td>
                          <td className="py-2 px-3 text-center font-bold text-slate-700">
                            {p.items?.length || 1}
                          </td>
                          <td className="py-2 px-3 font-mono font-black text-emerald-700 text-right whitespace-nowrap">
                            {p.netAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Store selection (arquivo sem loja ou com loja não reconhecida) */}
              {unresolvedStoreCount > 0 && (
                <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl space-y-2 text-xs text-amber-900">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold">{getPDVImportBlockReason(parseResult, null)}</div>
                      <div className="text-[11px] text-amber-800 mt-0.5">
                        {unresolvedStoreCount.toLocaleString('pt-BR')} cupom(ns) sem loja reconhecida. A unidade escolhida vale somente para estes cupons nesta importação; cupons com loja reconhecida mantêm a loja do arquivo.
                      </div>
                    </div>
                  </div>
                  {!hasMultipleUnrecognizedStores && (
                    <select
                      value={manualStoreId}
                      onChange={(e) => setManualStoreId(e.target.value)}
                      className="w-full px-3 py-2 bg-white border border-amber-300 rounded-lg text-xs font-semibold text-slate-800"
                    >
                      <option value="">Selecione a unidade...</option>
                      {(stores || []).map(st => (
                        <option key={st.id} value={st.id}>{st.code} — {st.name} ({st.address})</option>
                      ))}
                    </select>
                  )}
                  {(stores || []).length === 0 && (
                    <div className="text-[11px] font-semibold text-rose-700">Nenhuma loja cadastrada no sistema.</div>
                  )}
                </div>
              )}

              {/* Import Options */}
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoCreateCustomers}
                    onChange={(e) => setAutoCreateCustomers(e.target.checked)}
                    className="w-4 h-4 text-teal-600 rounded border-slate-300 focus:ring-teal-500"
                  />
                  <span className="text-xs font-bold text-slate-700">
                    Cadastrar novos clientes automaticamente no CRM se o CPF ainda não existir
                  </span>
                </label>
                <p className="text-[11px] text-slate-500 pl-6">
                  Se ativado, cada cupom identificado com CPF gerará o perfil do cliente com pontuação de fidelidade inicial e histórico de compras.
                </p>
              </div>

              {/* Rules & safety banner */}
              <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl flex items-start gap-2.5 text-xs text-amber-900">
                <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Preservação das Lojas e Atualização do CRM:</strong> As 3 lojas reais da Rede Super Astral cadastradas permanecerão intactas. O faturamento, o ticket médio e os segmentos RFM dos clientes serão recalculados automaticamente após a importação.
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Progress & Batch Recording */}
          {step === 3 && (
            <div className="py-10 flex flex-col items-center justify-center text-center space-y-6">
              <div className="w-16 h-16 rounded-2xl bg-teal-100 text-teal-700 flex items-center justify-center shadow-md animate-pulse">
                <RefreshCw className="w-8 h-8 animate-spin" />
              </div>

              <div>
                <h4 className="text-base font-bold text-slate-800 mb-1">
                  Importando Vendas do PDV...
                </h4>
                <p className="text-xs text-slate-500 max-w-md">
                  {progress.currentStep}
                </p>
              </div>

              {/* Progress bar */}
              <div className="w-full max-w-md space-y-2">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-slate-600">Progresso Geral</span>
                  <span className="text-teal-700 font-mono">{progress.percentage}%</span>
                </div>
                <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200 p-0.5">
                  <div 
                    className="h-full bg-gradient-to-r from-teal-500 to-emerald-600 rounded-full transition-all duration-300"
                    style={{ width: `${progress.percentage}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Processados: <strong>{progress.processed.toLocaleString('pt-BR')}</strong> de {progress.total.toLocaleString('pt-BR')}</span>
                  <span>Lote: <strong>{progress.currentBatch}</strong> de {progress.totalBatches}</span>
                </div>
              </div>

              {/* Real-time counters */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 w-full max-w-lg text-left">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-[11px] text-slate-400 font-medium">Cupons Gravados</div>
                  <div className="text-lg font-black text-teal-700 font-mono mt-0.5">
                    {progress.imported.toLocaleString('pt-BR')}
                  </div>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-[11px] text-slate-400 font-medium">Novos Clientes</div>
                  <div className="text-lg font-black text-slate-800 font-mono mt-0.5">
                    {progress.newCustomers.toLocaleString('pt-BR')}
                  </div>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-[11px] text-slate-400 font-medium">Clientes Vinculados</div>
                  <div className="text-lg font-black text-slate-800 font-mono mt-0.5">
                    {progress.linkedCustomers.toLocaleString('pt-BR')}
                  </div>
                </div>

                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-[11px] text-slate-400 font-medium">Itens de Venda</div>
                  <div className="text-lg font-black text-slate-800 font-mono mt-0.5">
                    {progress.itemsProcessed.toLocaleString('pt-BR')}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Summary & Diagnostic Pipeline */}
          {step === 4 && importSummary && (
            <div className="space-y-6">
              {/* Alert or Success Banner */}
              {importSummary.persistedCount === 0 ? (
                <div className="p-4 bg-rose-50 border-2 border-rose-300 rounded-2xl flex items-start gap-3.5 text-rose-900">
                  <AlertTriangle className="w-6 h-6 text-rose-600 shrink-0 mt-0.5" />
                  <div className="space-y-1 text-xs">
                    <div className="text-sm font-black text-rose-800">
                      ⚠️ Leitura Realizada, mas Nenhum Cupom foi Gravado no Firestore
                    </div>
                    <div>
                      O arquivo foi analisado com sucesso, mas a gravação no banco de dados falhou.
                      {importSummary.lastErrorMessage && (
                        <div className="mt-1 p-2 bg-rose-100/70 rounded-lg font-mono text-[11px] text-rose-900 break-all">
                          {importSummary.lastErrorMessage}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-emerald-50 border-2 border-emerald-300 rounded-2xl flex items-start gap-3.5 text-emerald-900">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="space-y-1 text-xs">
                    <div className="text-sm font-black text-emerald-800">
                      Importação de Vendas do PDV Concluída com Sucesso!
                    </div>
                    <div>
                      Foram gravados <strong>{importSummary.persistedCount.toLocaleString('pt-BR')}</strong> cupons fiscais no Firestore. 
                      {importSummary.newCustomersCount > 0 && (
                        <span> <strong>{importSummary.newCustomersCount.toLocaleString('pt-BR')}</strong> novos clientes foram cadastrados e vinculados.</span>
                      )}
                      {importSummary.linkedCustomersCount > 0 && (
                        <span> <strong>{importSummary.linkedCustomersCount.toLocaleString('pt-BR')}</strong> clientes existentes tiveram seu histórico de compras atualizado.</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Diagnostic 10-Stage Pipeline Overview */}
              <div className="border border-slate-200 rounded-2xl bg-white p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <div className="text-xs font-black text-slate-800 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-teal-600" />
                    <span>Diagnóstico de Execução das 10 Etapas</span>
                  </div>
                  <span className="text-[11px] text-slate-400 font-medium">Pipeline Seguro PDV</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <span className="text-slate-600">ETAPA 1: Arquivo selecionado</span>
                    <span className="font-bold text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> OK ({parseResult?.fileName || 'PDV'})
                    </span>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <span className="text-slate-600">ETAPA 2: Arquivo XLSX/CSV aberto</span>
                    <span className="font-bold text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> OK (Lido com sucesso)
                    </span>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <span className="text-slate-600">ETAPA 3: Planilha encontrada</span>
                    <span className="font-bold text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> OK (Aba {parseResult?.sheetName})
                    </span>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <span className="text-slate-600">ETAPA 4: Cabeçalho identificado</span>
                    <span className="font-bold text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> OK (Linha {parseResult?.headerRowNumber})
                    </span>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <span className="text-slate-600">ETAPA 5: Cupons fiscais agrupados</span>
                    <span className="font-bold text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> OK ({importSummary.totalFound} cupons)
                    </span>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <span className="text-slate-600">ETAPA 6: Validação de CPFs e valores</span>
                    <span className="font-bold text-emerald-600 flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> OK ({importSummary.itemsProcessedCount} itens)
                    </span>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <span className="text-slate-600">ETAPA 7: Teste 1º cupom Firestore</span>
                    {importSummary.stageSummary.dbWriteSuccess || importSummary.persistedCount > 0 ? (
                      <span className="font-bold text-emerald-600 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Gravado com sucesso
                      </span>
                    ) : (
                      <span className="font-bold text-rose-600 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> Falha no teste
                      </span>
                    )}
                  </div>

                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <span className="text-slate-600">ETAPA 8: Lotes de 200 cupons</span>
                    <span className={`font-bold flex items-center gap-1 ${importSummary.batchesSucceeded > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                      <CheckCircle2 className="w-3.5 h-3.5" /> {importSummary.batchesSucceeded} concluído(s)
                    </span>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <span className="text-slate-600">ETAPA 9: Cupons persistidos</span>
                    <span className={`font-bold flex items-center gap-1 ${importSummary.persistedCount > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {importSummary.persistedCount > 0 ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                      {importSummary.persistedCount.toLocaleString('pt-BR')} no Firestore
                    </span>
                  </div>

                  <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-between">
                    <span className="text-slate-600">ETAPA 10: Vendas & CRM sincronizados</span>
                    <span className={`font-bold flex items-center gap-1 ${importSummary.persistedCount > 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                      <CheckCircle2 className="w-3.5 h-3.5" /> Sincronizado
                    </span>
                  </div>
                </div>
              </div>

              {/* Statistics Cards (10 cards in 5x2 grid) */}
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-700">Relatório Consolidado da Importação</div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl shadow-2xs">
                    <div className="text-[10px] text-slate-500 font-semibold mb-0.5">Recebidos</div>
                    <div className="text-lg font-black text-slate-800 font-mono">
                      {importSummary.totalFound.toLocaleString('pt-BR')}
                    </div>
                    <span className="text-[9px] text-slate-400">no arquivo PDV</span>
                  </div>

                  <div className="p-3 bg-blue-50/50 border border-blue-200 rounded-xl shadow-2xs">
                    <div className="text-[10px] text-blue-800 font-semibold mb-0.5">Válidos</div>
                    <div className="text-lg font-black text-blue-700 font-mono">
                      {(importSummary.validCount ?? (importSummary.totalFound - (importSummary.ignoredCount || 0))).toLocaleString('pt-BR')}
                    </div>
                    <span className="text-[9px] text-blue-600">valores &gt; R$ 0</span>
                  </div>

                  <div className="p-3 bg-teal-50/50 border border-teal-200 rounded-xl shadow-2xs">
                    <div className="text-[10px] text-teal-800 font-semibold mb-0.5">Realmente gravados</div>
                    <div className="text-lg font-black text-teal-700 font-mono">
                      {importSummary.persistedCount.toLocaleString('pt-BR')}
                    </div>
                    <span className="text-[9px] text-teal-600">no Firestore</span>
                  </div>

                  <div className="p-3 bg-amber-50/50 border border-amber-200 rounded-xl shadow-2xs">
                    <div className="text-[10px] text-amber-800 font-semibold mb-0.5">Duplicadas (ignoradas)</div>
                    <div className="text-lg font-black text-amber-700 font-mono">
                      {(importSummary.duplicatesCount || 0).toLocaleString('pt-BR')}
                    </div>
                    <span className="text-[9px] text-amber-600">já existiam</span>
                  </div>

                  <div className="p-3 bg-emerald-50/50 border border-emerald-200 rounded-xl shadow-2xs">
                    <div className="text-[10px] text-emerald-800 font-semibold mb-0.5">Novos clientes</div>
                    <div className="text-lg font-black text-emerald-700 font-mono">
                      {importSummary.newCustomersCount.toLocaleString('pt-BR')}
                    </div>
                    <span className="text-[9px] text-emerald-600">criados no Firestore</span>
                  </div>

                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl shadow-2xs">
                    <div className="text-[10px] text-slate-500 font-semibold mb-0.5">Clientes atualizados</div>
                    <div className="text-lg font-black text-slate-700 font-mono">
                      {importSummary.linkedCustomersCount.toLocaleString('pt-BR')}
                    </div>
                    <span className="text-[9px] text-slate-400">métricas sincronizadas</span>
                  </div>

                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl shadow-2xs">
                    <div className="text-[10px] text-slate-500 font-semibold mb-0.5">Itens de venda</div>
                    <div className="text-lg font-black text-slate-700 font-mono">
                      {importSummary.itemsProcessedCount.toLocaleString('pt-BR')}
                    </div>
                    <span className="text-[9px] text-slate-400">linhas processadas</span>
                  </div>

                  <div className="p-3 bg-rose-50/40 border border-rose-200 rounded-xl shadow-2xs">
                    <div className="text-[10px] text-rose-800 font-semibold mb-0.5">Erros / Inconsistências</div>
                    <div className="text-lg font-black text-rose-700 font-mono">
                      {importSummary.errorsCount.toLocaleString('pt-BR')}
                    </div>
                    <span className="text-[9px] text-rose-500">linhas com falha</span>
                  </div>

                  <div className="p-3 bg-emerald-50/40 border border-emerald-200 rounded-xl shadow-2xs">
                    <div className="text-[10px] text-emerald-800 font-semibold mb-0.5">Lotes concluídos</div>
                    <div className="text-lg font-black text-emerald-700 font-mono">
                      {importSummary.batchesSucceeded || 0}
                    </div>
                    <span className="text-[9px] text-emerald-600">lotes de 200 docs</span>
                  </div>

                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl shadow-2xs">
                    <div className="text-[10px] text-slate-500 font-semibold mb-0.5">Lotes com erro</div>
                    <div className={`text-lg font-black font-mono ${importSummary.batchesFailed > 0 ? 'text-rose-600' : 'text-slate-700'}`}>
                      {importSummary.batchesFailed || 0}
                    </div>
                    <span className="text-[9px] text-slate-400">falhas de conexão</span>
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
                            <th className="pb-1.5">Cupom Fiscal</th>
                            <th className="pb-1.5">Motivo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                          {importSummary.errorsList.slice(0, 100).map((err, i) => (
                            <tr key={i} className="text-slate-700">
                              <td className="py-1 font-mono text-slate-500">Linha {err.rowNumber}</td>
                              <td className="py-1 font-medium">{err.receiptNo || 'Não identificado'}</td>
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
                  <span>Nenhum cupom apresentou erro de importação. Todos os dados foram processados com sucesso.</span>
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
                Formato: .xlsx, .xls ou .csv com colunas de PDV/Vendas
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
                disabled={Boolean(importBlockReason)}
                title={importBlockReason || undefined}
                className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-md shadow-teal-600/20 transition-all hover:scale-[1.01] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:bg-teal-600"
              >
                <span>
                  {unresolvedStoreCount > 0
                    ? (importBlockReason
                        ? (hasMultipleUnrecognizedStores ? 'Importe um arquivo por loja' : 'Selecione a loja para importar')
                        : 'Importar Vendas')
                    : `Importar Vendas (${parseResult?.totalReceiptsCount.toLocaleString('pt-BR')} cupons)`}
                </span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </>
          )}

          {step === 3 && (
            <div className="w-full flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Processando lotes de cupons fiscais no Firestore...
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
                    className="flex items-center gap-1.5 px-6 py-2.5 bg-teal-600 hover:bg-teal-700 text-white font-bold text-xs rounded-xl shadow-md shadow-teal-600/20 transition-all"
                  >
                    <ShoppingCart className="w-4 h-4" />
                    <span>Ver Vendas no CRM</span>
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
