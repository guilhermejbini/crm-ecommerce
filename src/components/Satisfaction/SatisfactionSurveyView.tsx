import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MessageSquareHeart, Play, RefreshCw, Save, ShieldOff, AlertTriangle, CheckCircle2, FlaskConical, PowerOff } from 'lucide-react';
import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, where } from 'firebase/firestore';
import { db } from '../../services/firebase';
import { apiFetch } from '../../services/api';
import { useCRM } from '../../context/CRMContext';
import {
  SURVEYS_COL,
  SURVEY_CONTACTS_COL,
  SURVEY_SETTINGS_DOC,
  SURVEY_STATUS_DOC,
  SURVEY_TEMPLATE_PREVIEW,
  SURVEY_BUTTONS,
  thankYouText,
  SKIP_REASON_LABELS,
  SURVEY_STATUS_LABELS,
  SatisfactionSurveyRecord,
  SurveySettings,
  normalizeSurveySettings
} from '../../services/satisfactionSurveyRules';

interface ServerStatus {
  whatsappConfigured: boolean;
  webhookConfigured: boolean;
  schedulerTokenConfigured: boolean;
  databaseAccess: boolean;
  databaseError?: string;
}

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateTime = (iso?: string) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const isManagerRole = (r?: string) => r === 'admin' || r === 'manager' || r === 'gestor';

type Filter = 'all' | 'sent' | 'answered' | 'comment' | 'skipped' | 'simulated' | 'failed';

const RUN_STATUS_TEXT: Record<string, string> = {
  ok: 'concluído',
  desligado: 'desligado',
  fora_do_horario: 'fora do horário de envio',
  em_andamento: 'outro envio já estava rodando',
  limite_diario: 'limite diário atingido',
  erro: 'erro'
};

export const SatisfactionSurveyView: React.FC = () => {
  const { currentUser, showToast, openCustomer360 } = useCRM();
  const isAdmin = currentUser.role === 'admin';
  const canRun = isManagerRole(currentUser.role);

  const [surveys, setSurveys] = useState<SatisfactionSurveyRecord[]>([]);
  const [settings, setSettings] = useState<SurveySettings>(normalizeSurveySettings(null));
  const [draft, setDraft] = useState<SurveySettings>(normalizeSurveySettings(null));
  const [lastRun, setLastRun] = useState<any>(null);
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const [snap, settingsSnap, statusSnap] = await Promise.all([
        getDocs(query(collection(db, SURVEYS_COL), where('createdAt', '>=', since), orderBy('createdAt', 'desc'), limit(2000))),
        getDoc(doc(db, 'settings', SURVEY_SETTINGS_DOC)),
        getDoc(doc(db, 'settings', SURVEY_STATUS_DOC))
      ]);
      setSurveys(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })));
      const s = normalizeSurveySettings(settingsSnap.exists() ? (settingsSnap.data() as any) : null);
      setSettings(s);
      setDraft(s);
      setLastRun(statusSnap.exists() ? (statusSnap.data() as any).lastRun || null : null);
    } catch (err: any) {
      console.error('[Pesquisa] Erro ao carregar:', err);
      showToast('Não foi possível carregar a pesquisa de satisfação.', 'error');
    } finally {
      setLoading(false);
    }
    try {
      const res = await apiFetch('/api/survey/status');
      if (res.ok) setServerStatus(await res.json());
    } catch {
      setServerStatus(null);
    }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  const stats = useMemo(() => {
    const sent = surveys.filter(s => s.status === 'sent');
    const answered = sent.filter(s => typeof s.rating === 'number');
    const avg = answered.length ? answered.reduce((t, s) => t + (s.rating || 0), 0) / answered.length : 0;
    const low = answered.filter(s => (s.rating || 0) <= 2);
    const byStore = new Map<string, { name: string; sent: number; answered: number; sum: number }>();
    for (const s of sent) {
      const key = s.storeId || s.storeName || 'sem-loja';
      const row = byStore.get(key) || { name: s.storeName || 'Sem loja', sent: 0, answered: 0, sum: 0 };
      row.sent++;
      if (typeof s.rating === 'number') { row.answered++; row.sum += s.rating; }
      byStore.set(key, row);
    }
    const attention = answered
      .filter(s => (s.rating || 0) <= 2 || ((s.rating || 0) <= 3 && s.comment))
      .sort((a, b) => String(b.answeredAt).localeCompare(String(a.answeredAt)));
    return {
      sent: sent.length,
      answered: answered.length,
      rate: sent.length ? Math.round((answered.length / sent.length) * 100) : 0,
      avg,
      low: low.length,
      comments: sent.filter(s => !!s.comment).length,
      simulated: surveys.filter(s => s.status === 'simulated').length,
      stores: [...byStore.values()].sort((a, b) => b.sent - a.sent),
      attention
    };
  }, [surveys]);

  const filtered = useMemo(() => surveys.filter(s => {
    if (filter === 'all') return true;
    if (filter === 'answered') return typeof s.rating === 'number';
    if (filter === 'comment') return !!s.comment;
    return s.status === filter;
  }).slice(0, 300), [surveys, filter]);

  const handleRun = async () => {
    setRunning(true);
    try {
      const res = await apiFetch('/api/survey/run', { method: 'POST', body: '{}' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Falha ao rodar o envio.');
      if (data.status !== 'ok') {
        showToast(`Envio não rodou: ${RUN_STATUS_TEXT[data.status] || data.status}.`, 'info');
      } else {
        showToast(`Pronto: ${data.sent} enviadas, ${data.simulated} em modo teste, ${data.skipped} não enviadas.`, 'success');
      }
      await load();
    } catch (err: any) {
      showToast(err?.message || 'Falha ao rodar o envio.', 'error');
    } finally {
      setRunning(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const clean = normalizeSurveySettings(draft);
      await setDoc(doc(db, 'settings', SURVEY_SETTINGS_DOC), {
        ...clean, updatedAt: new Date().toISOString(), updatedBy: currentUser.email
      }, { merge: true });
      setSettings(clean);
      setDraft(clean);
      showToast('Configurações da pesquisa salvas.', 'success');
    } catch (err: any) {
      showToast(err?.message || 'Não foi possível salvar.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleBlockCustomer = async (s: SatisfactionSurveyRecord) => {
    if (!s.customerId) return;
    try {
      await setDoc(doc(db, SURVEY_CONTACTS_COL, s.customerId), {
        optedOut: true, optedOutAt: new Date().toISOString(), optedOutBy: currentUser.email, origin: 'CRM'
      }, { merge: true });
      showToast(`${s.customerName || 'Cliente'} não vai mais receber a pesquisa.`, 'success');
    } catch (err: any) {
      showToast(err?.message || 'Não foi possível bloquear.', 'error');
    }
  };

  const banner = (() => {
    if (serverStatus && !serverStatus.databaseAccess) {
      return { tone: 'red', icon: AlertTriangle, title: 'O servidor ainda não tem acesso ao banco',
        text: 'O envio automático precisa da permissão da conta de serviço do Cloud Run no Firestore. Veja o passo a passo em PRODUCAO_CHECKLIST.md.' };
    }
    if (!settings.enabled) {
      return { tone: 'slate', icon: PowerOff, title: 'Pesquisa desligada', text: 'Nenhuma mensagem é preparada ou enviada.' };
    }
    if (serverStatus && !serverStatus.whatsappConfigured) {
      return { tone: 'amber', icon: FlaskConical, title: 'Modo teste',
        text: 'O CRM escolhe quem receberia a pesquisa e registra aqui, mas nenhuma mensagem sai. Para enviar de verdade, configure o WhatsApp Business no servidor.' };
    }
    return { tone: 'emerald', icon: CheckCircle2, title: 'Envio automático ligado',
      text: `${settings.sendWeekdays.map(d => WEEKDAY_LABELS[d]).join(', ')}, das ${settings.startHour}h às ${settings.endHour}h, para compras acima de ${brl(settings.minAmount)}.` };
  })();
  const toneClass: Record<string, string> = {
    red: 'bg-red-50 border-red-200 text-red-800',
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
    slate: 'bg-slate-50 border-slate-200 text-slate-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900'
  };
  const BannerIcon = banner.icon;

  const statusText = (s: SatisfactionSurveyRecord) => {
    if (s.status === 'skipped' && s.skipReason) return SKIP_REASON_LABELS[s.skipReason] || 'Não enviada';
    if (s.status === 'failed') return `Falhou${s.error ? `: ${s.error}` : ''}`;
    if (s.optedOut) return 'Pediu para parar';
    if (s.status === 'sent' && s.deliveryStatus === 'read') return 'Enviada e lida';
    return SURVEY_STATUS_LABELS[s.status] || s.status;
  };

  const ratingLabel = (r?: number) => (typeof r !== 'number' ? '' : r >= 4 ? `${r} · Gostei` : r === 3 ? '3 · Mais ou menos' : `${r} · Não gostei`);
  const field = 'w-full px-3 py-2 rounded-lg border border-slate-300 text-sm disabled:bg-slate-100';

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquareHeart className="w-5 h-5 text-emerald-600" />
            <h2 className="text-xl font-black text-slate-800 tracking-tight">Pesquisa de satisfação</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Depois da compra, o cliente recebe uma pergunta curta no WhatsApp. No máximo uma a cada {settings.cooldownDays} dias, só para quem autorizou.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void load()} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Atualizar
          </button>
          {canRun && (
            <button onClick={handleRun} disabled={running}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-astral-navy text-white text-sm font-semibold hover:opacity-90 disabled:opacity-50">
              <Play className="w-4 h-4" /> {running ? 'Rodando...' : 'Rodar agora'}
            </button>
          )}
        </div>
      </div>

      <div className={`rounded-2xl border p-4 flex gap-3 ${toneClass[banner.tone]}`}>
        <BannerIcon className="w-5 h-5 shrink-0 mt-0.5" />
        <div className="text-sm">
          <div className="font-bold">{banner.title}</div>
          <div>{banner.text}</div>
          {lastRun && (
            <div className="text-xs mt-1 opacity-80">
              Última verificação: {dateTime(lastRun.ranAt)} ({RUN_STATUS_TEXT[lastRun.status] || lastRun.status}
              {lastRun.status === 'ok' ? `, ${lastRun.sent} enviadas, ${lastRun.simulated} em teste, ${lastRun.skipped} não enviadas` : ''}).
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Enviadas (30 dias)', value: String(stats.sent), hint: stats.simulated ? `${stats.simulated} em modo teste` : '' },
          { label: 'Responderam', value: `${stats.answered}`, hint: `${stats.rate}% das enviadas · ${stats.comments} com comentário` },
          { label: 'Nota média', value: stats.answered ? stats.avg.toFixed(1).replace('.', ',') : '–', hint: 'de 1 a 5' },
          { label: 'Notas baixas', value: String(stats.low), hint: 'nota 1 ou 2' }
        ].map(k => (
          <div key={k.label} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
            <div className="text-xs text-slate-500 font-semibold">{k.label}</div>
            <div className="text-2xl font-black text-slate-800 mt-1">{k.value}</div>
            <div className="text-[11px] text-slate-400">{k.hint}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h3 className="text-sm font-bold text-slate-800 mb-3">Precisa de atenção</h3>
          {stats.attention.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma avaliação ruim nos últimos 30 dias.</p>
          ) : (
            <ul className="space-y-3 max-h-80 overflow-y-auto">
              {stats.attention.map(s => (
                <li key={s.id} className="border border-red-100 bg-red-50/40 rounded-xl p-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <button onClick={() => s.customerId && openCustomer360(s.customerId)} className="font-bold text-slate-800 hover:underline text-left">
                      {s.customerName || 'Cliente'}
                    </button>
                    <span className="text-xs font-bold text-red-700">{ratingLabel(s.rating)}</span>
                  </div>
                  <div className="text-xs text-slate-500">{s.storeName} · {brl(s.amount)} · {dateTime(s.answeredAt)}</div>
                  {s.comment && <p className="mt-1 text-slate-700 whitespace-pre-line">“{s.comment}”</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h3 className="text-sm font-bold text-slate-800 mb-3">Por loja (30 dias)</h3>
          {stats.stores.length === 0 ? (
            <p className="text-sm text-slate-500">Ainda não há pesquisas enviadas.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr className="text-xs text-slate-500 text-left"><th className="py-1">Loja</th><th>Enviadas</th><th>Respostas</th><th>Média</th></tr></thead>
              <tbody>
                {stats.stores.map(r => (
                  <tr key={r.name} className="border-t border-slate-100">
                    <td className="py-2 font-semibold text-slate-700">{r.name}</td>
                    <td>{r.sent}</td>
                    <td>{r.answered}</td>
                    <td className="font-bold">{r.answered ? (r.sum / r.answered).toFixed(1).replace('.', ',') : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <h3 className="text-sm font-bold text-slate-800">Histórico (30 dias)</h3>
          <div className="flex flex-wrap gap-1.5">
            {([['all', 'Todas'], ['sent', 'Enviadas'], ['answered', 'Responderam'], ['comment', 'Com comentário'], ['skipped', 'Não enviadas'], ['simulated', 'Modo teste'], ['failed', 'Falhas']] as [Filter, string][]).map(([id, label]) => (
              <button key={id} onClick={() => setFilter(id)}
                className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${filter === id ? 'bg-astral-navy text-white border-astral-navy' : 'bg-white text-slate-600 border-slate-300'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 text-left">
                <th className="py-2">Compra</th><th>Cliente</th><th>Loja</th><th>Valor</th><th>Situação</th><th>Nota</th><th>Comentário</th>{canRun && <th></th>}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-slate-500">{loading ? 'Carregando...' : 'Nada por aqui ainda.'}</td></tr>
              )}
              {filtered.map(s => (
                <tr key={s.id} className="border-t border-slate-100 align-top">
                  <td className="py-2 whitespace-nowrap">{dateTime(s.purchaseDate)}</td>
                  <td>
                    <button onClick={() => s.customerId && openCustomer360(s.customerId)} className="font-semibold text-slate-700 hover:underline text-left">
                      {s.customerName || '—'}
                    </button>
                  </td>
                  <td className="whitespace-nowrap">{s.storeName}</td>
                  <td className="whitespace-nowrap">{brl(s.amount || 0)}</td>
                  <td className="text-xs">{statusText(s)}</td>
                  <td className="whitespace-nowrap text-xs font-bold">{ratingLabel(s.rating)}</td>
                  <td className="text-xs text-slate-600 max-w-xs whitespace-pre-line">{s.comment}</td>
                  {canRun && (
                    <td>
                      {s.customerId && !s.optedOut && (
                        <button onClick={() => handleBlockCustomer(s)} title="Não enviar mais pesquisa para este cliente"
                          className="p-1.5 rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50">
                          <ShieldOff className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800">Regras de envio</h3>
            {!isAdmin && <span className="text-xs text-slate-400">Só o administrador altera</span>}
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" disabled={!isAdmin} checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />
            Envio automático ligado
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
            <label className="space-y-1"><span className="text-xs text-slate-500">Compras acima de (R$)</span>
              <input type="number" min={0} step="0.01" disabled={!isAdmin} className={field} value={draft.minAmount} onChange={e => setDraft({ ...draft, minAmount: Number(e.target.value) })} /></label>
            <label className="space-y-1"><span className="text-xs text-slate-500">Uma pesquisa a cada (dias)</span>
              <input type="number" min={1} disabled={!isAdmin} className={field} value={draft.cooldownDays} onChange={e => setDraft({ ...draft, cooldownDays: Number(e.target.value) })} /></label>
            <label className="space-y-1"><span className="text-xs text-slate-500">Compra de até (dias atrás)</span>
              <input type="number" min={0} max={7} disabled={!isAdmin} className={field} value={draft.maxPurchaseAgeDays} onChange={e => setDraft({ ...draft, maxPurchaseAgeDays: Number(e.target.value) })} /></label>
            <label className="space-y-1"><span className="text-xs text-slate-500">Começa às (hora)</span>
              <input type="number" min={0} max={23} disabled={!isAdmin} className={field} value={draft.startHour} onChange={e => setDraft({ ...draft, startHour: Number(e.target.value) })} /></label>
            <label className="space-y-1"><span className="text-xs text-slate-500">Para às (hora)</span>
              <input type="number" min={1} max={24} disabled={!isAdmin} className={field} value={draft.endHour} onChange={e => setDraft({ ...draft, endHour: Number(e.target.value) })} /></label>
            <label className="space-y-1"><span className="text-xs text-slate-500">Máximo por dia</span>
              <input type="number" min={1} disabled={!isAdmin} className={field} value={draft.dailyLimit} onChange={e => setDraft({ ...draft, dailyLimit: Number(e.target.value) })} /></label>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Dias de envio</div>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_LABELS.map((label, d) => {
                const on = draft.sendWeekdays.includes(d);
                return (
                  <button key={label} disabled={!isAdmin}
                    onClick={() => setDraft({ ...draft, sendWeekdays: on ? draft.sendWeekdays.filter(x => x !== d) : [...draft.sendWeekdays, d] })}
                    className={`px-3 py-1 rounded-full text-xs font-semibold border ${on ? 'bg-astral-navy text-white border-astral-navy' : 'bg-white text-slate-600 border-slate-300'} disabled:opacity-60`}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" disabled={!isAdmin} checked={draft.skipWithOpenTicket} onChange={e => setDraft({ ...draft, skipWithOpenTicket: e.target.checked })} />
            Não enviar para quem tem atendimento em aberto
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <label className="space-y-1"><span className="text-xs text-slate-500">Nome do modelo aprovado na Meta</span>
              <input disabled={!isAdmin} className={field} value={draft.templateName} onChange={e => setDraft({ ...draft, templateName: e.target.value })} /></label>
            <label className="space-y-1"><span className="text-xs text-slate-500">Idioma do modelo</span>
              <input disabled={!isAdmin} className={field} value={draft.templateLanguage} onChange={e => setDraft({ ...draft, templateLanguage: e.target.value })} /></label>
          </div>
          {isAdmin && (
            <button onClick={handleSave} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
              <Save className="w-4 h-4" /> {saving ? 'Salvando...' : 'Salvar regras'}
            </button>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-800">Mensagem que o cliente recebe</h3>
          <div className="rounded-xl bg-[#e7f7dc] p-3 text-sm text-slate-800 whitespace-pre-line">
            {SURVEY_TEMPLATE_PREVIEW.replace('{{1}}', 'Maria').replace('{{2}}', 'Super Astral Centro')}
          </div>
          <div className="grid gap-1.5">
            {SURVEY_BUTTONS.map(b => (
              <div key={b.payload} className="text-center text-sm font-semibold text-sky-700 bg-white border border-slate-200 rounded-lg py-1.5">{b.text}</div>
            ))}
          </div>
          <div className="text-xs text-slate-500">Depois que o cliente toca em "Gostei", recebe:</div>
          <div className="rounded-xl bg-[#e7f7dc] p-3 text-sm text-slate-800 whitespace-pre-line">{thankYouText(5)}</div>
          <p className="text-xs text-slate-500">
            O que ele escrever em seguida aparece aqui na tela, junto da nota (coluna Comentário). Não há outra mensagem depois disso. Quem responde PARAR não recebe mais.
          </p>
          {serverStatus && (
            <ul className="text-xs text-slate-600 space-y-1 pt-2 border-t border-slate-100">
              <li>WhatsApp Business: {serverStatus.whatsappConfigured ? 'configurado' : 'não configurado (modo teste)'}</li>
              <li>Recebimento de respostas: {serverStatus.webhookConfigured ? 'configurado' : 'não configurado'}</li>
              <li>Agendamento automático: {serverStatus.schedulerTokenConfigured ? 'configurado' : 'não configurado'}</li>
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
