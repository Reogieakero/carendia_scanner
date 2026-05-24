import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from './supabase';

const QUEUE_KEY = 'order_queue_v1';
const PRODUCTS_CACHE_KEY = 'products_cache_v1';
const PRODUCTS_CACHE_TS_KEY = 'products_cache_ts_v1';
const HISTORY_KEY = 'order_history_v1';
const CACHE_TTL_MS = 1000 * 60 * 60 * 24;

export interface OrderPayload {
  idempotency_key: string;
  product_id: string;
  product_name: string;
  product_category: string;
  unit_price: number;
  unit_cost: number;         // cost per unit (= unit_price for food, product.price for stock)
  quantity: number;
  total_price: number;
  source: 'qr_scan' | 'manual';
  product_type: 'food' | 'stock';
  created_at: string;
}

export interface OrderHistoryItem extends OrderPayload {
  status: 'synced' | 'pending';
  synced_at?: string;
}

export interface BuildOrderOptions {
  unit_cost?: number;        // override cost (defaults to unitPrice for food)
  product_type?: 'food' | 'stock';
}

export function buildOrder(
  product: { id: string; name: string; category: string; price: number },
  quantity: number,
  unitPrice: number,
  source: 'qr_scan' | 'manual',
  options: BuildOrderOptions = {}
): OrderPayload {
  const productType = options.product_type ?? 'food';
  // For stock items: cost = product.price (the DB `price` column = cost per unit)
  // For food items: cost = unitPrice (no separate cost tracking)
  const unitCost = options.unit_cost ?? (productType === 'stock' ? product.price : unitPrice);

  return {
    idempotency_key: uuidv4(),
    product_id: String(product.id),
    product_name: product.name,
    product_category: product.category ?? '',
    unit_price: unitPrice,
    unit_cost: unitCost,
    quantity,
    total_price: parseFloat((unitPrice * quantity).toFixed(2)),
    source,
    product_type: productType,
    created_at: new Date().toISOString(),
  };
}

async function readQueue(): Promise<OrderPayload[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function writeQueue(queue: OrderPayload[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

export async function getOrderHistory(): Promise<OrderHistoryItem[]> {
  try {
    const raw = await AsyncStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

async function writeHistory(history: OrderHistoryItem[]): Promise<void> {
  try {
    await AsyncStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {}
}

async function addToHistory(order: OrderPayload, status: 'synced' | 'pending'): Promise<void> {
  const history = await getOrderHistory();
  const exists = history.some((o) => o.idempotency_key === order.idempotency_key);
  if (!exists) {
    const entry: OrderHistoryItem = {
      ...order,
      status,
      synced_at: status === 'synced' ? new Date().toISOString() : undefined,
    };
    history.unshift(entry);
    await writeHistory(history);
  }
}

async function markHistoryItemSynced(idempotencyKey: string): Promise<void> {
  const history = await getOrderHistory();
  const updated = history.map((o) =>
    o.idempotency_key === idempotencyKey
      ? { ...o, status: 'synced' as const, synced_at: new Date().toISOString() }
      : o
  );
  await writeHistory(updated);
}

export async function enqueueOrder(order: OrderPayload): Promise<void> {
  const queue = await readQueue();
  const alreadyQueued = queue.some((o) => o.idempotency_key === order.idempotency_key);
  if (!alreadyQueued) {
    queue.push(order);
    await writeQueue(queue);
  }
}

async function upsertToSupabase(order: OrderPayload): Promise<boolean> {
  const { error } = await supabase.from('orders').upsert(
    {
      idempotency_key: order.idempotency_key,
      product_id: order.product_id,
      product_name: order.product_name,
      product_category: order.product_category,
      unit_price: order.unit_price,
      unit_cost: order.unit_cost,
      quantity: order.quantity,
      total_price: order.total_price,
      source: order.source,
      product_type: order.product_type,
      created_at: order.created_at,
      synced_at: new Date().toISOString(),
    },
    { onConflict: 'idempotency_key', ignoreDuplicates: true }
  );

  if (error && __DEV__) {
    console.log('[orderQueue] upsert skipped:', error.code, error.message);
  }

  return !error;
}

export async function syncQueue(): Promise<{ synced: number; failed: number }> {
  const queue = await readQueue();
  if (queue.length === 0) return { synced: 0, failed: 0 };

  const remaining: OrderPayload[] = [];
  let synced = 0;
  let failed = 0;

  for (const order of queue) {
    const ok = await upsertToSupabase(order);
    if (ok) {
      synced++;
      await markHistoryItemSynced(order.idempotency_key);
    } else {
      remaining.push(order);
      failed++;
    }
  }

  await writeQueue(remaining);
  return { synced, failed };
}

export async function saveOrder(order: OrderPayload): Promise<'online' | 'queued'> {
  try {
    const ok = await upsertToSupabase(order);
    if (ok) {
      await addToHistory(order, 'synced');
      return 'online';
    }
  } catch {}
  await enqueueOrder(order);
  await addToHistory(order, 'pending');
  return 'queued';
}

export async function getPendingCount(): Promise<number> {
  const queue = await readQueue();
  return queue.length;
}

export async function getCachedProducts(): Promise<any[] | null> {
  try {
    const raw = await AsyncStorage.getItem(PRODUCTS_CACHE_KEY);
    const ts = await AsyncStorage.getItem(PRODUCTS_CACHE_TS_KEY);
    if (!raw || !ts) return null;
    const age = Date.now() - parseInt(ts, 10);
    if (age > CACHE_TTL_MS) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function setCachedProducts(products: any[]): Promise<void> {
  try {
    await AsyncStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify(products));
    await AsyncStorage.setItem(PRODUCTS_CACHE_TS_KEY, String(Date.now()));
  } catch {}
}

export async function fetchProducts(): Promise<{ data: any[]; fromCache: boolean }> {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, price, category, image_url, product_type, stock_quantity, stock_unit, low_stock_threshold, selling_price')
      .order('product_type')   // food first, stock second
      .order('name');
    if (!error && data && data.length > 0) {
      await setCachedProducts(data);
      return { data, fromCache: false };
    }
  } catch {}

  const cached = await getCachedProducts();
  if (cached && cached.length > 0) {
    return { data: cached, fromCache: true };
  }

  return { data: [], fromCache: false };
}