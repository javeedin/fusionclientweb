// Purchasing-RR — Setup: Purchasing Options per business unit and the setup
// lists (locations, categories, expense items, UOMs, buyers, requester defaults,
// account rules, document sequences, supplier site options). All saves go to
// RR_PO_SETUP_PKG.SAVE_SETUP (JSON keys = lower-case column names).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Card, Table, Button, Space, Input, InputNumber, Select, Typography, Tabs, Modal, Form, Alert, message, Popconfirm, Tag, Divider,
} from 'antd';
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined, SettingOutlined, SaveOutlined, LinkOutlined } from '@ant-design/icons';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { poQuery, poExec, PROC, nlit, Row } from '../../services/po.service';
import { PoBar, StatusTag, useBusinessUnits, usePoUser, YesNo, PO_RED, AccountInput, SupplierSelect, SiteSearchSelect } from './poShared';

const { Text } = Typography;

type FieldType = 'account' | 'text' | 'number' | 'yn' | 'status' | 'select' | 'bu' | 'location' | 'category' | 'item' | 'uom' | 'supplier' | 'site' | 'textarea';
interface Field { name: string; label: string; type?: FieldType; required?: boolean;
  /** required only when another field has a value, e.g. GRNI account when accruing at receipt */
  requiredWhen?: { field: string; equals: string }; options?: string[]; help?: string; span?: number }
interface Entity {
  key: string; title: string; sql: string; rowKey: string; fields: Field[]; columns: string[];
  deletable?: boolean; help?: string;
}

const STATUS_OPTS = ['ACTIVE', 'INACTIVE'];

const ENTITIES: Entity[] = [
  {
    key: 'LOCATION', title: 'Locations', rowKey: 'LOCATION_ID',
    sql: 'SELECT * FROM RR_PO_LOCATIONS ORDER BY LOCATION_CODE',
    help: 'Ship-to, bill-to and deliver-to addresses printed on purchase orders.',
    columns: ['LOCATION_CODE', 'LOCATION_NAME', 'CITY', 'COUNTRY', 'SHIP_TO_FLAG', 'BILL_TO_FLAG', 'DELIVER_TO_FLAG', 'STATUS'],
    fields: [
      { name: 'LOCATION_CODE', label: 'Code', required: true }, { name: 'LOCATION_NAME', label: 'Name', required: true },
      { name: 'BUSINESS_UNIT_ID', label: 'Business unit (blank = all)', type: 'bu' },
      { name: 'ADDRESS_LINE1', label: 'Address line 1' }, { name: 'ADDRESS_LINE2', label: 'Address line 2' },
      { name: 'ADDRESS_LINE3', label: 'Address line 3' }, { name: 'CITY', label: 'City' }, { name: 'REGION', label: 'Emirate / region' },
      { name: 'COUNTRY', label: 'Country' }, { name: 'PO_BOX', label: 'PO Box' }, { name: 'CONTACT_NAME', label: 'Contact' },
      { name: 'PHONE', label: 'Phone' }, { name: 'EMAIL', label: 'E-mail' },
      { name: 'SHIP_TO_FLAG', label: 'Ship to', type: 'yn' }, { name: 'BILL_TO_FLAG', label: 'Bill to', type: 'yn' },
      { name: 'DELIVER_TO_FLAG', label: 'Deliver to', type: 'yn' }, { name: 'STATUS', label: 'Status', type: 'status' },
    ],
  },
  {
    key: 'CATEGORY', title: 'Categories', rowKey: 'CATEGORY_ID',
    sql: 'SELECT * FROM RR_PO_V_CATEGORIES ORDER BY FULL_NAME',
    help: 'Purchasing categories. The natural account (segment 4) is used to build the charge account; children inherit it from the parent.',
    columns: ['CATEGORY_CODE', 'FULL_NAME', 'EFFECTIVE_NATURAL_ACCOUNT', 'DEFAULT_LINE_TYPE', 'DEFAULT_UOM', 'RECEIPT_REQUIRED_FLAG', 'REQUESTABLE_FLAG', 'STATUS'],
    fields: [
      { name: 'CATEGORY_CODE', label: 'Code', required: true }, { name: 'CATEGORY_NAME', label: 'Name', required: true },
      { name: 'PARENT_CATEGORY_ID', label: 'Parent', type: 'category' },
      { name: 'DEFAULT_NATURAL_ACCOUNT', label: 'Natural account (segment 4)' },
      { name: 'DEFAULT_LINE_TYPE', label: 'Default line type', type: 'select', options: ['QUANTITY', 'AMOUNT'] },
      { name: 'DEFAULT_UOM', label: 'Default UOM', type: 'uom' }, { name: 'DEFAULT_TAX_CODE', label: 'Default tax code' },
      { name: 'RECEIPT_REQUIRED_FLAG', label: 'Receipt required (3-way)', type: 'yn' }, { name: 'CAPEX_FLAG', label: 'Capital', type: 'yn' },
      { name: 'REQUESTABLE_FLAG', label: 'Requestable', type: 'yn' }, { name: 'STATUS', label: 'Status', type: 'status' },
    ],
  },
  {
    key: 'EXPENSE_ITEM', title: 'Expense items', rowKey: 'EXPENSE_ITEM_ID',
    sql: 'SELECT * FROM RR_PO_V_EXPENSE_ITEMS ORDER BY ITEM_CODE',
    help: 'Optional catalogue of frequently bought goods and services (free-text lines are always allowed).',
    columns: ['ITEM_CODE', 'DESCRIPTION', 'CATEGORY_NAME', 'LINE_TYPE', 'UOM_CODE', 'LIST_PRICE', 'PREFERRED_SUPPLIER_NAME', 'STATUS'],
    fields: [
      { name: 'ITEM_CODE', label: 'Code', required: true }, { name: 'DESCRIPTION', label: 'Description', required: true },
      { name: 'CATEGORY_ID', label: 'Category', type: 'category', required: true },
      { name: 'LINE_TYPE', label: 'Line type', type: 'select', options: ['QUANTITY', 'AMOUNT'] },
      { name: 'UOM_CODE', label: 'UOM', type: 'uom' }, { name: 'LIST_PRICE', label: 'List price', type: 'number' },
      { name: 'CURRENCY_CODE', label: 'Currency' }, { name: 'PREFERRED_SUPPLIER_ID', label: 'Preferred supplier', type: 'supplier' },
      { name: 'PREFERRED_SUPPLIER_SITE_ID', label: 'Preferred site', type: 'site' }, { name: 'SUPPLIER_ITEM_NUM', label: 'Supplier item #' },
      { name: 'LEAD_TIME_DAYS', label: 'Lead time (days)', type: 'number' },
      { name: 'NATURAL_ACCOUNT_OVERRIDE', label: 'Natural account override' }, { name: 'TAX_CODE', label: 'Tax code' },
      { name: 'STATUS', label: 'Status', type: 'status' },
      { name: 'LONG_DESCRIPTION', label: 'Long description', type: 'textarea', span: 3 },
    ],
  },
  {
    key: 'UOM', title: 'Units of measure', rowKey: 'UOM_CODE',
    sql: 'SELECT * FROM RR_PO_UOMS ORDER BY UOM_CODE',
    columns: ['UOM_CODE', 'UOM_NAME', 'UOM_CLASS', 'STATUS'],
    fields: [{ name: 'UOM_CODE', label: 'Code', required: true }, { name: 'UOM_NAME', label: 'Name', required: true },
      { name: 'UOM_CLASS', label: 'Class' }, { name: 'STATUS', label: 'Status', type: 'status' }],
  },
  {
    key: 'BUYER', title: 'Buyers', rowKey: 'BUYER_ID', deletable: true,
    sql: `SELECT b.*, bu.BUSINESS_UNIT_NAME, c.CATEGORY_NAME FROM RR_PO_BUYERS b
          LEFT JOIN RR_GL_BUSINESS_UNITS bu ON bu.BUSINESS_UNIT_ID = b.BUSINESS_UNIT_ID
          LEFT JOIN RR_PO_CATEGORIES c ON c.CATEGORY_ID = b.CATEGORY_ID ORDER BY b.USER_NAME`,
    help: 'Approved requisition lines are routed to the buyer of their category (or the default buyer). With no buyers defined everyone may buy.',
    columns: ['USER_NAME', 'BUSINESS_UNIT_NAME', 'CATEGORY_NAME', 'DIRECT_PO_ALLOWED', 'DEFAULT_FLAG', 'EMAIL', 'STATUS'],
    fields: [
      { name: 'USER_NAME', label: 'User name', required: true }, { name: 'BUSINESS_UNIT_ID', label: 'Business unit (blank = all)', type: 'bu' },
      { name: 'CATEGORY_ID', label: 'Category (blank = all)', type: 'category' },
      { name: 'DIRECT_PO_ALLOWED', label: 'May create direct POs', type: 'yn' }, { name: 'DEFAULT_FLAG', label: 'Default buyer', type: 'yn' },
      { name: 'EMAIL', label: 'E-mail' }, { name: 'PHONE', label: 'Phone' }, { name: 'STATUS', label: 'Status', type: 'status' },
    ],
  },
  {
    key: 'REQUESTER_DEFAULT', title: 'Requester defaults', rowKey: 'DEFAULT_ID', deletable: true,
    sql: `SELECT d.*, bu.BUSINESS_UNIT_NAME, l.LOCATION_NAME FROM RR_PO_REQUESTER_DEFAULTS d
          LEFT JOIN RR_GL_BUSINESS_UNITS bu ON bu.BUSINESS_UNIT_ID = d.BUSINESS_UNIT_ID
          LEFT JOIN RR_PO_LOCATIONS l ON l.LOCATION_ID = d.DELIVER_TO_LOCATION_ID ORDER BY d.USER_NAME`,
    help: 'Charge account template per requester (company / cost centre…). The natural account segment is replaced by the category\'s account.',
    columns: ['USER_NAME', 'BUSINESS_UNIT_NAME', 'CHARGE_ACCOUNT_TEMPLATE', 'LOCATION_NAME', 'MANAGER_USER_NAME'],
    fields: [
      { name: 'USER_NAME', label: 'User name', required: true }, { name: 'BUSINESS_UNIT_ID', label: 'Business unit', type: 'bu', required: true },
      { name: 'CHARGE_ACCOUNT_TEMPLATE', label: 'Charge account template', type: 'account', required: true, help: 'Full 9-segment combination, e.g. 101-1000-000-000000-…' },
      { name: 'DELIVER_TO_LOCATION_ID', label: 'Deliver to', type: 'location' }, { name: 'MANAGER_USER_NAME', label: 'Manager' },
    ],
  },
  {
    key: 'ACCOUNT_RULE', title: 'Account rules', rowKey: 'RULE_ID', deletable: true,
    sql: `SELECT r.*, bu.BUSINESS_UNIT_NAME, c.CATEGORY_NAME, i.ITEM_CODE FROM RR_PO_ACCOUNT_RULES r
          LEFT JOIN RR_GL_BUSINESS_UNITS bu ON bu.BUSINESS_UNIT_ID = r.BUSINESS_UNIT_ID
          LEFT JOIN RR_PO_CATEGORIES c ON c.CATEGORY_ID = r.CATEGORY_ID
          LEFT JOIN RR_PO_EXPENSE_ITEMS i ON i.EXPENSE_ITEM_ID = r.EXPENSE_ITEM_ID ORDER BY r.PRIORITY, r.SEGMENT_NUM`,
    help: 'Override any segment of the derived charge account for a business unit / category / item (lowest priority number wins).',
    columns: ['BUSINESS_UNIT_NAME', 'CATEGORY_NAME', 'ITEM_CODE', 'SEGMENT_NUM', 'SEGMENT_VALUE', 'PRIORITY', 'STATUS'],
    fields: [
      { name: 'BUSINESS_UNIT_ID', label: 'Business unit', type: 'bu' }, { name: 'CATEGORY_ID', label: 'Category', type: 'category' },
      { name: 'EXPENSE_ITEM_ID', label: 'Expense item', type: 'item' },
      { name: 'SEGMENT_NUM', label: 'Segment # (1-9)', type: 'number', required: true },
      { name: 'SEGMENT_VALUE', label: 'Segment value', required: true }, { name: 'PRIORITY', label: 'Priority', type: 'number' },
      { name: 'STATUS', label: 'Status', type: 'status' },
    ],
  },
  {
    key: 'DOC_SEQUENCE', title: 'Document numbering', rowKey: 'DOC_SEQ_ID',
    sql: `SELECT s.*, bu.BUSINESS_UNIT_NAME FROM RR_PO_DOC_SEQUENCES s
          LEFT JOIN RR_GL_BUSINESS_UNITS bu ON bu.BUSINESS_UNIT_ID = s.BUSINESS_UNIT_ID ORDER BY bu.BUSINESS_UNIT_NAME, s.DOC_TYPE`,
    help: 'Created automatically on first use (prefix TYPE-, year, 5 digits). Edit to change the prefix or the next number.',
    columns: ['BUSINESS_UNIT_NAME', 'DOC_TYPE', 'PREFIX', 'YEAR_IN_NUMBER', 'NEXT_NUMBER', 'PAD_LENGTH', 'RESET_YEARLY', 'CURRENT_YEAR'],
    fields: [
      { name: 'BUSINESS_UNIT_ID', label: 'Business unit', type: 'bu', required: true },
      { name: 'DOC_TYPE', label: 'Document', type: 'select', options: ['REQ', 'PO', 'RCV', 'CO'], required: true },
      { name: 'PREFIX', label: 'Prefix' }, { name: 'YEAR_IN_NUMBER', label: 'Year in number', type: 'yn' },
      { name: 'NEXT_NUMBER', label: 'Next number', type: 'number' }, { name: 'PAD_LENGTH', label: 'Digits', type: 'number' },
      { name: 'RESET_YEARLY', label: 'Reset every year', type: 'yn' },
    ],
  },
  {
    key: 'SITE_OPTIONS', title: 'Supplier site options', rowKey: 'SITE_OPTION_ID', deletable: true,
    sql: `SELECT o.*, ss.SUPPLIER_NAME, ss.SITE_NAME FROM RR_PO_SUPPLIER_SITE_OPTIONS o
          LEFT JOIN (SELECT DISTINCT SUPPLIER_SITE_ID, SUPPLIER_NAME, SITE_NAME FROM RR_PO_V_SUPPLIER_SITES) ss
                 ON ss.SUPPLIER_SITE_ID = o.SUPPLIER_SITE_ID ORDER BY ss.SUPPLIER_NAME`,
    help: 'Purchasing-only settings for an existing supplier site (RR_SUPPLIER_SITES is not changed): PO delivery, e-mail, hold.',
    columns: ['SUPPLIER_NAME', 'SITE_NAME', 'PO_COMMUNICATION', 'PO_EMAIL', 'DEFAULT_CURRENCY', 'MATCH_LEVEL', 'PURCHASING_HOLD_FLAG', 'HOLD_REASON'],
    fields: [
      { name: 'SUPPLIER_SITE_ID', label: 'Supplier site', type: 'site', required: true },
      { name: 'PO_COMMUNICATION', label: 'Send POs by', type: 'select', options: ['PRINT', 'EMAIL', 'NONE'] },
      { name: 'PO_EMAIL', label: 'PO e-mail' }, { name: 'DEFAULT_CURRENCY', label: 'Default currency' },
      { name: 'MATCH_LEVEL', label: 'Match level', type: 'select', options: ['TWO_WAY', 'THREE_WAY'] },
      { name: 'INVOICE_QTY_TOLERANCE_PCT', label: 'Invoice qty tolerance %', type: 'number' },
      { name: 'INVOICE_PRICE_TOLERANCE_PCT', label: 'Invoice price tolerance %', type: 'number' },
      { name: 'PURCHASING_HOLD_FLAG', label: 'Purchasing hold', type: 'yn' }, { name: 'HOLD_REASON', label: 'Hold reason' },
    ],
  },
];

const BU_OPTION_FIELDS: { section: string; fields: Field[] }[] = [
  { section: 'General', fields: [
    { name: 'FUNCTIONAL_CURRENCY', label: 'Functional currency', required: true },
    { name: 'DEFAULT_RATE_TYPE', label: 'Default rate type', type: 'select', options: ['Corporate', 'Spot', 'User'], required: true },
    { name: 'DEFAULT_SHIP_TO_LOCATION_ID', label: 'Default ship-to', type: 'location' },
    { name: 'DEFAULT_BILL_TO_LOCATION_ID', label: 'Default bill-to', type: 'location' },
    { name: 'REQUIRE_REQUISITION', label: 'Require requisitions (no direct POs)', type: 'yn', help: 'N = buyers create POs directly (default)', required: true },
    { name: 'ALLOW_AFTER_FACT_PO', label: 'Allow after-the-fact POs', type: 'yn', required: true },
    { name: 'AUTOCREATE_MODE', label: 'Autocreate', type: 'select', options: ['MANUAL', 'AUTOMATIC'], required: true },
    { name: 'STATUS', label: 'Status', type: 'status', required: true },
  ] },
  { section: 'Approvals', fields: [
    { name: 'REQ_APPROVAL_REQUIRED', label: 'Requisition approval required', type: 'yn', required: true },
    { name: 'PO_APPROVAL_REQUIRED', label: 'PO approval required', type: 'yn', required: true },
    { name: 'CO_REAPPROVAL_THRESHOLD_PCT', label: 'Change-order re-approval above %', type: 'number', required: true },
    { name: 'SOD_BUYER_RECEIVE', label: 'Buyer may not receive own PO', type: 'yn', required: true },
    { name: 'BUDGET_CONTROL_LEVEL', label: 'Budget control', type: 'select', options: ['NONE', 'ADVISORY'], required: true },
  ] },
  { section: 'Receiving & matching', fields: [
    { name: 'MATCH_LEVEL_QUANTITY', label: 'Match level — goods', type: 'select', options: ['THREE_WAY', 'TWO_WAY'], required: true },
    { name: 'MATCH_LEVEL_AMOUNT', label: 'Match level — services', type: 'select', options: ['TWO_WAY', 'THREE_WAY'], required: true },
    { name: 'OVER_RECEIPT_TOLERANCE_PCT', label: 'Over-receipt tolerance %', type: 'number', required: true },
    { name: 'OVER_RECEIPT_ACTION', label: 'Over-receipt action', type: 'select', options: ['REJECT', 'WARNING'], required: true },
    { name: 'EARLY_RECEIPT_DAYS', label: 'Early receipt days', type: 'number' },
    { name: 'RECEIPT_CLOSE_TOLERANCE_PCT', label: 'Receipt close tolerance %', type: 'number', required: true },
    { name: 'INVOICE_CLOSE_TOLERANCE_PCT', label: 'Invoice close tolerance %', type: 'number', required: true },
    { name: 'INVOICE_QTY_TOLERANCE_PCT', label: 'Invoice qty tolerance %', type: 'number', required: true },
    { name: 'INVOICE_PRICE_TOLERANCE_PCT', label: 'Invoice price tolerance %', type: 'number', required: true },
    { name: 'INVOICE_AMOUNT_TOLERANCE', label: 'Invoice amount tolerance', type: 'number' },
  ] },
  { section: 'Accounting', fields: [
    { name: 'ACCRUE_AT_RECEIPT_FLAG', label: 'Accrue at receipt', type: 'yn', help: 'N = accrue at period end', required: true },
    { name: 'RECEIPT_ACCRUAL_ACCOUNT', label: 'Receipt accrual (GRNI) account', type: 'account', requiredWhen: { field: 'ACCRUE_AT_RECEIPT_FLAG', equals: 'Y' }, help: 'Required when accruing at receipt' },
    { name: 'PRICE_VARIANCE_ACCOUNT', label: 'Invoice price variance account', type: 'account' },
    { name: 'EXCHANGE_GAIN_ACCOUNT', label: 'Exchange gain account', type: 'account' },
    { name: 'EXCHANGE_LOSS_ACCOUNT', label: 'Exchange loss account', type: 'account' },
    { name: 'ACCRUAL_WRITE_OFF_ACCOUNT', label: 'Accrual write-off account', type: 'account' },
    { name: 'ACCRUAL_WRITE_OFF_AGE_DAYS', label: 'Write-off allowed after (days)', type: 'number' },
  ] },
  { section: 'Purchase order document', fields: [
    { name: 'PO_EMAIL_SUBJECT', label: 'E-mail subject', span: 3 },
    { name: 'PO_EMAIL_BODY', label: 'E-mail body', type: 'textarea', span: 3 },
    { name: 'PO_TERMS_TEXT', label: 'Terms and conditions (printed on the PO)', type: 'textarea', span: 3 },
  ] },
];

interface SetupLookups { bus: Row[]; locations: Row[]; categories: Row[]; items: Row[]; uoms: Row[]; sites: Row[] }

const FieldInput: React.FC<{ f: Field; lk: SetupLookups; id?: string; value?: any; onChange?: (v: any) => void; supplierId?: number; company?: string | null }> = ({ f, lk, id, value, onChange, supplierId, company }) => {
  const sel = (options: { value: any; label: string }[], allowClear = !f.required) =>
    <Select id={id} value={value ?? undefined} onChange={v => onChange?.(v ?? null)} allowClear={allowClear} showSearch optionFilterProp="label" options={options} />;
  switch (f.type) {
    case 'account': return <AccountInput id={id} value={value} onChange={v => onChange?.(v)} company={company} />;
    case 'number': return <InputNumber id={id} style={{ width: '100%' }} value={value ?? undefined} onChange={v => onChange?.(v ?? null)} />;
    case 'yn': return sel(YesNo, false);
    case 'status': return sel(STATUS_OPTS.map(s => ({ value: s, label: s })), false);
    case 'select': return sel((f.options || []).map(s => ({ value: s, label: s })));
    case 'bu': return sel(lk.bus.map(b => ({ value: Number(b.BUSINESS_UNIT_ID), label: b.BUSINESS_UNIT_NAME })));
    case 'location': return sel(lk.locations.map(l => ({ value: Number(l.LOCATION_ID), label: `${l.LOCATION_CODE} — ${l.LOCATION_NAME}` })));
    case 'category': return sel(lk.categories.map(c => ({ value: Number(c.CATEGORY_ID), label: `${c.CATEGORY_CODE} — ${c.FULL_NAME}` })));
    case 'item': return sel(lk.items.map(i => ({ value: Number(i.EXPENSE_ITEM_ID), label: `${i.ITEM_CODE} — ${i.DESCRIPTION}` })));
    case 'uom': return sel(lk.uoms.map(u => ({ value: u.UOM_CODE, label: `${u.UOM_CODE} — ${u.UOM_NAME}` })));
    case 'supplier': return <SupplierSelect id={id} bu={null} anyBu value={value ?? null} onChange={v => onChange?.(v)} />;
    case 'site': return <SiteSearchSelect id={id} value={value ?? null} supplierId={supplierId} onChange={v => onChange?.(v)} />;
    case 'textarea': return <Input.TextArea id={id} rows={4} value={value ?? ''} onChange={e => onChange?.(e.target.value)} />;
    default: return <Input id={id} value={value ?? ''} onChange={e => onChange?.(e.target.value)} />;
  }
};

// mandatory = NOT NULL column (required) or conditionally required (requiredWhen, checked against the form)
const isReq = (f: Field, values?: Record<string, any>) =>
  !!f.required || (!!f.requiredWhen && (values ? values[f.requiredWhen.field] === f.requiredWhen.equals : true));
const ruleFor = (f: Field) => (f.required ? [{ required: true, message: `${f.label} is required` }]
  : f.requiredWhen ? [({ getFieldValue }: { getFieldValue: (n: string) => any }) => ({
      validator: (_: unknown, v: any) => (getFieldValue(f.requiredWhen!.field) === f.requiredWhen!.equals && (v === null || v === undefined || v === '')
        ? Promise.reject(new Error(`${f.label} is required`)) : Promise.resolve()),
    })] : undefined);

const toJson = (fields: Field[], v: Record<string, any>, isNew: boolean) => {
  const o: Record<string, unknown> = {};
  fields.forEach(f => {
    const val = v[f.name];
    if (val === undefined || ((val === null || val === '') && isNew)) return;   // new rows: let column defaults apply
    o[f.name.toLowerCase()] = val === '' ? null : val;
  });
  return o;
};

const EntityGrid: React.FC<{ e: Entity; lk: SetupLookups; onChanged: () => void }> = ({ e, lk, onChanged }) => {
  const user = usePoUser();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [edit, setEdit] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [form] = Form.useForm();
  const supplierId = Form.useWatch('PREFERRED_SUPPLIER_ID', form);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await poQuery(e.sql)); } catch (err: any) { message.error(err.message); } finally { setLoading(false); }
  }, [e.sql]);
  useEffect(() => { load(); }, [load]);

  const open = (r: Row | null) => {
    form.resetFields();
    const init: Record<string, any> = {};
    e.fields.forEach(f => {
      init[f.name] = r ? r[f.name] : (f.type === 'status' ? 'ACTIVE' : undefined);
      if (!r && f.type === 'yn') init[f.name] = ['DEFAULT_FLAG', 'CAPEX_FLAG', 'RECEIPT_REQUIRED_FLAG', 'PURCHASING_HOLD_FLAG'].includes(f.name) ? 'N' : 'Y';
      if (r && ['bu', 'location', 'category', 'item', 'supplier', 'site'].includes(f.type || '') && r[f.name] != null) init[f.name] = Number(r[f.name]);
    });
    form.setFieldsValue(init);
    setEdit(r || {});
  };
  const save = async () => {
    const v = await form.validateFields().catch(() => null);   // invalid fields are shown on the form
    if (!v) return null;
    const isNew = !edit || edit[e.rowKey] === undefined;
    const json = toJson(e.fields, v, isNew);
    if (!isNew && e.key !== 'UOM') json[e.rowKey.toLowerCase()] = edit![e.rowKey];
    setBusy(true);
    try {
      const r = await poExec(PROC.saveSetup, { p_entity: e.key, p_json: json }, user);
      message.success(r.message || 'Saved');
      setEdit(null); load(); onChanged();
    } catch (err: any) { message.error(err.message, 8); } finally { setBusy(false); }
  };
  const del = async (r: Row) => {
    try { await poExec(PROC.deleteSetup, { p_entity: e.key, p_row_id: r[e.rowKey] }, user); message.success('Deleted'); load(); onChanged(); }
    catch (err: any) { message.error(err.message); }
  };

  const shown = useMemo(() => {
    const s = search.trim().toUpperCase();
    return s ? rows.filter(r => e.columns.some(c => String(r[c] ?? '').toUpperCase().includes(s))) : rows;
  }, [rows, search, e.columns]);

  return (
    <Card size="small">
      {e.help && <Alert type="info" showIcon style={{ marginBottom: 12 }} message={e.help} />}
      <Space wrap style={{ marginBottom: 12 }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => open(null)}>Add</Button>
        <Input.Search allowClear placeholder="Filter" style={{ width: 240 }} onSearch={setSearch} onChange={ev => !ev.target.value && setSearch('')} />
        <Button icon={<ReloadOutlined />} onClick={load}>Refresh</Button>
        <Text type="secondary">{shown.length} row(s)</Text>
      </Space>
      <Table size="small" rowKey={e.rowKey} loading={loading} dataSource={shown} pagination={{ pageSize: 20 }} scroll={{ x: 1000 }}
        onRow={r => ({ onDoubleClick: () => open(r) })}
        columns={[
          ...e.columns.map(c => ({
            title: c.replace(/_ID$/, '').replace(/_FLAG$/, '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, ch => ch.toUpperCase()),
            dataIndex: c, ellipsis: true,
            render: (v: any) => c === 'STATUS' ? <StatusTag s={v} /> : (v === 'Y' ? <Tag color="green">Yes</Tag> : v === 'N' ? <Tag>No</Tag> : v),
          })),
          { title: '', width: 90, fixed: 'right' as const, render: (_: unknown, r: Row) => (
            <Space size={0}>
              <Button size="small" type="text" icon={<EditOutlined />} onClick={() => open(r)} />
              {e.deletable && <Popconfirm title="Delete this row?" onConfirm={() => del(r)}><Button size="small" type="text" danger icon={<DeleteOutlined />} /></Popconfirm>}
            </Space>) },
        ]} />
      <Modal open={!!edit} title={`${edit && edit[e.rowKey] !== undefined ? 'Edit' : 'New'} — ${e.title}`} width={860} destroyOnHidden
        onCancel={() => setEdit(null)} onOk={save} confirmLoading={busy} okText="Save">
        <Form form={form} layout="vertical">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', columnGap: 16 }}>
            {e.fields.map(f => (
              <Form.Item key={f.name} name={f.name} label={f.label} rules={ruleFor(f)} required={isReq(f)}
                extra={f.help} style={f.span ? { gridColumn: `span ${f.span}` } : undefined}>
                <FieldInput f={f} lk={lk} supplierId={f.name === 'PREFERRED_SUPPLIER_SITE_ID' ? supplierId : undefined}
                  /* UOM code is the key — not editable once created */ />
              </Form.Item>
            ))}
          </div>
        </Form>
      </Modal>
    </Card>
  );
};

const BuOptions: React.FC<{ buState: ReturnType<typeof useBusinessUnits>; lk: SetupLookups }> = ({ buState, lk }) => {
  const user = usePoUser();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [exists, setExists] = useState(false);
  const all = BU_OPTION_FIELDS.flatMap(s => s.fields);
  const accrue = Form.useWatch('ACCRUE_AT_RECEIPT_FLAG', form);

  useEffect(() => {
    if (!buState.bu) return;
    setLoading(true);
    const cols = all.map(f => (['PO_TERMS_TEXT', 'PO_EMAIL_BODY'].includes(f.name)
      ? `CAST(SUBSTR(${f.name}, 1, 3900) AS VARCHAR2(3900)) AS ${f.name}` : f.name)).join(', ');
    const applyDefaults = () => form.setFieldsValue({
            FUNCTIONAL_CURRENCY: buState.current?.FUNCTIONAL_CURRENCY || 'AED', DEFAULT_RATE_TYPE: 'Corporate', REQUIRE_REQUISITION: 'N',
            ALLOW_AFTER_FACT_PO: 'N', AUTOCREATE_MODE: 'MANUAL', STATUS: 'ACTIVE', REQ_APPROVAL_REQUIRED: 'Y', PO_APPROVAL_REQUIRED: 'Y',
            CO_REAPPROVAL_THRESHOLD_PCT: 0, SOD_BUYER_RECEIVE: 'Y', BUDGET_CONTROL_LEVEL: 'NONE', MATCH_LEVEL_QUANTITY: 'THREE_WAY',
            MATCH_LEVEL_AMOUNT: 'TWO_WAY', OVER_RECEIPT_TOLERANCE_PCT: 0, OVER_RECEIPT_ACTION: 'REJECT', RECEIPT_CLOSE_TOLERANCE_PCT: 0,
            INVOICE_CLOSE_TOLERANCE_PCT: 0, INVOICE_QTY_TOLERANCE_PCT: 0, INVOICE_PRICE_TOLERANCE_PCT: 5, ACCRUE_AT_RECEIPT_FLAG: 'Y',
          });
    poQuery(`SELECT BU_OPTION_ID, ${cols} FROM RR_PO_BU_OPTIONS WHERE BUSINESS_UNIT_ID = ${nlit(buState.bu)}`)
      .then(([r]) => {
        form.resetFields();
        setExists(!!r);
        if (r) {
          const v: Record<string, any> = {};
          all.forEach(f => { v[f.name] = f.type === 'location' && r[f.name] != null ? Number(r[f.name]) : r[f.name]; });
          form.setFieldsValue(v);
        } else applyDefaults();
      })
      .catch(e => { message.error(e.message); form.resetFields(); applyDefaults(); })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buState.bu]);

  const save = async () => {
    const v = await form.validateFields().catch(() => null);   // invalid fields are shown on the form
    if (!v) return null;
    setBusy(true);
    try {
      const json = toJson(all, v, !exists);
      json.business_unit_id = buState.bu;
      const r = await poExec(PROC.saveSetup, { p_entity: 'BU_OPTIONS', p_json: json }, user);
      message.success(r.message || 'Saved');
      setExists(true);
    } catch (e: any) { message.error(e.message, 8); } finally { setBusy(false); }
  };

  if (!buState.bu) return <Alert type="info" showIcon message="Choose a business unit" />;
  return (
    <Card size="small" loading={loading}
      title={<Space>{buState.current?.BUSINESS_UNIT_NAME}{exists ? <Tag color="green">configured</Tag> : <Tag color="orange">not set up</Tag>}</Space>}
      extra={<Button type="primary" icon={<SaveOutlined />} loading={busy} onClick={save}>Save options</Button>}>
      <Alert type="info" showIcon style={{ marginBottom: 12 }}
        message="Approval rules"
        description={<span>Approvals use the existing approval engine — add rules with module <b>PROCUREMENT</b> and transaction types
          <b> REQUISITION</b>, <b>PURCHASE_ORDER</b> and <b>PO_CHANGE_ORDER</b> (optionally per business unit / category).
          {' '}<a onClick={() => navigate('/admin/approvals')}><LinkOutlined /> Open Approval Engine</a></span>} />
      <Form form={form} layout="vertical">
        {BU_OPTION_FIELDS.map(s => (
          <div key={s.section}>
            <Divider titlePlacement="start" style={{ color: PO_RED, marginTop: 4 }}>{s.section}</Divider>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', columnGap: 16 }}>
              {s.fields.map(f => (
                <Form.Item key={f.name} name={f.name} label={f.label} rules={ruleFor(f)} required={isReq(f, { ACCRUE_AT_RECEIPT_FLAG: accrue })}
                  dependencies={f.requiredWhen ? [f.requiredWhen.field] : undefined}
                  extra={f.help} style={f.span ? { gridColumn: `span ${f.span}` } : undefined}>
                  <FieldInput f={f} lk={lk} company={buState.current?.COMPANY} />
                </Form.Item>
              ))}
            </div>
          </div>
        ))}
      </Form>
    </Card>
  );
};

const PoSetup: React.FC = () => {
  const buState = useBusinessUnits();
  // deep link from the "no Purchasing Options" warning: /po/setup?tab=opt&bu=123
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'opt');
  const linkBu = Number(params.get('bu')) || null;
  const { setBu } = buState;
  useEffect(() => { if (linkBu) setBu(linkBu); }, [linkBu, setBu]);
  const [lk, setLk] = useState<SetupLookups>({ bus: [], locations: [], categories: [], items: [], uoms: [], sites: [] });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    Promise.all([
      poQuery('SELECT LOCATION_ID, LOCATION_CODE, LOCATION_NAME FROM RR_PO_LOCATIONS ORDER BY LOCATION_NAME'),
      poQuery('SELECT CATEGORY_ID, CATEGORY_CODE, FULL_NAME FROM RR_PO_V_CATEGORIES ORDER BY FULL_NAME'),
      poQuery('SELECT EXPENSE_ITEM_ID, ITEM_CODE, DESCRIPTION FROM RR_PO_EXPENSE_ITEMS ORDER BY ITEM_CODE'),
      poQuery('SELECT UOM_CODE, UOM_NAME FROM RR_PO_UOMS ORDER BY UOM_CODE'),
      Promise.resolve([] as Row[]),   // suppliers / sites are searched on demand
    ]).then(([locations, categories, items, uoms, sites]) => setLk(l => ({ ...l, locations, categories, items, uoms, sites })))
      .catch(e => message.error(e.message));
  }, [tick]);
  useEffect(() => { setLk(l => ({ ...l, bus: buState.bus })); }, [buState.bus]);

  return (
    <div style={{ padding: 20 }}>
      <PoBar title="Purchasing Setup" subtitle="Options per business unit · reference data" icon={<SettingOutlined />} buState={buState} />
      <Tabs activeKey={tab} onChange={setTab} items={[
        { key: 'opt', label: 'Purchasing options', children: <BuOptions buState={buState} lk={lk} /> },
        ...ENTITIES.map(e => ({ key: e.key, label: e.title, children: <EntityGrid e={e} lk={lk} onChanged={() => setTick(t => t + 1)} /> })),
      ]} />
    </div>
  );
};

export default PoSetup;
