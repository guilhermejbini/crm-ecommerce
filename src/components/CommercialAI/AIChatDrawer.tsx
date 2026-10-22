import React, { useState } from 'react';
import { 
  Bot, 
  X, 
  Send, 
  Sparkles, 
  RefreshCw, 
  Copy, 
  Check, 
  Lightbulb, 
  ChevronRight,
  TrendingUp,
  Award,
  Users
} from 'lucide-react';
import { useCRM } from '../../context/CRMContext';
import { apiFetch } from '../../services/api';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  time: string;
}

interface AIChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AIChatDrawer: React.FC<AIChatDrawerProps> = ({ isOpen, onClose }) => {
  const { customers, purchases, campaigns, metrics, showToast } = useCRM();

  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: 'Olá! Sou o Copiloto Comercial com Inteligência Artificial Gemini do Super Astral Supermercados.\n\nPosso analisar hábitos de compra no PDV, sugerir estratégias de retenção para clientes "Em Risco", calcular previsão de demanda para encartes ou redigir ofertas personalizadas de WhatsApp. Como posso ajudar agora?',
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    }
  ]);

  const quickQuestions = [
    'Quais as 3 melhores ações de hoje para evitar perda de clientes?',
    'Como incentivar mais compras nos dias de Hortifruti?',
    'Sugira uma mensagem de WhatsApp para clientes Campeões.',
    'Qual a taxa atual de identificação de CPF e como subir para 60%?'
  ];

  if (!isOpen) return null;

  const handleSendMessage = async (textToSend?: string) => {
    const query = textToSend || inputMessage;
    if (!query.trim() || isLoading) return;

    const userMsg: ChatMessage = {
      role: 'user',
      content: query.trim(),
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    };

    setMessages(prev => [...prev, userMsg]);
    setInputMessage('');
    setIsLoading(true);

    try {
      const rfmSummary: Record<string, number> = {};
      customers.forEach(c => {
        rfmSummary[c.rfmSegment] = (rfmSummary[c.rfmSegment] || 0) + 1;
      });

      const res = await apiFetch('/api/ai/crm-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: query.trim(),
          crmSummaryData: {
            totalCustomers: customers.length,
            totalRevenue: metrics.totalIdentifiedRevenue,
            averageTicket: metrics.averageIdentifiedTicket,
            captureRatePercent: metrics.captureRatePercent,
            rfmDistribution: rfmSummary,
            totalPurchases: purchases.length,
            activeCampaignsCount: campaigns.filter(c => c.status === 'Ativa').length
          },
          history: messages.slice(-8).map(({ role, content }) => ({ role, content }))
        })
      });

      if (!res.ok) {
        if (res.status === 401) {
          throw new Error('Sessão expirada ou não autenticada. Faça login novamente.');
        }
        if (res.status === 403) {
          throw new Error('Acesso negado: Sua conta não possui autorização ativa para acessar o CRM.');
        }
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Não foi possível obter resposta da IA. Tente novamente.');
      }
      const data = await res.json();

      if (!data.answer) {
        throw new Error('Não foi possível obter resposta da IA. Tente novamente.');
      }

      const aiMsg: ChatMessage = {
        role: 'assistant',
        content: data.answer,
        time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      };

      setMessages(prev => [...prev, aiMsg]);
    } catch (err: any) {
      console.error('[Copiloto IA] Erro na consulta:', err);
      showToast(err?.message || 'Não foi possível obter resposta da IA. Tente novamente.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyMessage = (content: string, index: number) => {
    navigator.clipboard.writeText(content);
    setCopiedIndex(index);
    showToast('Resposta copiada para a área de transferência!', 'success');
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/50 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-white h-full shadow-2xl flex flex-col border-l border-slate-200 animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-sm text-white">Copiloto Comercial IA</h3>
                <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.2 rounded font-bold uppercase">
                  Gemini Flash
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Conectado ao CRM Super Astral</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Insights Banner */}
        <div className="bg-slate-50 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between text-[11px] text-slate-600">
          <div className="flex items-center gap-1.5 font-medium">
            <Users className="w-3.5 h-3.5 text-slate-500" />
            <span>{customers.length} clientes</span>
            <span>•</span>
            <span>Ticket: R$ {metrics.averageIdentifiedTicket.toFixed(0)}</span>
          </div>
          <span className="text-emerald-700 font-bold bg-emerald-100/70 px-2 py-0.5 rounded">
            {metrics.captureRatePercent}% CPF Ativo
          </span>
        </div>

        {/* Messages list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 bg-slate-100/40 custom-scrollbar">
          {messages.map((msg, index) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={index}
                className={`flex items-start gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}
              >
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-xs ${
                    isUser
                      ? 'bg-slate-800 text-white'
                      : 'bg-emerald-600 text-white shadow-xs'
                  }`}
                >
                  {isUser ? 'U' : <Bot className="w-4 h-4" />}
                </div>

                <div
                  className={`max-w-[85%] rounded-2xl p-3 text-xs leading-relaxed space-y-1.5 shadow-xs relative group ${
                    isUser
                      ? 'bg-slate-900 text-white rounded-tr-none'
                      : 'bg-white text-slate-800 border border-slate-200 rounded-tl-none'
                  }`}
                >
                  <div className="whitespace-pre-line">{msg.content}</div>

                  <div className="flex items-center justify-between pt-1 text-[10px] text-slate-400 border-t border-slate-100/40">
                    <span>{msg.time}</span>
                    {!isUser && (
                      <button
                        onClick={() => handleCopyMessage(msg.content, index)}
                        className="opacity-60 hover:opacity-100 flex items-center gap-1 text-[10px] text-slate-500 hover:text-emerald-700"
                        title="Copiar texto"
                      >
                        {copiedIndex === index ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-600" /> Copiado
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" /> Copiar
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {isLoading && (
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center">
                <Bot className="w-4 h-4 animate-spin" />
              </div>
              <div className="bg-white p-3 rounded-2xl rounded-tl-none border border-slate-200 text-xs text-slate-500 flex items-center gap-2 shadow-xs">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                O Gemini está analisando os dados do Super Astral...
              </div>
            </div>
          )}
        </div>

        {/* Quick prompt suggestions */}
        <div className="p-3 bg-white border-t border-slate-200">
          <div className="text-[10px] font-bold uppercase text-slate-400 mb-1.5 flex items-center gap-1">
            <Lightbulb className="w-3 h-3 text-amber-500" />
            Sugestões Rápidas
          </div>
          <div className="flex flex-wrap gap-1.5">
            {quickQuestions.map((q, idx) => (
              <button
                key={idx}
                onClick={() => handleSendMessage(q)}
                disabled={isLoading}
                className="text-[11px] bg-slate-50 hover:bg-emerald-50 text-slate-700 hover:text-emerald-900 border border-slate-200 hover:border-emerald-300 px-2.5 py-1 rounded-lg text-left transition-colors truncate max-w-full"
              >
                {q}
              </button>
            ))}
          </div>
        </div>

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="p-3 bg-white border-t border-slate-200 flex items-center gap-2"
        >
          <input
            type="text"
            placeholder="Pergunte ao Copiloto Gemini..."
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            disabled={isLoading}
            className="flex-1 px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
          />
          <button
            type="submit"
            disabled={isLoading || !inputMessage.trim()}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            Enviar
          </button>
        </form>
      </div>
    </div>
  );
};
