// Register New Supplier — the dialog of Manage Suppliers, shared so other screens (Manage Invoices) can
// create a supplier in place. POST suppliers/create (database/ap/rr_supplier_create.sql) →
// { success, supplierId, supplierNumber, sites }. While typing, warns when a supplier with the same name or
// tax registration number already exists.
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Checkbox, Col, Divider, Form, Input, Modal, Row, Select, Space, Tooltip, Typography, message } from 'antd';
import { ApiOutlined, MinusCircleOutlined, PlusOutlined, WarningFilled } from '@ant-design/icons';
import { APEX_DB_CONFIG } from '../../config/api.config';

const RED = '#C74634', INFO = '#0572CE', ERR = '#C74634';

export interface CreatedSupplier {
  supplierId?: number;
  supplierNumber?: string;
  supplier: string;
  sites: number;
  businessUnit?: string;      // procurement BU of the first site
  paymentTerms?: string;
  currency?: string;
}

interface Existing { supplier: string; supplierNumber: string; taxRegistrationNumber?: string }

const CREATE_SUPPLIER_URL = () => `${APEX_DB_CONFIG.baseUrl}/suppliers/create`;

// loaded once per session, shared by every open of the dialog
let buCache: string[] | null = null;
let existingCache: Existing[] | null = null;

async function loadBusinessUnits(): Promise<string[]> {
  if (buCache) return buCache;
  const r = await fetch(`${APEX_DB_CONFIG.baseUrl}/gl/businessunits`);
  const data = r.ok ? await r.json() : null;
  const items: any[] = Array.isArray(data) ? data : (data?.items || []);
  buCache = items.map((i: any) => i.business_unit_name || '').filter(Boolean);
  return buCache;
}

async function loadExistingSuppliers(): Promise<Existing[]> {
  if (existingCache) return existingCache;
  const all: Existing[] = [];
  for (let offset = 0; offset < 20000; offset += 500) {
    const res = await fetch(`${APEX_DB_CONFIG.baseUrl}/suppliers?limit=500&offset=${offset}`);
    if (!res.ok) break;
    const data = await res.json();
    const items: any[] = Array.isArray(data) ? data : (data.items || []);
    items.forEach(i => all.push({
      supplier: i.supplier || i.supplier_name || i.vendor_name || '',
      supplierNumber: String(i.supplier_number ?? i.supplierNumber ?? ''),
      taxRegistrationNumber: i.tax_registration_number || i.taxRegistrationNumber || i.taxpayer_id || undefined,
    }));
    if (!data.hasMore || items.length < 500) break;
  }
  existingCache = all;
  return all;
}

/** "Al Noor Trading L.L.C." and "AL NOOR LLC" count as the same supplier. */
const LEGAL_WORDS = new Set(['L', 'C', 'LLC', 'FZ', 'FZE', 'FZCO', 'CO', 'COMPANY', 'LTD', 'LIMITED', 'PJSC', 'PSC', 'INC', 'EST', 'ESTABLISHMENT', 'TRADING']);
const normName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(w => w && !LEGAL_WORDS.has(w)).join(' ');

export function buildSupplierPayload(vals: any): any {
  const addr = vals.address || {};
  return {
    supplier:              vals.supplier,
    supplierNumber:        vals.supplierNumber || undefined,
    alternateName:         vals.alternateName,
    supplierType:          vals.supplierType,
    taxOrganizationType:   vals.taxOrganizationType,
    businessRelationship:  vals.businessRelationship,
    taxRegistrationNumber: vals.taxRegistrationNumber,
    taxpayerId:            vals.taxpayerId,
    dunsNumber:            vals.dunsNumber,
    status:                vals.status || 'Active',
    createdBy:             'REACTERP',
    address: addr.addressName ? {
      addressName:   addr.addressName,
      country:       addr.country,
      addressLine1:  addr.addressLine1,
      addressLine2:  addr.addressLine2,
      city:          addr.city,
      state:         addr.state,
      postalCode:    addr.postalCode,
      phoneNumber:   addr.phoneNumber,
      email:         addr.email,
      purposeOrdering: !!addr.purposeOrdering,
      purposeRemitTo:  !!addr.purposeRemitTo,
    } : undefined,
    sites: (vals.sites || []).filter((s: any) => s && s.siteCode).map((s: any) => ({
      siteCode:       s.siteCode,
      siteName:       s.siteName,
      procurementBu:  s.procurementBu,
      addressName:    s.addressName || addr.addressName,
      payFlag:        !!s.payFlag,
      purchasingFlag: !!s.purchasingFlag,
      paymentTerms:   s.paymentTerms,
      invoiceCurrency: s.invoiceCurrency,
      status:         'Active',
    })),
  };
}

const newSiteRow = (bu?: string) => ({ invoiceCurrency: 'AED', payFlag: true, purchasingFlag: true, procurementBu: bu || undefined });

/** Site rows (Form.List "sites"). At least one site with a Procurement BU — invoices look the site up by BU. */
const SitesEditor: React.FC<{ businessUnits: string[]; defaultBusinessUnit?: string; takenCodes?: string[] }> = ({ businessUnits, defaultBusinessUnit, takenCodes = [] }) => (
  <Form.List name="sites" rules={[{
    validator: async (_, rows) => { if (!rows || rows.length < 1) throw new Error('Add at least one site — an invoice needs a supplier site'); },
  }]}>
    {(fields, { add, remove }, { errors }) => (
      <>
        {fields.map(({ key, name: n, ...rest }, idx) => (
          <div key={key} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: '8px 12px 0', marginBottom: 10, background: '#fcfcfc', position: 'relative' }}>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>Site {idx + 1}</Typography.Text>
            {fields.length > 1 && (
              <Tooltip title="Remove this site">
                <MinusCircleOutlined style={{ color: ERR, cursor: 'pointer', position: 'absolute', top: 10, right: 12 }} onClick={() => remove(n)} />
              </Tooltip>
            )}
            <Row gutter={10}>
              <Col span={5}><Form.Item {...rest} name={[n, 'siteCode']} label="Site Code" style={{ marginBottom: 8 }}
                rules={[{ required: true, whitespace: true, message: 'Required' },
                  { validator: async (_, v) => { if (v && takenCodes.some(c => c.toUpperCase() === String(v).trim().toUpperCase())) throw new Error('Already a site'); } }]}>
                <Input placeholder="e.g. DUBAI" /></Form.Item></Col>
              <Col span={7}><Form.Item {...rest} name={[n, 'siteName']} label="Site Name" style={{ marginBottom: 8 }}><Input placeholder="defaults to the code" /></Form.Item></Col>
              <Col span={12}><Form.Item {...rest} name={[n, 'procurementBu']} label="Procurement BU" style={{ marginBottom: 8 }}
                rules={[{ required: true, message: 'Required — invoices find the site by its BU' }]}>
                <Select showSearch allowClear placeholder="Select the business unit" optionFilterProp="label"
                  popupMatchSelectWidth={false} style={{ width: '100%' }}
                  options={businessUnits.map(bu => ({ value: bu, label: bu, title: bu }))} />
              </Form.Item></Col>
            </Row>
            <Row gutter={10} align="bottom">
              <Col span={9}><Form.Item {...rest} name={[n, 'paymentTerms']} label="Payment Terms" style={{ marginBottom: 8 }}><Input placeholder="e.g. Net 30" /></Form.Item></Col>
              <Col span={5}><Form.Item {...rest} name={[n, 'invoiceCurrency']} label="Invoice Currency" style={{ marginBottom: 8 }}><Input placeholder="AED" /></Form.Item></Col>
              <Col span={10}>
                <Space size="large" style={{ marginBottom: 12 }}>
                  <Form.Item {...rest} name={[n, 'payFlag']} valuePropName="checked" noStyle><Checkbox>Pay site</Checkbox></Form.Item>
                  <Form.Item {...rest} name={[n, 'purchasingFlag']} valuePropName="checked" noStyle><Checkbox>Purchasing site</Checkbox></Form.Item>
                </Space>
              </Col>
            </Row>
          </div>
        ))}
        <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => add(newSiteRow(defaultBusinessUnit))}>
          Add another site
        </Button>
        <Form.ErrorList errors={errors} />
      </>
    )}
  </Form.List>
);

const AddressFields: React.FC = () => (
  <>
    <Row gutter={12}>
      <Col span={8}><Form.Item name={['address', 'addressName']} label="Address Name"><Input placeholder="e.g. MAIN" /></Form.Item></Col>
      <Col span={8}><Form.Item name={['address', 'country']} label="Country"><Input /></Form.Item></Col>
      <Col span={8}><Form.Item name={['address', 'city']} label="City"><Input /></Form.Item></Col>
    </Row>
    <Row gutter={12}>
      <Col span={12}><Form.Item name={['address', 'addressLine1']} label="Address Line 1"><Input /></Form.Item></Col>
      <Col span={12}><Form.Item name={['address', 'addressLine2']} label="Address Line 2"><Input /></Form.Item></Col>
    </Row>
    <Row gutter={12}>
      <Col span={6}><Form.Item name={['address', 'state']} label="State/Province"><Input /></Form.Item></Col>
      <Col span={6}><Form.Item name={['address', 'postalCode']} label="Postal Code"><Input /></Form.Item></Col>
      <Col span={6}><Form.Item name={['address', 'phoneNumber']} label="Phone"><Input /></Form.Item></Col>
      <Col span={6}><Form.Item name={['address', 'email']} label="Email"><Input /></Form.Item></Col>
    </Row>
    <Space size="large">
      <Form.Item name={['address', 'purposeOrdering']} valuePropName="checked" noStyle><Checkbox>Ordering address</Checkbox></Form.Item>
      <Form.Item name={['address', 'purposeRemitTo']} valuePropName="checked" noStyle><Checkbox>Remit-to address</Checkbox></Form.Item>
    </Space>
  </>
);

const showApiRequest = (title: string, url: string, payload: unknown) => Modal.info({
  title,
  width: 660,
  content: (
    <div>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>Method / URL</div>
      <Typography.Text copyable code style={{ fontSize: 12, wordBreak: 'break-all' }}>{`POST ${url}`}</Typography.Text>
      <div style={{ fontSize: 12, color: '#888', margin: '10px 0 4px' }}>JSON Body</div>
      <pre style={{ fontSize: 11, background: '#0d0d0d', color: '#a8ff78', borderRadius: 4, padding: 10, maxHeight: 360, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {JSON.stringify(payload, null, 2)}
      </pre>
    </div>
  ),
});

const RegisterSupplierModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onCreated?: (s: CreatedSupplier) => void;
  /** procurement BU for the first site, e.g. the BU the user is working in */
  defaultBusinessUnit?: string;
}> = ({ open, onClose, onCreated, defaultBusinessUnit }) => {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [businessUnits, setBusinessUnits] = useState<string[]>(buCache || []);
  const [existing, setExisting] = useState<Existing[]>(existingCache || []);
  const name = Form.useWatch('supplier', form) as string | undefined;
  const trn  = Form.useWatch('taxRegistrationNumber', form) as string | undefined;

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({
      status: 'Active',
      address: { addressName: 'MAIN', country: 'United Arab Emirates' },
      sites: [newSiteRow(defaultBusinessUnit)],
    });
    loadBusinessUnits().then(setBusinessUnits).catch(() => {});
    loadExistingSuppliers().then(setExisting).catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Same name (ignoring LLC / FZE / punctuation…) or same tax registration number
  const lookalikes = useMemo(() => {
    const n = normName(name || '');
    const t = (trn || '').replace(/\s+/g, '');
    if (n.length < 3 && t.length < 5) return [];
    return existing.filter(e =>
      (n.length >= 3 && normName(e.supplier) === n)
      || (t.length >= 5 && (e.taxRegistrationNumber || '').replace(/\s+/g, '') === t)).slice(0, 5);
  }, [name, trn, existing]);

  const showApi = () => showApiRequest('Create Supplier — API Request', CREATE_SUPPLIER_URL(), buildSupplierPayload(form.getFieldsValue()));

  const submit = async () => {
    let vals: any;
    try { vals = await form.validateFields(); }
    catch { return; }   // validation errors are shown inline
    setSaving(true);
    try {
      const payload = buildSupplierPayload(vals);
      const res = await fetch(CREATE_SUPPLIER_URL(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success !== false) {
        message.success(`Supplier ${data.supplierNumber || ''} created${data.sites ? ` with ${data.sites} site(s)` : ''}`);
        existingCache = null;   // the next open sees the new supplier
        const site0 = payload.sites[0];
        onCreated?.({
          supplierId: data.supplierId != null ? Number(data.supplierId) : undefined,
          supplierNumber: data.supplierNumber,
          supplier: payload.supplier,
          sites: Number(data.sites ?? payload.sites.length),
          businessUnit: site0?.procurementBu,
          paymentTerms: site0?.paymentTerms,
          currency: site0?.invoiceCurrency,
        });
        onClose();
      } else {
        message.error(data.error || data.message || `Create failed (HTTP ${res.status})`);
      }
    } catch (e: any) {
      message.error(e?.message || 'Create failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={<Space><PlusOutlined style={{ color: RED }} /><span>Register New Supplier</span>
        <Tooltip title="Show the API URL & JSON payload"><Button size="small" icon={<ApiOutlined />} style={{ color: INFO, borderColor: INFO }} onClick={showApi} /></Tooltip>
      </Space>}
      onCancel={() => { if (!saving) onClose(); }}
      maskClosable={!saving}
      width={880}
      okText="Create Supplier"
      confirmLoading={saving}
      onOk={submit}
      okButtonProps={{ style: { background: RED, borderColor: RED } }}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" size="small">
        <Divider titlePlacement="start" style={{ margin: '4px 0 12px', fontSize: 13 }}>Supplier</Divider>
        <Row gutter={12}>
          <Col span={10}><Form.Item name="supplier" label="Supplier Name" rules={[{ required: true, message: 'Required' }]}><Input placeholder="e.g. ACME TRADING LLC" autoFocus /></Form.Item></Col>
          <Col span={7}><Form.Item name="supplierNumber" label="Supplier Number" tooltip="Leave blank to auto-generate"><Input placeholder="auto" /></Form.Item></Col>
          <Col span={7}><Form.Item name="alternateName" label="Alternate Name"><Input /></Form.Item></Col>
        </Row>
        {lookalikes.length > 0 && (
          <Alert type="warning" showIcon icon={<WarningFilled />} style={{ margin: '-4px 0 12px' }}
            message={`This supplier may already exist: ${lookalikes.map(e => `${e.supplier} (${e.supplierNumber})`).join(', ')}`}
            description="Same name or tax registration number. Use the existing supplier unless this really is a different one." />
        )}
        <Row gutter={12}>
          <Col span={6}><Form.Item name="supplierType" label="Supplier Type"><Select allowClear options={[{ value: 'Supplier' }, { value: 'Individual' }, { value: 'Contractor' }]} /></Form.Item></Col>
          <Col span={6}><Form.Item name="taxOrganizationType" label="Tax Org Type"><Select allowClear options={[{ value: 'Corporation' }, { value: 'Individual' }, { value: 'Partnership' }]} /></Form.Item></Col>
          <Col span={6}><Form.Item name="businessRelationship" label="Business Relationship"><Select allowClear options={[{ value: 'Spend Authorized' }, { value: 'Prospective' }]} /></Form.Item></Col>
          <Col span={6}><Form.Item name="status" label="Status"><Select options={[{ value: 'Active' }, { value: 'Inactive' }]} /></Form.Item></Col>
        </Row>
        <Row gutter={12}>
          <Col span={8}><Form.Item name="taxRegistrationNumber" label="Tax Registration No."><Input /></Form.Item></Col>
          <Col span={8}><Form.Item name="taxpayerId" label="Taxpayer ID"><Input /></Form.Item></Col>
          <Col span={8}><Form.Item name="dunsNumber" label="D-U-N-S Number"><Input /></Form.Item></Col>
        </Row>

        <Divider titlePlacement="start" style={{ margin: '4px 0 12px', fontSize: 13 }}>Primary Address</Divider>
        <AddressFields />

        <Divider titlePlacement="start" style={{ margin: '14px 0 12px', fontSize: 13 }}>Sites</Divider>
        <SitesEditor businessUnits={businessUnits} defaultBusinessUnit={defaultBusinessUnit} />
      </Form>
    </Modal>
  );
};

export default RegisterSupplierModal;

// ── Add sites to an existing supplier — POST suppliers/sites/add (database/ap/rr_supplier_add_sites.sql) ──
const ADD_SITES_URL = () => `${APEX_DB_CONFIG.baseUrl}/suppliers/sites/add`;

export interface SiteTarget { supplierId: number; supplier: string; supplierNumber?: string }

export const AddSupplierSitesModal: React.FC<{
  open: boolean;
  onClose: () => void;
  target: SiteTarget | null;
  /** codes the supplier already has — refused client-side */
  existingSiteCodes?: string[];
  /** the supplier has no address yet: offer one (sites use it) */
  needsAddress?: boolean;
  defaultBusinessUnit?: string;
  onAdded?: (r: { sites: number; siteIds: number[] }) => void;
}> = ({ open, onClose, target, existingSiteCodes = [], needsAddress, defaultBusinessUnit, onAdded }) => {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [businessUnits, setBusinessUnits] = useState<string[]>(buCache || []);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({
      address: needsAddress ? { addressName: 'MAIN', country: 'United Arab Emirates' } : undefined,
      sites: [newSiteRow(defaultBusinessUnit)],
    });
    loadBusinessUnits().then(setBusinessUnits).catch(() => {});
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const payloadOf = (vals: any) => {
    const p = buildSupplierPayload({ ...vals, supplier: target?.supplier });
    return { supplierId: target?.supplierId, createdBy: 'REACTERP', address: needsAddress ? p.address : undefined, sites: p.sites };
  };

  const submit = async () => {
    if (!target) return;
    let vals: any;
    try { vals = await form.validateFields(); }
    catch { return; }
    setSaving(true);
    try {
      const res = await fetch(ADD_SITES_URL(), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payloadOf(vals)),
      });
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { /* HTML error page */ }
      if (res.ok && data.success !== false) {
        message.success(`${data.sites ?? vals.sites.length} site(s) added to ${target.supplier}`);
        onAdded?.({ sites: Number(data.sites ?? vals.sites.length), siteIds: data.siteIds || [] });
        onClose();
      } else if (res.status === 404 && !data.error) {
        message.error('The add-sites service is not installed — run database/ap/rr_supplier_add_sites.sql', 8);
      } else {
        message.error(data.error || data.message || `Add sites failed (HTTP ${res.status})`, 8);
      }
    } catch (e: any) {
      message.error(e?.message || 'Add sites failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={<Space><PlusOutlined style={{ color: RED }} /><span>Add Sites — {target?.supplier}{target?.supplierNumber ? ` (${target.supplierNumber})` : ''}</span>
        <Tooltip title="Show the API URL & JSON payload"><Button size="small" icon={<ApiOutlined />} style={{ color: INFO, borderColor: INFO }}
          onClick={() => showApiRequest('Add Sites — API Request', ADD_SITES_URL(), payloadOf(form.getFieldsValue()))} /></Tooltip>
      </Space>}
      onCancel={() => { if (!saving) onClose(); }}
      maskClosable={!saving}
      width={880}
      okText="Add Sites"
      confirmLoading={saving}
      onOk={submit}
      okButtonProps={{ style: { background: RED, borderColor: RED } }}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" size="small">
        {needsAddress && (
          <>
            <Alert type="info" showIcon style={{ marginBottom: 12 }} message="This supplier has no address yet — the sites below will use this one." />
            <Divider titlePlacement="start" style={{ margin: '4px 0 12px', fontSize: 13 }}>Address</Divider>
            <AddressFields />
          </>
        )}
        <Divider titlePlacement="start" style={{ margin: needsAddress ? '14px 0 12px' : '4px 0 12px', fontSize: 13 }}>Sites</Divider>
        <SitesEditor businessUnits={businessUnits} defaultBusinessUnit={defaultBusinessUnit} takenCodes={existingSiteCodes} />
        {existingSiteCodes.length > 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
            Existing sites: {existingSiteCodes.join(', ')}
          </Typography.Text>
        )}
      </Form>
    </Modal>
  );
};
