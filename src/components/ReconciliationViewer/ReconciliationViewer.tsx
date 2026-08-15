import React, { useMemo } from 'react';
import { Tabs, Table, Empty, Alert, Spin, Space, Button, Row, Col, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { ReconciliationResult } from '../../services/claudeReconciliation.service';
import { exportReconciliationToExcel } from '../../services/claudeReconciliation.service';
import ReconciliationSummary from './ReconciliationSummary';
import ReconciliationChart from './ReconciliationChart';
import ReconciliationTable from './ReconciliationTable';

interface ReconciliationViewerProps {
  result: ReconciliationResult | null;
  loading: boolean;
  error?: string;
  stmtLines: any[];
  sysTxns: any[];
  bankAccountName?: string;
  onClose?: () => void;
}

const { Text } = Typography;

const ReconciliationViewer: React.FC<ReconciliationViewerProps> = ({
  result,
  loading,
  error,
  stmtLines,
  sysTxns,
  bankAccountName = 'Bank Account',
  onClose,
}) => {
  const handleExport = () => {
    if (!result) return;
    const fileName = `reconciliation_${bankAccountName}_${new Date().toISOString().split('T')[0]}.xlsx`;
    exportReconciliationToExcel(result, fileName);
  };

  // Bank Statement Columns
  const stmtColumns: ColumnsType<any> = useMemo(
    () => [
      {
        title: 'Line ID',
        dataIndex: 'lineId',
        width: 80,
      },
      {
        title: 'Date',
        dataIndex: 'transactionDate',
        width: 120,
      },
      {
        title: 'Amount',
        dataIndex: 'amount',
        width: 100,
        render: (value: number) => value.toFixed(2),
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
    ],
    []
  );

  // System Transaction Columns
  const txnColumns: ColumnsType<any> = useMemo(
    () => [
      {
        title: 'Transaction ID',
        dataIndex: 'txnId',
        width: 100,
      },
      {
        title: 'Txn #',
        dataIndex: 'txnNumber',
        width: 100,
      },
      {
        title: 'Date',
        dataIndex: 'txnDate',
        width: 120,
      },
      {
        title: 'Amount',
        dataIndex: 'amount',
        width: 100,
        render: (value: number) => value.toFixed(2),
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
    ],
    []
  );

  return (
    <div style={{ padding: 0 }}>
      {error && (
        <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />
      )}

      {loading && (
        <div style={{ padding: '60px 20px', textAlign: 'center' }}>
          <Spin size="large" tip="Analyzing transactions with Claude..." />
        </div>
      )}

      {!loading && result && (
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <Row justify="space-between" align="middle">
            <Col>
              <Text strong style={{ fontSize: 18 }}>Bank Reconciliation Results</Text>
            </Col>
            <Col>
              <Space>
                <Button type="primary" icon={<DownloadOutlined />} onClick={handleExport}>
                  Export to Excel
                </Button>
                {onClose && <Button onClick={onClose}>Close</Button>}
              </Space>
            </Col>
          </Row>

          <ReconciliationSummary result={result} />

          <ReconciliationChart result={result} />

          <Tabs
            items={[
              {
                key: 'matched',
                label: `Matched (${result.matches.length})`,
                children: <ReconciliationTable result={result} />,
              },
              {
                key: 'unmatched-stmt',
                label: `Unmatched Statements (${result.unmatchedStmtLines.length})`,
                children: (
                  <div>
                    <Text style={{ marginBottom: 12, display: 'block' }}>
                      Bank statement lines with no matching system transaction
                    </Text>
                    {result.unmatchedStmtLines.length > 0 ? (
                      <Table
                        columns={stmtColumns}
                        dataSource={result.unmatchedStmtLines}
                        pagination={{ pageSize: 10, size: 'small' }}
                        rowKey={(_, index) => index}
                        size="small"
                        scroll={{ x: true }}
                      />
                    ) : (
                      <Empty description="No unmatched statements" />
                    )}
                  </div>
                ),
              },
              {
                key: 'unmatched-txn',
                label: `Unmatched Transactions (${result.unmatchedSysTxns.length})`,
                children: (
                  <div>
                    <Text style={{ marginBottom: 12, display: 'block' }}>
                      System transactions with no matching bank statement
                    </Text>
                    {result.unmatchedSysTxns.length > 0 ? (
                      <Table
                        columns={txnColumns}
                        dataSource={result.unmatchedSysTxns}
                        pagination={{ pageSize: 10, size: 'small' }}
                        rowKey={(_, index) => index}
                        size="small"
                        scroll={{ x: true }}
                      />
                    ) : (
                      <Empty description="No unmatched transactions" />
                    )}
                  </div>
                ),
              },
            ]}
          />
        </Space>
      )}

      {!loading && !result && !error && (
        <div style={{ padding: '60px 20px', textAlign: 'center' }}>
          <Text>Click "Reconcile with Claude" to analyze transactions</Text>
        </div>
      )}
    </div>
  );
};

export default ReconciliationViewer;
