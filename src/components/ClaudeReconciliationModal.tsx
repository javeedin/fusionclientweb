import React, { useState } from 'react';
import {
  Modal, Button, Table, Tag, Space, Alert, Spin, Empty, Tabs, Row, Col, Card, Typography, Divider, message, Tooltip,
} from 'antd';
import {
  RobotOutlined, DownloadOutlined, CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined,
} from '@ant-design/icons';
import { reconcileWithClaude, exportReconciliationToExcel, type ReconciliationResult } from '../services/claudeReconciliation.service';

const { Text, Title } = Typography;

interface ClaudeReconciliationModalProps {
  open: boolean;
  onClose: () => void;
  stmtLines: any[];
  sysTxns: any[];
  claudeApiKey: string;
  bankAccountName: string;
}

const REDWOOD = {
  primary: '#C74634',
  success: '#1D7B4D',
  warning: '#D4A800',
  error: '#D93025',
  info: '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
};

const ClaudeReconciliationModal: React.FC<ClaudeReconciliationModalProps> = ({
  open,
  onClose,
  stmtLines,
  sysTxns,
  claudeApiKey,
  bankAccountName,
}) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReconciliationResult | null>(null);
  const [error, setError] = useState('');

  const handleReconcile = async () => {
    if (!stmtLines.length || !sysTxns.length) {
      message.warning('Need both bank statements and system transactions to reconcile');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const reconResult = await reconcileWithClaude(stmtLines, sysTxns, claudeApiKey);
      setResult(reconResult);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(errMsg);
      message.error('Reconciliation failed: ' + errMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleExportExcel = () => {
    if (!result) return;
    const fileName = `reconciliation_${bankAccountName}_${new Date().toISOString().split('T')[0]}.xlsx`;
    exportReconciliationToExcel(result, fileName);
    message.success('Reconciliation exported to Excel');
  };

  return (
    <Modal
      title={
        <Space>
          <RobotOutlined style={{ color: REDWOOD.info }} />
          Claude AI Bank Reconciliation
        </Space>
      }
      open={open}
      onCancel={onClose}
      width={1000}
      footer={null}
      bodyStyle={{ maxHeight: '70vh', overflowY: 'auto' }}
    >
      {!result ? (
        <div>
          {error && <Alert type="error" message={error} style={{ marginBottom: 16 }} />}

          <Card style={{ marginBottom: 16 }}>
            <Row gutter={16}>
              <Col xs={24} sm={8}>
                <Text strong>Bank Statements</Text>
                <div style={{ fontSize: 24, fontWeight: 700, color: REDWOOD.info, marginTop: 8 }}>
                  {stmtLines.length}
                </div>
              </Col>
              <Col xs={24} sm={8}>
                <Text strong>System Transactions</Text>
                <div style={{ fontSize: 24, fontWeight: 700, color: REDWOOD.info, marginTop: 8 }}>
                  {sysTxns.length}
                </div>
              </Col>
              <Col xs={24} sm={8}>
                <Text strong>Matching Criteria</Text>
                <div style={{ fontSize: 14, color: REDWOOD.primary, marginTop: 8 }}>
                  Amount (Primary)
                </div>
              </Col>
            </Row>
          </Card>

          <Alert
            type="info"
            message="Claude will analyze bank statements and system transactions to find matching pairs based on amount. This may take a few moments."
            style={{ marginBottom: 16 }}
          />

          <div style={{ textAlign: 'center' }}>
            <Button
              type="primary"
              size="large"
              icon={<RobotOutlined />}
              onClick={handleReconcile}
              loading={loading}
              style={{ minWidth: 200 }}
            >
              Start Reconciliation with Claude
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: 16, padding: 12, backgroundColor: REDWOOD.neutral100, borderRadius: 6 }}>
            <Row gutter={16}>
              <Col xs={24} sm={6}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: REDWOOD.success }}>
                    {result.totalMatches}
                  </div>
                  <Text type="secondary">Matched</Text>
                </div>
              </Col>
              <Col xs={24} sm={6}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: REDWOOD.warning }}>
                    {result.unmatchedStmtLines.length}
                  </div>
                  <Text type="secondary">Unmatched Stmts</Text>
                </div>
              </Col>
              <Col xs={24} sm={6}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: REDWOOD.warning }}>
                    {result.unmatchedSysTxns.length}
                  </div>
                  <Text type="secondary">Unmatched Txns</Text>
                </div>
              </Col>
              <Col xs={24} sm={6}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: REDWOOD.info }}>
                    {result.totalAmount.toFixed(2)}
                  </div>
                  <Text type="secondary">Matched Amount</Text>
                </div>
              </Col>
            </Row>
          </div>

          <Tabs
            items={[
              {
                key: 'matched',
                label: (
                  <span>
                    <CheckCircleOutlined style={{ color: REDWOOD.success, marginRight: 8 }} />
                    Matched ({result.matches.length})
                  </span>
                ),
                children: result.matches.length > 0 ? (
                  <Table
                    size="small"
                    columns={[
                      {
                        title: 'Stmt Amount',
                        dataIndex: 'stmtAmount',
                        width: 100,
                        render: (v) => v.toFixed(2),
                      },
                      {
                        title: 'Stmt Date',
                        dataIndex: 'stmtDate',
                        width: 100,
                      },
                      {
                        title: 'Txn #',
                        dataIndex: 'txnNumber',
                        width: 100,
                      },
                      {
                        title: 'Txn Amount',
                        dataIndex: 'txnAmount',
                        width: 100,
                        render: (v) => v.toFixed(2),
                      },
                      {
                        title: 'Source',
                        dataIndex: 'txnSource',
                        width: 80,
                      },
                      {
                        title: 'Confidence',
                        dataIndex: 'confidence',
                        width: 90,
                        render: (v) => (
                          <Tag color={v >= 0.95 ? 'green' : v >= 0.8 ? 'blue' : 'orange'}>
                            {(v * 100).toFixed(0)}%
                          </Tag>
                        ),
                      },
                    ]}
                    dataSource={result.matches}
                    pagination={{ pageSize: 10 }}
                    rowKey={(_, i) => i}
                  />
                ) : (
                  <Empty description="No matches found" />
                ),
              },
              {
                key: 'unmatched-stmt',
                label: (
                  <span>
                    <ExclamationCircleOutlined style={{ color: REDWOOD.warning, marginRight: 8 }} />
                    Unmatched Statements ({result.unmatchedStmtLines.length})
                  </span>
                ),
                children: result.unmatchedStmtLines.length > 0 ? (
                  <Table
                    size="small"
                    columns={[
                      {
                        title: 'Amount',
                        dataIndex: 'amount',
                        width: 100,
                        render: (v) => v.toFixed(2),
                      },
                      {
                        title: 'Date',
                        dataIndex: 'transactionDate',
                        width: 100,
                      },
                      {
                        title: 'Reference',
                        dataIndex: 'reference',
                        width: 120,
                      },
                      {
                        title: 'Description',
                        dataIndex: 'description',
                        flex: 1,
                      },
                    ]}
                    dataSource={result.unmatchedStmtLines}
                    pagination={{ pageSize: 10 }}
                    rowKey={(_, i) => i}
                  />
                ) : (
                  <Empty description="No unmatched statements" />
                ),
              },
              {
                key: 'unmatched-txn',
                label: (
                  <span>
                    <ExclamationCircleOutlined style={{ color: REDWOOD.warning, marginRight: 8 }} />
                    Unmatched Transactions ({result.unmatchedSysTxns.length})
                  </span>
                ),
                children: result.unmatchedSysTxns.length > 0 ? (
                  <Table
                    size="small"
                    columns={[
                      {
                        title: 'Transaction #',
                        dataIndex: 'txnNumber',
                        width: 100,
                      },
                      {
                        title: 'Amount',
                        dataIndex: 'amount',
                        width: 100,
                        render: (v) => v.toFixed(2),
                      },
                      {
                        title: 'Date',
                        dataIndex: 'txnDate',
                        width: 100,
                      },
                      {
                        title: 'Source',
                        dataIndex: 'source',
                        width: 100,
                      },
                      {
                        title: 'Payee',
                        dataIndex: 'payee',
                        flex: 1,
                      },
                    ]}
                    dataSource={result.unmatchedSysTxns}
                    pagination={{ pageSize: 10 }}
                    rowKey={(_, i) => i}
                  />
                ) : (
                  <Empty description="No unmatched transactions" />
                ),
              },
            ]}
          />

          <Divider />

          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={onClose}>Close</Button>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              onClick={handleExportExcel}
            >
              Export to Excel
            </Button>
          </Space>
        </div>
      )}
    </Modal>
  );
};

export default ClaudeReconciliationModal;
