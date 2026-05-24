import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Animated,
    AppState,
    Dimensions,
    Image,
    Modal,
    Pressable,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    buildOrder,
    fetchProducts,
    getOrderHistory,
    getPendingCount,
    OrderHistoryItem,
    saveOrder,
    syncQueue,
} from '../../lib/orderQueue';

const { width, height } = Dimensions.get('window');
const PADDING = 24;
const GUTTER = 16;
const CARD_WIDTH = (width - PADDING * 2 - GUTTER) / 2;

type ViewMode = 'card' | 'list';
type AppView = 'menu' | 'history';
type FilterTab = 'all' | 'synced' | 'pending';

interface Product {
    id: string;
    name: string;
    category: string;
    price: number;          // cost per unit for stock items
    image_url?: string;
    product_type: 'food' | 'stock';
    stock_quantity?: number;
    stock_unit?: string;
    low_stock_threshold?: number;
    selling_price?: number; // selling price for stock items
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatDateTime(iso: string): string {
    return `${formatDate(iso)} · ${formatTime(iso)}`;
}

function groupByDate(orders: OrderHistoryItem[]): { label: string; data: OrderHistoryItem[] }[] {
    const map: Record<string, OrderHistoryItem[]> = {};
    for (const o of orders) {
        const label = formatDate(o.created_at);
        if (!map[label]) map[label] = [];
        map[label].push(o);
    }
    return Object.entries(map).map(([label, data]) => ({ label, data }));
}

// ── Stock badge helper ────────────────────────────────────────────────────────
function StockBadge({ product }: { product: Product }) {
    if (product.product_type !== 'stock') return null;
    const qty = product.stock_quantity ?? 0;
    const threshold = product.low_stock_threshold ?? 0;
    const isLow = threshold > 0 && qty <= threshold;
    const isEmpty = qty <= 0;

    return (
        <View
            style={[
                stockStyles.badge,
                isEmpty ? stockStyles.badgeEmpty : isLow ? stockStyles.badgeLow : stockStyles.badgeOk,
            ]}
        >
            <Ionicons
                name={isEmpty ? 'close-circle' : isLow ? 'warning' : 'checkmark-circle'}
                size={10}
                color={isEmpty ? '#dc2626' : isLow ? '#b45309' : '#15803d'}
            />
            <Text
                style={[
                    stockStyles.badgeText,
                    isEmpty ? stockStyles.badgeTextEmpty : isLow ? stockStyles.badgeTextLow : stockStyles.badgeTextOk,
                ]}
            >
                {isEmpty ? 'Out of stock' : isLow ? 'Low stock' : 'In stock'}
            </Text>
        </View>
    );
}

// ── Stock info row ────────────────────────────────────────────────────────────
function StockInfoRow({ product }: { product: Product }) {
    if (product.product_type !== 'stock') return null;
    const qty = product.stock_quantity ?? 0;
    const unit = product.stock_unit || 'units';
    return (
        <View style={stockStyles.infoRow}>
            <Ionicons name="cube-outline" size={11} color="#6b7280" />
            <Text style={stockStyles.infoText}>
                {qty.toLocaleString()} {unit} available
            </Text>
        </View>
    );
}

// ── Receipt modal ─────────────────────────────────────────────────────────────
function ReceiptModal({
    order,
    visible,
    onClose,
}: {
    order: OrderHistoryItem | null;
    visible: boolean;
    onClose: () => void;
}) {
    const insets = useSafeAreaInsets();
    const slideAnim = useRef(new Animated.Value(600)).current;

    useEffect(() => {
        if (visible) {
            Animated.spring(slideAnim, {
                toValue: 0,
                useNativeDriver: true,
                damping: 22,
                stiffness: 180,
            }).start();
        } else {
            Animated.timing(slideAnim, {
                toValue: 600,
                duration: 220,
                useNativeDriver: true,
            }).start();
        }
    }, [visible]);

    if (!order) return null;

    const receiptNumber = order.idempotency_key.slice(0, 8).toUpperCase();
    const isSynced = order.status === 'synced';
    const isStock = order.product_type === 'stock';

    return (
        <Modal visible={visible} animationType="none" transparent onRequestClose={onClose}>
            <View style={receiptStyles.overlay}>
                <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
                <Animated.View
                    style={[
                        receiptStyles.sheet,
                        { paddingBottom: insets.bottom + 20, transform: [{ translateY: slideAnim }] },
                    ]}
                >
                    <View style={receiptStyles.handle} />
                    <View style={receiptStyles.receiptCard}>
                        <View style={receiptStyles.receiptHeader}>
                            <View style={receiptStyles.logoMark}>
                                <Ionicons
                                    name={isStock ? 'cube' : 'restaurant'}
                                    size={22}
                                    color="#ffc87a"
                                />
                            </View>
                            <Text style={receiptStyles.storeName}>
                                {isStock ? 'Stock Dispatch' : 'Order Receipt'}
                            </Text>
                            <Text style={receiptStyles.receiptNo}>#{receiptNumber}</Text>
                        </View>
                        <View style={receiptStyles.dashedLine} />
                        <View style={receiptStyles.receiptBody}>
                            <View style={receiptStyles.receiptRow}>
                                <Text style={receiptStyles.receiptFieldLabel}>Item</Text>
                                <Text style={receiptStyles.receiptFieldValue} numberOfLines={2}>
                                    {order.product_name}
                                </Text>
                            </View>
                            <View style={receiptStyles.receiptRow}>
                                <Text style={receiptStyles.receiptFieldLabel}>Category</Text>
                                <Text style={receiptStyles.receiptFieldValue}>
                                    {order.product_category || '—'}
                                </Text>
                            </View>
                            {isStock ? (
                                <>
                                    <View style={receiptStyles.receiptRow}>
                                        <Text style={receiptStyles.receiptFieldLabel}>Cost / Unit</Text>
                                        <Text style={receiptStyles.receiptFieldValue}>
                                            ₱ {Number(order.unit_cost ?? order.unit_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </Text>
                                    </View>
                                    <View style={receiptStyles.receiptRow}>
                                        <Text style={receiptStyles.receiptFieldLabel}>Selling Price</Text>
                                        <Text style={receiptStyles.receiptFieldValue}>
                                            ₱ {Number(order.unit_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </Text>
                                    </View>
                                </>
                            ) : (
                                <View style={receiptStyles.receiptRow}>
                                    <Text style={receiptStyles.receiptFieldLabel}>Unit Price</Text>
                                    <Text style={receiptStyles.receiptFieldValue}>
                                        ₱ {Number(order.unit_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </Text>
                                </View>
                            )}
                            <View style={receiptStyles.receiptRow}>
                                <Text style={receiptStyles.receiptFieldLabel}>Quantity</Text>
                                <Text style={receiptStyles.receiptFieldValue}>× {order.quantity}</Text>
                            </View>
                            <View style={receiptStyles.receiptRow}>
                                <Text style={receiptStyles.receiptFieldLabel}>Source</Text>
                                <View style={receiptStyles.sourcePill}>
                                    <Ionicons
                                        name={order.source === 'qr_scan' ? 'qr-code-outline' : 'pencil-outline'}
                                        size={11}
                                        color="#71717a"
                                    />
                                    <Text style={receiptStyles.sourcePillText}>
                                        {order.source === 'qr_scan' ? 'QR Scan' : 'Manual'}
                                    </Text>
                                </View>
                            </View>
                            <View style={receiptStyles.receiptRow}>
                                <Text style={receiptStyles.receiptFieldLabel}>Ordered</Text>
                                <Text style={receiptStyles.receiptFieldValue}>
                                    {formatDateTime(order.created_at)}
                                </Text>
                            </View>
                            {order.synced_at && (
                                <View style={receiptStyles.receiptRow}>
                                    <Text style={receiptStyles.receiptFieldLabel}>Synced</Text>
                                    <Text style={receiptStyles.receiptFieldValue}>
                                        {formatDateTime(order.synced_at)}
                                    </Text>
                                </View>
                            )}
                        </View>
                        <View style={receiptStyles.dashedLine} />
                        {isStock && (
                            <View style={receiptStyles.profitBlock}>
                                <View style={receiptStyles.profitRow}>
                                    <Text style={receiptStyles.profitLabel}>Revenue</Text>
                                    <Text style={receiptStyles.profitValue}>
                                        ₱ {Number(order.total_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </Text>
                                </View>
                                <View style={receiptStyles.profitRow}>
                                    <Text style={receiptStyles.profitLabel}>Cost</Text>
                                    <Text style={receiptStyles.profitCost}>
                                        − ₱ {(Number(order.unit_cost ?? 0) * order.quantity).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </Text>
                                </View>
                                <View style={[receiptStyles.profitRow, receiptStyles.profitMarginRow]}>
                                    <Text style={receiptStyles.profitMarginLabel}>Gross Profit</Text>
                                    <Text style={receiptStyles.profitMarginValue}>
                                        ₱ {(Number(order.total_price) - Number(order.unit_cost ?? 0) * order.quantity).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </Text>
                                </View>
                            </View>
                        )}
                        <View style={receiptStyles.totalBlock}>
                            <Text style={receiptStyles.totalBlockLabel}>Total Amount</Text>
                            <Text style={receiptStyles.totalBlockValue}>
                                ₱ {Number(order.total_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </Text>
                        </View>
                        <View style={receiptStyles.statusBlock}>
                            <View
                                style={[
                                    receiptStyles.statusBadge,
                                    isSynced ? receiptStyles.statusBadgeSynced : receiptStyles.statusBadgePending,
                                ]}
                            >
                                <Ionicons
                                    name={isSynced ? 'cloud-done-outline' : 'time-outline'}
                                    size={14}
                                    color={isSynced ? '#16a34a' : '#92400e'}
                                />
                                <Text
                                    style={[
                                        receiptStyles.statusBadgeText,
                                        isSynced ? receiptStyles.statusBadgeTextSynced : receiptStyles.statusBadgeTextPending,
                                    ]}
                                >
                                    {isSynced ? 'Synced to server' : 'Pending sync'}
                                </Text>
                            </View>
                        </View>
                        <View style={receiptStyles.receiptFooter}>
                            <Text style={receiptStyles.receiptFooterText}>Thank you for your order!</Text>
                            <Text style={receiptStyles.receiptFooterSub}>140 Roadway Ave.</Text>
                        </View>
                    </View>
                    <TouchableOpacity style={receiptStyles.closeBtn} onPress={onClose} activeOpacity={0.8}>
                        <Text style={receiptStyles.closeBtnText}>Close Receipt</Text>
                    </TouchableOpacity>
                </Animated.View>
            </View>
        </Modal>
    );
}

// ── Stock product card (grid) ─────────────────────────────────────────────────
function StockCard({ item, onPress, width: cardWidth }: { item: Product; onPress: () => void; width: number }) {
    const qty = item.stock_quantity ?? 0;
    const threshold = item.low_stock_threshold ?? 0;
    const isLow = threshold > 0 && qty <= threshold;
    const isEmpty = qty <= 0;
    const stockColor = isEmpty ? '#dc2626' : isLow ? '#d97706' : '#16a34a';

    return (
        <TouchableOpacity
            style={[styles.favCard, { width: cardWidth }, stockStyles.stockCard]}
            onPress={onPress}
            activeOpacity={0.8}
            disabled={isEmpty}
        >
            {/* Product image or placeholder */}
            {item.image_url && item.image_url.trim() !== '' ? (
                <Image source={{ uri: item.image_url }} style={styles.productImg} />
            ) : (
                <View style={[styles.placeholderImg, stockStyles.stockPlaceholder]}>
                    <Ionicons name="cube-outline" size={36} color="#93c5fd" />
                </View>
            )}

            {/* Stock type tag */}
            <View style={stockStyles.typeTag}>
                <Ionicons name="cube" size={9} color="#3b82f6" />
                <Text style={stockStyles.typeTagText}>STOCK</Text>
            </View>

            <Text style={styles.favName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.favType} numberOfLines={1}>{item.category}</Text>

            {/* Stock quantity */}
            <View style={[stockStyles.stockQtyRow, { borderColor: stockColor + '33' }]}>
                <Text style={[stockStyles.stockQty, { color: stockColor }]}>
                    {qty.toLocaleString()}
                </Text>
                <Text style={stockStyles.stockUnit}>{item.stock_unit || 'units'}</Text>
            </View>

            {/* Price table */}
            <View style={stockStyles.priceTable}>
                <View style={stockStyles.priceTableRow}>
                    <Text style={stockStyles.priceTableLabel}>Cost</Text>
                    <Text style={stockStyles.priceTableValue}>
                        ₱{Number(item.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </Text>
                </View>
                <View style={stockStyles.priceTableDivider} />
                <View style={stockStyles.priceTableRow}>
                    <Text style={stockStyles.priceTableLabel}>Sell</Text>
                    <Text style={[stockStyles.priceTableValue, stockStyles.priceTableSell]}>
                        ₱{Number(item.selling_price ?? item.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </Text>
                </View>
            </View>

            {isEmpty ? (
                <View style={stockStyles.outOfStockOverlay}>
                    <Text style={stockStyles.outOfStockText}>Out of Stock</Text>
                </View>
            ) : (
                <View style={styles.tapHint}>
                    <Ionicons name="add-circle-outline" size={12} color="#3b82f6" />
                    <Text style={[styles.tapHintText, { color: '#3b82f6' }]}>Tap to sell</Text>
                </View>
            )}
        </TouchableOpacity>
    );
}

// ── Stock product row (list) ──────────────────────────────────────────────────
function StockRow({ item, onPress }: { item: Product; onPress: () => void }) {
    const qty = item.stock_quantity ?? 0;
    const threshold = item.low_stock_threshold ?? 0;
    const isLow = threshold > 0 && qty <= threshold;
    const isEmpty = qty <= 0;
    const stockColor = isEmpty ? '#dc2626' : isLow ? '#d97706' : '#16a34a';

    return (
        <TouchableOpacity
            style={[styles.tileRow, isEmpty && stockStyles.rowDisabled]}
            onPress={onPress}
            activeOpacity={isEmpty ? 1 : 0.8}
            disabled={isEmpty}
        >
            {item.image_url && item.image_url.trim() !== '' ? (
                <Image source={{ uri: item.image_url }} style={styles.tileImg} />
            ) : (
                <View style={[styles.tilePlaceholder, stockStyles.stockTilePlaceholder]}>
                    <Ionicons name="cube-outline" size={26} color="#93c5fd" />
                </View>
            )}
            <View style={styles.tileInfo}>
                <View style={stockStyles.tileNameRow}>
                    <Text style={styles.tileName} numberOfLines={1}>{item.name}</Text>
                    <View style={stockStyles.typeTagSmall}>
                        <Text style={stockStyles.typeTagSmallText}>STOCK</Text>
                    </View>
                </View>
                <Text style={styles.tileCategory}>{item.category}</Text>

                {/* Stock quantity indicator */}
                <View style={stockStyles.tileStockRow}>
                    <View style={[stockStyles.tileStockDot, { backgroundColor: stockColor }]} />
                    <Text style={[stockStyles.tileStockQty, { color: stockColor }]}>
                        {qty.toLocaleString()} {item.stock_unit || 'units'}
                    </Text>
                </View>

                {/* Cost / Sell row */}
                <View style={stockStyles.tilePriceRow}>
                    <Text style={stockStyles.tileCost}>
                        Cost ₱{Number(item.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </Text>
                    <View style={stockStyles.tilePriceDivider} />
                    <Text style={stockStyles.tileSell}>
                        Sell ₱{Number(item.selling_price ?? item.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </Text>
                </View>
            </View>
            <View style={styles.tileOrderBtn}>
                {isEmpty ? (
                    <Ionicons name="close-circle-outline" size={26} color="#d4d4d8" />
                ) : (
                    <Ionicons name="add-circle-outline" size={26} color="#3b82f6" />
                )}
            </View>
        </TouchableOpacity>
    );
}

// ── Manual order sheet — extended for stock items ─────────────────────────────
function ManualOrderSheet({
    product,
    insets,
    onConfirm,
    onClose,
}: {
    product: Product;
    insets: { bottom: number };
    onConfirm: (price: number, qty: number) => Promise<void>;
    onClose: () => void;
}) {
    const isStock = product.product_type === 'stock';
    const defaultSell = isStock
        ? String(product.selling_price ?? product.price)
        : String(product.price);

    const [price, setPrice] = useState(defaultSell);
    const [qty, setQty] = useState(1);
    const [confirmed, setConfirmed] = useState(false);
    const [confirming, setConfirming] = useState(false);

    const parsedPrice = parseFloat(price || '0');
    const total = parsedPrice * qty;
    const profit = isStock ? (parsedPrice - product.price) * qty : null;
    const maxQty = isStock ? (product.stock_quantity ?? Infinity) : Infinity;

    const handleConfirm = async () => {
        if (!price || parsedPrice <= 0 || confirming) return;
        if (isStock && qty > (product.stock_quantity ?? 0)) {
            Alert.alert('Insufficient stock', `Only ${product.stock_quantity} ${product.stock_unit || 'units'} available.`);
            return;
        }
        setConfirming(true);
        try {
            await onConfirm(parsedPrice, qty);
            setConfirmed(true);
        } finally {
            setConfirming(false);
        }
    };

    return (
        <View style={[styles.manualSheet, { paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.sheetHandle} />
            {!confirmed ? (
                <>
                    {/* Product header */}
                    <View style={styles.productHeader}>
                        {product.image_url && product.image_url.trim() !== '' ? (
                            <Image source={{ uri: product.image_url }} style={styles.resultImg} />
                        ) : (
                            <View style={[styles.resultImgPlaceholder, isStock && stockStyles.resultImgStock]}>
                                <Ionicons
                                    name={isStock ? 'cube-outline' : 'restaurant-outline'}
                                    size={28}
                                    color={isStock ? '#93c5fd' : '#c4b5a0'}
                                />
                            </View>
                        )}
                        <View style={styles.productHeaderText}>
                            <View style={stockStyles.headerNameRow}>
                                <Text style={styles.resultName} numberOfLines={1}>{product.name}</Text>
                                {isStock && (
                                    <View style={stockStyles.typeTagInline}>
                                        <Text style={stockStyles.typeTagInlineText}>STOCK</Text>
                                    </View>
                                )}
                            </View>
                            <Text style={styles.resultCategory}>{product.category}</Text>
                            {isStock && (
                                <StockBadge product={product} />
                            )}
                        </View>
                    </View>

                    {/* Stock info table — only for stock items */}
                    {isStock && (
                        <View style={stockStyles.sheetInfoTable}>
                            <View style={stockStyles.sheetInfoRow}>
                                <Ionicons name="cube-outline" size={13} color="#6b7280" />
                                <Text style={stockStyles.sheetInfoLabel}>Available</Text>
                                <Text style={stockStyles.sheetInfoValue}>
                                    {(product.stock_quantity ?? 0).toLocaleString()} {product.stock_unit || 'units'}
                                </Text>
                            </View>
                            <View style={stockStyles.sheetInfoDivider} />
                            <View style={stockStyles.sheetInfoRow}>
                                <Ionicons name="pricetag-outline" size={13} color="#6b7280" />
                                <Text style={stockStyles.sheetInfoLabel}>Cost per unit</Text>
                                <Text style={stockStyles.sheetInfoValue}>
                                    ₱ {Number(product.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </Text>
                            </View>
                        </View>
                    )}

                    {/* Price input */}
                    <Text style={styles.manualPriceLabel}>
                        {isStock ? 'Selling price (₱)' : 'Enter price (₱)'}
                    </Text>
                    <View style={styles.priceInputWrap}>
                        <Text style={styles.pesoSign}>₱</Text>
                        <TextInput
                            style={styles.priceInput}
                            value={price}
                            onChangeText={(v) => setPrice(v.replace(/[^0-9.]/g, ''))}
                            keyboardType="decimal-pad"
                            placeholder={defaultSell}
                            placeholderTextColor="#a1a1aa"
                            returnKeyType="done"
                        />
                    </View>
                    <View style={styles.defaultPriceRow}>
                        <Text style={styles.defaultPriceHint}>
                            {isStock ? 'Default selling price:' : 'Default price:'}
                        </Text>
                        <TouchableOpacity onPress={() => setPrice(defaultSell)}>
                            <Text style={styles.defaultPriceValue}>
                                ₱ {Number(isStock ? (product.selling_price ?? product.price) : product.price).toLocaleString(undefined, { minimumFractionDigits: 2 })} (tap to reset)
                            </Text>
                        </TouchableOpacity>
                    </View>

                    <View style={styles.divider} />

                    {/* Quantity */}
                    <View style={styles.qtyRow}>
                        <Text style={styles.qtyLabel}>Quantity</Text>
                        <View style={styles.stepper}>
                            <TouchableOpacity
                                style={[styles.stepBtn, qty <= 1 && styles.stepBtnDisabled]}
                                onPress={() => setQty((q) => Math.max(1, q - 1))}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="remove" size={18} color={qty <= 1 ? '#d4d4d8' : '#18181b'} />
                            </TouchableOpacity>
                            <Text style={styles.qtyValue}>{qty}</Text>
                            <TouchableOpacity
                                style={[styles.stepBtn, isStock && qty >= (product.stock_quantity ?? Infinity) && styles.stepBtnDisabled]}
                                onPress={() => setQty((q) => isStock ? Math.min(product.stock_quantity ?? q + 1, q + 1) : q + 1)}
                                activeOpacity={0.7}
                            >
                                <Ionicons name="add" size={18} color={isStock && qty >= (product.stock_quantity ?? Infinity) ? '#d4d4d8' : '#18181b'} />
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* Total */}
                    <View style={styles.totalRow}>
                        <Text style={styles.totalLabel}>Total</Text>
                        <Text style={styles.totalValue}>
                            ₱ {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </Text>
                    </View>

                    {/* Gross profit preview for stock items */}
                    {isStock && profit !== null && (
                        <View style={stockStyles.profitPreview}>
                            <View style={stockStyles.profitPreviewRow}>
                                <Text style={stockStyles.profitPreviewLabel}>Gross Profit</Text>
                                <Text style={[stockStyles.profitPreviewValue, profit < 0 && stockStyles.profitNeg]}>
                                    {profit < 0 ? '−' : '+'}₱ {Math.abs(profit).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </Text>
                            </View>
                            {parsedPrice > 0 && (
                                <View style={stockStyles.marginBar}>
                                    <View
                                        style={[
                                            stockStyles.marginBarFill,
                                            {
                                                width: `${Math.min(100, Math.max(0, ((parsedPrice - product.price) / parsedPrice) * 100))}%`,
                                                backgroundColor: profit < 0 ? '#f87171' : '#4ade80',
                                            },
                                        ]}
                                    />
                                </View>
                            )}
                            <Text style={stockStyles.marginLabel}>
                                Margin: {parsedPrice > 0
                                    ? `${(((parsedPrice - product.price) / parsedPrice) * 100).toFixed(1)}%`
                                    : '—'}
                            </Text>
                        </View>
                    )}

                    <View style={styles.actionRow}>
                        <TouchableOpacity style={styles.rescanBtn} onPress={onClose} activeOpacity={0.7}>
                            <Ionicons name="close" size={15} color="#71717a" />
                            <Text style={styles.rescanText}>Cancel</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[
                                styles.confirmBtn,
                                isStock && stockStyles.confirmBtnStock,
                                (!price || parsedPrice <= 0 || confirming) && styles.confirmBtnDisabled,
                            ]}
                            onPress={handleConfirm}
                            activeOpacity={0.85}
                            disabled={!price || parsedPrice <= 0 || confirming}
                        >
                            {confirming ? (
                                <ActivityIndicator size="small" color="#18181b" />
                            ) : (
                                <>
                                    <Ionicons name="checkmark" size={17} color="#18181b" />
                                    <Text style={styles.confirmText}>
                                        {isStock ? 'Confirm Sale' : 'Confirm Order'}
                                    </Text>
                                </>
                            )}
                        </TouchableOpacity>
                    </View>
                </>
            ) : (
                <View style={styles.resultInner}>
                    <Ionicons name="checkmark-circle" size={52} color="#4ade80" />
                    <Text style={styles.confirmedTitle}>
                        {product.product_type === 'stock' ? 'Sale Recorded!' : 'Order Added!'}
                    </Text>
                    <Text style={styles.confirmedSub}>{qty}× {product.name}</Text>
                    <Text style={styles.confirmedTotal}>
                        ₱ {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </Text>
                    {isStock && profit !== null && (
                        <View style={stockStyles.confirmedProfit}>
                            <Ionicons name="trending-up" size={14} color="#16a34a" />
                            <Text style={stockStyles.confirmedProfitText}>
                                Gross profit: ₱{Math.abs(profit).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </Text>
                        </View>
                    )}
                    <View style={styles.actionRow}>
                        <TouchableOpacity style={styles.rescanBtn} onPress={onClose} activeOpacity={0.7}>
                            <Ionicons name="arrow-back" size={15} color="#71717a" />
                            <Text style={styles.rescanText}>Back to Menu</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}
        </View>
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main screen
// ═══════════════════════════════════════════════════════════════════════════════
export default function HomeScreen() {
    const insets = useSafeAreaInsets();

    const [appView, setAppView] = useState<AppView>('menu');
    const menuOpacity = useRef(new Animated.Value(1)).current;
    const historyOpacity = useRef(new Animated.Value(0)).current;
    const menuTranslate = useRef(new Animated.Value(0)).current;
    const historyTranslate = useRef(new Animated.Value(30)).current;

    const switchToHistory = useCallback(() => {
        setAppView('history');
        Animated.parallel([
            Animated.timing(menuOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
            Animated.timing(menuTranslate, { toValue: -20, duration: 220, useNativeDriver: true }),
            Animated.timing(historyOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
            Animated.timing(historyTranslate, { toValue: 0, duration: 280, useNativeDriver: true }),
        ]).start();
        loadHistory();
    }, []);

    const switchToMenu = useCallback(() => {
        setAppView('menu');
        Animated.parallel([
            Animated.timing(historyOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
            Animated.timing(historyTranslate, { toValue: 30, duration: 200, useNativeDriver: true }),
            Animated.timing(menuOpacity, { toValue: 1, duration: 280, useNativeDriver: true }),
            Animated.timing(menuTranslate, { toValue: 0, duration: 280, useNativeDriver: true }),
        ]).start();
    }, []);

    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(true);
    const [fromCache, setFromCache] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('card');
    const [pendingCount, setPendingCount] = useState(0);

    const [scannerOpen, setScannerOpen] = useState(false);
    const [scanned, setScanned] = useState(false);
    const [scannedProduct, setScannedProduct] = useState<Product | null>(null);
    const [notFound, setNotFound] = useState(false);
    const [quantity, setQuantity] = useState(1);
    const [confirmed, setConfirmed] = useState(false);
    const [confirming, setConfirming] = useState(false);
    const [rawScanned, setRawScanned] = useState('');
    const [scannedPrice, setScannedPrice] = useState('');

    const [manualOrderProduct, setManualOrderProduct] = useState<Product | null>(null);

    const [permission, requestPermission] = useCameraPermissions();
    const scanLineAnim = useRef(new Animated.Value(0)).current;

    const [history, setHistory] = useState<OrderHistoryItem[]>([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyRefreshing, setHistoryRefreshing] = useState(false);
    const [activeTab, setActiveTab] = useState<FilterTab>('all');
    const [selectedOrder, setSelectedOrder] = useState<OrderHistoryItem | null>(null);
    const [receiptVisible, setReceiptVisible] = useState(false);
    const [syncing, setSyncing] = useState(false);

    const loadHistory = useCallback(async () => {
        setHistoryLoading(true);
        const data = await getOrderHistory();
        setHistory(data);
        setHistoryLoading(false);
    }, []);

    const handleHistoryRefresh = useCallback(async () => {
        setHistoryRefreshing(true);
        const data = await getOrderHistory();
        setHistory(data);
        setHistoryRefreshing(false);
    }, []);

    const handleSync = useCallback(async () => {
        if (syncing) return;
        setSyncing(true);
        await syncQueue();
        const data = await getOrderHistory();
        setHistory(data);
        const count = await getPendingCount();
        setPendingCount(count);
        setSyncing(false);
    }, [syncing]);

    const refreshPendingCount = useCallback(async () => {
        const count = await getPendingCount();
        setPendingCount(count);
    }, []);

    const runSync = useCallback(async () => {
        const result = await syncQueue();
        if (result.synced > 0) await refreshPendingCount();
    }, [refreshPendingCount]);

    useEffect(() => {
        async function loadProducts() {
            const { data, fromCache } = await fetchProducts();
            setProducts(data);
            setFromCache(fromCache);
            setLoading(false);
        }
        loadProducts();
    }, []);

    useEffect(() => {
        refreshPendingCount();
        runSync();
        const sub = AppState.addEventListener('change', (state) => {
            if (state === 'active') runSync();
        });
        return () => sub.remove();
    }, []);

    useEffect(() => {
        const loop = Animated.loop(
            Animated.sequence([
                Animated.timing(scanLineAnim, { toValue: 1, duration: 2000, useNativeDriver: true }),
                Animated.timing(scanLineAnim, { toValue: 0, duration: 2000, useNativeDriver: true }),
            ])
        );
        if (scannerOpen && !scanned) loop.start();
        else loop.stop();
        return () => loop.stop();
    }, [scannerOpen, scanned]);

    const filteredProducts = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return products;
        return products.filter(
            (p) =>
                p.name?.toLowerCase().includes(q) ||
                p.category?.toLowerCase().includes(q)
        );
    }, [products, searchQuery]);

    // Separate food and stock products for display
    const foodProducts = useMemo(() => filteredProducts.filter(p => p.product_type === 'food'), [filteredProducts]);
    const stockProducts = useMemo(() => filteredProducts.filter(p => p.product_type === 'stock'), [filteredProducts]);

    const handleOpenScanner = async () => {
        if (!permission?.granted) {
            const result = await requestPermission();
            if (!result.granted) return;
        }
        resetScanner();
        setScannerOpen(true);
    };

    const resetScanner = () => {
        setScanned(false);
        setScannedProduct(null);
        setNotFound(false);
        setQuantity(1);
        setConfirmed(false);
        setConfirming(false);
        setRawScanned('');
        setScannedPrice('');
    };

    const handleBarCodeScanned = ({ data }: { data: string }) => {
        if (scanned) return;
        setScanned(true);
        const trimmed = data.trim();
        setRawScanned(trimmed);
        let match: any = null;
        try {
            const parsed = JSON.parse(trimmed);
            match = products.find(
                (p) =>
                    (parsed.id !== undefined && String(p.id) === String(parsed.id)) ||
                    (parsed.name && p.name?.toLowerCase() === parsed.name.toLowerCase()) ||
                    (parsed.product_id !== undefined && String(p.id) === String(parsed.product_id))
            );
        } catch (_) {}
        if (!match) {
            try {
                const url = new URL(trimmed);
                const paramId = url.searchParams.get('id') || url.searchParams.get('product_id');
                const paramName = url.searchParams.get('name');
                const pathSegment = url.pathname.split('/').filter(Boolean).pop() ?? '';
                match = products.find(
                    (p) =>
                        (paramId && String(p.id) === paramId) ||
                        (paramName && p.name?.toLowerCase() === paramName.toLowerCase()) ||
                        String(p.id) === pathSegment ||
                        p.name?.toLowerCase() === decodeURIComponent(pathSegment).toLowerCase()
                );
            } catch (_) {}
        }
        if (!match) match = products.find((p) => String(p.id) === trimmed);
        if (!match) match = products.find((p) => p.name?.toLowerCase() === trimmed.toLowerCase());
        if (!match) {
            match = products.find(
                (p) =>
                    trimmed.toLowerCase().includes(String(p.id).toLowerCase()) ||
                    trimmed.toLowerCase().includes(p.name?.toLowerCase())
            );
        }
        if (match) {
            setScannedProduct(match);
            // pre-fill selling price for stock items
            setScannedPrice(String(match.product_type === 'stock'
                ? (match.selling_price ?? match.price)
                : match.price));
            setNotFound(false);
        } else {
            setNotFound(true);
        }
    };

    // Unified confirm handler used by both scanner and manual sheet
    const handleSaveOrder = async (product: Product, qty: number, sellingPrice: number, source: 'qr_scan' | 'manual') => {
        const unitCost = product.product_type === 'stock' ? product.price : sellingPrice;
        const order = buildOrder(product, qty, sellingPrice, source, {
            unit_cost: unitCost,
            product_type: product.product_type,
        });
        const result = await saveOrder(order);
        await refreshPendingCount();
        if (result === 'queued') {
            Alert.alert('Saved offline', 'No internet detected. Order saved locally and will sync automatically.');
        }
        return result;
    };

    const handleConfirmScanned = async () => {
        if (!scannedProduct || confirming) return;
        if (scannedProduct.product_type === 'stock' && quantity > (scannedProduct.stock_quantity ?? 0)) {
            Alert.alert('Insufficient stock', `Only ${scannedProduct.stock_quantity} ${scannedProduct.stock_unit || 'units'} available.`);
            return;
        }
        setConfirming(true);
        try {
            const price = scannedProduct.product_type === 'stock'
                ? parseFloat(scannedPrice || String(scannedProduct.selling_price ?? scannedProduct.price))
                : scannedProduct.price;
            await handleSaveOrder(scannedProduct, quantity, price, 'qr_scan');
            setConfirmed(true);
        } catch {
            Alert.alert('Error', 'Failed to save order. Please try again.');
        } finally {
            setConfirming(false);
        }
    };

    const handleOpenManualOrder = (item: Product) => {
        if (item.product_type === 'stock' && (item.stock_quantity ?? 0) <= 0) return;
        setManualOrderProduct(item);
    };

    const handleManualConfirm = async (price: number, qty: number) => {
        if (!manualOrderProduct) return;
        await handleSaveOrder(manualOrderProduct, qty, price, 'manual');
    };

    const resetManualOrder = () => setManualOrderProduct(null);

    const openReceipt = (order: OrderHistoryItem) => {
        setSelectedOrder(order);
        setReceiptVisible(true);
    };

    const closeReceipt = () => {
        setReceiptVisible(false);
        setTimeout(() => setSelectedOrder(null), 300);
    };

    const scanLineTranslate = scanLineAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 176],
    });
    const scannedTotal = scannedProduct
        ? (scannedProduct.product_type === 'stock'
            ? parseFloat(scannedPrice || '0') * quantity
            : scannedProduct.price * quantity)
        : 0;

    const filteredHistory = history.filter((o) => {
        if (activeTab === 'all') return true;
        return o.status === activeTab;
    });
    const grouped = groupByDate(filteredHistory);
    const historyPendingCount = history.filter((o) => o.status === 'pending').length;
    const totalRevenue = history
        .filter((o) => o.status === 'synced')
        .reduce((sum, o) => sum + Number(o.total_price), 0);

    if (loading) {
        return (
            <View style={[styles.container, { justifyContent: 'center' }]}>
                <ActivityIndicator size="large" color="#ffc87a" />
            </View>
        );
    }

    return (
        <View style={[styles.container, { paddingTop: insets.top }]}>
            <View style={styles.viewContainer}>
                {/* ── Menu view ── */}
                <Animated.View
                    style={[
                        styles.viewPane,
                        { opacity: menuOpacity, transform: [{ translateY: menuTranslate }] },
                        appView === 'history' && styles.viewPaneHidden,
                    ]}
                    pointerEvents={appView === 'menu' ? 'auto' : 'none'}
                >
                    <ScrollView
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 100 }]}
                        keyboardShouldPersistTaps="handled"
                    >
                        <View style={styles.header}>
                            <Ionicons name="menu" size={28} color="#18181b" />
                            {searchOpen ? (
                                <TextInput
                                    style={styles.searchInput}
                                    placeholder="Search dishes…"
                                    placeholderTextColor="#a1a1aa"
                                    value={searchQuery}
                                    onChangeText={setSearchQuery}
                                    autoFocus
                                    returnKeyType="search"
                                />
                            ) : (
                                <Text style={styles.address}>140 Roadway Ave.</Text>
                            )}
                            <View style={styles.headerActions}>
                                <Pressable
                                    onPress={() => { setSearchOpen((p) => !p); if (searchOpen) setSearchQuery(''); }}
                                    hitSlop={8}
                                    style={styles.headerActionBtn}
                                >
                                    <Ionicons name={searchOpen ? 'close' : 'search'} size={24} color="#18181b" />
                                </Pressable>
                                <Pressable
                                    onPress={switchToHistory}
                                    hitSlop={8}
                                    style={styles.headerActionBtn}
                                >
                                    <Ionicons name="receipt-outline" size={24} color="#18181b" />
                                    {pendingCount > 0 && (
                                        <View style={styles.badge}>
                                            <Text style={styles.badgeText}>
                                                {pendingCount > 9 ? '9+' : pendingCount}
                                            </Text>
                                        </View>
                                    )}
                                </Pressable>
                            </View>
                        </View>

                        {pendingCount > 0 && (
                            <TouchableOpacity style={styles.syncBanner} onPress={runSync} activeOpacity={0.8}>
                                <Ionicons name="cloud-upload-outline" size={16} color="#92400e" />
                                <Text style={styles.syncBannerText}>
                                    {pendingCount} order{pendingCount > 1 ? 's' : ''} pending sync — tap to retry
                                </Text>
                            </TouchableOpacity>
                        )}

                        {fromCache && (
                            <View style={styles.cacheBanner}>
                                <Ionicons name="wifi-outline" size={15} color="#6b7280" />
                                <Text style={styles.cacheBannerText}>Showing cached menu — no internet connection</Text>
                            </View>
                        )}

                        {!searchOpen && (
                            <Text style={styles.headline}>What would you like{'\n'}to eat?</Text>
                        )}

                        {/* ── View mode toggle ── */}
                        <View style={styles.sectionRow}>
                            <Text style={styles.sectionTitle}>
                                {searchOpen && searchQuery.trim()
                                    ? <>{filteredProducts.length} <Text style={styles.subTitle}>results</Text></>
                                    : <>Available <Text style={styles.subTitle}>items</Text></>}
                            </Text>
                            <View style={styles.toggleWrap}>
                                <TouchableOpacity
                                    onPress={() => setViewMode('card')}
                                    style={[styles.toggleBtn, viewMode === 'card' && styles.toggleActive]}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons name="grid-outline" size={18} color={viewMode === 'card' ? '#18181b' : '#a1a1aa'} />
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={() => setViewMode('list')}
                                    style={[styles.toggleBtn, viewMode === 'list' && styles.toggleActive]}
                                    activeOpacity={0.7}
                                >
                                    <Ionicons name="list-outline" size={20} color={viewMode === 'list' ? '#18181b' : '#a1a1aa'} />
                                </TouchableOpacity>
                            </View>
                        </View>

                        {filteredProducts.length === 0 ? (
                            <View style={styles.emptyState}>
                                <Ionicons name="search-outline" size={48} color="#d4d4d8" />
                                <Text style={styles.emptyText}>No items found</Text>
                            </View>
                        ) : (
                            <>
                                {/* ── Food section ── */}
                                {foodProducts.length > 0 && (
                                    <>
                                        {stockProducts.length > 0 && (
                                            <View style={stockStyles.sectionHeader}>
                                                <Ionicons name="restaurant-outline" size={14} color="#71717a" />
                                                <Text style={stockStyles.sectionHeaderText}>Food & Drinks</Text>
                                            </View>
                                        )}
                                        {viewMode === 'card' ? (
                                            <View style={styles.grid}>
                                                {foodProducts.map((item) => (
                                                    <TouchableOpacity
                                                        key={item.id}
                                                        style={[styles.favCard, { width: CARD_WIDTH }]}
                                                        onPress={() => handleOpenManualOrder(item)}
                                                        activeOpacity={0.8}
                                                    >
                                                        {item.image_url && item.image_url.trim() !== '' ? (
                                                            <Image source={{ uri: item.image_url }} style={styles.productImg} />
                                                        ) : (
                                                            <View style={styles.placeholderImg}>
                                                                <Ionicons name="restaurant-outline" size={36} color="#c4b5a0" />
                                                            </View>
                                                        )}
                                                        <Text style={styles.favName} numberOfLines={1}>{item.name}</Text>
                                                        <Text style={styles.favType} numberOfLines={1}>{item.category}</Text>
                                                        <View style={styles.favFooter}>
                                                            <Text style={styles.price}>
                                                                ₱ {Number(item.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                            </Text>
                                                        </View>
                                                        <Text style={styles.servingText}>/per serving</Text>
                                                        <View style={styles.tapHint}>
                                                            <Ionicons name="add-circle-outline" size={12} color="#ffc87a" />
                                                            <Text style={styles.tapHintText}>Tap to order</Text>
                                                        </View>
                                                    </TouchableOpacity>
                                                ))}
                                            </View>
                                        ) : (
                                            <View style={styles.tileList}>
                                                {foodProducts.map((item) => (
                                                    <TouchableOpacity
                                                        key={item.id}
                                                        style={styles.tileRow}
                                                        onPress={() => handleOpenManualOrder(item)}
                                                        activeOpacity={0.8}
                                                    >
                                                        {item.image_url && item.image_url.trim() !== '' ? (
                                                            <Image source={{ uri: item.image_url }} style={styles.tileImg} />
                                                        ) : (
                                                            <View style={styles.tilePlaceholder}>
                                                                <Ionicons name="restaurant-outline" size={26} color="#c4b5a0" />
                                                            </View>
                                                        )}
                                                        <View style={styles.tileInfo}>
                                                            <Text style={styles.tileName} numberOfLines={1}>{item.name}</Text>
                                                            <Text style={styles.tileCategory}>{item.category}</Text>
                                                            <Text style={styles.tilePrice}>
                                                                ₱ {Number(item.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                                <Text style={styles.tileServing}> /serving</Text>
                                                            </Text>
                                                        </View>
                                                        <View style={styles.tileOrderBtn}>
                                                            <Ionicons name="add-circle-outline" size={26} color="#ffc87a" />
                                                        </View>
                                                    </TouchableOpacity>
                                                ))}
                                            </View>
                                        )}
                                    </>
                                )}

                                {/* ── Stock section ── */}
                                {stockProducts.length > 0 && (
                                    <>
                                        <View style={[stockStyles.sectionHeader, { marginTop: foodProducts.length > 0 ? 24 : 0 }]}>
                                            <Ionicons name="cube-outline" size={14} color="#3b82f6" />
                                            <Text style={[stockStyles.sectionHeaderText, { color: '#3b82f6' }]}>
                                                Stock Items
                                            </Text>
                                            <View style={stockStyles.sectionBadge}>
                                                <Text style={stockStyles.sectionBadgeText}>
                                                    {stockProducts.filter(p => (p.stock_quantity ?? 0) > 0).length} in stock
                                                </Text>
                                            </View>
                                        </View>
                                        {viewMode === 'card' ? (
                                            <View style={styles.grid}>
                                                {stockProducts.map((item) => (
                                                    <StockCard
                                                        key={item.id}
                                                        item={item}
                                                        onPress={() => handleOpenManualOrder(item)}
                                                        width={CARD_WIDTH}
                                                    />
                                                ))}
                                            </View>
                                        ) : (
                                            <View style={styles.tileList}>
                                                {stockProducts.map((item) => (
                                                    <StockRow
                                                        key={item.id}
                                                        item={item}
                                                        onPress={() => handleOpenManualOrder(item)}
                                                    />
                                                ))}
                                            </View>
                                        )}
                                    </>
                                )}
                            </>
                        )}
                    </ScrollView>

                    <View style={[styles.fabWrap, { bottom: insets.bottom + 20 }]}>
                        <TouchableOpacity style={styles.fab} onPress={handleOpenScanner} activeOpacity={0.85}>
                            <Ionicons name="qr-code-outline" size={28} color="#18181b" />
                        </TouchableOpacity>
                    </View>
                </Animated.View>

                {/* ── History view ── */}
                <Animated.View
                    style={[
                        styles.viewPane,
                        { opacity: historyOpacity, transform: [{ translateY: historyTranslate }] },
                        appView === 'menu' && styles.viewPaneHidden,
                    ]}
                    pointerEvents={appView === 'history' ? 'auto' : 'none'}
                >
                    <ScrollView
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
                        refreshControl={
                            <RefreshControl
                                refreshing={historyRefreshing}
                                onRefresh={handleHistoryRefresh}
                                tintColor="#ffc87a"
                                colors={['#ffc87a']}
                            />
                        }
                    >
                        <View style={styles.header}>
                            <TouchableOpacity onPress={switchToMenu} hitSlop={8} style={styles.backBtn}>
                                <Ionicons name="arrow-back" size={22} color="#18181b" />
                            </TouchableOpacity>
                            <View style={styles.historyHeaderCenter}>
                                <Text style={styles.historyTitle}>Order History</Text>
                                <Text style={styles.historySub}>{history.length} orders</Text>
                            </View>
                            {historyPendingCount > 0 && (
                                <TouchableOpacity
                                    style={styles.syncBtn}
                                    onPress={handleSync}
                                    activeOpacity={0.8}
                                    disabled={syncing}
                                >
                                    {syncing ? (
                                        <ActivityIndicator size="small" color="#92400e" />
                                    ) : (
                                        <Ionicons name="cloud-upload-outline" size={16} color="#92400e" />
                                    )}
                                    <Text style={styles.syncBtnText}>
                                        {syncing ? 'Syncing…' : `Sync ${historyPendingCount}`}
                                    </Text>
                                </TouchableOpacity>
                            )}
                        </View>

                        <View style={styles.statsRow}>
                            <View style={styles.statCard}>
                                <Text style={styles.statValue}>{history.length}</Text>
                                <Text style={styles.statLabel}>Total Orders</Text>
                            </View>
                            <View style={[styles.statCard, styles.statCardAccent]}>
                                <Text style={[styles.statValue, styles.statValueAccent]}>
                                    ₱ {totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </Text>
                                <Text style={[styles.statLabel, { color: '#92400e' }]}>Synced Revenue</Text>
                            </View>
                            <View style={styles.statCard}>
                                <Text style={[styles.statValue, historyPendingCount > 0 && { color: '#f59e0b' }]}>
                                    {historyPendingCount}
                                </Text>
                                <Text style={styles.statLabel}>Pending</Text>
                            </View>
                        </View>

                        <View style={styles.tabRow}>
                            {(['all', 'synced', 'pending'] as FilterTab[]).map((tab) => (
                                <TouchableOpacity
                                    key={tab}
                                    style={[styles.tab, activeTab === tab && styles.tabActive]}
                                    onPress={() => setActiveTab(tab)}
                                    activeOpacity={0.7}
                                >
                                    <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                                        {tab.charAt(0).toUpperCase() + tab.slice(1)}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        {historyLoading ? (
                            <View style={styles.emptyState}>
                                <ActivityIndicator size="large" color="#ffc87a" />
                            </View>
                        ) : filteredHistory.length === 0 ? (
                            <View style={styles.emptyState}>
                                <Ionicons name="receipt-outline" size={52} color="#e4e4e7" />
                                <Text style={styles.emptyTitle}>
                                    {activeTab === 'pending'
                                        ? 'No pending orders'
                                        : activeTab === 'synced'
                                            ? 'No synced orders yet'
                                            : 'No orders yet'}
                                </Text>
                                <Text style={styles.emptySubText}>
                                    {activeTab === 'pending'
                                        ? 'All orders have been synced to the server.'
                                        : activeTab === 'synced'
                                            ? 'Orders will appear here once they sync successfully.'
                                            : 'Confirmed orders from QR scan or manual entry will show up here.'}
                                </Text>
                            </View>
                        ) : (
                            grouped.map(({ label, data }) => (
                                <View key={label} style={styles.group}>
                                    <Text style={styles.groupLabel}>{label}</Text>
                                    <View style={styles.groupCard}>
                                        {data.map((order, idx) => (
                                            <TouchableOpacity
                                                key={order.idempotency_key}
                                                style={[
                                                    styles.orderCard,
                                                    idx < data.length - 1 && styles.orderCardBorder,
                                                ]}
                                                onPress={() => openReceipt(order)}
                                                activeOpacity={0.75}
                                            >
                                                <View style={styles.orderCardLeft}>
                                                    <View
                                                        style={[
                                                            styles.orderIconWrap,
                                                            order.product_type === 'stock'
                                                                ? stockStyles.orderIconStock
                                                                : order.source === 'qr_scan'
                                                                    ? styles.orderIconQR
                                                                    : styles.orderIconManual,
                                                        ]}
                                                    >
                                                        <Ionicons
                                                            name={
                                                                order.product_type === 'stock'
                                                                    ? 'cube-outline'
                                                                    : order.source === 'qr_scan'
                                                                        ? 'qr-code-outline'
                                                                        : 'pencil-outline'
                                                            }
                                                            size={15}
                                                            color={
                                                                order.product_type === 'stock'
                                                                    ? '#3b82f6'
                                                                    : order.source === 'qr_scan'
                                                                        ? '#18181b'
                                                                        : '#6b7280'
                                                            }
                                                        />
                                                    </View>
                                                    <View style={styles.orderCardInfo}>
                                                        <Text style={styles.orderName} numberOfLines={1}>
                                                            {order.product_name}
                                                        </Text>
                                                        <Text style={styles.orderMeta}>
                                                            {order.quantity}× · {formatTime(order.created_at)}
                                                            {order.product_type === 'stock' && ' · Stock'}
                                                        </Text>
                                                    </View>
                                                </View>
                                                <View style={styles.orderCardRight}>
                                                    <Text style={styles.orderTotal}>
                                                        ₱ {Number(order.total_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                    </Text>
                                                    <View
                                                        style={[
                                                            styles.statusDot,
                                                            order.status === 'synced' ? styles.statusDotSynced : styles.statusDotPending,
                                                        ]}
                                                    />
                                                </View>
                                            </TouchableOpacity>
                                        ))}
                                    </View>
                                </View>
                            ))
                        )}
                    </ScrollView>
                </Animated.View>
            </View>

            {/* ── Manual order modal ── */}
            <Modal
                visible={!!manualOrderProduct}
                animationType="slide"
                transparent
                onRequestClose={resetManualOrder}
            >
                <View style={styles.manualOverlay}>
                    <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={resetManualOrder} activeOpacity={1} />
                    {manualOrderProduct && (
                        <ManualOrderSheet
                            product={manualOrderProduct}
                            insets={{ bottom: insets.bottom }}
                            onConfirm={handleManualConfirm}
                            onClose={resetManualOrder}
                        />
                    )}
                </View>
            </Modal>

            {/* ── QR Scanner modal ── */}
            <Modal
                visible={scannerOpen}
                animationType="slide"
                presentationStyle="fullScreen"
                onRequestClose={() => setScannerOpen(false)}
            >
                <View style={styles.scannerContainer}>
                    <View style={[styles.cameraPane, { paddingTop: insets.top }]}>
                        <CameraView
                            style={StyleSheet.absoluteFillObject}
                            facing="back"
                            barcodeScannerSettings={{ barcodeTypes: ['qr', 'ean13', 'ean8', 'code128', 'code39'] }}
                            onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
                        />
                        <View style={styles.cameraOverlay} />
                        <View style={styles.scanWindowWrap}>
                            <View style={styles.scanWindow}>
                                <View style={[styles.corner, styles.cornerTL]} />
                                <View style={[styles.corner, styles.cornerTR]} />
                                <View style={[styles.corner, styles.cornerBL]} />
                                <View style={[styles.corner, styles.cornerBR]} />
                                {!scanned && (
                                    <Animated.View
                                        style={[styles.scanLine, { transform: [{ translateY: scanLineTranslate }] }]}
                                    />
                                )}
                            </View>
                            <Text style={styles.scanHint}>
                                {scanned ? '✓ Code detected' : 'Point camera at a product QR code'}
                            </Text>
                        </View>
                        <TouchableOpacity
                            style={[styles.closeBtn, { top: insets.top + 10 }]}
                            onPress={() => setScannerOpen(false)}
                        >
                            <Ionicons name="close" size={22} color="#fff" />
                        </TouchableOpacity>
                    </View>

                    <View style={[styles.resultSheet, { paddingBottom: insets.bottom + 8 }]}>
                        <View style={styles.sheetHandle} />
                        {!scanned && (
                            <View style={styles.idleState}>
                                <Ionicons name="qr-code-outline" size={36} color="#d4d4d8" />
                                <Text style={styles.idleText}>Waiting for scan…</Text>
                            </View>
                        )}
                        {scanned && notFound && (
                            <View style={styles.resultInner}>
                                <Ionicons name="alert-circle-outline" size={40} color="#f87171" />
                                <Text style={styles.notFoundTitle}>Product not found</Text>
                                <Text style={styles.notFoundSub}>
                                    The scanned code doesn't match any item in the menu.
                                </Text>
                                <View style={styles.debugBox}>
                                    <Text style={styles.debugLabel}>Raw scanned value:</Text>
                                    <Text style={styles.debugValue} selectable>{rawScanned}</Text>
                                </View>
                                <TouchableOpacity style={styles.fullBtn} onPress={resetScanner}>
                                    <Ionicons name="refresh" size={16} color="#18181b" />
                                    <Text style={styles.fullBtnText}>Scan Again</Text>
                                </TouchableOpacity>
                            </View>
                        )}
                        {scanned && scannedProduct && !confirmed && (
                            <View style={styles.resultInner}>
                                <View style={styles.productHeader}>
                                    {scannedProduct.image_url && scannedProduct.image_url.trim() !== '' ? (
                                        <Image source={{ uri: scannedProduct.image_url }} style={styles.resultImg} />
                                    ) : (
                                        <View style={[styles.resultImgPlaceholder, scannedProduct.product_type === 'stock' && stockStyles.resultImgStock]}>
                                            <Ionicons
                                                name={scannedProduct.product_type === 'stock' ? 'cube-outline' : 'restaurant-outline'}
                                                size={28}
                                                color={scannedProduct.product_type === 'stock' ? '#93c5fd' : '#c4b5a0'}
                                            />
                                        </View>
                                    )}
                                    <View style={styles.productHeaderText}>
                                        <Text style={styles.resultName} numberOfLines={2}>{scannedProduct.name}</Text>
                                        <Text style={styles.resultCategory}>{scannedProduct.category}</Text>
                                        {scannedProduct.product_type === 'stock' && (
                                            <StockBadge product={scannedProduct} />
                                        )}
                                    </View>
                                </View>

                                {scannedProduct.product_type === 'stock' ? (
                                    /* Stock item: show cost, stock qty, selling price input */
                                    <>
                                        <View style={stockStyles.sheetInfoTable}>
                                            <View style={stockStyles.sheetInfoRow}>
                                                <Ionicons name="cube-outline" size={13} color="#6b7280" />
                                                <Text style={stockStyles.sheetInfoLabel}>Available</Text>
                                                <Text style={stockStyles.sheetInfoValue}>
                                                    {(scannedProduct.stock_quantity ?? 0).toLocaleString()} {scannedProduct.stock_unit || 'units'}
                                                </Text>
                                            </View>
                                            <View style={stockStyles.sheetInfoDivider} />
                                            <View style={stockStyles.sheetInfoRow}>
                                                <Ionicons name="pricetag-outline" size={13} color="#6b7280" />
                                                <Text style={stockStyles.sheetInfoLabel}>Cost per unit</Text>
                                                <Text style={stockStyles.sheetInfoValue}>
                                                    ₱ {Number(scannedProduct.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                                </Text>
                                            </View>
                                        </View>
                                        <Text style={styles.manualPriceLabel}>Selling price (₱)</Text>
                                        <View style={styles.priceInputWrap}>
                                            <Text style={styles.pesoSign}>₱</Text>
                                            <TextInput
                                                style={styles.priceInput}
                                                value={scannedPrice}
                                                onChangeText={(v) => setScannedPrice(v.replace(/[^0-9.]/g, ''))}
                                                keyboardType="decimal-pad"
                                                placeholder={String(scannedProduct.selling_price ?? scannedProduct.price)}
                                                placeholderTextColor="#a1a1aa"
                                                returnKeyType="done"
                                            />
                                        </View>
                                    </>
                                ) : (
                                    <View style={styles.priceRow}>
                                        <Text style={styles.priceLabel}>Price / serving</Text>
                                        <Text style={styles.priceValue}>
                                            ₱ {Number(scannedProduct.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </Text>
                                    </View>
                                )}

                                <View style={styles.divider} />
                                <View style={styles.qtyRow}>
                                    <Text style={styles.qtyLabel}>Quantity</Text>
                                    <View style={styles.stepper}>
                                        <TouchableOpacity
                                            style={[styles.stepBtn, quantity <= 1 && styles.stepBtnDisabled]}
                                            onPress={() => setQuantity((q) => Math.max(1, q - 1))}
                                            activeOpacity={0.7}
                                        >
                                            <Ionicons name="remove" size={18} color={quantity <= 1 ? '#d4d4d8' : '#18181b'} />
                                        </TouchableOpacity>
                                        <Text style={styles.qtyValue}>{quantity}</Text>
                                        <TouchableOpacity
                                            style={[
                                                styles.stepBtn,
                                                scannedProduct.product_type === 'stock' && quantity >= (scannedProduct.stock_quantity ?? Infinity) && styles.stepBtnDisabled,
                                            ]}
                                            onPress={() => setQuantity((q) => scannedProduct.product_type === 'stock'
                                                ? Math.min(scannedProduct.stock_quantity ?? q + 1, q + 1)
                                                : q + 1)}
                                            activeOpacity={0.7}
                                        >
                                            <Ionicons name="add" size={18} color="#18181b" />
                                        </TouchableOpacity>
                                    </View>
                                </View>
                                <View style={styles.totalRow}>
                                    <Text style={styles.totalLabel}>Total</Text>
                                    <Text style={styles.totalValue}>
                                        ₱ {scannedTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </Text>
                                </View>
                                <View style={styles.actionRow}>
                                    <TouchableOpacity style={styles.rescanBtn} onPress={resetScanner} activeOpacity={0.7}>
                                        <Ionicons name="refresh" size={15} color="#71717a" />
                                        <Text style={styles.rescanText}>Rescan</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[
                                            styles.confirmBtn,
                                            scannedProduct.product_type === 'stock' && stockStyles.confirmBtnStock,
                                            confirming && styles.confirmBtnDisabled,
                                        ]}
                                        onPress={handleConfirmScanned}
                                        activeOpacity={0.85}
                                        disabled={confirming}
                                    >
                                        {confirming ? (
                                            <ActivityIndicator size="small" color="#18181b" />
                                        ) : (
                                            <>
                                                <Ionicons name="checkmark" size={17} color="#18181b" />
                                                <Text style={styles.confirmText}>
                                                    {scannedProduct.product_type === 'stock' ? 'Confirm Sale' : 'Confirm Order'}
                                                </Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}
                        {confirmed && scannedProduct && (
                            <View style={styles.resultInner}>
                                <Ionicons name="checkmark-circle" size={52} color="#4ade80" />
                                <Text style={styles.confirmedTitle}>
                                    {scannedProduct.product_type === 'stock' ? 'Sale Recorded!' : 'Order Added!'}
                                </Text>
                                <Text style={styles.confirmedSub}>{quantity}× {scannedProduct.name}</Text>
                                <Text style={styles.confirmedTotal}>
                                    ₱ {scannedTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </Text>
                                <View style={styles.actionRow}>
                                    <TouchableOpacity style={styles.rescanBtn} onPress={resetScanner} activeOpacity={0.7}>
                                        <Ionicons name="qr-code-outline" size={15} color="#71717a" />
                                        <Text style={styles.rescanText}>Scan Next</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={styles.confirmBtn}
                                        onPress={() => setScannerOpen(false)}
                                        activeOpacity={0.85}
                                    >
                                        <Ionicons name="arrow-back" size={15} color="#18181b" />
                                        <Text style={styles.confirmText}>Back to Menu</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}
                    </View>
                </View>
            </Modal>

            <ReceiptModal order={selectedOrder} visible={receiptVisible} onClose={closeReceipt} />
        </View>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Styles — only additions/overrides; originals preserved below
// ─────────────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#fdfbf7' },
    viewContainer: { flex: 1 },
    viewPane: { ...StyleSheet.absoluteFillObject },
    viewPaneHidden: { zIndex: -1 },
    scrollContent: { padding: PADDING },

    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 24,
    },
    address: { color: '#71717a', fontSize: 14 },
    searchInput: {
        flex: 1,
        marginHorizontal: 12,
        fontSize: 15,
        color: '#18181b',
        borderBottomWidth: 1.5,
        borderBottomColor: '#ffc87a',
        paddingVertical: 4,
    },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    headerActionBtn: { padding: 4, position: 'relative' },
    badge: {
        position: 'absolute',
        top: 0,
        right: 0,
        minWidth: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: '#ef4444',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 3,
    },
    badgeText: { fontSize: 9, fontWeight: '800', color: '#fff' },

    backBtn: {
        width: 36,
        height: 36,
        borderRadius: 18,
        backgroundColor: '#f4f4f5',
        alignItems: 'center',
        justifyContent: 'center',
    },
    historyHeaderCenter: { flex: 1, marginLeft: 12 },
    historyTitle: { fontSize: 20, fontWeight: '800', color: '#18181b' },
    historySub: { fontSize: 12, color: '#a1a1aa', marginTop: 1 },

    syncBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#fef3c7',
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        marginBottom: 16,
    },
    syncBannerText: { fontSize: 13, fontWeight: '600', color: '#92400e', flex: 1 },

    cacheBanner: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#f3f4f6',
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        marginBottom: 16,
    },
    cacheBannerText: { fontSize: 13, color: '#6b7280', flex: 1 },

    headline: { fontSize: 32, fontWeight: '800', marginBottom: 24, color: '#18181b' },

    sectionRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    sectionTitle: { fontSize: 22, fontWeight: '700', color: '#18181b' },
    subTitle: { color: '#71717a' },

    toggleWrap: { flexDirection: 'row', gap: 4 },
    toggleBtn: { padding: 6, borderRadius: 10 },
    toggleActive: { backgroundColor: '#ffecd0' },

    grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: GUTTER, columnGap: GUTTER },
    favCard: {
        backgroundColor: '#fff', padding: 12, borderRadius: 24,
        shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8,
        shadowOffset: { width: 0, height: 2 }, elevation: 2,
    },
    productImg: { width: '100%', height: 120, borderRadius: 20, marginBottom: 12 },
    placeholderImg: {
        height: 120, backgroundColor: '#f5ede3', borderRadius: 20,
        marginBottom: 12, alignItems: 'center', justifyContent: 'center',
    },
    favName: { fontWeight: '700', color: '#18181b', marginBottom: 2 },
    favType: { color: '#71717a', fontSize: 12, marginBottom: 8 },
    favFooter: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
    price: { fontWeight: '800', fontSize: 15, color: '#18181b' },
    servingText: { fontSize: 11, color: '#a1a1aa', marginTop: 2 },
    tapHint: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 6 },
    tapHintText: { fontSize: 10, color: '#ffc87a', fontWeight: '600' },

    tileList: { gap: GUTTER },
    tileRow: {
        flexDirection: 'row', backgroundColor: '#fff', borderRadius: 20,
        overflow: 'hidden', alignItems: 'center',
        shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 }, elevation: 2,
    },
    tileImg: { width: 90, height: 90 },
    tilePlaceholder: { width: 90, height: 90, backgroundColor: '#f5ede3', alignItems: 'center', justifyContent: 'center' },
    tileInfo: { flex: 1, paddingHorizontal: 14, paddingVertical: 12 },
    tileName: { fontWeight: '700', fontSize: 15, color: '#18181b', marginBottom: 2 },
    tileCategory: { color: '#71717a', fontSize: 12, marginBottom: 6 },
    tilePrice: { fontWeight: '800', fontSize: 15, color: '#18181b' },
    tileServing: { fontWeight: '400', fontSize: 11, color: '#a1a1aa' },
    tileOrderBtn: { paddingRight: 14 },

    emptyState: { alignItems: 'center', paddingTop: 60, gap: 12, paddingHorizontal: 20 },
    emptyText: { color: '#a1a1aa', fontSize: 16 },
    emptyTitle: { fontSize: 18, fontWeight: '800', color: '#3f3f46' },
    emptySubText: { fontSize: 13, color: '#a1a1aa', textAlign: 'center', lineHeight: 20 },

    fabWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', pointerEvents: 'box-none' },
    fab: {
        width: 64, height: 64, borderRadius: 32, backgroundColor: '#ffc87a',
        alignItems: 'center', justifyContent: 'center',
        shadowColor: '#ffc87a', shadowOpacity: 0.45, shadowRadius: 12,
        shadowOffset: { width: 0, height: 4 }, elevation: 8,
    },

    statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
    statCard: {
        flex: 1, backgroundColor: '#fff', borderRadius: 18, padding: 14, alignItems: 'center',
        shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 }, elevation: 1,
    },
    statCardAccent: { backgroundColor: '#ffecd0', flex: 1.4 },
    statValue: { fontSize: 18, fontWeight: '900', color: '#18181b', marginBottom: 2 },
    statValueAccent: { fontSize: 14, color: '#92400e' },
    statLabel: { fontSize: 10, color: '#a1a1aa', fontWeight: '600', textAlign: 'center' },

    tabRow: {
        flexDirection: 'row', backgroundColor: '#f4f4f5', borderRadius: 14,
        padding: 4, marginBottom: 20, gap: 2,
    },
    tab: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
    tabActive: {
        backgroundColor: '#fff', shadowColor: '#000',
        shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
    },
    tabText: { fontSize: 13, fontWeight: '600', color: '#a1a1aa' },
    tabTextActive: { color: '#18181b' },

    group: { marginBottom: 20 },
    groupLabel: {
        fontSize: 11, fontWeight: '700', color: '#a1a1aa',
        textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8,
    },
    groupCard: {
        backgroundColor: '#fff', borderRadius: 18, overflow: 'hidden',
        shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6,
        shadowOffset: { width: 0, height: 2 }, elevation: 1,
    },
    orderCard: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingVertical: 14, paddingHorizontal: 16,
    },
    orderCardBorder: { borderBottomWidth: 1, borderBottomColor: '#f4f4f5' },
    orderCardLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
    orderIconWrap: {
        width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    },
    orderIconQR: { backgroundColor: '#ffecd0' },
    orderIconManual: { backgroundColor: '#f4f4f5' },
    orderCardInfo: { flex: 1 },
    orderName: { fontSize: 14, fontWeight: '700', color: '#18181b', marginBottom: 2 },
    orderMeta: { fontSize: 12, color: '#a1a1aa' },
    orderCardRight: { alignItems: 'flex-end', gap: 6 },
    orderTotal: { fontSize: 14, fontWeight: '800', color: '#18181b' },
    statusDot: { width: 7, height: 7, borderRadius: 4 },
    statusDotSynced: { backgroundColor: '#4ade80' },
    statusDotPending: { backgroundColor: '#f59e0b' },

    syncBtn: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        backgroundColor: '#fef3c7', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7,
    },
    syncBtnText: { fontSize: 11, fontWeight: '700', color: '#92400e' },

    manualOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    manualSheet: {
        backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28,
        paddingHorizontal: PADDING, paddingTop: 12, gap: 12,
    },
    manualPriceLabel: { fontSize: 13, fontWeight: '600', color: '#71717a', marginTop: 4 },
    priceInputWrap: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: '#f4f4f5',
        borderRadius: 14, paddingHorizontal: 14, height: 52, gap: 6,
    },
    pesoSign: { fontSize: 20, fontWeight: '800', color: '#18181b' },
    priceInput: { flex: 1, fontSize: 24, fontWeight: '800', color: '#18181b' },
    defaultPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    defaultPriceHint: { fontSize: 12, color: '#a1a1aa' },
    defaultPriceValue: { fontSize: 12, color: '#ffc87a', fontWeight: '600' },
    confirmBtnDisabled: { opacity: 0.4 },

    scannerContainer: { flex: 1, backgroundColor: '#fff' },
    cameraPane: {
        height: height * 0.36, backgroundColor: '#000',
        overflow: 'hidden', justifyContent: 'center', alignItems: 'center',
    },
    cameraOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
    scanWindowWrap: { alignItems: 'center', gap: 12 },
    scanWindow: { width: 180, height: 180, borderRadius: 4 },
    scanHint: { color: 'rgba(255,255,255,0.75)', fontSize: 12, textAlign: 'center' },
    corner: { position: 'absolute', width: 24, height: 24, borderColor: '#ffc87a', borderWidth: 3 },
    cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 5 },
    cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 5 },
    cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 5 },
    cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 5 },
    scanLine: {
        position: 'absolute', left: 6, right: 6, height: 2, borderRadius: 1,
        backgroundColor: '#ffc87a',
        shadowColor: '#ffc87a', shadowOpacity: 0.9, shadowRadius: 6, shadowOffset: { width: 0, height: 0 },
    },

    resultSheet: {
        flex: 1, backgroundColor: '#fff', paddingHorizontal: PADDING, paddingTop: 8, justifyContent: 'center',
    },
    sheetHandle: {
        width: 36, height: 4, borderRadius: 2, backgroundColor: '#e4e4e7',
        alignSelf: 'center', marginBottom: 14,
    },
    idleState: { alignItems: 'center', gap: 8 },
    idleText: { color: '#a1a1aa', fontSize: 14 },
    resultInner: { width: '100%', alignItems: 'center', gap: 8 },
    productHeader: {
        flexDirection: 'row', alignItems: 'center', gap: 12, width: '100%',
        backgroundColor: '#f9f9f9', borderRadius: 16, padding: 12,
    },
    productHeaderText: { flex: 1 },
    resultImg: { width: 60, height: 60, borderRadius: 12 },
    resultImgPlaceholder: {
        width: 60, height: 60, borderRadius: 12, backgroundColor: '#f5ede3',
        alignItems: 'center', justifyContent: 'center',
    },
    resultName: { fontSize: 16, fontWeight: '800', color: '#18181b' },
    resultCategory: { fontSize: 12, color: '#71717a', marginTop: 2 },
    priceRow: {
        flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'center',
        backgroundColor: '#f9f9f9', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    },
    priceLabel: { fontSize: 13, color: '#71717a' },
    priceValue: { fontSize: 15, fontWeight: '700', color: '#18181b' },
    divider: { width: '100%', height: 1, backgroundColor: '#f4f4f5' },
    qtyRow: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: '100%',
    },
    qtyLabel: { fontSize: 14, fontWeight: '600', color: '#18181b' },
    stepper: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: '#f4f4f5', borderRadius: 99, overflow: 'hidden',
    },
    stepBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    stepBtnDisabled: { opacity: 0.35 },
    qtyValue: { minWidth: 32, textAlign: 'center', fontSize: 17, fontWeight: '800', color: '#18181b' },
    totalRow: {
        flexDirection: 'row', justifyContent: 'space-between', width: '100%', alignItems: 'center',
        backgroundColor: '#ffecd0', borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12,
    },
    totalLabel: { fontSize: 13, fontWeight: '600', color: '#92400e' },
    totalValue: { fontSize: 20, fontWeight: '900', color: '#92400e' },
    actionRow: { flexDirection: 'row', gap: 10, width: '100%' },
    rescanBtn: {
        flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 6, paddingVertical: 13, borderRadius: 99, backgroundColor: '#f4f4f5',
    },
    rescanText: { fontSize: 13, fontWeight: '600', color: '#71717a' },
    confirmBtn: {
        flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 6, paddingVertical: 13, borderRadius: 99, backgroundColor: '#ffc87a',
    },
    confirmText: { fontSize: 13, fontWeight: '800', color: '#18181b' },
    notFoundTitle: { fontSize: 17, fontWeight: '800', color: '#18181b' },
    notFoundSub: { fontSize: 13, color: '#71717a', textAlign: 'center' },
    fullBtn: {
        width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        gap: 8, paddingVertical: 13, borderRadius: 99, backgroundColor: '#ffc87a',
    },
    fullBtnText: { fontSize: 13, fontWeight: '800', color: '#18181b' },
    debugBox: { width: '100%', backgroundColor: '#f4f4f5', borderRadius: 10, padding: 10 },
    debugLabel: { fontSize: 10, color: '#a1a1aa', marginBottom: 3, fontWeight: '600' },
    debugValue: { fontSize: 11, color: '#18181b' },
    confirmedTitle: { fontSize: 22, fontWeight: '900', color: '#18181b' },
    confirmedSub: { fontSize: 14, color: '#71717a' },
    confirmedTotal: { fontSize: 28, fontWeight: '900', color: '#16a34a' },
    closeBtn: {
        position: 'absolute', right: 16, width: 34, height: 34, borderRadius: 17,
        backgroundColor: 'rgba(0,0,0,0.4)', alignItems: 'center', justifyContent: 'center',
    },
});

// ── Stock-specific styles ─────────────────────────────────────────────────────
const stockStyles = StyleSheet.create({
    // Card
    stockCard: { borderWidth: 1.5, borderColor: '#dbeafe' },
    stockPlaceholder: { backgroundColor: '#eff6ff' },

    typeTag: {
        flexDirection: 'row', alignItems: 'center', gap: 3,
        backgroundColor: '#dbeafe', borderRadius: 6,
        paddingHorizontal: 6, paddingVertical: 2, alignSelf: 'flex-start',
        marginBottom: 4,
    },
    typeTagText: { fontSize: 9, fontWeight: '800', color: '#1d4ed8', letterSpacing: 0.5 },

    stockQtyRow: {
        flexDirection: 'row', alignItems: 'baseline', gap: 3,
        backgroundColor: '#f0f9ff', borderRadius: 8, borderWidth: 1,
        paddingHorizontal: 8, paddingVertical: 4, marginVertical: 4,
    },
    stockQty: { fontSize: 18, fontWeight: '900' },
    stockUnit: { fontSize: 11, color: '#6b7280', fontWeight: '500' },

    priceTable: {
        width: '100%', backgroundColor: '#f8fafc', borderRadius: 10,
        paddingHorizontal: 10, paddingVertical: 6, gap: 4,
    },
    priceTableRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    priceTableDivider: { height: 1, backgroundColor: '#e2e8f0' },
    priceTableLabel: { fontSize: 10, color: '#94a3b8', fontWeight: '600' },
    priceTableValue: { fontSize: 12, fontWeight: '700', color: '#334155' },
    priceTableSell: { color: '#0f766e' },

    outOfStockOverlay: {
        backgroundColor: '#fef2f2', borderRadius: 8, paddingHorizontal: 10,
        paddingVertical: 5, alignSelf: 'center', marginTop: 4,
    },
    outOfStockText: { fontSize: 11, fontWeight: '700', color: '#dc2626' },

    // List row
    rowDisabled: { opacity: 0.55 },
    stockTilePlaceholder: { backgroundColor: '#eff6ff' },
    tileNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
    typeTagSmall: {
        backgroundColor: '#dbeafe', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1,
    },
    typeTagSmallText: { fontSize: 8, fontWeight: '800', color: '#1d4ed8', letterSpacing: 0.4 },
    tileStockRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
    tileStockDot: { width: 6, height: 6, borderRadius: 3 },
    tileStockQty: { fontSize: 11, fontWeight: '700' },
    tilePriceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    tileCost: { fontSize: 11, color: '#94a3b8', fontWeight: '500' },
    tilePriceDivider: { width: 1, height: 10, backgroundColor: '#e2e8f0' },
    tileSell: { fontSize: 11, fontWeight: '700', color: '#0f766e' },

    // Stock badge
    badge: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start',
        marginTop: 4,
    },
    badgeOk: { backgroundColor: '#dcfce7' },
    badgeLow: { backgroundColor: '#fef3c7' },
    badgeEmpty: { backgroundColor: '#fee2e2' },
    badgeText: { fontSize: 10, fontWeight: '700' },
    badgeTextOk: { color: '#15803d' },
    badgeTextLow: { color: '#b45309' },
    badgeTextEmpty: { color: '#dc2626' },

    // Info row
    infoRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    infoText: { fontSize: 11, color: '#6b7280' },

    // Sheet info table
    sheetInfoTable: {
        backgroundColor: '#f0f9ff', borderRadius: 14, borderWidth: 1,
        borderColor: '#bae6fd', paddingHorizontal: 14, paddingVertical: 10, gap: 8,
    },
    sheetInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    sheetInfoLabel: { fontSize: 12, color: '#64748b', flex: 1 },
    sheetInfoValue: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
    sheetInfoDivider: { height: 1, backgroundColor: '#bae6fd' },

    // Profit preview
    profitPreview: {
        width: '100%', backgroundColor: '#f0fdf4', borderRadius: 14, borderWidth: 1,
        borderColor: '#bbf7d0', padding: 12, gap: 6,
    },
    profitPreviewRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    profitPreviewLabel: { fontSize: 12, fontWeight: '600', color: '#166534' },
    profitPreviewValue: { fontSize: 15, fontWeight: '900', color: '#16a34a' },
    profitNeg: { color: '#dc2626' },
    marginBar: { height: 4, backgroundColor: '#d1fae5', borderRadius: 2, overflow: 'hidden' },
    marginBarFill: { height: '100%', borderRadius: 2 },
    marginLabel: { fontSize: 10, color: '#4b7c56', fontWeight: '500' },

    // Confirm button stock variant
    confirmBtnStock: { backgroundColor: '#93c5fd' },

    // Header name row
    headerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    typeTagInline: {
        backgroundColor: '#dbeafe', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2,
    },
    typeTagInlineText: { fontSize: 9, fontWeight: '800', color: '#1d4ed8' },

    // Result image stock
    resultImgStock: { backgroundColor: '#eff6ff' },

    // Section headers
    sectionHeader: {
        flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12,
    },
    sectionHeaderText: {
        fontSize: 13, fontWeight: '700', color: '#71717a', textTransform: 'uppercase', letterSpacing: 0.6,
    },
    sectionBadge: {
        backgroundColor: '#dbeafe', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 4,
    },
    sectionBadgeText: { fontSize: 10, fontWeight: '700', color: '#1d4ed8' },

    // Order history icon for stock
    orderIconStock: { backgroundColor: '#dbeafe' },

    // Confirmed profit line
    confirmedProfit: {
        flexDirection: 'row', alignItems: 'center', gap: 5,
        backgroundColor: '#dcfce7', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    },
    confirmedProfitText: { fontSize: 12, fontWeight: '700', color: '#16a34a' },
});

const receiptStyles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
    sheet: {
        backgroundColor: '#fdfbf7', borderTopLeftRadius: 28, borderTopRightRadius: 28,
        paddingHorizontal: PADDING, paddingTop: 12, gap: 14,
    },
    handle: {
        width: 36, height: 4, borderRadius: 2, backgroundColor: '#e4e4e7',
        alignSelf: 'center', marginBottom: 6,
    },
    receiptCard: {
        backgroundColor: '#fff', borderRadius: 20, overflow: 'hidden',
        shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10,
        shadowOffset: { width: 0, height: 2 }, elevation: 3,
    },
    receiptHeader: {
        alignItems: 'center', paddingTop: 20, paddingBottom: 16,
        backgroundColor: '#18181b', gap: 4,
    },
    logoMark: {
        width: 44, height: 44, borderRadius: 22,
        backgroundColor: 'rgba(255,200,122,0.15)',
        alignItems: 'center', justifyContent: 'center', marginBottom: 4,
    },
    storeName: { fontSize: 16, fontWeight: '800', color: '#fff' },
    receiptNo: { fontSize: 12, color: '#a1a1aa', fontWeight: '500' },
    dashedLine: { height: 1, borderStyle: 'dashed', borderWidth: 1, borderColor: '#e4e4e7' },
    receiptBody: { paddingHorizontal: 18, paddingVertical: 14, gap: 10 },
    receiptRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    receiptFieldLabel: { fontSize: 12, color: '#a1a1aa', fontWeight: '500', flex: 1 },
    receiptFieldValue: { fontSize: 13, color: '#18181b', fontWeight: '600', flex: 1.5, textAlign: 'right' },
    sourcePill: {
        flexDirection: 'row', alignItems: 'center', gap: 4,
        backgroundColor: '#f4f4f5', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
    },
    sourcePillText: { fontSize: 11, color: '#71717a', fontWeight: '600' },
    // Profit breakdown block
    profitBlock: { paddingHorizontal: 18, paddingVertical: 10, gap: 4 },
    profitRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    profitLabel: { fontSize: 12, color: '#6b7280' },
    profitValue: { fontSize: 13, fontWeight: '600', color: '#18181b' },
    profitCost: { fontSize: 13, fontWeight: '600', color: '#dc2626' },
    profitMarginRow: {
        marginTop: 4, borderTopWidth: 1, borderTopColor: '#f0fdf4',
        paddingTop: 6,
    },
    profitMarginLabel: { fontSize: 13, fontWeight: '700', color: '#166534' },
    profitMarginValue: { fontSize: 15, fontWeight: '900', color: '#16a34a' },

    totalBlock: {
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
        paddingHorizontal: 18, paddingVertical: 14, backgroundColor: '#ffecd0',
    },
    totalBlockLabel: { fontSize: 13, fontWeight: '700', color: '#92400e' },
    totalBlockValue: { fontSize: 22, fontWeight: '900', color: '#92400e' },
    statusBlock: { alignItems: 'center', paddingVertical: 12, paddingHorizontal: 18 },
    statusBadge: {
        flexDirection: 'row', alignItems: 'center', gap: 6,
        borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7,
    },
    statusBadgeSynced: { backgroundColor: '#dcfce7' },
    statusBadgePending: { backgroundColor: '#fef3c7' },
    statusBadgeText: { fontSize: 12, fontWeight: '700' },
    statusBadgeTextSynced: { color: '#16a34a' },
    statusBadgeTextPending: { color: '#92400e' },
    receiptFooter: { alignItems: 'center', paddingBottom: 16, paddingTop: 4, gap: 2 },
    receiptFooterText: { fontSize: 12, fontWeight: '700', color: '#18181b' },
    receiptFooterSub: { fontSize: 11, color: '#a1a1aa' },
    closeBtn: { backgroundColor: '#18181b', borderRadius: 99, paddingVertical: 14, alignItems: 'center' },
    closeBtnText: { fontSize: 14, fontWeight: '800', color: '#fff' },
});