import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Modal, Select, Button, Space, Typography, Spin, Row, Col, message } from 'antd';
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons';

const { Text } = Typography;
const { Option } = Select;

// Segment interface from API
interface Segment {
  key_flex_filed_name_code: string;
  structure_code: string;
  sequence_no: number;
  segment_name: string;
  segment_code: string;
  column_name: string;
  prompt: string;
  enabled: string;
}

// Value interface from API
interface SegmentValue {
  ValueId: number;
  Value: string;
  Description: string;
  EnabledFlag: string;
}

// Props for the component
interface AccountSelectorProps {
  visible: boolean;
  onCancel: () => void;
  onSelect: (accountCode: string, segments: Record<string, { value: string; description: string }>) => void;
  initialValue?: string;
  lockedFirstSegment?: string; // When set, the first (Company) segment is locked to this value
}

// API endpoints
const SEGMENTS_API = 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp/chartofaccounts/structuresegments';
const VALUES_API = 'https://g15d6279501ae08-buimerc.adb.me-dubai-1.oraclecloudapps.com/ords/bcldifc/reerp/valuesets/getvalues';

// Cache for segments and values
let segmentsCache: Segment[] = [];
let valuesCache: Map<string, SegmentValue[]> = new Map();

// Clear all caches
const clearCache = () => { segmentsCache = []; valuesCache = new Map(); };

// Apply default segment values: Account = blank, Sub-Account = '0000', rest = '00'/'0000' if present, else first value
const applyDefaults = (
  segs: Segment[],
  valMap: Record<string, SegmentValue[]>,
  locked?: string
): Record<string, string> => {
  const out: Record<string, string> = {};
  segs.forEach((seg, index) => {
    const prompt = (seg.prompt || seg.segment_name || '').toLowerCase();
    const vals = valMap[seg.segment_code] || valuesCache.get(seg.segment_code) || [];
    const isAccount    = prompt === 'account' || (prompt.includes('account') && !prompt.includes('sub') && !prompt.includes('chart') && !prompt.includes('offset'));
    const isSubAccount = prompt.includes('sub');
    if (isAccount) {
      out[seg.segment_code] = ''; // leave blank so user must choose
    } else if (isSubAccount) {
      out[seg.segment_code] = vals.find(v => v.Value === '0000')?.Value ?? (vals[0]?.Value || '');
    } else if (vals.length > 0) {
      // Prefer '00' or '0000' (the "none/default" sentinel) if it exists
      const zero = vals.find(v => v.Value === '00') ?? vals.find(v => v.Value === '0000');
      out[seg.segment_code] = zero ? zero.Value : vals[0].Value;
    }
    if (index === 0 && locked) out[seg.segment_code] = locked;
  });
  return out;
};

// Validation result interface
export interface ValidationResult {
  isValid: boolean;
  validatedCode: string; // Code with invalid segments replaced with empty string
  invalidSegments: string[]; // Names of invalid segments
  segmentsLoaded: boolean; // Whether segment data is loaded
  segmentDetails: Record<string, { value: string; description: string; name: string }>; // Details for valid segments
}

// Validate a code combination against cached values
export const validateAccountCode = async (code: string): Promise<ValidationResult> => {
  console.log('validateAccountCode called with:', code);
  console.log('Current segmentsCache length:', segmentsCache.length);

  // If cache is empty, we need to fetch segments first
  if (segmentsCache.length === 0) {
    try {
      console.log('Fetching segments from API...');
      const response = await fetch(SEGMENTS_API);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const result = await response.json();
      console.log('Segments API response:', result);
      const segmentData: Segment[] = (result.items || []).sort(
        (a: Segment, b: Segment) => a.sequence_no - b.sequence_no
      );
      segmentsCache = segmentData;
      console.log('Loaded segments:', segmentData.length);
    } catch (error) {
      console.error('Error fetching segments for validation:', error);
      return { isValid: true, validatedCode: code, invalidSegments: [], segmentsLoaded: false, segmentDetails: {} };
    }
  }

  const parts = code.split('-');
  console.log('Code parts:', parts, 'Segments count:', segmentsCache.length);

  const validatedParts: string[] = [];
  const invalidSegments: string[] = [];
  const segmentDetails: Record<string, { value: string; description: string; name: string }> = {};
  let allValid = true;

  for (let i = 0; i < segmentsCache.length; i++) {
    const segment = segmentsCache[i];
    const inputValue = parts[i] || '';

    console.log(`Validating segment ${i}: ${segment.prompt || segment.segment_name}, input: "${inputValue}"`);

    // If empty, keep it (it will be handled by required field validation)
    if (!inputValue) {
      validatedParts.push('');
      continue;
    }

    // Check if values are cached for this segment
    let values = valuesCache.get(segment.segment_code);
    console.log(`Values cache for ${segment.segment_code}:`, values ? `${values.length} values` : 'not cached');

    // If not cached, try to fetch
    if (!values) {
      try {
        console.log(`Fetching values for ${segment.segment_code}...`);
        const response = await fetch(`${VALUES_API}/${segment.segment_code}`);
        if (response.ok) {
          const result = await response.json();
          values = (result.items || []).map((item: any) => ({
            ValueId: item.value_id,
            Value: item.value,
            Description: item.description,
            EnabledFlag: item.enabled_flag,
          }));
          valuesCache.set(segment.segment_code, values!);
          console.log(`Loaded ${values!.length} values for ${segment.segment_code}`);
        } else {
          console.error(`Failed to fetch values for ${segment.segment_code}: ${response.status}`);
        }
      } catch (error) {
        console.error(`Error fetching values for ${segment.segment_code}:`, error);
      }
    }

    // Validate the value
    if (values && values.length > 0) {
      const foundValue = values.find(v => v.Value === inputValue);
      const isValidValue = !!foundValue;
      console.log(`Segment ${segment.prompt}: "${inputValue}" is ${isValidValue ? 'VALID' : 'INVALID'}`);
      if (isValidValue) {
        validatedParts.push(inputValue);
        // Store segment details for valid values
        segmentDetails[segment.segment_code] = {
          value: inputValue,
          description: foundValue.Description || '',
          name: segment.prompt || segment.segment_name,
        };
      } else {
        validatedParts.push(''); // Leave blank for invalid
        invalidSegments.push(segment.prompt || segment.segment_name);
        allValid = false;
      }
    } else {
      // If we couldn't fetch values, assume valid (fail open)
      console.log(`No values for segment ${segment.prompt}, assuming valid`);
      validatedParts.push(inputValue);
      // Still add to segment details with empty description
      segmentDetails[segment.segment_code] = {
        value: inputValue,
        description: '',
        name: segment.prompt || segment.segment_name,
      };
    }
  }

  const result = {
    isValid: allValid,
    validatedCode: validatedParts.join('-'),
    invalidSegments,
    segmentsLoaded: true,
    segmentDetails,
  };
  console.log('Validation result:', result);
  return result;
};

// Check if cache is populated
export const isCacheLoaded = (): boolean => {
  return segmentsCache.length > 0 && valuesCache.size > 0;
};

const AccountSelector: React.FC<AccountSelectorProps> = ({
  visible,
  onCancel,
  onSelect,
  initialValue,
  lockedFirstSegment,
}) => {
  const [loading, setLoading] = useState(false);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedValues, setSelectedValues] = useState<Record<string, string>>({});
  const [valuesLoading, setValuesLoading] = useState<Record<string, boolean>>({});
  const [segmentValues, setSegmentValues] = useState<Record<string, SegmentValue[]>>({});
  const initialized = useRef(false);

  // Fetch segments from API
  const fetchSegments = useCallback(async () => {
    if (segmentsCache.length > 0) {
      setSegments(segmentsCache);
      return segmentsCache;
    }

    setLoading(true);
    try {
      const response = await fetch(SEGMENTS_API);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const result = await response.json();
      const segmentData: Segment[] = (result.items || []).sort(
        (a: Segment, b: Segment) => a.sequence_no - b.sequence_no
      );
      segmentsCache.push(...segmentData);
      setSegments(segmentData);
      return segmentData;
    } catch (error) {
      console.error('Error fetching segments:', error);
      message.error('Failed to fetch segments');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch values for a segment
  const fetchValues = useCallback(async (segmentCode: string): Promise<SegmentValue[]> => {
    if (valuesCache.has(segmentCode)) {
      const cached = valuesCache.get(segmentCode) || [];
      setSegmentValues(prev => prev[segmentCode] ? prev : { ...prev, [segmentCode]: cached });
      return cached;
    }

    setValuesLoading(prev => ({ ...prev, [segmentCode]: true }));
    try {
      const response = await fetch(`${VALUES_API}/${segmentCode}`);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const result = await response.json();
      const values: SegmentValue[] = (result.items || []).map((item: any) => ({
        ValueId: item.value_id,
        Value: item.value,
        Description: item.description,
        EnabledFlag: item.enabled_flag,
      }));
      valuesCache.set(segmentCode, values);
      setSegmentValues(prev => ({ ...prev, [segmentCode]: values }));
      return values;
    } catch (error) {
      console.error(`Error fetching values for ${segmentCode}:`, error);
      return [];
    } finally {
      setValuesLoading(prev => ({ ...prev, [segmentCode]: false }));
    }
  }, []);

  // Initialize on open
  useEffect(() => {
    if (visible && !initialized.current) {
      initialized.current = true;
      const init = async () => {
        const segs = await fetchSegments();
        // Pre-fetch all segment values
        await Promise.all(segs.map(seg => fetchValues(seg.segment_code)));
      };
      init();
    }
  }, [visible, fetchSegments, fetchValues]);

  // Parse initial value when modal opens
  useEffect(() => {
    if (visible && segments.length > 0) {
      const newValues: Record<string, string> = {};
      if (initialValue) {
        const parts = initialValue.split('-');
        segments.forEach((seg, index) => {
          if (parts[index]) newValues[seg.segment_code] = parts[index];
        });
      } else {
        Object.assign(newValues, applyDefaults(segments, segmentValues, lockedFirstSegment));
      }
      // Always override first segment with locked value when provided
      if (lockedFirstSegment && segments.length > 0) {
        newValues[segments[0].segment_code] = lockedFirstSegment;
      }
      setSelectedValues(newValues);
    }
  }, [visible, initialValue, segments, segmentValues, lockedFirstSegment]);

  // Handle value change
  const handleValueChange = (segmentCode: string, value: string) => {
    setSelectedValues(prev => ({ ...prev, [segmentCode]: value }));
  };

  // Get description for a value
  const getDescription = (segmentCode: string, value: string): string => {
    const values = segmentValues[segmentCode] || valuesCache.get(segmentCode) || [];
    const found = values.find(v => v.Value === value);
    return found?.Description || 'Default';
  };

  // Build combined account code
  const buildAccountCode = (): string => {
    return segments.map(seg => selectedValues[seg.segment_code] || '').join('-');
  };

  // Handle OK
  const handleOk = () => {
    const accountCode = buildAccountCode();
    const segmentDetails: Record<string, { value: string; description: string; name: string }> = {};
    segments.forEach(seg => {
      const value = selectedValues[seg.segment_code] || '';
      segmentDetails[seg.segment_code] = {
        value,
        description: getDescription(seg.segment_code, value),
        name: seg.prompt || seg.segment_name, // User-friendly name like "Company", "Cost Center"
      };
    });
    onSelect(accountCode, segmentDetails);
  };

  // Handle Reset
  const handleReset = () => {
    setSelectedValues(applyDefaults(segments, segmentValues, lockedFirstSegment));
  };

  // Handle Refresh - clear cache and re-fetch data
  const handleRefresh = async () => {
    clearCache();
    setSegments([]);
    setSegmentValues({});
    setSelectedValues({});
    setLoading(true);

    try {
      // Fetch segments
      const response = await fetch(SEGMENTS_API);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      const result = await response.json();
      const segmentData: Segment[] = (result.items || []).sort(
        (a: Segment, b: Segment) => a.sequence_no - b.sequence_no
      );
      segmentsCache.push(...segmentData);
      setSegments(segmentData);

      // Fetch all segment values
      const valuesPromises = segmentData.map(async (seg) => {
        setValuesLoading(prev => ({ ...prev, [seg.segment_code]: true }));
        try {
          const valResponse = await fetch(`${VALUES_API}/${seg.segment_code}`);
          if (!valResponse.ok) throw new Error(`HTTP error! status: ${valResponse.status}`);
          const valResult = await valResponse.json();
          const values: SegmentValue[] = (valResult.items || []).map((item: any) => ({
            ValueId: item.value_id,
            Value: item.value,
            Description: item.description,
            EnabledFlag: item.enabled_flag,
          }));
          valuesCache.set(seg.segment_code, values);
          setSegmentValues(prev => ({ ...prev, [seg.segment_code]: values }));
          return { segmentCode: seg.segment_code, values };
        } finally {
          setValuesLoading(prev => ({ ...prev, [seg.segment_code]: false }));
        }
      });

      const allValues = await Promise.all(valuesPromises);

      // Set default values
      const mergedMap: Record<string, SegmentValue[]> = {};
      allValues.forEach(({ segmentCode, values }) => { mergedMap[segmentCode] = values; });
      setSelectedValues(applyDefaults(segmentData, mergedMap, lockedFirstSegment));

      message.success('Data refreshed successfully');
    } catch (error) {
      console.error('Error refreshing data:', error);
      message.error('Failed to refresh data');
    } finally {
      setLoading(false);
    }
  };

  // Render segment row
  const renderSegmentRow = (segment: Segment, index: number) => {
    const values = segmentValues[segment.segment_code] || valuesCache.get(segment.segment_code) || [];
    const isLoading = valuesLoading[segment.segment_code];
    const selectedValue = selectedValues[segment.segment_code] || '';
    const description = getDescription(segment.segment_code, selectedValue);
    const isLocked = index === 0 && !!lockedFirstSegment;

    return (
      <Row
        key={segment.segment_code}
        align="middle"
        style={{ marginBottom: 8 }}
        gutter={8}
      >
        <Col span={6} style={{ textAlign: 'right', paddingRight: 8 }}>
          <Text strong>{segment.prompt || segment.segment_name}</Text>
        </Col>
        <Col span={6}>
          <Select
            value={selectedValue}
            onChange={(val) => handleValueChange(segment.segment_code, val)}
            style={{ width: '100%' }}
            loading={isLoading}
            disabled={isLocked}
            showSearch
            optionFilterProp="label"
            filterOption={(input, option) => {
              const searchTerm = input.toLowerCase();
              const value = (option?.value as string)?.toLowerCase() || '';
              const desc = (option?.['data-description'] as string)?.toLowerCase() || '';
              return value.includes(searchTerm) || desc.includes(searchTerm);
            }}
            optionLabelProp="value"
            dropdownStyle={{ minWidth: 350 }}
          >
            {values.map(v => (
              <Option
                key={v.Value}
                value={v.Value}
                label={`${v.Value} - ${v.Description}`}
                data-description={v.Description}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontWeight: 500, minWidth: 60 }}>{v.Value}</span>
                  <span style={{ color: '#666', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {v.Description}
                  </span>
                </div>
              </Option>
            ))}
          </Select>
        </Col>
        <Col span={12}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {description}
          </Text>
        </Col>
      </Row>
    );
  };

  return (
    <Modal
      title="Account"
      open={visible}
      onCancel={onCancel}
      width={650}
      zIndex={2000}
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button icon={<ReloadOutlined />} onClick={handleRefresh} loading={loading}>
            Refresh
          </Button>
          <Button icon={<SearchOutlined />} onClick={handleReset}>
            Reset
          </Button>
          <div style={{ width: 16 }} />
          <Button type="primary" onClick={handleOk}>
            OK
          </Button>
          <Button onClick={onCancel}>
            Cancel
          </Button>
        </div>
      }
      styles={{
        body: { padding: '16px 24px' }
      }}
    >
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
          <div style={{ marginTop: 16 }}>Loading segments...</div>
        </div>
      ) : (
        <>
          {/* All segments displayed directly */}
          <div>
            {segments.map((segment, index) => renderSegmentRow(segment, index))}
          </div>

          {/* Preview of combined account code */}
          <div
            style={{
              marginTop: 12,
              padding: 10,
              background: '#f5f5f5',
              borderRadius: 4,
              textAlign: 'center',
            }}
          >
            <Text strong>Account Code: </Text>
            <Text code style={{ fontSize: 13 }}>{buildAccountCode()}</Text>
          </div>
        </>
      )}
    </Modal>
  );
};

export default AccountSelector;
