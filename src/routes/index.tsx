import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle, Boxes, CalendarClock, ClipboardPaste, FilePlus2, PackageOpen,
  ReceiptText, Search, ShieldCheck, Sparkles, Table, Trash2, History, ListFilter, Lock, LogOut, Filter, Calendar, TrendingUp, Edit3, Check, X, Download, ArrowUpDown, TrendingDown
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  addReceipt, createInitialStock, getInventoryDashboard, saveDailySnapshot, syncAdjustments, clearAllDatabase, updateAverageSalesBatch, updateLotRecord, deleteLotRecord, deleteProduct, deleteLotRecordsBatch
} from '../../inventory.functions'

export const Route = createFileRoute('/')({ component: InventoryApp })

type ActionMode = 'initial' | 'receipt' | 'snapshot'
type FilterMode = 'all' | 'expiringSoon' | 'expired' | 'risk'
type HistoryTypeFilter = 'all' | 'initial' | 'receipt' | 'adjustment'
type ViewTab = 'inventory' | 'history' | 'lost_sales'
type Role = 'admin' | 'viewer'
type SortBy = 'sku' | 'name' | 'stock' | 'expiration'
type SortOrder = 'asc' | 'desc'

const dateFormatter = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
const numberFormatter = new Intl.NumberFormat('es-CL')

function todayIso() { return new Date().toISOString().slice(0, 10) }
function formatDate(value: string) {
  if (!value) return ''
  try {
    let d = new Date(value.includes('T') ? value : `${value}T00:00:00Z`)
    if (isNaN(d.getTime())) d = new Date(value)
    if (isNaN(d.getTime())) return value 
    return dateFormatter.format(d)
  } catch { return value }
}

function InventoryApp() {
  const [role, setRole] = useState<Role | null>(null)
  const [pinCode, setPinCode] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const savedRole = sessionStorage.getItem('app_role') as Role
    if (savedRole) setRole(savedRole)
  }, [])

  const handleLogin = (e: FormEvent) => {
    e.preventDefault()
    if (pinCode === 'Valen2026') { setRole('admin'); sessionStorage.setItem('app_role', 'admin') }
    else if (pinCode === 'Tolosa2026') { setRole('viewer'); sessionStorage.setItem('app_role', 'viewer') }
    else setError('Clave incorrecta. Intentá de nuevo.')
    setPinCode('')
  }

  const handleLogout = () => { setRole(null); sessionStorage.removeItem('app_role') }

  if (!role) {
    return (
      <main className="app-shell" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f8fafc' }}>
        <div style={{ background: 'white', padding: '40px', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', textAlign: 'center', maxWidth: '400px', width: '100%' }}>
          <div style={{ background: '#e0e7ff', width: '60px', height: '60px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', color: '#4f46e5' }}><Lock size={30} /></div>
          <h1 style={{ fontSize: '24px', margin: '0 0 8px', color: '#0f172a' }}>Acceso al Sistema</h1>
          <p style={{ color: '#64748b', marginBottom: '24px' }}>Ingresá tu clave para ver el inventario.</p>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <input type="password" value={pinCode} onChange={(e) => { setPinCode(e.target.value); setError(''); }} placeholder="Escribí tu clave secreta..." style={{ padding: '12px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '16px', textAlign: 'center' }} autoFocus />
            {error && <span style={{ color: '#ef4444', fontSize: '14px', fontWeight: 500 }}>{error}</span>}
            <button type="submit" style={{ background: '#0f172a', color: 'white', padding: '14px', borderRadius: '8px', border: 'none', fontWeight: 600, fontSize: '16px', cursor: 'pointer' }}>Entrar</button>
          </form>
        </div>
      </main>
    )
  }

  return <InventoryDashboard role={role} onLogout={handleLogout} />
}

function InventoryDashboard({ role, onLogout }: { role: Role, onLogout: () => void }) {
  const [data, setData] = useState<any>({ rawProducts: [], rawLots: [], summary: {} })
  const [loading, setLoading] = useState(true)
  const [actionMode, setActionMode] = useState<ActionMode>('initial')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [historyTypeFilter, setHistoryTypeFilter] = useState<HistoryTypeFilter>('all')
  const [historyDateFilter, setHistoryDateFilter] = useState('')
  const [viewTab, setViewTab] = useState<ViewTab>('inventory')
  const [search, setSearch] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [editLotId, setEditLotId] = useState<string | null>(null)
  const [editLotData, setEditLotData] = useState({ expirationDate: '', reference: '', quantity: '' })

  const [sortBy, setSortBy] = useState<SortBy>('sku')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  const loadData = async () => {
    try {
      const result = await getInventoryDashboard()
      if (result) setData({ rawProducts: result.rawProducts || [], rawLots: result.rawLots || [] })
    } catch (e) { console.error('Error cargando datos:', e) } 
    finally { setLoading(false) }
  }

  useEffect(() => { void loadData() }, [])

  const handleClearAll = async () => {
    if (confirm('¿Estás seguro de que querés BORRAR TODO para empezar de cero?')) {
      await clearAllDatabase()
      void loadData()
      setMessage({ type: 'success', text: 'Base de datos vaciada por completo.' })
    }
  }

  const enrichedInventory = useMemo(() => {
    const today = new Date(todayIso());
    const thirtyDays = new Date(today); thirtyDays.setDate(today.getDate() + 30);

    return (data.rawProducts || []).map((prodRaw: any) => {
      const pLots = (data.rawLots || []).filter((l: any) => l.productId === prodRaw.id || l.sku === prodRaw.sku);
      const initialQty = prodRaw.initialQuantity !== undefined ? prodRaw.initialQuantity : 0;
      
      let batches: any[] = [];
      if (initialQty > 0) batches.push({ date: prodRaw.expirationDate || '2099-12-31', qty: initialQty });
      pLots.forEach((l: any) => { 
        if (l.quantity > 0 && l.sourceType !== 'lost_sale') batches.push({ date: l.expirationDate || '2099-12-31', qty: l.quantity }); 
      });
      batches.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      
      const totalIn = batches.reduce((s, b) => s + b.qty, 0);
      let totalOut = prodRaw.totalOut || 0;
      if (totalOut < 0) totalOut = 0;
      
      const currentStock = totalIn - totalOut;
      
      let burned = totalOut;
      let goodStock = 0;
      let expiredStock = 0;
      let activeExpDate = null;
      let firstExpiredDate = null;

      for (const b of batches) {
        if (burned >= b.qty) {
          burned -= b.qty;
        } else {
          const rem = b.qty - burned;
          burned = 0;
          
          const bDate = b.date === '2099-12-31' ? null : b.date;
          const isBatchExpired = bDate && new Date(`${bDate}T00:00:00Z`) < today;

          if (isBatchExpired) {
            expiredStock += rem;
            if (!firstExpiredDate) firstExpiredDate = bDate;
          } else {
            goodStock += rem;
            if (!activeExpDate) activeExpDate = bDate;
          }
        }
      }

      const avgSales = prodRaw.averageDailySales || 0;
      let isExpired = expiredStock > 0;
      let isExpiringSoon = false, isRisk = false;

      if (activeExpDate) {
        const expD = new Date(`${activeExpDate}T00:00:00Z`);
        if (expD <= thirtyDays) isExpiringSoon = true;
        if (avgSales > 0) {
          const daysToSell = goodStock / avgSales;
          const daysToExpire = (expD.getTime() - today.getTime()) / 86400000;
          if (daysToSell > daysToExpire) isRisk = true;
        }
      }
      
      return { ...prodRaw, currentStock, goodStock, expiredStock, activeExpDate, firstExpiredDate, avgSales, isExpired, isExpiringSoon, isRisk };
    });
  }, [data.rawProducts, data.rawLots]);

  // EL CEREBRO: CÁLCULO HISTÓRICO RETROACTIVO DE VENTA PERDIDA (Sin tocar BD)
  const computedLostSales = useMemo(() => {
    const lost: any[] = [];
    const todayStr = todayIso();
    
    enrichedInventory.forEach((p: any) => {
      if (p.avgSales <= 0) return;
      
      // Agarramos todos los movimientos reales (entradas y salidas) de este producto
      const pLots = (data.rawLots || []).filter((l: any) => 
        (l.productId === p.id || l.sku === p.sku) && 
        l.sourceType !== 'lost_sale' && 
        l.sourceType !== 'lost_sale_live' &&
        l.sourceType !== 'lost_sale_hist'
      );
      
      // Agrupamos el stock día por día para simular el paso del tiempo
      const lotsByDate: Record<string, number> = {};
      pLots.forEach((l: any) => {
        const d = l.receivedDate.slice(0, 10);
        lotsByDate[d] = (lotsByDate[d] || 0) + parseQuantity(l.quantity);
      });
      
      const sortedDates = Object.keys(lotsByDate).sort();
      let runningStock = 0;
      
      for (let i = 0; i < sortedDates.length; i++) {
        const dStr = sortedDates[i];
        if (dStr >= todayStr) continue; // Lo de hoy lo calculamos en vivo después
        
        runningStock += lotsByDate[dStr];
        
        // Si el stock quedó en cero o menos, calculamos cuántos días pasaron hasta el próximo evento
        if (runningStock <= 0) {
          const nextDStr = (i + 1 < sortedDates.length && sortedDates[i+1] <= todayStr) 
            ? sortedDates[i+1] 
            : todayStr;
            
          if (dStr !== nextDStr) {
            const d1 = new Date(`${dStr}T00:00:00Z`);
            const d2 = new Date(`${nextDStr}T00:00:00Z`);
            const diffDays = Math.round((d2.getTime() - d1.getTime()) / 86400000);
            
            if (diffDays > 0) {
              lost.push({
                id: `hist-lost-${p.id}-${dStr}`,
                productId: p.id,
                sku: p.sku,
                name: p.name,
                sourceType: 'lost_sale_hist',
                reference: `Quiebre: ${formatDate(dStr)} al ${nextDStr === todayStr ? 'Hoy' : formatDate(nextDStr)}`,
                quantity: diffDays * p.avgSales, // Días en 0 multiplicado por la venta diaria
                receivedDate: dStr,
                expirationDate: null
              });
            }
          }
        }
      }
    });
    return lost.sort((a,b) => new Date(b.receivedDate).getTime() - new Date(a.receivedDate).getTime());
  }, [data.rawLots, enrichedInventory]);

  // VENTAS PERDIDAS HOY (EN VIVO)
  const liveLostSalesLots = useMemo(() => {
    return enrichedInventory
      .filter((p: any) => p.goodStock === 0 && p.avgSales > 0)
      .map((p: any) => ({
        id: 'live-' + p.id,
        productId: p.id,
        sku: p.sku,
        name: p.name,
        sourceType: 'lost_sale_live',
        reference: 'Quiebre actual (Perdiendo Hoy)',
        quantity: p.avgSales,
        receivedDate: todayIso(),
        expirationDate: null
      }));
  }, [enrichedInventory]);

  const liveLostSalesCount = liveLostSalesLots.reduce((sum, l) => sum + l.quantity, 0);
  const historicalLostSalesCount = computedLostSales.reduce((sum, l) => sum + l.quantity, 0);

  const finalInventory = useMemo(() => {
    const query = search.trim().toLowerCase();
    
    const filtered = enrichedInventory.filter((p: any) => {
      if (query && !p.name.toLowerCase().includes(query) && !String(p.sku).toLowerCase().includes(query)) return false;
      if (filterMode === 'all') return p.goodStock > 0 || (p.currentStock === 0 && p.expiredStock === 0);
      if (filterMode === 'expired') return p.expiredStock > 0;
      if (filterMode === 'expiringSoon') return p.isExpiringSoon;
      if (filterMode === 'risk') return p.isRisk;
      return true;
    });

    return filtered.sort((a: any, b: any) => {
      const stockKey = filterMode === 'expired' ? 'expiredStock' : 'goodStock';
      let valA, valB;
      if (sortBy === 'sku') { valA = String(a.sku).toLowerCase(); valB = String(b.sku).toLowerCase(); } 
      else if (sortBy === 'name') { valA = String(a.name).toLowerCase(); valB = String(b.name).toLowerCase(); } 
      else if (sortBy === 'stock') { valA = a[stockKey]; valB = b[stockKey]; } 
      else if (sortBy === 'expiration') {
        const dateKey = filterMode === 'expired' ? 'firstExpiredDate' : 'activeExpDate';
        const farFuture = sortOrder === 'asc' ? Infinity : -Infinity;
        valA = a[dateKey] ? new Date(a[dateKey]).getTime() : farFuture;
        valB = b[dateKey] ? new Date(b[dateKey]).getTime() : farFuture;
      }
      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [enrichedInventory, search, filterMode, sortBy, sortOrder]);

  const dashboardStats = useMemo(() => {
    let totalUnits = 0, expiringSoon = 0, expired = 0, activeProducts = 0;
    enrichedInventory.forEach((p: any) => {
      totalUnits += p.goodStock;
      expired += p.expiredStock;
      if (p.isExpiringSoon) expiringSoon += p.goodStock;
      if (p.goodStock > 0) activeProducts++;
    });
    return { totalUnits, expiringSoon, expired, activeProducts };
  }, [enrichedInventory]);

  const historyData = useMemo(() => {
    let raw = (data.rawLots || []).map((lot: any) => {
      const prod = (data.rawProducts || []).find((p: any) => p.id === lot.productId || p.sku === lot.sku)
      return { ...lot, sku: prod?.sku || lot.sku || 'Desconocido', name: prod?.name || 'Producto eliminado', productId: prod?.id || lot.productId }
    }).reverse();

    if (viewTab === 'lost_sales') {
      // Si entra a pérdidas, mezclamos lo retroactivo histórico + lo de hoy en vivo
      raw = [...liveLostSalesLots, ...computedLostSales];
    } else {
      // Limpiamos los rastros viejos de la base de datos para no mezclar
      raw = raw.filter((lot: any) => lot.sourceType !== 'lost_sale' && lot.sourceType !== 'lost_sale_live' && lot.sourceType !== 'lost_sale_hist');
      if (historyTypeFilter !== 'all') {
        raw = raw.filter((lot: any) => lot.sourceType === historyTypeFilter);
      }
    }

    if (historyDateFilter) {
      raw = raw.filter((lot: any) => {
        const rDate = lot.receivedDate || '';
        return rDate.startsWith(historyDateFilter);
      });
    }

    const query = search.trim().toLowerCase();
    if (!query) return raw;
    return raw.filter((lot: any) => lot.sku.toLowerCase().includes(query) || lot.name.toLowerCase().includes(query) || (lot.reference && lot.reference.toLowerCase().includes(query)));
  }, [data.rawLots, data.rawProducts, search, historyTypeFilter, historyDateFilter, viewTab, liveLostSalesLots, computedLostSales]);

  async function runMutation(task: () => Promise<unknown>, successText: string) {
    setMessage(null); setIsSubmitting(true);
    try { await task(); await loadData(); setMessage({ type: 'success', text: successText }); } 
    catch (error: any) { setMessage({ type: 'error', text: error?.message || 'Error al guardar.' }); } 
    finally { setIsSubmitting(false); }
  }

  const handleExportCSV = () => {
    const headers = ['SKU', 'Nombre', 'Stock Bueno', 'Stock Vencido', 'Próximo Vto (Bueno)'];
    const rows = finalInventory.map((p: any) => [
      p.sku, `"${p.name}"`, p.goodStock, p.expiredStock, p.activeExpDate ? p.activeExpDate : 'Sin fecha'
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.setAttribute('download', `Inventario_${todayIso()}.csv`);
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  return (
    <main className="app-shell">
      <div className="grid-glow" />
      <header className="topbar">
        <a className="brand" href="#top">
          <span className="brand-mark"><Boxes size={20} /></span>
          <span><strong>Stock al Día</strong><small>Control FEFO</small></span>
        </a>
        <div className="topbar-status" style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span className="live-dot" style={{ background: role === 'admin' ? '#ef4444' : '#10b981' }} />
            <span>Perfil: <strong>{role === 'admin' ? 'Admin' : 'Lector'}</strong></span>
          </div>
          <button onClick={onLogout} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '13px' }}><LogOut size={14} /> Salir</button>
        </div>
      </header>

      <div className="page" id="top">
        <section className="stats-grid">
          <StatCard icon={<PackageOpen />} label="Stock disponible" value={numberFormatter.format(dashboardStats.totalUnits)} detail={`${dashboardStats.activeProducts} productos activos`} tone="ink" onClick={() => { setFilterMode('all'); setViewTab('inventory'); }} active={filterMode === 'all' && viewTab === 'inventory'} />
          <StatCard icon={<CalendarClock />} label="Vence en 30 días" value={numberFormatter.format(dashboardStats.expiringSoon)} detail="bultos críticos" tone="amber" onClick={() => { setFilterMode('expiringSoon'); setViewTab('inventory'); }} active={filterMode === 'expiringSoon' && viewTab === 'inventory'} />
          <StatCard icon={<ShieldCheck />} label="Stock vencido" value={numberFormatter.format(dashboardStats.expired)} detail="bultos apartados" tone="green" onClick={() => { setFilterMode('expired'); setViewTab('inventory'); }} active={filterMode === 'expired' && viewTab === 'inventory'} />
          
          {/* NUEVA TARJETA DE PÉRDIDAS */}
          <StatCard icon={<TrendingDown />} label="Venta Perdida" value={numberFormatter.format(liveLostSalesCount + historicalLostSalesCount)} detail={`Hoy: ${numberFormatter.format(liveLostSalesCount)} bultos`} tone="rose" onClick={() => { setViewTab('lost_sales'); }} active={viewTab === 'lost_sales'} />
        </section>

        <div className="workspace" style={{ display: 'flex', gap: '24px' }}>
          <div className="main-column" style={{ flex: role === 'viewer' ? '1 1 100%' : '1' }}>
            <section className="panel inventory-panel">
              <div className="panel-heading" style={{ flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  <button onClick={() => setViewTab('inventory')} style={{ background: 'none', border: 'none', fontSize: '20px', fontWeight: viewTab === 'inventory' ? 700 : 400, color: viewTab === 'inventory' ? '#111' : '#666', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}><ListFilter size={20} /> Inventario</button>
                  <button onClick={() => setViewTab('history')} style={{ background: 'none', border: 'none', fontSize: '20px', fontWeight: viewTab === 'history' ? 700 : 400, color: viewTab === 'history' ? '#111' : '#666', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}><History size={20} /> Historial</button>
                  <button onClick={() => setViewTab('lost_sales')} style={{ background: 'none', border: 'none', fontSize: '20px', fontWeight: viewTab === 'lost_sales' ? 700 : 400, color: viewTab === 'lost_sales' ? '#e11d48' : '#666', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}><TrendingDown size={20} /> Quiebres / Pérdidas</button>
                </div>
                
                <div className="inventory-tools" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <label className="search-box"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar..." /></label>
                  
                  {viewTab === 'inventory' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: '#f8fafc', padding: '0 8px', borderRadius: '8px', border: '1px solid #cbd5e1' }}>
                      <ArrowUpDown size={15} color="#64748b"/>
                      <select
                        value={`${sortBy}-${sortOrder}`}
                        onChange={(e) => {
                          const [newBy, newOrder] = e.target.value.split('-');
                          setSortBy(newBy as SortBy);
                          setSortOrder(newOrder as SortOrder);
                        }}
                        style={{ background: 'transparent', border: 'none', outline: 'none', fontSize: '13px', color: '#334155', cursor: 'pointer', padding: '6px 0' }}
                      >
                        <option value="sku-asc">SKU (A-Z)</option>
                        <option value="sku-desc">SKU (Z-A)</option>
                        <option value="name-asc">Nombre (A-Z)</option>
                        <option value="stock-desc">Mayor Stock</option>
                        <option value="stock-asc">Menor Stock</option>
                        <option value="expiration-asc">Vence más pronto</option>
                        <option value="expiration-desc">Vence más tarde</option>
                      </select>
                    </div>
                  )}

                  {viewTab !== 'lost_sales' && (
                    <button onClick={handleExportCSV} style={{ background: '#f8fafc', border: '1px solid #cbd5e1', color: '#334155', padding: '0 12px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600 }}>
                      <Download size={15} /> Exportar
                    </button>
                  )}

                  {role === 'admin' && (<button onClick={handleClearAll} style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', padding: '0 12px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600 }}><Trash2 size={15} /> Vaciar Todo</button>)}
                </div>
              </div>

              {(viewTab === 'history' || viewTab === 'lost_sales') && (
                <>
                  <div style={{ padding: '12px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: '12px', alignItems: 'center', background: '#fafafa', flexWrap: 'wrap' }}>
                    {viewTab === 'history' && (
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}><Filter size={14} /> Tipo:</span>
                        <button className={`mini-action ${historyTypeFilter === 'all' ? 'active' : ''}`} onClick={() => setHistoryTypeFilter('all')}>Todos</button>
                        <button className={`mini-action ${historyTypeFilter === 'initial' ? 'active' : ''}`} onClick={() => setHistoryTypeFilter('initial')}>Stock Inicial</button>
                        <button className={`mini-action ${historyTypeFilter === 'receipt' ? 'active' : ''}`} onClick={() => setHistoryTypeFilter('receipt')}>Boletas</button>
                        <button className={`mini-action ${historyTypeFilter === 'adjustment' ? 'active' : ''}`} onClick={() => setHistoryTypeFilter('adjustment')}>Ventas / Salidas</button>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginLeft: viewTab === 'history' ? 'auto' : '0' }}>
                      <span style={{ fontSize: '13px', color: '#64748b', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}><Calendar size={14} /> Fecha:</span>
                      <input type="date" value={historyDateFilter} onChange={(e) => setHistoryDateFilter(e.target.value)} style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px' }} />
                      {historyDateFilter && (<button onClick={() => setHistoryDateFilter('')} style={{ background: 'none', border: 'none', color: '#ef4444', fontSize: '12px', cursor: 'pointer', fontWeight: 600 }}>Limpiar</button>)}
                    </div>
                  </div>
                  
                  {role === 'admin' && historyData.length > 0 && viewTab === 'history' && (
                    <div style={{ padding: '8px 20px', background: '#fff1f2', borderBottom: '1px solid #ffe4e6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '13px', color: '#be123c', fontWeight: 600 }}>⚠️ Estás viendo una lista de {historyData.length} registros</span>
                      <button onClick={async () => {
                        if (confirm(`¿ATENCIÓN: Estás seguro de que querés ELIMINAR ESTOS ${historyData.length} REGISTROS visibles? El stock se revertirá automáticamente a como estaba antes de esta carga.`)) {
                          const itemsToDel = historyData.map((l:any) => ({ lotId: l.id, productId: l.productId }));
                          if (itemsToDel.length > 0) {
                            await runMutation(() => deleteLotRecordsBatch(itemsToDel), `Se eliminaron ${itemsToDel.length} registros y se ajustó el stock.`);
                          }
                        }
                      }} style={{ background: '#e11d48', color: 'white', border: 'none', padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Trash2 size={15} /> Borrar todos los registros de esta lista
                      </button>
                    </div>
                  )}
                </>
              )}

              {loading ? (<div style={{ padding: '32px', textAlign: 'center' }}>Cargando datos...</div>) 
              : viewTab === 'inventory' ? (
                finalInventory.length > 0 ? (
                  <div className="inventory-list">
                    {finalInventory.map((product: any) => {
                      const isShowingExpired = filterMode === 'expired';
                      const displayStock = isShowingExpired ? product.expiredStock : product.goodStock;

                      return (
                        <article className="product-row" key={product.id}>
                          <div className="product-identity">
                            <span className="sku-tag">{product.sku}</span>
                            <div>
                              <h3>{product.name}</h3>
                              <p>
                                Venta prom: {product.avgSales}/día 
                                {isShowingExpired ? (
                                  <span style={{ marginLeft: '12px', color: '#dc2626', fontWeight: 600 }}>⚠️ Venció: {product.firstExpiredDate ? formatDate(product.firstExpiredDate) : '...'}</span>
                                ) : (
                                  <span style={{ marginLeft: '12px', color: product.isExpiringSoon ? '#d97706' : '#059669', fontWeight: 600 }}>🗓️ Activo: {product.activeExpDate ? formatDate(product.activeExpDate) : 'Sin fecha'}</span>
                                )}
                                {!isShowingExpired && product.expiredStock > 0 && (
                                  <span style={{ marginLeft: '8px', color: '#991b1b', background: '#ffe4e6', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }} title="Están en la estantería pero ya vencieron">+{product.expiredStock} vencidos</span>
                                )}
                                {/* CARTEL EN VIVO DE VENTA PERDIDA */}
                                {!isShowingExpired && product.goodStock <= 0 && product.avgSales > 0 && (
                                  <span style={{ marginLeft: '8px', color: '#dc2626', background: '#fef2f2', padding: '2px 6px', borderRadius: '4px', fontSize: '12px', fontWeight: 700 }} title="Estás sin stock hoy">⚠️ Stock 0: Perdiendo {product.avgSales} bultos hoy</span>
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="stock-number" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <div style={{ textAlign: 'right' }}>
                              <strong>{numberFormatter.format(displayStock || 0)}</strong>
                              <span style={{ display: 'block', fontSize: '12px', color: '#64748b' }}>bultos</span>
                            </div>
                            {role === 'admin' && (
                              <button onClick={async () => {
                                if(confirm(`¿Seguro que querés ELIMINAR POR COMPLETO el producto ${product.sku} y todo su historial de la base de datos?`)) {
                                  await runMutation(() => deleteProduct(product.id), 'Producto eliminado correctamente.');
                                }
                              }} style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#ef4444', cursor: 'pointer', padding: '6px', borderRadius: '6px' }} title="Eliminar Producto Completo">
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        </article>
                      )
                    })}
                  </div>
                ) : (<div className="empty-state" style={{ padding: '32px', textAlign: 'center' }}><h3>No hay resultados</h3></div>)
              ) : (
                <div className="inventory-list">
                  {historyData.length > 0 ? (
                    historyData.map((lot: any, idx: number) => {
                      const qty = lot.quantity || 0;
                      const isNeg = qty < 0;
                      const displayQty = qty > 0 ? `+${numberFormatter.format(qty)}` : numberFormatter.format(qty);
                      
                      const isLostSaleLive = lot.sourceType === 'lost_sale_live';
                      const isLostSaleHist = lot.sourceType === 'lost_sale_hist';
                      const isLostSale = isLostSaleLive || isLostSaleHist;
                      
                      const color = isLostSale ? '#e11d48' : (isNeg ? '#dc2626' : '#059669');
                      const typeLabel = isLostSaleLive ? 'EN VIVO (HOY)' : (isLostSaleHist ? 'VENTA PERDIDA' : (lot.sourceType === 'initial' ? 'STOCK INICIAL' : (lot.sourceType === 'receipt' ? 'BOLETA' : 'VENTA / SALIDA')));
                      const isEditing = editLotId === lot.id;

                      return (
                        <article className="product-row" key={lot.id || idx}>
                          <div className="product-identity" style={{ flex: 1 }}>
                            <span className="sku-tag" style={{ background: isLostSale ? '#ffe4e6' : '#eef2ff', color: isLostSale ? '#e11d48' : '#4f46e5' }}>{lot.sku}</span>
                            <div>
                              <h3>{lot.name}</h3>
                              {isEditing && !isLostSale ? (
                                <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
                                  <label style={{ display: 'flex', flexDirection: 'column', fontSize: '11px', color: '#666', width: '70px' }}>Cant.
                                    <input type="number" step="any" value={editLotData.quantity} onChange={e => setEditLotData({...editLotData, quantity: e.target.value})} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }} />
                                  </label>
                                  <label style={{ display: 'flex', flexDirection: 'column', fontSize: '11px', color: '#666' }}>Vencimiento
                                    <input type="date" value={editLotData.expirationDate} onChange={e => setEditLotData({...editLotData, expirationDate: e.target.value})} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }} />
                                  </label>
                                  <label style={{ display: 'flex', flexDirection: 'column', fontSize: '11px', color: '#666', flex: 1, minWidth: '150px' }}>Ref / Detalle
                                    <input type="text" value={editLotData.reference} onChange={e => setEditLotData({...editLotData, reference: e.target.value})} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '13px' }} />
                                  </label>
                                </div>
                              ) : (
                                <p style={{ color: '#666', fontSize: '13px' }}>
                                  <span style={{ fontWeight: 600, color: isLostSale ? '#be123c' : '#0f172a' }}>[{typeLabel}]</span> {lot.reference} | 📅 {formatDate(lot.receivedDate || todayIso())} {lot.expirationDate && !isLostSale ? `| 🗓️ Vence: ${formatDate(lot.expirationDate)}` : ''}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="stock-number" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                            <div style={{ textAlign: 'right' }}>
                              <strong style={{ color }}>{isLostSale ? `-${numberFormatter.format(qty)}` : displayQty}</strong>
                              <span style={{ display: 'block', fontSize: '12px', color: '#64748b' }}>bultos</span>
                            </div>
                            {role === 'admin' && !isLostSale && (
                              isEditing ? (
                                <div style={{ display: 'flex', gap: '6px' }}>
                                  <button onClick={async () => {
                                    await runMutation(() => updateLotRecord(lot.id, editLotData), 'Historial corregido.');
                                    setEditLotId(null);
                                  }} style={{ background: '#10b981', color: 'white', border: 'none', padding: '6px', borderRadius: '6px', cursor: 'pointer' }} title="Guardar"><Check size={16} /></button>
                                  <button onClick={() => setEditLotId(null)} style={{ background: '#ef4444', color: 'white', border: 'none', padding: '6px', borderRadius: '6px', cursor: 'pointer' }} title="Cancelar"><X size={16} /></button>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', gap: '6px' }}>
                                  <button onClick={() => {
                                    setEditLotId(lot.id);
                                    setEditLotData({ expirationDate: lot.expirationDate || '', reference: lot.reference || '', quantity: String(lot.quantity || 0) });
                                  }} style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', color: '#64748b', cursor: 'pointer', padding: '6px', borderRadius: '6px' }} title="Editar"><Edit3 size={15} /></button>
                                  <button onClick={async () => {
                                    if(confirm('¿Seguro que querés borrar este registro de la historia? El stock se recalculará automáticamente.')) {
                                      await runMutation(() => deleteLotRecord(lot.id, lot.productId), 'Registro borrado exitosamente.');
                                    }
                                  }} style={{ background: '#fee2e2', border: '1px solid #fca5a5', color: '#ef4444', cursor: 'pointer', padding: '6px', borderRadius: '6px' }} title="Borrar del Historial"><Trash2 size={15} /></button>
                                </div>
                              )
                            )}
                          </div>
                        </article>
                      );
                    })
                  ) : (<div className="empty-state" style={{ padding: '32px', textAlign: 'center' }}><h3>{viewTab === 'lost_sales' ? 'No hay ventas perdidas registradas' : 'Historial vacío para esta búsqueda'}</h3></div>)}
                </div>
              )}
            </section>
          </div>

          {role === 'admin' && (
            <aside className="action-panel" style={{ width: '380px', flexShrink: 0 }}>
              <div className="action-tabs">
                <button className={actionMode === 'initial' ? 'active' : ''} onClick={() => { setActionMode('initial'); setMessage(null); }}><FilePlus2 size={17} /> Inicial / Excel</button>
                <button className={actionMode === 'receipt' ? 'active' : ''} onClick={() => { setActionMode('receipt'); setMessage(null); }}><ReceiptText size={17} /> Boleta</button>
                <button className={actionMode === 'snapshot' ? 'active' : ''} onClick={() => { setActionMode('snapshot'); setMessage(null); }}><ClipboardPaste size={17} /> Conteo</button>
              </div>
              {message && (<div className={`form-message ${message.type}`}><span>{message.text}</span></div>)}
              
              {actionMode === 'initial' && (
                <InitialForm disabled={isSubmitting} 
                  onSubmit={(payload: any) => runMutation(() => createInitialStock(payload), 'Producto guardado.')}
                  onBatchSubmit={async (items: any[]) => {
                    setIsSubmitting(true); setMessage(null);
                    try {
                      for (const item of items) { await createInitialStock(item); }
                      await loadData(); 
                      setMessage({ type: 'success', text: `${items.length} productos procesados/actualizados.` })
                    } catch (error: any) {
                      setMessage({ type: 'error', text: error.message || 'Error al importar Excel.' })
                    } finally { setIsSubmitting(false) }
                  }}
                  onAvgSalesSubmit={async (items: any[]) => {
                    setIsSubmitting(true); setMessage(null);
                    try {
                      await updateAverageSalesBatch(items);
                      await loadData();
                      setMessage({ type: 'success', text: `Venta promedio actualizada para ${items.length} productos.` });
                    } catch (error: any) {
                      setMessage({ type: 'error', text: error.message || 'Error al actualizar ventas promedio.' });
                    } finally { setIsSubmitting(false); }
                  }}
                />
              )}

              {actionMode === 'receipt' && (
                <ReceiptForm data={data} disabled={isSubmitting} onSubmit={(payload: any) => runMutation(() => addReceipt(payload), 'Boleta cargada.')}
                  onBatchSubmit={async (items: any[]) => {
                    setIsSubmitting(true); setMessage(null);
                    try {
                      for (const item of items) { await addReceipt(item); }
                      await loadData(); 
                      setMessage({ type: 'success', text: `${items.length} productos ingresados.` })
                    } catch (error: any) {
                      setMessage({ type: 'error', text: error.message || 'Error al cargar boletas.' })
                    } finally { setIsSubmitting(false) }
                  }} />
              )}

              {actionMode === 'snapshot' && (
                <SnapshotForm data={data} enrichedInventory={enrichedInventory} disabled={isSubmitting} onSubmit={(payload: any) => runMutation(() => saveDailySnapshot(payload), 'Conteo guardado.')}
                  onBatchUpdate={async (items: any[]) => {
                    setIsSubmitting(true); setMessage(null);
                    try {
                      const newLots: any[] = [];
                      items.forEach(item => {
                        const prod = enrichedInventory.find((p: any) => String(p.sku).toLowerCase() === item.sku.toLowerCase());
                        if (prod) {
                          newLots.push({
                            id: crypto.randomUUID(),
                            productId: prod.id,
                            sku: prod.sku,
                            quantity: item.realQuantity,
                            expirationDate: item.expirationDate || prod.activeExpDate || null,
                            reference: 'VENTA/AJUSTE DE CONTEO',
                            receivedDate: todayIso()
                          });
                        }
                      });

                      await syncAdjustments([], newLots);
                      await loadData();
                      setMessage({ type: 'success', text: `Stock y ventas registradas para ${items.length} productos.` });
                    } catch (error: any) {
                      setMessage({ type: 'error', text: error.message || 'Error al registrar ventas.' });
                    } finally { setIsSubmitting(false); }
                  }} />
              )}
            </aside>
          )}
        </div>
      </div>
    </main>
  )
}

function StatCard({ icon, label, value, detail, tone, onClick, active }: any) {
  return (
    <article className={`stat-card ${tone}`} onClick={onClick} style={{ cursor: 'pointer', border: active ? '2px solid currentColor' : '1px solid transparent', transform: active ? 'scale(1.02)' : 'none', transition: 'all 0.2s ease' }}>
      <span className="stat-icon">{icon}</span><div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
    </article>
  )
}

function InitialForm({ disabled, onSubmit, onBatchSubmit, onAvgSalesSubmit }: any) {
  const [subMode, setSubMode] = useState<'single' | 'excel' | 'avgOnly'>('single');
  const [excelText, setExcelText] = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = new FormData(e.currentTarget); const qty = Number(form.get('quantity'));
    await onSubmit({ sku: String(form.get('sku')), name: String(form.get('name')), unit: String(form.get('unit')), minimumStock: Number(form.get('minimumStock')), averageDailySales: Number(form.get('averageDailySales')), quantity: qty, expirationDate: String(form.get('expirationDate')), receivedDate: todayIso() });
    e.currentTarget.reset();
  }

  async function handleBatch() {
    const lines = excelText.split(/\r?\n/).map(l => l.trim()).filter(Boolean); const items = [];
    for (const line of lines) {
      const parts = line.split('\t').map(p => p.trim());
      if (parts.length >= 4) {
        const sku = parts[0], name = parts[1], rawQty = parts[2].trim();
        const quantity = parseFloat(rawQty.includes(',') && rawQty.includes('.') ? rawQty.replace(/\./g, '').replace(',', '.') : rawQty.replace(',', '.')) || 0;
        let expDate = parts[3]; if (expDate.includes('/')) { const dp = expDate.split('/'); if (dp.length === 3) expDate = `${dp[2].length === 2 ? '20'+dp[2] : dp[2]}-${dp[1].padStart(2, '0')}-${dp[0].padStart(2, '0')}`; }
        const avgDailySales = parts[4] ? parseFloat(parts[4].trim().replace(',', '.')) || 0 : 0;
        items.push({ sku, name, quantity, expirationDate: expDate, minimumStock: 0, averageDailySales: avgDailySales, unit: 'bultos', receivedDate: todayIso() });
      }
    }
    if (items.length === 0) return alert('Copiar: SKU | Nombre | Cantidad | Vencimiento | Vta Promedio');
    await onBatchSubmit(items); setExcelText('');
  }

  async function handleAvgOnlyBatch() {
    const lines = excelText.split(/\r?\n/).map(l => l.trim()).filter(Boolean); const items = [];
    for (const line of lines) {
      const parts = line.split('\t').map(p => p.trim());
      if (parts.length >= 2) {
        const sku = parts[0];
        const avgDailySales = parseFloat(parts[1].trim().replace(',', '.')) || 0;
        items.push({ sku, averageDailySales: avgDailySales });
      }
    }
    if (items.length === 0) return alert('Copiar solo 2 columnas de Excel: SKU | Venta Promedio');
    await onAvgSalesSubmit(items); setExcelText('');
  }

  return (
    <div className="action-form">
      <h2>Cargar / Actualizar productos</h2>
      <div style={{ display: 'flex', gap: '6px', margin: '12px 0', flexWrap: 'wrap' }}>
        <button type="button" className={`mini-action ${subMode === 'single' ? 'active' : ''}`} onClick={() => setSubMode('single')}>Uno por uno</button>
        <button type="button" className={`mini-action ${subMode === 'excel' ? 'active' : ''}`} onClick={() => setSubMode('excel')}><Table size={14} /> Excel Todo</button>
        <button type="button" className={`mini-action ${subMode === 'avgOnly' ? 'active' : ''}`} onClick={() => setSubMode('avgOnly')}><TrendingUp size={14} /> Solo Vta Prom.</button>
      </div>

      {subMode === 'avgOnly' ? (
        <div>
          <p style={{ fontSize: '12px', color: '#64748b', marginBottom: '8px' }}>Pega 2 columnas de Excel: <strong>SKU</strong> | <strong>Venta Promedio</strong>. No modifica el stock actual.</p>
          <textarea rows={8} value={excelText} onChange={(e) => setExcelText(e.target.value)} placeholder="Ej:&#10;HAR-01  3.5&#10;ACE-02  1.2" />
          <button className="submit-button" onClick={() => void handleAvgOnlyBatch()} disabled={disabled || !excelText.trim()} style={{ marginTop: '10px' }}>Actualizar Solo Ventas Promedio</button>
        </div>
      ) : subMode === 'excel' ? (
        <div>
          <textarea rows={8} value={excelText} onChange={(e) => setExcelText(e.target.value)} placeholder="Ej: HAR-01  Harina  100  2026-12-01  2.5" />
          <button className="submit-button" onClick={() => void handleBatch()} disabled={disabled || !excelText.trim()} style={{ marginTop: '10px' }}>Importar Todo</button>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)}>
          <div className="field-pair"><label className="field"><span>SKU</span><input name="sku" required /></label><label className="field"><span>Unidad</span><input name="unit" defaultValue="bultos" required /></label></div>
          <label className="field"><span>Nombre</span><input name="name" required /></label>
          <div className="field-pair"><label className="field"><span>Cant. inicial</span><input type="number" name="quantity" required /></label><label className="field"><span>Venta prom.</span><input type="number" name="averageDailySales" defaultValue="0" step="0.1" required /></label></div>
          <label className="field"><span>Vencimiento</span><input type="date" name="expirationDate" required /></label>
          <button className="submit-button" disabled={disabled} style={{ marginTop: '12px' }}>Crear</button>
        </form>
      )}
    </div>
  )
}

function ReceiptForm({ data, disabled, onSubmit, onBatchSubmit }: any) {
  const [isExcel, setIsExcel] = useState(false); const [excelText, setExcelText] = useState(''); const [skuInput, setSkuInput] = useState('');
  
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const product = data.rawProducts?.find((p: any) => String(p.sku).toLowerCase() === skuInput.trim().toLowerCase());
    if (!product) return alert(`El SKU no existe.`); const form = new FormData(e.currentTarget);
    const recDate = String(form.get('receivedDate') || todayIso());
    
    await onSubmit({ productId: product.id, reference: String(form.get('reference')), quantity: Number(form.get('quantity')), expirationDate: String(form.get('expirationDate')), receivedDate: recDate }); setSkuInput('');
  }

  async function handleBatch() {
    const lines = excelText.split(/\r?\n/).map(l => l.trim()).filter(Boolean); const items = [];
    for (const line of lines) {
      const parts = line.split('\t').map(p => p.trim());
      if (parts.length >= 3) {
        const product = data.rawProducts?.find((p: any) => String(p.sku).toLowerCase() === parts[0].toLowerCase());
        if (product) {
           const quantity = parseFloat(parts[1].trim().replace(',', '.')) || 0; let expDate = parts[2];
           if (expDate.includes('/')) { const dp = expDate.split('/'); if (dp.length === 3) expDate = `${dp[2].length === 2 ? '20'+dp[2] : dp[2]}-${dp[1].padStart(2, '0')}-${dp[0].padStart(2, '0')}`; }
           
           let recDate = parts[3] || todayIso();
           if (recDate.includes('/')) { const dp2 = recDate.split('/'); if (dp2.length === 3) recDate = `${dp2[2].length === 2 ? '20'+dp2[2] : dp2[2]}-${dp2[1].padStart(2, '0')}-${dp2[0].padStart(2, '0')}`; }

           items.push({ productId: product.id, reference: 'CARGA-MASIVA', quantity, expirationDate: expDate, receivedDate: recDate });
        }
      }
    }
    if (items.length === 0) return alert('No se encontraron SKUs válidos.'); await onBatchSubmit(items); setExcelText('');
  }

  return (
    <div className="action-form">
      <h2>Cargar boleta</h2>
      <div style={{ display: 'flex', gap: '8px', margin: '12px 0' }}><button type="button" className={`mini-action ${!isExcel ? 'active' : ''}`} onClick={() => setIsExcel(false)}>Uno a uno</button><button type="button" className={`mini-action ${isExcel ? 'active' : ''}`} onClick={() => setIsExcel(true)}><Table size={14} /> Excel</button></div>
      {isExcel ? (
        <div>
          <textarea rows={8} value={excelText} onChange={(e) => setExcelText(e.target.value)} placeholder="Ej: HAR-01  50  2026-10-15  (Opcional Ingreso: 2026-07-24)" />
          <button className="submit-button" onClick={() => void handleBatch()} disabled={disabled || !excelText.trim()} style={{ marginTop: '10px' }}>Ingresar Boletas</button>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)}>
          <label className="field"><span>SKU</span><input value={skuInput} onChange={(e) => setSkuInput(e.target.value)} required /></label>
          <div className="field-pair">
            <label className="field"><span>Ref/Boleta</span><input name="reference" required /></label>
            <label className="field"><span>Fecha Ingreso</span><input type="date" name="receivedDate" defaultValue={todayIso()} required /></label>
          </div>
          <div className="field-pair">
            <label className="field"><span>Cant.</span><input type="number" name="quantity" required /></label>
            <label className="field"><span>Vencimiento</span><input type="date" name="expirationDate" required /></label>
          </div>
          <button className="submit-button" disabled={disabled} style={{ marginTop: '12px' }}>Sumar Stock</button>
        </form>
      )}
    </div>
  )
}

function SnapshotForm({ disabled, onSubmit, onBatchUpdate, enrichedInventory }: any) {
  const [isExcel, setIsExcel] = useState(false); const [excelText, setExcelText] = useState(''); 
  const [skuInput, setSkuInput] = useState(''); const [qtyInput, setQtyInput] = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) { 
    e.preventDefault(); 
    if (!skuInput || !qtyInput) return alert('Completá el SKU y el total físico');
    await onBatchUpdate([{ sku: skuInput, realQuantity: Number(qtyInput) }]);
    setSkuInput(''); setQtyInput('');
  }

  async function handleBatch() {
    const lines = excelText.split(/\r?\n/).map(l => l.trim()).filter(Boolean); const items = [];
    for (const line of lines) { 
      const parts = line.split('\t').map(p => p.trim()); 
      if (parts.length >= 2) {
        items.push({ 
          sku: parts[0], 
          realQuantity: parseFloat(parts[1].trim().replace(',', '.')) || 0
        }); 
      }
    }
    if (items.length === 0) return alert('Faltan datos.');
    if (confirm(`¿Actualizar el stock de estos ${items.length} productos?`)) { await onBatchUpdate(items); setExcelText(''); }
  }
  return (
    <div className="action-form">
      <h2>Ventas / Ajuste por Conteo</h2>
      <p style={{fontSize:'12px', color:'#64748b', marginBottom:'8px'}}>Cargá el total físico. Si el producto tiene bultos vencidos en la estantería, sumalos a la cuenta para que cuadre todo.</p>
      <div style={{ display: 'flex', gap: '8px', margin: '12px 0' }}><button type="button" className={`mini-action ${!isExcel ? 'active' : ''}`} onClick={() => setIsExcel(false)}>Uno a uno</button><button type="button" className={`mini-action ${isExcel ? 'active' : ''}`} onClick={() => setIsExcel(true)}><Table size={14} /> Excel</button></div>
      {isExcel ? (
        <div>
          <textarea rows={8} value={excelText} onChange={(e) => setExcelText(e.target.value)} placeholder="Ej: HAR-01  120" />
          <button className="submit-button" onClick={() => void handleBatch()} disabled={disabled || !excelText.trim()} style={{ marginTop: '10px' }}>Pisar Stock y Registrar Ventas</button>
        </div>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)}>
          <label className="field"><span>SKU</span><input value={skuInput} onChange={(e) => setSkuInput(e.target.value)} required /></label>
          <label className="field"><span>Total Físico</span><input type="number" step="any" value={qtyInput} onChange={(e) => setQtyInput(e.target.value)} required placeholder="Ej: 0" /></label>
          <button className="submit-button" disabled={disabled} style={{ marginTop: '12px' }}>Guardar Conteo</button>
        </form>
      )}
    </div>
  )
}
