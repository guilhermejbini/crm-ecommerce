import React, { useState, useMemo } from 'react';
import { useCRM } from '../../context/CRMContext';
import { Coupon } from '../../types/crm';
import {
  Ticket,
  Plus,
  Search,
  Copy,
  Check,
  Trash2,
  Power,
  Calendar,
  DollarSign,
  Users,
  Percent,
  TrendingUp,
  AlertCircle,
  X
} from 'lucide-react';
import { isCouponCodeTaken } from '../../utils/couponUtils';

export const CouponListView: React.FC = () => {
  const { coupons, handleSaveCoupon, handleDeleteCoupon, handleToggleCouponStatus, currentUser, showToast } = useCRM();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive' | 'expired'>('all');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);

  // Form State
  const [newCode, setNewCode] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newDiscountType, setNewDiscountType] = useState<'percentage' | 'fixed_value'>('percentage');
  const [newDiscountValue, setNewDiscountValue] = useState(10);
  const [newMinPurchase, setNewMinPurchase] = useState(50);
  const [newMaxDiscount, setNewMaxDiscount] = useState<number | undefined>(undefined);
  const [newValidUntil, setNewValidUntil] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    return d.toISOString().split('T')[0];
  });
  const [newTargetAudience, setNewTargetAudience] = useState('Todos');
  const [newMaxUsage, setNewMaxUsage] = useState(100);

  // Copy helper
  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    showToast(`Código ${code} copiado para a área de transferência!`, 'success');
    setTimeout(() => setCopiedCode(null), 2500);
  };

  // Filtered coupons
  const filteredCoupons = useMemo(() => {
    return coupons.filter(c => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesCode = c.code.toLowerCase().includes(q);
        const matchesDesc = (c.description || '').toLowerCase().includes(q);
        const matchesCamp = (c.campaignName || '').toLowerCase().includes(q);
        if (!matchesCode && !matchesDesc && !matchesCamp) return false;
      }

      // Status
      const isExpired = new Date(c.validUntil.split('T')[0] + 'T23:59:59') < new Date();
      if (statusFilter === 'active') {
        if (!c.isActive || isExpired) return false;
      } else if (statusFilter === 'inactive') {
        if (c.isActive && !isExpired) return false;
      } else if (statusFilter === 'expired') {
        if (!isExpired) return false;
      }

      return true;
    });
  }, [coupons, searchQuery, statusFilter]);

  // KPIs
  const stats = useMemo(() => {
    const total = coupons.length;
    const active = coupons.filter(c => c.isActive && new Date(c.validUntil.split('T')[0] + 'T23:59:59') >= new Date()).length;
    const totalRedeemed = coupons.reduce((sum, c) => sum + (c.currentUsageCount || c.usageCount || 0), 0);
    const avgDiscount = coupons.length > 0
      ? coupons.reduce((sum, c) => sum + (c.discountValue || 0), 0) / coupons.length
      : 0;

    return { total, active, totalRedeemed, avgDiscount };
  }, [coupons]);

  // Submit new coupon
  const handleCreateCouponSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode.trim()) {
      showToast('Por favor, informe o código do cupom.', 'error');
      return;
    }

    const cleanCode = newCode.trim().toUpperCase().replace(/\s+/g, '-');
    if (isCouponCodeTaken(cleanCode, coupons)) {
      showToast(`Já existe um cupom com o código ${cleanCode}. Use outro código.`, 'error');
      return;
    }
    const couponPayload: Coupon = {
      id: `coup-${Date.now()}`,
      code: cleanCode,
      description: newDescription.trim() || `Desconto de ${newDiscountValue}${newDiscountType === 'percentage' ? '%' : ' R$'} no Super Astral`,
      discountType: newDiscountType,
      discountValue: Number(newDiscountValue),
      minPurchaseValue: Number(newMinPurchase) || 0,
      maxDiscountValue: newMaxDiscount ? Number(newMaxDiscount) : undefined,
      validUntil: newValidUntil,
      targetAudience: newTargetAudience,
      maxUsageTotal: Number(newMaxUsage) || 100,
      currentUsageCount: 0,
      isActive: true,
      status: 'Ativo',
      createdAt: new Date().toISOString()
    };

    try {
      await handleSaveCoupon(couponPayload);
      setIsCreateModalOpen(false);
      // Reset form
      setNewCode('');
      setNewDescription('');
      setNewDiscountValue(10);
      setNewMinPurchase(50);
      setNewMaxDiscount(undefined);
    } catch (err: any) {
      console.error('Erro ao criar cupom:', err);
      showToast(err?.message || 'Não foi possível criar o cupom.', 'error');
    }
  };

  const handleDeleteConfirm = async (id: string) => {
    try {
      await handleDeleteCoupon(id);
      setIsDeletingId(null);
    } catch (err) {
      console.error('Erro ao excluir cupom:', err);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-2 bg-emerald-50 rounded-xl text-emerald-700">
              <Ticket className="w-5 h-5" />
            </div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Gestão de Cupons Promocionais</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Crie e gerencie cupons de desconto para campanhas de marketing, WhatsApp e ações de fidelização do Super Astral.
          </p>
        </div>

        {currentUser.role !== 'viewer' && (
          <button
            id="btn-create-coupon"
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Novo Cupom
          </button>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium text-slate-500">Cupons Ativos</span>
            <Ticket className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{stats.active}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Disponíveis para resgate</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium text-slate-500">Total de Resgates</span>
            <TrendingUp className="w-4 h-4 text-blue-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{stats.totalRedeemed}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Utilizados pelos clientes</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium text-slate-500">Desconto Médio</span>
            <Percent className="w-4 h-4 text-purple-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{stats.avgDiscount.toFixed(1)}%</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Média configurada</div>
        </div>

        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-medium text-slate-500">Total Cadastrado</span>
            <DollarSign className="w-4 h-4 text-amber-500" />
          </div>
          <div className="text-2xl font-bold text-slate-900 mt-2">{stats.total}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Na base Super Astral</div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar por código ou descrição..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
          />
        </div>

        <div className="flex items-center gap-1.5 w-full md:w-auto overflow-x-auto">
          {(['all', 'active', 'inactive', 'expired'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
                statusFilter === tab
                  ? 'bg-slate-900 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab === 'all' && 'Todos'}
              {tab === 'active' && 'Ativos'}
              {tab === 'inactive' && 'Inativos'}
              {tab === 'expired' && 'Expirados'}
            </button>
          ))}
        </div>
      </div>

      {/* Coupons List / Empty State */}
      {filteredCoupons.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
          <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto text-emerald-600 mb-3">
            <Ticket className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-800">
            {coupons.length === 0 ? 'Nenhum cupom cadastrado' : 'Nenhum cupom encontrado'}
          </h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
            {coupons.length === 0
              ? 'A base de cupons está limpa. Crie cupons promocionais para enviar via WhatsApp, ativar clientes em risco ou incentivar compras no Super Astral.'
              : 'Nenhum cupom corresponde aos filtros de busca atuais. Tente limpar o campo de busca ou alterar o filtro de status.'}
          </p>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Cadastrar Novo Cupom
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCoupons.map(coupon => {
            const isExpired = new Date(coupon.validUntil.split('T')[0] + 'T23:59:59') < new Date();
            const usageCount = coupon.currentUsageCount || coupon.usageCount || 0;
            const maxUsage = coupon.maxUsageTotal || 100;
            const usagePct = Math.min(100, (usageCount / maxUsage) * 100);

            return (
              <div
                key={coupon.id}
                className={`bg-white rounded-2xl border transition-shadow hover:shadow-md p-5 flex flex-col justify-between ${
                  !coupon.isActive || isExpired ? 'border-slate-200 opacity-80' : 'border-slate-200'
                }`}
              >
                <div>
                  {/* Top: Status & Actions */}
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                        isExpired
                          ? 'bg-rose-100 text-rose-800'
                          : coupon.isActive
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-slate-100 text-slate-700'
                      }`}
                    >
                      {isExpired ? 'Expirado' : coupon.isActive ? 'Ativo' : 'Inativo'}
                    </span>

                    <div className="flex items-center gap-1">
                      <button
                        title={coupon.isActive ? 'Pausar Cupom' : 'Ativar Cupom'}
                        onClick={() => handleToggleCouponStatus(coupon.id)}
                        className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
                      >
                        <Power className={`w-3.5 h-3.5 ${coupon.isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                      </button>

                      <button
                        title="Excluir Cupom"
                        onClick={() => setIsDeletingId(coupon.id)}
                        className="p-1 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Coupon Code Box */}
                  <div className="mt-3 flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                    <span className="font-mono font-bold text-sm tracking-wider text-slate-900">
                      {coupon.code}
                    </span>
                    <button
                      onClick={() => handleCopyCode(coupon.code)}
                      className="p-1.5 text-slate-500 hover:text-emerald-600 rounded-lg hover:bg-white transition-colors"
                      title="Copiar código"
                    >
                      {copiedCode === coupon.code ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-slate-600 mt-2 line-clamp-2">
                    {coupon.description || 'Desconto promocional Super Astral'}
                  </p>

                  {/* Discount & Min Purchase */}
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] bg-slate-50/60 p-2.5 rounded-xl">
                    <div>
                      <span className="text-slate-400 block">Desconto:</span>
                      <span className="font-semibold text-emerald-700">
                        {coupon.discountType === 'percentage'
                          ? `${coupon.discountValue}% OFF`
                          : `R$ ${(coupon.discountValue || 0).toFixed(2)} OFF`}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block">Compra Mínima:</span>
                      <span className="font-semibold text-slate-700">
                        R$ {(coupon.minPurchaseValue || coupon.minimumPurchaseAmount || 0).toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Audience & Validity */}
                  <div className="mt-3 space-y-1 text-[11px] text-slate-500">
                    <div className="flex items-center gap-1.5">
                      <Users className="w-3 h-3 text-slate-400" />
                      <span>Público: <strong className="text-slate-700">{coupon.targetAudience || 'Todos'}</strong></span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      <span>Válido até: <strong className="text-slate-700">{new Date(coupon.validUntil).toLocaleDateString('pt-BR')}</strong></span>
                    </div>
                  </div>
                </div>

                {/* Progress */}
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                    <span>Resgates</span>
                    <span className="font-semibold text-slate-700">{usageCount} / {maxUsage}</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-emerald-500 h-full rounded-full transition-all"
                      style={{ width: `${usagePct}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirmation Modal for Delete */}
      {isDeletingId && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl border border-slate-200">
            <div className="w-10 h-10 rounded-full bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-3">
              <AlertCircle className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 text-center">Excluir Cupom</h3>
            <p className="text-xs text-slate-500 text-center mt-1">
              Tem certeza que deseja excluir este cupom? Esta ação não pode ser desfeita.
            </p>
            <div className="flex items-center gap-2 mt-5">
              <button
                onClick={() => setIsDeletingId(null)}
                className="flex-1 py-2 px-3 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDeleteConfirm(isDeletingId)}
                className="flex-1 py-2 px-3 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create Coupon */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-slate-200 overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Ticket className="w-4 h-4 text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900">Novo Cupom Promocional</h3>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateCouponSubmit} className="p-5 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Código do Cupom *</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    placeholder="Ex: ASTRAL10"
                    value={newCode}
                    onChange={e => setNewCode(e.target.value.toUpperCase())}
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-xl font-mono uppercase font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const randomCode = `ASTRAL${Math.floor(10 + Math.random() * 90)}`;
                      setNewCode(randomCode);
                    }}
                    className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[11px] font-semibold"
                  >
                    Gerar
                  </button>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Descrição</label>
                <input
                  type="text"
                  placeholder="Ex: 10% de desconto em compras acima de R$ 50"
                  value={newDescription}
                  onChange={e => setNewDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Tipo de Desconto</label>
                  <select
                    value={newDiscountType}
                    onChange={e => setNewDiscountType(e.target.value as any)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="percentage">Percentual (%)</option>
                    <option value="fixed_value">Valor Fixo (R$)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">
                    Valor do Desconto {newDiscountType === 'percentage' ? '(%)' : '(R$)'} *
                  </label>
                  <input
                    type="number"
                    min="1"
                    step="0.5"
                    required
                    value={newDiscountValue}
                    onChange={e => setNewDiscountValue(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Compra Mínima (R$)</label>
                  <input
                    type="number"
                    min="0"
                    step="5"
                    value={newMinPurchase}
                    onChange={e => setNewMinPurchase(parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Válido Até *</label>
                  <input
                    type="date"
                    required
                    value={newValidUntil}
                    onChange={e => setNewValidUntil(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Público-Alvo</label>
                  <select
                    value={newTargetAudience}
                    onChange={e => setNewTargetAudience(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="Todos">Todos os Clientes</option>
                    <option value="Campeões VIP">Campeões VIP</option>
                    <option value="Clientes em Risco">Clientes em Risco</option>
                    <option value="Novos Clientes">Novos Clientes</option>
                    <option value="Leais Frequentes">Leais Frequentes</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Limite de Usos</label>
                  <input
                    type="number"
                    min="1"
                    value={newMaxUsage}
                    onChange={e => setNewMaxUsage(parseInt(e.target.value) || 100)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 font-medium"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold shadow-sm"
                >
                  Salvar Cupom
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
