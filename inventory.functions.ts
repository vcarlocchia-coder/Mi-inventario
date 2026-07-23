"use server";

import { sql } from '@vercel/postgres';

export async function getInventoryDashboard() {
  try {
    const { rows: products } = await sql`SELECT * FROM products`;
    const { rows: lots } = await sql`SELECT * FROM lots`;
    const { rows: snapshots } = await sql`SELECT * FROM snapshots ORDER BY created_at DESC LIMIT 50`;

    const rawProducts = products.map(p => ({
      id: p.id, sku: p.sku, name: p.name, unit: p.unit,
      minimumStock: Number(p.minimum_stock), averageDailySales: Number(p.average_daily_sales),
      initialQuantity: Number(p.initial_quantity), totalOut: Number(p.total_out)
    }));

    const rawLots = lots.map(l => ({
      id: l.id, productId: l.product_id, sku: l.sku, sourceType: l.source_type, reference: l.source_reference,
      quantity: Number(l.quantity),
      expirationDate: l.expiration_date ? new Date(l.expiration_date).toISOString().slice(0, 10) : '',
      receivedDate: l.received_date ? new Date(l.received_date).toISOString().slice(0, 10) : ''
    }));

    return {
      inventory: [], rawProducts, rawLots, recentSnapshots: snapshots,
      summary: { totalProducts: rawProducts.length, totalUnits: 0, lowStockProducts: 0, expiringSoonUnits: 0, expiredUnits: 0, riskUnits: 0 },
    };
  } catch (error) {
    console.error('Error al cargar datos desde Neon:', error);
    return { inventory: [], rawProducts: [], rawLots: [], recentSnapshots: [], summary: {} };
  }
}

export async function createInitialStock(payload: any) {
  const skuUpper = payload.sku.toUpperCase();
  const { rows } = await sql`SELECT id FROM products WHERE sku = ${skuUpper}`;
  if (rows.length > 0) throw new Error('El SKU ya existe. Usa "Cargar boleta".');

  const productId = payload.id || crypto.randomUUID();
  const lotId = crypto.randomUUID();
  const expDate = payload.expirationDate ? payload.expirationDate : null;

  await sql`INSERT INTO products (id, sku, name, unit, minimum_stock, average_daily_sales, initial_quantity, total_out) VALUES (${productId}, ${skuUpper}, ${payload.name}, ${payload.unit || 'unidades'}, ${Number(payload.minimumStock) || 0}, ${Number(payload.averageDailySales) || 0}, ${Number(payload.quantity) || 0}, 0)`;
  await sql`INSERT INTO lots (id, product_id, sku, source_type, source_reference, quantity, expiration_date, received_date) VALUES (${lotId}, ${productId}, ${skuUpper}, 'initial', 'Stock inicial', ${Number(payload.quantity) || 0}, ${expDate}, ${payload.receivedDate || new Date().toISOString().slice(0, 10)})`;

  return { id: productId, sku: skuUpper };
}

export async function addReceipt(payload: any) {
  const lotId = crypto.randomUUID();
  const expDate = payload.expirationDate ? payload.expirationDate : null;
  await sql`INSERT INTO lots (id, product_id, source_type, source_reference, quantity, expiration_date, received_date) VALUES (${lotId}, ${payload.productId}, 'receipt', ${payload.reference}, ${Number(payload.quantity) || 1}, ${expDate}, ${payload.receivedDate || new Date().toISOString().slice(0, 10)})`;
  return { id: lotId };
}

export async function saveDailySnapshot(payload: any) {
  const snapId = crypto.randomUUID();
  await sql`INSERT INTO snapshots (id, snapshot_date, notes) VALUES (${snapId}, ${payload.snapshotDate}, ${payload.notes || ''})`;
  return { id: snapId };
}

export async function syncAdjustments(productsToUpdate: any[], newLots: any[]) {
  for (const prod of productsToUpdate) {
    await sql`UPDATE products SET total_out = ${prod.totalOut}, initial_quantity = ${prod.initialQuantity} WHERE id = ${prod.id}`;
  }
  for (const lot of newLots) {
    await sql`INSERT INTO lots (id, product_id, sku, source_type, source_reference, quantity, expiration_date, received_date) VALUES (${lot.id}, ${lot.productId}, ${lot.sku}, 'adjustment', ${lot.reference}, ${lot.quantity}, NULL, ${lot.receivedDate})`;
  }
}

export async function clearAllDatabase() {
  await sql`DELETE FROM lots`;
  await sql`DELETE FROM products`;
  await sql`DELETE FROM snapshots`;
  return true;
}
