import React, { useState, useEffect } from 'react';
import { Button, Input, Table, Card, Space, Statistic, Spin, message, Form, Modal, Tag, Checkbox, InputNumber } from 'antd';
import { PlayCircleOutlined, StopOutlined, SettingOutlined, ReloadOutlined } from '@ant-design/icons';

export default function GLAccountAnalysis() {
  const [serverStatus, setServerStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [queryLoading, setQueryLoading] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState([]);
  const [settingsForm] = Form.useForm();
  const [messageApi] = message.useMessage();

  // Query parameters
  const [queryParams, setQueryParams] = useState({
    ledger_name: 'BUIMERC LEDGER',
    period_names: 'Jan-26',
    company: '01',
    account: '1222107',
  });

  const [results, setResults] = useState([]);
  const [summary, setSummary] = useState(null);

  // Check server status on mount
  useEffect(() => {
    checkServerStatus();
    loadCredentials();
    const interval = setInterval(checkServerStatus, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, []);

  async function checkServerStatus() {
    try {
      const response = await window.electronAPI.glMcpStatus();
      if (response.success) {
        setServerStatus(response.status);
      }
    } catch (err) {
      console.error('Failed to check GL MCP status:', err);
    }
  }

  async function fetchLogs() {
    try {
      const response = await window.electronAPI.glMcpGetLogs();
      if (response.success) {
        setLogs(response.logs || []);
        setShowLogs(true);
      } else {
        messageApi.error('Failed to fetch logs');
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
      messageApi.error(err.message);
    }
  }

  async function loadCredentials() {
    try {
      const creds = await window.electronAPI.glMcpGetCredentials();
      if (creds) {
        setCredentials(creds);
        settingsForm.setFieldsValue(creds);
      }
    } catch (err) {
      console.error('Failed to load credentials:', err);
    }
  }

  async function startServer() {
    setLoading(true);
    try {
      if (!credentials) {
        messageApi.error('Please configure Oracle credentials first');
        setShowSettings(true);
        return;
      }

      const response = await window.electronAPI.glMcpStart(credentials);
      if (response.success) {
        setServerStatus(response.status);
        messageApi.success('GL MCP Server started successfully');
      } else {
        messageApi.error(response.error || 'Failed to start server');
      }
    } catch (err) {
      messageApi.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function stopServer() {
    setLoading(true);
    try {
      const response = await window.electronAPI.glMcpStop();
      if (response.success) {
        setServerStatus(response.status);
        messageApi.success('GL MCP Server stopped');
      } else {
        messageApi.error('Failed to stop server');
      }
    } catch (err) {
      messageApi.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function saveCredentials(values) {
    setSettingsLoading(true);
    try {
      console.log('Saving GL credentials:', { ...values, password: '***' });
      const response = await window.electronAPI.glMcpSaveCredentials(values);
      console.log('Save response:', response);

      if (response?.success) {
        setCredentials(values);
        messageApi.success('Credentials saved successfully');
        setShowSettings(false);
      } else {
        const errorMsg = response?.error || 'Failed to save credentials';
        console.error('Save failed:', errorMsg);
        messageApi.error(errorMsg);
      }
    } catch (err) {
      console.error('Save error:', err);
      messageApi.error(`Error: ${err.message || 'Unknown error'}`);
    } finally {
      setSettingsLoading(false);
    }
  }

  async function queryGLData() {
    if (!serverStatus?.running) {
      messageApi.warning('GL MCP Server is not running. Start it first.');
      return;
    }

    setQueryLoading(true);
    try {
      // Mock API call (in real implementation, this would call the MCP server through the proxy)
      const mockData = [
        {
          key: '1',
          batchId: 638363,
          jeHeaderId: 602826,
          jeLineNumber: 1,
          accountDescription: 'BetterHome Client Ac (Rent Balance Receivable)',
          enteredDr: 110000,
          accountedDr: 110000,
          accountingDate: '05-JAN-2026',
          description: 'Transaction Number: 900041',
        },
        {
          key: '2',
          batchId: 638364,
          jeHeaderId: 602827,
          jeLineNumber: 1,
          accountDescription: 'BetterHome Client Ac (Rent Balance Receivable)',
          enteredDr: 50000,
          accountedDr: 50000,
          accountingDate: '06-JAN-2026',
          description: 'Transaction Number: 900042',
        },
      ];

      setResults(mockData);
      setSummary({
        totalDebit: 160000,
        count: 2,
        period: queryParams.period_names,
        account: queryParams.account,
      });
      messageApi.success(`Found ${mockData.length} GL transactions`);
    } catch (err) {
      messageApi.error(err.message);
    } finally {
      setQueryLoading(false);
    }
  }

  const columns = [
    { title: 'Batch ID', dataIndex: 'batchId', key: 'batchId', width: 100 },
    { title: 'JE Header ID', dataIndex: 'jeHeaderId', key: 'jeHeaderId', width: 100 },
    { title: 'Description', dataIndex: 'accountDescription', key: 'accountDescription', width: 300 },
    { title: 'Debit', dataIndex: 'enteredDr', key: 'enteredDr', width: 120, align: 'right', render: (v) => v?.toFixed(2) || '0.00' },
    { title: 'Date', dataIndex: 'accountingDate', key: 'accountingDate', width: 120 },
    { title: 'Note', dataIndex: 'description', key: 'description', width: 300 },
  ];

  return (
    <div style={{ padding: '24px', backgroundColor: '#f5f5f5', minHeight: '100vh' }}>
      <Card title="GL Account Analysis" style={{ marginBottom: '24px' }}>
        {/* Server Status & Controls */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ marginBottom: '12px', display: 'flex', gap: '16px', alignItems: 'center' }}>
            <div>
              <strong>Server Status: </strong>
              {serverStatus?.running ? (
                <Tag color="green">Running (PID: {serverStatus.pid})</Tag>
              ) : (
                <Tag color="red">Stopped</Tag>
              )}
            </div>
            <Space>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={startServer}
                loading={loading}
                disabled={serverStatus?.running}
              >
                Start Server
              </Button>
              <Button
                danger
                icon={<StopOutlined />}
                onClick={stopServer}
                loading={loading}
                disabled={!serverStatus?.running}
              >
                Stop Server
              </Button>
              <Button
                icon={<SettingOutlined />}
                onClick={() => setShowSettings(true)}
              >
                Settings
              </Button>
              <Button
                icon={<ReloadOutlined />}
                onClick={checkServerStatus}
              >
                Refresh
              </Button>
              <Button
                onClick={fetchLogs}
              >
                View Logs
              </Button>
            </Space>
          </div>

          {serverStatus?.running && (
            <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
              <strong>HTTP Endpoint (Claude Desktop):</strong> http://localhost:{credentials?.httpPort || 3001}<br/>
              <strong>Health Check:</strong> GET /health<br/>
              <strong>Execute Tool:</strong> POST /execute with {'{tool: "toolName", arguments: {...}'} }
            </div>
          )}
        </div>

        {/* Query Parameters */}
        <Card title="Query Parameters" size="small" style={{ marginBottom: '24px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label><strong>Ledger Name</strong></label>
              <Input
                value={queryParams.ledger_name}
                onChange={(e) => setQueryParams({ ...queryParams, ledger_name: e.target.value })}
                placeholder="e.g., BUIMERC LEDGER"
              />
            </div>
            <div>
              <label><strong>Period</strong></label>
              <Input
                value={queryParams.period_names}
                onChange={(e) => setQueryParams({ ...queryParams, period_names: e.target.value })}
                placeholder="e.g., Jan-26"
              />
            </div>
            <div>
              <label><strong>Company</strong></label>
              <Input
                value={queryParams.company}
                onChange={(e) => setQueryParams({ ...queryParams, company: e.target.value })}
                placeholder="e.g., 01"
              />
            </div>
            <div>
              <label><strong>Account Number</strong></label>
              <Input
                value={queryParams.account}
                onChange={(e) => setQueryParams({ ...queryParams, account: e.target.value })}
                placeholder="e.g., 1222107"
              />
            </div>
          </div>
          <Button
            type="primary"
            block
            onClick={queryGLData}
            loading={queryLoading}
            disabled={!serverStatus?.running}
          >
            Query GL Data
          </Button>
        </Card>

        {/* Results Summary */}
        {summary && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
            <Card size="small">
              <Statistic title="Total Debit" value={summary.totalDebit} precision={2} />
            </Card>
            <Card size="small">
              <Statistic title="Transaction Count" value={summary.count} />
            </Card>
            <Card size="small">
              <Statistic title="Period" value={summary.period} />
            </Card>
            <Card size="small">
              <Statistic title="Account" value={summary.account} />
            </Card>
          </div>
        )}

        {/* Results Table */}
        {results.length > 0 && (
          <Card title="GL Transactions" size="small">
            <Table
              columns={columns}
              dataSource={results}
              pagination={{ pageSize: 10 }}
              size="small"
            />
          </Card>
        )}
      </Card>

      {/* Settings Modal */}
      <Modal
        title="GL API Settings"
        open={showSettings}
        onOk={() => settingsForm.submit()}
        onCancel={() => {
          setShowSettings(false);
          setSettingsLoading(false);
        }}
        width={600}
        okButtonProps={{ loading: settingsLoading }}
        maskClosable={!settingsLoading}
      >
        <Form
          form={settingsForm}
          layout="vertical"
          onFinish={saveCredentials}
        >
          <Form.Item
            label="Oracle Base URL"
            name="oracleBaseUrl"
            rules={[{ required: true, message: 'Please enter Oracle base URL' }]}
          >
            <Input placeholder="https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com" />
          </Form.Item>

          <Form.Item
            label="Skip Authentication"
            name="skipAuth"
            valuePropName="checked"
            initialValue={false}
          >
            <Checkbox>Disable Basic Auth (for public APEX endpoints)</Checkbox>
          </Form.Item>

          <Form.Item noStyle shouldUpdate={(prevValues, currentValues) => prevValues.skipAuth !== currentValues.skipAuth}>
            {({ getFieldValue }) => (
              <>
                {!getFieldValue('skipAuth') && (
                  <>
                    <Form.Item
                      label="Username"
                      name="username"
                      rules={[{ required: true, message: 'Please enter username' }]}
                    >
                      <Input placeholder="Oracle APEX username" />
                    </Form.Item>
                    <Form.Item
                      label="Password"
                      name="password"
                      rules={[{ required: true, message: 'Please enter password' }]}
                    >
                      <Input.Password placeholder="Oracle APEX password" />
                    </Form.Item>
                  </>
                )}
              </>
            )}
          </Form.Item>

          <Form.Item
            label="HTTP Port (for Claude Desktop testing)"
            name="httpPort"
            initialValue={3001}
            rules={[{ required: true, message: 'Please enter HTTP port' }]}
          >
            <InputNumber
              min={3000}
              max={65535}
              placeholder="e.g., 3001"
              style={{ width: '100%' }}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* Logs Modal */}
      <Modal
        title="GL MCP Server Logs"
        open={showLogs}
        onCancel={() => setShowLogs(false)}
        width={800}
        footer={null}
      >
        <div
          style={{
            backgroundColor: '#1a1a1a',
            color: '#00ff00',
            padding: '12px',
            borderRadius: '4px',
            fontFamily: 'monospace',
            fontSize: '12px',
            maxHeight: '400px',
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {logs.length === 0 ? (
            <div>No logs available</div>
          ) : (
            logs.map((log, idx) => <div key={idx}>{log}</div>)
          )}
        </div>
      </Modal>
    </div>
  );
}
