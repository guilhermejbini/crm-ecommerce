import React, { useState, useMemo } from 'react';
import { 
  Award, 
  Search, 
  Tag, 
  Percent, 
  DollarSign, 
  Users, 
  ShoppingBag, 
  Calendar, 
  Plus, 
  Edit3, 
  Trash2, 
  Copy, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  ArrowUpRight, 
  X, 
  Sliders, 
  ShieldCheck, 
  Sparkles, 
  Layers, 
  TrendingUp, 
  ChevronRight, 
  Receipt,
  Store as StoreIcon,
  Filter,
  Eye,
  ShoppingCart,
  UserCheck,
  Zap,
  HelpCircle
} from 'lucide-react';
import { useCRM } from '../../context/CRMContext';
import { ClubOffer, ClubOfferStatus, ClubOfferAudienceType, Customer } from '../../types/crm';

export const LoyaltyClubView: React.FC = () => {
  const { 
    clubOffers, 
    clubOfferUsages, 
    customers, 
    segments, 
    handleSaveClubOffer, 
    handleDeleteClubOffer, 
    handleToggleClubOfferStatus, 
    handleDuplicateClubOffer,
    openCustomer360, 
    showToast 
  } = useCRM();

  // Filter States
  const [activeTab, setActiveTab] = useState<'all' | 'Ativa' | 'Agendada' | 'Encerrada' | 'Inativa'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [audienceFilter, setAudienceFilter] = useState('all');

  // Modal States
  const [isOfferModalOpen, setIsOfferModalOpen] = useState(false);
  const [editingOffer, setEditingOffer] = useState<ClubOffer | null>(null);
  const [selectedOfferDetails, setSelectedOfferDetails] = useState<ClubOffer | null>(null);
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);

  // Form State for New / Edit Offer
  const [formSku, setFormSku] = useState('');
  const [formName, setFormName] = useState('');
  const [formCategory, setFormCategory] = useState('Mercearia');
  const [formBarcode, setFormBarcode] = useState('');
  const [formNormalPrice, setFormNormalPrice] = useState<string>('0');
  const [formClubPrice, setFormClubPrice] = useState<string>('0');
  const [formStartDate, setFormStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [formEndDate, setFormEndDate] = useState(
    new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [formLimit, setFormLimit] = useState<string>('3');
  const [formAudienceType, setFormAudienceType] = useState<ClubOfferAudienceType>('all');
  const [formSegmentId, setFormSegmentId] = useState('');
  const [formStatus, setFormStatus] = useState<ClubOfferStatus>('Ativa');

  // POS Simulator State
  const [simCustomerCpf, setSimCustomerCpf] = useState('');
  const [simSelectedCustomer, setSimSelectedCustomer] = useState<Customer | null>(null);
  const [simCartItems, setSimCartItems] = useState<{ offer: ClubOffer; quantity: number }[]>([]);

  // Calculate top KPI indicators
  const kpis = useMemo(() => {
    const activeOffers = clubOffers.filter(o => o.status === 'Ativa');
    const distinctProducts = new Set(activeOffers.map(o => o.productSku)).size;
    const clubMembers = customers.filter(c => c.isClubMember !== false);
    const clubMembersPct = customers.length > 0 ? (clubMembers.length / customers.length) * 100 : 0;
    
    const totalSavings = clubOffers.reduce((acc, o) => acc + (o.totalSavingsGranted || 0), 0);
    const totalRevenue = clubOffers.reduce((acc, o) => acc + (o.totalRevenueGenerated || 0), 0);
    const totalUnits = clubOffers.reduce((acc, o) => acc + (o.unitsSold || 0), 0);

    return {
      activeOffersCount: activeOffers.length,
      distinctProductsCount: distinctProducts,
      clubMembersCount: clubMembers.length,
      clubMembersPct: parseFloat(clubMembersPct.toFixed(1)),
      totalSavings,
      totalRevenue,
      totalUnits
    };
  }, [clubOffers, customers]);

  // Filtered offers list
  const filteredOffers = useMemo(() => {
    return clubOffers.filter(offer => {
      // Tab filter
      if (activeTab !== 'all' && offer.status !== activeTab) {
        return false;
      }
      // Category filter
      if (categoryFilter !== 'all' && offer.productCategory !== categoryFilter) {
        return false;
      }
      // Audience filter
      if (audienceFilter !== 'all' && offer.audienceType !== audienceFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = offer.productName.toLowerCase().includes(q);
        const matchSku = offer.productSku.toLowerCase().includes(q);
        const matchBarcode = offer.barcode ? offer.barcode.includes(q) : false;
        if (!matchName && !matchSku && !matchBarcode) return false;
      }
      return true;
    });
  }, [clubOffers, activeTab, categoryFilter, audienceFilter, searchQuery]);

  // Unique categories for filter dropdown
  const categories = useMemo(() => {
    const set = new Set<string>();
    clubOffers.forEach(o => {
      if (o.productCategory) set.add(o.productCategory);
    });
    return Array.from(set);
  }, [clubOffers]);

  // Open modal to create new offer
  const handleOpenCreateModal = () => {
    setEditingOffer(null);
    setFormSku('');
    setFormName('');
    setFormCategory('Mercearia');
    setFormBarcode('');
    setFormNormalPrice('');
    setFormClubPrice('');
    setFormStartDate(new Date().toISOString().split('T')[0]);
    setFormEndDate(new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
    setFormLimit('3');
    setFormAudienceType('all');
    setFormSegmentId('');
    setFormStatus('Ativa');
    setIsOfferModalOpen(true);
  };

  // Open modal to edit offer
  const handleOpenEditModal = (offer: ClubOffer) => {
    setEditingOffer(offer);
    setFormSku(offer.productSku);
    setFormName(offer.productName);
    setFormCategory(offer.productCategory);
    setFormBarcode(offer.barcode || '');
    setFormNormalPrice(offer.normalPrice.toString());
    setFormClubPrice(offer.clubPrice.toString());
    setFormStartDate(offer.startDate);
    setFormEndDate(offer.endDate);
    setFormLimit(offer.unitLimitPerCustomer ? offer.unitLimitPerCustomer.toString() : '');
    setFormAudienceType(offer.audienceType);
    setFormSegmentId(offer.targetSegmentId || '');
    setFormStatus(offer.status);
    setIsOfferModalOpen(true);
  };

  // Live computed discount in form
  const computedDiscountVal = useMemo(() => {
    const normal = parseFloat(formNormalPrice) || 0;
    const club = parseFloat(formClubPrice) || 0;
    return Math.max(0, normal - club);
  }, [formNormalPrice, formClubPrice]);

  const computedDiscountPct = useMemo(() => {
    const normal = parseFloat(formNormalPrice) || 0;
    if (normal <= 0) return 0;
    return Math.max(0, (computedDiscountVal / normal) * 100);
  }, [formNormalPrice, computedDiscountVal]);

  // Submit Offer
  const handleSubmitOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    const normal = parseFloat(formNormalPrice);
    const club = parseFloat(formClubPrice);

    if (!formName.trim() || !formSku.trim()) {
      showToast('Informe o nome e o SKU do produto.', 'error');
      return;
    }
    if (isNaN(normal) || normal <= 0) {
      showToast('Informe um Preço Normal válido.', 'error');
      return;
    }
    if (isNaN(club) || club <= 0) {
      showToast('Informe um Preço Clube válido.', 'error');
      return;
    }
    if (club >= normal) {
      showToast('O Preço Clube deve ser menor que o Preço Normal.', 'error');
      return;
    }

    let targetSegmentName: string | undefined = undefined;
    if (formAudienceType === 'segment' && formSegmentId) {
      const seg = segments.find(s => s.id === formSegmentId);
      targetSegmentName = seg ? seg.name : undefined;
    }

    const offerObj: ClubOffer = {
      id: editingOffer ? editingOffer.id : `offer-${Date.now()}`,
      productSku: formSku.trim().toUpperCase(),
      productName: formName.trim(),
      productCategory: formCategory,
      barcode: formBarcode.trim() || undefined,
      normalPrice: normal,
      clubPrice: club,
      discountValue: parseFloat(computedDiscountVal.toFixed(2)),
      discountPercent: parseFloat(computedDiscountPct.toFixed(2)),
      startDate: formStartDate,
      endDate: formEndDate,
      unitLimitPerCustomer: formLimit ? parseInt(formLimit, 10) : undefined,
      audienceType: formAudienceType,
      targetSegmentId: formAudienceType === 'segment' ? formSegmentId : undefined,
      targetSegmentName,
      status: formStatus,
      clientsUsedCount: editingOffer?.clientsUsedCount || 0,
      unitsSold: editingOffer?.unitsSold || 0,
      totalSavingsGranted: editingOffer?.totalSavingsGranted || 0,
      totalRevenueGenerated: editingOffer?.totalRevenueGenerated || 0,
      createdAt: editingOffer?.createdAt || new Date().toISOString()
    };

    await handleSaveClubOffer(offerObj);
    setIsOfferModalOpen(false);
  };

  // POS Simulator Logic
  const handleSimLookupCpf = (cpfToLookup: string) => {
    const clean = cpfToLookup.replace(/\D/g, '');
    const found = customers.find(c => {
      if (!c.cpf) return false;
      return c.cpf.replace(/\D/g, '').includes(clean) || c.cpf.includes(cpfToLookup);
    });
    setSimSelectedCustomer(found || null);
  };

  const handleAddOfferToSimCart = (offer: ClubOffer) => {
    const existing = simCartItems.find(i => i.offer.id === offer.id);
    if (existing) {
      setSimCartItems(simCartItems.map(i => i.offer.id === offer.id ? { ...i, quantity: i.quantity + 1 } : i));
    } else {
      setSimCartItems([...simCartItems, { offer, quantity: 1 }]);
    }
  };

  const handleUpdateSimQuantity = (offerId: string, delta: number) => {
    setSimCartItems(simCartItems.map(i => {
      if (i.offer.id === offerId) {
        const newQ = i.quantity + delta;
        return newQ > 0 ? { ...i, quantity: newQ } : null;
      }
      return i;
    }).filter(Boolean) as { offer: ClubOffer; quantity: number }[]);
  };

  const simTotals = useMemo(() => {
    let totalNormal = 0;
    let totalClub = 0;
    let totalSavings = 0;
    const isMember = simSelectedCustomer ? simSelectedCustomer.isClubMember !== false : false;

    simCartItems.forEach(item => {
      const normalItemTotal = item.offer.normalPrice * item.quantity;
      totalNormal += normalItemTotal;

      if (isMember) {
        // Check unit limit if applicable
        const limit = item.offer.unitLimitPerCustomer || 9999;
        const discountableQty = Math.min(item.quantity, limit);
        const nonDiscountableQty = Math.max(0, item.quantity - limit);

        const clubItemTotal = (item.offer.clubPrice * discountableQty) + (item.offer.normalPrice * nonDiscountableQty);
        totalClub += clubItemTotal;
        totalSavings += (item.offer.discountValue * discountableQty);
      } else {
        totalClub += normalItemTotal;
      }
    });

    return {
      totalNormal,
      totalClub,
      totalSavings: isMember ? totalSavings : 0,
      isMember
    };
  }, [simCartItems, simSelectedCustomer]);

  // Simulador: só calcula. Não grava uso de oferta, métricas da oferta nem economia do cliente,
  // porque não houve venda real (uso real chega pela importação do PDV).
  const handleConfirmSimCheckout = () => {
    if (!simSelectedCustomer) {
      showToast('Selecione um cliente para simular a venda.', 'error');
      return;
    }
    if (simCartItems.length === 0) {
      showToast('Adicione ao menos um produto no carrinho.', 'error');
      return;
    }

    setSimCartItems([]);
    setIsSimulatorOpen(false);
    showToast(
      `Simulação concluída: economia de R$ ${simTotals.totalSavings.toFixed(2)} para ${simSelectedCustomer.name}. Nada foi gravado no CRM.`,
      'info'
    );
  };

  return (
    <div className="space-y-6 pb-12">
      {/* ---------------------------------------------------- */}
      {/* 1. HEADER & ACTION BUTTONS */}
      {/* ---------------------------------------------------- */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
              <Sparkles className="w-3.5 h-3.5" />
              Preço Clube no PDV
            </span>
            <span className="text-xs text-slate-400 font-medium">| Supermercado Astral</span>
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mt-1.5">
            Fidelidade Clube
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Gerenciamento de preços e ofertas exclusivas para clientes cadastrados no CRM
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => setIsRulesModalOpen(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors border border-slate-200"
          >
            <HelpCircle className="w-4 h-4 text-slate-500" />
            Regras Comerciais
          </button>

          <button
            onClick={() => setIsSimulatorOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors border border-indigo-200"
          >
            <ShoppingCart className="w-4 h-4 text-indigo-600" />
            Simulador PDV Caixa
          </button>

          <button
            onClick={handleOpenCreateModal}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shadow-sm shadow-emerald-600/20"
          >
            <Plus className="w-4 h-4" />
            Nova Oferta de Preço Clube
          </button>
        </div>
      </div>

      {/* ---------------------------------------------------- */}
      {/* 2. TOP 5 PERFORMANCE KPI CARDS */}
      {/* ---------------------------------------------------- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Card 1: Ofertas Ativas */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Ofertas Ativas</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Tag className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">{kpis.activeOffersCount}</span>
            <span className="text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">Vigentes</span>
          </div>
          <p className="text-xs text-slate-400 mt-1">Preços diferenciados no PDV</p>
        </div>

        {/* Card 2: Produtos em Oferta */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">SKUs em Oferta</span>
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <ShoppingBag className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">{kpis.distinctProductsCount}</span>
            <span className="text-xs text-slate-500 font-medium">produtos</span>
          </div>
          <p className="text-xs text-slate-400 mt-1">Em {categories.length} categorias ativas</p>
        </div>

        {/* Card 3: Clientes Clube */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Clientes Clube</span>
            <div className="w-9 h-9 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center">
              <Users className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900">{kpis.clubMembersCount}</span>
            <span className="text-xs font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-md">
              {kpis.clubMembersPct}% da base
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">Elegíveis a desconto no CPF</p>
        </div>

        {/* Card 4: Economia Gerada aos Clientes */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Economia Concedida</span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <DollarSign className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-xs font-bold text-amber-700">R$</span>
            <span className="text-2xl font-bold text-slate-900">{kpis.totalSavings.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <p className="text-xs text-slate-400 mt-1">Descontos diretos no caixa</p>
        </div>

        {/* Card 5: Vendas com Preço Clube */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Faturamento Clube</span>
            <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-600 flex items-center justify-center">
              <TrendingUp className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-xs font-bold text-teal-700">R$</span>
            <span className="text-2xl font-bold text-slate-900">{kpis.totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
          <p className="text-xs text-slate-400 mt-1">{kpis.totalUnits} un. vendidas no Clube</p>
        </div>
      </div>

      {/* ---------------------------------------------------- */}
      {/* 3. FILTERS, TABS & SEARCH */}
      {/* ---------------------------------------------------- */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
        {/* Top Status Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {(['all', 'Ativa', 'Agendada', 'Encerrada', 'Inativa'] as const).map(tab => {
              const count = tab === 'all' 
                ? clubOffers.length 
                : clubOffers.filter(o => o.status === tab).length;

              const isActive = activeTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all flex items-center gap-2 ${
                    isActive
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {tab === 'all' ? 'Todas as Ofertas' : tab}
                  <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                    isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="text-xs text-slate-500 font-medium">
            Exibindo <strong className="text-slate-800">{filteredOffers.length}</strong> de {clubOffers.length} ofertas
          </div>
        </div>

        {/* Search and Secondary Selectors */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por produto, SKU ou código de barras..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <select
              value={categoryFilter}
              onChange={e => setCategoryFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            >
              <option value="all">Todas as Categorias</option>
              {categories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>

            <select
              value={audienceFilter}
              onChange={e => setAudienceFilter(e.target.value)}
              className="px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
            >
              <option value="all">Todos os Públicos</option>
              <option value="all">Geral (Todos do Clube)</option>
              <option value="segment">Segmentados</option>
              <option value="selected">Clientes Específicos</option>
            </select>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------- */}
      {/* 4. OFFERS TABLE */}
      {/* ---------------------------------------------------- */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
        {filteredOffers.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
              <Tag className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">Nenhuma oferta de Preço Clube encontrada</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Nenhuma oferta corresponde aos filtros selecionados. Crie uma nova oferta ou ajuste os termos de busca.
            </p>
            <button
              onClick={handleOpenCreateModal}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700"
            >
              <Plus className="w-4 h-4" />
              Criar Nova Oferta
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-100 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="py-3 px-4">Produto / SKU</th>
                  <th className="py-3 px-4">Preço Normal</th>
                  <th className="py-3 px-4">Preço Clube</th>
                  <th className="py-3 px-4">Desconto</th>
                  <th className="py-3 px-4">Limite / CPF</th>
                  <th className="py-3 px-4">Público-Alvo</th>
                  <th className="py-3 px-4">Validade</th>
                  <th className="py-3 px-4">Desempenho</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredOffers.map(offer => {
                  const isExpired = new Date(offer.endDate.split('T')[0] + 'T23:59:59') < new Date();
                  const isFuture = new Date(offer.startDate) > new Date();

                  return (
                    <tr key={offer.id} className="hover:bg-slate-50/70 transition-colors group">
                      {/* Product */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col">
                          <span className="font-semibold text-slate-900">{offer.productName}</span>
                          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                            <span className="font-mono bg-slate-100 px-1.5 py-0.2 rounded text-slate-600 font-semibold">{offer.productSku}</span>
                            <span>•</span>
                            <span>{offer.productCategory}</span>
                          </div>
                        </div>
                      </td>

                      {/* Normal Price */}
                      <td className="py-3.5 px-4 font-mono text-slate-400 line-through">
                        R$ {offer.normalPrice.toFixed(2)}
                      </td>

                      {/* Club Price */}
                      <td className="py-3.5 px-4 font-mono font-bold text-emerald-700">
                        <span className="text-[10px] font-normal mr-0.5">R$</span>
                        {offer.clubPrice.toFixed(2)}
                      </td>

                      {/* Discount Value and % */}
                      <td className="py-3.5 px-4">
                        <div className="inline-flex flex-col items-start">
                          <span className="inline-flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md text-[11px] border border-emerald-200/50">
                            <Percent className="w-3 h-3" />
                            {offer.discountPercent.toFixed(1)}% OFF
                          </span>
                          <span className="text-[10px] text-slate-400 mt-0.5">
                            -R$ {offer.discountValue.toFixed(2)}/un
                          </span>
                        </div>
                      </td>

                      {/* Unit Limit */}
                      <td className="py-3.5 px-4">
                        {offer.unitLimitPerCustomer ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                            Até {offer.unitLimitPerCustomer} un.
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400 font-medium">Ilimitado</span>
                        )}
                      </td>

                      {/* Target Audience */}
                      <td className="py-3.5 px-4">
                        {offer.audienceType === 'all' && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md">
                            <Users className="w-3 h-3 text-slate-400" />
                            Todos do Clube
                          </span>
                        )}
                        {offer.audienceType === 'segment' && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded-md border border-purple-200/60 max-w-[140px] truncate" title={offer.targetSegmentName}>
                            <Sparkles className="w-3 h-3 text-purple-500 flex-shrink-0" />
                            <span className="truncate">{offer.targetSegmentName || 'Segmento'}</span>
                          </span>
                        )}
                        {offer.audienceType === 'selected' && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded-md">
                            <UserCheck className="w-3 h-3" />
                            Selecionados ({offer.selectedCustomerIds?.length || 0})
                          </span>
                        )}
                      </td>

                      {/* Date Validity */}
                      <td className="py-3.5 px-4 text-[11px]">
                        <div className="flex flex-col">
                          <span className="text-slate-700 font-medium">
                            {new Date(offer.startDate).toLocaleDateString('pt-BR')} até {new Date(offer.endDate).toLocaleDateString('pt-BR')}
                          </span>
                          <span className={`text-[10px] ${isExpired ? 'text-rose-500 font-semibold' : isFuture ? 'text-amber-600 font-semibold' : 'text-slate-400'}`}>
                            {isExpired ? 'Encerrada' : isFuture ? 'Inicia em breve' : 'Em andamento'}
                          </span>
                        </div>
                      </td>

                      {/* Performance */}
                      <td className="py-3.5 px-4">
                        <button
                          onClick={() => setSelectedOfferDetails(offer)}
                          className="flex flex-col items-start hover:opacity-80 transition-opacity text-left"
                        >
                          <div className="flex items-center gap-1.5 font-bold text-slate-800">
                            <span>{offer.unitsSold || 0} un.</span>
                            <span className="text-[10px] font-normal text-slate-400">({offer.clientsUsedCount || 0} cl.)</span>
                          </div>
                          <span className="text-[10px] text-emerald-600 font-medium">
                            R$ {(offer.totalSavingsGranted || 0).toFixed(2)} economizados
                          </span>
                        </button>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                          offer.status === 'Ativa'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                            : offer.status === 'Agendada'
                            ? 'bg-blue-50 text-blue-700 border border-blue-200/60'
                            : offer.status === 'Encerrada'
                            ? 'bg-slate-100 text-slate-600'
                            : 'bg-rose-50 text-rose-700 border border-rose-200/60'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            offer.status === 'Ativa' ? 'bg-emerald-500' : offer.status === 'Agendada' ? 'bg-blue-500' : offer.status === 'Encerrada' ? 'bg-slate-400' : 'bg-rose-500'
                          }`} />
                          {offer.status}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1 opacity-80 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setSelectedOfferDetails(offer)}
                            title="Ver Desempenho e Histórico"
                            className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleOpenEditModal(offer)}
                            title="Editar Oferta"
                            className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          >
                            <Edit3 className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleDuplicateClubOffer(offer.id)}
                            title="Duplicar Oferta"
                            className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            <Copy className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => {
                              if (confirm(`Deseja excluir a oferta "${offer.productName}"?`)) {
                                handleDeleteClubOffer(offer.id);
                              }
                            }}
                            title="Excluir Oferta"
                            className="p-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---------------------------------------------------- */}
      {/* 5. MODAL: NOVA OFERTA / EDITAR OFERTA */}
      {/* ---------------------------------------------------- */}
      {isOfferModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <Tag className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    {editingOffer ? 'Editar Oferta de Preço Clube' : 'Nova Oferta de Preço Clube'}
                  </h2>
                  <p className="text-xs text-slate-500">Defina o preço exclusivo para clientes cadastrados no CRM</p>
                </div>
              </div>
              <button
                onClick={() => setIsOfferModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Form Body */}
            <form onSubmit={handleSubmitOffer} className="p-6 overflow-y-auto space-y-5">
              {/* Product Info Section */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-slate-700 mb-1">Nome do Produto *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: Arroz Tipo 1 Camil 5kg"
                    value={formName}
                    onChange={e => setFormName(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">SKU / Código *</label>
                  <input
                    type="text"
                    required
                    placeholder="Ex: ME001"
                    value={formSku}
                    onChange={e => setFormSku(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono uppercase"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Categoria *</label>
                  <select
                    value={formCategory}
                    onChange={e => setFormCategory(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                  >
                    <option value="Mercearia">Mercearia</option>
                    <option value="Açougue">Açougue</option>
                    <option value="Hortifruti">Hortifruti</option>
                    <option value="Laticínios">Laticínios & Frios</option>
                    <option value="Bebidas">Bebidas</option>
                    <option value="Limpeza">Limpeza & Higiene</option>
                    <option value="Padaria">Padaria & Confeitaria</option>
                    <option value="Congelados">Congelados</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Código de Barras (EAN)</label>
                  <input
                    type="text"
                    placeholder="Ex: 7896006711124"
                    value={formBarcode}
                    onChange={e => setFormBarcode(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono"
                  />
                </div>
              </div>

              {/* Price Calculation Box */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-3">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
                  💰 Precificação e Desconto Exclusivo
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Preço Normal de Gôndola (R$) *</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">R$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={formNormalPrice}
                        onChange={e => setFormNormalPrice(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono font-semibold"
                        placeholder="29.90"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-emerald-700 mb-1">Preço Clube Exclusivo (R$) *</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-emerald-600">R$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        required
                        value={formClubPrice}
                        onChange={e => setFormClubPrice(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-emerald-300 focus:ring-2 focus:ring-emerald-500 focus:outline-none font-mono font-bold text-emerald-800 bg-white"
                        placeholder="24.90"
                      />
                    </div>
                  </div>
                </div>

                {/* Auto computed discount summary */}
                <div className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-200">
                  <div className="flex items-center gap-2">
                    <Percent className="w-4 h-4 text-emerald-600" />
                    <span className="text-xs font-semibold text-slate-700">Desconto Calculado:</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-slate-600">
                      -R$ {computedDiscountVal.toFixed(2)}
                    </span>
                    <span className={`text-xs font-extrabold px-2.5 py-0.5 rounded-full ${
                      computedDiscountPct > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-400'
                    }`}>
                      {computedDiscountPct.toFixed(1)}% OFF
                    </span>
                  </div>
                </div>
              </div>

              {/* Dates and Limits */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Data de Início *</label>
                  <input
                    type="date"
                    required
                    value={formStartDate}
                    onChange={e => setFormStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Data de Término *</label>
                  <input
                    type="date"
                    required
                    value={formEndDate}
                    onChange={e => setFormEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Limite un./CPF</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="Ex: 3 (0 = sem limite)"
                    value={formLimit}
                    onChange={e => setFormLimit(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Target Audience and Status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Público-Alvo</label>
                  <select
                    value={formAudienceType}
                    onChange={e => setFormAudienceType(e.target.value as ClubOfferAudienceType)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                  >
                    <option value="all">Todos os Clientes do Clube</option>
                    <option value="segment">Segmento Específico (RFM)</option>
                  </select>
                </div>

                {formAudienceType === 'segment' ? (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Selecione o Segmento *</label>
                    <select
                      value={formSegmentId}
                      onChange={e => setFormSegmentId(e.target.value)}
                      required
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                    >
                      <option value="">Selecione um segmento...</option>
                      {segments.map(seg => (
                        <option key={seg.id} value={seg.id}>{seg.name}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Status Inicial</label>
                    <select
                      value={formStatus}
                      onChange={e => setFormStatus(e.target.value as ClubOfferStatus)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 focus:ring-2 focus:ring-emerald-500 focus:outline-none bg-white"
                    >
                      <option value="Ativa">Ativa (Vigente)</option>
                      <option value="Agendada">Agendada</option>
                      <option value="Inativa">Inativa (Pausada)</option>
                      <option value="Encerrada">Encerrada</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsOfferModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm transition-colors"
                >
                  {editingOffer ? 'Salvar Alterações' : 'Criar Oferta de Preço Clube'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 6. MODAL: DETALHES E DESEMPENHO DA OFERTA */}
      {/* ---------------------------------------------------- */}
      {selectedOfferDetails && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white w-full max-w-2xl rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">{selectedOfferDetails.productName}</h2>
                  <p className="text-xs text-slate-500 font-mono">SKU: {selectedOfferDetails.productSku} • {selectedOfferDetails.productCategory}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedOfferDetails(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {/* Stat Highlights */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Preço Normal</span>
                  <span className="text-sm font-bold text-slate-600 line-through">R$ {selectedOfferDetails.normalPrice.toFixed(2)}</span>
                </div>
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                  <span className="text-[10px] uppercase font-bold text-emerald-700 block">Preço Clube</span>
                  <span className="text-sm font-extrabold text-emerald-800">R$ {selectedOfferDetails.clubPrice.toFixed(2)}</span>
                </div>
                <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
                  <span className="text-[10px] uppercase font-bold text-blue-700 block">Unidades Vendidas</span>
                  <span className="text-sm font-bold text-blue-900">{selectedOfferDetails.unitsSold || 0} un.</span>
                </div>
                <div className="p-3 bg-amber-50 rounded-xl border border-amber-100">
                  <span className="text-[10px] uppercase font-bold text-amber-700 block">Economia Gerada</span>
                  <span className="text-sm font-bold text-amber-900">R$ {(selectedOfferDetails.totalSavingsGranted || 0).toFixed(2)}</span>
                </div>
              </div>

              {/* Usages List */}
              <div>
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2 flex items-center justify-between">
                  <span>Clientes que Utilizaram Esta Oferta ({clubOfferUsages.filter(u => u.offerId === selectedOfferDetails.id).length})</span>
                </h3>

                <div className="border border-slate-200 rounded-xl overflow-hidden max-h-56 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase">
                      <tr>
                        <th className="p-2.5">Cliente</th>
                        <th className="p-2.5">Qtd.</th>
                        <th className="p-2.5">Economia</th>
                        <th className="p-2.5">Data / PDV</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {clubOfferUsages.filter(u => u.offerId === selectedOfferDetails.id).map(usage => (
                        <tr key={usage.id} className="hover:bg-slate-50">
                          <td className="p-2.5 font-medium text-slate-800">
                            <button
                              onClick={() => {
                                setSelectedOfferDetails(null);
                                openCustomer360(usage.customerId);
                              }}
                              className="text-emerald-700 hover:underline font-semibold text-left"
                            >
                              {usage.customerName}
                            </button>
                            <span className="block text-[10px] text-slate-400 font-mono">{usage.customerCpf || 'Sem CPF'}</span>
                          </td>
                          <td className="p-2.5 font-mono">{usage.quantity}x</td>
                          <td className="p-2.5 font-bold text-emerald-700 font-mono">R$ {usage.totalSavings.toFixed(2)}</td>
                          <td className="p-2.5 text-slate-500 text-[11px]">
                            {new Date(usage.usedAt).toLocaleDateString('pt-BR')} {new Date(usage.usedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            <span className="block text-[10px] text-slate-400">{usage.posNumber} • {usage.storeName}</span>
                          </td>
                        </tr>
                      ))}
                      {clubOfferUsages.filter(u => u.offerId === selectedOfferDetails.id).length === 0 && (
                        <tr>
                          <td colSpan={4} className="p-6 text-center text-slate-400 text-xs">
                            Nenhuma utilização registrada para esta oferta ainda.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Offer Parameters */}
              <div className="p-3 bg-slate-50 rounded-xl text-xs space-y-1.5 text-slate-600">
                <div className="flex justify-between">
                  <span>Período de Vigência:</span>
                  <strong>{new Date(selectedOfferDetails.startDate).toLocaleDateString('pt-BR')} até {new Date(selectedOfferDetails.endDate).toLocaleDateString('pt-BR')}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Limite por Cliente:</span>
                  <strong>{selectedOfferDetails.unitLimitPerCustomer ? `${selectedOfferDetails.unitLimitPerCustomer} unidades` : 'Sem limite'}</strong>
                </div>
                <div className="flex justify-between">
                  <span>Público Elegível:</span>
                  <strong>{selectedOfferDetails.audienceType === 'all' ? 'Todos os clientes Astral Clube' : selectedOfferDetails.targetSegmentName || 'Segmentado'}</strong>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 flex justify-end bg-slate-50">
              <button
                onClick={() => setSelectedOfferDetails(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 7. MODAL: SIMULADOR PDV CAIXA */}
      {/* ---------------------------------------------------- */}
      {isSimulatorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white w-full max-w-3xl rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-900 text-white">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500 text-slate-950 flex items-center justify-center font-bold">
                  <ShoppingCart className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold">Simulador de PDV Caixa (Fidelidade Clube)</h2>
                  <p className="text-xs text-slate-300">Validação instantânea de CPF e aplicação automática de Preço Clube. Apenas simulação: nada é gravado no CRM.</p>
                </div>
              </div>
              <button
                onClick={() => setIsSimulatorOpen(false)}
                className="p-1 text-slate-400 hover:text-white rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {/* Step 1: Customer CPF Search */}
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
                  1. Identificação do Cliente no Caixa
                </span>

                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Digite o CPF do cliente ou parte do nome..."
                      value={simCustomerCpf}
                      onChange={e => {
                        setSimCustomerCpf(e.target.value);
                        handleSimLookupCpf(e.target.value);
                      }}
                      className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  {/* Quick preset customer buttons */}
                  <div className="flex items-center gap-1 overflow-x-auto">
                    {customers.slice(0, 3).map(c => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSimCustomerCpf(c.cpf || c.name);
                          setSimSelectedCustomer(c);
                        }}
                        className="text-[11px] bg-white hover:bg-slate-100 text-slate-700 px-2.5 py-1.5 rounded-lg border border-slate-200 whitespace-nowrap font-medium"
                      >
                        {c.name.split(' ')[0]} ({c.cpf ? c.cpf.slice(0, 7) + '...' : 'Sem CPF'})
                      </button>
                    ))}
                  </div>
                </div>

                {/* Identification Status Banner */}
                {simSelectedCustomer ? (
                  <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                      <div>
                        <strong className="text-xs text-emerald-900 block">{simSelectedCustomer.name}</strong>
                        <span className="text-[11px] text-emerald-700 font-mono">CPF: {simSelectedCustomer.cpf || 'Não informado'} • Segmento: {simSelectedCustomer.rfmSegment}</span>
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-xs font-extrabold bg-emerald-600 text-white">
                      🟢 Cliente Clube Ativo
                    </span>
                  </div>
                ) : simCustomerCpf.trim() ? (
                  <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-5 h-5 text-amber-600" />
                      <span className="text-xs text-amber-800">Cliente não identificado ou não cadastrado no Clube.</span>
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                      Preço Normal (Sem Desconto)
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400">Digite um CPF ou selecione um cliente para simular os descontos exclusivos.</p>
                )}
              </div>

              {/* Step 2: Available Club Products */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
                  2. Adicionar Produtos em Oferta ao Carrinho
                </span>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {clubOffers.filter(o => o.status === 'Ativa').map(offer => (
                    <div
                      key={offer.id}
                      className="p-3 bg-white rounded-xl border border-slate-200 hover:border-emerald-500/50 transition-colors flex items-center justify-between shadow-2xs"
                    >
                      <div>
                        <strong className="text-xs text-slate-900 block truncate max-w-[190px]">{offer.productName}</strong>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] text-slate-400 line-through">R$ {offer.normalPrice.toFixed(2)}</span>
                          <span className="text-xs font-bold text-emerald-700">R$ {offer.clubPrice.toFixed(2)}</span>
                          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 rounded">
                            -{offer.discountPercent.toFixed(0)}%
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleAddOfferToSimCart(offer)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
                      >
                        + Adicionar
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Step 3: Simulated Cart & Automatic Calculation */}
              <div className="p-4 bg-slate-900 text-white rounded-2xl space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    3. Resumo da Compra no PDV
                  </span>
                  <span className="text-xs text-slate-400">
                    {simCartItems.length} {simCartItems.length === 1 ? 'item' : 'itens'}
                  </span>
                </div>

                {simCartItems.length === 0 ? (
                  <p className="text-center py-4 text-xs text-slate-500">Adicione produtos da lista acima para ver o cálculo em tempo real.</p>
                ) : (
                  <div className="space-y-2">
                    {simCartItems.map(item => {
                      const isMember = simTotals.isMember;
                      const limit = item.offer.unitLimitPerCustomer || 9999;
                      const hasExceeded = item.quantity > limit;

                      return (
                        <div key={item.offer.id} className="flex items-center justify-between text-xs py-1 border-b border-slate-800/60">
                          <div>
                            <strong className="text-white block">{item.offer.productName}</strong>
                            <span className="text-[11px] text-slate-400">
                              {isMember ? `Preço Clube: R$ ${item.offer.clubPrice.toFixed(2)}` : `Preço Normal: R$ ${item.offer.normalPrice.toFixed(2)}`}
                              {hasExceeded && isMember && ` (limite de ${limit} un. com desconto)`}
                            </span>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-1.5 bg-slate-800 rounded-lg p-1">
                              <button
                                onClick={() => handleUpdateSimQuantity(item.offer.id, -1)}
                                className="w-5 h-5 flex items-center justify-center text-slate-300 hover:text-white rounded"
                              >
                                -
                              </button>
                              <span className="font-mono px-1 font-bold">{item.quantity}</span>
                              <button
                                onClick={() => handleUpdateSimQuantity(item.offer.id, 1)}
                                className="w-5 h-5 flex items-center justify-center text-slate-300 hover:text-white rounded"
                              >
                                +
                              </button>
                            </div>

                            <span className="font-mono font-bold text-white min-w-[70px] text-right">
                              R$ {(isMember ? (item.offer.clubPrice * Math.min(item.quantity, limit) + item.offer.normalPrice * Math.max(0, item.quantity - limit)) : item.offer.normalPrice * item.quantity).toFixed(2)}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    {/* Totals */}
                    <div className="pt-2 space-y-1 text-xs">
                      <div className="flex justify-between text-slate-400">
                        <span>Total no Preço Normal:</span>
                        <span className="font-mono line-through">R$ {simTotals.totalNormal.toFixed(2)}</span>
                      </div>
                      {simTotals.isMember && (
                        <div className="flex justify-between text-emerald-400 font-bold">
                          <span>Economia Preço Clube:</span>
                          <span className="font-mono">- R$ {simTotals.totalSavings.toFixed(2)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-base font-extrabold text-white pt-2 border-t border-slate-800">
                        <span>Total a Pagar:</span>
                        <span className="font-mono text-emerald-400">R$ {simTotals.totalClub.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-slate-100 flex items-center justify-between bg-slate-50">
              <span className="text-xs text-slate-500">
                {simSelectedCustomer ? `Cliente selecionado: ${simSelectedCustomer.name}` : 'Nenhum cliente selecionado'}
              </span>

              <div className="flex gap-2">
                <button
                  onClick={() => setIsSimulatorOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 rounded-xl"
                >
                  Fechar
                </button>

                <button
                  onClick={handleConfirmSimCheckout}
                  disabled={!simSelectedCustomer || simCartItems.length === 0}
                  className="px-5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl shadow-sm transition-colors"
                >
                  Encerrar simulação (não grava)
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------------------------------------------------- */}
      {/* 8. MODAL: REGRAS E PRIORIDADES COMERCIAIS */}
      {/* ---------------------------------------------------- */}
      {isRulesModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white w-full max-w-xl rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900">Motor de Regras Comerciais</h2>
                  <p className="text-xs text-slate-500">Hierarquia e regras de aplicação no PDV</p>
                </div>
              </div>
              <button
                onClick={() => setIsRulesModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 text-xs text-slate-600">
              <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                <strong className="text-emerald-900 block font-bold mb-1">
                  Princípio Central: Fidelidade Clube = Preço Exclusivo
                </strong>
                <p className="text-emerald-800">
                  O cliente cadastrado no CRM informa seu CPF no início da compra no caixa. Se ativo no clube, o sistema aplica instantaneamente os preços diferenciados dos produtos participantes.
                </p>
              </div>

              <div className="space-y-2.5">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <strong className="text-slate-900 block font-semibold">1. Identificação Obrigatória no PDV</strong>
                  <p className="text-slate-500 mt-0.5">
                    A concessão do preço clube requer a digitação do CPF no momento do registro dos itens. Clientes não identificados pagam o Preço Normal de Gôndola.
                  </p>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <strong className="text-slate-900 block font-semibold">2. Prioridade de Preço (Melhor Preço para o Cliente)</strong>
                  <p className="text-slate-500 mt-0.5">
                    Se o produto estiver simultaneamente em uma promoção geral de encarte e em uma oferta de Preço Clube, o PDV sempre aplica o menor valor final.
                  </p>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <strong className="text-slate-900 block font-semibold">3. Controle de Limite por CPF</strong>
                  <p className="text-slate-500 mt-0.5">
                    Quando a oferta define um limite (ex: até 3 un. por cliente), as unidades excedentes na mesma compra ou no período são faturadas automaticamente ao Preço Normal.
                  </p>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <strong className="text-slate-900 block font-semibold">4. Não Cumulatividade com Outros Cupons</strong>
                  <p className="text-slate-500 mt-0.5">
                    Preços Clube já representam a condição comercial máxima por item, preservando a margem operacional do supermercado.
                  </p>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 flex justify-end bg-slate-50">
              <button
                onClick={() => setIsRulesModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
