import React, { useMemo } from 'react';
import { Table, Tag, Empty, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReconciliationResult, ReconciliationMatch } from '../../services/claudeReconciliation.service';

interface ReconciliationTableProps {
  result: ReconciliationResult;
}

const { Text } = Typography;

const ReconciliationTable: React.FC<ReconciliationTableProps> = ({ result }) => {
  const columns: ColumnsType<ReconciliationMatch> = useMemo(
    () => [
      {
        title: 'Statement Amount',
        dataIndex: 'stmtAmount',
        width: 120,
        render: (value: number) => value.toFixed(2),
      },
      {
        title: 'Statement Date',
        dataIndex: 'stmtDate',
        width: 120,
      },
      {
        title: 'Txn #',
        dataIndex: 'txnNumber',
        width: 100,
      },
      {
        title: 'Transaction Amount',
        dataIndex: 'txnAmount',
        width: 130,
        render: (value: number) => value.toFixed(2),
      },
      {
        title: 'Source',
        dataIndex: 'txnSource',
        width: 100,
      },
      {
        title: 'Confidence',
        dataIndex: 'confidence',
        width: 110,
        render: (value: number) => {
          const percentage = Math.round(value * 100);
          let color = 'orange';
          if (value >= 0.95) color = 'green';
          else if (value >= 0.8) color = 'blue';

          return <Tag color={color}>{percentage}%</Tag>;
        },
      },
      {
        title: 'Reason',
        dataIndex: 'reason',
        width: 150,
      },
    ],
    []
  );

  return (
    <div>
      <Text strong style={{ fontSize: 14, display: 'block', marginBottom: 12 }}>
        Matched Transactions ({result.matches.length})
      </Text>
      {result.matches.length > 0 ? (
        <Table
          columns={columns}
          dataSource={result.matches}
          pagination={{ pageSize: 10, size: 'small' }}
          rowKey={(_, index) => index}
          size="small"
          scroll={{ x: true }}
        />
      ) : (
        <Empty description="No matched transactions" />
      )}
    </div>
  );
};

export default ReconciliationTable;
