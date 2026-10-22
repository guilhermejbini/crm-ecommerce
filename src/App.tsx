import React from 'react';
import { CRMProvider, useCRM } from './context/CRMContext';
import { Sidebar } from './components/Layout/Sidebar';
import { Header } from './components/Layout/Header';
import { DashboardView } from './components/Dashboard/DashboardView';
import { CustomerListView } from './components/Customers/CustomerListView';
import { Customer360View } from './components/Customers/Customer360View';
import { PurchaseListView } from './components/Purchases/PurchaseListView';
import { OnlineOrdersView } from './components/OnlineOrders/OnlineOrdersView';
import { RFMSegmentationView } from './components/RFM/RFMSegmentationView';
import { NBAView } from './components/NBA/NBAView';
import { CampaignListView } from './components/Campaigns/CampaignListView';
import { LoyaltyClubView } from './components/Loyalty/LoyaltyClubView';
import { CouponListView } from './components/Coupons/CouponListView';
import { SupportTicketsView } from './components/Support/SupportTicketsView';
import { CommercialAIView } from './components/CommercialAI/CommercialAIView';
import { LGPDComplianceView } from './components/LGPD/LGPDComplianceView';
import { SettingsView } from './components/Settings/SettingsView';
import { CustomerMapView } from './components/Map/CustomerMapView';
import { CustomerModal } from './components/Customers/CustomerModal';
import { PDVImportModal } from './components/Purchases/PDVImportModal';
import { AIChatDrawer } from './components/CommercialAI/AIChatDrawer';
import { AICampaignModal } from './components/Campaigns/AICampaignModal';
import { CustomerImportModal } from './components/Customers/CustomerImportModal';
import { Loader2, CheckCircle2, AlertCircle, Info, X } from 'lucide-react';
import { LoginView } from './components/Auth/LoginView';
import { UnauthorizedView } from './components/Auth/UnauthorizedView';
import { canAccessView, canImport, canWriteCustomers } from './utils/permissions';

const MainLayout: React.FC = () => {
  const { 
    currentView, 
    isLoading,
    customers,
    dashboardMetrics,
    isNewCustomerModalOpen,
    setIsNewCustomerModalOpen,
    isPDVImportModalOpen,
    setIsPDVImportModalOpen,
    isCustomerImportModalOpen,
    setIsCustomerImportModalOpen,
    isAIChatOpen,
    setIsAIChatOpen,
    isAICampaignModalOpen,
    setIsAICampaignModalOpen,
    toastMessage,
    authLoading,
    isAuthenticated,
    isAuthorized,
    unauthorizedEmail,
    logout,
    refreshData,
    currentUser
  } = useCRM();

  if (authLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-950 text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-600/30">
            <Loader2 className="w-6 h-6 animate-spin text-white" />
          </div>
          <p className="text-xs text-slate-400">Validando autorização segura...</p>
        </div>
      </div>
    );
  }

  // Se a conta Google autenticada não possui autorização prévia ativa: bloqueio estrito
  if (unauthorizedEmail || (!isAuthorized && isAuthenticated)) {
    return <UnauthorizedView email={unauthorizedEmail || ''} onLogout={logout} />;
  }

  if (!isAuthenticated || !isAuthorized) {
    return <LoginView onAuthenticated={refreshData} />;
  }

  // Only display full-screen blocking loader on initial application hydration if no data is present
  if (isLoading && customers.length === 0 && !dashboardMetrics) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-slate-900 text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-600/30">
            <Loader2 className="w-6 h-6 animate-spin text-white" />
          </div>
          <h1 className="text-sm font-bold tracking-wider uppercase text-emerald-400">
            CRM Super Astral
          </h1>
          <p className="text-xs text-slate-400">
            Carregando banco de dados e inteligência comercial...
          </p>
        </div>
      </div>
    );
  }

  const renderView = () => {
    // Tela sem permissão para o perfil (ex.: Consulta em LGPD/Configurações) cai no Dashboard
    if (!canAccessView(currentUser.role, currentView)) {
      return <DashboardView />;
    }
    switch (currentView) {
      case 'dashboard':
        return <DashboardView />;
      case 'customers':
        return <CustomerListView />;
      case 'customer360':
        return <Customer360View />;
      case 'purchases':
        return <PurchaseListView />;
      case 'onlineOrders':
        return <OnlineOrdersView />;
      case 'map':
        return <CustomerMapView />;
      case 'rfm':
      case 'segments':
        return <RFMSegmentationView />;
      case 'nba':
      case 'opportunities':
        return <NBAView />;
      case 'campaigns':
        return <CampaignListView />;
      case 'loyalty':
        return <LoyaltyClubView />;
      case 'coupons':
        return <CouponListView />;
      case 'support':
        return <SupportTicketsView />;
      case 'ai':
        return <CommercialAIView />;
      case 'lgpd':
        return <LGPDComplianceView />;
      case 'settings':
        return <SettingsView />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="flex h-screen bg-slate-100/70 overflow-hidden font-sans text-slate-900 antialiased relative">
      {/* Sidebar Navigation */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header />
        
        <main className="flex-1 overflow-y-auto bg-slate-100/60">
          {renderView()}
        </main>
      </div>

      {/* Global Modals */}
      {isNewCustomerModalOpen && canWriteCustomers(currentUser.role) && (
        <CustomerModal
          isOpen={isNewCustomerModalOpen}
          onClose={() => setIsNewCustomerModalOpen(false)}
        />
      )}

      {isPDVImportModalOpen && canImport(currentUser.role) && (
        <PDVImportModal
          isOpen={isPDVImportModalOpen}
          onClose={() => setIsPDVImportModalOpen(false)}
        />
      )}

      {isCustomerImportModalOpen && canImport(currentUser.role) && (
        <CustomerImportModal
          isOpen={isCustomerImportModalOpen}
          onClose={() => setIsCustomerImportModalOpen(false)}
        />
      )}

      {isAIChatOpen && (
        <AIChatDrawer
          isOpen={isAIChatOpen}
          onClose={() => setIsAIChatOpen(false)}
        />
      )}

      {isAICampaignModalOpen && (
        <AICampaignModal
          isOpen={isAICampaignModalOpen}
          onClose={() => setIsAICampaignModalOpen(false)}
        />
      )}

      {/* Toast Feedback Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 animate-in slide-in-from-bottom-5 fade-in duration-200">
          <div className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-xl border text-xs font-semibold max-w-md ${
            toastMessage.type === 'success' 
              ? 'bg-slate-900 text-white border-slate-800' 
              : toastMessage.type === 'error'
              ? 'bg-rose-950 text-rose-100 border-rose-800'
              : 'bg-slate-800 text-white border-slate-700'
          }`}>
            {toastMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
            {toastMessage.type === 'error' && <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />}
            {toastMessage.type === 'info' && <Info className="w-4 h-4 text-blue-400 shrink-0" />}
            <span className="flex-1 leading-tight">{toastMessage.text}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default function App() {
  return (
    <CRMProvider>
      <MainLayout />
    </CRMProvider>
  );
}
