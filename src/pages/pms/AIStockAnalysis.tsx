import React, { useState, useCallback, useEffect } from 'react';
import {
  Layout, Card, Row, Col, Typography, Space, Button, Spin, Divider, Tag,
  Breadcrumb, Tabs, Empty, message, Drawer, Tooltip, Badge, Input,
} from 'antd';
import {
  HomeOutlined, ArrowLeftOutlined, ReloadOutlined, SettingOutlined,
  RiseOutlined, FallOutlined, BulbOutlined, ShoppingCartOutlined,
  DeleteOutlined, CopyOutlined,
} from '@ant-design/icons';
import type { TabsProps } from 'antd';
import { useNavigate } from 'react-router-dom';
import { ApiKeySettingsModal, getSavedApiKey } from '../../components/ApiKeySettingsModal';

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;

const COLORS = {
  primary: '#C74634',
  green: '#1D7B4D',
  red: '#D32F2F',
  blue: '#1565C0',
  orange: '#E65100',
};

const createAnalysisPrompts = (symbol: string, symbolName: string, cmp: number, qty: number, exchange: string): AnalysisPrompt[] => [
  {
    id: 'general',
    category: 'General',
    title: 'Company Overview',
    prompt: `Provide a brief overview of ${symbol} (${symbolName}). Include: business segments, market position, headquarters location, and key achievements. Keep it concise (200-300 words).`,
    status: 'pending',
  },
  {
    id: 'financials',
    category: 'Financials',
    title: 'Financial Health & Growth',
    prompt: `Analyze the financial health of ${symbol}. Include: revenue growth trends, profitability, debt levels, cash flow, EBITDA margins, and key financial ratios. Current price: ₹${cmp}. (300-400 words)`,
    status: 'pending',
  },
  {
    id: 'news',
    category: 'News',
    title: 'Recent News & Developments',
    prompt: `What are the latest significant news, announcements, and developments for ${symbol}? Include recent earnings, management changes, strategic initiatives, or market events. (250-350 words)`,
    status: 'pending',
  },
  {
    id: 'technical',
    category: 'Technical',
    title: 'Technical Analysis',
    prompt: `Provide technical analysis for ${symbol} at current price ₹${cmp}. Include: support/resistance levels, trend analysis, momentum indicators, and key technical patterns. (250-350 words)`,
    status: 'pending',
  },
  {
    id: 'recommendations',
    category: 'Recommendations',
    title: 'Investment Recommendation',
    prompt: `Give a clear investment recommendation for ${symbol} (current price ₹${cmp}). Include: BUY/SELL/HOLD rating, target price, timeframe, confidence level (%), and key reasons for your recommendation. (300-400 words)`,
    status: 'pending',
  },
  {
    id: 'peers',
    category: 'Peers',
    title: 'Peer Comparison',
    prompt: `How does ${symbol} compare to its peer companies in the same sector? Include competitive advantages, market share position, and relative valuation. (250-350 words)`,
    status: 'pending',
  },
  {
    id: 'risks',
    category: 'Risk',
    title: 'Risks & Challenges',
    prompt: `What are the main risks and challenges for ${symbol}? Include market risks, regulatory risks, competition, and company-specific risks. How might these impact the stock? (250-350 words)`,
    status: 'pending',
  },
];

interface StockData {
  symbol: string;
  symbolName: string;
  exchange: string;
  cmp: number;
  qty: number;
  shareType: string;
}

interface AnalysisPrompt {
  id: string;
  category: 'General' | 'Financials' | 'News' | 'Technical' | 'Recommendations' | 'Peers' | 'Risk';
  title: string;
  prompt: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  response?: string;
  error?: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export default function AIStockAnalysis() {
  const navigate = useNavigate();
  const [stock, setStock] = useState<StockData | null>(null);
  const [analysisPrompts, setAnalysisPrompts] = useState<AnalysisPrompt[]>([]);
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState<string>(getSavedApiKey() || '');
  const [msgApi, ctxHolder] = message.useMessage();
  const [logs, setLogs] = useState<Array<{ time: string; level: 'info' | 'error' | 'success' | 'warn'; message: string; details?: string }>>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [priceMovement, setPriceMovement] = useState<{ percentage: number; isUp: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [exchangeRates, setExchangeRates] = useState({ usd: 1 / 83, aed: 1 / 22.5 }); // Default fallback: 1 INR = X currency

  const addLog = useCallback((level: 'info' | 'error' | 'success' | 'warn', message: string, details?: string) => {
    const now = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { time: now, level, message, details }]);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const refreshPrice = useCallback(async () => {
    if (!stock) return;
    setRefreshing(true);
    addLog('info', 'Fetching exchange rates and price data');
    try {
      // Fetch exchange rates (1 INR = ? USD/AED, so multiply not divide)
      const ratesResponse = await fetch('https://api.exchangerate-api.com/v4/latest/INR');
      addLog('info', 'Exchange rates API response', `Status: ${ratesResponse.status}, OK: ${ratesResponse.ok}`);
      if (ratesResponse.ok) {
        const ratesData = await ratesResponse.json();
        addLog('info', 'Raw API response', JSON.stringify(ratesData, null, 2));
        // API returns 1 INR = X currency, we need these values to multiply
        const usdRate = ratesData.rates?.USD || (1 / 83);
        const aedRate = ratesData.rates?.AED || (1 / 22.5);
        addLog('info', 'Processing rates', `Raw USD: ${ratesData.rates?.USD}, Calculated: ${usdRate}, 1/83: ${(1/83).toFixed(6)}`);
        setExchangeRates({ usd: usdRate, aed: aedRate });
        addLog('success', 'Exchange rates updated', `1 INR = ${usdRate.toFixed(6)} USD, 1 INR = ${aedRate.toFixed(6)} AED`);
      }

      // Fetch price movement data
      const priceResponse = await fetch(
        `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${stock.symbol}?modules=price`
      );
      if (priceResponse.ok) {
        const priceData = await priceResponse.json();
        const changePercent = priceData.quoteSummary?.result?.[0]?.price?.regularMarketChangePercent;

        if (changePercent !== undefined) {
          setPriceMovement({
            percentage: Math.abs(changePercent),
            isUp: changePercent >= 0,
          });
          addLog('success', 'Price movement updated', `Change: ${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%`);
          msgApi.success('Exchange rates and price data updated');
        }
      }
    } catch (error) {
      addLog('warn', 'Unable to fetch live data', error instanceof Error ? error.message : 'Using cached rates');
    } finally {
      setRefreshing(false);
    }
  }, [stock, msgApi, addLog]);

  const sendPrompt = useCallback(async (question: string) => {
    if (!question.trim() || !stock || !apiKey) {
      if (!apiKey) {
        msgApi.error('Please set your Claude API key first');
        setSettingsOpen(true);
      }
      return;
    }

    setChatLoading(true);
    const userMsgId = `msg_${Date.now()}`;
    setChatMessages(prev => [...prev, {
      id: userMsgId,
      role: 'user',
      content: question,
      timestamp: new Date().toLocaleTimeString(),
    }]);
    setChatInput('');

    try {
      const prompt = `You are analyzing ${stock.symbol} (${stock.symbolName}). The user has this question about the stock:

"${question}"

Provide a concise, helpful answer based on the stock's fundamentals, market position, and general knowledge. Keep the response focused and practical.`;

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-opus-5',
          max_tokens: 1000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: { message: 'API error' } }));
        throw new Error(errorData.error?.message || `HTTP ${response.status}`);
      }

      const data = await response.json();
      const textBlock = data.content?.find((c: any) => c.type === 'text');
      const responseText = textBlock?.text;

      if (!responseText) {
        throw new Error('No response from Claude API');
      }

      setChatMessages(prev => [...prev, {
        id: `msg_${Date.now()}`,
        role: 'assistant',
        content: responseText,
        timestamp: new Date().toLocaleTimeString(),
      }]);
    } catch (error) {
      msgApi.error(`Failed to get response: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setChatLoading(false);
    }
  }, [stock, apiKey, msgApi]);

  useEffect(() => {
    const stockData = localStorage.getItem('selectedStock');
    if (stockData) {
      try {
        setStock(JSON.parse(stockData));
      } catch {
        msgApi.error('Failed to load stock data');
        navigate('/pms/holdings');
      }
    } else {
      navigate('/pms/holdings');
    }
  }, [navigate, msgApi]);

  useEffect(() => {
    addLog('info', 'Exchange rates state changed', `USD rate: ${exchangeRates.usd.toFixed(6)}, AED rate: ${exchangeRates.aed.toFixed(6)}`);
  }, [exchangeRates, addLog]);

  const analyzeStock = useCallback(async () => {
    if (!stock) return;
    if (!apiKey) {
      addLog('error', 'API key not configured', 'Please set your Claude API key in settings');
      msgApi.error('Please set your Claude API key first');
      setSettingsOpen(true);
      return;
    }

    setLoading(true);
    clearLogs();

    try {
      addLog('info', 'Starting stock analysis', `Analyzing ${stock.symbol}`);

      const prompts = createAnalysisPrompts(stock.symbol, stock.symbolName, stock.cmp, stock.qty, stock.exchange);
      setAnalysisPrompts(prompts);

      addLog('info', 'Created analysis prompts', `Total: ${prompts.length} prompts across ${new Set(prompts.map(p => p.category)).size} categories`);

      const results = await Promise.allSettled(
        prompts.map(async (prompt) => {
          setAnalysisPrompts(prev => prev.map(p => p.id === prompt.id ? { ...p, status: 'running' } : p));
          addLog('info', `Running prompt: ${prompt.title}`, prompt.prompt.substring(0, 100) + '...');

          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            },
            body: JSON.stringify({
              model: 'claude-opus-5',
              max_tokens: 1000,
              messages: [{ role: 'user', content: prompt.prompt }],
            }),
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: { message: 'API error' } }));
            throw new Error(errorData.error?.message || `HTTP ${response.status}`);
          }

          const data = await response.json();
          const textBlock = data.content?.find((c: any) => c.type === 'text');
          const responseText = textBlock?.text;

          if (!responseText) {
            throw new Error('No text content in response');
          }

          addLog('success', `Completed: ${prompt.title}`, `Tokens: ${data.usage?.output_tokens}`);

          return { id: prompt.id, response: responseText };
        })
      );

      const completed = results.filter((r): r is PromiseFulfilledResult<{ id: string; response: string }> => r.status === 'fulfilled');
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

      setAnalysisPrompts(prev =>
        prev.map(p => {
          const result = completed.find(c => c.value.id === p.id);
          if (result) {
            return { ...p, status: 'completed', response: result.value.response };
          }
          if (failed.some(f => f.reason?.includes?.(p.id))) {
            return { ...p, status: 'error' };
          }
          return p;
        })
      );

      addLog('success', 'Analysis completed', `Completed: ${completed.length}/${prompts.length} prompts`);
      msgApi.success(`Analysis completed: ${completed.length}/${prompts.length} prompts successful`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      addLog('error', 'Analysis failed', errorMsg);
      msgApi.error(`Analysis failed: ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  }, [stock, apiKey, msgApi, addLog, clearLogs]);

  const recommendationPrompt = analysisPrompts.find(p => p.id === 'recommendations');
  const parseRecommendation = useCallback(() => {
    if (!recommendationPrompt?.response) return null;
    const text = recommendationPrompt.response;
    const buyMatch = text.match(/BUY/i);
    const sellMatch = text.match(/SELL/i);
    const holdMatch = text.match(/HOLD/i);

    let action = 'HOLD';
    if (buyMatch) action = 'BUY';
    else if (sellMatch) action = 'SELL';

    return { action };
  }, [recommendationPrompt]);

  const handlePlaceOrder = useCallback(() => {
    if (!stock) return;
    const rec = parseRecommendation();
    if (!rec) return;
    const url = `https://www.icicidirect.com/trading?symbol=${stock.symbol}&action=${rec.action}`;
    window.open(url, '_blank');
  }, [stock, parseRecommendation]);

  if (!stock) {
    return <Spin />;
  }

  const recommendation = parseRecommendation();
  const isPositive = recommendation?.action === 'BUY';

  const getLogColor = (level: string) => {
    switch (level) {
      case 'error': return '#d32f2f';
      case 'success': return '#1d7b4d';
      case 'warn': return '#e65100';
      default: return '#1565c0';
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'General': return 'blue';
      case 'Financials': return 'green';
      case 'News': return 'orange';
      case 'Technical': return 'purple';
      case 'Recommendations': return 'red';
      case 'Peers': return 'cyan';
      case 'Risk': return 'volcano';
      default: return 'default';
    }
  };

  const tabItems: TabsProps['items'] = [
    {
      key: '1',
      label: 'Analysis',
      children: (
        <Spin spinning={loading}>
          {analysisPrompts.length === 0 ? (
            <Empty description="Click 'Analyze' to generate AI analysis" />
          ) : (
            <Row gutter={16}>
              <Col xs={24} sm={16}>
                <Space direction="vertical" style={{ width: '100%', gap: 16 }}>
                  {analysisPrompts
                    .filter(p => p.status === 'completed' && p.response)
                    .map(prompt => (
                      <Card
                        key={prompt.id}
                        size="small"
                        title={
                          <Space>
                            <Tag color={getCategoryColor(prompt.category)}>{prompt.category}</Tag>
                            <span>{prompt.title}</span>
                          </Space>
                        }
                        style={{ borderRadius: 8 }}
                      >
                        <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{prompt.response}</Paragraph>
                      </Card>
                    ))}
                </Space>
              </Col>
              <Col xs={24} sm={8}>
                <Card size="small" title="Analysis Prompts" style={{ borderRadius: 8, position: 'sticky', top: 0 }}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {analysisPrompts.map(prompt => (
                      <div
                        key={prompt.id}
                        style={{
                          padding: 8,
                          borderRadius: 4,
                          background: prompt.status === 'completed' ? '#f6ffed' :
                                     prompt.status === 'error' ? '#fff1f0' :
                                     prompt.status === 'running' ? '#e6f7ff' : '#fafafa',
                          borderLeft: `3px solid ${
                            prompt.status === 'completed' ? '#52c41a' :
                            prompt.status === 'error' ? '#ff4d4f' :
                            prompt.status === 'running' ? '#1890ff' : '#d9d9d9'
                          }`,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Tag color={getCategoryColor(prompt.category)} style={{ margin: 0 }}>
                            {prompt.category}
                          </Tag>
                          {prompt.status === 'completed' && <span style={{ color: '#52c41a', fontSize: 12 }}>✓</span>}
                          {prompt.status === 'error' && <span style={{ color: '#ff4d4f', fontSize: 12 }}>✗</span>}
                          {prompt.status === 'running' && <span style={{ color: '#1890ff', fontSize: 12 }}>⟳</span>}
                        </div>
                        <div style={{ fontSize: 11, marginTop: 4, fontWeight: 500 }}>
                          {prompt.title}
                        </div>
                        {prompt.status === 'error' && (
                          <div style={{ fontSize: 10, color: '#ff4d4f', marginTop: 4 }}>
                            {prompt.error || 'Failed'}
                          </div>
                        )}
                      </div>
                    ))}
                  </Space>
                </Card>
              </Col>
            </Row>
          )}
        </Spin>
      ),
    },
    {
      key: '2',
      label: 'Recommendation',
      children: recommendationPrompt?.status === 'completed' && recommendationPrompt?.response ? (
        <Space direction="vertical" style={{ width: '100%', gap: 16 }}>
          <Card size="small" style={{ borderRadius: 8, borderLeft: `4px solid ${isPositive ? COLORS.green : COLORS.red}` }}>
            <Row gutter={16} align="middle">
              <Col>
                <div style={{ fontSize: 32, color: isPositive ? COLORS.green : COLORS.red }}>
                  {isPositive ? <RiseOutlined /> : <FallOutlined />}
                </div>
              </Col>
              <Col flex="auto">
                <div>
                  <div style={{ fontSize: 12, color: '#8c8c8c', marginBottom: 4 }}>Recommendation</div>
                  <Text
                    strong
                    style={{
                      fontSize: 24,
                      color: isPositive ? COLORS.green : COLORS.red,
                    }}
                  >
                    {recommendation?.action || 'HOLD'}
                  </Text>
                </div>
              </Col>
            </Row>
          </Card>

          <Card size="small" style={{ borderRadius: 8 }}>
            <Row gutter={16}>
              <Col xs={12}>
                <div style={{ marginBottom: 8 }}>
                  <Text style={{ fontSize: 11, color: '#8c8c8c' }}>Current Price</Text>
                </div>
                <Text strong style={{ fontSize: 18, color: COLORS.blue }}>
                  ₹{stock.cmp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </Text>
              </Col>
            </Row>
          </Card>

          <Card size="small" title="Investment Analysis" style={{ borderRadius: 8 }}>
            <Paragraph style={{ whiteSpace: 'pre-wrap' }}>{recommendationPrompt.response}</Paragraph>
          </Card>

          <Button
            type="primary"
            size="large"
            icon={<ShoppingCartOutlined />}
            block
            onClick={handlePlaceOrder}
          >
            Place Order on ICICI Direct
          </Button>
        </Space>
      ) : (
        <Empty description="Run analysis first to see recommendations" />
      ),
    },
    {
      key: '3',
      label: 'Prompt',
      children: (
        <Space direction="vertical" style={{ width: '100%' }}>
          <div style={{
            background: '#f5f5f5',
            border: '1px solid #d9d9d9',
            borderRadius: 4,
            padding: 12,
            maxHeight: '400px',
            overflowY: 'auto',
            marginBottom: 12,
          }}>
            {chatMessages.length === 0 ? (
              <Empty description="Ask Claude about this stock" />
            ) : (
              chatMessages.map(msg => (
                <div
                  key={msg.id}
                  style={{
                    marginBottom: 12,
                    paddingBottom: 12,
                    borderBottom: '1px solid #e8e8e8',
                  }}
                >
                  <div style={{
                    display: 'flex',
                    justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    marginBottom: 4,
                  }}>
                    <Tag color={msg.role === 'user' ? 'blue' : 'green'}>
                      {msg.role === 'user' ? 'You' : 'Claude'}
                    </Tag>
                    <span style={{ fontSize: 10, color: '#8c8c8c', marginLeft: 8 }}>
                      {msg.timestamp}
                    </span>
                  </div>
                  <div style={{
                    background: msg.role === 'user' ? '#e3f2fd' : '#e8f5e9',
                    borderRadius: 4,
                    padding: 8,
                    marginLeft: msg.role === 'user' ? '40px' : '0px',
                    marginRight: msg.role === 'user' ? '0px' : '40px',
                  }}>
                    <Text style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</Text>
                  </div>
                </div>
              ))
            )}
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <Input
              placeholder="Ask Claude about this stock..."
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              onPressEnter={() => sendPrompt(chatInput)}
              disabled={chatLoading}
              allowClear
            />
            <Button
              type="primary"
              onClick={() => sendPrompt(chatInput)}
              loading={chatLoading}
              disabled={!chatInput.trim()}
            >
              Send
            </Button>
          </div>
        </Space>
      ),
    },
    {
      key: '4',
      label: (
        <Space size={4}>
          Logs
          {logs.length > 0 && <Badge count={logs.length} style={{ backgroundColor: COLORS.orange }} />}
        </Space>
      ),
      children: (
        <Space direction="vertical" style={{ width: '100%' }}>
          {logs.length > 0 && (
            <Button
              size="small"
              danger
              icon={<DeleteOutlined />}
              onClick={clearLogs}
            >
              Clear Logs
            </Button>
          )}
          {logs.length === 0 ? (
            <Empty description="No logs yet. Run analysis to see logs." />
          ) : (
            <div style={{
              background: '#f5f5f5',
              border: '1px solid #d9d9d9',
              borderRadius: 4,
              padding: 12,
              maxHeight: '600px',
              overflowY: 'auto',
              fontFamily: 'monospace',
              fontSize: 12,
            }}>
              {logs.map((log, idx) => (
                <div
                  key={idx}
                  style={{
                    marginBottom: 12,
                    paddingBottom: 12,
                    borderBottom: idx < logs.length - 1 ? '1px solid #e8e8e8' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, marginBottom: 4, alignItems: 'center' }}>
                    <span style={{ color: '#8c8c8c', minWidth: '90px' }}>{log.time}</span>
                    <Tag
                      color={
                        log.level === 'error' ? 'red' :
                        log.level === 'success' ? 'green' :
                        log.level === 'warn' ? 'orange' : 'blue'
                      }
                      style={{ margin: 0 }}
                    >
                      {log.level.toUpperCase()}
                    </Tag>
                    <span style={{ color: getLogColor(log.level), fontWeight: 500 }}>
                      {log.message}
                    </span>
                  </div>
                  {log.details && (
                    <div style={{
                      background: '#fff',
                      border: '1px solid #e8e8e8',
                      borderRadius: 2,
                      padding: 8,
                      marginTop: 4,
                      overflow: 'auto',
                      maxHeight: '200px',
                      color: '#595959',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}>
                      {log.details}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh', background: '#F0F2F5' }}>
      {ctxHolder}
      <Content style={{ padding: '16px 24px' }}>
        <Breadcrumb style={{ marginBottom: 12 }} items={[
          { title: <a onClick={() => navigate('/home')}><HomeOutlined /></a> },
          { title: <a onClick={() => navigate('/pms')}>Portfolio Management</a> },
          { title: <a onClick={() => navigate('/pms/holdings')}>Investment Holdings</a> },
          { title: 'AI Analysis' },
        ]} />

        <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
          <Col>
            <Space align="center">
              <Button
                type="text"
                icon={<ArrowLeftOutlined />}
                onClick={() => navigate('/pms/holdings')}
              />
              <div>
                <Title level={4} style={{ margin: 0, color: COLORS.primary }}>
                  <BulbOutlined /> AI Stock Analysis
                </Title>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Powered by Claude AI
                </Text>
              </div>
            </Space>
          </Col>
          <Col>
            <Space>
              <Button
                icon={<SettingOutlined />}
                onClick={() => setSettingsOpen(true)}
              >
                API Settings
              </Button>
              <Button
                type="primary"
                icon={<ReloadOutlined />}
                loading={loading}
                onClick={analyzeStock}
              >
                Analyze
              </Button>
            </Space>
          </Col>
        </Row>

        <Card style={{ marginBottom: 16, borderRadius: 8 }}>
          <Row gutter={[16, 16]} align="middle">
            {/* Left: Symbol & Details */}
            <Col xs={24} sm={12} lg={5}>
              <div>
                <Title level={4} style={{ margin: 0, color: COLORS.primary }}>
                  {stock.symbol}
                </Title>
                <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                  {stock.symbolName}
                </Text>
                <Space size={4}>
                  <Tag color="blue">{stock.exchange}</Tag>
                  <Tag color={stock.shareType === 'NRE' ? 'purple' : 'cyan'}>
                    {stock.shareType}
                  </Tag>
                </Space>
              </div>
            </Col>

            {/* Middle: Recommendation */}
            <Col xs={24} sm={12} lg={5}>
              <Card
                size="small"
                style={{
                  borderRadius: 8,
                  borderLeft: `4px solid ${recommendation?.action === 'BUY' ? COLORS.green : recommendation?.action === 'SELL' ? COLORS.red : COLORS.blue}`,
                  background: recommendation?.action === 'BUY' ? '#f6ffed' : recommendation?.action === 'SELL' ? '#fff1f0' : '#f5f5f5',
                }}
              >
                <div style={{ textAlign: 'center' }}>
                  <Text style={{ fontSize: 11, color: '#8c8c8c', display: 'block', marginBottom: 4 }}>
                    Recommendation
                  </Text>
                  <Text
                    strong
                    style={{
                      fontSize: 20,
                      color:
                        recommendation?.action === 'BUY'
                          ? COLORS.green
                          : recommendation?.action === 'SELL'
                            ? COLORS.red
                            : COLORS.blue,
                    }}
                  >
                    {recommendation?.action || 'HOLD'}
                  </Text>
                </div>
              </Card>
            </Col>

            {/* Price & Movement */}
            <Col xs={24} sm={12} lg={4}>
              <Row gutter={8} align="middle">
                <Col xs={24}>
                  <Text style={{ fontSize: 11, color: '#8c8c8c', display: 'block', marginBottom: 4 }}>
                    Current Price
                  </Text>
                  <Text strong style={{ fontSize: 18, fontFamily: 'monospace', color: COLORS.blue }}>
                    ₹{stock.cmp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </Text>
                </Col>
                {priceMovement && (
                  <Col xs={24}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                      <span style={{ fontSize: 14, color: priceMovement.isUp ? COLORS.green : COLORS.red }}>
                        {priceMovement.isUp ? <RiseOutlined /> : <FallOutlined />}
                      </span>
                      <Text
                        strong
                        style={{
                          color: priceMovement.isUp ? COLORS.green : COLORS.red,
                          fontSize: 12,
                        }}
                      >
                        {priceMovement.isUp ? '+' : '-'}{priceMovement.percentage.toFixed(2)}%
                      </Text>
                    </div>
                  </Col>
                )}
              </Row>
            </Col>

            {/* Quantity & Total Value */}
            <Col xs={24} sm={24} lg={7}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <div>
                  <Text style={{ fontSize: 11, color: '#8c8c8c', display: 'block', marginBottom: 4 }}>
                    Qty Held
                  </Text>
                  <Text strong style={{ fontSize: 16, fontFamily: 'monospace' }}>
                    {stock.qty.toLocaleString()}
                  </Text>
                </div>

                <Divider style={{ margin: '8px 0' }} />

                <div>
                  <Text style={{ fontSize: 11, color: '#8c8c8c', display: 'block', marginBottom: 4 }}>
                    Total Value (INR)
                  </Text>
                  <Text strong style={{ fontSize: 14, fontFamily: 'monospace', color: COLORS.primary }}>
                    ₹{(stock.cmp * stock.qty).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </Text>
                </div>

                <div>
                  <Text style={{ fontSize: 11, color: '#8c8c8c', display: 'block', marginBottom: 4 }}>
                    In USD
                  </Text>
                  <Text strong style={{ fontSize: 14, fontFamily: 'monospace', color: COLORS.blue }}>
                    ${((stock.cmp * stock.qty) * exchangeRates.usd).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </Text>
                </div>

                <div>
                  <Text style={{ fontSize: 11, color: '#8c8c8c', display: 'block', marginBottom: 4 }}>
                    In AED
                  </Text>
                  <Text strong style={{ fontSize: 14, fontFamily: 'monospace', color: COLORS.orange }}>
                    د.إ{((stock.cmp * stock.qty) * exchangeRates.aed).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </Text>
                </div>
              </Space>
            </Col>

            {/* Refresh Button */}
            <Col xs={24} sm={24} lg={3} style={{ textAlign: 'right' }}>
              <Button
                icon={<ReloadOutlined />}
                loading={refreshing}
                onClick={refreshPrice}
                title="Refresh stock price and daily movement"
              >
                Refresh
              </Button>
            </Col>
          </Row>
        </Card>

        <Card style={{ borderRadius: 8 }}>
          <Tabs items={tabItems} />
        </Card>
      </Content>

      <ApiKeySettingsModal
        visible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        apiKey={apiKey}
        onSave={setApiKey}
      />
    </Layout>
  );
}
