
import { createFileRoute } from '@tanstack/react-router'
import {
  AlertTriangle, Boxes, CalendarClock, ClipboardPaste, FilePlus2, PackageOpen,
  ReceiptText, Search, ShieldCheck, Sparkles, Table, Trash2, History, ListFilter, Lock, LogOut
} from 'lucide-react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  addReceipt, createInitialStock, getInventoryDashboard, saveDailySnapshot, syncAdjustments, clearAllDatabase
} from '../../inventory.functions'

export const Route = createFileRoute('/')({ component: InventoryApp })

type ActionMode = 'initial' | 'receipt' | 'snapshot'
type FilterMode = 'all' | 'expiringSoon' | 'expired' | 'risk'
type ViewTab = 'inventory' | 'history'
type Role = 'admin' | 'viewer'

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
  const [viewTab, setViewTab] = useState<ViewTab>('inventory')
  const [search, setSearch] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

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
      pLots.forEach((l: any) => { if (l.quantity > 0) batches.push({ date: l.expirationDate || '2099-12-31', qty: l.quantity }); });
      batches.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      
      const totalIn = batches.reduce((s, b) => s + b.qty, 0);
      let totalOut = prodRaw.totalOut || 0;
      if (totalOut < 0) totalOut = 0;
      
      const currentStock = totalIn - totalOut;
      let activeExpDate = null; let burned = totalOut;
      for (const b of batches) {
        if (burned >= b.qty) burned -= b.qty;
        else { activeExpDate = b.date === '2099-12-31' ? null : b.date; break; }
      }

      const avgSales = prodRaw.averageDailySales || 0;
      let isExpired = false, isExpiringSoon = false, isRisk = false;
      if (activeExpDate) {
        const expD = new Date(`${activeExpDate}T00:00:00Z`);
        if (expD < today) isExpired = true; else if (expD <= thirtyDays) isExpiringSoon = true;
        if (avgSales > 0 && expD >= today) {
          const daysToSell = currentStock / avgSales;
          const daysToExpire = (expD.getTime() - today.getTime()) / 86400000;
          if (daysToSell > daysToExpire) isRisk = true;
        }
      }
      return { ...prodRaw, currentStock, activeExpDate, avgSales, isExpired, isExpiringSoon, isRisk };
    });
  }, [data.rawProducts, data.rawLots]);

  const finalInventory = useMemo(() => {
    const query = search.trim().toLowerCase();
    return enrichedInventory.filter((p: any) => {
      if (query && !p.name.toLowerCase().includes(query) && !String(p.sku).toLowerCase().includes(query)) return false;
      if (filterMode === 'all') return true;
      if (filterMode === 'expired') return p.isExpired;
      if (filterMode === 'expiringSoon') return p.isExpiringSoon;
      if (filterMode === 'risk') return p.isRisk;
      return true;
    });
  }, [enrichedInventory, search, filterMode]);

  const dashboardStats = useMemo(() => {
    let totalUnits = 0, expiringSoon = 0, expired = 0, risk = 0;
    enrichedInventory.forEach((p: any) => {
      totalUnits += p.currentStock;
      if (p.isExpired) expired += p.currentStock; else if (p.isExpiringSoon) expiringSoon += p.currentStock;
      if (p.isRisk) risk += p.currentStock;
    });
    return { totalUnits, expiringSoon, expired, risk, totalProducts: enrichedInventory.length };
  }, [enrichedInventory]);

  const historyData = useMemo(() => {
    const raw = (data.rawLots || []).map((lot: any) => {
      const prod = (data.rawProducts || []).find((p: any) => p.id === lot.productId || p.sku === lot.sku)
      return { ...lot, sku: prod?.sku || lot.sku || 'Desconocido', name: prod?.name || 'Producto eliminado' }
    }).reverse()
    const query = search.trim().toLowerCase();
    if (!query) return raw;
    return raw.filter((lot: any) => lot.sku.toLowerCase().includes(query) || lot.name.toLowerCase().includes(query) || (lot.reference && lot.reference.toLowerCase().includes(query)));
  }, [data.rawLots, data.rawProducts, search])

  async function runMutation(task: () => Promise<unknown>, successText: string) {
    setMessage(null); setIsSubmitting(true);
    try { await task(); await loadData(); setMessage({ type: 'success', text: successText }); } 
    catch (error: any) { setMessage({ type: 'error', text: error?.message || 'Error al guardar.' }); } 
    finally { setIsSubmitting(false); }
  }

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
          <StatCard icon={<PackageOpen />} label="Stock disponible" value={numberFormatter.format(dashboardStats.totalUnits)} detail={`${dashboardStats.totalProducts} productos`} tone="ink" onClick={() => { setFilterMode('all'); setViewTab('inventory'); }} active={filterMode === 'all' && viewTab === 'inventory'} />
          <StatCard icon={<CalendarClock />} label="Vence en 30 días" value={numberFormatter.format(dashboardStats.expiringSoon)} detail="unidades críticas" tone="amber" onClick={() => { setFilterMode('expiringSoon'); setViewTab('inventory'); }} active={filterMode === 'expiringSoon' && viewTab === 'inventory'} />
          <StatCard icon={<AlertTriangle />} label="Riesgo de merma" value={numberFormatter.format(dashboardStats.risk)} detail="vencerán antes" tone="rose" onClick={() => { setFilterMode('risk'); setViewTab('inventory'); }} active={filterMode === 'risk' && viewTab === 'inventory'} />
          <StatCard icon={<ShieldCheck />} label="Stock vencido" value={numberFormatter.format(dashboardStats.expired)} detail="unidades" tone="green" onClick={() => { setFilterMode('expired'); setViewTab('inventory'); }} active={filterMode === 'expired' && viewTab === 'inventory'} />
        </section>

        <div className="workspace" style={{ display: 'flex', gap: '24px' }}>
          <div className="main-column" style={{ flex: role === 'viewer' ? '1 1 100%' : '1' }}>
            <section className="panel inventory-panel">
              <div className="panel-heading">
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  <button onClick={() => setViewTab('inventory')} style={{ background: 'none', border: 'none', fontSize: '20px', fontWeight: viewTab === 'inventory' ? 700 : 400, color: viewTab === 'inventory' ? '#111' : '#666', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}><ListFilter size={20} /> Inventario</button>
                  <button onClick={() => setViewTab('history')} style={{ background: 'none', border: 'none', fontSize: '20px', fontWeight: viewTab === 'history' ? 700 : 400, color: viewTab === 'history' ? '#111' : '#666', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}><History size={20} /> Historial</button>
                </div>
                <div className="inventory-tools" style={{ display: 'flex', gap: '8px' }}>
                  <label className="search-box"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar..." /></label>
                  {role === 'admin' && (<button onClick={handleClearAll} style={{ background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5', padding: '0 12px', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600 }}><Trash2 size={15} /> Vaciar Todo</button>)}
                </div>
              </div>

              {loading ? (<div style={{ padding: '32px', textAlign: 'center' }}>Cargando datos...</div>) 
              : viewTab === 'inventory' ? (
                finalInventory.length > 0 ? (
                  <div className="inventory-list">
                    {finalInventory.map((product: any) => (
                      <article className="product-row" key={product.id}>
                        <div className="product-identity">
                          <span className="sku-tag">{product.sku}</span>
                          <div>
                            <h3>{product.name}</h3>
                            <p>Venta prom: {product.avgSales}/día <span style={{ marginLeft: '12px', color: product.isExpired ? '#dc2626' : (product.isExpiringSoon ? '#d97706' : '#059669'), fontWeight: 600 }}>🗓️ Activo: {product.activeExpDate ? formatDate(product.activeExpDate) : 'Sin fecha'}</span></p>
                          </div>
                        </div>
                        <div className="stock-number"><strong>{numberFormatter.format(product.currentStock || 0)}</strong><span>unid</span></div>
                      </article>
                    ))}
                  </div>
                ) : (<div className="empty-state" style={{ padding: '32px', textAlign: 'center' }}><h3>No hay resultados</h3></div>)
              ) : (
                <div className="inventory-list">
                  {historyData.length > 0 ? (
                    historyData.map((lot: any, idx: number) => (
                      <article className="product-row" key={lot.id || idx}>
                        <div className="product-identity">
                          <span className="sku-tag" style={{ background: '#eef2ff', color: '#4f46e5' }}>{lot.sku}</span>
                          <div>
                            <h3>{lot.name}</h3>
                            <p style={{ color: '#666', fontSize: '13px' }}><span style={{ fontWeight: 600, color: '#059669' }}>Ref: {lot.reference}</span> | 📅 Carga: {formatDate(lot.receivedDate || lot.createdAt || todayIso())} | 🗓️ Vence: {lot.expirationDate ? formatDate(lot.expirationDate) : 'Sin fecha'}</p>
                          </div>
                        </div>
                        <div className="stock-number"><strong style={{ color: '#059669' }}>+{numberFormatter.format(lot.quantity || 0)}</strong><span>unid</span></div>
                      </article>
                    ))
                  ) : (<div className="empty-state" style={{ padding: '32px', textAlign: 'center' }}><h3>Historial vacío</h3></div>)}
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
                <InitialForm disabled={isSubmitting} onSubmit={(payload: any) => runMutation(() => createInitialStock(payload), 'Producto guardado.')}
                  onBatchSubmit={async (items: any[]) => {
                    setIsSubmitting(true); setMessage(null);
                    try {
                      for (const item of items) { await createInitialStock(item); }
                      await loadData(); 
                      setMessage({ type: 'success', text: `${items.length} productos cargados.` })
                    } catch (error: any) {
                      setMessage({ type: 'error', text: error.message || 'Error al importar Excel.' })
                    } finally { setIsSubmitting(false) }
                  }} />
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
                            reference: 'CONTEO-REAL',
                            receivedDate: todayIso()
                          });
                        }
                      });

                      await syncAdjustments([], newLots);
                      await loadData();
                      setMessage({ type: 'success', text: `Stock ajustado para ${items.length} productos.` });
                    } catch (error: any) {
                      setMessage({ type: 'error', text: error.message || 'Error al ajustar stock.' });
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

function InitialForm({ disabled, onSubmit, onBatchSubmit }: any) {
  const [isExcel, setIsExcel] = useState(false); const [excelText, setExcelText] = useState('');
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
        items.push({ sku, name, quantity, expirationDate: expDate, minimumStock: 0, averageDailySales: avgDailySales, unit: 'unidades', receivedDate: todayIso() });
      }
    }
    if (items.length === 0) return alert('Copiar: SKU | Nombre | Cantidad | Vencimiento | Vta Promedio');
    await onBatchSubmit(items); setExcelText('');
  }
  return (
    <div className="action-form">
      <h2>Cargar productos</h2>
      <div style={{ display: 'flex', gap: '8px', margin: '12px 0' }}><button type="button" className={`mini-action ${!isExcel ? 'active' : ''}`} onClick={() => setIsExcel(false)}>Uno por uno</button><button type="button" className={`mini-action ${isExcel ? 'active' : ''}`} onClick={() => setIsExcel(true)}><Table size={14} /> Excel</button></div>
      {isExcel ? (<div><textarea rows={8} value={excelText} onChange={(e) => setExcelText(e.target.value)} placeholder="Ej: HAR-01  Harina  100  2026-12-01  2.5" /><button className="submit-button" onClick={() => void handleBatch()} disabled={disabled || !excelText.trim()} style={{ marginTop: '10px' }}>Importar</button></div>) : (<form onSubmit={(e) => void handleSubmit(e)}><div className="field-pair"><label className="field"><span>SKU</span><input name="sku" required /></label><label className="field"><span>Unidad</span><input name="unit" defaultValue="unidades" required /></label></div><label className="field"><span>Nombre</span><input name="name" required /></label><div className="field-pair"><label className="field"><span>Cant. inicial</span><input type="number" name="quantity" required /></label><label className="field"><span>Venta prom.</span><input type="number" name="averageDailySales" defaultValue="0" step="0.1" required /></label></div><label className="field"><span>Vencimiento</span><input type="date" name="expirationDate" required /></label><button className="submit-button" disabled={disabled} style={{ marginTop: '12px' }}>Crear</button></form>)}
    </div>
  )
}

function ReceiptForm({ data, disabled, onSubmit, onBatchSubmit }: any) {
  const [isExcel, setIsExcel] = useState(false); const [excelText, setExcelText] = useState(''); const [skuInput, setSkuInput] = useState('');
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const product = data.rawProducts?.find((p: any) => String(p.sku).toLowerCase() === skuInput.trim().toLowerCase());
    if (!product) return alert(`El SKU no existe.`); const form = new FormData(e.currentTarget);
    await onSubmit({ productId: product.id, reference: String(form.get('reference')), quantity: Number(form.get('quantity')), expirationDate: String(form.get('expirationDate')), receivedDate: todayIso() }); setSkuInput('');
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
           items.push({ productId: product.id, reference: 'CARGA-MASIVA', quantity, expirationDate: expDate, receivedDate: todayIso() });
        }
      }
    }
    if (items.length === 0) return alert('No se encontraron SKUs válidos.'); await onBatchSubmit(items); setExcelText('');
  }
  return (
    <div className="action-form">
      <h2>Cargar boleta</h2>
      <div style={{ display: 'flex', gap: '8px', margin: '12px 0' }}><button type="button" className={`mini-action ${!isExcel ? 'active' : ''}`} onClick={() => setIsExcel(false)}>Uno a uno</button><button type="button" className={`mini-action ${isExcel ? 'active' : ''}`} onClick={() => setIsExcel(true)}><Table size={14} /> Excel</button></div>
      {isExcel ? (<div><textarea rows={8} value={excelText} onChange={(e) => setExcelText(e.target.value)} placeholder="Ej: HAR-01  50  2026-10-15" /><button className="submit-button" onClick={() => void handleBatch()} disabled={disabled || !excelText.trim()} style={{ marginTop: '10px' }}>Ingresar Boletas</button></div>) : (<form onSubmit={(e) => void handleSubmit(e)}><label className="field"><span>SKU</span><input value={skuInput} onChange={(e) => setSkuInput(e.target.value)} required /></label><label className="field"><span>Ref/Boleta</span><input name="reference" required /></label><div className="field-pair"><label className="field"><span>Cant.</span><input type="number" name="quantity" required /></label><label className="field"><span>Vencimiento</span><input type="date" name="expirationDate" required /></label></div><button className="submit-button" disabled={disabled} style={{ marginTop: '12px' }}>Sumar Stock</button></form>)}
    </div>
  )
}

function SnapshotForm({ disabled, onSubmit, onBatchUpdate, enrichedInventory }: any) {
  const [isExcel, setIsExcel] = useState(false); const [excelText, setExcelText] = useState(''); const [notes, setNotes] = useState('');
  async function handleSubmit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); await onSubmit({ snapshotDate: todayIso(), notes }); setNotes(''); }
  async function handleBatch() {
    const lines = excelText.split(/\r?\n/).map(l => l.trim()).filter(Boolean); const items = [];
    for (const line of lines) { 
      const parts = line.split('\t').map(p => p.trim()); 
      if (parts.length >= 2) {
        let expDate = parts[2] || '';
        if (expDate && expDate.includes('/')) { 
          const dp = expDate.split('/'); 
          if (dp.length === 3) expDate = `${dp[2].length === 2 ? '20'+dp[2] : dp[2]}-${dp[1].padStart(2, '0')}-${dp[0].padStart(2, '0')}`; 
        }
        items.push({ 
          sku: parts[0], 
          realQuantity: parseFloat(parts[1].trim().replace(',', '.')) || 0,
          expirationDate: expDate
        }); 
      }
    }
    if (items.length === 0) return alert('Faltan datos.');
    if (confirm(`¿Actualizar el stock de estos ${items.length} productos?`)) { await onBatchUpdate(items); setExcelText(''); }
  }
  return (
    <div className="action-form">
      <h2>Ajuste de Stock</h2>
      <div style={{ display: 'flex', gap: '8px', margin: '12px 0' }}><button type="button" className={`mini-action ${!isExcel ? 'active' : ''}`} onClick={() => setIsExcel(false)}>Nota</button><button type="button" className={`mini-action ${isExcel ? 'active' : ''}`} onClick={() => setIsExcel(true)}><Table size={14} /> Excel</button></div>
      {isExcel ? (<div><textarea rows={8} value={excelText} onChange={(e) => setExcelText(e.target.value)} placeholder="Ej: HAR-01  120  (Opcional: 2026-12-01)" /><button className="submit-button" onClick={() => void handleBatch()} disabled={disabled || !excelText.trim()} style={{ marginTop: '10px' }}>Pisar Stock</button></div>) : (<form onSubmit={(e) => void handleSubmit(e)}><label className="field"><span>Obs.</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} /></label><button className="submit-button" disabled={disabled} style={{ marginTop: '12px' }}>Guardar</button></form>)}
    </div>
  )
}
