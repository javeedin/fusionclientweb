import React, { useState, useEffect } from 'react';
import { Spin, Typography } from 'antd';
import { validateAccountCode } from './AccountSelector';

const { Text } = Typography;

interface AccountSegmentDescriptionsProps {
  accountCode: string;
}

export const AccountSegmentDescriptions: React.FC<AccountSegmentDescriptionsProps> = ({ accountCode }) => {
  const [descriptions, setDescriptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!accountCode) {
      setDescriptions([]);
      return;
    }

    const fetchDescriptions = async () => {
      setLoading(true);
      try {
        const validation = await validateAccountCode(accountCode);
        const descs = Object.values(validation.segmentDetails)
          .map(detail => detail.description)
          .filter(Boolean);
        setDescriptions(descs);
      } catch (error) {
        console.error('Error fetching segment descriptions:', error);
        setDescriptions([]);
      } finally {
        setLoading(false);
      }
    };

    fetchDescriptions();
  }, [accountCode]);

  if (loading) {
    return <Spin size="small" style={{ marginTop: 4 }} />;
  }

  if (descriptions.length === 0) {
    return null;
  }

  return (
    <div style={{ marginTop: 4, fontSize: 11, color: '#666', lineHeight: 1.4 }}>
      {descriptions.map((desc, idx) => (
        <div key={idx} style={{ marginBottom: idx < descriptions.length - 1 ? 3 : 0 }}>
          <Text type="secondary" style={{ fontSize: 11 }}>
            {desc}
          </Text>
        </div>
      ))}
    </div>
  );
};

export default AccountSegmentDescriptions;
