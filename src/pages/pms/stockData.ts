// ============================================================
// NSE / BSE Stock Master Data + API Helpers for PMS Module
// ============================================================

export interface StockInfo {
  symbol: string;
  name: string;
  exchange: 'NSE' | 'BSE' | 'NSE/BSE';
  sector: string;
  currency: string;
  isin?: string;
}

// Popular NSE/BSE Stocks - Nifty 50 + Nifty Next 50 + popular mid-caps
export const NSE_BSE_STOCKS: StockInfo[] = [
  // ---- NIFTY 50 ----
  { symbol: 'RELIANCE', name: 'Reliance Industries Ltd', exchange: 'NSE/BSE', sector: 'Energy', currency: 'INR' },
  { symbol: 'TCS', name: 'Tata Consultancy Services Ltd', exchange: 'NSE/BSE', sector: 'Technology', currency: 'INR' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'INFY', name: 'Infosys Ltd', exchange: 'NSE/BSE', sector: 'Technology', currency: 'INR' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank Ltd', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever Ltd', exchange: 'NSE/BSE', sector: 'Consumer', currency: 'INR' },
  { symbol: 'ITC', name: 'ITC Ltd', exchange: 'NSE/BSE', sector: 'Consumer', currency: 'INR' },
  { symbol: 'SBIN', name: 'State Bank of India', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel Ltd', exchange: 'NSE/BSE', sector: 'Telecom', currency: 'INR' },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank Ltd', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'LT', name: 'Larsen & Toubro Ltd', exchange: 'NSE/BSE', sector: 'Industrial', currency: 'INR' },
  { symbol: 'HCLTECH', name: 'HCL Technologies Ltd', exchange: 'NSE/BSE', sector: 'Technology', currency: 'INR' },
  { symbol: 'AXISBANK', name: 'Axis Bank Ltd', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'ASIANPAINT', name: 'Asian Paints Ltd', exchange: 'NSE/BSE', sector: 'Consumer', currency: 'INR' },
  { symbol: 'MARUTI', name: 'Maruti Suzuki India Ltd', exchange: 'NSE/BSE', sector: 'Automobile', currency: 'INR' },
  { symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical Industries Ltd', exchange: 'NSE/BSE', sector: 'Healthcare', currency: 'INR' },
  { symbol: 'TITAN', name: 'Titan Company Ltd', exchange: 'NSE/BSE', sector: 'Consumer', currency: 'INR' },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance Ltd', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'DMART', name: 'Avenue Supermarts Ltd (DMart)', exchange: 'NSE/BSE', sector: 'Consumer', currency: 'INR' },
  { symbol: 'WIPRO', name: 'Wipro Ltd', exchange: 'NSE/BSE', sector: 'Technology', currency: 'INR' },
  { symbol: 'ULTRACEMCO', name: 'UltraTech Cement Ltd', exchange: 'NSE/BSE', sector: 'Materials', currency: 'INR' },
  { symbol: 'ONGC', name: 'Oil & Natural Gas Corporation Ltd', exchange: 'NSE/BSE', sector: 'Energy', currency: 'INR' },
  { symbol: 'NTPC', name: 'NTPC Ltd', exchange: 'NSE/BSE', sector: 'Utilities', currency: 'INR' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors Ltd', exchange: 'NSE/BSE', sector: 'Automobile', currency: 'INR' },
  { symbol: 'POWERGRID', name: 'Power Grid Corporation of India Ltd', exchange: 'NSE/BSE', sector: 'Utilities', currency: 'INR' },
  { symbol: 'M&M', name: 'Mahindra & Mahindra Ltd', exchange: 'NSE/BSE', sector: 'Automobile', currency: 'INR' },
  { symbol: 'JSWSTEEL', name: 'JSW Steel Ltd', exchange: 'NSE/BSE', sector: 'Materials', currency: 'INR' },
  { symbol: 'TATASTEEL', name: 'Tata Steel Ltd', exchange: 'NSE/BSE', sector: 'Materials', currency: 'INR' },
  { symbol: 'ADANIENT', name: 'Adani Enterprises Ltd', exchange: 'NSE/BSE', sector: 'Industrial', currency: 'INR' },
  { symbol: 'ADANIPORTS', name: 'Adani Ports and SEZ Ltd', exchange: 'NSE/BSE', sector: 'Industrial', currency: 'INR' },
  { symbol: 'COALINDIA', name: 'Coal India Ltd', exchange: 'NSE/BSE', sector: 'Energy', currency: 'INR' },
  { symbol: 'BAJAJFINSV', name: 'Bajaj Finserv Ltd', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'TECHM', name: 'Tech Mahindra Ltd', exchange: 'NSE/BSE', sector: 'Technology', currency: 'INR' },
  { symbol: 'HDFCLIFE', name: 'HDFC Life Insurance Company Ltd', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'SBILIFE', name: 'SBI Life Insurance Company Ltd', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'NESTLEIND', name: 'Nestle India Ltd', exchange: 'NSE/BSE', sector: 'Consumer', currency: 'INR' },
  { symbol: 'GRASIM', name: 'Grasim Industries Ltd', exchange: 'NSE/BSE', sector: 'Materials', currency: 'INR' },
  { symbol: 'DIVISLAB', name: "Divi's Laboratories Ltd", exchange: 'NSE/BSE', sector: 'Healthcare', currency: 'INR' },
  { symbol: 'BRITANNIA', name: 'Britannia Industries Ltd', exchange: 'NSE/BSE', sector: 'Consumer', currency: 'INR' },
  { symbol: 'CIPLA', name: 'Cipla Ltd', exchange: 'NSE/BSE', sector: 'Healthcare', currency: 'INR' },
  { symbol: 'DRREDDY', name: "Dr. Reddy's Laboratories Ltd", exchange: 'NSE/BSE', sector: 'Healthcare', currency: 'INR' },
  { symbol: 'EICHERMOT', name: 'Eicher Motors Ltd', exchange: 'NSE/BSE', sector: 'Automobile', currency: 'INR' },
  { symbol: 'APOLLOHOSP', name: 'Apollo Hospitals Enterprise Ltd', exchange: 'NSE/BSE', sector: 'Healthcare', currency: 'INR' },
  { symbol: 'HEROMOTOCO', name: 'Hero MotoCorp Ltd', exchange: 'NSE/BSE', sector: 'Automobile', currency: 'INR' },
  { symbol: 'INDUSINDBK', name: 'IndusInd Bank Ltd', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'BPCL', name: 'Bharat Petroleum Corporation Ltd', exchange: 'NSE/BSE', sector: 'Energy', currency: 'INR' },
  { symbol: 'TATACONSUM', name: 'Tata Consumer Products Ltd', exchange: 'NSE/BSE', sector: 'Consumer', currency: 'INR' },
  { symbol: 'BAJAJ-AUTO', name: 'Bajaj Auto Ltd', exchange: 'NSE/BSE', sector: 'Automobile', currency: 'INR' },
  { symbol: 'HINDALCO', name: 'Hindalco Industries Ltd', exchange: 'NSE/BSE', sector: 'Materials', currency: 'INR' },
  { symbol: 'VEDL', name: 'Vedanta Ltd', exchange: 'NSE/BSE', sector: 'Materials', currency: 'INR' },
  // ---- NIFTY NEXT 50 ----
  { symbol: 'ADANIGREEN', name: 'Adani Green Energy Ltd', exchange: 'NSE/BSE', sector: 'Energy', currency: 'INR' },
  { symbol: 'AMBUJACEM', name: 'Ambuja Cements Ltd', exchange: 'NSE/BSE', sector: 'Materials', currency: 'INR' },
  { symbol: 'BANKBARODA', name: 'Bank of Baroda', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'BERGEPAINT', name: 'Berger Paints India Ltd', exchange: 'NSE/BSE', sector: 'Consumer', currency: 'INR' },
  { symbol: 'BOSCHLTD', name: 'Bosch Ltd', exchange: 'NSE/BSE', sector: 'Automobile', currency: 'INR' },
  { symbol: 'CHOLAFIN', name: 'Cholamandalam Investment and Finance', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'COLPAL', name: 'Colgate Palmolive India Ltd', exchange: 'NSE/BSE', sector: 'Consumer', currency: 'INR' },
  { symbol: 'DLF', name: 'DLF Ltd', exchange: 'NSE/BSE', sector: 'Real Estate', currency: 'INR' },
  { symbol: 'DABUR', name: 'Dabur India Ltd', exchange: 'NSE/BSE', sector: 'Consumer', currency: 'INR' },
  { symbol: 'GODREJCP', name: 'Godrej Consumer Products Ltd', exchange: 'NSE/BSE', sector: 'Consumer', currency: 'INR' },
  { symbol: 'HAVELLS', name: 'Havells India Ltd', exchange: 'NSE/BSE', sector: 'Industrial', currency: 'INR' },
  { symbol: 'HAL', name: 'Hindustan Aeronautics Ltd', exchange: 'NSE/BSE', sector: 'Industrial', currency: 'INR' },
  { symbol: 'ICICIGI', name: 'ICICI Lombard General Insurance', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'ICICIPRULI', name: 'ICICI Prudential Life Insurance', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'IOC', name: 'Indian Oil Corporation Ltd', exchange: 'NSE/BSE', sector: 'Energy', currency: 'INR' },
  { symbol: 'IRCTC', name: 'Indian Railway Catering & Tourism Corp', exchange: 'NSE/BSE', sector: 'Consumer', currency: 'INR' },
  { symbol: 'JUBLFOOD', name: 'Jubilant FoodWorks Ltd', exchange: 'NSE/BSE', sector: 'Consumer', currency: 'INR' },
  { symbol: 'LUPIN', name: 'Lupin Ltd', exchange: 'NSE/BSE', sector: 'Healthcare', currency: 'INR' },
  { symbol: 'MARICO', name: 'Marico Ltd', exchange: 'NSE/BSE', sector: 'Consumer', currency: 'INR' },
  { symbol: 'MCDOWELL-N', name: 'United Spirits Ltd', exchange: 'NSE/BSE', sector: 'Consumer', currency: 'INR' },
  { symbol: 'MUTHOOTFIN', name: 'Muthoot Finance Ltd', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'NAUKRI', name: 'Info Edge (India) Ltd', exchange: 'NSE/BSE', sector: 'Technology', currency: 'INR' },
  { symbol: 'PEL', name: 'Piramal Enterprises Ltd', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'PIDILITIND', name: 'Pidilite Industries Ltd', exchange: 'NSE/BSE', sector: 'Materials', currency: 'INR' },
  { symbol: 'PNB', name: 'Punjab National Bank', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'SIEMENS', name: 'Siemens Ltd', exchange: 'NSE/BSE', sector: 'Industrial', currency: 'INR' },
  { symbol: 'SRF', name: 'SRF Ltd', exchange: 'NSE/BSE', sector: 'Materials', currency: 'INR' },
  { symbol: 'SHREECEM', name: 'Shree Cement Ltd', exchange: 'NSE/BSE', sector: 'Materials', currency: 'INR' },
  { symbol: 'TORNTPHARM', name: 'Torrent Pharmaceuticals Ltd', exchange: 'NSE/BSE', sector: 'Healthcare', currency: 'INR' },
  { symbol: 'TRENT', name: 'Trent Ltd', exchange: 'NSE/BSE', sector: 'Consumer', currency: 'INR' },
  { symbol: 'ZOMATO', name: 'Zomato Ltd', exchange: 'NSE/BSE', sector: 'Technology', currency: 'INR' },
  { symbol: 'PAYTM', name: 'One 97 Communications Ltd (Paytm)', exchange: 'NSE/BSE', sector: 'Technology', currency: 'INR' },
  { symbol: 'NYKAA', name: 'FSN E-Commerce Ventures Ltd (Nykaa)', exchange: 'NSE/BSE', sector: 'Consumer', currency: 'INR' },
  { symbol: 'POLICYBZR', name: 'PB Fintech Ltd (PolicyBazaar)', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  // ---- POPULAR MID-CAPS ----
  { symbol: 'TATAPOWER', name: 'Tata Power Company Ltd', exchange: 'NSE/BSE', sector: 'Utilities', currency: 'INR' },
  { symbol: 'TATAELXSI', name: 'Tata Elxsi Ltd', exchange: 'NSE/BSE', sector: 'Technology', currency: 'INR' },
  { symbol: 'PERSISTENT', name: 'Persistent Systems Ltd', exchange: 'NSE/BSE', sector: 'Technology', currency: 'INR' },
  { symbol: 'LTIM', name: 'LTIMindtree Ltd', exchange: 'NSE/BSE', sector: 'Technology', currency: 'INR' },
  { symbol: 'COFORGE', name: 'Coforge Ltd', exchange: 'NSE/BSE', sector: 'Technology', currency: 'INR' },
  { symbol: 'MPHASIS', name: 'MphasiS Ltd', exchange: 'NSE/BSE', sector: 'Technology', currency: 'INR' },
  { symbol: 'LICI', name: 'Life Insurance Corporation of India', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'IRFC', name: 'Indian Railway Finance Corporation Ltd', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'RECLTD', name: 'REC Ltd', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'PFC', name: 'Power Finance Corporation Ltd', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'NHPC', name: 'NHPC Ltd', exchange: 'NSE/BSE', sector: 'Utilities', currency: 'INR' },
  { symbol: 'SAIL', name: 'Steel Authority of India Ltd', exchange: 'NSE/BSE', sector: 'Materials', currency: 'INR' },
  { symbol: 'GAIL', name: 'GAIL (India) Ltd', exchange: 'NSE/BSE', sector: 'Energy', currency: 'INR' },
  { symbol: 'HDFCAMC', name: 'HDFC Asset Management Company Ltd', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'VOLTAS', name: 'Voltas Ltd', exchange: 'NSE/BSE', sector: 'Industrial', currency: 'INR' },
  { symbol: 'PIIND', name: 'PI Industries Ltd', exchange: 'NSE/BSE', sector: 'Materials', currency: 'INR' },
  { symbol: 'ABCAPITAL', name: 'Aditya Birla Capital Ltd', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'CANBK', name: 'Canara Bank', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'UNIONBANK', name: 'Union Bank of India', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'INDIANB', name: 'Indian Bank', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'IDFCFIRSTB', name: 'IDFC First Bank Ltd', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'FEDERALBNK', name: 'Federal Bank Ltd', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'YESBANK', name: 'Yes Bank Ltd', exchange: 'NSE/BSE', sector: 'Finance', currency: 'INR' },
  { symbol: 'BIOCON', name: 'Biocon Ltd', exchange: 'NSE/BSE', sector: 'Healthcare', currency: 'INR' },
  { symbol: 'AUROPHARMA', name: 'Aurobindo Pharma Ltd', exchange: 'NSE/BSE', sector: 'Healthcare', currency: 'INR' },
  { symbol: 'ALKEM', name: 'Alkem Laboratories Ltd', exchange: 'NSE/BSE', sector: 'Healthcare', currency: 'INR' },
  { symbol: 'MAXHEALTH', name: 'Max Healthcare Institute Ltd', exchange: 'NSE/BSE', sector: 'Healthcare', currency: 'INR' },
  { symbol: 'DEEPAKNTR', name: 'Deepak Nitrite Ltd', exchange: 'NSE/BSE', sector: 'Materials', currency: 'INR' },
  { symbol: 'ATUL', name: 'Atul Ltd', exchange: 'NSE/BSE', sector: 'Materials', currency: 'INR' },
  { symbol: 'OFSS', name: 'Oracle Financial Services Software', exchange: 'NSE/BSE', sector: 'Technology', currency: 'INR' },
  { symbol: 'PAGEIND', name: 'Page Industries Ltd', exchange: 'NSE/BSE', sector: 'Consumer', currency: 'INR' },
  { symbol: 'ASTRAL', name: 'Astral Ltd', exchange: 'NSE/BSE', sector: 'Industrial', currency: 'INR' },
  { symbol: 'POLYCAB', name: 'Polycab India Ltd', exchange: 'NSE/BSE', sector: 'Industrial', currency: 'INR' },
  { symbol: 'DIXON', name: 'Dixon Technologies (India) Ltd', exchange: 'NSE/BSE', sector: 'Technology', currency: 'INR' },
  { symbol: 'ABB', name: 'ABB India Ltd', exchange: 'NSE/BSE', sector: 'Industrial', currency: 'INR' },
  { symbol: 'CUMMINSIND', name: 'Cummins India Ltd', exchange: 'NSE/BSE', sector: 'Industrial', currency: 'INR' },
  { symbol: 'MOTHERSON', name: 'Samvardhana Motherson International', exchange: 'NSE/BSE', sector: 'Automobile', currency: 'INR' },
  { symbol: 'BALKRISIND', name: 'Balkrishna Industries Ltd', exchange: 'NSE/BSE', sector: 'Automobile', currency: 'INR' },
  { symbol: 'ESCORTS', name: 'Escorts Kubota Ltd', exchange: 'NSE/BSE', sector: 'Automobile', currency: 'INR' },
  { symbol: 'BHARATFORG', name: 'Bharat Forge Ltd', exchange: 'NSE/BSE', sector: 'Industrial', currency: 'INR' },
  { symbol: 'MRF', name: 'MRF Ltd', exchange: 'NSE/BSE', sector: 'Automobile', currency: 'INR' },
  { symbol: 'OBEROIRLTY', name: 'Oberoi Realty Ltd', exchange: 'NSE/BSE', sector: 'Real Estate', currency: 'INR' },
  { symbol: 'GODREJPROP', name: 'Godrej Properties Ltd', exchange: 'NSE/BSE', sector: 'Real Estate', currency: 'INR' },
  { symbol: 'PRESTIGE', name: 'Prestige Estates Projects Ltd', exchange: 'NSE/BSE', sector: 'Real Estate', currency: 'INR' },
  { symbol: 'PHOENIXLTD', name: 'The Phoenix Mills Ltd', exchange: 'NSE/BSE', sector: 'Real Estate', currency: 'INR' },
  { symbol: 'LODHA', name: 'Macrotech Developers Ltd (Lodha)', exchange: 'NSE/BSE', sector: 'Real Estate', currency: 'INR' },
  { symbol: 'IDEA', name: 'Vodafone Idea Ltd', exchange: 'NSE/BSE', sector: 'Telecom', currency: 'INR' },
  { symbol: 'ATGL', name: 'Adani Total Gas Ltd', exchange: 'NSE/BSE', sector: 'Energy', currency: 'INR' },
  { symbol: 'IGL', name: 'Indraprastha Gas Ltd', exchange: 'NSE/BSE', sector: 'Energy', currency: 'INR' },
  { symbol: 'PETRONET', name: 'Petronet LNG Ltd', exchange: 'NSE/BSE', sector: 'Energy', currency: 'INR' },
  { symbol: 'INDIGO', name: 'InterGlobe Aviation Ltd (IndiGo)', exchange: 'NSE/BSE', sector: 'Industrial', currency: 'INR' },
];

// ============ SEARCH (local + API fallback) ============

export const searchLocalStocks = (query: string): StockInfo[] => {
  if (!query) return [];
  const q = query.toUpperCase().trim();
  return NSE_BSE_STOCKS.filter(
    (s) =>
      s.symbol.toUpperCase().includes(q) ||
      s.name.toUpperCase().includes(q) ||
      s.sector.toUpperCase().includes(q)
  ).slice(0, 30);
};

export interface StockSearchResult {
  symbol: string;
  name: string;
  type: string;
  exchange: string;
  currency: string;
}

const AV_API_KEY = 'demo'; // Replace with your own key from alphavantage.co

export const searchStocksAPI = async (query: string): Promise<StockSearchResult[]> => {
  if (!query || query.length < 1) return [];
  try {
    const url = `https://www.alphavantage.co/query?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(query)}&apikey=${AV_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    const matches = data.bestMatches || [];
    return matches.map((m: any) => ({
      symbol: m['1. symbol'],
      name: m['2. name'],
      type: m['3. type'] || 'Equity',
      exchange: m['4. region'] || '',
      currency: m['8. currency'] || 'INR',
    }));
  } catch (error) {
    console.error('Stock search API error:', error);
    return [];
  }
};

// Combined search: local first, then API
export const searchStocks = async (query: string): Promise<StockSearchResult[]> => {
  // Try local first
  const local = searchLocalStocks(query);
  const localResults: StockSearchResult[] = local.map((s) => ({
    symbol: s.symbol,
    name: s.name,
    type: 'Equity',
    exchange: s.exchange,
    currency: s.currency,
  }));

  if (localResults.length >= 5) return localResults;

  // Fallback to API if local results are few
  try {
    const apiResults = await searchStocksAPI(query);
    // Merge, deduplicate by symbol
    const seen = new Set(localResults.map((r) => r.symbol));
    const merged = [...localResults];
    for (const r of apiResults) {
      if (!seen.has(r.symbol)) {
        merged.push(r);
        seen.add(r.symbol);
      }
    }
    return merged.slice(0, 30);
  } catch {
    return localResults;
  }
};

// ============ QUOTE / LTP API ============

export interface StockQuote {
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  volume: number;
  open: number;
}

// Fetch quote using Alpha Vantage (works for NSE stocks with .BSE suffix)
export const fetchQuote = async (symbol: string): Promise<StockQuote | null> => {
  // For NSE/BSE stocks, try with .BSE suffix first
  const isIndian = NSE_BSE_STOCKS.some((s) => s.symbol === symbol);
  const querySymbol = isIndian ? `${symbol}.BSE` : symbol;

  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(querySymbol)}&apikey=${AV_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    const q = data['Global Quote'];
    if (!q || !q['05. price']) {
      // Retry without suffix
      if (isIndian) {
        const url2 = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${AV_API_KEY}`;
        const response2 = await fetch(url2);
        const data2 = await response2.json();
        const q2 = data2['Global Quote'];
        if (!q2 || !q2['05. price']) return null;
        return {
          price: parseFloat(q2['05. price']) || 0,
          previousClose: parseFloat(q2['08. previous close']) || 0,
          change: parseFloat(q2['09. change']) || 0,
          changePercent: parseFloat((q2['10. change percent'] || '0').replace('%', '')) || 0,
          high: parseFloat(q2['03. high']) || 0,
          low: parseFloat(q2['04. low']) || 0,
          volume: parseInt(q2['06. volume']) || 0,
          open: parseFloat(q2['02. open']) || 0,
        };
      }
      return null;
    }
    return {
      price: parseFloat(q['05. price']) || 0,
      previousClose: parseFloat(q['08. previous close']) || 0,
      change: parseFloat(q['09. change']) || 0,
      changePercent: parseFloat((q['10. change percent'] || '0').replace('%', '')) || 0,
      high: parseFloat(q['03. high']) || 0,
      low: parseFloat(q['04. low']) || 0,
      volume: parseInt(q['06. volume']) || 0,
      open: parseFloat(q['02. open']) || 0,
    };
  } catch (error) {
    console.error('Quote fetch error:', error);
    return null;
  }
};

// ============ STOCK INFO LOOKUP ============

export const getStockInfo = (symbol: string): StockInfo | undefined => {
  return NSE_BSE_STOCKS.find((s) => s.symbol === symbol);
};

// ============ FORMAT HELPERS ============

export const formatCurrency = (val: number, currency: string = 'INR'): string => {
  if (currency === 'INR') {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
    }).format(val);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(val);
};

export const formatNumber = (val: number): string => {
  return new Intl.NumberFormat('en-IN').format(val);
};

export const formatPercent = (val: number): string => {
  return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
};
