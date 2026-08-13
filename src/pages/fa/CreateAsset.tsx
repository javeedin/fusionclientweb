import React, { useState, useEffect } from 'react';
import {
  Layout, Card, Form, Input, Select, Button, Space, Typography, Row, Col,
  Steps, InputNumber, DatePicker, Descriptions, message, Breadcrumb, Divider,
  Modal, Tag, Alert, Spin, Tooltip,
} from 'antd';
import {
  HomeOutlined, SaveOutlined, LeftOutlined, RightOutlined,
  CheckCircleOutlined, DatabaseOutlined, BookOutlined, EnvironmentOutlined,
  BarcodeOutlined, DollarOutlined, BugOutlined, CopyOutlined, SendOutlined, LinkOutlined,
} from '@ant-design/icons';
import { APEX_DB_CONFIG } from '../../config/api.config';
import { useAuth } from '../../context/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  createAsset, getCategories, getMethods, getLocations, getBookControls, getCcids, peekAssetNumber,
  assetTypeLabel, formatCurrency,
} from '../../services/fa.service';
import type { CategoryRecord, MethodRecord, LocationRecord, BookControlRecord, CcidRecord } from '../../services/fa.service';

const { Content } = Layout;
const { Title, Text } = Typography;
const { Option } = Select;

const REDWOOD = {
  primary:    '#C74634',
  success:    '#1D7B4D',
  warning:    '#D4A800',
  info:       '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface:    '#FFFFFF',
};
const FA_COLOR = '#CA7700';

const STEPS = ['Asset Details', 'Book & Financials', 'Assignment', 'Review & Submit'];

const CreateAsset: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [form]    = Form.useForm();
  const [current, setCurrent] = useState(0);
  const [saving,  setSaving]  = useState(false);

  // Lookup data
  const [categories,   setCategories]   = useState<CategoryRecord[]>([]);
  const [methods,      setMethods]      = useState<MethodRecord[]>([]);
  const [locations,    setLocations]    = useState<LocationRecord[]>([]);
  const [bookControls, setBookControls] = useState<BookControlRecord[]>([]);
  const [ccids,        setCcids]        = useState<CcidRecord[]>([]);
  const [ccidLoading,  setCcidLoading]  = useState(false);

  const FA_BASE = `${APEX_DB_CONFIG.baseUrl}`;
  const LOCATIONS_URL = `${FA_BASE}/fa/locations`;
  const CCID_URL      = `${FA_BASE}/fa/ccid`;

  // Collected values across steps (merged on submit)
  const [stepData, setStepData] = useState<Record<string, any>>({});

  // Selected method life display
  const [selectedMethodLife, setSelectedMethodLife] = useState<string>('');

  // Depreciation preview modal
  const [deprnModal, setDeprnModal] = useState(false);
  const [deprnFromDate, setDeprnFromDate] = useState<dayjs.Dayjs | null>(null);
  const [deprnToDate, setDeprnToDate]     = useState<dayjs.Dayjs>(dayjs());

  interface DeprnRow { period: string; openingNbv: number; depreciation: number; closingNbv: number; }
  const [deprnRows, setDeprnRows] = useState<DeprnRow[]>([]);

  const openDeprnPreview = () => {
    const vals = { ...stepData, ...form.getFieldsValue() };
    const dpis = vals.datePlacedInService;
    setDeprnFromDate(dayjs.isDayjs(dpis) ? dpis : dpis ? dayjs(dpis) : null);
    setDeprnToDate(dayjs());
    setDeprnRows([]);
    setDeprnModal(true);
  };

  const calcDeprn = () => {
    const vals = { ...stepData, ...form.getFieldsValue() };
    const cost       = Number(vals.cost ?? 0);
    const salvage    = Number(vals.salvageValue ?? 0);
    const lifeMonths = Number(selectedMethodLife || 0);
    const depFlag    = (vals.depreciateFlag ?? 'YES') === 'YES';

    if (!depFlag || lifeMonths <= 0 || cost <= 0 || !deprnFromDate || !deprnToDate) {
      setDeprnRows([]);
      return;
    }

    const monthlyDeprn = (cost - salvage) / lifeMonths;
    const rows: DeprnRow[] = [];
    let nbv = cost;
    let cur = deprnFromDate.startOf('month');
    const end = deprnToDate.startOf('month');

    while (cur.isBefore(end) || cur.isSame(end, 'month')) {
      const depr = Math.min(monthlyDeprn, nbv - salvage);
      if (depr <= 0) { cur = cur.add(1, 'month'); continue; }
      rows.push({
        period:       cur.format('MMM-YYYY'),
        openingNbv:   nbv,
        depreciation: depr,
        closingNbv:   nbv - depr,
      });
      nbv -= depr;
      cur = cur.add(1, 'month');
    }
    setDeprnRows(rows);
  };

  // Auto-filled CCID info from selected category
  const [autoCcid, setAutoCcid] = useState<{ ccid: string; label: string; segCo?: string; segLob?: string; segDept?: string; segAccount?: string; segSubAcc?: string; segAlys?: string; segIc?: string; segFut1?: string; segFut2?: string } | null>(null);

  // Debug modal
  const [debugModal, setDebugModal] = useState(false);
  const [testResult, setTestResult] = useState<{ status: number; body: string } | null>(null);
  const [testing, setTesting] = useState(false);

  const FA_ASSETS_URL = `${APEX_DB_CONFIG.baseUrl}/fa/assets`;

  const buildPayload = () => {
    const vals = form.getFieldsValue();
    const payload = { ...stepData, ...vals };
    if (payload.datePlacedInService && dayjs.isDayjs(payload.datePlacedInService))
      payload.datePlacedInService = payload.datePlacedInService.format('YYYY-MM-DD');
    // Resolve methodCode from selected methodId
    if (payload.methodId) {
      const m = methods.find((x, i) => (x.methodId || x.methodCode || String(i)) === payload.methodId);
      if (m) { payload.methodCode = m.methodCode; payload.lifeInMonths = m.lifeInMonths; }
    }
    const loginUser = user?.username || user?.name || 'REACTERP';
    payload.createdBy = loginUser;
    payload.lastUpdatedBy = loginUser;
    return payload;
  };

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await fetch(FA_ASSETS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(buildPayload()),
      });
      const text = await res.text();
      setTestResult({ status: res.status, body: text });
    } catch (e: any) {
      setTestResult({ status: 0, body: e.message });
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    getCategories().then(setCategories);
    getMethods().then(setMethods);
    getLocations().then(setLocations);
    getBookControls().then(setBookControls);
    setCcidLoading(true);
    getCcids().then(r => { setCcids(r); setCcidLoading(false); });
    // Preview next asset number (reads LAST_NUMBER — no NEXTVAL consumed here)
    peekAssetNumber().then(num => {
      if (num) form.setFieldValue('assetNumber', num);
    });
  }, []);

  // ── Navigation ──────────────────────────────────────────────────────────────
  const goNext = async () => {
    try {
      const vals = await form.validateFields();
      setStepData(prev => ({ ...prev, ...vals }));
      setCurrent(c => c + 1);
    } catch {
      // validation errors shown inline
    }
  };

  const goBack = () => {
    const vals = form.getFieldsValue();
    setStepData(prev => ({ ...prev, ...vals }));
    setCurrent(c => c - 1);
  };

  const handleSubmit = async () => {
    const vals = form.getFieldsValue();
    const payload = { ...stepData, ...vals };

    // Convert dayjs → string
    if (payload.datePlacedInService && dayjs.isDayjs(payload.datePlacedInService)) {
      payload.datePlacedInService = payload.datePlacedInService.format('YYYY-MM-DD');
    }
    // Enrich method fields
    if (payload.methodId) {
      const m = methods.find((x, i) => (x.methodId || x.methodCode || String(i)) === payload.methodId);
      if (m) { payload.methodCode = m.methodCode; payload.lifeInMonths = m.lifeInMonths; }
    }
    const loginUser = user?.username || user?.name || 'REACTERP';
    payload.createdBy = loginUser;
    payload.lastUpdatedBy = loginUser;

    setSaving(true);
    try {
      const res = await createAsset(payload);
      if (res.success) {
        message.success(`Asset ${res.assetNumber} created (ID: ${res.assetId})`);
        navigate('/fa/assets');
      } else {
        message.error(res.error || 'Failed to create asset');
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Step 0 — Asset Details ──────────────────────────────────────────────────
  const StepDetails = () => (
    <Row gutter={[16, 0]}>
      <Col xs={24} sm={8}>
        <Form.Item name="assetNumber" label="Asset Number" rules={[{ required: true, message: 'Required' }]}>
          <Input
            placeholder="Auto-generated on save…"
            prefix={<BarcodeOutlined />}
            readOnly
            style={{ background: '#f9f9f9', cursor: 'default' }}
          />
        </Form.Item>
      </Col>
      <Col xs={24} sm={8}>
        <Form.Item name="assetType" label="Asset Type" rules={[{ required: true, message: 'Required' }]}>
          <Select placeholder="Select type">
            <Option value="CAPITALIZED">Capitalized</Option>
            <Option value="CIP">CIP (Construction In Progress)</Option>
            <Option value="EXPENSED">Expensed</Option>
          </Select>
        </Form.Item>
      </Col>
      <Col xs={24} sm={8}>
        <Form.Item name="categoryId" label="Category" rules={[{ required: true, message: 'Required' }]}>
          <Select
            showSearch optionFilterProp="children" placeholder="Select category"
            onChange={val => {
              const cat = categories.find(c => c.categoryId === val);
              if (cat?.assetCostAccountCcid) {
                const ccidStr = String(cat.assetCostAccountCcid);
                form.setFieldValue('codeCombinationId', ccidStr);
                setAutoCcid({
                  ccid:       ccidStr,
                  label:      cat.assetCostAccount || ccidStr,
                  segCo:      cat.segCo,
                  segLob:     cat.segLob,
                  segDept:    cat.segDept,
                  segAccount: cat.segAccount,
                  segSubAcc:  cat.segSubAcc,
                  segAlys:    cat.segAlys,
                  segIc:      cat.segIc,
                  segFut1:    cat.segFut1,
                  segFut2:    cat.segFut2,
                });
              } else {
                setAutoCcid(null);
              }
            }}
          >
            {categories.map(c => (
              <Option key={c.categoryId} value={c.categoryId}>
                {[c.segment1, c.segment2].filter(Boolean).join(' / ')} — {c.description}
                {c.assetCostAccount ? ` [${c.assetCostAccount}]` : ''}
              </Option>
            ))}
          </Select>
        </Form.Item>
      </Col>
      <Col xs={24}>
        <Form.Item name="description" label="Description" rules={[{ required: true, message: 'Required' }]}>
          <Input.TextArea rows={2} placeholder="Asset description" />
        </Form.Item>
      </Col>
      <Col xs={24} sm={6}>
        <Form.Item name="tagNumber" label="Tag Number">
          <Input placeholder="Physical tag / barcode" />
        </Form.Item>
      </Col>
      <Col xs={24} sm={6}>
        <Form.Item name="serialNumber" label="Serial Number">
          <Input placeholder="Manufacturer serial" />
        </Form.Item>
      </Col>
      <Col xs={24} sm={6}>
        <Form.Item name="manufacturerName" label="Manufacturer">
          <Input placeholder="e.g. Dell, Cisco" />
        </Form.Item>
      </Col>
      <Col xs={24} sm={6}>
        <Form.Item name="modelNumber" label="Model Number">
          <Input placeholder="Model / part number" />
        </Form.Item>
      </Col>
      <Col xs={12} sm={4}>
        <Form.Item name="units" label="Units" initialValue={1}>
          <InputNumber min={1} style={{ width: '100%' }} />
        </Form.Item>
      </Col>
      <Col xs={12} sm={5}>
        <Form.Item name="inUseFlag" label="In Use" initialValue="YES">
          <Select>
            <Option value="YES">Yes</Option>
            <Option value="NO">No</Option>
          </Select>
        </Form.Item>
      </Col>
      <Col xs={12} sm={8}>
        <Form.Item name="ownedLeased" label="Owned / Leased" initialValue="OWNED">
          <Select>
            <Option value="OWNED">Owned</Option>
            <Option value="LEASED">Leased</Option>
          </Select>
        </Form.Item>
      </Col>
      <Col xs={12} sm={7}>
        <Form.Item name="newUsed" label="New / Used" initialValue="NEW">
          <Select>
            <Option value="NEW">New</Option>
            <Option value="USED">Used</Option>
          </Select>
        </Form.Item>
      </Col>
    </Row>
  );

  // ── Step 1 — Book & Financials ──────────────────────────────────────────────
  const StepBook = () => (
    <Row gutter={[16, 0]}>
      <Col xs={24} sm={12}>
        <Form.Item name="bookTypeCode" label="Book Type" rules={[{ required: true, message: 'Required' }]}>
          <Select showSearch optionFilterProp="children" placeholder="Select book">
            {bookControls.map(b => (
              <Option key={b.bookTypeCode} value={b.bookTypeCode}>
                {b.bookTypeCode} — {b.bookTypeName}
              </Option>
            ))}
          </Select>
        </Form.Item>
      </Col>
      <Col xs={24} sm={12}>
        <Form.Item name="datePlacedInService" label="Date Placed in Service" rules={[{ required: true, message: 'Required' }]}>
          <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" placeholder="DD-MMM-YYYY" />
        </Form.Item>
      </Col>
      <Col xs={24} sm={8}>
        <Form.Item name="cost" label="Cost" rules={[{ required: true, message: 'Required' }]}>
          <InputNumber
            style={{ width: '100%' }} min={0} step={0.01}
            formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            parser={v => (v ? parseFloat(v.replace(/,/g, '')) : 0) as unknown as 0}
            prefix={<DollarOutlined />}
            placeholder="0.00"
          />
        </Form.Item>
      </Col>
      <Col xs={24} sm={8}>
        <Form.Item name="salvageValue" label="Salvage Value" initialValue={0}>
          <InputNumber
            style={{ width: '100%' }} min={0} step={0.01}
            formatter={v => `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
            parser={v => (v ? parseFloat(v.replace(/,/g, '')) : 0) as unknown as 0}
            placeholder="0.00"
          />
        </Form.Item>
      </Col>
      <Col xs={24} sm={8}>
        <Form.Item name="depreciateFlag" label="Depreciate?" initialValue="YES">
          <Select>
            <Option value="YES">Yes</Option>
            <Option value="NO">No</Option>
          </Select>
        </Form.Item>
      </Col>
      <Col xs={24} sm={12}>
        <Form.Item
          name="methodId"
          label={
            <span>
              Depreciation Method
              {selectedMethodLife && (() => {
                const months = Number(selectedMethodLife);
                const years = months > 0 ? (months / 12).toFixed(months % 12 === 0 ? 0 : 1) : null;
                return (
                  <>
                    <Tag color="blue" style={{ marginLeft: 8, fontSize: 11 }}>{selectedMethodLife} months</Tag>
                    {years && <Tag color="geekblue" style={{ fontSize: 11 }}>{years} years</Tag>}
                  </>
                );
              })()}
            </span>
          }
        >
          <Select
            showSearch optionFilterProp="children" allowClear placeholder="Select method"
            onChange={val => {
              const m = methods.find((x, i) => (x.methodId || x.methodCode || String(i)) === val);
              setSelectedMethodLife(m?.lifeInMonths || '');
            }}
            onClear={() => setSelectedMethodLife('')}
          >
            {methods.map((m, idx) => {
              const months = Number(m.lifeInMonths);
              const lifeStr = m.lifeInMonths && months > 0
                ? `${months} months / ${(months / 12).toFixed(months % 12 === 0 ? 0 : 1)} yrs`
                : null;
              const code = m.methodCode || '';
              const name = m.name || code;
              const id   = m.methodId   || code || String(idx);
              const label = [
                name,
                code && code !== name ? `(${code})` : '',
                lifeStr ? `— ${lifeStr}` : '',
                !lifeStr && id ? `[${id}]` : '',
              ].filter(Boolean).join(' ');
              return (
                <Option key={`${id}-${idx}`} value={id}>
                  {label}
                </Option>
              );
            })}
          </Select>
        </Form.Item>
      </Col>
      <Col xs={24} sm={6}>
        <Form.Item name="capitalizedFlag" label="Capitalize?" initialValue="YES">
          <Select>
            <Option value="YES">Yes</Option>
            <Option value="NO">No</Option>
          </Select>
        </Form.Item>
      </Col>
      <Col xs={24} sm={6}>
        <Form.Item name="propertyTypeCode" label="Property Type">
          <Select allowClear placeholder="Select">
            <Option value="REAL">Real</Option>
            <Option value="PERSONAL">Personal</Option>
          </Select>
        </Form.Item>
      </Col>
      <Col xs={24} style={{ paddingTop: 4 }}>
        <Button
          icon={<DollarOutlined />}
          style={{ borderColor: FA_COLOR, color: FA_COLOR }}
          onClick={openDeprnPreview}
          disabled={!selectedMethodLife}
        >
          Preview Depreciation
        </Button>
        {!selectedMethodLife && (
          <Text type="secondary" style={{ marginLeft: 10, fontSize: 12 }}>
            Select a depreciation method to enable preview
          </Text>
        )}
      </Col>
    </Row>
  );

  // ── Step 2 — Assignment ─────────────────────────────────────────────────────
  const StepAssignment = () => (
    <Row gutter={[16, 0]}>
      <Col xs={24} sm={12}>
        <Form.Item
          name="locationId"
          label={
            <span>
              Location
              <Tooltip title={LOCATIONS_URL}>
                <LinkOutlined
                  style={{ marginLeft: 6, fontSize: 11, color: REDWOOD.info, cursor: 'pointer' }}
                  onClick={() => window.open(LOCATIONS_URL, '_blank')}
                />
              </Tooltip>
            </span>
          }
        >
          <Select showSearch optionFilterProp="children" allowClear placeholder="Select location">
            {locations.map(l => (
              <Option key={l.locationId || l.fullLocation} value={l.locationId || l.fullLocation}>
                {l.fullLocation}
              </Option>
            ))}
          </Select>
        </Form.Item>
      </Col>
      <Col xs={24} sm={12}>
        <Form.Item
          name="codeCombinationId"
          label={
            <span>
              Account (CCID)
              <Tooltip title={CCID_URL}>
                <LinkOutlined
                  style={{ marginLeft: 6, fontSize: 11, color: REDWOOD.info, cursor: 'pointer' }}
                  onClick={() => window.open(CCID_URL, '_blank')}
                />
              </Tooltip>
            </span>
          }
        >
          <Select
            showSearch allowClear
            loading={ccidLoading}
            placeholder="Search by account combination or CCID…"
            filterOption={(input, option) =>
              String(option?.children ?? '').toLowerCase().includes(input.toLowerCase())
            }
            notFoundContent={ccidLoading ? <Spin size="small" /> : 'No combinations found'}
            onChange={() => setAutoCcid(null)}
          >
            {/* Inject auto-filled entry at top so it appears selected */}
            {autoCcid && !ccids.find(c => c.ccid === autoCcid.ccid) && (
              <Option key={autoCcid.ccid} value={autoCcid.ccid}>
                {autoCcid.label}
              </Option>
            )}
            {ccids.map(c => (
              <Option key={c.ccid} value={c.ccid}>
                {c.label}
              </Option>
            ))}
          </Select>
        </Form.Item>

        {/* Segment breakdown — shown below the CCID dropdown */}
        {autoCcid && (
          <div style={{
            background: '#f0f7ff', border: `1px solid ${REDWOOD.info}30`,
            borderRadius: 6, padding: '8px 12px', marginTop: -8, marginBottom: 16,
          }}>
            <Text style={{ fontSize: 11, color: REDWOOD.info, fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Account Segments (auto-filled from category)
            </Text>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '4px 12px' }}>
              {[
                { label: 'Company',    val: autoCcid.segCo },
                { label: 'LOB',        val: autoCcid.segLob },
                { label: 'Department', val: autoCcid.segDept },
                { label: 'Account',    val: autoCcid.segAccount },
                { label: 'Sub-Account',val: autoCcid.segSubAcc },
                { label: 'Analysis',   val: autoCcid.segAlys },
                { label: 'Interco',    val: autoCcid.segIc },
                { label: 'Future 1',   val: autoCcid.segFut1 },
                { label: 'Future 2',   val: autoCcid.segFut2 },
              ].filter(s => s.val).map(s => (
                <div key={s.label}>
                  <Text type="secondary" style={{ fontSize: 10, display: 'block', lineHeight: '14px' }}>{s.label}</Text>
                  <Text strong style={{ fontSize: 12 }}>{s.val}</Text>
                </div>
              ))}
            </div>
          </div>
        )}
      </Col>
      <Col xs={24}>
        <Card size="small" style={{ background: REDWOOD.neutral100, borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            The location and account combination will create the initial distribution record for this asset.
            Both fields are optional — you can assign them later via asset adjustments.
          </Text>
        </Card>
      </Col>
    </Row>
  );

  // ── Step 3 — Review ─────────────────────────────────────────────────────────
  const StepReview = () => {
    const all = { ...stepData, ...form.getFieldsValue() };
    const dateStr = all.datePlacedInService && dayjs.isDayjs(all.datePlacedInService)
      ? all.datePlacedInService.format('DD-MMM-YYYY')
      : all.datePlacedInService || '—';

    const cat = categories.find(c => c.categoryId === all.categoryId);
    const method = methods.find(m => m.methodId === all.methodId);
    const loc = locations.find(l => l.locationId === all.locationId);
    const book = bookControls.find(b => b.bookTypeCode === all.bookTypeCode);

    return (
      <div>
        <Divider orientation={"left" as any}><BookOutlined /> Asset Details</Divider>
        <Descriptions column={2} size="small" bordered labelStyle={{ fontWeight: 500 }}>
          <Descriptions.Item label="Asset Number">{all.assetNumber || '—'}</Descriptions.Item>
          <Descriptions.Item label="Type">{assetTypeLabel(all.assetType)}</Descriptions.Item>
          <Descriptions.Item label="Description" span={2}>{all.description || '—'}</Descriptions.Item>
          <Descriptions.Item label="Category">{cat ? `${cat.segment1}/${cat.segment2} — ${cat.description}` : all.categoryId || '—'}</Descriptions.Item>
          <Descriptions.Item label="Units">{all.units ?? 1}</Descriptions.Item>
          <Descriptions.Item label="Tag Number">{all.tagNumber || '—'}</Descriptions.Item>
          <Descriptions.Item label="Serial Number">{all.serialNumber || '—'}</Descriptions.Item>
          <Descriptions.Item label="Manufacturer">{all.manufacturerName || '—'}</Descriptions.Item>
          <Descriptions.Item label="Model">{all.modelNumber || '—'}</Descriptions.Item>
          <Descriptions.Item label="In Use">{all.inUseFlag || '—'}</Descriptions.Item>
          <Descriptions.Item label="Owned/Leased">{all.ownedLeased || '—'}</Descriptions.Item>
        </Descriptions>

        <Divider orientation={"left" as any}><DollarOutlined /> Book & Financials</Divider>
        <Descriptions column={2} size="small" bordered labelStyle={{ fontWeight: 500 }}>
          <Descriptions.Item label="Book">{book ? `${book.bookTypeCode} — ${book.bookTypeName}` : all.bookTypeCode || '—'}</Descriptions.Item>
          <Descriptions.Item label="Date in Service">{dateStr}</Descriptions.Item>
          <Descriptions.Item label="Cost">{formatCurrency(all.cost ?? 0)}</Descriptions.Item>
          <Descriptions.Item label="Salvage Value">{formatCurrency(all.salvageValue ?? 0)}</Descriptions.Item>
          <Descriptions.Item label="Depreciate">{all.depreciateFlag || '—'}</Descriptions.Item>
          <Descriptions.Item label="Method">{method ? (() => {
              const months = Number(method.lifeInMonths);
              const yrs = method.lifeInMonths && months > 0 ? ` / ${(months / 12).toFixed(months % 12 === 0 ? 0 : 1)} years` : '';
              return `${method.name || method.methodCode}${method.methodCode && method.name && method.methodCode !== method.name ? ` (${method.methodCode})` : ''}${method.lifeInMonths ? ` — ${method.lifeInMonths} months${yrs}` : ''}`;
            })() : all.methodId || '—'}</Descriptions.Item>
          <Descriptions.Item label="Property Type">{all.propertyTypeCode || '—'}</Descriptions.Item>
          <Descriptions.Item label="Capitalize">{all.capitalizedFlag || '—'}</Descriptions.Item>
        </Descriptions>

        <Divider orientation={"left" as any}><EnvironmentOutlined /> Assignment</Divider>
        <Descriptions column={2} size="small" bordered labelStyle={{ fontWeight: 500 }}>
          <Descriptions.Item label="Location">{loc ? loc.fullLocation : all.locationId || '—'}</Descriptions.Item>
          <Descriptions.Item label="CCID">{all.codeCombinationId || '—'}</Descriptions.Item>
        </Descriptions>
      </div>
    );
  };

  const stepContent = [<StepDetails />, <StepBook />, <StepAssignment />, <StepReview />];

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb */}
        <div style={{ padding: '16px 24px', background: REDWOOD.surface, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/fa">Fixed Assets</Link> },
            { title: <Link to="/fa/assets">Manage Assets</Link> },
            { title: 'Create Asset' },
          ]} />
        </div>

        <div style={{ padding: '16px 24px', maxWidth: 1100, margin: '0 auto' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 10,
              background: `linear-gradient(135deg, ${FA_COLOR} 0%, #9E5C00 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <DatabaseOutlined style={{ fontSize: 22, color: '#fff' }} />
            </div>
            <div>
              <Title level={4} style={{ margin: 0 }}>Create Fixed Asset</Title>
              <Text type="secondary" style={{ fontSize: 12 }}>Add a new asset to the register</Text>
            </div>
          </div>

          {/* Steps indicator */}
          <Steps
            current={current}
            items={STEPS.map((s, i) => ({
              title: s,
              icon: current > i ? <CheckCircleOutlined /> : undefined,
            }))}
            style={{ marginBottom: 16 }}
            size="small"
          />

          {/* Step card */}
          <Card
            style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.07)' }}
            bodyStyle={{ padding: '16px 20px' }}
            title={
              <Space>
                {current === 0 && <BarcodeOutlined style={{ color: FA_COLOR }} />}
                {current === 1 && <BookOutlined    style={{ color: FA_COLOR }} />}
                {current === 2 && <EnvironmentOutlined style={{ color: FA_COLOR }} />}
                {current === 3 && <CheckCircleOutlined style={{ color: REDWOOD.success }} />}
                <Text strong style={{ fontSize: 15 }}>{STEPS[current]}</Text>
              </Space>
            }
          >
            <Form
              form={form}
              layout="vertical"
              initialValues={{ units: 1, inUseFlag: 'YES', ownedLeased: 'OWNED', newUsed: 'NEW',
                               depreciateFlag: 'YES', capitalizedFlag: 'YES', salvageValue: 0 }}
            >
              {stepContent[current]}
            </Form>
          </Card>

          {/* Navigation buttons */}
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
            <Button
              icon={<LeftOutlined />}
              onClick={current === 0 ? () => navigate('/fa/assets') : goBack}
            >
              {current === 0 ? 'Cancel' : 'Back'}
            </Button>
            <Space>
              {current < STEPS.length - 1 && (
                <Button
                  type="primary" icon={<RightOutlined />} iconPosition="end"
                  style={{ background: FA_COLOR, borderColor: FA_COLOR }}
                  onClick={goNext}
                >
                  Next
                </Button>
              )}
              {current === STEPS.length - 1 && (
                <Space>
                  <Button
                    icon={<BugOutlined />}
                    style={{ borderColor: REDWOOD.info, color: REDWOOD.info }}
                    onClick={() => { setTestResult(null); setDebugModal(true); }}
                  >
                    Debug
                  </Button>
                  <Button
                    type="primary" icon={<SaveOutlined />} loading={saving}
                    style={{ background: REDWOOD.success, borderColor: REDWOOD.success }}
                    onClick={handleSubmit}
                  >
                    Create Asset
                  </Button>
                </Space>
              )}
            </Space>
          </div>
        </div>
      </Content>

      {/* ── Depreciation Preview Modal ── */}
      <Modal
        open={deprnModal}
        onCancel={() => setDeprnModal(false)}
        width={820}
        title={<Space><DollarOutlined style={{ color: FA_COLOR }} /><span>Depreciation Preview (Straight-Line)</span></Space>}
        footer={<Button onClick={() => setDeprnModal(false)}>Close</Button>}
      >
        <Row gutter={[12, 0]} style={{ marginBottom: 12 }}>
          <Col xs={24} sm={8}>
            <div style={{ marginBottom: 4 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>From Date (Date Placed in Service)</Text>
            </div>
            <DatePicker
              style={{ width: '100%' }}
              value={deprnFromDate}
              format="DD-MMM-YYYY"
              onChange={v => setDeprnFromDate(v)}
            />
          </Col>
          <Col xs={24} sm={8}>
            <div style={{ marginBottom: 4 }}>
              <Text type="secondary" style={{ fontSize: 11 }}>To Date</Text>
            </div>
            <DatePicker
              style={{ width: '100%' }}
              value={deprnToDate}
              format="DD-MMM-YYYY"
              onChange={v => setDeprnToDate(v || dayjs())}
            />
          </Col>
          <Col xs={24} sm={8} style={{ display: 'flex', alignItems: 'flex-end' }}>
            <Button
              type="primary"
              style={{ background: FA_COLOR, borderColor: FA_COLOR, width: '100%' }}
              onClick={calcDeprn}
              disabled={!deprnFromDate}
            >
              Calculate
            </Button>
          </Col>
        </Row>

        {deprnRows.length > 0 && (() => {
          const totalDeprn = deprnRows.reduce((s, r) => s + r.depreciation, 0);
          const finalNbv   = deprnRows[deprnRows.length - 1].closingNbv;
          const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          return (
            <>
              <div style={{
                border: `1px solid ${REDWOOD.neutral200}`,
                borderRadius: 6, overflow: 'hidden', marginBottom: 8,
              }}>
                {/* Header row */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr',
                  background: REDWOOD.neutral100, padding: '6px 12px',
                  fontSize: 12, fontWeight: 600, borderBottom: `1px solid ${REDWOOD.neutral200}`,
                }}>
                  <span>Period</span>
                  <span style={{ textAlign: 'right' }}>Opening NBV</span>
                  <span style={{ textAlign: 'right' }}>Depreciation</span>
                  <span style={{ textAlign: 'right' }}>Closing NBV</span>
                </div>
                {/* Data rows — scrollable */}
                <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                  {deprnRows.map((r, i) => (
                    <div key={r.period} style={{
                      display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr',
                      padding: '5px 12px', fontSize: 12,
                      background: i % 2 === 0 ? '#fff' : REDWOOD.neutral100,
                      borderBottom: `1px solid ${REDWOOD.neutral200}`,
                    }}>
                      <span style={{ fontFamily: 'monospace' }}>{r.period}</span>
                      <span style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(r.openingNbv)}</span>
                      <span style={{ textAlign: 'right', fontFamily: 'monospace', color: REDWOOD.primary }}>{fmt(r.depreciation)}</span>
                      <span style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(r.closingNbv)}</span>
                    </div>
                  ))}
                </div>
                {/* Totals row */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '120px 1fr 1fr 1fr',
                  padding: '6px 12px', fontSize: 12, fontWeight: 700,
                  background: '#fff3cd', borderTop: `2px solid ${REDWOOD.warning}`,
                }}>
                  <span>Total ({deprnRows.length} months)</span>
                  <span />
                  <span style={{ textAlign: 'right', fontFamily: 'monospace', color: REDWOOD.primary }}>{fmt(totalDeprn)}</span>
                  <span style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmt(finalNbv)}</span>
                </div>
              </div>
              <Space>
                <Tag color="orange">Total Depreciation: {fmt(totalDeprn)}</Tag>
                <Tag color="blue">Final NBV: {fmt(finalNbv)}</Tag>
                <Tag color="green">{deprnRows.length} months</Tag>
              </Space>
            </>
          );
        })()}

        {deprnRows.length === 0 && deprnFromDate && (
          <Text type="secondary" style={{ display: 'block', textAlign: 'center', padding: '20px 0' }}>
            Click "Calculate" to generate the depreciation schedule.
          </Text>
        )}
        {!deprnFromDate && (
          <Alert type="warning" showIcon message="Date Placed in Service is not set — please set it in the Book & Financials step first." />
        )}
      </Modal>

      {/* ── Debug Modal ── */}
      <Modal
        open={debugModal}
        onCancel={() => setDebugModal(false)}
        width={780}
        title={<Space><BugOutlined style={{ color: REDWOOD.info }} /><span>Create Asset — Debug</span></Space>}
        footer={
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Button icon={<CopyOutlined />} size="small"
              onClick={() => { navigator.clipboard.writeText(JSON.stringify(buildPayload(), null, 2)); message.success('Payload copied'); }}>
              Copy Payload
            </Button>
            <Space>
              <Button onClick={() => setDebugModal(false)}>Close</Button>
              <Button type="primary" icon={testing ? <Spin size="small" /> : <SendOutlined />}
                loading={testing}
                style={{ background: REDWOOD.info, borderColor: REDWOOD.info }}
                onClick={handleTest}>
                Test POST
              </Button>
            </Space>
          </Space>
        }
      >
        {/* Endpoint */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 600 }}>ENDPOINT</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Tag color="blue" style={{ fontSize: 11, fontFamily: 'monospace' }}>POST</Tag>
            <code style={{ fontSize: 11, wordBreak: 'break-all', background: '#f5f5f5', padding: '4px 8px', borderRadius: 4, flex: 1 }}>
              {FA_ASSETS_URL}
            </code>
            <Button size="small" icon={<CopyOutlined />} onClick={() => { navigator.clipboard.writeText(FA_ASSETS_URL); message.success('URL copied'); }} />
          </div>
        </div>

        <Divider style={{ margin: '10px 0' }} />

        {/* Payload */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 600 }}>REQUEST PAYLOAD (JSON)</div>
          <pre style={{
            background: '#1e293b', color: '#e2e8f0', fontSize: 11,
            fontFamily: 'monospace', padding: 12, borderRadius: 6,
            maxHeight: 280, overflowY: 'auto', margin: 0,
          }}>
            {JSON.stringify(buildPayload(), null, 2)}
          </pre>
        </div>

        {/* Test result */}
        {testResult && (
          <>
            <Divider style={{ margin: '10px 0' }} />
            <div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 600 }}>
                RESPONSE
                <Tag color={testResult.status >= 200 && testResult.status < 300 ? 'success' : 'error'}
                  style={{ marginLeft: 8, fontSize: 11 }}>
                  HTTP {testResult.status || 'Error'}
                </Tag>
              </div>
              {testResult.status >= 200 && testResult.status < 300
                ? <Alert type="success" showIcon message="Request succeeded" style={{ marginBottom: 8 }} />
                : <Alert type="error" showIcon message="Request failed" style={{ marginBottom: 8 }} />
              }
              <pre style={{
                background: '#1e293b', color: '#e2e8f0', fontSize: 11,
                fontFamily: 'monospace', padding: 12, borderRadius: 6,
                maxHeight: 200, overflowY: 'auto', margin: 0,
              }}>
                {(() => { try { return JSON.stringify(JSON.parse(testResult.body), null, 2); } catch { return testResult.body; } })()}
              </pre>
            </div>
          </>
        )}
      </Modal>
    </Layout>
  );
};

export default CreateAsset;
