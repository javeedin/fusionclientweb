import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Stack, Text } from '@fluentui/react';
import { ReconciliationResult } from '../../services/claudeReconciliation.service';

interface ReconciliationChartProps {
  result: ReconciliationResult;
}

const ReconciliationChart: React.FC<ReconciliationChartProps> = ({ result }) => {
  const matchData = [
    { name: 'Matched', value: result.totalMatches, fill: '#107C10' },
    { name: 'Unmatched Statements', value: result.unmatchedStmtLines.length, fill: '#FFB900' },
    { name: 'Unmatched Transactions', value: result.unmatchedSysTxns.length, fill: '#E81123' },
  ].filter(d => d.value > 0);

  const confidenceData = [
    {
      name: 'High (≥95%)',
      value: result.matches.filter(m => m.confidence >= 0.95).length,
      fill: '#107C10',
    },
    {
      name: 'Medium (80-95%)',
      value: result.matches.filter(m => m.confidence >= 0.8 && m.confidence < 0.95).length,
      fill: '#0078D4',
    },
    {
      name: 'Low (<80%)',
      value: result.matches.filter(m => m.confidence < 0.8).length,
      fill: '#FFB900',
    },
  ].filter(d => d.value > 0);

  return (
    <Stack tokens={{ childrenGap: 24 }} style={{ padding: '16px 0' }}>
      <div>
        <Text variant="large" style={{ fontWeight: 600, marginBottom: 12, display: 'block' }}>
          Reconciliation Status
        </Text>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={matchData}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, value }) => `${name}: ${value}`}
              outerRadius={80}
              fill="#8884d8"
              dataKey="value"
            >
              {matchData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
            </Pie>
            <Tooltip formatter={(value) => `${value} items`} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {confidenceData.length > 0 && (
        <div>
          <Text variant="large" style={{ fontWeight: 600, marginBottom: 12, display: 'block' }}>
            Confidence Distribution
          </Text>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={confidenceData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis />
              <Tooltip formatter={(value) => `${value} matches`} />
              <Bar dataKey="value" fill="#0078D4">
                {confidenceData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Stack>
  );
};

export default ReconciliationChart;
