import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Layout,
  Card,
  Row,
  Col,
  Typography,
  Space,
  Button,
  Table,
  Tag,
  Input,
  Modal,
  Form,
  Select,
  Breadcrumb,
  message,
  Tabs,
  Tooltip,
  Statistic,
  Empty,
  Spin,
  Popconfirm,
  AutoComplete,
  Divider,
  Upload,
  Alert,
} from 'antd';
import {
  HomeOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  SearchOutlined,
  ReloadOutlined,
  StockOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
  StarOutlined,
  StarFilled,
  LoadingOutlined,
  LineChartOutlined,
  CloseOutlined,
  UploadOutlined,
  FileExcelOutlined,
  CopyOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { Link } from 'react-router-dom';
import * as XLSX from 'xlsx';
import {
  searchStocks,
  fetchQuote,
  getStockInfo,
  NSE_BSE_STOCKS,
  formatCurrency,
  formatNumber,
  formatPercent,
  type StockSearchResult,
} from './stockData';

const { Text, Title } = Typography;
const { Content } = Layout;
const { Option } = Select;

const REDWOOD = {
  primary: '#C74634',
  primaryLight: '#E85D4A',
  success: '#1D7B4D',
  warning: '#D4A800',
  info: '#0572CE',
  error: '#D93025',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral300: '#C7C7C7',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface: '#FFFFFF',
};

// ============ TYPES ============

interface WatchlistStock {
  key: string;
  symbol: string;
  name: string;
  currentPrice: number;
  previousClose: number;
  addedPrice: number;
  addedDate: string;
  dayChange: number;
  dayChangePercent: number;
  sinceAddedChange: number;
  sinceAddedChangePercent: number;
  high52w: number;
  low52w: number;
  volume: number;
  marketCap: string;
  sector: string;
  exchange: string;
  currency: string;
  isFavorite: boolean;
}

interface Watchlist {
  id: string;
  name: string;
  description: string;
  createdDate: string;
  stocks: WatchlistStock[];
}

// ============ LOCAL STORAGE HELPERS ============

const STORAGE_KEY = 'pms_watchlists';

const loadWatchlists = (): Watchlist[] => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

const saveWatchlists = (watchlists: Watchlist[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(watchlists));
};

// ============ COMPONENT ============

const Watchlist: React.FC = () => {
  const [watchlists, setWatchlists] = useState<Watchlist[]>(loadWatchlists);
  const [activeWatchlistId, setActiveWatchlistId] = useState<string>('');
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [addStockModalVisible, setAddStockModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StockSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedStocks, setSelectedStocks] = useState<React.Key[]>([]);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importMode, setImportMode] = useState<'paste' | 'excel'>('paste');
  const [pasteText, setPasteText] = useState('');
  const [importPreview, setImportPreview] = useState<{ symbol: string; name: string; exchange: string; status: string }[]>([]);
  const [importLoading, setImportLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Set active watchlist on first load
  useEffect(() => {
    if (watchlists.length > 0 && !activeWatchlistId) {
      setActiveWatchlistId(watchlists[0].id);
    }
  }, [watchlists, activeWatchlistId]);

  // Persist watchlists to localStorage
  useEffect(() => {
    saveWatchlists(watchlists);
  }, [watchlists]);

  const activeWatchlist = useMemo(
    () => watchlists.find((w) => w.id === activeWatchlistId) || null,
    [watchlists, activeWatchlistId]
  );

  // Watchlist summary stats
  const watchlistStats = useMemo(() => {
    if (!activeWatchlist) return { gainers: 0, losers: 0, totalChange: 0 };
    const gainers = activeWatchlist.stocks.filter((s) => s.sinceAddedChangePercent > 0).length;
    const losers = activeWatchlist.stocks.filter((s) => s.sinceAddedChangePercent < 0).length;
    const totalChange = activeWatchlist.stocks.length > 0
      ? activeWatchlist.stocks.reduce((sum, s) => sum + s.sinceAddedChangePercent, 0) / activeWatchlist.stocks.length
      : 0;
    return { gainers, losers, totalChange };
  }, [activeWatchlist]);

  // ---- Create Watchlist ----
  const handleCreateWatchlist = () => {
    form.validateFields().then((values) => {
      const newWatchlist: Watchlist = {
        id: `wl-${Date.now()}`,
        name: values.name,
        description: values.description || '',
        createdDate: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
        stocks: [],
      };
      setWatchlists((prev) => [...prev, newWatchlist]);
      setActiveWatchlistId(newWatchlist.id);
      setCreateModalVisible(false);
      form.resetFields();
      message.success(`Watchlist "${values.name}" created`);
    });
  };

  // ---- Edit Watchlist ----
  const handleEditWatchlist = () => {
    editForm.validateFields().then((values) => {
      setWatchlists((prev) =>
        prev.map((w) =>
          w.id === activeWatchlistId ? { ...w, name: values.name, description: values.description || '' } : w
        )
      );
      setEditModalVisible(false);
      message.success('Watchlist updated');
    });
  };

  // ---- Delete Watchlist ----
  const handleDeleteWatchlist = (id: string) => {
    setWatchlists((prev) => prev.filter((w) => w.id !== id));
    if (activeWatchlistId === id) {
      const remaining = watchlists.filter((w) => w.id !== id);
      setActiveWatchlistId(remaining.length > 0 ? remaining[0].id : '');
    }
    message.success('Watchlist deleted');
  };

  // ---- Search Stocks ----
  const handleSearch = useCallback(async (value: string) => {
    setSearchQuery(value);
    if (!value || value.length < 1) {
      setSearchResults([]);
      return;
    }
    setSearchLoading(true);
    try {
      const results = await searchStocks(value);
      setSearchResults(results);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  // ---- Add Stock to Watchlist ----
  const handleAddStock = async (stock: StockSearchResult) => {
    if (!activeWatchlist) return;

    // Check if already in watchlist
    if (activeWatchlist.stocks.some((s) => s.symbol === stock.symbol)) {
      message.warning(`${stock.symbol} is already in this watchlist`);
      return;
    }

    message.loading({ content: `Fetching quote for ${stock.symbol}...`, key: 'addStock' });

    // Fetch current quote
    const stockInfo = getStockInfo(stock.symbol);
    const quote = await fetchQuote(stock.symbol);
    const price = quote?.price || 0;
    const currency = stockInfo?.currency || stock.currency || 'INR';
    const now = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    const newStock: WatchlistStock = {
      key: `${stock.symbol}-${Date.now()}`,
      symbol: stock.symbol,
      name: stockInfo?.name || stock.name,
      currentPrice: price,
      previousClose: quote?.previousClose || price,
      addedPrice: price,
      addedDate: now,
      dayChange: quote?.change || 0,
      dayChangePercent: quote?.changePercent || 0,
      sinceAddedChange: 0,
      sinceAddedChangePercent: 0,
      high52w: quote?.high || 0,
      low52w: quote?.low || 0,
      volume: quote?.volume || 0,
      marketCap: '',
      sector: stockInfo?.sector || '',
      exchange: stockInfo?.exchange || stock.exchange,
      currency,
      isFavorite: false,
    };

    setWatchlists((prev) =>
      prev.map((w) =>
        w.id === activeWatchlistId ? { ...w, stocks: [...w.stocks, newStock] } : w
      )
    );
    setAddStockModalVisible(false);
    setSearchQuery('');
    setSearchResults([]);
    message.success({ content: `${stock.symbol} added to watchlist at ${formatCurrency(price, currency)}`, key: 'addStock' });
  };

  // ---- Remove Stocks ----
  const handleRemoveStocks = () => {
    if (!activeWatchlist || selectedStocks.length === 0) return;
    setWatchlists((prev) =>
      prev.map((w) =>
        w.id === activeWatchlistId
          ? { ...w, stocks: w.stocks.filter((s) => !selectedStocks.includes(s.key)) }
          : w
      )
    );
    setSelectedStocks([]);
    message.success(`${selectedStocks.length} stock(s) removed`);
  };

  // ---- Toggle Favorite ----
  const toggleFavorite = (stockKey: string) => {
    setWatchlists((prev) =>
      prev.map((w) =>
        w.id === activeWatchlistId
          ? {
              ...w,
              stocks: w.stocks.map((s) =>
                s.key === stockKey ? { ...s, isFavorite: !s.isFavorite } : s
              ),
            }
          : w
      )
    );
  };

  // ---- Refresh Prices ----
  const handleRefreshPrices = async () => {
    if (!activeWatchlist || activeWatchlist.stocks.length === 0) return;
    setRefreshing(true);
    message.loading({ content: 'Refreshing stock prices...', key: 'refresh' });

    try {
      const updatedStocks = await Promise.all(
        activeWatchlist.stocks.map(async (stock) => {
          const quote = await fetchQuote(stock.symbol);
          if (quote) {
            const sinceAddedChange = quote.price - stock.addedPrice;
            const sinceAddedChangePercent = stock.addedPrice > 0
              ? ((quote.price - stock.addedPrice) / stock.addedPrice) * 100
              : 0;
            return {
              ...stock,
              currentPrice: quote.price,
              previousClose: quote.previousClose,
              dayChange: quote.change,
              dayChangePercent: quote.changePercent,
              sinceAddedChange,
              sinceAddedChangePercent,
              volume: quote.volume,
            };
          }
          return stock;
        })
      );

      setWatchlists((prev) =>
        prev.map((w) =>
          w.id === activeWatchlistId ? { ...w, stocks: updatedStocks } : w
        )
      );
      message.success({ content: 'Prices refreshed', key: 'refresh' });
    } catch (error) {
      message.error({ content: 'Failed to refresh some prices', key: 'refresh' });
    } finally {
      setRefreshing(false);
    }
  };

  // ---- Parse paste/excel data for import ----
  const parsePasteData = (text: string): { symbol: string; name: string; exchange: string; status: string }[] => {
    if (!text.trim()) return [];
    const lines = text.trim().split('\n').filter((l) => l.trim());
    const results: { symbol: string; name: string; exchange: string; status: string }[] = [];
    for (const line of lines) {
      // Support formats: "SYMBOL" or "SYMBOL,Name" or "SYMBOL\tName" or just "SYMBOL"
      const parts = line.split(/[,\t]+/).map((p) => p.trim());
      const symbol = parts[0]?.toUpperCase().replace(/[^A-Z0-9&-]/g, '');
      if (!symbol) continue;
      const stockInfo = getStockInfo(symbol);
      const existing = activeWatchlist?.stocks.some((s) => s.symbol === symbol);
      results.push({
        symbol,
        name: stockInfo?.name || parts[1] || '',
        exchange: stockInfo?.exchange || 'NSE/BSE',
        status: existing ? 'Duplicate' : stockInfo ? 'Found' : 'Unknown',
      });
    }
    return results;
  };

  const handlePastePreview = () => {
    const preview = parsePasteData(pasteText);
    setImportPreview(preview);
  };

  const handleExcelUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

        // Find the symbol column (first column or column named "Symbol")
        const symbols: string[] = [];
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i] as any[];
          if (!row || row.length === 0) continue;
          // Skip header row if it contains "symbol" text
          if (i === 0 && typeof row[0] === 'string' && row[0].toLowerCase().includes('symbol')) continue;
          const sym = String(row[0] || '').toUpperCase().replace(/[^A-Z0-9&-]/g, '');
          if (sym && sym.length >= 1 && sym.length <= 20) {
            symbols.push(sym);
          }
        }

        const text = symbols.join('\n');
        setPasteText(text);
        const preview = parsePasteData(text);
        setImportPreview(preview);
        message.success(`Parsed ${symbols.length} symbols from Excel`);
      } catch (err) {
        message.error('Failed to parse Excel file');
        console.error(err);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleBulkImport = async () => {
    if (!activeWatchlist || importPreview.length === 0) return;
    const toAdd = importPreview.filter((p) => p.status !== 'Duplicate');
    if (toAdd.length === 0) {
      message.warning('All stocks are already in this watchlist');
      return;
    }

    setImportLoading(true);
    message.loading({ content: `Adding ${toAdd.length} stocks...`, key: 'bulkImport' });
    const now = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

    const newStocks: WatchlistStock[] = [];
    for (const item of toAdd) {
      const stockInfo = getStockInfo(item.symbol);
      const quote = await fetchQuote(item.symbol);
      const price = quote?.price || 0;

      newStocks.push({
        key: `${item.symbol}-${Date.now()}-${Math.random()}`,
        symbol: item.symbol,
        name: item.name || stockInfo?.name || item.symbol,
        currentPrice: price,
        previousClose: quote?.previousClose || price,
        addedPrice: price,
        addedDate: now,
        dayChange: quote?.change || 0,
        dayChangePercent: quote?.changePercent || 0,
        sinceAddedChange: 0,
        sinceAddedChangePercent: 0,
        high52w: quote?.high || 0,
        low52w: quote?.low || 0,
        volume: quote?.volume || 0,
        marketCap: '',
        sector: stockInfo?.sector || '',
        exchange: stockInfo?.exchange || item.exchange || 'NSE/BSE',
        currency: stockInfo?.currency || 'INR',
        isFavorite: false,
      });
    }

    setWatchlists((prev) =>
      prev.map((w) =>
        w.id === activeWatchlistId ? { ...w, stocks: [...w.stocks, ...newStocks] } : w
      )
    );

    setImportModalVisible(false);
    setImportPreview([]);
    setPasteText('');
    setImportLoading(false);
    message.success({ content: `${newStocks.length} stocks added to watchlist`, key: 'bulkImport' });
  };

  // ---- Table Columns ----
  const columns: ColumnsType<WatchlistStock> = [
    {
      title: '',
      dataIndex: 'isFavorite',
      key: 'favorite',
      width: 40,
      render: (isFav: boolean, record) => (
        <span onClick={(e) => { e.stopPropagation(); toggleFavorite(record.key); }} style={{ cursor: 'pointer' }}>
          {isFav ? <StarFilled style={{ color: REDWOOD.warning, fontSize: 16 }} /> : <StarOutlined style={{ color: REDWOOD.neutral300, fontSize: 16 }} />}
        </span>
      ),
    },
    {
      title: 'Symbol',
      dataIndex: 'symbol',
      key: 'symbol',
      width: 100,
      sorter: (a, b) => a.symbol.localeCompare(b.symbol),
      render: (symbol: string) => (
        <Text strong style={{ fontSize: 13, color: REDWOOD.info }}>{symbol}</Text>
      ),
    },
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
      width: 200,
      render: (name: string) => <Text style={{ fontSize: 12 }}>{name}</Text>,
    },
    {
      title: 'Current Price',
      dataIndex: 'currentPrice',
      key: 'currentPrice',
      width: 120,
      align: 'right',
      sorter: (a, b) => a.currentPrice - b.currentPrice,
      render: (price: number, record) => (
        <Text strong style={{ fontSize: 13 }}>{formatCurrency(price, record.currency)}</Text>
      ),
    },
    {
      title: 'Day Change',
      dataIndex: 'dayChange',
      key: 'dayChange',
      width: 130,
      align: 'right',
      sorter: (a, b) => a.dayChangePercent - b.dayChangePercent,
      render: (_: number, record) => (
        <Space size={4}>
          {record.dayChangePercent >= 0 ? (
            <ArrowUpOutlined style={{ color: REDWOOD.success, fontSize: 11 }} />
          ) : (
            <ArrowDownOutlined style={{ color: REDWOOD.error, fontSize: 11 }} />
          )}
          <Text style={{
            fontSize: 12,
            color: record.dayChangePercent >= 0 ? REDWOOD.success : REDWOOD.error,
            fontWeight: 600,
          }}>
            {formatPercent(record.dayChangePercent)}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Added Price',
      dataIndex: 'addedPrice',
      key: 'addedPrice',
      width: 120,
      align: 'right',
      render: (price: number, record) => (
        <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>{formatCurrency(price, record.currency)}</Text>
      ),
    },
    {
      title: 'Since Added',
      dataIndex: 'sinceAddedChangePercent',
      key: 'sinceAdded',
      width: 140,
      align: 'right',
      sorter: (a, b) => a.sinceAddedChangePercent - b.sinceAddedChangePercent,
      render: (_: number, record) => {
        const pct = record.sinceAddedChangePercent;
        const isUp = pct >= 0;
        return (
          <Tag
            color={isUp ? 'green' : 'red'}
            style={{ fontSize: 12, fontWeight: 700, padding: '2px 10px' }}
          >
            {isUp ? <ArrowUpOutlined style={{ fontSize: 10, marginRight: 4 }} /> : <ArrowDownOutlined style={{ fontSize: 10, marginRight: 4 }} />}
            {formatPercent(pct)}
          </Tag>
        );
      },
    },
    {
      title: 'Added Date',
      dataIndex: 'addedDate',
      key: 'addedDate',
      width: 110,
      render: (date: string) => <Text style={{ fontSize: 12, color: REDWOOD.neutral600 }}>{date}</Text>,
    },
    {
      title: 'Volume',
      dataIndex: 'volume',
      key: 'volume',
      width: 110,
      align: 'right',
      render: (vol: number) => <Text style={{ fontSize: 12 }}>{formatNumber(vol)}</Text>,
    },
    {
      title: 'Exchange',
      dataIndex: 'exchange',
      key: 'exchange',
      width: 100,
      render: (ex: string) => <Tag style={{ fontSize: 10 }}>{ex}</Tag>,
    },
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb */}
        <div style={{
          padding: '12px 24px',
          background: REDWOOD.surface,
          borderBottom: `1px solid ${REDWOOD.neutral200}`,
        }}>
          <Breadcrumb
            items={[
              { title: <Link to="/home"><HomeOutlined /> Home</Link> },
              { title: <Link to="/pms">Portfolio Management</Link> },
              { title: 'Watchlist' },
            ]}
          />
        </div>

        <div style={{ padding: '24px' }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Space align="center" size={12}>
              <div style={{
                background: `${REDWOOD.info}15`,
                borderRadius: 12,
                padding: 10,
              }}>
                <EyeOutlined style={{ fontSize: 24, color: REDWOOD.info }} />
              </div>
              <div>
                <Title level={4} style={{ margin: 0 }}>Watchlists</Title>
                <Text type="secondary">Track stocks and monitor price changes</Text>
              </div>
            </Space>
            <Space>
              <Button
                icon={<PlusOutlined />}
                type="primary"
                onClick={() => setCreateModalVisible(true)}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
              >
                New Watchlist
              </Button>
            </Space>
          </div>

          {/* Watchlist Tabs */}
          {watchlists.length === 0 ? (
            <Card style={{ borderRadius: 12, textAlign: 'center', padding: 60 }}>
              <Empty
                image={<StockOutlined style={{ fontSize: 64, color: REDWOOD.neutral300 }} />}
                description={
                  <div>
                    <Text style={{ fontSize: 16, display: 'block', marginBottom: 8 }}>No Watchlists Yet</Text>
                    <Text type="secondary">Create your first watchlist to start tracking stocks</Text>
                  </div>
                }
              >
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setCreateModalVisible(true)}
                  style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary, marginTop: 16 }}
                >
                  Create Watchlist
                </Button>
              </Empty>
            </Card>
          ) : (
            <Card
              style={{ borderRadius: 12, border: `1px solid ${REDWOOD.neutral200}` }}
              bodyStyle={{ padding: 0 }}
            >
              <Tabs
                activeKey={activeWatchlistId}
                onChange={setActiveWatchlistId}
                type="card"
                style={{ marginBottom: 0 }}
                tabBarStyle={{ margin: 0, padding: '8px 16px 0' }}
                tabBarExtraContent={
                  activeWatchlist && (
                    <Space style={{ marginRight: 16 }}>
                      <Button
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => { setSearchQuery(''); setSearchResults([]); setAddStockModalVisible(true); }}
                        type="primary"
                        style={{ background: REDWOOD.info, borderColor: REDWOOD.info, fontSize: 12 }}
                      >
                        Add Stock
                      </Button>
                      <Button
                        size="small"
                        icon={<UploadOutlined />}
                        onClick={() => { setPasteText(''); setImportPreview([]); setImportModalVisible(true); }}
                        style={{ fontSize: 12, borderColor: REDWOOD.warning, color: REDWOOD.warning }}
                      >
                        Import / Paste
                      </Button>
                      <Button
                        size="small"
                        icon={<ReloadOutlined spin={refreshing} />}
                        onClick={handleRefreshPrices}
                        loading={refreshing}
                        style={{ fontSize: 12 }}
                      >
                        Refresh Prices
                      </Button>
                      <Button
                        size="small"
                        icon={<DeleteOutlined />}
                        danger
                        onClick={handleRemoveStocks}
                        disabled={selectedStocks.length === 0}
                        style={{ fontSize: 12 }}
                      >
                        Remove ({selectedStocks.length})
                      </Button>
                      <Tooltip title="Edit watchlist">
                        <Button
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => {
                            editForm.setFieldsValue({ name: activeWatchlist.name, description: activeWatchlist.description });
                            setEditModalVisible(true);
                          }}
                        />
                      </Tooltip>
                      <Popconfirm
                        title="Delete this watchlist?"
                        onConfirm={() => handleDeleteWatchlist(activeWatchlistId)}
                        okText="Delete"
                        okButtonProps={{ danger: true }}
                      >
                        <Tooltip title="Delete watchlist">
                          <Button size="small" icon={<DeleteOutlined />} danger />
                        </Tooltip>
                      </Popconfirm>
                    </Space>
                  )
                }
                items={watchlists.map((wl) => ({
                  key: wl.id,
                  label: (
                    <Space size={4}>
                      <LineChartOutlined />
                      <span>{wl.name}</span>
                      <Tag style={{ fontSize: 10, marginLeft: 4 }}>{wl.stocks.length}</Tag>
                    </Space>
                  ),
                }))}
              />

              {/* Summary Stats */}
              {activeWatchlist && activeWatchlist.stocks.length > 0 && (
                <div style={{ padding: '12px 20px', background: REDWOOD.neutral100, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
                  <Row gutter={24}>
                    <Col>
                      <Statistic
                        title={<Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Stocks</Text>}
                        value={activeWatchlist.stocks.length}
                        valueStyle={{ fontSize: 18, fontWeight: 700 }}
                      />
                    </Col>
                    <Col>
                      <Statistic
                        title={<Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Gainers</Text>}
                        value={watchlistStats.gainers}
                        valueStyle={{ fontSize: 18, fontWeight: 700, color: REDWOOD.success }}
                        prefix={<ArrowUpOutlined style={{ fontSize: 13 }} />}
                      />
                    </Col>
                    <Col>
                      <Statistic
                        title={<Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Losers</Text>}
                        value={watchlistStats.losers}
                        valueStyle={{ fontSize: 18, fontWeight: 700, color: REDWOOD.error }}
                        prefix={<ArrowDownOutlined style={{ fontSize: 13 }} />}
                      />
                    </Col>
                    <Col>
                      <Statistic
                        title={<Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>Avg Change</Text>}
                        value={watchlistStats.totalChange}
                        precision={2}
                        suffix="%"
                        valueStyle={{
                          fontSize: 18,
                          fontWeight: 700,
                          color: watchlistStats.totalChange >= 0 ? REDWOOD.success : REDWOOD.error,
                        }}
                        prefix={watchlistStats.totalChange >= 0 ? <ArrowUpOutlined style={{ fontSize: 13 }} /> : <ArrowDownOutlined style={{ fontSize: 13 }} />}
                      />
                    </Col>
                  </Row>
                </div>
              )}

              {/* Stock Table */}
              <div style={{ padding: '0' }}>
                <Table
                  columns={columns}
                  dataSource={activeWatchlist?.stocks || []}
                  size="small"
                  pagination={false}
                  scroll={{ x: 1200 }}
                  rowSelection={{
                    selectedRowKeys: selectedStocks,
                    onChange: setSelectedStocks,
                  }}
                  locale={{
                    emptyText: (
                      <div style={{ padding: 40 }}>
                        <StockOutlined style={{ fontSize: 40, color: REDWOOD.neutral300, display: 'block', marginBottom: 12 }} />
                        <Text type="secondary">No stocks in this watchlist yet. Click "Add Stock" to get started.</Text>
                      </div>
                    ),
                  }}
                />
              </div>
            </Card>
          )}
        </div>

        {/* ============ CREATE WATCHLIST MODAL ============ */}
        <Modal
          title="Create New Watchlist"
          open={createModalVisible}
          onOk={handleCreateWatchlist}
          onCancel={() => { setCreateModalVisible(false); form.resetFields(); }}
          okText="Create"
          okButtonProps={{ style: { background: REDWOOD.primary, borderColor: REDWOOD.primary } }}
        >
          <Form form={form} layout="vertical">
            <Form.Item name="name" label="Watchlist Name" rules={[{ required: true, message: 'Enter a name' }]}>
              <Input placeholder="e.g. Tech Stocks, Blue Chips, Dividend Picks" />
            </Form.Item>
            <Form.Item name="description" label="Description">
              <Input.TextArea placeholder="Optional description" rows={2} />
            </Form.Item>
          </Form>
        </Modal>

        {/* ============ EDIT WATCHLIST MODAL ============ */}
        <Modal
          title="Edit Watchlist"
          open={editModalVisible}
          onOk={handleEditWatchlist}
          onCancel={() => setEditModalVisible(false)}
          okText="Save"
          okButtonProps={{ style: { background: REDWOOD.primary, borderColor: REDWOOD.primary } }}
        >
          <Form form={editForm} layout="vertical">
            <Form.Item name="name" label="Watchlist Name" rules={[{ required: true, message: 'Enter a name' }]}>
              <Input />
            </Form.Item>
            <Form.Item name="description" label="Description">
              <Input.TextArea rows={2} />
            </Form.Item>
          </Form>
        </Modal>

        {/* ============ ADD STOCK MODAL ============ */}
        <Modal
          title="Add Stock to Watchlist"
          open={addStockModalVisible}
          onCancel={() => { setAddStockModalVisible(false); setSearchQuery(''); setSearchResults([]); }}
          footer={null}
          width={600}
        >
          <div style={{ marginBottom: 16 }}>
            <Input.Search
              placeholder="Search NSE/BSE stocks (e.g. RELIANCE, TCS, INFY, HDFCBANK)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onSearch={handleSearch}
              enterButton
              loading={searchLoading}
              size="large"
            />
          </div>

          {searchLoading && (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
            </div>
          )}

          {!searchLoading && searchResults.length > 0 && (
            <div style={{ maxHeight: 400, overflowY: 'auto' }}>
              {searchResults.map((result) => (
                <Card
                  key={result.symbol}
                  hoverable
                  size="small"
                  style={{
                    marginBottom: 8,
                    borderRadius: 8,
                    cursor: 'pointer',
                    border: `1px solid ${REDWOOD.neutral200}`,
                  }}
                  bodyStyle={{ padding: '12px 16px' }}
                  onClick={() => handleAddStock(result)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <Text strong style={{ fontSize: 14, color: REDWOOD.info }}>{result.symbol}</Text>
                      <Text style={{ fontSize: 12, marginLeft: 12, color: REDWOOD.neutral900 }}>{result.name}</Text>
                    </div>
                    <Space>
                      <Tag style={{ fontSize: 10 }}>{result.exchange}</Tag>
                      <Tag style={{ fontSize: 10 }}>{result.currency}</Tag>
                      <PlusOutlined style={{ color: REDWOOD.success }} />
                    </Space>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {!searchLoading && searchResults.length === 0 && searchQuery && (
            <Empty description="No stocks found. Try a different search term." />
          )}
        </Modal>

        {/* ============ IMPORT / PASTE MODAL ============ */}
        <Modal
          title={<Space><UploadOutlined /> Import Stocks to Watchlist</Space>}
          open={importModalVisible}
          onCancel={() => { setImportModalVisible(false); setImportPreview([]); setPasteText(''); }}
          footer={
            <Space>
              <Button onClick={() => { setImportModalVisible(false); setImportPreview([]); setPasteText(''); }}>Cancel</Button>
              <Button
                type="primary"
                onClick={handleBulkImport}
                loading={importLoading}
                disabled={importPreview.filter((p) => p.status !== 'Duplicate').length === 0}
                style={{ background: REDWOOD.primary, borderColor: REDWOOD.primary }}
              >
                Add {importPreview.filter((p) => p.status !== 'Duplicate').length} Stock(s)
              </Button>
            </Space>
          }
          width={700}
        >
          <Tabs
            activeKey={importMode}
            onChange={(k) => { setImportMode(k as 'paste' | 'excel'); setImportPreview([]); setPasteText(''); }}
            items={[
              {
                key: 'paste',
                label: <Space size={4}><CopyOutlined /><span>Paste Data</span></Space>,
                children: (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                      Paste stock symbols (one per line, or comma-separated). Supports NSE/BSE symbols.
                    </Text>
                    <Input.TextArea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder={'RELIANCE\nTCS\nINFY\nHDFCBANK\nICICIBANK\nITC\nSBIN\nBHARTIARTL'}
                      rows={6}
                      style={{ fontFamily: 'monospace', fontSize: 13 }}
                    />
                    <Button
                      icon={<SearchOutlined />}
                      onClick={handlePastePreview}
                      style={{ marginTop: 8 }}
                      disabled={!pasteText.trim()}
                    >
                      Preview & Validate
                    </Button>
                  </div>
                ),
              },
              {
                key: 'excel',
                label: <Space size={4}><FileExcelOutlined /><span>Upload Excel</span></Space>,
                children: (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                      Upload an Excel (.xlsx / .xls) or CSV file with stock symbols in the first column.
                    </Text>
                    <Upload.Dragger
                      accept=".xlsx,.xls,.csv"
                      showUploadList={false}
                      beforeUpload={(file) => {
                        handleExcelUpload(file);
                        return false; // Prevent auto upload
                      }}
                      style={{ padding: '20px 0' }}
                    >
                      <p className="ant-upload-drag-icon">
                        <InboxOutlined style={{ color: REDWOOD.info, fontSize: 40 }} />
                      </p>
                      <p style={{ fontSize: 14, fontWeight: 500 }}>Click or drag file to this area</p>
                      <p style={{ fontSize: 12, color: REDWOOD.neutral600 }}>
                        Excel or CSV with stock symbols in the first column
                      </p>
                    </Upload.Dragger>
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginTop: 12, fontSize: 12 }}
                      message="Excel format: Column A should contain stock symbols (e.g. RELIANCE, TCS, INFY). Header row is auto-skipped."
                    />
                  </div>
                ),
              },
            ]}
          />

          {/* Preview Table */}
          {importPreview.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Divider style={{ margin: '8px 0' }} />
              <Text strong style={{ fontSize: 13 }}>
                Preview ({importPreview.length} symbols — {importPreview.filter((p) => p.status !== 'Duplicate').length} to add)
              </Text>
              <Table
                dataSource={importPreview}
                columns={[
                  { title: 'Symbol', dataIndex: 'symbol', key: 'symbol', width: 100, render: (v: string) => <Text strong style={{ color: REDWOOD.info }}>{v}</Text> },
                  { title: 'Name', dataIndex: 'name', key: 'name', ellipsis: true },
                  { title: 'Exchange', dataIndex: 'exchange', key: 'exchange', width: 100, render: (v: string) => <Tag style={{ fontSize: 10 }}>{v}</Tag> },
                  {
                    title: 'Status', dataIndex: 'status', key: 'status', width: 100,
                    render: (v: string) => (
                      <Tag color={v === 'Found' ? 'green' : v === 'Duplicate' ? 'orange' : 'default'} style={{ fontSize: 10 }}>
                        {v}
                      </Tag>
                    ),
                  },
                ]}
                rowKey="symbol"
                size="small"
                pagination={false}
                scroll={{ y: 200 }}
                style={{ marginTop: 8 }}
              />
            </div>
          )}
        </Modal>

        <style>{`
          .ant-table-thead > tr > th {
            background: ${REDWOOD.neutral100} !important;
            font-weight: 600;
            font-size: 11px;
            padding: 8px 12px !important;
            color: ${REDWOOD.neutral600};
          }
          .ant-table-tbody > tr > td {
            font-size: 12px;
            padding: 8px 12px !important;
          }
          .ant-table-tbody > tr:hover > td {
            background: #fef7f6 !important;
          }
        `}</style>
      </Content>
    </Layout>
  );
};

export default Watchlist;
