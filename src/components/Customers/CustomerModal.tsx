import React, { useState, useEffect } from 'react';
import { X, Shield, CheckCircle, AlertCircle, Save, UserCheck } from 'lucide-react';
import { Customer } from '../../types/crm';
import { useCRM } from '../../context/CRMContext';
import { apiFetch } from '../../services/api';
import { findCustomersByCpf } from '../../services/firestoreService';
import { isValidCpf, formatCpf } from '../../utils/cpfValidator';
import { normalizeWhatsappInput, normalizeOptionalText } from '../../utils/customerFormUtils';
import { buildConsentUpdate, buildCustomerEditPatch } from '../../utils/customerEdit';

interface CustomerModalProps {
  customer?: Customer | null;
  isOpen: boolean;
  onClose: () => void;
}

export const CustomerModal: React.FC<CustomerModalProps> = ({ customer, isOpen, onClose }) => {
  const { handleSaveCustomer, handleUpdateCustomer, customers, currentUser, showToast } = useCRM();

  const [name, setName] = useState('');
  const [cpf, setCpf] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [birthDate, setBirthDate] = useState('');
  
  const [address, setAddress] = useState('');
  const [number, setNumber] = useState('');
  const [complement, setComplement] = useState('');
  const [neighborhood, setNeighborhood] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [cep, setCep] = useState('');
  const [notes, setNotes] = useState('');
  const [origin, setOrigin] = useState('Balcão de Atendimento');

  // LGPD Consents
  const [whatsappMarketing, setWhatsappMarketing] = useState(false);
  const [emailMarketing, setEmailMarketing] = useState(false);
  const [smsMarketing, setSmsMarketing] = useState(false);
  const [consentPurpose, setConsentPurpose] = useState('Comunicação de ofertas e benefícios exclusivos Astral Clube');

  const [cpfDuplicateWarning, setCpfDuplicateWarning] = useState<string | null>(null);

  // Busca de endereço pelo CEP (ViaCEP)
  const [cepLookupStatus, setCepLookupStatus] = useState<'idle' | 'loading' | 'found' | 'notfound' | 'error'>('idle');

  const formatCepInput = (value: string): string => {
    const digits = value.replace(/\D/g, '').slice(0, 8);
    return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
  };

  const lookupCep = async (rawCep: string) => {
    const digits = rawCep.replace(/\D/g, '');
    if (digits.length !== 8) {
      setCepLookupStatus('idle');
      return;
    }
    setCepLookupStatus('loading');
    try {
      const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
      if (!res.ok) throw new Error(`ViaCEP HTTP ${res.status}`);
      const data = await res.json();
      if (data?.erro) {
        setCepLookupStatus('notfound');
        return;
      }
      // Preenche apenas o que o CEP devolveu; CEPs genéricos (cidade pequena) podem vir sem rua/bairro.
      if (data.logradouro) setAddress(data.logradouro);
      if (data.bairro) setNeighborhood(data.bairro);
      if (data.localidade) setCity(data.localidade);
      if (data.uf) setState(String(data.uf).toUpperCase());
      setCepLookupStatus('found');
    } catch (err) {
      console.warn('[CEP] Falha ao consultar ViaCEP:', err);
      setCepLookupStatus('error');
    }
  };

  useEffect(() => {
    if (customer) {
      setName(customer.name || '');
      setCpf(customer.cpf || '');
      setWhatsapp(customer.whatsapp || '');
      setPhone(customer.phone || '');
      setEmail(customer.email || '');
      setBirthDate(customer.birthDate || '');
      setAddress(customer.address || '');
      setNumber(customer.number || '');
      setComplement(customer.complement || '');
      setNeighborhood(customer.neighborhood || '');
      setCity(customer.city || '');
      setState(customer.state || '');
      setCep(customer.cep || '');
      setNotes(customer.notes || '');
      setOrigin(customer.origin || 'Balcão de Atendimento');
      setWhatsappMarketing(customer.consent?.whatsappMarketing ?? false);
      setEmailMarketing(customer.consent?.emailMarketing ?? false);
      setSmsMarketing(customer.consent?.smsMarketing ?? false);
      setConsentPurpose(customer.consent?.purpose || 'Comunicação de ofertas e benefícios exclusivos Astral Clube');
    } else {
      setName('');
      setCpf('');
      setWhatsapp('');
      setPhone('');
      setEmail('');
      setBirthDate('');
      setAddress('');
      setNumber('');
      setComplement('');
      setNeighborhood('');
      setCity('');
      setState('');
      setCep('');
      setNotes('');
      setOrigin('Balcão de Atendimento');
      setWhatsappMarketing(false);
      setEmailMarketing(false);
      setSmsMarketing(false);
    }
  }, [customer, isOpen]);

  // Check CPF duplicates
  const handleCpfChange = (val: string) => {
    setCpf(val);
    const cleaned = val.replace(/[^0-9]/g, '');
    if (cleaned.length >= 11) {
      const duplicate = customers.find(c => c.id !== customer?.id && c.cpf?.replace(/[^0-9]/g, '') === cleaned);
      if (duplicate) {
        setCpfDuplicateWarning(`Atenção: Já existe um cliente cadastrado com este CPF (${duplicate.name})`);
      } else {
        setCpfDuplicateWarning(null);
      }
    } else {
      setCpfDuplicateWarning(null);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      showToast('O nome do cliente é obrigatório.', 'error');
      return;
    }

    const trimmedCpf = cpf.trim();
    let validatedCpf = 'Não informado';
    if (trimmedCpf && trimmedCpf.toLowerCase() !== 'não informado') {
      if (!isValidCpf(trimmedCpf)) {
        showToast('CPF inválido. Verifique os 11 dígitos numéricos e os dígitos verificadores.', 'error');
        return;
      }
      validatedCpf = formatCpf(trimmedCpf);

      // CPF já cadastrado em outro cliente: bloqueia (antes era só um aviso e gerava duplicata).
      // Só verifica cadastro novo ou CPF alterado, para não travar a edição de duplicatas antigas.
      const cpfChanged = !customer || (customer.cpf || '').replace(/\D/g, '') !== validatedCpf.replace(/\D/g, '');
      if (cpfChanged) {
        try {
          const duplicates = (await findCustomersByCpf(validatedCpf)).filter(c => c.id !== customer?.id);
          if (duplicates.length > 0) {
            setCpfDuplicateWarning(`Já existe um cliente cadastrado com este CPF (${duplicates[0].name}).`);
            showToast(`CPF já cadastrado para ${duplicates[0].name}. Abra o cadastro existente em vez de criar outro.`, 'error');
            return;
          }
        } catch (err) {
          showToast('Não foi possível verificar se o CPF já está cadastrado. Tente novamente.', 'error');
          return;
        }
      }
    }

    const nowIso = new Date().toISOString();
    const consentChoice = { whatsappMarketing, emailMarketing, smsMarketing, purpose: consentPurpose };

    let saved: Customer;
    try {
      if (customer) {
        // Edição: grava só o que o formulário mudou. Campos que não aparecem aqui
        // (código Flex, CNPJ, data de cadastro, totais, clube, loja favorita...) ficam intactos.
        const { patch, clearFields } = buildCustomerEditPatch(customer, {
          name: name.trim(),
          cpf: validatedCpf,
          whatsapp: normalizeWhatsappInput(whatsapp),
          phone, email, birthDate, address, number, complement, neighborhood,
          city: normalizeOptionalText(city),
          state: normalizeOptionalText(state),
          cep, notes, origin,
          consent: consentChoice
        }, { nowIso, updatedBy: currentUser.name });
        saved = await handleUpdateCustomer(customer.id, patch, clearFields);
      } else {
        const newCustomer: Customer = {
          id: `cust-${Date.now()}`,
          name: name.trim(),
          cpf: validatedCpf,
          whatsapp: normalizeWhatsappInput(whatsapp),
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          birthDate: birthDate || undefined,
          address: address.trim() || undefined,
          number: number.trim() || undefined,
          complement: complement.trim() || undefined,
          neighborhood: neighborhood.trim() || undefined,
          city: normalizeOptionalText(city),
          state: normalizeOptionalText(state),
          cep: cep.trim() || undefined,
          notes: notes.trim() || undefined,
          origin: origin,
          createdAt: nowIso,
          updatedAt: nowIso,
          createdBy: currentUser.name,
          consent: buildConsentUpdate(undefined, consentChoice, {
            nowIso,
            updatedBy: currentUser.name,
            origin: 'Formulário de Cadastro CRM'
          }),
          totalSpent: 0,
          totalPurchases: 0,
          averageTicket: 0,
          daysSinceLastPurchase: 0,
          rfmSegment: 'UNCLASSIFIED',
          recencyScore: 0,
          frequencyScore: 0,
          monetaryScore: 0,
          rfmScoreCode: '000',
          loyaltyPoints: 0,
          loyaltyCashbackBalance: 0,
          geocodeStatus: address.trim() ? 'pending' : undefined
        };
        saved = await handleSaveCustomer(newCustomer);
      }
    } catch (err: any) {
      showToast(err?.message || 'Não foi possível salvar o cliente.', 'error');
      return;
    }

    // Sem coordenada (cadastro novo ou endereço alterado): tenta geolocalizar em segundo plano.
    if (!saved.latitude && (saved.address || saved.cep || saved.neighborhood)) {
      try {
        const res = await apiFetch('/api/geocode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address: saved.address,
            number: saved.number,
            neighborhood: saved.neighborhood,
            city: saved.city,
            state: saved.state,
            cep: saved.cep
          })
        });
        const geo = await res.json();
        if (geo.success && geo.latitude && geo.longitude) {
          await handleUpdateCustomer(saved.id, {
            latitude: geo.latitude,
            longitude: geo.longitude,
            geocodeStatus: 'geocoded'
          }, ['geocodeError'], { silent: true });
        }
      } catch (err) {
        // silent
      }
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-slate-200 divide-y divide-slate-100 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-5 flex items-center justify-between bg-slate-50 rounded-t-2xl">
          <div>
            <h2 className="text-base font-bold text-slate-800">
              {customer ? 'Editar Dados do Cliente' : 'Novo Cadastro de Cliente'}
            </h2>
            <p className="text-xs text-slate-500">
              Preencha os dados de identificação, endereço e consentimentos LGPD para o Super Astral.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Dados Pessoais */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center gap-1.5">
              <UserCheck className="w-4 h-4 text-emerald-600" />
              1. Identificação Pessoal
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Nome Completo *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Mariana Silva Souza"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  CPF
                </label>
                <input
                  type="text"
                  placeholder="000.000.000-00"
                  value={cpf}
                  onChange={e => handleCpfChange(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                />
                {cpfDuplicateWarning && (
                  <p className="text-[10px] text-amber-600 font-medium mt-1 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" /> {cpfDuplicateWarning}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  WhatsApp (Principal) *
                </label>
                <input
                  type="text"
                  placeholder="(11) 98765-4321"
                  value={whatsapp}
                  onChange={e => setWhatsapp(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Telefone Fixo / Recado
                </label>
                <input
                  type="text"
                  placeholder="(11) 3456-7890"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Data de Nascimento
                </label>
                <input
                  type="date"
                  value={birthDate}
                  onChange={e => setBirthDate(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  E-mail
                </label>
                <input
                  type="email"
                  placeholder="cliente@email.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Origem do Cadastro
                </label>
                <select
                  value={origin}
                  onChange={e => setOrigin(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none bg-white"
                >
                  <option value="Balcão de Atendimento">Balcão de Atendimento</option>
                  <option value="PDV Caixa">PDV Caixa</option>
                  <option value="App Astral Clube">App Astral Clube</option>
                  <option value="Campanha WhatsApp">Campanha WhatsApp</option>
                  <option value="Importação">Importação</option>
                </select>
              </div>
            </div>
          </div>

          {/* Endereço */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
              2. Endereço e Localização
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  CEP
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="83512-000"
                  value={cep}
                  onChange={e => {
                    const formatted = formatCepInput(e.target.value);
                    setCep(formatted);
                    if (formatted.replace(/\D/g, '').length === 8) {
                      lookupCep(formatted);
                    } else {
                      setCepLookupStatus('idle');
                    }
                  }}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                />
                {cepLookupStatus === 'loading' && (
                  <p className="mt-1 text-[10px] text-slate-500">Buscando endereço...</p>
                )}
                {cepLookupStatus === 'found' && (
                  <p className="mt-1 text-[10px] text-emerald-700">Endereço preenchido pelo CEP.</p>
                )}
                {cepLookupStatus === 'notfound' && (
                  <p className="mt-1 text-[10px] text-amber-700">CEP não encontrado. Preencha manualmente.</p>
                )}
                {cepLookupStatus === 'error' && (
                  <p className="mt-1 text-[10px] text-amber-700">Não foi possível consultar o CEP. Preencha manualmente.</p>
                )}
              </div>

              <div className="md:col-span-3">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Logradouro (Rua / Av)
                </label>
                <input
                  type="text"
                  placeholder="Ex: Av. Brasil"
                  value={address}
                  onChange={e => setAddress(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Número
                </label>
                <input
                  type="text"
                  placeholder="120"
                  value={number}
                  onChange={e => setNumber(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Bairro
                </label>
                <input
                  type="text"
                  placeholder="Centro"
                  value={neighborhood}
                  onChange={e => setNeighborhood(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Cidade
                </label>
                <input
                  type="text"
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  placeholder="Ex: Almirante Tamandaré"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Estado (UF)
                </label>
                <input
                  type="text"
                  maxLength={2}
                  value={state}
                  onChange={e => setState(e.target.value.toUpperCase())}
                  placeholder="Ex: PR"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
                />
              </div>
            </div>
          </div>

          {/* LGPD Consents */}
          <div className="bg-emerald-50/50 p-4 rounded-xl border border-emerald-200/80 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-900 flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-emerald-700" />
                3. Consentimentos LGPD e Canais de Marketing
              </h3>
              <span className="text-[10px] text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full font-semibold">
                Lei Geral de Proteção de Dados
              </span>
            </div>

            <p className="text-[11px] text-slate-600">
              O Super Astral separa rigorosamente a identificação fiscal do cupom da autorização para envio de ofertas promocionais.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <label className="flex items-start gap-2.5 p-3 rounded-lg bg-white border border-slate-200 hover:border-emerald-400 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={whatsappMarketing}
                  onChange={e => setWhatsappMarketing(e.target.checked)}
                  className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                />
                <div>
                  <div className="text-xs font-bold text-slate-800">WhatsApp Marketing</div>
                  <div className="text-[10px] text-slate-500">Ofertas, cupons e Clube</div>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-3 rounded-lg bg-white border border-slate-200 hover:border-emerald-400 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={emailMarketing}
                  onChange={e => setEmailMarketing(e.target.checked)}
                  className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                />
                <div>
                  <div className="text-xs font-bold text-slate-800">E-mail Marketing</div>
                  <div className="text-[10px] text-slate-500">Encartes e novidades</div>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-3 rounded-lg bg-white border border-slate-200 hover:border-emerald-400 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={smsMarketing}
                  onChange={e => setSmsMarketing(e.target.checked)}
                  className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                />
                <div>
                  <div className="text-xs font-bold text-slate-800">SMS Marketing</div>
                  <div className="text-[10px] text-slate-500">Avisos urgentes</div>
                </div>
              </label>
            </div>
          </div>

          {/* Observações */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Observações Comerciais / Preferências do Cliente
            </label>
            <textarea
              rows={2}
              placeholder="Ex: Prefere receber ofertas de vinhos nos fins de semana. Tem preferência por carnes resfriadas."
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 outline-none"
            />
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-xl hover:bg-slate-100 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-600/20 transition-all"
            >
              <Save className="w-4 h-4" />
              Salvar Cliente
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
