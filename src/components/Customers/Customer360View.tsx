import React, { useState, useMemo, useEffect } from 'react';
import { 
  ArrowLeft, 
  User, 
  Phone, 
  MessageSquare, 
  Mail, 
  MapPin, 
  Calendar, 
  ShoppingBag, 
  CreditCard, 
  Crown, 
  Award, 
  Sparkles, 
  FileText, 
  Headphones, 
  ShieldCheck, 
  Clock, 
  DollarSign, 
  Package, 
  Layers, 
  ChevronRight, 
  Plus, 
  Check, 
  AlertCircle, 
  Send,
  Ticket,
  Bot,
  Zap,
  Lock,
  RefreshCw,
  Loader2,
  UserX
} from 'lucide-react';
import { 
  ResponsiveContainer, 
  BarChart, 
  Bar, 
  PieChart, 
  Pie, 
  Cell, 
  XAxis, 
  YAxis, 
  Tooltip, 
  CartesianGrid 
} from 'recharts';
import { useCRM } from '../../context/CRMContext';
import { getRecordStoreId, getStoreLabel } from '../../services/storeAndLocationData';
import { apiFetch } from '../../services/api';
import { Customer, Purchase, Interaction, InteractionType, InteractionChannel, ProductSummary, CategorySummary } from '../../types/crm';
import { getRFMSegmentDetails } from '../../services/rfmCalculator';
import { generateNextBestActions } from '../../services/nbaEngine';
import { getCustomerById, getPurchasesByCustomerId } from '../../services/firestoreService';
import { canEditCustomer } from '../../utils/permissions';

export const Customer360View: React.FC = () => {
  const { 
    selectedCustomerId, 
    setCurrentView, 
    customers, 
    purchases, 
    interactions, 
    campaigns, 
    coupons,
    clubOffers,
    clubOfferUsages,
    currentUser, 
    handleSaveInteraction,
    handleAnonymizeCustomer,
    handleToggleCustomerClubStatus,
    showToast,
    isLoading 
  } = useCRM();

  const [activeTab, setActiveTab] = useState<
    'overview' | 'purchases' | 'products' | 'categories' | 'support' | 'loyalty' | 'campaigns' | 'activities' | 'ai'
  >('overview');

  const [isAIAnalyzing, setIsAIAnalyzing] = useState(false);
  const [aiAnalysisResult, setAiAnalysisResult] = useState<any>(null);

  // New Support Ticket Form State
  const [isAddingTicket, setIsAddingTicket] = useState(false);
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketChannel, setTicketChannel] = useState<InteractionChannel>('WhatsApp');
  const [ticketType, setTicketType] = useState<InteractionType>('dúvida');
  const [ticketDescription, setTicketDescription] = useState('');
  const [ticketResolution, setTicketResolution] = useState('');
  const [ticketStatus, setTicketStatus] = useState<'Aberto' | 'Em Análise' | 'Concluído'>('Concluído');

  // Recuperação cirúrgica do cliente solicitado: NUNCA usar customers[0] como fallback
  const [fetchedCustomer, setFetchedCustomer] = useState<Customer | null>(null);
  const [isLoadingCustomer, setIsLoadingCustomer] = useState(false);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [extraPurchases, setExtraPurchases] = useState<Purchase[]>([]);

  // 1. Verificar se o cliente solicitado já está na lista em memória
  const inMemoryCustomer = useMemo(() => {
    if (!selectedCustomerId) return null;
    return customers.find(c => c.id === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  // 2. Se houver selectedCustomerId e não estiver na memória, consultar individualmente no Firestore
  useEffect(() => {
    if (!selectedCustomerId) {
      setFetchedCustomer(null);
      setIsLoadingCustomer(false);
      setCustomerError(null);
      return;
    }

    if (inMemoryCustomer) {
      setFetchedCustomer(null);
      setIsLoadingCustomer(false);
      setCustomerError(null);
      return;
    }

    let isMounted = true;
    setIsLoadingCustomer(true);
    setCustomerError(null);

    getCustomerById(selectedCustomerId)
      .then(result => {
        if (!isMounted) return;
        setFetchedCustomer(result);
        setIsLoadingCustomer(false);
      })
      .catch(err => {
        if (!isMounted) return;
        console.error(`[Customer360] Erro ao consultar cliente ${selectedCustomerId}:`, err);
        setCustomerError(err?.message || 'Falha ao consultar os dados do cliente no banco de dados.');
        setFetchedCustomer(null);
        setIsLoadingCustomer(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedCustomerId, inMemoryCustomer]);

  // Cliente definitivo estritamente validado: id === selectedCustomerId
  const customer: Customer | null = inMemoryCustomer || fetchedCustomer;

  // Carregar compras remotas caso o cliente não tenha compras em memória
  useEffect(() => {
    if (!customer) {
      setExtraPurchases([]);
      return;
    }

    const hasLocal = purchases.some(p => p.customerId === customer.id || (customer.cpf && p.customerCpf === customer.cpf));
    if (hasLocal) {
      setExtraPurchases([]);
      return;
    }

    let isMounted = true;
    getPurchasesByCustomerId(customer.id)
      .then(remote => {
        if (isMounted) setExtraPurchases(remote);
      })
      .catch(err => {
        console.warn(`[Customer360] Erro ao buscar compras do cliente ${customer.id}:`, err);
      });

    return () => {
      isMounted = false;
    };
  }, [customer, purchases]);

  const customerPurchases: Purchase[] = useMemo(() => {
    if (!customer) return [];
    const local = purchases.filter(p => p.customerId === customer.id || (customer.cpf && p.customerCpf === customer.cpf));
    const combined = local.length > 0 ? local : extraPurchases;
    return [...combined].sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime());
  }, [purchases, extraPurchases, customer]);

  const customerInteractions: Interaction[] = useMemo(() => {
    if (!customer) return [];
    return interactions
      .filter(i => i.customerId === customer.id)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [interactions, customer]);

  // Aggregate Top Products for this Customer
  const topProducts: ProductSummary[] = useMemo(() => {
    const map = new Map<string, ProductSummary>();
    customerPurchases.forEach(p => {
      p.items.forEach(item => {
        const existing = map.get(item.sku);
        if (existing) {
          existing.totalQuantity += item.quantity;
          existing.totalRevenue += item.totalPrice;
          existing.purchaseCount += 1;
        } else {
          map.set(item.sku, {
            sku: item.sku,
            name: item.productName,
            category: item.category,
            totalQuantity: item.quantity,
            totalRevenue: item.totalPrice,
            averagePrice: item.unitPrice,
            purchaseCount: 1,
            lastPurchasedDate: p.purchaseDate
          });
        }
      });
    });
    return Array.from(map.values()).sort((a, b) => b.totalRevenue - a.totalRevenue);
  }, [customerPurchases]);

  // Aggregate Top Categories
  const topCategories: CategorySummary[] = useMemo(() => {
    const map = new Map<string, { totalRevenue: number; totalItems: number; purchaseCount: number }>();
    let grandTotal = 0;
    
    customerPurchases.forEach(p => {
      p.items.forEach(item => {
        grandTotal += item.totalPrice;
        const current = map.get(item.category) || { totalRevenue: 0, totalItems: 0, purchaseCount: 0 };
        current.totalRevenue += item.totalPrice;
        current.totalItems += item.quantity;
        current.purchaseCount += 1;
        map.set(item.category, current);
      });
    });

    return Array.from(map.entries()).map(([category, data]) => ({
      category,
      totalRevenue: parseFloat(data.totalRevenue.toFixed(2)),
      totalItems: parseFloat(data.totalItems.toFixed(1)),
      purchaseCount: data.purchaseCount,
      percentOfTotal: grandTotal > 0 ? parseFloat(((data.totalRevenue / grandTotal) * 100).toFixed(1)) : 0
    })).sort((a, b) => b.totalRevenue - a.totalRevenue);
  }, [customerPurchases]);

  // NBA for this customer
  const customerNBA = useMemo(() => {
    if (!customer) return null;
    const actions = generateNextBestActions([customer], customerPurchases, coupons);
    return actions.length > 0 ? actions[0] : null;
  }, [customer, customerPurchases, coupons]);

  const handleAnalyzeWithAI = async () => {
    if (!customer) return;
    setIsAIAnalyzing(true);
    try {
      const res = await apiFetch('/api/ai/analyze-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer,
          purchases: customerPurchases.slice(0, 8),
          topCategories: topCategories.slice(0, 5),
          topProducts: topProducts.slice(0, 6),
          loyalty: { balance: customer.loyaltyPoints }
        })
      });

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Sessão expirada ou não autenticada. Faça login novamente.');
        }
        if (res.status === 403) {
          throw new Error('Acesso negado: Sua conta não possui autorização ativa para gerar diagnóstico de IA.');
        }
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Não foi possível obter resposta da IA. Tente novamente.');
      }

      const data = await res.json();
      setAiAnalysisResult(data);
      setActiveTab('ai');
      showToast('Diagnóstico com IA Gemini concluído!', 'success');
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Erro ao gerar análise de IA', 'error');
    } finally {
      setIsAIAnalyzing(false);
    }
  };

  const handleCreateTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer || !ticketSubject.trim()) return;

    const newTicket: Interaction = {
      id: `int-${Date.now()}`,
      customerId: customer.id,
      customerName: customer.name,
      date: new Date().toISOString(),
      employeeName: currentUser.name,
      employeeEmail: currentUser.email,
      channel: ticketChannel,
      type: ticketType,
      subject: ticketSubject.trim(),
      description: ticketDescription.trim() || 'Atendimento registrado no Cliente 360',
      resolution: ticketResolution.trim() || undefined,
      status: ticketStatus,
      // Loja real do cliente (identificada pela loja física); sem loja conhecida fica vazio, não "Super Astral"
      storeName: (() => {
        const sid = getRecordStoreId(customer.favoriteStoreId, customer.favoriteStoreName);
        return (sid && getStoreLabel(sid)) || customer.favoriteStoreName || undefined;
      })(),
      createdAt: new Date().toISOString()
    };

    await handleSaveInteraction(newTicket);
    setIsAddingTicket(false);
    setTicketSubject('');
    setTicketDescription('');
    setTicketResolution('');
  };

  const isScreenLoading = isLoadingCustomer || (isLoading && Boolean(selectedCustomerId) && !customer);

  // ESTADO 1: CARREGANDO (cliente ainda carregando)
  if (isScreenLoading) {
    return (
      <div className="p-12 flex flex-col items-center justify-center min-h-[420px] text-center">
        <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center mb-4">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
        </div>
        <h3 className="text-base font-bold text-slate-800">Carregando Perfil do Cliente 360°...</h3>
        <p className="text-xs text-slate-500 mt-1 max-w-sm">
          {selectedCustomerId ? (
            <>
              Buscando dados e transações do cliente ID <span className="font-mono text-slate-700 font-semibold">{selectedCustomerId}</span> no banco de dados.
            </>
          ) : (
            'Consultando base de dados...'
          )}
        </p>
      </div>
    );
  }

  // ESTADO 2: ERRO DE CONSULTA
  if (customerError) {
    return (
      <div className="p-12 flex flex-col items-center justify-center min-h-[420px] text-center">
        <div className="w-12 h-12 rounded-2xl bg-rose-50 flex items-center justify-center mb-4 text-rose-600">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-slate-800">Erro ao Consultar Cliente</h3>
        <p className="text-xs text-rose-600 mt-2 max-w-md bg-rose-50 border border-rose-100 p-3 rounded-xl font-mono">
          {customerError}
        </p>
        <div className="flex items-center gap-3 mt-6">
          <button
            onClick={() => {
              if (selectedCustomerId) {
                setIsLoadingCustomer(true);
                setCustomerError(null);
                getCustomerById(selectedCustomerId)
                  .then(c => {
                    setFetchedCustomer(c);
                    setIsLoadingCustomer(false);
                  })
                  .catch(err => {
                    setCustomerError(err?.message || 'Falha ao consultar cliente.');
                    setIsLoadingCustomer(false);
                  });
              }
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Tentar Novamente
          </button>
          <button
            onClick={() => setCurrentView('customers')}
            className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors"
          >
            Voltar para Clientes
          </button>
        </div>
      </div>
    );
  }

  // ESTADO 3: CLIENTE SOLICITADO NÃO ENCONTRADO (Nunca fallback para customers[0])
  if (!customer) {
    return (
      <div className="p-12 flex flex-col items-center justify-center min-h-[420px] text-center">
        <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center mb-4 text-amber-600">
          <UserX className="w-6 h-6" />
        </div>
        <h3 className="text-base font-bold text-slate-800">Cliente Não Encontrado</h3>
        <p className="text-xs text-slate-500 mt-2 max-w-md">
          {selectedCustomerId ? (
            <>
              O cliente com identificador <span className="font-mono text-slate-700 font-semibold">{selectedCustomerId}</span> não foi localizado no cadastro ou foi removido.
            </>
          ) : (
            'Nenhum identificador de cliente foi selecionado para visualização no perfil 360°.'
          )}
        </p>
        <button
          onClick={() => setCurrentView('customers')}
          className="mt-6 flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-xs"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Voltar para Lista de Clientes
        </button>
      </div>
    );
  }

  const rfmDetails = getRFMSegmentDetails(customer.rfmSegment);

  const categoryChartColors = ['#10b981', '#3b82f6', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#64748b'];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Back button & Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setCurrentView('customers')}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white hover:bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl shadow-xs transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar para Clientes
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={handleAnalyzeWithAI}
            disabled={isAIAnalyzing}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white text-xs font-bold rounded-xl shadow-md shadow-emerald-600/20 transition-all"
          >
            <Bot className={`w-4 h-4 ${isAIAnalyzing ? 'animate-spin' : ''}`} />
            {isAIAnalyzing ? 'Analisando com Gemini...' : 'Analisar Cliente com IA'}
          </button>
        </div>
      </div>

      {/* 360 Header Profile Card with 9 Required Header KPIs */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-slate-100">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-slate-900 to-slate-800 text-white font-black text-2xl flex items-center justify-center shadow-lg shadow-slate-900/10">
              {customer.isAnonymized ? '🔒' : customer.name.charAt(0)}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-black text-slate-900">
                  {customer.name}
                </h1>
                <span className={`inline-flex items-center gap-1 px-3 py-0.5 rounded-full text-xs font-bold border ${rfmDetails.badgeColor}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${rfmDetails.dotColor}`}></span>
                  {customer.rfmSegment}
                </span>
                {customer.tags?.map(t => (
                  <span key={t} className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md">
                    {t}
                  </span>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mt-2 font-medium">
                <span className="flex items-center gap-1">
                  <CreditCard className="w-3.5 h-3.5 text-slate-400" />
                  CPF: <span className="font-mono text-slate-700 font-semibold">{customer.cpf}</span>
                </span>
                <span className="flex items-center gap-1">
                  <MessageSquare className="w-3.5 h-3.5 text-teal-600" />
                  WhatsApp: <span className="text-slate-700 font-semibold">{customer.isAnonymized ? 'Anonimizado' : (customer.whatsapp || 'Não informado')}</span>
                </span>
                {customer.email && !customer.isAnonymized && (
                  <span className="flex items-center gap-1">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    {customer.email}
                  </span>
                )}
                {customer.birthDate && !customer.isAnonymized && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    Nascimento: {customer.birthDate.split('-').reverse().join('/')}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  {customer.isAnonymized
                    ? 'Localização Anonimizada (LGPD)'
                    : ([customer.neighborhood, [customer.city, customer.state].filter(Boolean).join(' - ')].filter(Boolean).join(', ') || 'Endereço não informado')}
                </span>
              </div>
            </div>
          </div>

          {/* Quick Loyalty Card */}
          <div className="bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-200 p-4 rounded-xl flex items-center gap-4 shrink-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center">
              <Award className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                  Fidelidade Clube
                </span>
                <span className={`text-[10px] px-2 py-0.2 rounded-full font-bold ${
                  customer.isClubMember !== false ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'
                }`}>
                  {customer.isClubMember !== false ? 'Membro Ativo' : 'Inativo'}
                </span>
              </div>
              <div className="text-lg font-black text-emerald-950 mt-0.5">
                R$ {(customer.clubTotalSavings || 0).toFixed(2)}{' '}
                <span className="text-xs font-normal text-emerald-700">economizados</span>
              </div>
              <div className="text-[11px] text-emerald-700 font-medium">
                {customer.clubOffersUsedCount || 0} compras com Preço Clube
              </div>
            </div>
          </div>
        </div>

        {/* 9 Header KPI Cards Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 pt-4">
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
            <div className="text-[11px] text-slate-500 font-medium">Gasto Total (Histórico)</div>
            <div className="text-base font-bold text-slate-900 mt-0.5">
              R$ {customer.totalSpent.toFixed(2)}
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
            <div className="text-[11px] text-slate-500 font-medium">Compras Totais (Histórico)</div>
            <div className="text-base font-bold text-slate-900 mt-0.5">
              {customer.totalPurchases} cupons fiscais
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
            <div className="text-[11px] text-slate-500 font-medium">Ticket Médio</div>
            <div className="text-base font-bold text-slate-900 mt-0.5">
              R$ {customer.averageTicket.toFixed(2)}
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
            <div className="text-[11px] text-slate-500 font-medium">Dias sem Comprar</div>
            <div className={`text-base font-bold mt-0.5 ${
              customer.daysSinceLastPurchase <= 15 ? 'text-emerald-600' :
              customer.daysSinceLastPurchase <= 30 ? 'text-blue-600' :
              customer.daysSinceLastPurchase <= 60 ? 'text-amber-600' : 'text-rose-600'
            }`}>
              {customer.daysSinceLastPurchase} dias
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 col-span-2 sm:col-span-1">
            <div className="text-[11px] text-slate-500 font-medium">Score RFM</div>
            <div className="text-base font-mono font-bold text-emerald-700 mt-0.5">
              R:{customer.recencyScore} F:{customer.frequencyScore} M:{customer.monetaryScore}
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-slate-200 bg-white px-4 rounded-xl shadow-xs">
        <nav className="flex space-x-1 sm:space-x-6 overflow-x-auto text-xs font-semibold">
          {[
            { id: 'overview', label: 'Visão Geral', icon: User },
            { id: 'purchases', label: `Compras (${customerPurchases.length})`, icon: ShoppingBag },
            { id: 'products', label: `Produtos (${topProducts.length})`, icon: Package },
            { id: 'categories', label: `Categorias (${topCategories.length})`, icon: Layers },
            { id: 'support', label: `Atendimento & SAC (${customerInteractions.length})`, icon: Headphones },
            { id: 'loyalty', label: 'Fidelidade Clube', icon: Award },
            { id: 'campaigns', label: 'Campanhas & Cupons', icon: Ticket },
            { id: 'activities', label: 'Atividades & LGPD', icon: ShieldCheck },
            { id: 'ai', label: 'Diagnóstico IA Gemini', icon: Bot, isSpecial: true }
          ].map(tab => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`py-3 px-2 border-b-2 flex items-center gap-1.5 whitespace-nowrap transition-all ${
                  isActive
                    ? 'border-emerald-600 text-emerald-700 font-bold'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                } ${tab.isSpecial ? 'text-teal-600' : ''}`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* TAB 1: VISÃO GERAL */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Commercial Summary & NBA */}
          <div className="lg:col-span-2 space-y-6">
            {/* Next Best Action Card */}
            {customerNBA && (
              <div className="bg-gradient-to-r from-emerald-950 via-slate-900 to-slate-900 text-white p-5 rounded-2xl border border-emerald-500/30 shadow-lg relative overflow-hidden">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-400 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" />
                    Próxima Melhor Ação Recomendada (NBA)
                  </span>
                  <span className="text-[10px] font-bold bg-emerald-500 text-slate-950 px-2 py-0.5 rounded-full">
                    Prioridade {customerNBA.urgency}
                  </span>
                </div>

                <h3 className="text-base font-bold text-white mt-1">
                  {customerNBA.reason}
                </h3>
                <p className="text-xs text-slate-300 mt-1">
                  <span className="text-emerald-300 font-semibold">Evidência:</span> {customerNBA.evidence}
                </p>

                <div className="mt-3 p-3 rounded-xl bg-slate-800/80 border border-slate-700 text-xs text-emerald-200 font-medium">
                  ✦ {customerNBA.recommendedAction}
                </div>

                {customerNBA.suggestedCouponCode && (
                  <div className="mt-3 flex items-center gap-2 text-xs">
                    <span className="text-slate-400">Cupom Sugerido:</span>
                    <span className="font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-2 py-0.5 rounded">
                      {customerNBA.suggestedCouponCode}
                    </span>
                    <span className="text-[11px] text-slate-400">({customerNBA.suggestedOffer})</span>
                  </div>
                )}
              </div>
            )}

            {/* RFM Diagnostics Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <Crown className="w-4 h-4 text-emerald-600" />
                Diagnóstico de Segmentação RFM
              </h3>

              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-center">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Recência (R)</div>
                  <div className="text-2xl font-black text-slate-800 mt-1">{customer.recencyScore} / 5</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{customer.daysSinceLastPurchase} dias atrás</div>
                  <div className="text-[9px] text-slate-400 mt-0.5">Última compra válida</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-center">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Frequência (F)</div>
                  <div className="text-2xl font-black text-slate-800 mt-1">{customer.frequencyScore} / 5</div>
                  <div className="text-[10px] font-semibold text-emerald-700 mt-0.5">
                    {customer.rfmFrequency ?? customer.totalPurchases} compras (últimos {customer.rfmWindowDays || 90}d)
                  </div>
                  <div className="text-[9px] text-slate-400 mt-0.5">Histórico: {customer.totalPurchases} compras</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 text-center">
                  <div className="text-[10px] text-slate-400 uppercase font-bold">Monetário (M)</div>
                  <div className="text-2xl font-black text-slate-800 mt-1">{customer.monetaryScore} / 5</div>
                  <div className="text-[10px] font-semibold text-emerald-700 mt-0.5">
                    R$ {(customer.rfmMonetary ?? customer.totalSpent).toFixed(0)} (últimos {customer.rfmWindowDays || 90}d)
                  </div>
                  <div className="text-[9px] text-slate-400 mt-0.5">Histórico: R$ {customer.totalSpent.toFixed(0)}</div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-100 text-xs text-slate-700">
                <span className="font-bold text-emerald-800">Estratégia Recomendada para {customer.rfmSegment}:</span>{' '}
                {rfmDetails.recommendedAction}
              </div>
            </div>

            {/* Favorite Store & Preferences */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Comportamento de Compra no Super Astral
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <span className="text-slate-400 block">Loja Preferencial:</span>
                  <span className="font-semibold text-slate-800">{(() => {
                      const sid = getRecordStoreId(customer.favoriteStoreId, customer.favoriteStoreName);
                      return (sid && getStoreLabel(sid)) || customer.favoriteStoreName || 'Ainda não identificada';
                    })()}</span>
                </div>
                <div>
                  <span className="text-slate-400 block">Primeira Compra Identificada:</span>
                  <span className="font-semibold text-slate-800">
                    {customer.firstPurchaseDate ? new Date(customer.firstPurchaseDate).toLocaleDateString('pt-BR') : 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Última Compra Identificada:</span>
                  <span className="font-semibold text-slate-800">
                    {customer.lastPurchaseDate ? new Date(customer.lastPurchaseDate).toLocaleDateString('pt-BR') : 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block">Canal de Cadastro:</span>
                  <span className="font-semibold text-slate-800">{customer.origin}</span>
                </div>
              </div>
              {customer.notes && (
                <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700">
                  <span className="font-bold text-slate-900">Observações:</span> {customer.notes}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Mini Category & Channel Opt-in info */}
          <div className="space-y-6">
            {/* Opt-in Status Card */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-teal-600" />
                Consentimentos LGPD
              </h3>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50">
                  <span className="font-medium text-slate-700">WhatsApp Marketing</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    customer.consent?.whatsappMarketing ? 'bg-teal-100 text-teal-800' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {customer.consent?.whatsappMarketing ? 'AUTORIZADO' : 'RECUSADO'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50">
                  <span className="font-medium text-slate-700">E-mail Marketing</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    customer.consent?.emailMarketing ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {customer.consent?.emailMarketing ? 'AUTORIZADO' : 'RECUSADO'}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50">
                  <span className="font-medium text-slate-700">SMS Marketing</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    customer.consent?.smsMarketing ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {customer.consent?.smsMarketing ? 'AUTORIZADO' : 'RECUSADO'}
                  </span>
                </div>
              </div>
              <p className="text-[10px] text-slate-400">
                Finalidade: {customer.consent?.purpose || 'Comunicação e benefícios exclusivos Astral Clube'}
              </p>
            </div>

            {/* Top Categories Mini Box */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Principais Categorias
              </h3>
              <div className="space-y-2">
                {topCategories.slice(0, 4).map((cat, idx) => (
                  <div key={cat.category} className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700">{cat.category}</span>
                    <span className="font-bold text-slate-900">
                      R$ {cat.totalRevenue.toFixed(2)} ({cat.percentOfTotal}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: COMPRAS */}
      {activeTab === 'purchases' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Histórico Completo de Compras no PDV
            </h3>
            <span className="text-xs text-slate-400">
              {customerPurchases.length} cupons fiscais identificados
            </span>
          </div>

          <div className="space-y-3">
            {customerPurchases.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                Nenhuma compra registrada para este cliente ainda.
              </div>
            ) : (
              customerPurchases.map(p => (
                <div key={p.id} className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs font-bold text-slate-800 bg-white px-2 py-1 rounded border border-slate-200">
                        {p.couponReceiptNumber}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(p.purchaseDate).toLocaleString('pt-BR')}
                      </span>
                      <span className="text-xs font-medium text-slate-600">
                        {p.storeName} ({p.posNumber})
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="text-xs font-semibold text-slate-500">
                        Pagamento: {p.paymentMethod}
                      </span>
                      <span className="text-sm font-extrabold text-slate-900">
                        R$ {p.netAmount.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Items List */}
                  <div className="bg-white rounded-lg p-2.5 border border-slate-100">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      Itens do Cupom Fiscal ({p.itemsCount} itens)
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {p.items.map((item, idx) => (
                        <div key={idx} className="text-xs flex justify-between p-1.5 rounded bg-slate-50">
                          <div>
                            <span className="font-medium text-slate-800">{item.productName}</span>
                            <span className="text-[10px] text-slate-400 block">
                              {item.quantity} x R$ {item.unitPrice.toFixed(2)} ({item.category})
                            </span>
                          </div>
                          <span className="font-bold text-slate-800">
                            R$ {item.totalPrice.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 3: PRODUTOS */}
      {activeTab === 'products' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
            Produtos Mais Comprados pelo Cliente (Cesta de Consumo)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5">SKU</th>
                  <th className="px-4 py-2.5">Produto</th>
                  <th className="px-4 py-2.5">Categoria</th>
                  <th className="px-4 py-2.5 text-center">Quantidade Total</th>
                  <th className="px-4 py-2.5 text-center">Frequência</th>
                  <th className="px-4 py-2.5 text-right">Valor Gasto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {topProducts.map(p => (
                  <tr key={p.sku} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-slate-500">{p.sku}</td>
                    <td className="px-4 py-2.5 font-bold text-slate-800">{p.name}</td>
                    <td className="px-4 py-2.5">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">
                        {p.category}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center font-semibold">{p.totalQuantity}</td>
                    <td className="px-4 py-2.5 text-center">{p.purchaseCount}x</td>
                    <td className="px-4 py-2.5 text-right font-bold text-slate-900">
                      R$ {p.totalRevenue.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 4: CATEGORIAS */}
      {activeTab === 'categories' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Gasto por Categoria
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topCategories} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => `R$${v}`} />
                  <YAxis dataKey="category" type="category" tick={{ fontSize: 11, fill: '#64748b' }} width={80} />
                  <Tooltip formatter={(val: any) => [`R$ ${Number(val).toFixed(2)}`, 'Gasto']} />
                  <Bar dataKey="totalRevenue" fill="#10b981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Detalhamento de Categorias
            </h3>
            <div className="space-y-3">
              {topCategories.map((c, i) => (
                <div key={c.category} className="p-3 bg-slate-50 rounded-xl flex items-center justify-between text-xs">
                  <div>
                    <span className="font-bold text-slate-800">{c.category}</span>
                    <span className="text-[11px] text-slate-400 block">{c.purchaseCount} compras ({c.totalItems} itens)</span>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-slate-900">R$ {c.totalRevenue.toFixed(2)}</span>
                    <span className="text-[10px] text-emerald-600 font-semibold block">{c.percentOfTotal}% do total</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: ATENDIMENTO & SAC */}
      {activeTab === 'support' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                Linha do Tempo de Atendimento e SAC
              </h3>
              <p className="text-xs text-slate-400">Dúvidas, reclamações, elogios e solicitações de clientes</p>
            </div>
            <button
              onClick={() => setIsAddingTicket(!isAddingTicket)}
              className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl"
            >
              <Plus className="w-3.5 h-3.5" />
              Novo Atendimento
            </button>
          </div>

          {/* Form to add ticket */}
          {isAddingTicket && (
            <form onSubmit={handleCreateTicket} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <div className="text-xs font-bold text-slate-800">Registrar Interação com Cliente</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Canal</label>
                  <select
                    value={ticketChannel}
                    onChange={e => setTicketChannel(e.target.value as any)}
                    className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg outline-none"
                  >
                    <option value="WhatsApp">WhatsApp</option>
                    <option value="Balcão Loja">Balcão Loja</option>
                    <option value="Telefone">Telefone</option>
                    <option value="E-mail">E-mail</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Tipo</label>
                  <select
                    value={ticketType}
                    onChange={e => setTicketType(e.target.value as any)}
                    className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg outline-none"
                  >
                    <option value="dúvida">Dúvida</option>
                    <option value="reclamação">Reclamação</option>
                    <option value="sugestão">Sugestão</option>
                    <option value="elogio">Elogio</option>
                    <option value="solicitação">Solicitação</option>
                    <option value="devolução">Devolução</option>
                    <option value="troca">Troca</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">Status</label>
                  <select
                    value={ticketStatus}
                    onChange={e => setTicketStatus(e.target.value as any)}
                    className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg outline-none"
                  >
                    <option value="Concluído">Concluído</option>
                    <option value="Em Análise">Em Análise</option>
                    <option value="Aberto">Aberto</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Assunto *</label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Dúvida sobre pontos Astral Clube"
                  value={ticketSubject}
                  onChange={e => setTicketSubject(e.target.value)}
                  className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Descrição</label>
                <textarea
                  rows={2}
                  placeholder="Detalhes do relato do cliente..."
                  value={ticketDescription}
                  onChange={e => setTicketDescription(e.target.value)}
                  className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-700 mb-1">Resolução / Orientação Fornecida</label>
                <input
                  type="text"
                  placeholder="Ex: Orientado sobre resgate de desconto no caixa do PDV."
                  value={ticketResolution}
                  onChange={e => setTicketResolution(e.target.value)}
                  className="w-full text-xs p-2 bg-white border border-slate-200 rounded-lg outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddingTicket(false)}
                  className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded-lg"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg"
                >
                  Salvar Atendimento
                </button>
              </div>
            </form>
          )}

          {/* Timeline */}
          <div className="space-y-4">
            {customerInteractions.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                Nenhum chamado de SAC ou atendimento registrado.
              </div>
            ) : (
              customerInteractions.map(inter => (
                <div key={inter.id} className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                        {inter.type}
                      </span>
                      <span className="text-xs font-bold text-slate-800">{inter.subject}</span>
                      <span className="text-xs text-slate-400">• {inter.channel}</span>
                    </div>
                    <span className="text-[11px] font-semibold text-slate-500">
                      {new Date(inter.date).toLocaleDateString('pt-BR')}
                    </span>
                  </div>

                  <p className="text-xs text-slate-600 bg-white p-2.5 rounded-lg border border-slate-100">
                    {inter.description}
                  </p>

                  {inter.resolution && (
                    <div className="text-xs text-emerald-800 bg-emerald-50 p-2 rounded-lg border border-emerald-100 font-medium">
                      <span className="font-bold">Resolução:</span> {inter.resolution}
                    </div>
                  )}

                  <div className="text-[10px] text-slate-400 flex items-center justify-between pt-1">
                    <span>Atendente: {inter.employeeName}</span>
                    <span className="font-semibold text-slate-600">Status: {inter.status}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 6: FIDELIDADE CLUBE */}
      {activeTab === 'loyalty' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
          {/* Top 3 Member Status & Performance Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-5 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white shadow-lg">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-emerald-100">
                  Status Fidelidade Clube
                </div>
                {canEditCustomer(currentUser.role, customer) && (
                  <button
                    onClick={() => handleToggleCustomerClubStatus(customer.id, customer.isClubMember === false)}
                    className="text-[10px] font-bold bg-white/20 hover:bg-white/30 px-2 py-0.5 rounded transition-colors text-white"
                  >
                    {customer.isClubMember !== false ? 'Desativar' : 'Ativar'}
                  </button>
                )}
              </div>
              <div className="text-2xl font-black mt-2">
                {customer.isClubMember !== false ? '🟢 Membro Ativo' : '⚪ Inativo'}
              </div>
              <p className="text-[11px] text-emerald-100 mt-1">
                Elegível para descontos automáticos de Preço Clube no PDV
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-900 text-white shadow-lg">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Economia Total Acumulada
              </div>
              <div className="text-3xl font-black mt-1 text-emerald-400">
                R$ {(customer.clubTotalSavings || 0).toFixed(2)}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">
                Descontos diretos obtidos pelo cliente no caixa do supermercado
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Compras com Preço Clube
              </div>
              <div className="text-3xl font-black text-slate-800 mt-1">
                {customer.clubOffersUsedCount || 0}{' '}
                <span className="text-xs font-normal text-slate-500">vezes</span>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                Utilização frequente de ofertas exclusivas cadastradas
              </p>
            </div>
          </div>

          {/* Histórico de Ofertas Usadas */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Histórico de Ofertas Preço Clube Utilizadas por Este Cliente
            </h3>

            {clubOfferUsages.filter(u => u.customerId === customer.id).length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-xl border border-slate-100 text-xs text-slate-400">
                Nenhum histórico de utilização de ofertas de Preço Clube registrado para este cliente ainda.
              </div>
            ) : (
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase">
                    <tr>
                      <th className="p-3">Produto / SKU</th>
                      <th className="p-3">Qtd</th>
                      <th className="p-3">Preço Normal</th>
                      <th className="p-3">Preço Clube</th>
                      <th className="p-3 font-bold text-emerald-700">Economia</th>
                      <th className="p-3">Data / PDV</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {clubOfferUsages.filter(u => u.customerId === customer.id).map(usage => (
                      <tr key={usage.id} className="hover:bg-slate-50">
                        <td className="p-3">
                          <strong className="text-slate-900 block">{usage.productName}</strong>
                          <span className="text-[10px] text-slate-400 font-mono">{usage.productSku} • {usage.productCategory}</span>
                        </td>
                        <td className="p-3 font-mono font-semibold">{usage.quantity}x</td>
                        <td className="p-3 font-mono text-slate-400 line-through">R$ {usage.normalPrice.toFixed(2)}</td>
                        <td className="p-3 font-mono font-bold text-emerald-700">R$ {usage.clubPrice.toFixed(2)}</td>
                        <td className="p-3 font-mono font-extrabold text-emerald-600 bg-emerald-50/50">
                          -R$ {usage.totalSavings.toFixed(2)}
                        </td>
                        <td className="p-3 text-slate-500 text-[11px]">
                          {new Date(usage.usedAt).toLocaleDateString('pt-BR')} {new Date(usage.usedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                          <span className="block text-[10px] text-slate-400">{usage.posNumber} • {usage.storeName}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Ofertas Disponíveis para este Cliente */}
          <div className="space-y-3 pt-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Ofertas Ativas do Clube Disponíveis no PDV
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {clubOffers.filter(o => o.status === 'Ativa').slice(0, 4).map(offer => (
                <div key={offer.id} className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between">
                  <div>
                    <strong className="text-xs text-slate-900 block">{offer.productName}</strong>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs font-mono text-slate-400 line-through">R$ {offer.normalPrice.toFixed(2)}</span>
                      <span className="text-xs font-mono font-bold text-emerald-700">R$ {offer.clubPrice.toFixed(2)}</span>
                      <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-1.5 py-0.2 rounded">
                        -{offer.discountPercent.toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-500 bg-white px-2 py-1 rounded border border-slate-200">
                    {offer.unitLimitPerCustomer ? `Até ${offer.unitLimitPerCustomer} un.` : 'Ilimitado'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 7: CAMPANHAS & CUPONS */}
      {activeTab === 'campaigns' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
            Campanhas e Cupons Recebidos pelo Cliente
          </h3>

          <div className="space-y-3">
            {campaigns.slice(0, 3).map(camp => (
              <div key={camp.id} className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-slate-800">{camp.name}</span>
                    <span className="text-[10px] bg-teal-100 text-teal-800 font-bold px-2 py-0.5 rounded">
                      {camp.channel}
                    </span>
                  </div>
                  <span className="text-xs font-semibold text-emerald-600">
                    Status: {camp.status}
                  </span>
                </div>
                <p className="text-xs text-slate-600 bg-white p-2.5 rounded border border-slate-100">
                  {camp.message.replace('{nome}', customer.name.split(' ')[0]).replace('{cupom}', camp.couponCode || '')}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 8: ATIVIDADES & LGPD */}
      {activeTab === 'activities' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">
              Linha do Tempo de Atividades & Conformidade LGPD
            </h3>
            {currentUser.role === 'admin' && !customer.isAnonymized && (
              <button
                onClick={() => {
                  if (confirm(`Deseja anonimizar os dados de ${customer.name}? Esta ação é irreversível conforme a LGPD.`)) {
                    handleAnonymizeCustomer(customer.id);
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 text-xs font-bold rounded-xl"
              >
                <Lock className="w-3.5 h-3.5" />
                Anonimizar Titular (Direito ao Esquecimento)
              </button>
            )}
          </div>

          <div className="space-y-3">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
              <div className="font-bold text-slate-800">Origem do Cadastro</div>
              <div className="text-slate-600">
                Cadastrado em {new Date(customer.createdAt).toLocaleString('pt-BR')} via {customer.origin}.
              </div>
            </div>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs space-y-1">
              <div className="font-bold text-slate-800">Termo de Consentimento para Marketing</div>
              <div className="text-slate-600">
                Status: {customer.consent?.whatsappMarketing ? 'Opt-in ATIVO' : 'Opt-out (Sem envio)'} • 
                Atualizado em: {customer.consent?.lastUpdated ? new Date(customer.consent.lastUpdated).toLocaleString('pt-BR') : 'N/A'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 9: DIAGNÓSTICO IA GEMINI */}
      {activeTab === 'ai' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-emerald-600" />
              <div>
                <h3 className="text-base font-bold text-slate-800">
                  Diagnóstico Inteligente do Cliente com Gemini
                </h3>
                <p className="text-xs text-slate-400">
                  Análise gerada exclusivamente a partir dos dados reais do Super Astral
                </p>
              </div>
            </div>

            <button
              onClick={handleAnalyzeWithAI}
              disabled={isAIAnalyzing}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200 text-xs font-semibold rounded-xl"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isAIAnalyzing ? 'animate-spin' : ''}`} />
              Reanalisar
            </button>
          </div>

          {!aiAnalysisResult ? (
            <div className="p-12 text-center space-y-3">
              <Sparkles className="w-8 h-8 text-emerald-600 mx-auto" />
              <p className="text-xs text-slate-600 max-w-md mx-auto">
                Clique no botão abaixo para que o Gemini analise o histórico de compras, categorias, propensão de churn e recomende a próxima ação comercial personalizada.
              </p>
              <button
                onClick={handleAnalyzeWithAI}
                disabled={isAIAnalyzing}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-600/20"
              >
                {isAIAnalyzing ? 'Analisando dados do cliente...' : 'Gerar Análise 360 com Gemini'}
              </button>
            </div>
          ) : (
            <div className="space-y-6 animate-in fade-in duration-200">
              {/* Summary */}
              <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-xl">
                <div className="text-xs font-bold uppercase tracking-wider text-emerald-800 mb-1">
                  Resumo do Perfil de Consumo
                </div>
                <p className="text-xs text-slate-800 leading-relaxed font-medium">
                  {aiAnalysisResult.summary}
                </p>
              </div>

              {/* Buying Behavior & Churn Risk */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Comportamento de Compra
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {aiAnalysisResult.buyingBehavior}
                  </p>
                </div>

                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-bold uppercase tracking-wider text-slate-600">
                      Risco de Churn (Perda)
                    </div>
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      aiAnalysisResult.churnRisk === 'Alto' || aiAnalysisResult.churnRisk === 'Crítico'
                        ? 'bg-rose-100 text-rose-700'
                        : aiAnalysisResult.churnRisk === 'Médio'
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      Risco {aiAnalysisResult.churnRisk}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {aiAnalysisResult.churnReason}
                  </p>
                </div>
              </div>

              {/* Cross-Sell Opportunities */}
              {aiAnalysisResult.crossSellOpportunities && (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Oportunidades de Cross-Sell Identificadas
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {aiAnalysisResult.crossSellOpportunities.map((op: any, i: number) => (
                      <div key={i} className="p-3 bg-white border border-slate-100 rounded-lg text-xs space-y-1">
                        <span className="font-bold text-slate-900 block">✦ {op.product}</span>
                        <span className="text-slate-500 block">{op.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Next Best Action from AI */}
              {aiAnalysisResult.nextBestAction && (
                <div className="p-5 bg-gradient-to-r from-slate-900 to-slate-800 text-white rounded-2xl border border-slate-700 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4" />
                      Ação Comercial Recomendada pela IA
                    </span>
                    <span className="text-[10px] font-bold bg-emerald-500 text-slate-950 px-2 py-0.5 rounded-full">
                      Canal: {aiAnalysisResult.nextBestAction.channel}
                    </span>
                  </div>

                  <h4 className="text-sm font-bold text-white">
                    {aiAnalysisResult.nextBestAction.title}
                  </h4>

                  {aiAnalysisResult.nextBestAction.suggestedMessage && (
                    <div className="p-3 bg-slate-800 rounded-xl border border-slate-700 text-xs text-emerald-200 font-mono">
                      "{aiAnalysisResult.nextBestAction.suggestedMessage}"
                    </div>
                  )}

                  {aiAnalysisResult.nextBestAction.discountOffer && (
                    <div className="text-xs text-slate-300">
                      <span className="font-semibold text-emerald-400">Oferta sugerida:</span> {aiAnalysisResult.nextBestAction.discountOffer}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
