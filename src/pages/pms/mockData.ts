// Institutional PMS - Mock Data
// Realistic data for Indian institutional investor with own funding

import type {
  Fund, Order, Transaction, Investor, RiskMetrics,
  ComplianceRule, ModelPortfolio, FeeCalculation, BenchmarkData, Report, DashboardKPIs
} from './types';

// ============================================================
// FUNDS
// ============================================================
export const MOCK_FUNDS: Fund[] = [
  {
    id: 'FUND-001',
    name: 'Alpha Growth Equity Fund',
    shortName: 'Alpha Growth',
    type: 'Equity',
    strategy: 'Multi-cap growth with momentum overlay. Focus on earnings acceleration and relative strength.',
    inceptionDate: '15 Jan 2020',
    aum: 285000000, // 28.5 Cr
    nav: 156.42,
    previousNav: 155.18,
    navDate: '14 Feb 2026',
    benchmarkIndex: 'Nifty 50 TRI',
    riskCategory: 'High',
    status: 'Active',
    managementFeePercent: 2.0,
    performanceFeePercent: 20,
    hurdleRatePercent: 10,
    highWaterMark: 152.80,
    minInvestment: 5000000, // 50L
    lockInMonths: 12,
    fundManager: 'Rajesh Sharma',
    description: 'Flagship multi-cap equity fund targeting 18-22% CAGR through bottom-up stock picking with momentum-based position sizing.',
    holdings: [
      { key: 'H001', symbol: 'RELIANCE', name: 'Reliance Industries Ltd', exchange: 'NSE', sector: 'Energy', quantity: 2500, avgCostPrice: 2380, currentPrice: 2540.75, previousClose: 2528.50, investedValue: 5950000, currentValue: 6351875, profitLoss: 401875, profitLossPercent: 6.75, dayChange: 12.25, dayChangePercent: 0.48, weightPercent: 22.3, targetWeightPercent: 20, driftPercent: 2.3 },
      { key: 'H002', symbol: 'TCS', name: 'Tata Consultancy Services', exchange: 'NSE', sector: 'IT', quantity: 1800, avgCostPrice: 3580, currentPrice: 3892.40, previousClose: 3870.15, investedValue: 6444000, currentValue: 7006320, profitLoss: 562320, profitLossPercent: 8.73, dayChange: 22.25, dayChangePercent: 0.57, weightPercent: 24.6, targetWeightPercent: 22, driftPercent: 2.6 },
      { key: 'H003', symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', exchange: 'NSE', sector: 'Banking', quantity: 3200, avgCostPrice: 1620, currentPrice: 1748.30, previousClose: 1755.80, investedValue: 5184000, currentValue: 5594560, profitLoss: 410560, profitLossPercent: 7.92, dayChange: -7.50, dayChangePercent: -0.43, weightPercent: 19.6, targetWeightPercent: 18, driftPercent: 1.6 },
      { key: 'H004', symbol: 'INFY', name: 'Infosys Ltd', exchange: 'NSE', sector: 'IT', quantity: 2200, avgCostPrice: 1480, currentPrice: 1625.80, previousClose: 1618.45, investedValue: 3256000, currentValue: 3576760, profitLoss: 320760, profitLossPercent: 9.85, dayChange: 7.35, dayChangePercent: 0.45, weightPercent: 12.5, targetWeightPercent: 15, driftPercent: -2.5 },
      { key: 'H005', symbol: 'ICICIBANK', name: 'ICICI Bank Ltd', exchange: 'NSE', sector: 'Banking', quantity: 2800, avgCostPrice: 1020, currentPrice: 1142.60, previousClose: 1138.25, investedValue: 2856000, currentValue: 3199280, profitLoss: 343280, profitLossPercent: 12.02, dayChange: 4.35, dayChangePercent: 0.38, weightPercent: 11.2, targetWeightPercent: 12, driftPercent: -0.8 },
      { key: 'H006', symbol: 'BHARTIARTL', name: 'Bharti Airtel Ltd', exchange: 'NSE', sector: 'Telecom', quantity: 1500, avgCostPrice: 1320, currentPrice: 1485.20, previousClose: 1478.90, investedValue: 1980000, currentValue: 2227800, profitLoss: 247800, profitLossPercent: 12.52, dayChange: 6.30, dayChangePercent: 0.43, weightPercent: 7.8, targetWeightPercent: 8, driftPercent: -0.2 },
      { key: 'H007', symbol: 'LT', name: 'Larsen & Toubro Ltd', exchange: 'NSE', sector: 'Infrastructure', quantity: 300, avgCostPrice: 3280, currentPrice: 3520.40, previousClose: 3545.20, investedValue: 984000, currentValue: 1056120, profitLoss: 72120, profitLossPercent: 7.33, dayChange: -24.80, dayChangePercent: -0.70, weightPercent: 3.7, targetWeightPercent: 5, driftPercent: -1.3 },
    ],
    investors: [
      { investorId: 'INV-001', fundId: 'FUND-001', commitmentAmount: 100000000, investedAmount: 95000000, currentValue: 108250000, units: 607421.88, joinDate: '15 Jan 2020', status: 'Active' },
      { investorId: 'INV-002', fundId: 'FUND-001', commitmentAmount: 75000000, investedAmount: 72000000, currentValue: 81540000, units: 460312.50, joinDate: '01 Apr 2020', status: 'Active' },
      { investorId: 'INV-003', fundId: 'FUND-001', commitmentAmount: 50000000, investedAmount: 48000000, currentValue: 54320000, units: 306875.00, joinDate: '15 Jul 2021', status: 'Active' },
      { investorId: 'INV-004', fundId: 'FUND-001', commitmentAmount: 60000000, investedAmount: 55000000, currentValue: 62890000, units: 351562.50, joinDate: '01 Jan 2023', status: 'Active' },
    ],
  },
  {
    id: 'FUND-002',
    name: 'Stable Value Hybrid Fund',
    shortName: 'Stable Value',
    type: 'Hybrid',
    strategy: 'Balanced allocation with 65% equity and 35% debt. Tactical shifts based on market valuations.',
    inceptionDate: '01 Apr 2021',
    aum: 182000000, // 18.2 Cr
    nav: 128.65,
    previousNav: 128.32,
    navDate: '14 Feb 2026',
    benchmarkIndex: 'CRISIL Hybrid 35+65',
    riskCategory: 'Moderate',
    status: 'Active',
    managementFeePercent: 1.5,
    performanceFeePercent: 15,
    hurdleRatePercent: 8,
    highWaterMark: 126.40,
    minInvestment: 2500000,
    lockInMonths: 6,
    fundManager: 'Priya Mehta',
    description: 'Conservative hybrid fund for investors seeking steady returns with lower volatility. Targets 12-15% CAGR.',
    holdings: [
      { key: 'SH001', symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', exchange: 'NSE', sector: 'Banking', quantity: 1800, avgCostPrice: 1590, currentPrice: 1748.30, previousClose: 1755.80, investedValue: 2862000, currentValue: 3146940, profitLoss: 284940, profitLossPercent: 9.96, dayChange: -7.50, dayChangePercent: -0.43, weightPercent: 17.3, targetWeightPercent: 16, driftPercent: 1.3 },
      { key: 'SH002', symbol: 'RELIANCE', name: 'Reliance Industries Ltd', exchange: 'NSE', sector: 'Energy', quantity: 1200, avgCostPrice: 2420, currentPrice: 2540.75, previousClose: 2528.50, investedValue: 2904000, currentValue: 3048900, profitLoss: 144900, profitLossPercent: 4.99, dayChange: 12.25, dayChangePercent: 0.48, weightPercent: 16.8, targetWeightPercent: 15, driftPercent: 1.8 },
      { key: 'SH003', symbol: 'INFY', name: 'Infosys Ltd', exchange: 'NSE', sector: 'IT', quantity: 1500, avgCostPrice: 1510, currentPrice: 1625.80, previousClose: 1618.45, investedValue: 2265000, currentValue: 2438700, profitLoss: 173700, profitLossPercent: 7.67, dayChange: 7.35, dayChangePercent: 0.45, weightPercent: 13.4, targetWeightPercent: 14, driftPercent: -0.6 },
      { key: 'SH004', symbol: 'ITC', name: 'ITC Ltd', exchange: 'NSE', sector: 'FMCG', quantity: 4000, avgCostPrice: 438, currentPrice: 468.25, previousClose: 465.80, investedValue: 1752000, currentValue: 1873000, profitLoss: 121000, profitLossPercent: 6.91, dayChange: 2.45, dayChangePercent: 0.53, weightPercent: 10.3, targetWeightPercent: 10, driftPercent: 0.3 },
      { key: 'SH005', symbol: 'SBIN', name: 'State Bank of India', exchange: 'NSE', sector: 'Banking', quantity: 2500, avgCostPrice: 618, currentPrice: 682.40, previousClose: 679.60, investedValue: 1545000, currentValue: 1706000, profitLoss: 161000, profitLossPercent: 10.42, dayChange: 2.80, dayChangePercent: 0.41, weightPercent: 9.4, targetWeightPercent: 10, driftPercent: -0.6 },
    ],
    investors: [
      { investorId: 'INV-001', fundId: 'FUND-002', commitmentAmount: 50000000, investedAmount: 48000000, currentValue: 53280000, units: 373437.50, joinDate: '01 Apr 2021', status: 'Active' },
      { investorId: 'INV-005', fundId: 'FUND-002', commitmentAmount: 80000000, investedAmount: 75000000, currentValue: 83500000, units: 582812.50, joinDate: '01 Jul 2021', status: 'Active' },
      { investorId: 'INV-006', fundId: 'FUND-002', commitmentAmount: 52000000, investedAmount: 50000000, currentValue: 55220000, units: 388593.75, joinDate: '15 Oct 2022', status: 'Active' },
    ],
  },
  {
    id: 'FUND-003',
    name: 'Emerging Leaders Smallcap Fund',
    shortName: 'Emerging Leaders',
    type: 'Equity',
    strategy: 'Bottom-up smallcap stock picking targeting companies with >25% earnings growth potential. High conviction portfolio of 15-20 stocks.',
    inceptionDate: '01 Oct 2022',
    aum: 95000000, // 9.5 Cr
    nav: 142.18,
    previousNav: 140.85,
    navDate: '14 Feb 2026',
    benchmarkIndex: 'Nifty Smallcap 100 TRI',
    riskCategory: 'Very High',
    status: 'Active',
    managementFeePercent: 2.5,
    performanceFeePercent: 20,
    hurdleRatePercent: 12,
    highWaterMark: 138.50,
    minInvestment: 10000000,
    lockInMonths: 24,
    fundManager: 'Rajesh Sharma',
    description: 'High-conviction smallcap fund targeting emerging leaders. Concentrated portfolio with active risk management.',
    holdings: [
      { key: 'EL001', symbol: 'DEEPAKNITRIT', name: 'Deepak Nitrite Ltd', exchange: 'NSE', sector: 'Chemicals', quantity: 1200, avgCostPrice: 2180, currentPrice: 2450.60, previousClose: 2425.30, investedValue: 2616000, currentValue: 2940720, profitLoss: 324720, profitLossPercent: 12.41, dayChange: 25.30, dayChangePercent: 1.04, weightPercent: 30.9, targetWeightPercent: 28, driftPercent: 2.9 },
      { key: 'EL002', symbol: 'AFFLE', name: 'Affle India Ltd', exchange: 'NSE', sector: 'IT', quantity: 800, avgCostPrice: 1150, currentPrice: 1380.25, previousClose: 1365.80, investedValue: 920000, currentValue: 1104200, profitLoss: 184200, profitLossPercent: 20.02, dayChange: 14.45, dayChangePercent: 1.06, weightPercent: 11.6, targetWeightPercent: 12, driftPercent: -0.4 },
      { key: 'EL003', symbol: 'ROUTE', name: 'Route Mobile Ltd', exchange: 'NSE', sector: 'IT', quantity: 600, avgCostPrice: 1820, currentPrice: 2045.40, previousClose: 2038.60, investedValue: 1092000, currentValue: 1227240, profitLoss: 135240, profitLossPercent: 12.38, dayChange: 6.80, dayChangePercent: 0.33, weightPercent: 12.9, targetWeightPercent: 12, driftPercent: 0.9 },
      { key: 'EL004', symbol: 'CLEAN', name: 'Clean Science & Technology', exchange: 'NSE', sector: 'Chemicals', quantity: 500, avgCostPrice: 1480, currentPrice: 1620.30, previousClose: 1608.40, investedValue: 740000, currentValue: 810150, profitLoss: 70150, profitLossPercent: 9.48, dayChange: 11.90, dayChangePercent: 0.74, weightPercent: 8.5, targetWeightPercent: 10, driftPercent: -1.5 },
      { key: 'EL005', symbol: 'HAPPSTMNDS', name: 'Happiest Minds Technologies', exchange: 'NSE', sector: 'IT', quantity: 1500, avgCostPrice: 720, currentPrice: 842.50, previousClose: 835.20, investedValue: 1080000, currentValue: 1263750, profitLoss: 183750, profitLossPercent: 17.01, dayChange: 7.30, dayChangePercent: 0.87, weightPercent: 13.3, targetWeightPercent: 13, driftPercent: 0.3 },
    ],
    investors: [
      { investorId: 'INV-002', fundId: 'FUND-003', commitmentAmount: 40000000, investedAmount: 35000000, currentValue: 41250000, units: 246164.06, joinDate: '01 Oct 2022', status: 'Active' },
      { investorId: 'INV-004', fundId: 'FUND-003', commitmentAmount: 30000000, investedAmount: 28000000, currentValue: 33120000, units: 196929.69, joinDate: '01 Jan 2023', status: 'Active' },
      { investorId: 'INV-007', fundId: 'FUND-003', commitmentAmount: 25000000, investedAmount: 22000000, currentValue: 25630000, units: 154726.56, joinDate: '01 Apr 2024', status: 'Active' },
    ],
  },
  {
    id: 'FUND-004',
    name: 'Dividend Yield Income Fund',
    shortName: 'Dividend Yield',
    type: 'Equity',
    strategy: 'High dividend yield stocks with consistent payout history. Focus on cash-rich companies with >3% dividend yield.',
    inceptionDate: '01 Jul 2023',
    aum: 68000000, // 6.8 Cr
    nav: 118.92,
    previousNav: 118.55,
    navDate: '14 Feb 2026',
    benchmarkIndex: 'Nifty Dividend Opportunities 50 TRI',
    riskCategory: 'Moderate',
    status: 'Active',
    managementFeePercent: 1.5,
    performanceFeePercent: 10,
    hurdleRatePercent: 8,
    highWaterMark: 117.20,
    minInvestment: 2500000,
    lockInMonths: 0,
    fundManager: 'Priya Mehta',
    description: 'Income-oriented fund focusing on high dividend yield stocks for regular income generation.',
    holdings: [
      { key: 'DY001', symbol: 'COALINDIA', name: 'Coal India Ltd', exchange: 'NSE', sector: 'Mining', quantity: 5000, avgCostPrice: 420, currentPrice: 458.30, previousClose: 456.80, investedValue: 2100000, currentValue: 2291500, profitLoss: 191500, profitLossPercent: 9.12, dayChange: 1.50, dayChangePercent: 0.33, weightPercent: 33.7, targetWeightPercent: 30, driftPercent: 3.7 },
      { key: 'DY002', symbol: 'ITC', name: 'ITC Ltd', exchange: 'NSE', sector: 'FMCG', quantity: 3500, avgCostPrice: 440, currentPrice: 468.25, previousClose: 465.80, investedValue: 1540000, currentValue: 1638875, profitLoss: 98875, profitLossPercent: 6.42, dayChange: 2.45, dayChangePercent: 0.53, weightPercent: 24.1, targetWeightPercent: 25, driftPercent: -0.9 },
      { key: 'DY003', symbol: 'POWERGRID', name: 'Power Grid Corp', exchange: 'NSE', sector: 'Power', quantity: 4000, avgCostPrice: 285, currentPrice: 312.60, previousClose: 310.40, investedValue: 1140000, currentValue: 1250400, profitLoss: 110400, profitLossPercent: 9.68, dayChange: 2.20, dayChangePercent: 0.71, weightPercent: 18.4, targetWeightPercent: 20, driftPercent: -1.6 },
      { key: 'DY004', symbol: 'ONGC', name: 'Oil & Natural Gas Corp', exchange: 'NSE', sector: 'Energy', quantity: 6000, avgCostPrice: 245, currentPrice: 268.80, previousClose: 267.40, investedValue: 1470000, currentValue: 1612800, profitLoss: 142800, profitLossPercent: 9.71, dayChange: 1.40, dayChangePercent: 0.52, weightPercent: 23.7, targetWeightPercent: 25, driftPercent: -1.3 },
    ],
    investors: [
      { investorId: 'INV-005', fundId: 'FUND-004', commitmentAmount: 40000000, investedAmount: 38000000, currentValue: 41040000, units: 319500.00, joinDate: '01 Jul 2023', status: 'Active' },
      { investorId: 'INV-006', fundId: 'FUND-004', commitmentAmount: 30000000, investedAmount: 28000000, currentValue: 30160000, units: 235406.25, joinDate: '01 Oct 2023', status: 'Active' },
    ],
  },
];

// ============================================================
// ORDERS
// ============================================================
export const MOCK_ORDERS: Order[] = [
  { id: 'ORD-20260214-001', fundId: 'FUND-001', fundName: 'Alpha Growth', symbol: 'RELIANCE', stockName: 'Reliance Industries Ltd', exchange: 'NSE', orderType: 'Limit', side: 'Buy', quantity: 500, filledQuantity: 500, price: 2530, avgExecutionPrice: 2528.40, status: 'Filled', validity: 'Day', orderDate: '14 Feb 2026', orderTime: '09:18:32', executionDate: '14 Feb 2026', executionTime: '09:22:15', tradingAccount: 'ZERODHA-PMS-001', broker: 'Zerodha', notes: 'Adding to core position', createdBy: 'Rajesh Sharma', approvedBy: 'CIO', brokerage: 252.84, stt: 1264.20, otherCharges: 85.50, totalCost: 1265802.54 },
  { id: 'ORD-20260214-002', fundId: 'FUND-001', fundName: 'Alpha Growth', symbol: 'WIPRO', stockName: 'Wipro Ltd', exchange: 'NSE', orderType: 'Market', side: 'Sell', quantity: 1000, filledQuantity: 1000, price: undefined, avgExecutionPrice: 542.30, status: 'Filled', validity: 'Day', orderDate: '14 Feb 2026', orderTime: '10:05:48', executionDate: '14 Feb 2026', executionTime: '10:05:52', tradingAccount: 'ZERODHA-PMS-001', broker: 'Zerodha', notes: 'Exit - thesis broken', createdBy: 'Rajesh Sharma', approvedBy: 'CIO', brokerage: 108.46, stt: 542.30, otherCharges: 42.80, totalCost: 541606.44 },
  { id: 'ORD-20260214-003', fundId: 'FUND-003', fundName: 'Emerging Leaders', symbol: 'AFFLE', stockName: 'Affle India Ltd', exchange: 'NSE', orderType: 'Limit', side: 'Buy', quantity: 200, filledQuantity: 120, price: 1370, avgExecutionPrice: 1368.50, status: 'Partially Filled', validity: 'Day', orderDate: '14 Feb 2026', orderTime: '11:30:15', tradingAccount: 'ZERODHA-PMS-002', broker: 'Zerodha', notes: 'Building position', createdBy: 'Rajesh Sharma', brokerage: 32.84, stt: 164.22, otherCharges: 12.50, totalCost: 164429.56 },
  { id: 'ORD-20260214-004', fundId: 'FUND-002', fundName: 'Stable Value', symbol: 'SBIN', stockName: 'State Bank of India', exchange: 'NSE', orderType: 'Market', side: 'Buy', quantity: 800, filledQuantity: 0, status: 'Pending', validity: 'Day', orderDate: '14 Feb 2026', orderTime: '13:45:00', tradingAccount: 'ZERODHA-PMS-001', broker: 'Zerodha', notes: 'Tactical allocation increase', createdBy: 'Priya Mehta', brokerage: 0, stt: 0, otherCharges: 0, totalCost: 0 },
  { id: 'ORD-20260214-005', fundId: 'FUND-001', fundName: 'Alpha Growth', symbol: 'BAJFINANCE', stockName: 'Bajaj Finance Ltd', exchange: 'NSE', orderType: 'Limit', side: 'Buy', quantity: 300, filledQuantity: 0, price: 7200, status: 'Pending', validity: 'GTC', orderDate: '14 Feb 2026', orderTime: '14:00:22', tradingAccount: 'ZERODHA-PMS-001', broker: 'Zerodha', notes: 'New entry at support', createdBy: 'Rajesh Sharma', brokerage: 0, stt: 0, otherCharges: 0, totalCost: 0 },
  { id: 'ORD-20260213-001', fundId: 'FUND-001', fundName: 'Alpha Growth', symbol: 'BHARTIARTL', stockName: 'Bharti Airtel Ltd', exchange: 'NSE', orderType: 'Market', side: 'Buy', quantity: 400, filledQuantity: 400, avgExecutionPrice: 1475.80, status: 'Filled', validity: 'Day', orderDate: '13 Feb 2026', orderTime: '09:22:10', executionDate: '13 Feb 2026', executionTime: '09:22:14', tradingAccount: 'ZERODHA-PMS-001', broker: 'Zerodha', createdBy: 'Rajesh Sharma', approvedBy: 'CIO', brokerage: 118.06, stt: 590.32, otherCharges: 46.20, totalCost: 591074.58 },
  { id: 'ORD-20260213-002', fundId: 'FUND-004', fundName: 'Dividend Yield', symbol: 'COALINDIA', stockName: 'Coal India Ltd', exchange: 'NSE', orderType: 'Limit', side: 'Buy', quantity: 1000, filledQuantity: 1000, price: 452, avgExecutionPrice: 451.20, status: 'Filled', validity: 'Day', orderDate: '13 Feb 2026', orderTime: '10:45:30', executionDate: '13 Feb 2026', executionTime: '11:02:15', tradingAccount: 'ZERODHA-PMS-001', broker: 'Zerodha', createdBy: 'Priya Mehta', approvedBy: 'CIO', brokerage: 90.24, stt: 451.20, otherCharges: 35.40, totalCost: 451776.84 },
  { id: 'ORD-20260212-001', fundId: 'FUND-001', fundName: 'Alpha Growth', symbol: 'HCLTECH', stockName: 'HCL Technologies', exchange: 'NSE', orderType: 'Market', side: 'Sell', quantity: 500, filledQuantity: 500, avgExecutionPrice: 1682.40, status: 'Filled', validity: 'Day', orderDate: '12 Feb 2026', orderTime: '14:30:00', executionDate: '12 Feb 2026', executionTime: '14:30:04', tradingAccount: 'ZERODHA-PMS-001', broker: 'Zerodha', notes: 'Profit booking', createdBy: 'Rajesh Sharma', approvedBy: 'CIO', brokerage: 168.24, stt: 841.20, otherCharges: 66.20, totalCost: 840124.36 },
  { id: 'ORD-20260211-001', fundId: 'FUND-002', fundName: 'Stable Value', symbol: 'ITC', stockName: 'ITC Ltd', exchange: 'NSE', orderType: 'Limit', side: 'Buy', quantity: 1500, filledQuantity: 1500, price: 460, avgExecutionPrice: 458.50, status: 'Filled', validity: 'Day', orderDate: '11 Feb 2026', orderTime: '09:30:15', executionDate: '11 Feb 2026', executionTime: '09:45:30', tradingAccount: 'ZERODHA-PMS-001', broker: 'Zerodha', createdBy: 'Priya Mehta', approvedBy: 'CIO', brokerage: 137.55, stt: 687.75, otherCharges: 54.00, totalCost: 688629.30 },
  { id: 'ORD-20260210-001', fundId: 'FUND-003', fundName: 'Emerging Leaders', symbol: 'DEEPAKNITRIT', stockName: 'Deepak Nitrite Ltd', exchange: 'NSE', orderType: 'Market', side: 'Buy', quantity: 300, filledQuantity: 300, avgExecutionPrice: 2385.60, status: 'Filled', validity: 'Day', orderDate: '10 Feb 2026', orderTime: '09:20:00', executionDate: '10 Feb 2026', executionTime: '09:20:05', tradingAccount: 'ZERODHA-PMS-002', broker: 'Zerodha', createdBy: 'Rajesh Sharma', approvedBy: 'CIO', brokerage: 143.14, stt: 715.68, otherCharges: 56.20, totalCost: 716595.02 },
  // Cancelled / rejected
  { id: 'ORD-20260214-006', fundId: 'FUND-001', fundName: 'Alpha Growth', symbol: 'TATAMOTORS', stockName: 'Tata Motors Ltd', exchange: 'NSE', orderType: 'Limit', side: 'Buy', quantity: 1000, filledQuantity: 0, price: 680, status: 'Cancelled', validity: 'Day', orderDate: '14 Feb 2026', orderTime: '12:00:00', tradingAccount: 'ZERODHA-PMS-001', broker: 'Zerodha', notes: 'Cancelled - price moved away', createdBy: 'Rajesh Sharma', brokerage: 0, stt: 0, otherCharges: 0, totalCost: 0 },
];

// ============================================================
// TRANSACTIONS
// ============================================================
export const MOCK_TRANSACTIONS: Transaction[] = [
  { id: 'TXN-001', fundId: 'FUND-001', fundName: 'Alpha Growth', orderId: 'ORD-20260214-001', symbol: 'RELIANCE', stockName: 'Reliance Industries Ltd', exchange: 'NSE', type: 'Buy', quantity: 500, price: 2528.40, amount: 1264200, brokerage: 252.84, stt: 1264.20, gst: 45.51, stampDuty: 18.96, exchangeCharges: 4.42, sebiCharges: 0.13, totalCharges: 1586.06, netAmount: 1265786.06, settlementDate: '18 Feb 2026', tradeDate: '14 Feb 2026', settlementNumber: 'NSE-2026023-001', status: 'Pending Settlement' },
  { id: 'TXN-002', fundId: 'FUND-001', fundName: 'Alpha Growth', orderId: 'ORD-20260214-002', symbol: 'WIPRO', stockName: 'Wipro Ltd', exchange: 'NSE', type: 'Sell', quantity: 1000, price: 542.30, amount: 542300, brokerage: 108.46, stt: 542.30, gst: 19.52, stampDuty: 0, exchangeCharges: 1.90, sebiCharges: 0.05, totalCharges: 672.23, netAmount: 541627.77, settlementDate: '18 Feb 2026', tradeDate: '14 Feb 2026', settlementNumber: 'NSE-2026023-002', status: 'Pending Settlement' },
  { id: 'TXN-003', fundId: 'FUND-001', fundName: 'Alpha Growth', orderId: 'ORD-20260213-001', symbol: 'BHARTIARTL', stockName: 'Bharti Airtel Ltd', exchange: 'NSE', type: 'Buy', quantity: 400, price: 1475.80, amount: 590320, brokerage: 118.06, stt: 590.32, gst: 21.25, stampDuty: 8.85, exchangeCharges: 2.07, sebiCharges: 0.06, totalCharges: 740.61, netAmount: 591060.61, settlementDate: '17 Feb 2026', tradeDate: '13 Feb 2026', settlementNumber: 'NSE-2026022-001', status: 'Settled' },
  { id: 'TXN-004', fundId: 'FUND-004', fundName: 'Dividend Yield', orderId: 'ORD-20260213-002', symbol: 'COALINDIA', stockName: 'Coal India Ltd', exchange: 'NSE', type: 'Buy', quantity: 1000, price: 451.20, amount: 451200, brokerage: 90.24, stt: 451.20, gst: 16.24, stampDuty: 6.77, exchangeCharges: 1.58, sebiCharges: 0.05, totalCharges: 566.08, netAmount: 451766.08, settlementDate: '17 Feb 2026', tradeDate: '13 Feb 2026', settlementNumber: 'NSE-2026022-002', status: 'Settled' },
  { id: 'TXN-005', fundId: 'FUND-001', fundName: 'Alpha Growth', orderId: 'ORD-20260212-001', symbol: 'HCLTECH', stockName: 'HCL Technologies', exchange: 'NSE', type: 'Sell', quantity: 500, price: 1682.40, amount: 841200, brokerage: 168.24, stt: 841.20, gst: 30.28, stampDuty: 0, exchangeCharges: 2.95, sebiCharges: 0.08, totalCharges: 1042.75, netAmount: 840157.25, settlementDate: '14 Feb 2026', tradeDate: '12 Feb 2026', settlementNumber: 'NSE-2026021-001', status: 'Settled' },
  { id: 'TXN-006', fundId: 'FUND-002', fundName: 'Stable Value', orderId: 'ORD-20260211-001', symbol: 'ITC', stockName: 'ITC Ltd', exchange: 'NSE', type: 'Buy', quantity: 1500, price: 458.50, amount: 687750, brokerage: 137.55, stt: 687.75, gst: 24.76, stampDuty: 10.32, exchangeCharges: 2.41, sebiCharges: 0.07, totalCharges: 862.86, netAmount: 688612.86, settlementDate: '13 Feb 2026', tradeDate: '11 Feb 2026', settlementNumber: 'NSE-2026020-001', status: 'Settled' },
  { id: 'TXN-007', fundId: 'FUND-003', fundName: 'Emerging Leaders', orderId: 'ORD-20260210-001', symbol: 'DEEPAKNITRIT', stockName: 'Deepak Nitrite Ltd', exchange: 'NSE', type: 'Buy', quantity: 300, price: 2385.60, amount: 715680, brokerage: 143.14, stt: 715.68, gst: 25.76, stampDuty: 10.74, exchangeCharges: 2.50, sebiCharges: 0.07, totalCharges: 897.89, netAmount: 716577.89, settlementDate: '12 Feb 2026', tradeDate: '10 Feb 2026', settlementNumber: 'NSE-2026019-001', status: 'Settled' },
  // Dividend entries
  { id: 'TXN-008', fundId: 'FUND-004', fundName: 'Dividend Yield', symbol: 'COALINDIA', stockName: 'Coal India Ltd', exchange: 'NSE', type: 'Dividend', quantity: 5000, price: 7.50, amount: 37500, brokerage: 0, stt: 0, gst: 0, stampDuty: 0, exchangeCharges: 0, sebiCharges: 0, totalCharges: 0, netAmount: 37500, settlementDate: '08 Feb 2026', tradeDate: '05 Feb 2026', status: 'Settled' },
  { id: 'TXN-009', fundId: 'FUND-004', fundName: 'Dividend Yield', symbol: 'ITC', stockName: 'ITC Ltd', exchange: 'NSE', type: 'Dividend', quantity: 3500, price: 6.75, amount: 23625, brokerage: 0, stt: 0, gst: 0, stampDuty: 0, exchangeCharges: 0, sebiCharges: 0, totalCharges: 0, netAmount: 23625, settlementDate: '01 Feb 2026', tradeDate: '28 Jan 2026', status: 'Settled' },
  { id: 'TXN-010', fundId: 'FUND-002', fundName: 'Stable Value', symbol: 'ITC', stockName: 'ITC Ltd', exchange: 'NSE', type: 'Dividend', quantity: 4000, price: 6.75, amount: 27000, brokerage: 0, stt: 0, gst: 0, stampDuty: 0, exchangeCharges: 0, sebiCharges: 0, totalCharges: 0, netAmount: 27000, settlementDate: '01 Feb 2026', tradeDate: '28 Jan 2026', status: 'Settled' },
];

// ============================================================
// INVESTORS
// ============================================================
export const MOCK_INVESTORS: Investor[] = [
  {
    id: 'INV-001', name: 'Vanguard Capital Partners', pan: 'AABCV1234F', email: 'ops@vanguardcap.in', phone: '+91-22-4567-8901',
    type: 'Corporate', kycStatus: 'Verified', riskProfile: 'Aggressive', onboardingDate: '10 Jan 2020',
    totalCommitment: 150000000, totalInvested: 143000000, currentPortfolioValue: 161530000, totalPnL: 18530000, totalPnLPercent: 12.96,
    funds: [], bankDetails: { bankName: 'HDFC Bank', accountNumber: 'XXXX1234', ifsc: 'HDFC0001234' },
    nominee: 'Board of Directors', address: 'Maker Chambers IV, Nariman Point, Mumbai 400021', status: 'Active',
  },
  {
    id: 'INV-002', name: 'Sunrise Family Office', pan: 'AABCS5678G', email: 'invest@sunrisefamily.in', phone: '+91-22-4567-1234',
    type: 'Trust', kycStatus: 'Verified', riskProfile: 'Aggressive', onboardingDate: '01 Mar 2020',
    totalCommitment: 115000000, totalInvested: 107000000, currentPortfolioValue: 122790000, totalPnL: 15790000, totalPnLPercent: 14.76,
    funds: [], bankDetails: { bankName: 'ICICI Bank', accountNumber: 'XXXX5678', ifsc: 'ICIC0005678' },
    nominee: 'Sunrise Trust', address: '12th Floor, Express Towers, BKC, Mumbai 400051', status: 'Active',
  },
  {
    id: 'INV-003', name: 'Ratan P. Thapar (HUF)', pan: 'AABHR9012H', email: 'ratan.thapar@email.com', phone: '+91-98200-12345',
    type: 'HUF', kycStatus: 'Verified', riskProfile: 'Moderate', onboardingDate: '10 Jul 2021',
    totalCommitment: 50000000, totalInvested: 48000000, currentPortfolioValue: 54320000, totalPnL: 6320000, totalPnLPercent: 13.17,
    funds: [], bankDetails: { bankName: 'Kotak Mahindra Bank', accountNumber: 'XXXX9012', ifsc: 'KKBK0009012' },
    address: 'Pedder Road, Mumbai 400026', status: 'Active',
  },
  {
    id: 'INV-004', name: 'Nexus Growth Capital LLP', pan: 'AAFN3456J', email: 'ops@nexusgrowth.in', phone: '+91-11-4567-5678',
    type: 'Corporate', kycStatus: 'Verified', riskProfile: 'Very Aggressive', onboardingDate: '15 Dec 2022',
    totalCommitment: 90000000, totalInvested: 83000000, currentPortfolioValue: 96010000, totalPnL: 13010000, totalPnLPercent: 15.67,
    funds: [], bankDetails: { bankName: 'Axis Bank', accountNumber: 'XXXX3456', ifsc: 'UTIB0003456' },
    address: 'Connaught Place, New Delhi 110001', status: 'Active',
  },
  {
    id: 'INV-005', name: 'Meridian Insurance Co.', pan: 'AABCM7890K', email: 'investments@meridianins.in', phone: '+91-22-4567-7890',
    type: 'Corporate', kycStatus: 'Verified', riskProfile: 'Moderate', onboardingDate: '15 Jun 2021',
    totalCommitment: 120000000, totalInvested: 113000000, currentPortfolioValue: 124540000, totalPnL: 11540000, totalPnLPercent: 10.21,
    funds: [], bankDetails: { bankName: 'SBI', accountNumber: 'XXXX7890', ifsc: 'SBIN0007890' },
    address: 'Fort, Mumbai 400001', status: 'Active',
  },
  {
    id: 'INV-006', name: 'Prakash Ambani Trust', pan: 'AATP1234L', email: 'trust@ambanioffice.in', phone: '+91-22-4567-3456',
    type: 'Trust', kycStatus: 'Verified', riskProfile: 'Conservative', onboardingDate: '01 Oct 2022',
    totalCommitment: 82000000, totalInvested: 78000000, currentPortfolioValue: 85380000, totalPnL: 7380000, totalPnLPercent: 9.46,
    funds: [], bankDetails: { bankName: 'HDFC Bank', accountNumber: 'XXXX1111', ifsc: 'HDFC0001111' },
    address: 'Altamount Road, Mumbai 400026', status: 'Active',
  },
  {
    id: 'INV-007', name: 'Ananya Venture Fund', pan: 'AABCA5678M', email: 'ops@ananyaventures.in', phone: '+91-80-4567-9012',
    type: 'Corporate', kycStatus: 'Verified', riskProfile: 'Very Aggressive', onboardingDate: '15 Mar 2024',
    totalCommitment: 25000000, totalInvested: 22000000, currentPortfolioValue: 25630000, totalPnL: 3630000, totalPnLPercent: 16.50,
    funds: [], bankDetails: { bankName: 'YES Bank', accountNumber: 'XXXX5555', ifsc: 'YESB0005555' },
    address: 'Indiranagar, Bangalore 560038', status: 'Active',
  },
];

// ============================================================
// RISK METRICS
// ============================================================
export const MOCK_RISK_METRICS: RiskMetrics[] = [
  {
    fundId: 'FUND-001', date: '14 Feb 2026',
    dailyReturn: 0.28, weeklyReturn: 1.42, monthlyReturn: 3.85, ytdReturn: 8.62, oneYearReturn: 22.45, threeYearReturn: 18.92, sinceInceptionReturn: 56.42,
    standardDeviation: 16.82, sharpeRatio: 1.34, sortinoRatio: 1.82, beta: 1.12, alpha: 4.25, treynorRatio: 12.85, informationRatio: 0.68, trackingError: 6.25,
    maxDrawdown: -14.82, currentDrawdown: -2.15, drawdownDuration: 18,
    var95: -2.48, var99: -3.85, cvar95: -3.42,
    top5HoldingsPercent: 78.2, top10HoldingsPercent: 100,
    sectorConcentration: [
      { sector: 'IT', percent: 37.1 }, { sector: 'Banking', percent: 30.8 }, { sector: 'Energy', percent: 22.3 },
      { sector: 'Telecom', percent: 7.8 }, { sector: 'Infrastructure', percent: 3.7 },
    ],
    herfindahlIndex: 0.185,
  },
  {
    fundId: 'FUND-002', date: '14 Feb 2026',
    dailyReturn: 0.12, weeklyReturn: 0.82, monthlyReturn: 2.15, ytdReturn: 5.24, oneYearReturn: 14.85, threeYearReturn: 12.45, sinceInceptionReturn: 28.65,
    standardDeviation: 10.45, sharpeRatio: 1.12, sortinoRatio: 1.48, beta: 0.72, alpha: 3.82, treynorRatio: 14.20, informationRatio: 0.52, trackingError: 4.85,
    maxDrawdown: -8.65, currentDrawdown: -0.85, drawdownDuration: 8,
    var95: -1.52, var99: -2.35, cvar95: -2.15,
    top5HoldingsPercent: 66.8, top10HoldingsPercent: 100,
    sectorConcentration: [
      { sector: 'Banking', percent: 26.7 }, { sector: 'Energy', percent: 16.8 }, { sector: 'IT', percent: 13.4 },
      { sector: 'FMCG', percent: 10.3 }, { sector: 'Banking', percent: 9.4 },
    ],
    herfindahlIndex: 0.145,
  },
  {
    fundId: 'FUND-003', date: '14 Feb 2026',
    dailyReturn: 0.82, weeklyReturn: 2.85, monthlyReturn: 5.42, ytdReturn: 12.18, oneYearReturn: 32.45, threeYearReturn: 0, sinceInceptionReturn: 42.18,
    standardDeviation: 24.65, sharpeRatio: 1.52, sortinoRatio: 2.15, beta: 1.45, alpha: 8.25, treynorRatio: 15.42, informationRatio: 0.82, trackingError: 10.25,
    maxDrawdown: -22.45, currentDrawdown: -4.25, drawdownDuration: 35,
    var95: -3.85, var99: -5.82, cvar95: -5.15,
    top5HoldingsPercent: 77.2, top10HoldingsPercent: 100,
    sectorConcentration: [
      { sector: 'Chemicals', percent: 39.4 }, { sector: 'IT', percent: 37.8 },
    ],
    herfindahlIndex: 0.225,
  },
  {
    fundId: 'FUND-004', date: '14 Feb 2026',
    dailyReturn: 0.18, weeklyReturn: 0.65, monthlyReturn: 1.82, ytdReturn: 4.15, oneYearReturn: 12.25, threeYearReturn: 0, sinceInceptionReturn: 18.92,
    standardDeviation: 12.85, sharpeRatio: 0.92, sortinoRatio: 1.18, beta: 0.65, alpha: 2.45, treynorRatio: 10.85, informationRatio: 0.38, trackingError: 5.42,
    maxDrawdown: -10.25, currentDrawdown: -1.45, drawdownDuration: 12,
    var95: -1.82, var99: -2.85, cvar95: -2.48,
    top5HoldingsPercent: 100, top10HoldingsPercent: 100,
    sectorConcentration: [
      { sector: 'Mining', percent: 33.7 }, { sector: 'FMCG', percent: 24.1 },
      { sector: 'Power', percent: 18.4 }, { sector: 'Energy', percent: 23.7 },
    ],
    herfindahlIndex: 0.215,
  },
];

// ============================================================
// COMPLIANCE RULES
// ============================================================
export const MOCK_COMPLIANCE_RULES: ComplianceRule[] = [
  { id: 'CR-001', name: 'Single Stock Exposure Limit', description: 'No single stock should exceed 25% of fund AUM', category: 'SEBI', parameter: 'Max single stock weight', limit: 25, currentValue: 24.6, status: 'Warning', warningThreshold: 22, lastChecked: '14 Feb 2026 15:30', fundId: 'FUND-001' },
  { id: 'CR-002', name: 'Sector Concentration Limit', description: 'No single sector should exceed 35% of fund AUM', category: 'SEBI', parameter: 'Max sector weight', limit: 35, currentValue: 37.1, status: 'Breach', warningThreshold: 30, lastChecked: '14 Feb 2026 15:30', fundId: 'FUND-001' },
  { id: 'CR-003', name: 'Minimum Diversification', description: 'Portfolio must hold minimum 5 stocks', category: 'Internal', parameter: 'Number of holdings', limit: 5, currentValue: 7, status: 'Compliant', warningThreshold: 6, lastChecked: '14 Feb 2026 15:30', fundId: 'FUND-001' },
  { id: 'CR-004', name: 'Cash Allocation Limit', description: 'Cash should not exceed 10% of AUM', category: 'Internal', parameter: 'Cash percentage', limit: 10, currentValue: 3.2, status: 'Compliant', warningThreshold: 7, lastChecked: '14 Feb 2026 15:30' },
  { id: 'CR-005', name: 'Single Investor Limit', description: 'Single investor should not exceed 40% of fund AUM', category: 'SEBI', parameter: 'Max investor weight', limit: 40, currentValue: 35.1, status: 'Warning', warningThreshold: 33, lastChecked: '14 Feb 2026 15:30', fundId: 'FUND-001' },
  { id: 'CR-006', name: 'Minimum AUM per Fund', description: 'Each fund must maintain minimum AUM of Rs 1 Cr', category: 'SEBI', parameter: 'Minimum AUM', limit: 10000000, currentValue: 95000000, status: 'Compliant', warningThreshold: 20000000, lastChecked: '14 Feb 2026 15:30', fundId: 'FUND-003' },
  { id: 'CR-007', name: 'Maximum Leverage', description: 'No leverage/margin trading allowed', category: 'SEBI', parameter: 'Leverage ratio', limit: 1, currentValue: 1, status: 'Compliant', warningThreshold: 1, lastChecked: '14 Feb 2026 15:30' },
  { id: 'CR-008', name: 'Derivatives Exposure', description: 'Derivatives for hedging only, max 20% of AUM', category: 'SEBI', parameter: 'Derivatives %', limit: 20, currentValue: 0, status: 'Compliant', warningThreshold: 15, lastChecked: '14 Feb 2026 15:30' },
  { id: 'CR-009', name: 'Related Party Transactions', description: 'No investment in group/related company securities', category: 'SEBI', parameter: 'Related party exposure', limit: 0, currentValue: 0, status: 'Compliant', warningThreshold: 0, lastChecked: '14 Feb 2026 15:30' },
  { id: 'CR-010', name: 'Smallcap Single Stock Limit', description: 'Smallcap single stock max 30% of fund', category: 'Internal', parameter: 'Max smallcap stock weight', limit: 30, currentValue: 30.9, status: 'Breach', warningThreshold: 25, lastChecked: '14 Feb 2026 15:30', fundId: 'FUND-003' },
  { id: 'CR-011', name: 'KYC Compliance', description: 'All investors must have valid KYC', category: 'SEBI', parameter: 'KYC status', limit: 100, currentValue: 100, status: 'Compliant', warningThreshold: 100, lastChecked: '14 Feb 2026 15:30' },
  { id: 'CR-012', name: 'NAV Disclosure', description: 'NAV must be disclosed daily to all investors', category: 'SEBI', parameter: 'NAV disclosure frequency', limit: 1, currentValue: 1, status: 'Compliant', warningThreshold: 1, lastChecked: '14 Feb 2026 15:30' },
];

// ============================================================
// MODEL PORTFOLIOS
// ============================================================
export const MOCK_MODEL_PORTFOLIOS: ModelPortfolio[] = [
  {
    id: 'MP-001', name: 'Aggressive Multi-Cap Model', description: 'High conviction multi-cap model targeting market-beating returns',
    benchmarkIndex: 'Nifty 50 TRI', riskCategory: 'High',
    targetAllocations: [
      { symbol: 'RELIANCE', name: 'Reliance Industries Ltd', sector: 'Energy', targetPercent: 20, currentPercent: 22.3, driftPercent: 2.3, action: 'Sell', actionQuantity: 150 },
      { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'IT', targetPercent: 22, currentPercent: 24.6, driftPercent: 2.6, action: 'Sell', actionQuantity: 120 },
      { symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', sector: 'Banking', targetPercent: 18, currentPercent: 19.6, driftPercent: 1.6, action: 'Sell', actionQuantity: 100 },
      { symbol: 'INFY', name: 'Infosys Ltd', sector: 'IT', targetPercent: 15, currentPercent: 12.5, driftPercent: -2.5, action: 'Buy', actionQuantity: 200 },
      { symbol: 'ICICIBANK', name: 'ICICI Bank Ltd', sector: 'Banking', targetPercent: 12, currentPercent: 11.2, driftPercent: -0.8, action: 'Hold' },
      { symbol: 'BHARTIARTL', name: 'Bharti Airtel Ltd', sector: 'Telecom', targetPercent: 8, currentPercent: 7.8, driftPercent: -0.2, action: 'Hold' },
      { symbol: 'LT', name: 'Larsen & Toubro Ltd', sector: 'Infrastructure', targetPercent: 5, currentPercent: 3.7, driftPercent: -1.3, action: 'Buy', actionQuantity: 80 },
    ],
    createdDate: '01 Jan 2026', lastRebalanceDate: '01 Jan 2026', rebalanceFrequency: 'Quarterly', status: 'Active',
  },
  {
    id: 'MP-002', name: 'Balanced Income Model', description: 'Balanced model with income focus for moderate risk investors',
    benchmarkIndex: 'CRISIL Hybrid 35+65', riskCategory: 'Moderate',
    targetAllocations: [
      { symbol: 'HDFCBANK', name: 'HDFC Bank Ltd', sector: 'Banking', targetPercent: 16, currentPercent: 17.3, driftPercent: 1.3, action: 'Sell', actionQuantity: 50 },
      { symbol: 'RELIANCE', name: 'Reliance Industries Ltd', sector: 'Energy', targetPercent: 15, currentPercent: 16.8, driftPercent: 1.8, action: 'Sell', actionQuantity: 80 },
      { symbol: 'INFY', name: 'Infosys Ltd', sector: 'IT', targetPercent: 14, currentPercent: 13.4, driftPercent: -0.6, action: 'Hold' },
      { symbol: 'ITC', name: 'ITC Ltd', sector: 'FMCG', targetPercent: 10, currentPercent: 10.3, driftPercent: 0.3, action: 'Hold' },
      { symbol: 'SBIN', name: 'State Bank of India', sector: 'Banking', targetPercent: 10, currentPercent: 9.4, driftPercent: -0.6, action: 'Hold' },
    ],
    createdDate: '01 Apr 2025', lastRebalanceDate: '01 Jan 2026', rebalanceFrequency: 'Quarterly', status: 'Active',
  },
  {
    id: 'MP-003', name: 'High Growth Smallcap Model', description: 'Concentrated smallcap model for aggressive capital appreciation',
    benchmarkIndex: 'Nifty Smallcap 100 TRI', riskCategory: 'Very High',
    targetAllocations: [
      { symbol: 'DEEPAKNITRIT', name: 'Deepak Nitrite Ltd', sector: 'Chemicals', targetPercent: 28, currentPercent: 30.9, driftPercent: 2.9, action: 'Sell', actionQuantity: 60 },
      { symbol: 'AFFLE', name: 'Affle India Ltd', sector: 'IT', targetPercent: 12, currentPercent: 11.6, driftPercent: -0.4, action: 'Hold' },
      { symbol: 'ROUTE', name: 'Route Mobile Ltd', sector: 'IT', targetPercent: 12, currentPercent: 12.9, driftPercent: 0.9, action: 'Hold' },
      { symbol: 'CLEAN', name: 'Clean Science & Technology', sector: 'Chemicals', targetPercent: 10, currentPercent: 8.5, driftPercent: -1.5, action: 'Buy', actionQuantity: 50 },
      { symbol: 'HAPPSTMNDS', name: 'Happiest Minds Technologies', sector: 'IT', targetPercent: 13, currentPercent: 13.3, driftPercent: 0.3, action: 'Hold' },
    ],
    createdDate: '01 Oct 2022', lastRebalanceDate: '15 Jan 2026', rebalanceFrequency: 'Monthly', status: 'Active',
  },
];

// ============================================================
// FEE CALCULATIONS
// ============================================================
export const MOCK_FEE_CALCULATIONS: FeeCalculation[] = [
  { id: 'FEE-001', fundId: 'FUND-001', fundName: 'Alpha Growth', investorId: 'INV-001', investorName: 'Vanguard Capital Partners', period: 'Q3 FY2025-26', periodStart: '01 Oct 2025', periodEnd: '31 Dec 2025', openingValue: 98500000, closingValue: 105200000, netInflow: 0, managementFee: 502500, performanceFee: 680000, totalFee: 1182500, previousHighWaterMark: 148.50, newHighWaterMark: 152.80, excessReturn: 6.80, hurdleReturn: 2.50, status: 'Invoiced' },
  { id: 'FEE-002', fundId: 'FUND-001', fundName: 'Alpha Growth', investorId: 'INV-002', investorName: 'Sunrise Family Office', period: 'Q3 FY2025-26', periodStart: '01 Oct 2025', periodEnd: '31 Dec 2025', openingValue: 74500000, closingValue: 79800000, netInflow: 0, managementFee: 381000, performanceFee: 530000, totalFee: 911000, previousHighWaterMark: 148.50, newHighWaterMark: 152.80, excessReturn: 7.11, hurdleReturn: 2.50, status: 'Paid' },
  { id: 'FEE-003', fundId: 'FUND-002', fundName: 'Stable Value', investorId: 'INV-001', investorName: 'Vanguard Capital Partners', period: 'Q3 FY2025-26', periodStart: '01 Oct 2025', periodEnd: '31 Dec 2025', openingValue: 49200000, closingValue: 51800000, netInflow: 0, managementFee: 192000, performanceFee: 195000, totalFee: 387000, previousHighWaterMark: 124.20, newHighWaterMark: 126.40, excessReturn: 5.28, hurdleReturn: 2.00, status: 'Approved' },
  { id: 'FEE-004', fundId: 'FUND-003', fundName: 'Emerging Leaders', investorId: 'INV-002', investorName: 'Sunrise Family Office', period: 'Q3 FY2025-26', periodStart: '01 Oct 2025', periodEnd: '31 Dec 2025', openingValue: 38200000, closingValue: 40500000, netInflow: 0, managementFee: 237500, performanceFee: 230000, totalFee: 467500, previousHighWaterMark: 135.20, newHighWaterMark: 138.50, excessReturn: 6.02, hurdleReturn: 3.00, status: 'Draft' },
  { id: 'FEE-005', fundId: 'FUND-001', fundName: 'Alpha Growth', investorId: 'INV-003', investorName: 'Ratan P. Thapar (HUF)', period: 'Q3 FY2025-26', periodStart: '01 Oct 2025', periodEnd: '31 Dec 2025', openingValue: 49800000, closingValue: 53100000, netInflow: 0, managementFee: 252000, performanceFee: 330000, totalFee: 582000, previousHighWaterMark: 148.50, newHighWaterMark: 152.80, excessReturn: 6.63, hurdleReturn: 2.50, status: 'Draft' },
  { id: 'FEE-006', fundId: 'FUND-004', fundName: 'Dividend Yield', investorId: 'INV-005', investorName: 'Meridian Insurance Co.', period: 'Q3 FY2025-26', periodStart: '01 Oct 2025', periodEnd: '31 Dec 2025', openingValue: 39500000, closingValue: 40800000, netInflow: 0, managementFee: 150000, performanceFee: 65000, totalFee: 215000, previousHighWaterMark: 115.80, newHighWaterMark: 117.20, excessReturn: 3.29, hurdleReturn: 2.00, status: 'Invoiced' },
];

// ============================================================
// BENCHMARK DATA (Monthly NAV vs Benchmark)
// ============================================================
export const MOCK_BENCHMARK_DATA: BenchmarkData[] = [
  { date: 'Jan 2025', nifty50: 21850, sensex: 72100, niftyNext50: 58200, niftyMidcap100: 48500, niftySmallcap100: 14800, niftyBank: 46500, niftyIT: 38200, niftyPharma: 19800, fundNav: 128.50 },
  { date: 'Feb 2025', nifty50: 22100, sensex: 72800, niftyNext50: 59100, niftyMidcap100: 49200, niftySmallcap100: 15100, niftyBank: 47200, niftyIT: 39500, niftyPharma: 20100, fundNav: 131.20 },
  { date: 'Mar 2025', nifty50: 22450, sensex: 73500, niftyNext50: 59800, niftyMidcap100: 49800, niftySmallcap100: 15400, niftyBank: 47800, niftyIT: 40200, niftyPharma: 20500, fundNav: 133.80 },
  { date: 'Apr 2025', nifty50: 22200, sensex: 73100, niftyNext50: 59200, niftyMidcap100: 49100, niftySmallcap100: 15000, niftyBank: 47000, niftyIT: 39800, niftyPharma: 20200, fundNav: 132.10 },
  { date: 'May 2025', nifty50: 22600, sensex: 74200, niftyNext50: 60100, niftyMidcap100: 50200, niftySmallcap100: 15600, niftyBank: 48200, niftyIT: 40800, niftyPharma: 20800, fundNav: 135.50 },
  { date: 'Jun 2025', nifty50: 22900, sensex: 75100, niftyNext50: 60800, niftyMidcap100: 50800, niftySmallcap100: 15900, niftyBank: 48800, niftyIT: 41500, niftyPharma: 21200, fundNav: 138.20 },
  { date: 'Jul 2025', nifty50: 23200, sensex: 76000, niftyNext50: 61500, niftyMidcap100: 51500, niftySmallcap100: 16200, niftyBank: 49500, niftyIT: 42200, niftyPharma: 21600, fundNav: 140.80 },
  { date: 'Aug 2025', nifty50: 23500, sensex: 77200, niftyNext50: 62200, niftyMidcap100: 52200, niftySmallcap100: 16500, niftyBank: 50200, niftyIT: 42800, niftyPharma: 22000, fundNav: 143.50 },
  { date: 'Sep 2025', nifty50: 23100, sensex: 75800, niftyNext50: 61200, niftyMidcap100: 51200, niftySmallcap100: 15800, niftyBank: 49200, niftyIT: 41800, niftyPharma: 21500, fundNav: 141.20 },
  { date: 'Oct 2025', nifty50: 23400, sensex: 76800, niftyNext50: 62000, niftyMidcap100: 52000, niftySmallcap100: 16100, niftyBank: 50000, niftyIT: 42500, niftyPharma: 22200, fundNav: 144.80 },
  { date: 'Nov 2025', nifty50: 23800, sensex: 78200, niftyNext50: 63200, niftyMidcap100: 53000, niftySmallcap100: 16800, niftyBank: 51200, niftyIT: 43500, niftyPharma: 22800, fundNav: 148.50 },
  { date: 'Dec 2025', nifty50: 24200, sensex: 79500, niftyNext50: 64000, niftyMidcap100: 53800, niftySmallcap100: 17200, niftyBank: 52000, niftyIT: 44200, niftyPharma: 23200, fundNav: 152.80 },
  { date: 'Jan 2026', nifty50: 24500, sensex: 80200, niftyNext50: 64800, niftyMidcap100: 54500, niftySmallcap100: 17500, niftyBank: 52800, niftyIT: 45000, niftyPharma: 23800, fundNav: 155.18 },
  { date: 'Feb 2026', nifty50: 24800, sensex: 81500, niftyNext50: 65500, niftyMidcap100: 55200, niftySmallcap100: 17800, niftyBank: 53500, niftyIT: 45800, niftyPharma: 24200, fundNav: 156.42 },
];

// ============================================================
// REPORTS
// ============================================================
export const MOCK_REPORTS: Report[] = [
  { id: 'RPT-001', name: 'Monthly Performance Report - Jan 2026', type: 'Performance', fundId: 'FUND-001', periodStart: '01 Jan 2026', periodEnd: '31 Jan 2026', generatedDate: '02 Feb 2026', generatedBy: 'System', status: 'Sent', format: 'PDF' },
  { id: 'RPT-002', name: 'Holdings Report - Alpha Growth Fund', type: 'Holdings', fundId: 'FUND-001', periodStart: '01 Feb 2026', periodEnd: '14 Feb 2026', generatedDate: '14 Feb 2026', generatedBy: 'Rajesh Sharma', status: 'Generated', format: 'Excel' },
  { id: 'RPT-003', name: 'Client Statement - Vanguard Capital', type: 'Client Statement', investorId: 'INV-001', periodStart: '01 Oct 2025', periodEnd: '31 Dec 2025', generatedDate: '05 Jan 2026', generatedBy: 'System', status: 'Sent', format: 'PDF' },
  { id: 'RPT-004', name: 'Risk Analytics Report - Q3 FY26', type: 'Risk', periodStart: '01 Oct 2025', periodEnd: '31 Dec 2025', generatedDate: '05 Jan 2026', generatedBy: 'Risk Team', status: 'Generated', format: 'PDF' },
  { id: 'RPT-005', name: 'Compliance Report - Feb 2026', type: 'Compliance', periodStart: '01 Feb 2026', periodEnd: '14 Feb 2026', generatedDate: '14 Feb 2026', generatedBy: 'Compliance Officer', status: 'Draft', format: 'PDF' },
  { id: 'RPT-006', name: 'Fee Schedule - Q3 FY26', type: 'Fee', periodStart: '01 Oct 2025', periodEnd: '31 Dec 2025', generatedDate: '08 Jan 2026', generatedBy: 'Finance Team', status: 'Sent', format: 'Excel' },
  { id: 'RPT-007', name: 'Transaction Report - Jan 2026', type: 'Transaction', periodStart: '01 Jan 2026', periodEnd: '31 Jan 2026', generatedDate: '02 Feb 2026', generatedBy: 'System', status: 'Sent', format: 'CSV' },
  { id: 'RPT-008', name: 'Attribution Analysis - Alpha Growth', type: 'Attribution', fundId: 'FUND-001', periodStart: '01 Jan 2026', periodEnd: '31 Jan 2026', generatedDate: '02 Feb 2026', generatedBy: 'Risk Team', status: 'Generated', format: 'PDF' },
  { id: 'RPT-009', name: 'MIS Report - Jan 2026', type: 'MIS', periodStart: '01 Jan 2026', periodEnd: '31 Jan 2026', generatedDate: '02 Feb 2026', generatedBy: 'System', status: 'Sent', format: 'Excel' },
];

// ============================================================
// DASHBOARD KPIs
// ============================================================
export const MOCK_DASHBOARD_KPIS: DashboardKPIs = {
  totalAUM: 630000000, // 63 Cr
  aumChange: 2.85,
  totalFunds: 4,
  activeFunds: 4,
  totalInvestors: 7,
  activeInvestors: 7,
  totalPnL: 76200000, // 7.62 Cr
  totalPnLPercent: 13.75,
  todayPnL: 1850000, // 18.5L
  todayPnLPercent: 0.29,
  ytdReturn: 8.62,
  bestFund: { name: 'Emerging Leaders', return: 12.18 },
  worstFund: { name: 'Dividend Yield', return: 4.15 },
  pendingOrders: 3,
  complianceAlerts: 4,
  pendingSettlements: 2,
};

// ============================================================
// HELPER: Format Indian currency
// ============================================================
export const formatINR = (value: number, showDecimals = true): string => {
  const absValue = Math.abs(value);
  let formatted: string;

  if (absValue >= 10000000) {
    formatted = (absValue / 10000000).toFixed(showDecimals ? 2 : 0) + ' Cr';
  } else if (absValue >= 100000) {
    formatted = (absValue / 100000).toFixed(showDecimals ? 2 : 0) + ' L';
  } else {
    formatted = absValue.toLocaleString('en-IN', { minimumFractionDigits: showDecimals ? 2 : 0, maximumFractionDigits: 2 });
  }
  return (value < 0 ? '-' : '') + '\u20B9' + formatted;
};

export const formatPercent = (value: number): string => {
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)}%`;
};

export const formatNumber = (value: number): string => {
  return value.toLocaleString('en-IN');
};
