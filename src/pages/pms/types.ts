// Institutional PMS - Shared Types
// Modeled after Bloomberg Aladdin / Charles River IMS for Indian markets

export interface Fund {
  id: string;
  name: string;
  shortName: string;
  type: 'Equity' | 'Debt' | 'Hybrid' | 'Multi-Asset' | 'Sector' | 'Thematic';
  strategy: string;
  inceptionDate: string;
  aum: number;
  nav: number;
  previousNav: number;
  navDate: string;
  benchmarkIndex: string;
  riskCategory: 'Low' | 'Moderate' | 'High' | 'Very High';
  status: 'Active' | 'Closed' | 'Suspended';
  managementFeePercent: number;
  performanceFeePercent: number;
  hurdleRatePercent: number;
  highWaterMark: number;
  minInvestment: number;
  lockInMonths: number;
  fundManager: string;
  description: string;
  holdings: FundHolding[];
  investors: FundInvestor[];
}

export interface FundHolding {
  key: string;
  symbol: string;
  name: string;
  exchange: string;
  sector: string;
  quantity: number;
  avgCostPrice: number;
  currentPrice: number;
  previousClose: number;
  investedValue: number;
  currentValue: number;
  profitLoss: number;
  profitLossPercent: number;
  dayChange: number;
  dayChangePercent: number;
  weightPercent: number;
  targetWeightPercent: number;
  driftPercent: number;
}

export interface FundInvestor {
  investorId: string;
  fundId: string;
  commitmentAmount: number;
  investedAmount: number;
  currentValue: number;
  units: number;
  joinDate: string;
  lastTopUpDate?: string;
  redemptionDate?: string;
  status: 'Active' | 'Redeemed' | 'Partial Redemption';
}

export interface Order {
  id: string;
  fundId: string;
  fundName: string;
  symbol: string;
  stockName: string;
  exchange: string;
  orderType: 'Market' | 'Limit' | 'Stop Loss' | 'Stop Limit';
  side: 'Buy' | 'Sell';
  quantity: number;
  filledQuantity: number;
  price?: number; // limit price
  triggerPrice?: number; // stop loss trigger
  avgExecutionPrice?: number;
  status: 'Pending' | 'Partially Filled' | 'Filled' | 'Cancelled' | 'Rejected' | 'Expired';
  validity: 'Day' | 'GTC' | 'IOC';
  orderDate: string;
  orderTime: string;
  executionDate?: string;
  executionTime?: string;
  tradingAccount: string;
  broker: string;
  notes?: string;
  createdBy: string;
  approvedBy?: string;
  brokerage: number;
  stt: number;
  otherCharges: number;
  totalCost: number;
}

export interface Transaction {
  id: string;
  fundId: string;
  fundName: string;
  orderId?: string;
  symbol: string;
  stockName: string;
  exchange: string;
  type: 'Buy' | 'Sell' | 'Dividend' | 'Bonus' | 'Split' | 'Rights' | 'Merger';
  quantity: number;
  price: number;
  amount: number;
  brokerage: number;
  stt: number;
  gst: number;
  stampDuty: number;
  exchangeCharges: number;
  sebiCharges: number;
  totalCharges: number;
  netAmount: number;
  settlementDate: string;
  tradeDate: string;
  settlementNumber?: string;
  contractNote?: string;
  status: 'Settled' | 'Pending Settlement' | 'Failed';
}

export interface Investor {
  id: string;
  name: string;
  pan: string;
  email: string;
  phone: string;
  type: 'Individual' | 'HUF' | 'Corporate' | 'Trust' | 'NRI' | 'FPI';
  kycStatus: 'Verified' | 'Pending' | 'Expired';
  riskProfile: 'Conservative' | 'Moderate' | 'Aggressive' | 'Very Aggressive';
  onboardingDate: string;
  totalCommitment: number;
  totalInvested: number;
  currentPortfolioValue: number;
  totalPnL: number;
  totalPnLPercent: number;
  funds: FundInvestor[];
  bankDetails: {
    bankName: string;
    accountNumber: string;
    ifsc: string;
  };
  nominee?: string;
  address: string;
  status: 'Active' | 'Inactive' | 'Blocked';
}

export interface RiskMetrics {
  fundId: string;
  date: string;
  // Returns
  dailyReturn: number;
  weeklyReturn: number;
  monthlyReturn: number;
  ytdReturn: number;
  oneYearReturn: number;
  threeYearReturn: number;
  sinceInceptionReturn: number;
  // Risk measures
  standardDeviation: number;
  sharpeRatio: number;
  sortinoRatio: number;
  beta: number;
  alpha: number;
  treynorRatio: number;
  informationRatio: number;
  trackingError: number;
  // Drawdown
  maxDrawdown: number;
  currentDrawdown: number;
  drawdownDuration: number; // days
  // VaR
  var95: number; // 95% confidence
  var99: number; // 99% confidence
  cvar95: number; // Conditional VaR
  // Concentration
  top5HoldingsPercent: number;
  top10HoldingsPercent: number;
  sectorConcentration: { sector: string; percent: number }[];
  herfindahlIndex: number;
}

export interface ComplianceRule {
  id: string;
  name: string;
  description: string;
  category: 'SEBI' | 'Internal' | 'Risk';
  parameter: string;
  limit: number;
  currentValue: number;
  status: 'Compliant' | 'Warning' | 'Breach';
  warningThreshold: number;
  lastChecked: string;
  fundId?: string;
}

export interface ModelPortfolio {
  id: string;
  name: string;
  description: string;
  benchmarkIndex: string;
  riskCategory: 'Low' | 'Moderate' | 'High' | 'Very High';
  targetAllocations: ModelAllocation[];
  createdDate: string;
  lastRebalanceDate: string;
  rebalanceFrequency: 'Monthly' | 'Quarterly' | 'Semi-Annual' | 'Annual';
  status: 'Active' | 'Draft' | 'Archived';
}

export interface ModelAllocation {
  symbol: string;
  name: string;
  sector: string;
  targetPercent: number;
  currentPercent?: number;
  driftPercent?: number;
  action?: 'Buy' | 'Sell' | 'Hold';
  actionQuantity?: number;
}

export interface FeeCalculation {
  id: string;
  fundId: string;
  fundName: string;
  investorId: string;
  investorName: string;
  period: string; // e.g. "Q3 FY2025-26"
  periodStart: string;
  periodEnd: string;
  openingValue: number;
  closingValue: number;
  netInflow: number;
  managementFee: number;
  performanceFee: number;
  totalFee: number;
  previousHighWaterMark: number;
  newHighWaterMark: number;
  excessReturn: number;
  hurdleReturn: number;
  status: 'Draft' | 'Approved' | 'Invoiced' | 'Paid';
}

export interface BenchmarkData {
  date: string;
  nifty50: number;
  sensex: number;
  niftyNext50: number;
  niftyMidcap100: number;
  niftySmallcap100: number;
  niftyBank: number;
  niftyIT: number;
  niftyPharma: number;
  fundNav?: number;
}

export interface Report {
  id: string;
  name: string;
  type: 'Performance' | 'Holdings' | 'Transaction' | 'Client Statement' | 'Risk' | 'Compliance' | 'Fee' | 'Attribution' | 'MIS';
  fundId?: string;
  investorId?: string;
  periodStart: string;
  periodEnd: string;
  generatedDate: string;
  generatedBy: string;
  status: 'Generated' | 'Draft' | 'Sent';
  format: 'PDF' | 'Excel' | 'CSV';
}

// Dashboard KPI types
export interface DashboardKPIs {
  totalAUM: number;
  aumChange: number;
  totalFunds: number;
  activeFunds: number;
  totalInvestors: number;
  activeInvestors: number;
  totalPnL: number;
  totalPnLPercent: number;
  todayPnL: number;
  todayPnLPercent: number;
  ytdReturn: number;
  bestFund: { name: string; return: number };
  worstFund: { name: string; return: number };
  pendingOrders: number;
  complianceAlerts: number;
  pendingSettlements: number;
}

// Color palette
export const REDWOOD = {
  primary: '#C74634',
  primaryLight: '#E85D4A',
  success: '#1D7B4D',
  successLight: '#E8F5E9',
  warning: '#D4A800',
  warningLight: '#FFF8E1',
  danger: '#D32F2F',
  dangerLight: '#FFEBEE',
  info: '#0572CE',
  infoLight: '#E3F2FD',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral300: '#CCCCCC',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface: '#FFFFFF',
  portfolioPurple: '#6B4C9A',
  portfolioPurpleLight: '#F3E8FF',
  fundBlue: '#1565C0',
  fundBlueLight: '#E3F2FD',
  riskOrange: '#E65100',
  riskOrangeLight: '#FFF3E0',
};
