import React, { useState } from 'react';
import { 
  Bot, 
  Send, 
  Sparkles, 
  TrendingUp, 
  Lightbulb, 
  MessageSquare, 
  RefreshCw, 
  Layers, 
  ArrowRight,
  ShieldCheck
} from 'lucide-react';
import { useCRM } from '../../context/CRMContext';
import { apiFetch } from '../../services/api';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  time: string;
}

export const CommercialAIView: React.FC = () => {
  const { customers, purchases, campaigns, showToast } = useCRM();

  const [inputMessage, setInputMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: 'Olá! Sou o Assistente de Inteligência Comercial do Super Astral Supermercados. Estou conectado à base de dados de clientes, histórico de cupons fiscais do PDV, segmentação RFM e campanhas de marketing. Como posso ajudar nas decisões comerciais e estratégicas hoje?',
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    }
  ]);

  const quickPrompts = [
    'Quais categorias têm maior correlação de compra nos finais de semana?',
    'Como reativar os clientes do segmento "Em Risco" sem sacrificar margem?',
    'Sugira uma campanha de WhatsApp para alavancar vendas de Hortifruti na terça-feira.',
    'Qual o perfil de consumo dos clientes do bairro Centro e Vila Rachel?'
  ];

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
      // Build relevant context for Gemini
      const rfmSummary: Record<string, number> = {};
      customers.forEach(c => {
        rfmSummary[c.rfmSegment] = (rfmSummary[c.rfmSegment] || 0) + 1;
      });

      const totalRev = purchases.reduce((acc, p) => acc + (p.netAmount || 0), 0);

      const res = await apiFetch('/api/ai/crm-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: query.trim(),
          crmSummaryData: {
            totalCustomers: customers.length,
            totalRevenue: totalRev,
            rfmDistribution: rfmSummary,
            totalPurchases: purchases.length,
            activeCampaignsCount: campaigns.length
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
      console.error('[Copiloto IA] Erro no painel comercial:', err);
      showToast(err?.message || 'Não foi possível obter resposta da IA. Tente novamente.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="w-5 h-5 text-emerald-600" />
            <h2 className="text-xl font-black text-slate-800 tracking-tight">
              Inteligência Comercial & Copiloto com Gemini
            </h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Análises estratégicas, correlações de cesta de compras e recomendações com IA conectada aos dados do Super Astral.
          </p>
        </div>
      </div>

      {/* Suggested Quick Prompts */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {quickPrompts.map((prompt, idx) => (
          <button
            key={idx}
            onClick={() => handleSendMessage(prompt)}
            className="p-3 bg-white hover:bg-emerald-50/50 border border-slate-200 hover:border-emerald-300 rounded-xl text-left text-xs text-slate-700 transition-all flex items-start gap-2 shadow-xs group"
          >
            <Lightbulb className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
            <span className="font-medium group-hover:text-emerald-950">{prompt}</span>
          </button>
        ))}
      </div>

      {/* Chat Container */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[550px]">
        {/* Chat Messages Log */}
        <div className="flex-1 p-6 overflow-y-auto space-y-4 bg-slate-50/50">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={`flex items-start gap-3 ${
                msg.role === 'user' ? 'flex-row-reverse' : ''
              }`}
            >
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                  msg.role === 'user'
                    ? 'bg-slate-900 text-white'
                    : 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
                }`}
              >
                {msg.role === 'user' ? 'U' : <Bot className="w-4 h-4" />}
              </div>

              <div
                className={`max-w-[80%] p-4 rounded-2xl text-xs leading-relaxed space-y-1 shadow-xs ${
                  msg.role === 'user'
                    ? 'bg-slate-900 text-white rounded-tr-none'
                    : 'bg-white text-slate-800 border border-slate-200 rounded-tl-none'
                }`}
              >
                <div className="whitespace-pre-line font-normal">
                  {msg.content}
                </div>
                <div
                  className={`text-[9px] text-right ${
                    msg.role === 'user' ? 'text-slate-400' : 'text-slate-400'
                  }`}
                >
                  {msg.time}
                </div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center">
                <Bot className="w-4 h-4 animate-spin" />
              </div>
              <div className="p-4 bg-white border border-slate-200 rounded-2xl rounded-tl-none text-xs text-slate-500 flex items-center gap-2">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                O Gemini está analisando os dados do Super Astral...
              </div>
            </div>
          )}
        </div>

        {/* Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="p-4 bg-white border-t border-slate-200 flex items-center gap-3"
        >
          <input
            type="text"
            placeholder="Faça uma pergunta sobre faturamento, produtos, margem ou clientes..."
            value={inputMessage}
            onChange={e => setInputMessage(e.target.value)}
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
          />
          <button
            type="submit"
            disabled={isLoading || !inputMessage.trim()}
            className="flex items-center gap-1.5 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-md shadow-emerald-600/20 transition-all"
          >
            <Send className="w-4 h-4" />
            Enviar
          </button>
        </form>
      </div>
    </div>
  );
};
