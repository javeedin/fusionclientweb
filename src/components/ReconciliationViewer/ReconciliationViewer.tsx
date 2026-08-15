import React, { useState, useMemo } from 'react';
import {
  Stack, Pivot, PivotItem, Text, DetailsList, IColumn, SelectionMode,
  Spinner, SpinnerSize, MessageBar, MessageBarType, PrimaryButton, DefaultButton,
  mergeStyleSets, CommandBar, ICommandBarItemProps,
} from '@fluentui/react';
import { DownloadOutlined } from '@ant-design/icons';
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

const classNames = mergeStyleSets({
  root: {
    padding: 16,
    backgroundColor: '#FFFFFF',
  },
  tabContent: {
    padding: '16px 0',
  },
});

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

  const commandBarItems: ICommandBarItemProps[] = [
    {
      key: 'export',
      text: 'Export to Excel',
      iconProps: { iconName: 'ExcelDocument' },
      onClick: handleExport,
      disabled: !result,
    },
    {
      key: 'close',
      text: 'Close',
      iconProps: { iconName: 'Cancel' },
      onClick: onClose,
    },
  ];

  // Bank Statement Columns
  const stmtColumns: IColumn[] = useMemo(
    () => [
      {
        key: 'lineId',
        name: 'Line ID',
        fieldName: 'lineId',
        minWidth: 60,
        maxWidth: 80,
      },
      {
        key: 'transactionDate',
        name: 'Date',
        fieldName: 'transactionDate',
        minWidth: 100,
        maxWidth: 120,
      },
      {
        key: 'amount',
        name: 'Amount',
        fieldName: 'amount',
        minWidth: 100,
        maxWidth: 120,
        onRender: (item) => <Text>{item.amount.toFixed(2)}</Text>,
      },
      {
        key: 'reference',
        name: 'Reference',
        fieldName: 'reference',
        minWidth: 100,
      },
      {
        key: 'description',
        name: 'Description',
        fieldName: 'description',
        minWidth: 150,
      },
    ],
    []
  );

  // System Transaction Columns
  const txnColumns: IColumn[] = useMemo(
    () => [
      {
        key: 'txnId',
        name: 'Transaction ID',
        fieldName: 'txnId',
        minWidth: 80,
        maxWidth: 100,
      },
      {
        key: 'txnNumber',
        name: 'Txn #',
        fieldName: 'txnNumber',
        minWidth: 80,
        maxWidth: 100,
      },
      {
        key: 'txnDate',
        name: 'Date',
        fieldName: 'txnDate',
        minWidth: 100,
        maxWidth: 120,
      },
      {
        key: 'amount',
        name: 'Amount',
        fieldName: 'amount',
        minWidth: 100,
        maxWidth: 120,
        onRender: (item) => <Text>{item.amount.toFixed(2)}</Text>,
      },
      {
        key: 'source',
        name: 'Source',
        fieldName: 'source',
        minWidth: 100,
        maxWidth: 120,
      },
      {
        key: 'payee',
        name: 'Payee',
        fieldName: 'payee',
        minWidth: 150,
      },
    ],
    []
  );

  return (
    <Stack className={classNames.root} tokens={{ childrenGap: 16 }}>
      {error && (
        <MessageBar messageBarType={MessageBarType.error} dismissButtonAriaLabel="Close">
          {error}
        </MessageBar>
      )}

      {loading && (
        <Stack
          horizontalAlign="center"
          verticalAlign="center"
          style={{ padding: '40px 20px' }}
          tokens={{ childrenGap: 12 }}
        >
          <Spinner size={SpinnerSize.large} label="Analyzing transactions with Claude..." />
        </Stack>
      )}

      {!loading && result && (
        <Stack tokens={{ childrenGap: 20 }}>
          <Stack horizontal horizontalAlign="space-between" verticalAlign="center">
            <Text variant="xLarge" style={{ fontWeight: 600 }}>
              Bank Reconciliation Results
            </Text>
            <Stack horizontal tokens={{ childrenGap: 8 }}>
              <PrimaryButton onClick={handleExport} iconProps={{ iconName: 'ExcelDocument' }}>
                Export to Excel
              </PrimaryButton>
              {onClose && <DefaultButton onClick={onClose} text="Close" />}
            </Stack>
          </Stack>

          <ReconciliationSummary result={result} />

          <ReconciliationChart result={result} />

          <Pivot>
            <PivotItem headerText={`Matched (${result.matches.length})`}>
              <div className={classNames.tabContent}>
                <ReconciliationTable result={result} />
              </div>
            </PivotItem>

            <PivotItem headerText={`Unmatched Statements (${result.unmatchedStmtLines.length})`}>
              <div className={classNames.tabContent}>
                <Text style={{ marginBottom: 12, display: 'block', fontWeight: 600 }}>
                  Bank statement lines with no matching system transaction
                </Text>
                {result.unmatchedStmtLines.length > 0 ? (
                  <DetailsList
                    items={result.unmatchedStmtLines}
                    columns={stmtColumns}
                    selectionMode={SelectionMode.none}
                    isHeaderVisible
                    compact
                  />
                ) : (
                  <Text style={{ color: '#A19F9D', padding: '20px', textAlign: 'center' }}>
                    No unmatched statements
                  </Text>
                )}
              </div>
            </PivotItem>

            <PivotItem headerText={`Unmatched Transactions (${result.unmatchedSysTxns.length})`}>
              <div className={classNames.tabContent}>
                <Text style={{ marginBottom: 12, display: 'block', fontWeight: 600 }}>
                  System transactions with no matching bank statement
                </Text>
                {result.unmatchedSysTxns.length > 0 ? (
                  <DetailsList
                    items={result.unmatchedSysTxns}
                    columns={txnColumns}
                    selectionMode={SelectionMode.none}
                    isHeaderVisible
                    compact
                  />
                ) : (
                  <Text style={{ color: '#A19F9D', padding: '20px', textAlign: 'center' }}>
                    No unmatched transactions
                  </Text>
                )}
              </div>
            </PivotItem>
          </Pivot>
        </Stack>
      )}

      {!loading && !result && !error && (
        <Stack horizontalAlign="center" verticalAlign="center" style={{ padding: '40px 20px' }}>
          <Text>Click "Start Reconciliation" to analyze transactions</Text>
        </Stack>
      )}
    </Stack>
  );
};

export default ReconciliationViewer;
