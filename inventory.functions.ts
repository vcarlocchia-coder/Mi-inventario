import { neon } from '@neondatabase/serverless';

const NEON_URL = "postgresql://neondb_owner:npg_ZI9Ds8WhYtbx@ep-late-base-ach9gmhr-pooler.sa-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"; // Mantené tu URL activa

function getSql() {
  const connectionString = 
    NEON_URL || 
    import.meta.env.VITE_DATABASE_URL || 
    process.env.POSTGRES_URL || 
    process.env.DATABASE_URL;

  return neon(connectionString);
}

function parseQuantity(val: any, defaultVal = 0): number {
  if (val === null || val === undefined || val === '') return defaultVal;
  const num = Number(val);
  return isNaN(num) ? defaultVal : num;
}

export async function getInventoryDashboard() {
  const sql = getSql();
  try {
    const products = await sql`SELECT * FROM products`;
    const lots = await sql`SELECT * FROM lots`;

    const rawProducts = products.map((p: any) => ({
      id: String(p.id),
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      minimumStock: parseQuantity(p.minimum_stock),
      averageDailySales: parseQuantity(p.average_daily_sales),
      initialQuantity: 0,
      totalOut: parseQuantity(p.total_out)
    }));

    const rawLots = lots.map((l: any) => ({
      id: String(l.id),
      productId: String(l.product_id),
      sku: l.sku,
      sourceType: l.source_type,
      reference: l.source_reference,
      quantity: parseQuantity(l.quantity),
      expirationDate: l.expiration_date ? new Date(l.expiration_date).toISOString().slice(0, 10) : '',
      receivedDate: l.received_date ? new Date(l.received_date).toISOString().slice(0, 10) : ''
    }));

    return {
      inventory: [],
      rawProducts,
      rawLots,
      recentSnapshots: [],
      summary: { totalProducts: rawProducts.length, totalUnits: 0, lowStockProducts: 0, expiringSoonUnits: 0, expiredUnits: 0, riskUnits: 0 },
    };
  } catch (error) {
    console.error('Error cargando desde Neon:', error);
    throw error;
  }
}

export async function createInitialStock(payload: any) {
  const sql = getSql();
  const skuUpper = payload.sku.toUpperCase();

  const check = await sql`SELECT id FROM products WHERE sku = ${skuUpper}`;
  const avgSales = parseQuantity(payload.averageDailySales, 0);

  if (check.length > 0) {
    await sql`
      UPDATE products 
      SET average_daily_sales = ${avgSales},
          name = ${payload.name || ''}
      WHERE sku = ${skuUpper}
    `;
    return { id: String(check[0].id), sku: skuUpper };
  }

  const productId = String(payload.id || crypto.randomUUID());
  const lotId = String(crypto.randomUUID());
  const expDate = payload.expirationDate || null;
  const qty = parseQuantity(payload.quantity, 0);

  await sql`
    INSERT INTO products (id, sku, name, unit, minimum_stock, average_daily_sales, initial_quantity, total_out)
    VALUES (${productId}, ${skuUpper}, ${payload.name}, ${payload.unit || 'unidades'}, ${parseQuantity(payload.minimumStock)}, ${avgSales}, 0, 0)
  `;

  await sql`
    INSERT INTO lots (id, product_id, sku, source_type, source_reference, quantity, expiration_date, received_date)
    VALUES (${lotId}, ${productId}, ${skuUpper}, 'initial', 'Stock inicial', ${qty}, ${expDate}, ${payload.receivedDate || new Date().toISOString().slice(0, 10)})
  `;

  return { id: productId, sku: skuUpper };
}

export async function updateAverageSalesBatch(items: { sku: string; averageDailySales: number }[]) {
  const sql = getSql();
  for (const item of items) {
    const skuUpper = item.sku.toUpperCase();
    const avgSales = parseQuantity(item.averageDailySales, 0);
    await sql`
      UPDATE products 
      SET average_daily_sales = ${avgSales}
      WHERE sku = ${skuUpper}
    `;
  }
  return true;
}

export async function addReceipt(payload: any) {
  const sql = getSql();
  const lotId = String(crypto.randomUUID());
  const expDate = payload.expirationDate || null;
  const qty = parseQuantity(payload.quantity, 1);

  await sql`
    INSERT INTO lots (id, product_id, source_type, source_reference, quantity, expiration_date, received_date)
    VALUES (${lotId}, ${String(payload.productId)}, 'receipt', ${payload.reference}, ${qty}, ${expDate}, ${payload.receivedDate || new Date().toISOString().slice(0, 10)})
  `;

  return { id: lotId };
}

export async function saveDailySnapshot(payload: any) {
  return { id: String(crypto.randomUUID()) };
}

export async function syncAdjustments(productsToUpdate: any[], newLots: any[]) {
  const sql = getSql();

  for (const lot of newLots) {
    const pId = String(lot.productId);
    const countedQuantity = parseQuantity(lot.quantity);

    // 1. Obtener entradas (Sumamos SOLO los lotes positivos, exactamente igual que la pantalla)
    const existingLots = await sql`SELECT quantity FROM lots WHERE product_id = ${pId}`;
    const totalIn = existingLots.reduce((acc: number, l: any) => {
      const q = parseQuantity(l.quantity);
      return q > 0 ? acc + q : acc;
    }, 0);
    
    // 2. Obtener salidas actuales y calcular stock disponible actual
    const prodCheck = await sql`SELECT total_out FROM products WHERE id = ${pId}`;
    const currentTotalOut = prodCheck.length > 0 ? parseQuantity(prodCheck[0].total_out) : 0;
    const currentStockAvailable = totalIn - currentTotalOut;

    // 3. Diferencia real a registrar
    const delta = countedQuantity - currentStockAvailable;

    if (delta === 0) continue; // Si contaste lo mismo que hay, no hace nada

    // 4. Recalcular total_out para que el stock de exacto matemáticamente
    // Si la diferencia es positiva, se agregará un lote nuevo que subirá totalIn
    const futureTotalIn = delta > 0 ? totalIn + delta : totalIn;
    let newTotalOut = futureTotalIn - countedQuantity;
    if (newTotalOut < 0) newTotalOut = 0;

    await sql`
      UPDATE products 
      SET total_out = ${newTotalOut}
      WHERE id = ${pId}
    `;

    const actionLabel = delta < 0 ? `Venta/Salida (${Math.abs(delta)} unid)` : `Ajuste Positivo (+${delta} unid)`;

    await sql`
      INSERT INTO lots (id, product_id, sku, source_type, source_reference, quantity, expiration_date, received_date)
      VALUES (
        ${String(lot.id || crypto.randomUUID())}, 
        ${pId}, 
        ${lot.sku || ''}, 
        'adjustment', 
        ${actionLabel}, 
        ${delta}, 
        ${lot.expirationDate || null}, 
        ${lot.receivedDate || new Date().toISOString().slice(0, 10)}
      )
    `;
  }
}

export async function updateLotRecord(lotId: string, payload: any) {
  const sql = getSql();
  const expDate = payload.expirationDate || null;
  await sql`
    UPDATE lots 
    SET expiration_date = ${expDate},
        source_reference = ${payload.reference || ''}
    WHERE id = ${lotId}
  `;
  return true;
}

export async function clearAllDatabase() {
  const sql = getSql();
  await sql`DELETE FROM lots`;
  await sql`DELETE FROM products`;
  return true;
}
