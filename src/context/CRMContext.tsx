import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { 
  Customer, 
  Purchase, 
  Campaign, 
  Coupon, 
  Interaction, 
  CRMTask, 
  Segment, 
  Store, 
  AuditLog, 
  UserProfile, 
  DashboardMetrics,
  RFMConfig,
  ClubOffer,
  ClubOfferUsage,
  ClubOfferStatus,
  AuthorizedUser
} from '../types/crm';
import { 
  initializeDatabase,
  invalidateCache,
  getCustomers, 
  getPurchases, 
  getCampaigns, 
  getCoupons, 
  getInteractions, 
  getTasks, 
  getSegments, 
  getStores, 
  getAuditLogs, 
  getClubOffers,
  saveClubOffer,
  deleteClubOffer,
  toggleClubOfferStatus,
  duplicateClubOffer,
  getClubOfferUsages,
  recordClubOfferUsage,
  toggleCustomerClubStatus,
  saveCustomer, 
  updateCustomerFields,
  saveRFMChanges,
  getRFMLastRecalculatedDay,
  rfmDayKey,
  saveCustomersBatch,
  deleteCustomer, 
  anonymizeCustomerLGPD,
  importPurchasesBatch,
  importCustomersBatch,
  CustomerImportProgress,
  CustomerImportResult,
  PDVImportProgress,
  PDVImportResult,
  saveCampaign,
  deleteCampaign,
  toggleCampaignStatus,
  saveCoupon,
  deleteCoupon,
  toggleCouponStatus,
  saveInteraction,
  saveTask,
  saveSegment,
  calculateDashboardMetrics,
  getDashboardMetrics,
  DEFAULT_LOYALTY_CONFIG
} from '../services/firestoreService';
import { recalculateCustomersRFM } from '../services/rfmCalculator';
import { DEFAULT_RFM_CONFIG, calculateRecencyScore, calculateFrequencyScore, calculateMonetaryScore, determineRFMSegment, calculateCustomerRFM, computeRFMWindowMetrics, getRFMWindowDays } from '../services/rfmCalculator';
import { 
  subscribeToAuth, 
  checkUserAuthorization, 
  logout as firebaseLogout,
  getAuthorizedUsers,
  authorizeNewUser,
  toggleUserActiveStatus,
  updateUserRole,
  removeUserAuthorization
} from '../services/authService';
import { User } from 'firebase/auth';
import { apiFetch } from '../services/api';

export type AppView = 
  | 'dashboard' 
  | 'customers' 
  | 'customer360' 
  | 'purchases' 
  | 'onlineOrders'
  | 'map'
  | 'rfm' 
  | 'segments' 
  | 'loyalty' 
  | 'campaigns' 
  | 'coupons' 
  | 'support' 
  | 'opportunities' 
  | 'nba'
  | 'ai'
  | 'lgpd' 
  | 'settings';

interface CRMContextType {
  // Navigation & User
  currentView: AppView;
  setCurrentView: (view: AppView) => void;
  currentUser: UserProfile;
  setCurrentUser: (user: UserProfile) => void;
  authLoading: boolean;
  isAuthenticated: boolean;
  isAuthorized: boolean;
  unauthorizedEmail: string | null;
  logout: () => Promise<void>;

  // Authorized Users Management (Admin)
  authorizedUsers: AuthorizedUser[];
  loadAuthorizedUsers: () => Promise<void>;
  handleAuthorizeUser: (data: { name: string; email: string; role: 'admin' | 'manager' | 'viewer' }) => Promise<void>;
  handleToggleUserStatus: (user: AuthorizedUser, active: boolean) => Promise<void>;
  handleUpdateUserRole: (user: AuthorizedUser, role: 'admin' | 'manager' | 'viewer') => Promise<void>;
  handleRemoveAuthorizedUser: (user: AuthorizedUser) => Promise<void>;
  
  // Data
  customers: Customer[];
  purchases: Purchase[];
  campaigns: Campaign[];
  coupons: Coupon[];
  clubOffers: ClubOffer[];
  clubOfferUsages: ClubOfferUsage[];
  interactions: Interaction[];
  tasks: CRMTask[];
  segments: Segment[];
  stores: Store[];
  auditLogs: AuditLog[];
  metrics: DashboardMetrics;
  rfmConfig: RFMConfig;
  setRfmConfig: (config: RFMConfig) => void;
  
  // Loading & State
  isLoading: boolean;
  selectedCustomerId: string | null;
  openCustomer360: (customerId: string) => void;
  
  // Modals & UI helpers
  isAIChatOpen: boolean;
  setIsAIChatOpen: (open: boolean) => void;
  isNewCustomerModalOpen: boolean;
  setIsNewCustomerModalOpen: (open: boolean) => void;
  isPDVImportModalOpen: boolean;
  setIsPDVImportModalOpen: (open: boolean) => void;
  isCustomerImportModalOpen: boolean;
  setIsCustomerImportModalOpen: (open: boolean) => void;
  isAICampaignModalOpen: boolean;
  setIsAICampaignModalOpen: (open: boolean) => void;
  globalSearchQuery: string;
  setGlobalSearchQuery: (query: string) => void;
  
  // Toast notifications
  toastMessage: { text: string; type: 'success' | 'error' | 'info' } | null;
  showToast: (text: string, type?: 'success' | 'error' | 'info') => void;
  
  // Actions
  handleSaveCustomer: (customer: Customer) => Promise<Customer>;
  /** Edição parcial: só os campos do patch; clearFields são apagados. Não sobrescreve o cadastro inteiro. */
  handleUpdateCustomer: (id: string, patch: Partial<Customer>, clearFields?: string[], options?: { silent?: boolean }) => Promise<Customer>;
  handleDeleteCustomer: (id: string) => Promise<void>;
  handleAnonymizeCustomer: (id: string) => Promise<void>;
  handleImportCustomers: (customers: Customer[], onProgress?: (p: CustomerImportProgress) => void) => Promise<CustomerImportResult>;
  handleImportPurchases: (
    newPurchases: Purchase[], 
    autoCreate: boolean,
    onProgress?: (p: PDVImportProgress) => void
  ) => Promise<PDVImportResult>;
  handleSaveCampaign: (campaign: Campaign) => Promise<Campaign>;
  handleDeleteCampaign: (id: string) => Promise<void>;
  handleToggleCampaignStatus: (id: string) => Promise<void>;
  handleSaveCoupon: (coupon: Coupon) => Promise<Coupon>;
  handleDeleteCoupon: (id: string) => Promise<void>;
  handleToggleCouponStatus: (id: string) => Promise<void>;
  handleSaveClubOffer: (offer: ClubOffer) => Promise<ClubOffer>;
  handleDeleteClubOffer: (id: string) => Promise<void>;
  handleToggleClubOfferStatus: (id: string, status: ClubOfferStatus) => Promise<void>;
  handleDuplicateClubOffer: (id: string) => Promise<ClubOffer | null>;
  handleRecordClubOfferUsage: (usage: Omit<ClubOfferUsage, 'id' | 'usedAt'>) => Promise<ClubOfferUsage>;
  handleToggleCustomerClubStatus: (customerId: string, isClubMember: boolean) => Promise<void>;
  handleSaveInteraction: (interaction: Interaction) => Promise<Interaction>;
  handleSaveTask: (task: CRMTask) => Promise<CRMTask>;
  handleSaveSegment: (segment: Segment) => Promise<Segment>;
  handleRecalculateAllRFM: () => Promise<void>;
  handleGeocodeCustomer: (customerId: string) => Promise<boolean>;
  handleGeocodeAllPending: () => Promise<number>;
  refreshData: (options?: { forceRefresh?: boolean }) => Promise<void>;
  isSyncing: boolean;
}

const INITIAL_GUEST_USER: UserProfile = {
  id: '',
  email: '',
  name: 'Aguardando login...',
  role: 'viewer',
  roleTitle: 'Aguardando autorização',
  storeAccess: []
};

const CRMContext = createContext<CRMContextType | undefined>(undefined);

export const CRMProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentView, setCurrentView] = useState<AppView>('dashboard');
  const [currentUser, setCurrentUser] = useState<UserProfile>(INITIAL_GUEST_USER);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [unauthorizedEmail, setUnauthorizedEmail] = useState<string | null>(null);
  const [authorizedUsers, setAuthorizedUsers] = useState<AuthorizedUser[]>([]);
  
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [clubOffers, setClubOffers] = useState<ClubOffer[]>([]);
  const [clubOfferUsages, setClubOfferUsages] = useState<ClubOfferUsage[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [tasks, setTasks] = useState<CRMTask[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [rfmConfig, setRfmConfig] = useState<RFMConfig>(DEFAULT_RFM_CONFIG);
  
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  
  const [isAIChatOpen, setIsAIChatOpen] = useState<boolean>(false);
  const [isNewCustomerModalOpen, setIsNewCustomerModalOpen] = useState<boolean>(false);
  const [isPDVImportModalOpen, setIsPDVImportModalOpen] = useState<boolean>(false);
  const [isCustomerImportModalOpen, setIsCustomerImportModalOpen] = useState<boolean>(false);
  const [isAICampaignModalOpen, setIsAICampaignModalOpen] = useState<boolean>(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState<string>('');
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);

  const [dashboardMetrics, setDashboardMetrics] = useState<DashboardMetrics | null>(null);

  const showToast = useCallback((text: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToastMessage({ text, type });
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  }, []);

  const refreshData = useCallback(async (options: { forceRefresh?: boolean } = {}) => {
    const isManual = options.forceRefresh === true;
    if (isManual) {
      setIsSyncing(true);
    } else {
      setIsLoading(true);
    }

    try {
      if (isManual) {
        // Sincronização manual solicitada pelo usuário:
        // Invalida os caches de módulo em memória para forçar leitura real das coleções do Firestore
        invalidateCache('all');
      } else {
        // Inicialização padrão ou refresh interno:
        // Garante que a estrutura inicial e lojas reais estejam garantidas uma única vez
        await initializeDatabase();
      }

      const [c, p, camp, coup, offers, usages, inter, t, seg, st, logs, m] = await Promise.all([
        getCustomers({ forceRefresh: isManual }),
        getPurchases({ forceRefresh: isManual }),
        getCampaigns({ forceRefresh: isManual }),
        getCoupons({ forceRefresh: isManual }),
        getClubOffers({ forceRefresh: isManual }),
        getClubOfferUsages(undefined, undefined, { forceRefresh: isManual }),
        getInteractions({ forceRefresh: isManual }),
        getTasks({ forceRefresh: isManual }),
        getSegments({ forceRefresh: isManual }),
        getStores({ forceRefresh: isManual }),
        getAuditLogs({ forceRefresh: isManual }),
        getDashboardMetrics({ forceRefresh: isManual })
      ]);

      setCustomers(c);
      setPurchases(p);
      setCampaigns(camp);
      setCoupons(coup);
      setClubOffers(offers);
      setClubOfferUsages(usages);
      setInteractions(inter);
      setTasks(t);
      setSegments(seg);
      setStores(st);
      setAuditLogs(logs);
      setDashboardMetrics(m);

      if (isManual) {
        showToast('Dados sincronizados.', 'success');
      }
    } catch (err: any) {
      const isQuota = err?.code === 'resource-exhausted' || err?.message?.includes('Quota limit exceeded');
      if (isQuota) {
        console.warn('[CRM Context] Cota de leitura do Firestore em repouso diário.');
        showToast('Limite temporário de leitura do Firestore atingido.', 'error');
      } else {
        console.error('Erro ao sincronizar dados do CRM:', err?.message || err);
        if (isManual) {
          showToast('Não foi possível sincronizar os dados.', 'error');
        }
      }
    } finally {
      if (isManual) {
        setIsSyncing(false);
      }
      setIsLoading(false);
    }
  }, [showToast]);

  const loadAuthorizedUsers = useCallback(async () => {
    try {
      const list = await getAuthorizedUsers();
      setAuthorizedUsers(list);
    } catch (err: any) {
      console.warn('Aviso ao listar usuários autorizados:', err);
    }
  }, []);

  const handleAuthorizeUser = useCallback(
    async (data: { name: string; email: string; role: 'admin' | 'manager' | 'viewer' }) => {
      try {
        const created = await authorizeNewUser(data, currentUser);
        await loadAuthorizedUsers();
        showToast(
          `Usuário ${created.name} (${created.email}) autorizado com sucesso como ${created.role === 'admin' ? 'Admin' : created.role === 'manager' ? 'Gestor' : 'Consulta'}!`,
          'success'
        );
      } catch (err: any) {
        showToast(err?.message || 'Erro ao autorizar usuário.', 'error');
        throw err;
      }
    },
    [currentUser, loadAuthorizedUsers, showToast]
  );

  const handleToggleUserStatus = useCallback(
    async (user: AuthorizedUser, active: boolean) => {
      try {
        await toggleUserActiveStatus(user, active, currentUser);
        await loadAuthorizedUsers();
        showToast(`Acesso de ${user.name} ${active ? 'ativado' : 'desativado'} com sucesso!`, 'success');
      } catch (err: any) {
        showToast(err?.message || 'Erro ao alterar status do usuário.', 'error');
        throw err;
      }
    },
    [currentUser, loadAuthorizedUsers, showToast]
  );

  const handleUpdateUserRole = useCallback(
    async (user: AuthorizedUser, role: 'admin' | 'manager' | 'viewer') => {
      try {
        await updateUserRole(user, role, currentUser);
        await loadAuthorizedUsers();
        showToast(
          `Perfil de ${user.name} atualizado para ${role === 'admin' ? 'Admin' : role === 'manager' ? 'Gestor' : 'Consulta'}!`,
          'success'
        );
      } catch (err: any) {
        showToast(err?.message || 'Erro ao atualizar perfil do usuário.', 'error');
        throw err;
      }
    },
    [currentUser, loadAuthorizedUsers, showToast]
  );

  const handleRemoveAuthorizedUser = useCallback(
    async (user: AuthorizedUser) => {
      try {
        await removeUserAuthorization(user, currentUser);
        await loadAuthorizedUsers();
        showToast(`Autorização de ${user.name} removida com sucesso!`, 'success');
      } catch (err: any) {
        showToast(err?.message || 'Erro ao remover autorização do usuário.', 'error');
        throw err;
      }
    },
    [currentUser, loadAuthorizedUsers, showToast]
  );

  useEffect(() => {
    const unsubscribe = subscribeToAuth(async (user: User | null) => {
      if (!user) {
        setIsAuthenticated(false);
        setIsAuthorized(false);
        setUnauthorizedEmail(null);
        setCurrentUser(INITIAL_GUEST_USER);
        setAuthLoading(false);
        setIsLoading(false);
        return;
      }

      setAuthLoading(true);
      try {
        // Regra fundamental: Consulta autorização do usuário Google no Firestore
        const authResult = await checkUserAuthorization(user);
        if (!authResult.isAuthorized) {
          console.warn('[CRM Security] Acesso bloqueado: Conta Google não autorizada:', authResult.email);
          setIsAuthenticated(false);
          setIsAuthorized(false);
          setCurrentUser(INITIAL_GUEST_USER);
          setUnauthorizedEmail(authResult.email || user.email || '');
          setIsLoading(false);
          return;
        }

        // Usuário confirmado e com autorização ativa
        setIsAuthorized(true);
        setUnauthorizedEmail(null);
        setCurrentUser(authResult.profile!);
        setIsAuthenticated(true);
      } catch (err: any) {
        console.error('[CRM Security] Erro ao validar autorização do usuário:', err);
        setIsAuthenticated(false);
        setIsAuthorized(false);
        setCurrentUser(INITIAL_GUEST_USER);
        setUnauthorizedEmail(user.email || '');
        setIsLoading(false);
      } finally {
        setAuthLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    // Ordem estrita de inicialização: APENAS executa initializeDatabase() e refreshData() SE autenticado E autorizado
    if (isAuthenticated && isAuthorized) {
      refreshData();
    }
  }, [isAuthenticated, isAuthorized, refreshData]);

  const logout = useCallback(async () => {
    await firebaseLogout();
    setIsAuthenticated(false);
    setIsAuthorized(false);
    setUnauthorizedEmail(null);
    setSelectedCustomerId(null);
    setCurrentUser(INITIAL_GUEST_USER);
    setCurrentView('dashboard');
  }, []);

  const openCustomer360 = (customerId: string) => {
    setSelectedCustomerId(customerId);
    setCurrentView('customer360');
  };

  const handleSaveCustomer = async (cust: Customer) => {
    const saved = await saveCustomer(cust, currentUser);
    const updated = await getCustomers();
    setCustomers([...updated]);
    const m = await getDashboardMetrics();
    setDashboardMetrics(m);
    showToast(`Cliente ${saved.name} salvo com sucesso!`, 'success');
    return saved;
  };

  const handleUpdateCustomer = async (id: string, patch: Partial<Customer>, clearFields: string[] = [], options?: { silent?: boolean }) => {
    const saved = await updateCustomerFields(id, patch, clearFields, currentUser);
    const updated = await getCustomers();
    setCustomers([...updated]);
    const m = await getDashboardMetrics();
    setDashboardMetrics(m);
    if (!options?.silent) showToast(`Cliente ${saved.name} salvo com sucesso!`, 'success');
    return saved;
  };

  const handleDeleteCustomer = async (id: string) => {
    if (currentUser.role !== 'admin') {
      showToast('Permissão negada: Somente administradores do CRM podem excluir clientes.', 'error');
      return;
    }
    await deleteCustomer(id, currentUser);
    const updated = await getCustomers();
    setCustomers([...updated]);
    const m = await getDashboardMetrics();
    setDashboardMetrics(m);
    showToast('Cliente excluído.', 'info');
    if (selectedCustomerId === id) {
      setSelectedCustomerId(null);
      setCurrentView('customers');
    }
  };

  const handleAnonymizeCustomer = async (id: string) => {
    // Direito ao esquecimento é irreversível: exclusivo do administrador
    if (currentUser.role !== 'admin') {
      showToast('Permissão negada: somente administradores podem anonimizar dados de clientes.', 'error');
      return;
    }
    try {
      const anonymized = await anonymizeCustomerLGPD(id, currentUser);
      // O titular pode ter recebido um ID novo (o antigo continha CPF)
      if (anonymized && selectedCustomerId === id && anonymized.id !== id) {
        setSelectedCustomerId(anonymized.id);
      }
      const updated = await getCustomers({ forceRefresh: true });
      setCustomers([...updated]);
      // Compras, atendimentos, tarefas e uso de ofertas também foram anonimizados
      const [p, inter, t, usages] = await Promise.all([
        getPurchases({ forceRefresh: true }),
        getInteractions({ forceRefresh: true }),
        getTasks({ forceRefresh: true }),
        getClubOfferUsages(undefined, undefined, { forceRefresh: true })
      ]);
      setPurchases([...p]);
      setInteractions([...inter]);
      setTasks([...t]);
      setClubOfferUsages([...usages]);
      const m = await getDashboardMetrics({ forceRefresh: true });
      setDashboardMetrics(m);
      showToast('Cliente anonimizado com sucesso conforme LGPD.', 'success');
    } catch (err: any) {
      console.error('[LGPD] Falha na anonimização do cliente:', err);
      showToast(err?.message || 'Falha ao processar anonimização do cliente.', 'error');
      throw err;
    }
  };

  const handleImportCustomers = async (
    customersToImport: Customer[], 
    onProgress?: (progress: CustomerImportProgress) => void
  ) => {
    const res = await importCustomersBatch(customersToImport, currentUser, onProgress);
    if (res.persistedCount > 0) {
      const allCusts = await getCustomers();
      setCustomers([...allCusts]);
      const metrics = await getDashboardMetrics();
      setDashboardMetrics(metrics);
      showToast(
        `Importação concluída! ${res.persistedCount.toLocaleString('pt-BR')} registros gravados no Firestore (${res.importedCount} novos, ${res.updatedCount} atualizados).`, 
        'success'
      );
    } else {
      showToast(
        `⚠️ A leitura do arquivo funcionou (${res.totalFound} registros), mas nenhum cliente foi gravado no banco de dados. ${res.lastErrorMessage ? `Erro: ${res.lastErrorMessage}` : ''}`,
        'error'
      );
    }
    return res;
  };

  const handleImportPurchases = async (
    newPurchases: Purchase[], 
    autoCreate: boolean,
    onProgress?: (p: PDVImportProgress) => void
  ): Promise<PDVImportResult> => {
    const res = await importPurchasesBatch(newPurchases, currentUser, autoCreate, onProgress);
    if (res.persistedCount > 0) {
      const allPurchases = await getPurchases();
      setPurchases([...allPurchases]);
      const allCusts = await getCustomers();
      setCustomers([...allCusts]);
      const metrics = await getDashboardMetrics();
      setDashboardMetrics(metrics);
      showToast(
        `Importação PDV concluída: ${res.persistedCount.toLocaleString('pt-BR')} cupons gravados, ${res.newCustomersCount} novos clientes e ${res.linkedCustomersCount} atualizados no Firestore.`, 
        'success'
      );
    } else if (res.duplicatesCount && res.duplicatesCount > 0) {
      showToast(
        `Importação concluída: ${res.duplicatesCount.toLocaleString('pt-BR')} cupons já existiam no Firestore (duplicados ignorados sem alterar métricas).`, 
        'info'
      );
    } else if (newPurchases.length > 0) {
      showToast(
        `Nenhum cupom gravado no Firestore. ${res.lastErrorMessage ? `Erro: ${res.lastErrorMessage}` : 'Verifique os dados.'}`, 
        'error'
      );
    }
    return res;
  };

  const handleSaveCampaign = async (camp: Campaign) => {
    const saved = await saveCampaign(camp, currentUser);
    const updated = await getCampaigns();
    setCampaigns([...updated]);
    showToast(`Campanha "${saved.name}" salva com sucesso!`, 'success');
    return saved;
  };

  const handleDeleteCampaign = async (id: string) => {
    await deleteCampaign(id, currentUser);
    const updated = await getCampaigns();
    setCampaigns([...updated]);
    showToast('Campanha excluída com sucesso!', 'info');
  };

  const handleToggleCampaignStatus = async (id: string) => {
    await toggleCampaignStatus(id, currentUser);
    const updated = await getCampaigns();
    setCampaigns([...updated]);
    showToast('Status da campanha atualizado!', 'success');
  };

  const handleSaveCoupon = async (coup: Coupon) => {
    const saved = await saveCoupon(coup, currentUser);
    const updated = await getCoupons();
    setCoupons([...updated]);
    showToast(`Cupom ${saved.code} cadastrado!`, 'success');
    return saved;
  };

  const handleDeleteCoupon = async (id: string) => {
    await deleteCoupon(id, currentUser);
    const updated = await getCoupons();
    setCoupons([...updated]);
    showToast('Cupom excluído com sucesso!', 'info');
  };

  const handleToggleCouponStatus = async (id: string) => {
    await toggleCouponStatus(id, currentUser);
    const updated = await getCoupons();
    setCoupons([...updated]);
    showToast('Status do cupom atualizado!', 'success');
  };

  const handleSaveClubOffer = async (offer: ClubOffer) => {
    const saved = await saveClubOffer(offer, currentUser);
    const updated = await getClubOffers();
    setClubOffers([...updated]);
    showToast(`Oferta Preço Clube salva: ${saved.productName}!`, 'success');
    return saved;
  };

  const handleDeleteClubOffer = async (id: string) => {
    await deleteClubOffer(id, currentUser);
    const updated = await getClubOffers();
    setClubOffers([...updated]);
    showToast('Oferta removida com sucesso!', 'info');
  };

  const handleToggleClubOfferStatus = async (id: string, status: ClubOfferStatus) => {
    await toggleClubOfferStatus(id, status, currentUser);
    const updated = await getClubOffers();
    setClubOffers([...updated]);
    showToast(`Status da oferta alterado para "${status}"`, 'success');
  };

  const handleDuplicateClubOffer = async (id: string) => {
    const dup = await duplicateClubOffer(id, currentUser);
    const updated = await getClubOffers();
    setClubOffers([...updated]);
    if (dup) {
      showToast(`Oferta duplicada: ${dup.productName}`, 'success');
    }
    return dup;
  };

  const handleRecordClubOfferUsage = async (usage: Omit<ClubOfferUsage, 'id' | 'usedAt'>) => {
    const res = await recordClubOfferUsage(usage, currentUser);
    const [updatedUsages, updatedOffers, updatedCusts] = await Promise.all([
      getClubOfferUsages(),
      getClubOffers(),
      getCustomers()
    ]);
    setClubOfferUsages([...updatedUsages]);
    setClubOffers([...updatedOffers]);
    setCustomers([...updatedCusts]);
    showToast(`Desconto Preço Clube de R$ ${usage.totalSavings.toFixed(2)} aplicado com sucesso!`, 'success');
    return res;
  };

  const handleToggleCustomerClubStatus = async (customerId: string, isClubMember: boolean) => {
    await toggleCustomerClubStatus(customerId, isClubMember, currentUser);
    const updatedCusts = await getCustomers();
    setCustomers([...updatedCusts]);
    showToast(`Status Fidelidade Clube do cliente ${isClubMember ? 'ativado' : 'desativado'} com sucesso!`, 'success');
  };

  const handleSaveInteraction = async (inter: Interaction) => {
    const saved = await saveInteraction(inter, currentUser);
    const updated = await getInteractions();
    setInteractions([...updated]);
    showToast('Atendimento registrado com sucesso!', 'success');
    return saved;
  };

  const handleSaveTask = async (task: CRMTask) => {
    const saved = await saveTask(task, currentUser);
    const updated = await getTasks();
    setTasks([...updated]);
    showToast('Tarefa atualizada!', 'success');
    return saved;
  };

  const handleSaveSegment = async (seg: Segment) => {
    const saved = await saveSegment(seg, currentUser);
    const updated = await getSegments();
    setSegments([...updated]);
    showToast(`Segmento "${saved.name}" salvo com sucesso!`, 'success');
    return saved;
  };

  /**
   * Recalcula RFM com a base completa de clientes e compras e grava só o que mudou.
   * Recência envelhece todo dia, então além do botão manual roda automaticamente
   * uma vez por dia, no primeiro acesso de um gestor ou administrador.
   */
  const runRFMRecalculation = async (mode: 'manual' | 'automatica') => {
    const [allCustomers, allPurchases] = await Promise.all([getCustomers(), getPurchases()]);
    const { updated, changes } = recalculateCustomersRFM(allCustomers, allPurchases, rfmConfig, new Date());
    await saveRFMChanges(changes, currentUser, mode);
    setCustomers([...updated]);
    setDashboardMetrics(await getDashboardMetrics());
    return changes.length;
  };

  const handleRecalculateAllRFM = async () => {
    setIsLoading(true);
    try {
      const n = await runRFMRecalculation('manual');
      showToast(`RFM recalculado: ${n} cliente(s) atualizado(s).`, 'success');
    } catch (err: any) {
      console.error('Erro ao recalcular RFM:', err);
      showToast('Erro ao recalcular RFM.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  // Recalculação automática diária (uma vez por sessão; só quem pode gravar clientes)
  const autoRFMCheckedRef = useRef(false);
  useEffect(() => {
    if (autoRFMCheckedRef.current || isLoading) return;
    if (!isAuthorized || !(currentUser.role === 'admin' || currentUser.role === 'manager')) return;
    if (customers.length === 0) return;
    autoRFMCheckedRef.current = true;
    (async () => {
      try {
        const lastDay = await getRFMLastRecalculatedDay();
        if (lastDay === rfmDayKey()) return;
        const n = await runRFMRecalculation('automatica');
        if (n > 0) console.info(`[RFM] Recalculação diária automática: ${n} cliente(s) atualizado(s).`);
      } catch (err) {
        console.warn('[RFM] Recalculação diária automática falhou:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorized, isLoading, currentUser.role, customers.length]);

  const handleGeocodeCustomer = async (customerId: string): Promise<boolean> => {
    const cust = customers.find(c => c.id === customerId);
    if (!cust) return false;

    try {
      const res = await apiFetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          address: cust.address,
          number: cust.number,
          neighborhood: cust.neighborhood,
          city: cust.city,
          state: cust.state,
          cep: cust.cep
        })
      });
      const data = await res.json();
      if (data.success && data.latitude && data.longitude) {
        await updateCustomerFields(cust.id, {
          latitude: data.latitude,
          longitude: data.longitude,
          geocodeStatus: 'geocoded'
        }, ['geocodeError'], currentUser);
        await refreshData();
        showToast(`Cliente ${cust.name} geolocalizado com sucesso!`, 'success');
        return true;
      } else {
        await updateCustomerFields(cust.id, {
          geocodeStatus: data.status || 'failed',
          geocodeError: data.error || 'Endereço não localizado'
        }, [], currentUser);
        await refreshData();
        showToast(data.error || 'Não foi possível geolocalizar este endereço.', 'error');
        return false;
      }
    } catch (err) {
      showToast('Erro ao contatar serviço de geocodificação.', 'error');
      return false;
    }
  };

  const handleGeocodeAllPending = async (): Promise<number> => {
    const pending = customers.filter(
      c => !c.isAnonymized && (c.geocodeStatus === 'pending' || c.geocodeStatus === 'failed' || !c.latitude || !c.longitude)
    );
    if (pending.length === 0) {
      showToast('Todos os clientes já estão geolocalizados!', 'info');
      return 0;
    }
    showToast(`Processando geocodificação de ${pending.length} clientes...`, 'info');

    // Lotes de 200: 1 requisição ao servidor + 1 gravação em lote no Firestore por lote
    // (antes: 1 requisição e 1 gravação por cliente, o que estourava o limite de 60 req/min).
    const CHUNK = 200;
    let successCount = 0;
    try {
      for (let i = 0; i < pending.length; i += CHUNK) {
        const chunk = pending.slice(i, i + CHUNK);
        const res = await apiFetch('/api/geocode/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            items: chunk.map(c => ({
              id: c.id,
              address: c.address,
              number: c.number,
              neighborhood: c.neighborhood,
              city: c.city,
              state: c.state,
              cep: c.cep
            }))
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !Array.isArray(data.results)) {
          // Falha de transporte/limite: interrompe SEM marcar ninguém como "failed".
          throw new Error(data?.error || `Serviço de geocodificação indisponível (HTTP ${res.status}).`);
        }

        const byId = new Map<string, any>(data.results.map((r: any) => [r.id, r]));
        const updatedChunk: Customer[] = chunk.map(cust => {
          const r = byId.get(cust.id);
          if (r?.success && r.latitude && r.longitude) {
            successCount++;
            return { ...cust, latitude: r.latitude, longitude: r.longitude, geocodeStatus: 'geocoded', geocodeError: undefined };
          }
          return {
            ...cust,
            geocodeStatus: (r?.status === 'pending' ? 'pending' : 'failed') as Customer['geocodeStatus'],
            geocodeError: r?.error || 'Não localizado'
          };
        });
        // Grava só quem mudou (ex.: cliente sem endereço continua "pending" e não precisa ser regravado).
        const changed = updatedChunk.filter((u, idx) =>
          u.geocodeStatus !== chunk[idx].geocodeStatus ||
          u.latitude !== chunk[idx].latitude ||
          u.longitude !== chunk[idx].longitude ||
          u.geocodeError !== chunk[idx].geocodeError
        );
        if (changed.length > 0) {
          await saveCustomersBatch(changed, currentUser);
        }
      }
      await refreshData();
      showToast(`${successCount} clientes geolocalizados com sucesso!`, 'success');
    } catch (err: any) {
      console.error('[Geocode] Falha na geocodificação em lote:', err);
      await refreshData();
      showToast(err?.message || 'Não foi possível geolocalizar todos os clientes.', 'error');
    }
    return successCount;
  };

  const metrics = dashboardMetrics || calculateDashboardMetrics(customers, purchases);

  return (
    <CRMContext.Provider
      value={{
        currentView,
        setCurrentView,
        currentUser,
        setCurrentUser,
        authLoading,
        isAuthenticated,
        isAuthorized,
        unauthorizedEmail,
        logout,
        authorizedUsers,
        loadAuthorizedUsers,
        handleAuthorizeUser,
        handleToggleUserStatus,
        handleUpdateUserRole,
        handleRemoveAuthorizedUser,
        customers,
        purchases,
        campaigns,
        coupons,
        clubOffers,
        clubOfferUsages,
        interactions,
        tasks,
        segments,
        stores,
        auditLogs,
        metrics,
        rfmConfig,
        setRfmConfig,
        isLoading,
        selectedCustomerId,
        openCustomer360,
        isAIChatOpen,
        setIsAIChatOpen,
        isNewCustomerModalOpen,
        setIsNewCustomerModalOpen,
        isPDVImportModalOpen,
        setIsPDVImportModalOpen,
        isCustomerImportModalOpen,
        setIsCustomerImportModalOpen,
        isAICampaignModalOpen,
        setIsAICampaignModalOpen,
        globalSearchQuery,
        setGlobalSearchQuery,
        toastMessage,
        showToast,
        handleSaveCustomer,
        handleUpdateCustomer,
        handleDeleteCustomer,
        handleAnonymizeCustomer,
        handleImportCustomers,
        handleImportPurchases,
        handleSaveCampaign,
        handleDeleteCampaign,
        handleToggleCampaignStatus,
        handleSaveCoupon,
        handleDeleteCoupon,
        handleToggleCouponStatus,
        handleSaveClubOffer,
        handleDeleteClubOffer,
        handleToggleClubOfferStatus,
        handleDuplicateClubOffer,
        handleRecordClubOfferUsage,
        handleToggleCustomerClubStatus,
        handleSaveInteraction,
        handleSaveTask,
        handleSaveSegment,
        handleRecalculateAllRFM,
        handleGeocodeCustomer,
        handleGeocodeAllPending,
        refreshData,
        isSyncing
      }}
    >
      {children}
    </CRMContext.Provider>
  );
};

export function useCRM() {
  const context = useContext(CRMContext);
  if (!context) {
    throw new Error('useCRM deve ser utilizado dentro de um CRMProvider.');
  }
  return context;
}
