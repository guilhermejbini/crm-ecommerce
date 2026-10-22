import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  MapPin, 
  Search, 
  Filter, 
  RotateCcw, 
  Sparkles, 
  AlertTriangle, 
  TrendingUp, 
  DollarSign, 
  Users, 
  UserCheck, 
  UserX, 
  Building2, 
  Flame, 
  ArrowRight, 
  ExternalLink, 
  Phone, 
  MessageCircle, 
  RefreshCw, 
  ChevronRight, 
  ChevronDown, 
  Layers, 
  CheckCircle2, 
  AlertCircle,
  HelpCircle,
  Compass,
  Maximize2,
  Minimize2
} from 'lucide-react';
import L from 'leaflet';
import { useCRM } from '../../context/CRMContext';
import { Customer, RFMSegmentType } from '../../types/crm';
import { DEMO_STORES, NEIGHBORHOOD_COORDS, getStoreCoords, recordBelongsToStore } from '../../services/storeAndLocationData';
import { isActiveCustomer } from '../../utils/customerMetrics';

export const CustomerMapView: React.FC = () => {
  const { 
    customers, 
    purchases, 
    stores,
    openCustomer360, 
    setIsAICampaignModalOpen,
    handleGeocodeCustomer,
    handleGeocodeAllPending,
    currentUser,
    showToast
  } = useCRM();

  // Filters State
  const [storeFilter, setStoreFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'lost'>('all');
  const [segmentFilter, setSegmentFilter] = useState<string>('all');
  const [recencyRange, setRecencyRange] = useState<string>('all');
  const [valueRange, setValueRange] = useState<string>('all');
  const [customMinVal, setCustomMinVal] = useState<string>('');
  const [customMaxVal, setCustomMaxVal] = useState<string>('');
  const [frequencyFilter, setFrequencyFilter] = useState<string>('all');
  const [selectedNeighborhoods, setSelectedNeighborhoods] = useState<string[]>([]);
  const [isFiltersExpanded, setIsFiltersExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<'map' | 'neighborhoods' | 'opportunities' | 'pending'>('map');
  const [isExpanded, setIsExpanded] = useState(false);
  const [isGeocodingAll, setIsGeocodingAll] = useState(false);
  const [geocodingId, setGeocodingId] = useState<string | null>(null);

  // Selected customer for modal/drawer view
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);

  // Map DOM reference & Leaflet instance
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markersLayerGroupRef = useRef<L.LayerGroup | null>(null);

  // Derive unique neighborhoods
  const allNeighborhoods = useMemo(() => {
    const set = new Set<string>();
    customers.forEach(c => {
      if (c.neighborhood) set.add(c.neighborhood);
    });
    return Array.from(set).sort();
  }, [customers]);

  // Filter customers logic
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      // Ignore anonymized if completely erased
      if (c.isAnonymized) return false;

      // Status rule: Active = purchase in last 30 days; Lost = > 30 days without purchase
      const isCustomerActive = isActiveCustomer(c);
      if (statusFilter === 'active' && !isCustomerActive) return false;
      if (statusFilter === 'lost' && isCustomerActive) return false;

      // Store / Unit Filter
      if (storeFilter !== 'all') {
        const matchesStore = recordBelongsToStore(storeFilter, c.favoriteStoreId, c.favoriteStoreName);
        if (!matchesStore) return false;
      }

      // Segment filter
      if (segmentFilter !== 'all' && c.rfmSegment !== segmentFilter) return false;

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesName = c.name.toLowerCase().includes(q);
        const matchesNeighborhood = (c.neighborhood || '').toLowerCase().includes(q);
        const matchesCity = (c.city || '').toLowerCase().includes(q);
        const matchesCpf = (c.cpf || '').includes(q);
        if (!matchesName && !matchesNeighborhood && !matchesCity && !matchesCpf) {
          return false;
        }
      }

      // Recency filter (Last purchase)
      if (recencyRange === '7d' && c.daysSinceLastPurchase > 7) return false;
      if (recencyRange === '15d' && c.daysSinceLastPurchase > 15) return false;
      if (recencyRange === '30d' && c.daysSinceLastPurchase > 30) return false;
      if (recencyRange === '60d' && c.daysSinceLastPurchase > 60) return false;
      if (recencyRange === '90d' && c.daysSinceLastPurchase > 90) return false;
      if (recencyRange === 'more90d' && c.daysSinceLastPurchase <= 90) return false;

      // Frequency filter
      if (frequencyFilter === '1-2' && (c.totalPurchases < 1 || c.totalPurchases > 2)) return false;
      if (frequencyFilter === '3-5' && (c.totalPurchases < 3 || c.totalPurchases > 5)) return false;
      if (frequencyFilter === '6-10' && (c.totalPurchases < 6 || c.totalPurchases > 10)) return false;
      if (frequencyFilter === '10+' && c.totalPurchases <= 10) return false;

      // Monetary value range filter
      if (valueRange === '0-100' && c.totalSpent > 100) return false;
      if (valueRange === '100-300' && (c.totalSpent < 100 || c.totalSpent > 300)) return false;
      if (valueRange === '300-500' && (c.totalSpent < 300 || c.totalSpent > 500)) return false;
      if (valueRange === '500+' && c.totalSpent < 500) return false;
      if (valueRange === 'custom') {
        const min = parseFloat(customMinVal) || 0;
        const max = parseFloat(customMaxVal) || Infinity;
        if (c.totalSpent < min || c.totalSpent > max) return false;
      }

      // Neighborhood selection filter
      if (selectedNeighborhoods.length > 0) {
        if (!c.neighborhood || !selectedNeighborhoods.includes(c.neighborhood)) {
          return false;
        }
      }

      return true;
    });
  }, [
    customers, 
    storeFilter,
    statusFilter, 
    segmentFilter, 
    searchQuery, 
    recencyRange, 
    frequencyFilter, 
    valueRange, 
    customMinVal, 
    customMaxVal, 
    selectedNeighborhoods
  ]);

  // Separate geocoded vs pending customers
  const geocodedCustomers = useMemo(() => {
    return filteredCustomers.filter(c => c.latitude && c.longitude && c.geocodeStatus !== 'failed' && c.geocodeStatus !== 'pending');
  }, [filteredCustomers]);

  const pendingCustomers = useMemo(() => {
    return customers.filter(c => !c.isAnonymized && (!c.latitude || !c.longitude || c.geocodeStatus === 'pending' || c.geocodeStatus === 'failed'));
  }, [customers]);

  // Aggregate stats
  const stats = useMemo(() => {
    const total = filteredCustomers.length;
    const active = filteredCustomers.filter(c => isActiveCustomer(c));
    const lost = filteredCustomers.filter(c => !isActiveCustomer(c));

    const activeCount = active.length;
    const lostCount = lost.length;
    const activeRate = total > 0 ? ((activeCount / total) * 100).toFixed(1) : '0.0';

    const activeTotalSpent = active.reduce((acc, c) => acc + c.totalSpent, 0);
    const activeTotalPurchases = active.reduce((acc, c) => acc + c.totalPurchases, 0);
    const activeAverageTicket = activeTotalPurchases > 0 ? (activeTotalSpent / activeTotalPurchases) : 0;

    const lostTotalSpent = lost.reduce((acc, c) => acc + c.totalSpent, 0);
    const lostTotalPurchases = lost.reduce((acc, c) => acc + c.totalPurchases, 0);
    const lostAverageTicket = lostTotalPurchases > 0 ? (lostTotalSpent / lostTotalPurchases) : 0;

    return {
      total,
      activeCount,
      lostCount,
      activeRate,
      activeAverageTicket,
      lostAverageTicket,
      lostTotalSpent,
      geocodedOnMapCount: geocodedCustomers.length,
      pendingCount: pendingCustomers.length
    };
  }, [filteredCustomers, geocodedCustomers, pendingCustomers]);

  // Neighborhood Breakdown Table
  const neighborhoodStats = useMemo(() => {
    const map = new Map<string, { neighborhood: string; active: number; lost: number; total: number; totalSpentLost: number; totalSpentAll: number }>();

    customers.forEach(c => {
      if (c.isAnonymized) return;
      const n = c.neighborhood || 'Outros';
      const current = map.get(n) || { neighborhood: n, active: 0, lost: 0, total: 0, totalSpentLost: 0, totalSpentAll: 0 };
      current.total += 1;
      current.totalSpentAll += c.totalSpent;
      if (isActiveCustomer(c)) {
        current.active += 1;
      } else {
        current.lost += 1;
        current.totalSpentLost += c.totalSpent;
      }
      map.set(n, current);
    });

    const list = Array.from(map.values()).map(item => ({
      ...item,
      lostPercentage: item.total > 0 ? Math.round((item.lost / item.total) * 100) : 0
    }));

    // Default sort: highest quantity of lost customers
    return list.sort((a, b) => b.lost - a.lost || b.totalSpentLost - a.totalSpentLost);
  }, [customers]);

  // Opportunity Regions (High volume of lost customers & high historical spend)
  const opportunityRegions = useMemo(() => {
    return neighborhoodStats
      .filter(n => n.lost >= 2 || n.totalSpentLost > 2000)
      .slice(0, 6);
  }, [neighborhoodStats]);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      if ((mapContainerRef.current as any)._leaflet_id) {
        (mapContainerRef.current as any)._leaflet_id = null;
      }

      // Default center: Almirante Tamandaré - PR
      const map = L.map(mapContainerRef.current, {
        center: [-25.3135, -49.2980],
        zoom: 14,
        zoomControl: false,
        attributionControl: false
      });

      // OpenStreetMap tiles (100% livre, público e sem marca d'água de API key)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);

      // Add Zoom control at top right
      L.control.zoom({ position: 'topright' }).addTo(map);

      const markersGroup = L.layerGroup().addTo(map);
      markersLayerGroupRef.current = markersGroup;
      mapInstanceRef.current = map;

      // Add Real Store markers (Super Astral - 3 unidades em Almirante Tamandaré)
      const storeList = stores && stores.length > 0 ? stores : DEMO_STORES;
      storeList.forEach(store => {
        const [storeLat, storeLng] = getStoreCoords(store);

        const storeIcon = L.divIcon({
          className: 'custom-store-pin',
          html: `
            <div class="relative flex items-center justify-center cursor-pointer group">
              <div class="w-10 h-10 rounded-2xl bg-amber-500 text-slate-950 font-black flex items-center justify-center shadow-xl shadow-amber-500/40 border-2 border-white ring-2 ring-amber-400 hover:scale-110 transition-transform">
                <span class="text-sm">🏬</span>
              </div>
              <div class="absolute -bottom-6 bg-slate-900 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow whitespace-nowrap border border-slate-700">
                ${store.code}
              </div>
            </div>
          `,
          iconSize: [40, 40],
          iconAnchor: [20, 20]
        });

        const marker = L.marker([storeLat, storeLng], { icon: storeIcon });
        marker.bindPopup(`
          <div class="p-3 font-sans text-slate-900 max-w-xs">
            <div class="flex items-center gap-2 mb-1">
              <span class="px-2 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">LOJA FÍSICA</span>
              <span class="text-xs font-bold text-slate-500">${store.code}</span>
            </div>
            <h4 class="font-bold text-sm text-slate-900 leading-snug">${store.name}</h4>
            <p class="text-xs text-slate-600 mt-1">${store.address} - ${store.neighborhood}</p>
            ${store.cep ? `<p class="text-[11px] text-slate-500 mt-0.5">CEP ${store.cep} - Almirante Tamandaré / PR</p>` : ''}
            ${store.phone ? `<p class="text-[11px] text-emerald-700 font-semibold mt-1">📞 ${store.phone}</p>` : ''}
            <div class="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>${store.totalPos || store.posCount || 8} PDVs Operacionais</span>
              <span class="font-medium text-slate-700">Almirante Tamandaré - PR</span>
            </div>
          </div>
        `);
        marker.addTo(map);
      });
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        markersLayerGroupRef.current = null;
      }
    };
  }, []);

  // Invalidate map size whenever user returns to 'map' tab or expands/restores map
  useEffect(() => {
    if (activeTab === 'map' && mapInstanceRef.current) {
      const center = mapInstanceRef.current.getCenter();
      const zoom = mapInstanceRef.current.getZoom();

      const t1 = setTimeout(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize({ pan: false });
          mapInstanceRef.current.setView(center, zoom, { animate: false });
        }
      }, 50);
      const t2 = setTimeout(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize({ pan: false });
        }
      }, 150);
      const t3 = setTimeout(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.invalidateSize({ pan: false });
        }
      }, 300);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
  }, [activeTab, isExpanded]);

  // ESC key listener to exit expanded mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isExpanded) {
        setIsExpanded(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExpanded]);

  // Update Markers on filtered customers change
  useEffect(() => {
    const map = mapInstanceRef.current;
    const markersGroup = markersLayerGroupRef.current;
    if (!map || !markersGroup) return;

    markersGroup.clearLayers();

    const bounds: L.LatLngTuple[] = [];

    geocodedCustomers.forEach(customer => {
      if (!customer.latitude || !customer.longitude) return;

      const isActive = isActiveCustomer(customer);
      const pinColorClass = isActive 
        ? 'bg-emerald-500 shadow-emerald-500/50 ring-emerald-300' 
        : 'bg-rose-600 shadow-rose-600/50 ring-rose-300 animate-pulse';

      const dotColorClass = isActive ? 'bg-emerald-200' : 'bg-rose-200';

      const markerHtml = `
        <div id="customer-pin-${customer.id}" class="group relative flex items-center justify-center cursor-pointer transition-transform hover:scale-125">
          <div class="w-6 h-6 rounded-full ${pinColorClass} text-white flex items-center justify-center shadow-lg border-2 border-white ring-2">
            <div class="w-2 h-2 rounded-full ${dotColorClass}"></div>
          </div>
          <div class="hidden group-hover:block absolute -top-8 bg-slate-900/90 text-white text-[11px] font-semibold px-2 py-0.5 rounded shadow whitespace-nowrap z-50">
            ${customer.name.split(' ')[0]} • ${isActive ? '🟢 Ativo' : '🔴 Perdido'}
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'custom-customer-pin',
        html: markerHtml,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      const marker = L.marker([customer.latitude, customer.longitude], { icon: customIcon });

      // Custom formatted popup
      const formattedTotal = customer.totalSpent.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const formattedTicket = customer.averageTicket.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const lastPurchaseFormatted = customer.lastPurchaseDate 
        ? new Date(customer.lastPurchaseDate).toLocaleDateString('pt-BR') 
        : 'Sem registro';

      const popupContent = `
        <div class="p-3.5 font-sans text-slate-900 min-w-[240px]">
          <div class="flex items-center justify-between gap-2 mb-2">
            <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-bold ${
              isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
            }">
              <span class="w-1.5 h-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-rose-600'}"></span>
              ${isActive ? '🟢 CLIENTE ATIVO' : '🔴 CLIENTE PERDIDO'}
            </span>
            <span class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
              ${customer.rfmSegment}
            </span>
          </div>

          <h3 class="font-bold text-sm text-slate-900 leading-tight mb-1">${customer.name}</h3>
          <p class="text-xs text-slate-500 mb-3">${customer.address || 'Endereço'}, ${customer.neighborhood || ''} - ${customer.city || ''}</p>

          <div class="grid grid-cols-2 gap-2 p-2.5 rounded-xl bg-slate-50 border border-slate-100 mb-3 text-xs">
            <div>
              <span class="text-[10px] text-slate-400 block font-medium">Última compra</span>
              <span class="font-bold text-slate-800">${lastPurchaseFormatted}</span>
              ${!isActive ? `<span class="text-[10px] text-rose-600 font-bold block">${customer.daysSinceLastPurchase} dias sem comprar</span>` : ''}
            </div>
            <div>
              <span class="text-[10px] text-slate-400 block font-medium">Total Comprado</span>
              <span class="font-bold text-emerald-700">${formattedTotal}</span>
            </div>
            <div>
              <span class="text-[10px] text-slate-400 block font-medium">Compras</span>
              <span class="font-bold text-slate-800">${customer.totalPurchases} compras</span>
            </div>
            <div>
              <span class="text-[10px] text-slate-400 block font-medium">Ticket Médio</span>
              <span class="font-bold text-slate-800">${formattedTicket}</span>
            </div>
          </div>

          <div class="text-xs text-slate-600 mb-3 flex items-center gap-1.5">
            <span class="font-semibold text-slate-700">WhatsApp:</span> ${customer.whatsapp || customer.phone || 'Não cadastrado'}
          </div>

          <div class="flex items-center gap-2 pt-2 border-t border-slate-100">
            <button 
              id="btn-360-${customer.id}"
              class="flex-1 py-1.5 px-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold text-center transition-colors shadow-sm"
            >
              Abrir Cliente 360
            </button>
            ${!isActive ? `
              <button 
                id="btn-recuperar-${customer.id}"
                class="py-1.5 px-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold text-center transition-colors shadow-sm flex items-center justify-center gap-1"
              >
                Recuperar
              </button>
            ` : ''}
          </div>
        </div>
      `;

      marker.bindPopup(popupContent);

      marker.on('popupopen', () => {
        const btn360 = document.getElementById(`btn-360-${customer.id}`);
        if (btn360) {
          btn360.onclick = () => {
            openCustomer360(customer.id);
          };
        }
        const btnRecuperar = document.getElementById(`btn-recuperar-${customer.id}`);
        if (btnRecuperar) {
          btnRecuperar.onclick = () => {
            setSelectedCustomer(customer);
            setIsAICampaignModalOpen(true);
          };
        }
      });

      marker.addTo(markersGroup);
      bounds.push([customer.latitude, customer.longitude]);
    });

    // Auto fit bounds if we have markers
    if (bounds.length > 0 && map) {
      try {
        map.fitBounds(L.latLngBounds(bounds), { padding: [40, 40], maxZoom: 14 });
      } catch (e) {
        // Safe fallback
      }
    }
  }, [geocodedCustomers, openCustomer360, setIsAICampaignModalOpen]);

  // Fly to neighborhood on click
  const handleFlyToNeighborhood = (neighborhood: string) => {
    setActiveTab('map');
    setTimeout(() => {
      const map = mapInstanceRef.current;
      if (!map) return;
      map.invalidateSize();
      const coords = NEIGHBORHOOD_COORDS[neighborhood];
      if (coords) {
        map.flyTo([coords.lat, coords.lng], 14, { duration: 1.2 });
        showToast(`Centralizado no bairro ${neighborhood}`, 'info');
      } else {
        const match = customers.find(c => c.neighborhood === neighborhood && c.latitude && c.longitude);
        if (match && match.latitude && match.longitude) {
          map.flyTo([match.latitude, match.longitude], 14, { duration: 1.2 });
        }
      }
    }, 100);
  };

  // Reset filters
  const handleResetFilters = () => {
    setStoreFilter('all');
    setSearchQuery('');
    setStatusFilter('all');
    setSegmentFilter('all');
    setRecencyRange('all');
    setValueRange('all');
    setCustomMinVal('');
    setCustomMaxVal('');
    setFrequencyFilter('all');
    setSelectedNeighborhoods([]);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([-25.3135, -49.2980], 14, { duration: 1.2 });
    }
    showToast('Filtros do mapa redefinidos!', 'info');
  };

  const handleCenterStores = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const storeList = stores && stores.length > 0 ? stores : DEMO_STORES;
    const storeCoords: L.LatLngTuple[] = storeList.map(store => getStoreCoords(store));

    if (storeCoords.length > 0) {
      const bounds = L.latLngBounds(storeCoords);
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 });
    } else {
      map.flyTo([-25.3135, -49.2980], 14, { duration: 1 });
    }
  };

  const handleStoreFilterChange = (selectedId: string) => {
    setStoreFilter(selectedId);
    if (!mapInstanceRef.current) return;
    const storeList = stores && stores.length > 0 ? stores : DEMO_STORES;
    if (selectedId === 'all') {
      mapInstanceRef.current.flyTo([-25.3135, -49.2980], 14, { duration: 1.2 });
    } else {
      const selected = storeList.find(s => s.id === selectedId);
      if (selected) {
        const [lat, lng] = getStoreCoords(selected);
        mapInstanceRef.current.flyTo([lat, lng], 16, { duration: 1.2 });
      }
    }
  };

  // Geocode Single Customer
  const handleSingleGeocode = async (customerId: string) => {
    setGeocodingId(customerId);
    await handleGeocodeCustomer(customerId);
    setGeocodingId(null);
  };

  // Geocode All Pending
  const handleBatchGeocode = async () => {
    setIsGeocodingAll(true);
    await handleGeocodeAllPending();
    setIsGeocodingAll(false);
  };

  // Ao abrir o mapa, geolocaliza automaticamente (uma vez por visita) os clientes que têm
  // algum dado de endereço e ainda estão sem coordenadas. Os que já falharam ficam para o botão manual.
  const autoGeocodeTriedRef = useRef(false);
  useEffect(() => {
    if (autoGeocodeTriedRef.current) return;
    if (currentUser.role === 'viewer') return; // perfil Consulta não grava clientes
    const needsGeocode = customers.some(c =>
      !c.isAnonymized &&
      c.geocodeStatus !== 'failed' &&
      (!c.latitude || !c.longitude || c.geocodeStatus === 'pending') &&
      Boolean(c.address || c.cep || c.neighborhood)
    );
    if (!needsGeocode) return;
    autoGeocodeTriedRef.current = true;
    handleBatchGeocode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers]);

  return (
    <div className="flex flex-col h-full bg-slate-100/60 overflow-hidden select-none">
      {/* Top Banner / Summary KPI bar */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 shrink-0 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-md shadow-emerald-600/20">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black tracking-tight text-slate-900">Mapa de Clientes</h1>
                <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200">
                  {stats.geocodedOnMapCount} marcadores ativos no mapa
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Visualização geográfica e inteligência de retenção por região do Super Astral
              </p>
            </div>
          </div>

          {/* Quick Metrics Pills */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs">
              <Users className="w-4 h-4 text-slate-500" />
              <span className="text-slate-500 font-medium">Total:</span>
              <span className="font-bold text-slate-900">{stats.total}</span>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <span className="font-medium text-emerald-700">Ativos:</span>
              <span className="font-extrabold text-emerald-900">{stats.activeCount} ({stats.activeRate}%)</span>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-900">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-600"></span>
              <span className="font-medium text-rose-700">Perdidos (+30d):</span>
              <span className="font-extrabold text-rose-900">{stats.lostCount}</span>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
              <Flame className="w-4 h-4 text-amber-600" />
              <span className="font-medium text-amber-700">Valor em Risco:</span>
              <span className="font-extrabold text-amber-900">
                {stats.lostTotalSpent.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </span>
            </div>

            {/* Pending alert pill */}
            {stats.pendingCount > 0 && (
              <button
                onClick={() => setActiveTab('pending')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold shadow-sm transition-all"
              >
                <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                <span>{stats.pendingCount} pendentes de GPS</span>
              </button>
            )}
          </div>
        </div>

        {/* Detailed Metrics Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-slate-100 text-xs">
          <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50/70 border border-slate-100">
            <span className="text-slate-500 font-medium">Ticket Médio Ativos:</span>
            <span className="font-bold text-emerald-700">
              {stats.activeAverageTicket.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </span>
          </div>
          <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50/70 border border-slate-100">
            <span className="text-slate-500 font-medium">Ticket Médio Perdidos:</span>
            <span className="font-bold text-rose-700">
              {stats.lostAverageTicket.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </span>
          </div>
          <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50/70 border border-slate-100">
            <span className="text-slate-500 font-medium">Bairros Monitorados:</span>
            <span className="font-bold text-slate-800">{allNeighborhoods.length} regiões</span>
          </div>
          <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50/70 border border-slate-100">
            <span className="text-slate-500 font-medium">Regiões em Oportunidade:</span>
            <span className="font-bold text-amber-600">{opportunityRegions.length} alertas</span>
          </div>
        </div>
      </header>

      {/* Filter Toolbar */}
      <div className="bg-white border-b border-slate-200 px-6 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex flex-wrap items-center gap-2.5 flex-1 min-w-[280px]">
          {/* Search Box */}
          <div className="relative w-64 max-w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar cliente, CPF ou bairro..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-xl border border-slate-200 text-xs focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-50/50"
            />
          </div>

          {/* Unidade / Store Selector */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-white border border-slate-200 shadow-sm">
            <Building2 className="w-3.5 h-3.5 text-amber-600" />
            <select
              value={storeFilter}
              onChange={(e) => handleStoreFilterChange(e.target.value)}
              className="text-xs font-bold text-slate-800 bg-transparent border-none focus:outline-none focus:ring-0 cursor-pointer"
            >
              <option value="all">Todas as unidades (3)</option>
              {(stores && stores.length > 0 ? stores : DEMO_STORES).map(st => (
                <option key={st.id} value={st.id}>
                  {st.name}
                </option>
              ))}
            </select>
          </div>

          {/* Status Quick Filter Buttons */}
          <div className="flex items-center p-0.5 rounded-xl bg-slate-100 border border-slate-200 text-xs">
            <button
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1 rounded-lg font-semibold transition-all ${
                statusFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Todos ({customers.length})
            </button>
            <button
              onClick={() => setStatusFilter('active')}
              className={`px-3 py-1 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                statusFilter === 'active' ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-600 hover:text-emerald-700'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-300"></span>
              Ativos (≤30d)
            </button>
            <button
              onClick={() => setStatusFilter('lost')}
              className={`px-3 py-1 rounded-lg font-semibold transition-all flex items-center gap-1.5 ${
                statusFilter === 'lost' ? 'bg-rose-600 text-white shadow-sm' : 'text-slate-600 hover:text-rose-700'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-rose-300"></span>
              Perdidos (+30d)
            </button>
          </div>

          {/* Segment RFM Dropdown */}
          <select
            value={segmentFilter}
            onChange={(e) => setSegmentFilter(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-slate-200 text-xs font-medium bg-white text-slate-700 focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">Todos os Segmentos RFM</option>
            <option value="CAMPEÕES">👑 Campeões</option>
            <option value="LEAIS">💎 Leais</option>
            <option value="POTENCIAIS LEAIS">🌟 Potenciais Leais</option>
            <option value="PROMISSORES">🚀 Promissores</option>
            <option value="NOVOS">🌱 Novos</option>
            <option value="PRECISAM DE ATENÇÃO">⚠️ Precisam de Atenção</option>
            <option value="EM RISCO">⚠️ Em Risco</option>
            <option value="PRESTES A DORMIR">💤 Prestes a Dormir</option>
            <option value="HIBERNANDO">❄️ Hibernando</option>
            <option value="PERDIDOS">🛑 Perdidos</option>
            <option value="UNCLASSIFIED">⚪ Não Classificados</option>
          </select>

          {/* Toggle More Filters */}
          <button
            onClick={() => setIsFiltersExpanded(!isFiltersExpanded)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              isFiltersExpanded 
                ? 'bg-slate-900 text-white border-slate-900' 
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Filtros Avançados</span>
            {isFiltersExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          {(storeFilter !== 'all' || searchQuery || statusFilter !== 'all' || segmentFilter !== 'all' || recencyRange !== 'all' || valueRange !== 'all' || frequencyFilter !== 'all' || selectedNeighborhoods.length > 0) && (
            <button
              onClick={handleResetFilters}
              title="Limpar todos os filtros"
              className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* View Mode Tabs */}
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl border border-slate-200 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('map')}
            className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'map' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Compass className="w-3.5 h-3.5 text-emerald-600" />
            Mapa Interativo
          </button>
          <button
            onClick={() => setActiveTab('neighborhoods')}
            className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'neighborhoods' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Building2 className="w-3.5 h-3.5 text-indigo-600" />
            Análise por Bairro
          </button>
          <button
            onClick={() => setActiveTab('opportunities')}
            className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'opportunities' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Flame className="w-3.5 h-3.5 text-amber-500" />
            Oportunidades ({opportunityRegions.length})
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-3 py-1 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'pending' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
            Sem GPS ({pendingCustomers.length})
          </button>
        </div>
      </div>

      {/* Expanded Advanced Filters Panel */}
      {isFiltersExpanded && (
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-3.5 text-xs grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 animate-in slide-in-from-top-2 duration-200">
          {/* Recency / Last Purchase */}
          <div>
            <label className="font-bold text-slate-700 mb-1.5 block">Última Compra:</label>
            <select
              value={recencyRange}
              onChange={(e) => setRecencyRange(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800"
            >
              <option value="all">Qualquer período</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="15d">Últimos 15 dias</option>
              <option value="30d">Últimos 30 dias (Ativos)</option>
              <option value="60d">Últimos 60 dias</option>
              <option value="90d">Últimos 90 dias</option>
              <option value="more90d">Mais de 90 dias (Perdidos Críticos)</option>
            </select>
          </div>

          {/* Spend / Monetary Range */}
          <div>
            <label className="font-bold text-slate-700 mb-1.5 block">Faixa de Valor Total Comprado:</label>
            <select
              value={valueRange}
              onChange={(e) => setValueRange(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800 mb-1.5"
            >
              <option value="all">Todas as faixas</option>
              <option value="0-100">Até R$ 100</option>
              <option value="100-300">R$ 100 a R$ 300</option>
              <option value="300-500">R$ 300 a R$ 500</option>
              <option value="500+">Acima de R$ 500</option>
              <option value="custom">Personalizado (R$ Min / Max)</option>
            </select>
            {valueRange === 'custom' && (
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  placeholder="Min R$"
                  value={customMinVal}
                  onChange={(e) => setCustomMinVal(e.target.value)}
                  className="w-1/2 px-2 py-1 rounded border border-slate-200 bg-white"
                />
                <input
                  type="number"
                  placeholder="Max R$"
                  value={customMaxVal}
                  onChange={(e) => setCustomMaxVal(e.target.value)}
                  className="w-1/2 px-2 py-1 rounded border border-slate-200 bg-white"
                />
              </div>
            )}
          </div>

          {/* Frequency */}
          <div>
            <label className="font-bold text-slate-700 mb-1.5 block">Frequência (Nº de Compras):</label>
            <select
              value={frequencyFilter}
              onChange={(e) => setFrequencyFilter(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800"
            >
              <option value="all">Qualquer frequência</option>
              <option value="1-2">1 a 2 compras (Novos/Esporádicos)</option>
              <option value="3-5">3 a 5 compras (Regulares)</option>
              <option value="6-10">6 a 10 compras (Frequentes)</option>
              <option value="10+">Mais de 10 compras (Super Fiéis)</option>
            </select>
          </div>

          {/* Neighborhood Multi-Select preview */}
          <div>
            <label className="font-bold text-slate-700 mb-1.5 block">Filtrar por Bairro Específico:</label>
            <select
              value={selectedNeighborhoods[0] || 'all'}
              onChange={(e) => {
                if (e.target.value === 'all') {
                  setSelectedNeighborhoods([]);
                } else {
                  setSelectedNeighborhoods([e.target.value]);
                }
              }}
              className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-800"
            >
              <option value="all">Todos os bairros</option>
              {allNeighborhoods.map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Main Content Area: Map vs Tables */}
      <div className="flex-1 relative overflow-hidden flex flex-col">
        {/* MAP VIEW TAB */}
        <div 
          className={`w-full h-full ${activeTab === 'map' ? 'flex flex-col' : 'hidden'} ${
            isExpanded 
              ? 'fixed inset-0 z-50 bg-white shadow-2xl' 
              : 'relative'
          }`}
        >
          {/* Leaflet Map Canvas */}
          <div 
            ref={mapContainerRef} 
            className="w-full h-full z-10"
            style={{ minHeight: isExpanded ? '100vh' : '450px' }}
          />

          {/* Fixed Floating Map Legend */}
          <div className="absolute bottom-6 left-6 z-[2000] bg-slate-900/90 backdrop-blur text-white p-3.5 rounded-2xl shadow-2xl border border-slate-700/80 text-xs font-sans space-y-2 max-w-xs pointer-events-auto">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 pb-1 border-b border-slate-800 flex items-center justify-between">
              <span>LEGENDA DO MAPA</span>
              <span className="text-[9px] text-slate-500">Super Astral GPS</span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white shadow"></span>
              <div className="flex-1">
                <span className="font-bold text-emerald-300 block leading-tight">Cliente Ativo</span>
                <span className="text-[10px] text-slate-400">Comprou nos últimos 30 dias</span>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="w-3.5 h-3.5 rounded-full bg-rose-600 border-2 border-white shadow animate-pulse"></span>
              <div className="flex-1">
                <span className="font-bold text-rose-300 block leading-tight">Cliente Perdido</span>
                <span className="text-[10px] text-slate-400">Há mais de 30 dias sem compras</span>
              </div>
            </div>
            <div className="flex items-center gap-2.5 pt-1 border-t border-slate-800">
              <div className="w-4 h-4 rounded-md bg-amber-500 text-slate-950 flex items-center justify-center text-[10px] font-black">
                🏬
              </div>
              <div className="flex-1">
                <span className="font-bold text-amber-300 block leading-tight">Lojas Super Astral</span>
                <span className="text-[10px] text-slate-400">Unidades Físicas (Matriz e Filiais)</span>
              </div>
            </div>
          </div>

          {/* Quick Action Floating Bar - Always Top Right with High Z-Index */}
          <div className="absolute top-4 right-4 z-[2000] flex items-center gap-2 pointer-events-auto">
            {isExpanded && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 backdrop-blur text-white text-xs font-semibold shadow-lg border border-slate-700">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>{geocodedCustomers.length} clientes no mapa</span>
              </div>
            )}

            <button
              onClick={handleCenterStores}
              title="Centralizar Mapa nas Lojas"
              className="px-3 py-2 rounded-xl bg-white text-slate-700 hover:text-slate-950 text-xs font-bold shadow-lg border border-slate-200 flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
            >
              <Compass className="w-4 h-4 text-emerald-600" />
              <span className="hidden sm:inline">Centralizar Lojas</span>
            </button>

            {/* EXPAND / RESTORE BUTTON */}
            {isExpanded ? (
              <button
                onClick={() => setIsExpanded(false)}
                title="Voltar ao tamanho normal do mapa"
                className="px-4 py-2 rounded-xl text-xs font-bold shadow-2xl border flex items-center gap-2 transition-all cursor-pointer bg-slate-950 text-white border-slate-700 hover:bg-slate-800 ring-2 ring-emerald-400/40 active:scale-95"
              >
                <Minimize2 className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="font-bold whitespace-nowrap">Voltar ao tamanho normal</span>
              </button>
            ) : (
              <button
                onClick={() => setIsExpanded(true)}
                title="Expandir mapa"
                className="px-3.5 py-2 rounded-xl text-xs font-bold shadow-lg border flex items-center gap-2 transition-all cursor-pointer bg-white text-slate-700 hover:text-slate-950 border-slate-200 hover:bg-slate-50 active:scale-95"
              >
                <Maximize2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-bold whitespace-nowrap">Expandir mapa</span>
              </button>
            )}
          </div>
        </div>

        {/* NEIGHBORHOODS ANALYSIS TAB */}
        <div className={`flex-1 overflow-y-auto p-6 space-y-6 bg-slate-100/70 ${activeTab === 'neighborhoods' ? 'block' : 'hidden'}`}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-black text-slate-900 tracking-tight">Análise de Clientes por Bairro</h2>
              <p className="text-xs text-slate-500">
                Ranking ordenado pela maior quantidade de clientes perdidos para direcionamento de ações comerciais
              </p>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                  <th className="py-3.5 px-4">Bairro / Região</th>
                  <th className="py-3.5 px-4 text-center">🟢 Clientes Ativos</th>
                  <th className="py-3.5 px-4 text-center">🔴 Clientes Perdidos</th>
                  <th className="py-3.5 px-4 text-center">Total de Clientes</th>
                  <th className="py-3.5 px-4 text-center">% Clientes Perdidos</th>
                  <th className="py-3.5 px-4 text-right">Valor em Risco</th>
                  <th className="py-3.5 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {neighborhoodStats.map((item, idx) => (
                  <tr key={item.neighborhood} className="hover:bg-slate-50/60 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 text-[10px] font-bold flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <span className="font-bold text-slate-900 text-sm">{item.neighborhood}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-bold">
                        {item.active}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span className="px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 font-bold">
                        {item.lost}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center font-bold text-slate-900">
                      {item.total}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <div className="w-16 bg-slate-100 rounded-full h-2 overflow-hidden">
                          <div 
                            className={`h-full rounded-full ${item.lostPercentage > 35 ? 'bg-rose-500' : 'bg-amber-500'}`}
                            style={{ width: `${Math.min(100, item.lostPercentage)}%` }}
                          />
                        </div>
                        <span className={`font-bold ${item.lostPercentage > 35 ? 'text-rose-600' : 'text-slate-700'}`}>
                          {item.lostPercentage}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right font-bold text-rose-600">
                      {item.totalSpentLost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        onClick={() => handleFlyToNeighborhood(item.neighborhood)}
                        className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs transition-colors shadow-sm inline-flex items-center gap-1"
                      >
                        <MapPin className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Ver no mapa</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* OPPORTUNITIES BY REGION TAB */}
        <div className={`flex-1 overflow-y-auto p-6 space-y-6 bg-slate-100/70 ${activeTab === 'opportunities' ? 'block' : 'hidden'}`}>
          <div>
            <div className="flex items-center gap-2">
              <Flame className="w-5 h-5 text-amber-500" />
              <h2 className="text-base font-black text-slate-900 tracking-tight">Oportunidades por Região</h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Bairros com alta concentração de clientes e expressivo valor financeiro histórico em risco de churn
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {opportunityRegions.map((region) => (
              <div 
                key={region.neighborhood}
                className="p-5 rounded-2xl bg-white border border-slate-200 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-black uppercase tracking-wider flex items-center gap-1">
                      <Flame className="w-3 h-3 text-amber-600" />
                      OPORTUNIDADE REGIONAL
                    </span>
                    <span className="text-xs font-bold text-rose-600">
                      {region.lostPercentage}% perdidos
                    </span>
                  </div>

                  <h3 className="text-base font-black text-slate-900 mb-2">{region.neighborhood}</h3>

                  <div className="space-y-2 p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs mb-4">
                    <div className="flex justify-between items-center text-slate-600">
                      <span>Clientes cadastrados:</span>
                      <span className="font-bold text-slate-900">{region.total} clientes</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-600">
                      <span>Clientes perdidos (+30d):</span>
                      <span className="font-extrabold text-rose-600">{region.lost} clientes</span>
                    </div>
                    <div className="flex justify-between items-center text-slate-600 pt-1 border-t border-slate-200">
                      <span>Histórico de compras em risco:</span>
                      <span className="font-black text-emerald-700 text-sm">
                        {region.totalSpentLost.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                  <button
                    onClick={() => handleFlyToNeighborhood(region.neighborhood)}
                    className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs transition-colors flex items-center justify-center gap-1"
                  >
                    <MapPin className="w-3.5 h-3.5 text-slate-600" />
                    Ver
                  </button>
                  <button
                    onClick={() => {
                      setSelectedNeighborhoods([region.neighborhood]);
                      setIsAICampaignModalOpen(true);
                    }}
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                    <span>Criar campanha para esta região</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* PENDING GEOCODING TAB */}
        <div className={`flex-1 overflow-y-auto p-6 space-y-6 bg-slate-100/70 ${activeTab === 'pending' ? 'block' : 'hidden'}`}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 className="text-base font-black text-slate-900 tracking-tight">Clientes sem Localização GPS</h2>
              <p className="text-xs text-slate-500">
                Endereços incompletos ou com pendência de geocodificação cartográfica
              </p>
            </div>

            {pendingCustomers.length > 0 && (
              <button
                onClick={handleBatchGeocode}
                disabled={isGeocodingAll}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs transition-colors flex items-center gap-2 shadow-sm"
              >
                <RefreshCw className={`w-4 h-4 ${isGeocodingAll ? 'animate-spin' : ''}`} />
                <span>{isGeocodingAll ? 'Geolocalizando...' : 'Geolocalizar Todos os Pendentes'}</span>
              </button>
            )}
          </div>

          {pendingCustomers.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-slate-200 shadow-sm">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <h3 className="font-bold text-slate-900 text-base">Tudo certo com a base geográfica!</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                Todos os clientes cadastrados possuem coordenadas válidas e estão visíveis no mapa interativo.
              </p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider">
                    <th className="py-3.5 px-4">Cliente</th>
                    <th className="py-3.5 px-4">Endereço Cadastrado</th>
                    <th className="py-3.5 px-4">Bairro / Cidade</th>
                    <th className="py-3.5 px-4">Motivo da Pendência</th>
                    <th className="py-3.5 px-4 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {pendingCustomers.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3 px-4">
                        <button
                          onClick={() => openCustomer360(c.id)}
                          className="font-bold text-slate-900 hover:text-emerald-600 transition-colors block text-left"
                        >
                          {c.name}
                        </button>
                        <span className="text-[10px] text-slate-400">{c.cpf}</span>
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {c.address || 'Não cadastrado'} {c.number ? `, ${c.number}` : ''}
                      </td>
                      <td className="py-3 px-4 text-slate-600">
                        {c.neighborhood || 'N/A'}, {c.city || 'Almirante Tamandaré'} - {c.state || 'PR'}
                      </td>
                      <td className="py-3 px-4">
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[11px] font-semibold">
                          <AlertTriangle className="w-3 h-3 text-amber-600" />
                          {c.geocodeError || 'Endereço incompleto'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleSingleGeocode(c.id)}
                            disabled={geocodingId === c.id}
                            className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-semibold text-xs transition-colors flex items-center gap-1"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${geocodingId === c.id ? 'animate-spin' : ''}`} />
                            <span>{geocodingId === c.id ? 'Processando' : 'Tentar novamente'}</span>
                          </button>
                          <button
                            onClick={() => openCustomer360(c.id)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100"
                            title="Editar ficha do cliente"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
