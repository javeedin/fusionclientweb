import React from 'react';
import { Row, Col, Card, Statistic } from 'antd';
import { CheckCircleOutlined, DollarOutlined, ExclamationCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { ReconciliationResult } from '../../services/claudeReconciliation.service';

interface ReconciliationSummaryProps {
  result: ReconciliationResult;
}

const ReconciliationSummary: React.FC<ReconciliationSummaryProps> = ({ result }) => {
  const matchPercentage = result.totalMatches > 0
    ? Math.round((result.totalMatches / (result.totalMatches + result.unmatchedStmtLines.length)) * 100)
    : 0;

  return (
    <Row gutter={16}>
      <Col xs={24} sm={12} md={6}>
        <Card style={{ backgroundColor: '#F6FFED' }}>
          <Statistic
            title="Matched Transactions"
            value={result.totalMatches}
            prefix={<CheckCircleOutlined style={{ color: '#52C41A' }} />}
            valueStyle={{ color: '#52C41A', fontSize: 28, fontWeight: 700 }}
            suffix={`(${matchPercentage}%)`}
          />
        </Card>
      </Col>

      <Col xs={24} sm={12} md={6}>
        <Card style={{ backgroundColor: '#E6F7FF' }}>
          <Statistic
            title="Matched Amount"
            value={result.totalAmount}
            prefix={<DollarOutlined style={{ color: '#1890FF' }} />}
            valueStyle={{ color: '#1890FF', fontSize: 28, fontWeight: 700 }}
            precision={2}
          />
        </Card>
      </Col>

      <Col xs={24} sm={12} md={6}>
        <Card style={{ backgroundColor: '#FFFBE6' }}>
          <Statistic
            title="Unmatched Statements"
            value={result.unmatchedStmtLines.length}
            prefix={<ExclamationCircleOutlined style={{ color: '#FAAD14' }} />}
            valueStyle={{ color: '#FAAD14', fontSize: 28, fontWeight: 700 }}
          />
        </Card>
      </Col>

      <Col xs={24} sm={12} md={6}>
        <Card style={{ backgroundColor: '#FFF1F0' }}>
          <Statistic
            title="Unmatched Transactions"
            value={result.unmatchedSysTxns.length}
            prefix={<CloseCircleOutlined style={{ color: '#FF4D4F' }} />}
            valueStyle={{ color: '#FF4D4F', fontSize: 28, fontWeight: 700 }}
          />
        </Card>
      </Col>
    </Row>
  );
};

export default ReconciliationSummary;
