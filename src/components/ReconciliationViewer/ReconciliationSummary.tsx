import React from 'react';
import { Stack, Text, Card, ICardTokens } from '@fluentui/react';
import { ReconciliationResult } from '../../services/claudeReconciliation.service';

interface ReconciliationSummaryProps {
  result: ReconciliationResult;
}

const cardTokens: ICardTokens = {
  childrenMargin: 12,
};

const ReconciliationSummary: React.FC<ReconciliationSummaryProps> = ({ result }) => {
  const matchPercentage = result.totalMatches > 0
    ? Math.round((result.totalMatches / (result.totalMatches + result.unmatchedStmtLines.length)) * 100)
    : 0;

  return (
    <Stack tokens={{ childrenGap: 12 }}>
      <Stack horizontal tokens={{ childrenGap: 20 }} wrap>
        <Card tokens={cardTokens} style={{ flex: 1, minWidth: 150 }}>
          <Stack tokens={{ childrenGap: 8 }}>
            <Text variant="small" style={{ color: '#606E8C' }}>MATCHED TRANSACTIONS</Text>
            <Text variant="superLarge" style={{ color: '#107C10', fontWeight: 700 }}>
              {result.totalMatches}
            </Text>
            <Text variant="small" style={{ color: '#606E8C' }}>
              {matchPercentage}% match rate
            </Text>
          </Stack>
        </Card>

        <Card tokens={cardTokens} style={{ flex: 1, minWidth: 150 }}>
          <Stack tokens={{ childrenGap: 8 }}>
            <Text variant="small" style={{ color: '#606E8C' }}>TOTAL MATCHED AMOUNT</Text>
            <Text variant="superLarge" style={{ color: '#0078D4', fontWeight: 700 }}>
              {result.totalAmount.toFixed(2)}
            </Text>
            <Text variant="small" style={{ color: '#606E8C' }}>
              Reconciled
            </Text>
          </Stack>
        </Card>

        <Card tokens={cardTokens} style={{ flex: 1, minWidth: 150 }}>
          <Stack tokens={{ childrenGap: 8 }}>
            <Text variant="small" style={{ color: '#606E8C' }}>UNMATCHED STATEMENTS</Text>
            <Text variant="superLarge" style={{ color: '#FFB900', fontWeight: 700 }}>
              {result.unmatchedStmtLines.length}
            </Text>
            <Text variant="small" style={{ color: '#606E8C' }}>
              Pending review
            </Text>
          </Stack>
        </Card>

        <Card tokens={cardTokens} style={{ flex: 1, minWidth: 150 }}>
          <Stack tokens={{ childrenGap: 8 }}>
            <Text variant="small" style={{ color: '#606E8C' }}>UNMATCHED TRANSACTIONS</Text>
            <Text variant="superLarge" style={{ color: '#E81123', fontWeight: 700 }}>
              {result.unmatchedSysTxns.length}
            </Text>
            <Text variant="small" style={{ color: '#606E8C' }}>
              Needs attention
            </Text>
          </Stack>
        </Card>
      </Stack>
    </Stack>
  );
};

export default ReconciliationSummary;
