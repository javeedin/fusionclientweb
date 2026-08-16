import React, { useState, useMemo, useEffect } from 'react';
import { Modal, Input, Button, Spin, Empty, Tag, Card, Row, Col, Typography, Drawer, Divider, Space, Input as AntInput, Segmented } from 'antd';
import { SearchOutlined, CheckCircleOutlined, ApiOutlined, CopyOutlined } from '@ant-design/icons';
import { searchCustomersByBIP, CustomerSearchResult, buildCustomerSearchSoapEnvelope } from '../services/customerSearchBip.service';
import { ORACLE_SOAP_CONFIG } from '../config/api.config';
import { message } from 'antd';

const { Text } = Typography;

// Helper to build SOAP envelope for preview
const buildPreviewSoapEnvelope = (reportPath: string, businessUnitId: string, customer: string, username: string, password: string, searchType: 'name' | 'account' = 'name'): string => {
  const parameters: Record<string, string> = {
    BUSINESS_UNIT_ID: businessUnitId,
  };

  if (searchType === 'name') {
    parameters.CUSTOMER_NAME = customer;
  } else {
    parameters.account_number = customer;
  }

  const paramXml = Object.entries(parameters)
    .map(([key, value]) => `
            <v2:item>
              <v2:name>${key}</v2:name>
              <v2:values><v2:item>${value}</v2:item></v2:values>
            </v2:item>`)
    .join('');

  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v2="http://xmlns.oracle.com/oxp/service/v2">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:runReport>
      <v2:reportRequest>
        <v2:reportAbsolutePath>${reportPath}</v2:reportAbsolutePath>
        <v2:parameterNameValues>
          <v2:listOfParamNameValues>${paramXml}
          </v2:listOfParamNameValues>
        </v2:parameterNameValues>
        <v2:reportData/>
        <v2:reportOutputPath/>
      </v2:reportRequest>
      <v2:userID>${username}</v2:userID>
      <v2:password>${password}</v2:password>
    </v2:runReport>
  </soapenv:Body>
</soapenv:Envelope>`;
};

interface CustomerSearchBipModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (customer: CustomerSearchResult) => void;
  businessUnitId?: string;
  businessUnitName?: string;
  soapBaseUrl?: string;
  username?: string;
  password?: string;
}

const CustomerSearchBipModal: React.FC<CustomerSearchBipModalProps> = ({
  open,
  onClose,
  onSelect,
  businessUnitId = '',
  businessUnitName = '',
  soapBaseUrl = ORACLE_SOAP_CONFIG.prod.baseUrl,
  username = ORACLE_SOAP_CONFIG.prod.username,
  password = ORACLE_SOAP_CONFIG.prod.password,
}) => {
  const [searchText, setSearchText] = useState('');
  const [filterText, setFilterText] = useState('');
  const [allCustomers, setAllCustomers] = useState<CustomerSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [apiDrawerOpen, setApiDrawerOpen] = useState(false);
  const [lastApiDetails, setLastApiDetails] = useState<{ url?: string; envelope?: string }>({});
  const [searchType, setSearchType] = useState<'name' | 'account'>('name');

  // Reset state when modal closes
  useEffect(() => {
    if (!open) {
      setSearchText('');
      setFilterText('');
      setAllCustomers([]);
      setSearched(false);
    }
  }, [open]);

  // Search customers when user clicks search button
  const handleSearch = async () => {
    if (!searchText.trim()) {
      alert('Please enter a customer name, account number, or party number to search');
      return;
    }

    setLoading(true);
    setSearched(true);
    try {
      const response = await searchCustomersByBIP(
        businessUnitId,
        searchText,
        soapBaseUrl,
        username,
        password,
        searchType
      );

      // Capture API details for debugging
      setLastApiDetails({
        url: response.soapUrl,
        envelope: response.soapEnvelope,
      });

      if (response.success && response.customers) {
        setAllCustomers(response.customers);
      } else {
        setAllCustomers([]);
      }
    } catch (error) {
      console.error('Customer search error:', error);
      setAllCustomers([]);
    } finally {
      setLoading(false);
    }
  };

  // Filter customers based on search text
  const filteredCustomers = useMemo(() => {
    if (!filterText.trim()) return allCustomers;

    const searchLower = filterText.toLowerCase();
    return allCustomers.filter(c =>
      c.accountName?.toLowerCase().includes(searchLower) ||
      c.accountNumber?.toLowerCase().includes(searchLower) ||
      c.partyNumber?.toLowerCase().includes(searchLower) ||
      c.buName?.toLowerCase().includes(searchLower)
    );
  }, [allCustomers, filterText]);

  const handleSelectCustomer = (customer: CustomerSearchResult) => {
    onSelect(customer);
    setFilterText('');
    setAllCustomers([]);
    onClose();
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      message.success('Copied to clipboard');
    }).catch(() => {
      message.error('Failed to copy');
    });
  };

  return (
    <>
      <Modal
        title={<div style={{ fontSize: '18px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', width: '100%', paddingRight: '40px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SearchOutlined style={{ color: '#1890ff' }} />
            <span>Find Customer {businessUnitName && <span style={{ fontSize: '14px', fontWeight: '500', color: '#666' }}>({businessUnitName})</span>}</span>
          </div>
          {(lastApiDetails.url || searchText.trim()) && (
            <Button
              type="text"
              size="small"
              icon={<ApiOutlined style={{ color: '#1890ff' }} />}
              onClick={() => setApiDrawerOpen(true)}
              title={searchText.trim() ? "View API Payload Preview" : "View API Details"}
              style={{ marginRight: '0px' }}
            />
          )}
        </div>}
        open={open}
        onCancel={onClose}
        width={900}
        footer={null}
        bodyStyle={{ padding: '24px' }}
      >
      {!businessUnitId && (
        <Empty description="Select a business unit first to search customers" />
      )}

      {businessUnitId && (
        <>
          {/* Search Type Toggle */}
          <div style={{ marginBottom: '16px' }}>
            <Segmented
              value={searchType}
              onChange={(value) => setSearchType(value as 'name' | 'account')}
              options={[
                { label: 'Search by Name', value: 'name' },
                { label: 'Search by Account Number', value: 'account' },
              ]}
              block
              size="large"
            />
          </div>

          {/* Search Input with Button */}
          <div style={{ marginBottom: '24px', display: 'flex', gap: '12px' }}>
            <Input
              placeholder={searchType === 'name' ? 'Enter customer name...' : 'Enter account number...'}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onPressEnter={handleSearch}
              prefix={<SearchOutlined style={{ color: '#1890ff' }} />}
              size="large"
              allowClear
              style={{ borderRadius: '6px', flex: 1 }}
              disabled={loading}
            />
            <Button
              type="primary"
              size="large"
              icon={<SearchOutlined />}
              onClick={handleSearch}
              loading={loading}
              style={{ borderRadius: '6px' }}
            >
              Search
            </Button>
          </div>

          {loading && (
            <div style={{ textAlign: 'center', padding: '60px 20px' }}>
              <Spin size="large" tip="Searching customers..." />
            </div>
          )}

          {!loading && searched && allCustomers.length === 0 && (
            <Empty description="No customers found" />
          )}

          {!loading && !searched && (
            <Empty description="Enter a search term and click Search to find customers" />
          )}

          {!loading && searched && allCustomers.length > 0 && (
            <>
              {/* Filter Input */}
              <div style={{ marginBottom: '24px' }}>
                <Input
                  placeholder="Filter results by name, account, party number or BU..."
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  prefix={<SearchOutlined style={{ color: '#1890ff' }} />}
                  size="large"
                  allowClear
                  style={{ borderRadius: '6px' }}
                />
                <div style={{ fontSize: '12px', color: '#999', marginTop: '8px' }}>
                  Showing {filteredCustomers.length} of {allCustomers.length} customers
                </div>
              </div>

              {filteredCustomers.length === 0 ? (
                <Empty description="No customers match your filter" />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {filteredCustomers.map((customer, idx) => (
                    <Card
                      key={idx}
                      hoverable
                      onClick={() => handleSelectCustomer(customer)}
                      style={{
                        cursor: 'pointer',
                        borderRadius: '8px',
                        border: '1px solid #e8e8e8',
                        transition: 'all 0.3s',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
                        e.currentTarget.style.borderColor = '#1890ff';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.boxShadow = 'none';
                        e.currentTarget.style.borderColor = '#e8e8e8';
                      }}
                    >
                      <Row gutter={16} align="middle">
                        <Col flex="auto">
                          <div>
                            <div style={{ fontSize: '16px', fontWeight: '700', marginBottom: '6px', color: '#262626' }}>
                              {customer.accountName}
                            </div>
                            <div style={{ display: 'flex', gap: '20px', fontSize: '12px', color: '#666', marginBottom: '6px', flexWrap: 'wrap' }}>
                              <span><Text strong>Acct:</Text> {customer.accountNumber}</span>
                              <span><Text strong>Party:</Text> {customer.partyNumber}</span>
                              {customer.city && <span><Text strong>City:</Text> {customer.city}</span>}
                              {customer.country && <span><Text strong>Country:</Text> {customer.country}</span>}
                              {customer.prCreditLimit !== undefined && (
                                <span><Text strong>Credit Limit:</Text> {customer.prCreditLimit?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                              )}
                              {customer.status && (
                                <span>
                                  <Tag color={customer.status === 'A' ? 'green' : 'red'}>
                                    {customer.status === 'A' ? 'Active' : 'Inactive'}
                                  </Tag>
                                </span>
                              )}
                            </div>
                            {customer.buName && (
                              <div style={{ fontSize: '11px', color: '#999', fontStyle: 'italic' }}>
                                BU: {customer.buName}
                              </div>
                            )}
                          </div>
                        </Col>
                        <Col>
                          <Button
                            type="primary"
                            icon={<CheckCircleOutlined />}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectCustomer(customer);
                            }}
                          >
                            Select
                          </Button>
                        </Col>
                      </Row>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </Modal>

    {/* API Details Drawer */}
    <Drawer
      title={searchText.trim() && !searched ? "API Payload Preview" : "API Details"}
      placement="right"
      onClose={() => setApiDrawerOpen(false)}
      open={apiDrawerOpen}
      width={600}
      bodyStyle={{ padding: '24px' }}
    >
      {lastApiDetails.url || lastApiDetails.envelope || searchText.trim() ? (
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {/* SOAP Endpoint URL */}
          <div>
            <div style={{ fontSize: '14px', fontWeight: '700', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <ApiOutlined />
              SOAP Endpoint
            </div>
            <div style={{
              backgroundColor: '#f5f5f5',
              padding: '12px',
              borderRadius: '6px',
              fontFamily: 'monospace',
              fontSize: '12px',
              wordBreak: 'break-all',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: '8px'
            }}>
              <span style={{ flex: 1 }}>{lastApiDetails.url || soapBaseUrl || 'N/A'}</span>
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => copyToClipboard(lastApiDetails.url || soapBaseUrl || '')}
              />
            </div>
          </div>

          <Divider style={{ margin: '16px 0' }} />

          {/* SOAP Envelope Payload */}
          <div>
            <div style={{ fontSize: '14px', fontWeight: '700', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>📦</span>
              SOAP Envelope Payload {searchText.trim() && !searched && <Tag color="blue">Preview</Tag>}
            </div>
            <div style={{
              backgroundColor: '#f5f5f5',
              padding: '12px',
              borderRadius: '6px',
              fontFamily: 'monospace',
              fontSize: '11px',
              overflow: 'auto',
              maxHeight: '400px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              border: '1px solid #e0e0e0',
              lineHeight: '1.5'
            }}>
              {lastApiDetails.envelope || (searchText.trim() ? buildPreviewSoapEnvelope(
                '/Custom/fusion_client/AR/CUSTOMER_SEARCH_BY_NAME_BIP.xdo',
                businessUnitId || '',
                searchText,
                username || '',
                password || '',
                searchType
              ) : 'N/A')}
            </div>
            {(lastApiDetails.envelope || searchText.trim()) && (
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={() => copyToClipboard(lastApiDetails.envelope || (searchText.trim() ? buildPreviewSoapEnvelope(
                  '/Custom/fusion_client/AR/CUSTOMER_SEARCH_BY_NAME_BIP.xdo',
                  businessUnitId || '',
                  searchText,
                  username || '',
                  password || '',
                  searchType
                ) : ''))}
                style={{ marginTop: '8px' }}
              >
                Copy Payload
              </Button>
            )}
          </div>

          <Divider style={{ margin: '16px 0' }} />

          {/* Service Information */}
          <div>
            <div style={{ fontSize: '14px', fontWeight: '700', marginBottom: '8px' }}>Service Information</div>
            <div style={{ fontSize: '12px', color: '#666', lineHeight: '1.8' }}>
              <div><strong>Service:</strong> Oracle BI Publisher (BIP) SOAP API</div>
              <div><strong>Report Path:</strong> /Custom/fusion_client/AR/CUSTOMER_SEARCH_BY_NAME_BIP.xdo</div>
              <div><strong>Method:</strong> runReport</div>
              <div style={{ marginTop: '8px', padding: '8px', backgroundColor: '#e6f7ff', borderRadius: '4px', border: '1px solid #b3d9ff' }}>
                <strong>Search Parameters:</strong>
                <div style={{ marginTop: '4px', marginLeft: '8px' }}>
                  • BUSINESS_UNIT_ID: {businessUnitId || 'N/A'}
                  <br />
                  {searchType === 'name' ? (
                    <>• CUSTOMER_NAME: {searchText || 'N/A'}</>
                  ) : (
                    <>• account_number: {searchText || 'N/A'}</>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Space>
      ) : (
        <Empty description="Enter a customer name and the API payload will appear here." />
      )}
    </Drawer>
    </>
  );
};

export default CustomerSearchBipModal;
