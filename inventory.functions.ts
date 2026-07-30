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
    VALUES (${productId}, ${skuUpper}, ${payload.name}, ${payload.unit || 'bultos'}, ${parseQuantity(payload.minimumStock)}, ${avgSales}, 0, 0)
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

    const existingLots = await sql`SELECT quantity FROM lots WHERE product_id = ${pId}`;
    const totalIn = existingLots.reduce((acc: number, l: any) => {
      const q = parseQuantity(l.quantity);
      return q > 0 ? acc + q : acc;
    }, 0);
    
    const prodCheck = await sql`SELECT total_out FROM products WHERE id = ${pId}`;
    const currentTotalOut = prodCheck.length > 0 ? parseQuantity(prodCheck[0].total_out) : 0;
    const currentStockAvailable = totalIn - currentTotalOut;

    const delta = countedQuantity - currentStockAvailable;

    if (delta === 0) continue; 

    const futureTotalIn = delta > 0 ? totalIn + delta : totalIn;
    let newTotalOut = futureTotalIn - countedQuantity;
    if (newTotalOut < 0) newTotalOut = 0;

    await sql`
      UPDATE products 
      SET total_out = ${newTotalOut}
      WHERE id = ${pId}
    `;

    const actionLabel = delta < 0 ? `Venta/Salida (${Math.abs(delta)} bultos)` : `Ajuste Positivo (+${delta} bultos)`;

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

// FUNCIÓN ACTUALIZADA PARA PERMITIR EDITAR LA CANTIDAD
export async function updateLotRecord(lotId: string, payload: any) {
  const sql = getSql();
  
  // 1. Obtener la cantidad anterior para saber la diferencia
  const oldLot = await sql`SELECT product_id, quantity FROM lots WHERE id = ${lotId}`;
  if (oldLot.length === 0) return false;
  
  const pId = oldLot[0].product_id;
  const oldQty = parseQuantity(oldLot[0].quantity);
  const newQty = parseQuantity(payload.quantity);
  const expDate = payload.expirationDate || null;
  
  // 2. Guardar los nuevos valores en el registro
  await sql`
    UPDATE lots 
    SET expiration_date = ${expDate},
        source_reference = ${payload.reference || ''},
        quantity = ${newQty}
    WHERE id = ${lotId}
  `;
  
  // 3. Si es una salida (número negativo), recalcular las unidades vendidas (total_out) del producto
  const oldOut = oldQty < 0 ? Math.abs(oldQty) : 0;
  const newOut = newQty < 0 ? Math.abs(newQty) : 0;
  const diffOut = newOut - oldOut;
  
  if (diffOut !== 0) {
    await sql`
      UPDATE products 
      SET total_out = GREATEST(total_out + ${diffOut}, 0)
      WHERE id = ${pId}
    `;
  }
  
  return true;
}

export async function deleteLotRecord(lotId: string, productId: string) {
  const sql = getSql();
  const check = await sql`SELECT quantity FROM lots WHERE id = ${lotId}`;
  if (check.length === 0) return false;
  
  const qty = parseQuantity(check[0].quantity);
  await sql`DELETE FROM lots WHERE id = ${lotId}`;
  
  if (qty < 0) {
    await sql`
      UPDATE products 
      SET total_out = GREATEST(total_out - ${Math.abs(qty)}, 0) 
      WHERE id = ${productId}
    `;
  }
  return true;
}

export async function deleteLotRecordsBatch(items: { lotId: string, productId: string }[]) {
  for (const item of items) {
    await deleteLotRecord(item.lotId, item.productId);
  }
  return true;
}

export async function deleteProduct(productId: string) {
  const sql = getSql();
  await sql`DELETE FROM lots WHERE product_id = ${productId}`;
  await sql`DELETE FROM products WHERE id = ${productId}`;
  return true;
}

export async function clearAllDatabase() {
  const sql = getSql();
  await sql`DELETE FROM lots`;
  await sql`DELETE FROM products`;
  return true;
}
