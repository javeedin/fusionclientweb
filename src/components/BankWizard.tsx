// Guided create wizard for the Banks page: New Bank / New Branch / Create
// Bank Account. One stepped dialog, three entry modes — each step lets the
// user pick an existing record or create a new one inline, then Finish runs
// the needed POSTs in order (bank -> branch -> account) against the local
// endpoints from database/cash/160_banks_create_endpoints.sql.
import React, { useEffect, useMemo, useState } from 'react';
import {
  Modal, Steps, Form, Input, Select, Button, Space, Typography, Segmented,
  Checkbox, Alert, Spin, Tag, message,
} from 'antd';
import {
  BankOutlined, BranchesOutlined, CreditCardOutlined, CheckCircleOutlined,
  CloseCircleOutlined, ApiOutlined,
} from '@ant-design/icons';
import { buildApexUrl } from '../config/api.helper';
import { useAuth } from '../context/AuthContext';

const { Text } = Typography;

export type BankWizardMode = 'bank' | 'branch' | 'account';

interface Props {
  open: boolean;
  mode: BankWizardMode;
  existingBanks: { bankName: string; bankNumber?: string; countryName?: string }[];
  onClose: () => void;
  onDone: () => void;
}

interface CallResult {
  label: string;
  url: string;
  status: string;
  ok: boolean;
  body: string;
}

const MODE_TITLES: Record<BankWizardMode, string> = {
  bank: 'New Bank',
  branch: 'New Bank Branch',
  account: 'Create Bank Account',
};

const ACCOUNT_TYPES = ['CHECKING', 'SAVINGS', 'CURRENT', 'DEPOSIT', 'OTHER'];

const postJson = async (url: string, body: unknown): Promise<CallResult & { data?: any }> => {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch { /* keep raw */ }
    return {
      label: '', url, ok: res.ok && data?.success !== false,
      status: `HTTP ${res.status}`, body: text, data,
    };
  } catch (e: any) {
    return { label: '', url, ok: false, status: 'Network error', body: e?.message ?? String(e) };
  }
};

const BankWizard: React.FC<Props> = ({ open, mode, existingBanks, onClose, onDone }) => {
  const { user } = useAuth();
  const currentUser = user?.name || user?.username || 'System';
  const [form] = Form.useForm();

  const [step, setStep]             = useState(0);
  const [bankChoice, setBankChoice] = useState<'existing' | 'new'>('existing');
  const [branchChoice, setBranchChoice] = useState<'existing' | 'new'>('existing');
  const [branches, setBranches]     = useState<{ bank_branch_name: string; branch_number?: string }[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [legalEntities, setLegalEntities] = useState<string[]>([]);
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [saving, setSaving]         = useState(false);
  const [results, setResults]       = useState<CallResult[]>([]);
  const [finished, setFinished]     = useState(false);

  const steps = useMemo(() => {
    const all = [
      { key: 'bank',    title: 'Bank',    icon: <BankOutlined /> },
      { key: 'branch',  title: 'Branch',  icon: <BranchesOutlined /> },
      { key: 'account', title: 'Account', icon: <CreditCardOutlined /> },
    ];
    return mode === 'bank' ? all.slice(0, 1) : mode === 'branch' ? all.slice(0, 2) : all;
  }, [mode]);

  // Reset when the dialog opens
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setResults([]);
    setFinished(false);
    setSaving(false);
    setBankChoice(mode === 'bank' ? 'new' : 'existing');
    setBranchChoice('existing');
    setBranches([]);
    form.resetFields();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode]);

  // LOVs for the account step
  useEffect(() => {
    if (!open || mode !== 'account') return;
    fetch(buildApexUrl('gl/legalentities'), { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(d => setLegalEntities(
        ((d.items || []) as any[])
          .map(i => i.name ?? i.NAME ?? i.legal_entity_name)
          .filter(Boolean)
      ))
      .catch(() => setLegalEntities([]));
    fetch(buildApexUrl('currencies'), { headers: { Accept: 'application/json' } })
      .then(r => r.json())
      .then(d => setCurrencies(
        (((d.items ?? d.data ?? []) as any[])
          .map(i => i.currency_code ?? i.CURRENCY_CODE ?? i.code)
          .filter(Boolean)) as string[]
      ))
      .catch(() => setCurrencies([]));
  }, [open, mode]);

  // Load branches when an existing bank is chosen
  const loadBranches = async (bankName: string) => {
    setBranchesLoading(true);
    setBranches([]);
    try {
      const res = await fetch(buildApexUrl('banks/brankbranches'), { headers: { Accept: 'application/json' } });
      const data = await res.json();
      const rows = ((data.items || []) as any[]).filter(r => r.bank_name === bankName);
      setBranches(rows);
      setBranchChoice(rows.length > 0 ? 'existing' : 'new');
    } catch {
      setBranches([]);
      setBranchChoice('new');
    }
    setBranchesLoading(false);
  };

  const isNewBank = bankChoice === 'new';
  const isNewBranch = isNewBank || branchChoice === 'new';

  const fieldsForStep = (s: number): string[] => {
    const key = steps[s]?.key;
    if (key === 'bank')   return isNewBank ? ['newBankName'] : ['existingBank'];
    if (key === 'branch') return isNewBranch ? ['newBranchName'] : ['existingBranch'];
    return ['accountName', 'accountNumber', 'legalEntityName'];
  };

  const next = async () => {
    try {
      await form.validateFields(fieldsForStep(step));
    } catch { return; }
    if (steps[step].key === 'bank' && !isNewBank) {
      const bank = form.getFieldValue('existingBank');
      if (steps.length > 1) loadBranches(bank);
    }
    setStep(s => s + 1);
  };

  const finish = async () => {
    try {
      await form.validateFields(fieldsForStep(step));
    } catch { return; }
    const v = form.getFieldsValue(true);
    const bankName = isNewBank ? v.newBankName?.trim() : v.existingBank;
    const branchName = isNewBranch ? v.newBranchName?.trim() : v.existingBranch;

    setSaving(true);
    const log: CallResult[] = [];
    let failed = false;

    if (isNewBank) {
      const r = await postJson(buildApexUrl('banks/create'), {
        bankName,
        bankNumber:  v.newBankNumber || null,
        countryName: v.newBankCountry || null,
        description: v.newBankDesc || null,
        createdBy:   currentUser,
      });
      r.label = `Create bank "${bankName}"`;
      log.push(r);
      failed = !r.ok;
    }

    if (!failed && steps.length >= 2 && isNewBranch) {
      const r = await postJson(buildApexUrl('banks/branches/create'), {
        bankName,
        branchName,
        branchNumber: v.newBranchNumber || null,
        swiftCode:    v.newBranchSwift || null,
        countryName:  v.newBranchCountry || null,
        description:  v.newBranchDesc || null,
        createdBy:    currentUser,
      });
      r.label = `Create branch "${branchName}"`;
      log.push(r);
      failed = !r.ok;
    }

    if (!failed && steps.length === 3) {
      const r = await postJson(buildApexUrl('banks/accounts/create'), {
        bankName,
        branchName,
        accountName:     v.accountName?.trim(),
        accountNumber:   v.accountNumber?.trim(),
        legalEntityName: v.legalEntityName,
        currencyCode:    v.currencyCode || null,
        accountType:     v.accountType || null,
        ibanNumber:      v.ibanNumber || null,
        description:     v.accountDesc || null,
        apUseAllowed:    v.apUse === false ? 'false' : 'true',
        arUseAllowed:    v.arUse === false ? 'false' : 'true',
        createdBy:       currentUser,
      });
      r.label = `Create account "${v.accountName?.trim()}"`;
      log.push(r);
      failed = !r.ok;
    }

    setResults(log);
    setSaving(false);
    if (!failed) {
      setFinished(true);
      message.success(`${MODE_TITLES[mode]} completed`);
      onDone();
    }
  };

  const stepKey = steps[step]?.key;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={<Space><BankOutlined style={{ color: '#0572CE' }} /><span>{MODE_TITLES[mode]}</span></Space>}
      width={640}
      footer={null}
      destroyOnClose
    >
      <Steps
        current={step}
        size="small"
        items={steps.map(s => ({ title: s.title, icon: s.icon }))}
        style={{ marginBottom: 20 }}
      />

      <Form form={form} layout="vertical" size="small" preserve>
        {/* ── Step: Bank ── */}
        <div style={{ display: stepKey === 'bank' ? 'block' : 'none' }}>
          {mode !== 'bank' && (
            <Segmented
              options={[{ label: 'Existing Bank', value: 'existing' }, { label: 'New Bank', value: 'new' }]}
              value={bankChoice}
              onChange={v => setBankChoice(v as 'existing' | 'new')}
              style={{ marginBottom: 14 }}
            />
          )}
          {!isNewBank ? (
            <Form.Item name="existingBank" label="Bank" rules={[{ required: true, message: 'Select a bank' }]}>
              <Select
                showSearch
                placeholder="Select a bank"
                optionFilterProp="label"
                options={existingBanks.map(b => ({
                  value: b.bankName,
                  label: b.bankName + (b.countryName ? ` — ${b.countryName}` : ''),
                }))}
              />
            </Form.Item>
          ) : (
            <>
              <Form.Item name="newBankName" label="Bank Name" rules={[{ required: true, message: 'Bank name is required' }]}>
                <Input placeholder="e.g. Emirates NBD" maxLength={360} />
              </Form.Item>
              <Space.Compact block>
                <Form.Item name="newBankNumber" label="Bank Number" style={{ width: '50%', marginRight: 8 }}>
                  <Input placeholder="Optional" maxLength={60} />
                </Form.Item>
                <Form.Item name="newBankCountry" label="Country" style={{ width: '50%' }}>
                  <Input placeholder="e.g. United Arab Emirates" maxLength={100} />
                </Form.Item>
              </Space.Compact>
              <Form.Item name="newBankDesc" label="Description">
                <Input placeholder="Optional" maxLength={240} />
              </Form.Item>
            </>
          )}
        </div>

        {/* ── Step: Branch ── */}
        <div style={{ display: stepKey === 'branch' ? 'block' : 'none' }}>
          {!isNewBank && (
            <Segmented
              options={[
                { label: `Existing Branch (${branches.length})`, value: 'existing', disabled: branches.length === 0 },
                { label: 'New Branch', value: 'new' },
              ]}
              value={branchChoice}
              onChange={v => setBranchChoice(v as 'existing' | 'new')}
              style={{ marginBottom: 14 }}
            />
          )}
          {branchesLoading ? (
            <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
          ) : !isNewBranch ? (
            <Form.Item name="existingBranch" label="Branch" rules={[{ required: true, message: 'Select a branch' }]}>
              <Select
                showSearch
                placeholder="Select a branch"
                optionFilterProp="label"
                options={branches.map(b => ({
                  value: b.bank_branch_name,
                  label: b.bank_branch_name + (b.branch_number ? ` — ${b.branch_number}` : ''),
                }))}
              />
            </Form.Item>
          ) : (
            <>
              <Form.Item name="newBranchName" label="Branch Name" rules={[{ required: true, message: 'Branch name is required' }]}>
                <Input placeholder="e.g. Deira Main Branch" maxLength={360} />
              </Form.Item>
              <Space.Compact block>
                <Form.Item name="newBranchNumber" label="Branch Number" style={{ width: '34%', marginRight: 8 }}>
                  <Input placeholder="Optional" maxLength={60} />
                </Form.Item>
                <Form.Item name="newBranchSwift" label="SWIFT / BIC" style={{ width: '33%', marginRight: 8 }}>
                  <Input placeholder="Optional" maxLength={60} />
                </Form.Item>
                <Form.Item name="newBranchCountry" label="Country" style={{ width: '33%' }}>
                  <Input placeholder="Defaults from bank" maxLength={100} />
                </Form.Item>
              </Space.Compact>
              <Form.Item name="newBranchDesc" label="Description">
                <Input placeholder="Optional" maxLength={240} />
              </Form.Item>
            </>
          )}
        </div>

        {/* ── Step: Account ── */}
        <div style={{ display: stepKey === 'account' ? 'block' : 'none' }}>
          <Space.Compact block>
            <Form.Item name="accountName" label="Account Name" style={{ width: '50%', marginRight: 8 }}
              rules={[{ required: true, message: 'Account name is required' }]}>
              <Input placeholder="e.g. BUIMERC AED Operating" maxLength={360} />
            </Form.Item>
            <Form.Item name="accountNumber" label="Account Number" style={{ width: '50%' }}
              rules={[{ required: true, message: 'Account number is required' }]}>
              <Input placeholder="Account number" maxLength={100} />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="legalEntityName" label="Legal Entity"
            rules={[{ required: true, message: 'Legal entity is required' }]}>
            <Select
              showSearch
              placeholder="Assign to a legal entity"
              options={legalEntities.map(le => ({ value: le, label: le }))}
              notFoundContent={legalEntities.length === 0 ? 'No legal entities synced' : undefined}
            />
          </Form.Item>
          <Space.Compact block>
            <Form.Item name="currencyCode" label="Currency" style={{ width: '34%', marginRight: 8 }}>
              <Select
                showSearch
                allowClear
                placeholder="e.g. AED"
                options={(currencies.length ? currencies : ['AED', 'USD', 'EUR', 'GBP', 'INR']).map(c => ({ value: c, label: c }))}
              />
            </Form.Item>
            <Form.Item name="accountType" label="Account Type" style={{ width: '33%', marginRight: 8 }}>
              <Select allowClear placeholder="Optional" options={ACCOUNT_TYPES.map(t => ({ value: t, label: t }))} />
            </Form.Item>
            <Form.Item name="ibanNumber" label="IBAN" style={{ width: '33%' }}>
              <Input placeholder="Optional" maxLength={100} />
            </Form.Item>
          </Space.Compact>
          <Form.Item name="accountDesc" label="Description">
            <Input placeholder="Optional" maxLength={240} />
          </Form.Item>
          <Space size={16}>
            <Form.Item name="apUse" valuePropName="checked" initialValue={true} noStyle>
              <Checkbox>AP use allowed</Checkbox>
            </Form.Item>
            <Form.Item name="arUse" valuePropName="checked" initialValue={true} noStyle>
              <Checkbox>AR use allowed</Checkbox>
            </Form.Item>
          </Space>
        </div>
      </Form>

      {/* ── API results (transparency) ── */}
      {results.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {results.map((r, i) => (
            <div key={i} style={{
              border: `1px solid ${r.ok ? '#b7eb8f' : '#ffa39e'}`,
              background: r.ok ? '#f6ffed' : '#fff2f0',
              borderRadius: 6, padding: '8px 12px', marginBottom: 8,
            }}>
              <Space>
                {r.ok
                  ? <CheckCircleOutlined style={{ color: '#52c41a' }} />
                  : <CloseCircleOutlined style={{ color: '#f5222d' }} />}
                <Text strong style={{ fontSize: 12 }}>{r.label}</Text>
                <Tag color={r.ok ? 'green' : 'red'} style={{ fontSize: 10 }}>{r.status}</Tag>
              </Space>
              <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#888', marginTop: 4, wordBreak: 'break-all' }}>
                <ApiOutlined /> POST {r.url}
              </div>
              <pre style={{
                margin: '4px 0 0', fontSize: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                color: r.ok ? '#389e0d' : '#cf1322', maxHeight: 80, overflow: 'auto',
              }}>{r.body}</pre>
            </div>
          ))}
        </div>
      )}

      {finished && (
        <Alert type="success" showIcon style={{ marginTop: 8 }}
          message="Done — the lists have been refreshed." />
      )}

      {/* ── Footer buttons ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20 }}>
        <Button onClick={onClose}>{finished ? 'Close' : 'Cancel'}</Button>
        <Space>
          {step > 0 && !finished && (
            <Button onClick={() => setStep(s => s - 1)} disabled={saving}>Back</Button>
          )}
          {!finished && (
            step < steps.length - 1
              ? <Button type="primary" onClick={next}>Next</Button>
              : <Button type="primary" onClick={finish} loading={saving}>
                  {MODE_TITLES[mode] === 'New Bank' ? 'Create Bank'
                    : MODE_TITLES[mode] === 'New Bank Branch' ? 'Create Branch'
                    : 'Create Account'}
                </Button>
          )}
        </Space>
      </div>
    </Modal>
  );
};

export default BankWizard;
