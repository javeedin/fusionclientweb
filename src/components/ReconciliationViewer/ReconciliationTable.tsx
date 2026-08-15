import React, { useMemo } from 'react';
import { DetailsList, IColumn, SelectionMode, Stack, Text, Tag, mergeStyleSets } from '@fluentui/react';
import { ReconciliationResult, ReconciliationMatch } from '../../services/claudeReconciliation.service';

interface ReconciliationTableProps {
  result: ReconciliationResult;
}

const classNames = mergeStyleSets({
  header: {
    fontSize: 14,
    fontWeight: 600,
    color: '#242424',
    paddingBottom: 8,
  },
  confidenceHigh: {
    backgroundColor: '#D4EDDA',
    color: '#155724',
    padding: '4px 8px',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 500,
  },
  confidenceMedium: {
    backgroundColor: '#FFF3CD',
    color: '#856404',
    padding: '4px 8px',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 500,
  },
  confidenceLow: {
    backgroundColor: '#F8D7DA',
    color: '#721C24',
    padding: '4px 8px',
    borderRadius: 4,
    fontSize: 12,
    fontWeight: 500,
  },
});

const ReconciliationTable: React.FC<ReconciliationTableProps> = ({ result }) => {
  const columns: IColumn[] = useMemo(
    () => [
      {
        key: 'stmtAmount',
        name: 'Statement Amount',
        fieldName: 'stmtAmount',
        minWidth: 100,
        maxWidth: 120,
        onRender: (item: ReconciliationMatch) => (
          <Text>{item.stmtAmount.toFixed(2)}</Text>
        ),
      },
      {
        key: 'stmtDate',
        name: 'Statement Date',
        fieldName: 'stmtDate',
        minWidth: 100,
        maxWidth: 120,
      },
      {
        key: 'txnNumber',
        name: 'Transaction #',
        fieldName: 'txnNumber',
        minWidth: 80,
        maxWidth: 100,
      },
      {
        key: 'txnAmount',
        name: 'Transaction Amount',
        fieldName: 'txnAmount',
        minWidth: 100,
        maxWidth: 120,
        onRender: (item: ReconciliationMatch) => (
          <Text>{item.txnAmount.toFixed(2)}</Text>
        ),
      },
      {
        key: 'txnSource',
        name: 'Source',
        fieldName: 'txnSource',
        minWidth: 80,
        maxWidth: 100,
      },
      {
        key: 'confidence',
        name: 'Confidence',
        fieldName: 'confidence',
        minWidth: 110,
        maxWidth: 130,
        onRender: (item: ReconciliationMatch) => {
          const percentage = Math.round(item.confidence * 100);
          const className =
            item.confidence >= 0.95
              ? classNames.confidenceHigh
              : item.confidence >= 0.8
              ? classNames.confidenceMedium
              : classNames.confidenceLow;

          return <div className={className}>{percentage}%</div>;
        },
      },
      {
        key: 'reason',
        name: 'Match Reason',
        fieldName: 'reason',
        minWidth: 150,
      },
    ],
    []
  );

  return (
    <Stack tokens={{ childrenGap: 12 }}>
      <Text className={classNames.header}>
        Matched Transactions ({result.matches.length})
      </Text>
      {result.matches.length > 0 ? (
        <DetailsList
          items={result.matches}
          columns={columns}
          selectionMode={SelectionMode.none}
          isHeaderVisible
          compact
          onRenderDetailsHeader={(props, defaultRender) => (
            <div style={{ borderBottom: '2px solid #E1E1E1' }}>
              {defaultRender?.({
                ...props,
                styles: {
                  root: { paddingTop: 0, paddingBottom: 8 },
                },
              })}
            </div>
          )}
        />
      ) : (
        <Text style={{ color: '#A19F9D', padding: '20px', textAlign: 'center' }}>
          No matched transactions
        </Text>
      )}
    </Stack>
  );
};

export default ReconciliationTable;
