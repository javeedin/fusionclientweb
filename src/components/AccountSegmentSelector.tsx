import React, { useState, useEffect } from 'react';
import { Select, Spin, Row, Col, Space, Typography, message } from 'antd';
import { validateAccountCode } from './AccountSelector';

const { Text } = Typography;
const { Option } = Select;

export interface SegmentInfo {
  code: string;
  name: string;
  value: string;
  description: string;
}

interface AccountSegmentSelectorProps {
  accountCode: string;
  onChange: (newCode: string) => void;
  label?: string;
}

interface SegmentDetail {
  index: number;
  code: string;
  name: string;
  value: string;
  description: string;
  availableValues?: Array<{ value: string; description: string }>;
}

// Cache for segment values to avoid repeated API calls
let segmentValuesCache: Map<string, Array<{ value: string; description: string }>> = new Map();

const fetchSegmentValues = async (segmentCode: string): Promise<Array<{ value: string; description: string }>> => {
  if (segmentValuesCache.has(segmentCode)) {
    return segmentValuesCache.get(segmentCode) || [];
  }

  try {
    const baseUrl = process.env.REACT_APP_APEX_BASE_URL || 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp';
    const response = await fetch(`${baseUrl}/valuesets/getvalues/${segmentCode}`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const result = await response.json();
    const values = (result.items || []).map((item: any) => ({
      value: item.value,
      description: item.description,
    }));
    segmentValuesCache.set(segmentCode, values);
    return values;
  } catch (error) {
    console.error(`Error fetching values for segment ${segmentCode}:`, error);
    return [];
  }
};

export const AccountSegmentSelector: React.FC<AccountSegmentSelectorProps> = ({
  accountCode,
  onChange,
  label,
}) => {
  const [segments, setSegments] = useState<SegmentDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [segmentValueOptions, setSegmentValueOptions] = useState<Map<string, Array<{ value: string; description: string }>>>(new Map());

  // Parse and validate the account code on mount or when it changes
  useEffect(() => {
    const parseCode = async () => {
      if (!accountCode) {
        setSegments([]);
        return;
      }

      setLoading(true);
      try {
        const validation = await validateAccountCode(accountCode);
        const parts = accountCode.split('-');

        // Build segment details from validation result
        const segmentDetails: SegmentDetail[] = [];
        Object.entries(validation.segmentDetails).forEach(([code, detail]) => {
          segmentDetails.push({
            index: segmentDetails.length,
            code,
            name: detail.name,
            value: detail.value,
            description: detail.description,
          });
        });

        // Fetch available values for each segment
        const valueMap = new Map<string, Array<{ value: string; description: string }>>();
        for (const segment of segmentDetails) {
          const values = await fetchSegmentValues(segment.code);
          valueMap.set(segment.code, values);
        }
        setSegmentValueOptions(valueMap);
        setSegments(segmentDetails);
      } catch (error) {
        console.error('Error parsing account code:', error);
        message.error('Failed to parse account code');
      } finally {
        setLoading(false);
      }
    };

    parseCode();
  }, [accountCode]);

  const handleSegmentChange = (segmentIndex: number, newValue: string) => {
    const newSegments = [...segments];
    newSegments[segmentIndex].value = newValue;

    // Find the new description for the selected value
    const availableValues = segmentValueOptions.get(newSegments[segmentIndex].code) || [];
    const selectedOption = availableValues.find(v => v.value === newValue);
    if (selectedOption) {
      newSegments[segmentIndex].description = selectedOption.description;
    }

    setSegments(newSegments);

    // Reconstruct the account code
    const newCode = newSegments.map(s => s.value).join('-');
    onChange(newCode);
  };

  if (loading) {
    return <Spin size="small" />;
  }

  if (segments.length === 0) {
    return <Text type="secondary">No segments to display</Text>;
  }

  return (
    <div>
      {label && <Text strong style={{ display: 'block', marginBottom: 8 }}>{label}</Text>}
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {segments.map((segment, idx) => {
          const availableValues = segmentValueOptions.get(segment.code) || [];
          return (
            <div key={idx} style={{ borderLeft: '2px solid #f0f0f0', paddingLeft: 12 }}>
              <Row gutter={[12, 8]}>
                <Col xs={24} sm={12}>
                  <div style={{ marginBottom: 4 }}>
                    <Text strong style={{ fontSize: 12 }}>{segment.name}</Text>
                  </div>
                  <Select
                    style={{ width: '100%' }}
                    value={segment.value}
                    onChange={(newValue) => handleSegmentChange(idx, newValue)}
                    placeholder={`Select ${segment.name.toLowerCase()}`}
                    optionFilterProp="label"
                    filterOption={(input, option) =>
                      (option?.label ?? '').toLowerCase().includes(input.toLowerCase()) ||
                      (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                  >
                    {availableValues.map((opt) => (
                      <Option key={opt.value} value={opt.value} label={`${opt.value} - ${opt.description}`}>
                        <div>
                          <div><Text strong>{opt.value}</Text></div>
                          <Text type="secondary" style={{ fontSize: 11 }}>{opt.description}</Text>
                        </div>
                      </Option>
                    ))}
                  </Select>
                </Col>
                {segment.description && (
                  <Col xs={24} sm={12}>
                    <div style={{ marginBottom: 4 }}>
                      <Text type="secondary" style={{ fontSize: 11 }}>Description</Text>
                    </div>
                    <div style={{
                      padding: '6px 8px',
                      background: '#fafafa',
                      borderRadius: 4,
                      minHeight: 32,
                      display: 'flex',
                      alignItems: 'center',
                    }}>
                      <Text style={{ fontSize: 12 }}>{segment.description}</Text>
                    </div>
                  </Col>
                )}
              </Row>
            </div>
          );
        })}
      </Space>
    </div>
  );
};

export default AccountSegmentSelector;
