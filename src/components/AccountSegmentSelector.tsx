import React, { useState, useEffect } from 'react';
import { Select, Spin, Row, Col, Space, Typography, message } from 'antd';
import { validateAccountCode } from './AccountSelector';
import { buildApexUrl } from '../config/api.helper';

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
    const api = buildApexUrl(`valuesets/getvalues/${segmentCode}`);
    const response = await fetch(api);
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

const fetchSegmentDefinitions = async (): Promise<{code: string; name: string}[]> => {
  try {
    const api = buildApexUrl('segmentdefinitions');
    const response = await fetch(api);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const result = await response.json();
    return result.items || result.segments || [];
  } catch (error) {
    console.error('Error fetching segment definitions:', error);
    // Fallback: hardcoded segment structure based on GL account format
    return [
      { code: '01', name: 'Company' },
      { code: '02', name: 'LOB' },
      { code: '03', name: 'Department' },
      { code: '04', name: 'Account' },
      { code: '05', name: 'Sub Account' },
      { code: '06', name: 'Analysis' },
      { code: '07', name: 'Intercompany' },
      { code: '08', name: 'Future 1' },
      { code: '09', name: 'Future 2' },
    ];
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
      setLoading(true);
      try {
        let segmentDetails: SegmentDetail[] = [];

        if (accountCode) {
          // Validate and parse existing account code
          const validation = await validateAccountCode(accountCode);
          Object.entries(validation.segmentDetails).forEach(([code, detail]) => {
            segmentDetails.push({
              index: segmentDetails.length,
              code,
              name: detail.name,
              value: detail.value,
              description: detail.description,
            });
          });
        } else {
          // Initialize empty segments for new account code creation
          const definitions = await fetchSegmentDefinitions();
          definitions.forEach((def, idx) => {
            segmentDetails.push({
              index: idx,
              code: def.code,
              name: def.name,
              value: '',
              description: '',
            });
          });
        }

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
        if (accountCode) {
          message.error('Failed to parse account code');
        }
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
    if (newValue) {
      const availableValues = segmentValueOptions.get(newSegments[segmentIndex].code) || [];
      const selectedOption = availableValues.find(v => v.value === newValue);
      if (selectedOption) {
        newSegments[segmentIndex].description = selectedOption.description;
      }
    } else {
      newSegments[segmentIndex].description = '';
    }

    setSegments(newSegments);

    // Reconstruct the account code with all segments
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
      {segments.map((segment, idx) => {
        const availableValues = segmentValueOptions.get(segment.code) || [];
        return (
          <Row key={idx} gutter={[16, 12]} align="middle" style={{ marginBottom: idx < segments.length - 1 ? 8 : 0 }}>
            <Col xs={24} sm={6} style={{ textAlign: 'right' }}>
              <Text strong style={{ fontSize: 12 }}>{segment.name}</Text>
            </Col>
            <Col xs={24} sm={6}>
              <Select
                style={{ width: '100%' }}
                value={segment.value || undefined}
                onChange={(newValue) => handleSegmentChange(idx, newValue || '')}
                placeholder={`Select`}
                allowClear
                optionFilterProp="label"
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase()) ||
                  (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                }
              >
                {availableValues.map((opt) => (
                  <Option key={opt.value} value={opt.value} label={opt.value}>
                    <div>
                      <div><Text strong>{opt.value}</Text></div>
                      <Text type="secondary" style={{ fontSize: 11 }}>{opt.description}</Text>
                    </div>
                  </Option>
                ))}
              </Select>
            </Col>
            <Col xs={24} sm={12}>
              <Text type="secondary" style={{ fontSize: 11 }}>
                {segment.description || 'Default'}
              </Text>
            </Col>
          </Row>
        );
      })}
    </div>
  );
};

export default AccountSegmentSelector;
