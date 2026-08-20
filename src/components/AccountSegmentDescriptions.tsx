import React, { useState, useEffect } from 'react';
import { Spin, Typography } from 'antd';
import { validateAccountCode } from './AccountSelector';

const { Text } = Typography;

interface AccountSegmentDescriptionsProps {
  accountCode: string;
}

export const AccountSegmentDescriptions: React.FC<AccountSegmentDescriptionsProps> = ({ accountCode }) => {
  const [description, setDescription] = useState<string>('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!accountCode) {
      setDescription('');
      return;
    }

    const fetchDescription = async () => {
      setLoading(true);
      try {
        const validation = await validateAccountCode(accountCode);
        // Find the Account segment description (usually the 4th segment)
        const accountSegment = Object.values(validation.segmentDetails).find(
          detail => detail.name?.toLowerCase().includes('account') && !detail.name?.toLowerCase().includes('sub')
        );
        setDescription(accountSegment?.description || '');
      } catch (error) {
        console.error('Error fetching segment description:', error);
        setDescription('');
      } finally {
        setLoading(false);
      }
    };

    fetchDescription();
  }, [accountCode]);

  if (loading) {
    return <Spin size="small" style={{ marginTop: 4 }} />;
  }

  if (!description) {
    return null;
  }

  return (
    <div style={{ marginTop: 4, fontSize: 11, color: '#666', lineHeight: 1.4 }}>
      <Text type="secondary" style={{ fontSize: 11 }}>
        {description}
      </Text>
    </div>
  );
};

export default AccountSegmentDescriptions;
