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
    price: number;
    image_url?: string;
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
                                <Ionicons name="restaurant" size={22} color="#ffc87a" />
                            </View>
                            <Text style={receiptStyles.storeName}>Order Receipt</Text>
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
                            <View style={receiptStyles.receiptRow}>
                                <Text style={receiptStyles.receiptFieldLabel}>Unit Price</Text>
                                <Text style={receiptStyles.receiptFieldValue}>
                                    ₱ {Number(order.unit_price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </Text>
                            </View>
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

    const [manualOrderProduct, setManualOrderProduct] = useState<Product | null>(null);
    const [manualPrice, setManualPrice] = useState('');
    const [manualQuantity, setManualQuantity] = useState(1);
    const [manualConfirmed, setManualConfirmed] = useState(false);
    const [manualConfirming, setManualConfirming] = useState(false);

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
            setNotFound(false);
        } else {
            setNotFound(true);
        }
    };

    const handleConfirm = async () => {
        if (!scannedProduct || confirming) return;
        setConfirming(true);
        try {
            const order = buildOrder(scannedProduct, quantity, scannedProduct.price, 'qr_scan');
            const result = await saveOrder(order);
            setConfirmed(true);
            await refreshPendingCount();
            if (result === 'queued') {
                Alert.alert('Saved offline', 'No internet detected. Order saved locally and will sync automatically.');
            }
        } catch (e) {
            Alert.alert('Error', 'Failed to save order. Please try again.');
        } finally {
            setConfirming(false);
        }
    };

    const handleOpenManualOrder = (item: Product) => {
        setManualOrderProduct(item);
        setManualPrice(String(item.price));
        setManualQuantity(1);
        setManualConfirmed(false);
        setManualConfirming(false);
    };

    const handleManualConfirm = async () => {
        if (!manualOrderProduct || manualConfirming) return;
        const price = parseFloat(manualPrice);
        if (!price || price <= 0) return;
        setManualConfirming(true);
        try {
            const order = buildOrder(manualOrderProduct, manualQuantity, price, 'manual');
            const result = await saveOrder(order);
            setManualConfirmed(true);
            await refreshPendingCount();
            if (result === 'queued') {
                Alert.alert('Saved offline', 'No internet detected. Order saved locally and will sync automatically.');
            }
        } catch (e) {
            Alert.alert('Error', 'Failed to save order. Please try again.');
        } finally {
            setManualConfirming(false);
        }
    };

    const resetManualOrder = () => {
        setManualOrderProduct(null);
        setManualPrice('');
        setManualQuantity(1);
        setManualConfirmed(false);
        setManualConfirming(false);
    };

    const openReceipt = (order: OrderHistoryItem) => {
        setSelectedOrder(order);
        setReceiptVisible(true);
    };

    const closeReceipt = () => {
        setReceiptVisible(false);
        setTimeout(() => setSelectedOrder(null), 300);
    };

    const manualTotal = parseFloat(manualPrice || '0') * manualQuantity;
    const scanLineTranslate = scanLineAnim.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 176],
    });
    const total = scannedProduct ? scannedProduct.price * quantity : 0;

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

                        <View style={styles.sectionRow}>
                            <Text style={styles.sectionTitle}>
                                {searchOpen && searchQuery.trim()
                                    ? <>{filteredProducts.length} <Text style={styles.subTitle}>results</Text></>
                                    : <>Available <Text style={styles.subTitle}>dishes</Text></>}
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
                                <Text style={styles.emptyText}>No dishes found</Text>
                            </View>
                        ) : viewMode === 'card' ? (
                            <View style={styles.grid}>
                                {filteredProducts.map((item) => (
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
                                {filteredProducts.map((item) => (
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
                    </ScrollView>

                    <View style={[styles.fabWrap, { bottom: insets.bottom + 20 }]}>
                        <TouchableOpacity style={styles.fab} onPress={handleOpenScanner} activeOpacity={0.85}>
                            <Ionicons name="qr-code-outline" size={28} color="#18181b" />
                        </TouchableOpacity>
                    </View>
                </Animated.View>

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
                                                            order.source === 'qr_scan' ? styles.orderIconQR : styles.orderIconManual,
                                                        ]}
                                                    >
                                                        <Ionicons
                                                            name={order.source === 'qr_scan' ? 'qr-code-outline' : 'pencil-outline'}
                                                            size={15}
                                                            color={order.source === 'qr_scan' ? '#18181b' : '#6b7280'}
                                                        />
                                                    </View>
                                                    <View style={styles.orderCardInfo}>
                                                        <Text style={styles.orderName} numberOfLines={1}>
                                                            {order.product_name}
                                                        </Text>
                                                        <Text style={styles.orderMeta}>
                                                            {order.quantity}× · {formatTime(order.created_at)}
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

            <Modal
                visible={!!manualOrderProduct}
                animationType="slide"
                transparent
                onRequestClose={resetManualOrder}
            >
                <View style={styles.manualOverlay}>
                    <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={resetManualOrder} activeOpacity={1} />
                    <View style={[styles.manualSheet, { paddingBottom: insets.bottom + 16 }]}>
                        <View style={styles.sheetHandle} />
                        {!manualConfirmed && manualOrderProduct && (
                            <>
                                <View style={styles.productHeader}>
                                    {manualOrderProduct.image_url && manualOrderProduct.image_url.trim() !== '' ? (
                                        <Image source={{ uri: manualOrderProduct.image_url }} style={styles.resultImg} />
                                    ) : (
                                        <View style={styles.resultImgPlaceholder}>
                                            <Ionicons name="restaurant-outline" size={28} color="#c4b5a0" />
                                        </View>
                                    )}
                                    <View style={styles.productHeaderText}>
                                        <Text style={styles.resultName} numberOfLines={2}>{manualOrderProduct.name}</Text>
                                        <Text style={styles.resultCategory}>{manualOrderProduct.category}</Text>
                                    </View>
                                </View>
                                <Text style={styles.manualPriceLabel}>Enter price (₱)</Text>
                                <View style={styles.priceInputWrap}>
                                    <Text style={styles.pesoSign}>₱</Text>
                                    <TextInput
                                        style={styles.priceInput}
                                        value={manualPrice}
                                        onChangeText={(v) => setManualPrice(v.replace(/[^0-9.]/g, ''))}
                                        keyboardType="decimal-pad"
                                        placeholder={String(manualOrderProduct.price)}
                                        placeholderTextColor="#a1a1aa"
                                        returnKeyType="done"
                                    />
                                </View>
                                <View style={styles.defaultPriceRow}>
                                    <Text style={styles.defaultPriceHint}>Default price:</Text>
                                    <TouchableOpacity onPress={() => setManualPrice(String(manualOrderProduct.price))}>
                                        <Text style={styles.defaultPriceValue}>
                                            ₱ {Number(manualOrderProduct.price).toLocaleString(undefined, { minimumFractionDigits: 2 })} (tap to reset)
                                        </Text>
                                    </TouchableOpacity>
                                </View>
                                <View style={styles.divider} />
                                <View style={styles.qtyRow}>
                                    <Text style={styles.qtyLabel}>Quantity</Text>
                                    <View style={styles.stepper}>
                                        <TouchableOpacity
                                            style={[styles.stepBtn, manualQuantity <= 1 && styles.stepBtnDisabled]}
                                            onPress={() => setManualQuantity((q) => Math.max(1, q - 1))}
                                            activeOpacity={0.7}
                                        >
                                            <Ionicons name="remove" size={18} color={manualQuantity <= 1 ? '#d4d4d8' : '#18181b'} />
                                        </TouchableOpacity>
                                        <Text style={styles.qtyValue}>{manualQuantity}</Text>
                                        <TouchableOpacity
                                            style={styles.stepBtn}
                                            onPress={() => setManualQuantity((q) => q + 1)}
                                            activeOpacity={0.7}
                                        >
                                            <Ionicons name="add" size={18} color="#18181b" />
                                        </TouchableOpacity>
                                    </View>
                                </View>
                                <View style={styles.totalRow}>
                                    <Text style={styles.totalLabel}>Total</Text>
                                    <Text style={styles.totalValue}>
                                        ₱ {manualTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </Text>
                                </View>
                                <View style={styles.actionRow}>
                                    <TouchableOpacity style={styles.rescanBtn} onPress={resetManualOrder} activeOpacity={0.7}>
                                        <Ionicons name="close" size={15} color="#71717a" />
                                        <Text style={styles.rescanText}>Cancel</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[
                                            styles.confirmBtn,
                                            (!manualPrice || parseFloat(manualPrice) <= 0 || manualConfirming) && styles.confirmBtnDisabled,
                                        ]}
                                        onPress={handleManualConfirm}
                                        activeOpacity={0.85}
                                        disabled={!manualPrice || parseFloat(manualPrice) <= 0 || manualConfirming}
                                    >
                                        {manualConfirming ? (
                                            <ActivityIndicator size="small" color="#18181b" />
                                        ) : (
                                            <>
                                                <Ionicons name="checkmark" size={17} color="#18181b" />
                                                <Text style={styles.confirmText}>Confirm Order</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            </>
                        )}
                        {manualConfirmed && manualOrderProduct && (
                            <View style={styles.resultInner}>
                                <Ionicons name="checkmark-circle" size={52} color="#4ade80" />
                                <Text style={styles.confirmedTitle}>Order Added!</Text>
                                <Text style={styles.confirmedSub}>{manualQuantity}× {manualOrderProduct.name}</Text>
                                <Text style={styles.confirmedTotal}>
                                    ₱ {manualTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </Text>
                                <View style={styles.actionRow}>
                                    <TouchableOpacity style={styles.rescanBtn} onPress={resetManualOrder} activeOpacity={0.7}>
                                        <Ionicons name="arrow-back" size={15} color="#71717a" />
                                        <Text style={styles.rescanText}>Back to Menu</Text>
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}
                    </View>
                </View>
            </Modal>

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
                                    The scanned code doesn't match any dish in the menu.
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
                                        <View style={styles.resultImgPlaceholder}>
                                            <Ionicons name="restaurant-outline" size={28} color="#c4b5a0" />
                                        </View>
                                    )}
                                    <View style={styles.productHeaderText}>
                                        <Text style={styles.resultName} numberOfLines={2}>{scannedProduct.name}</Text>
                                        <Text style={styles.resultCategory}>{scannedProduct.category}</Text>
                                    </View>
                                </View>
                                <View style={styles.priceRow}>
                                    <Text style={styles.priceLabel}>Price / serving</Text>
                                    <Text style={styles.priceValue}>
                                        ₱ {Number(scannedProduct.price).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </Text>
                                </View>
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
                                            style={styles.stepBtn}
                                            onPress={() => setQuantity((q) => q + 1)}
                                            activeOpacity={0.7}
                                        >
                                            <Ionicons name="add" size={18} color="#18181b" />
                                        </TouchableOpacity>
                                    </View>
                                </View>
                                <View style={styles.totalRow}>
                                    <Text style={styles.totalLabel}>Total</Text>
                                    <Text style={styles.totalValue}>
                                        ₱ {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                    </Text>
                                </View>
                                <View style={styles.actionRow}>
                                    <TouchableOpacity style={styles.rescanBtn} onPress={resetScanner} activeOpacity={0.7}>
                                        <Ionicons name="refresh" size={15} color="#71717a" />
                                        <Text style={styles.rescanText}>Rescan</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        style={[styles.confirmBtn, confirming && styles.confirmBtnDisabled]}
                                        onPress={handleConfirm}
                                        activeOpacity={0.85}
                                        disabled={confirming}
                                    >
                                        {confirming ? (
                                            <ActivityIndicator size="small" color="#18181b" />
                                        ) : (
                                            <>
                                                <Ionicons name="checkmark" size={17} color="#18181b" />
                                                <Text style={styles.confirmText}>Confirm Order</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            </View>
                        )}
                        {confirmed && scannedProduct && (
                            <View style={styles.resultInner}>
                                <Ionicons name="checkmark-circle" size={52} color="#4ade80" />
                                <Text style={styles.confirmedTitle}>Order Added!</Text>
                                <Text style={styles.confirmedSub}>{quantity}× {scannedProduct.name}</Text>
                                <Text style={styles.confirmedTotal}>
                                    ₱ {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
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