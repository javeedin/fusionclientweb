import React, { useState, useEffect, useCallback } from 'react';
import * as XLSX from 'xlsx';
import {
  Layout, Card, Form, Input, Button, Space, Typography, Table, Tag,
  Row, Col, Breadcrumb, Tooltip, Select, Tabs, Descriptions,
  Spin, Empty, Badge, message, Checkbox,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  HomeOutlined, SearchOutlined, ReloadOutlined, PlusOutlined,
  InfoCircleOutlined, BookOutlined, FilterOutlined,
  AccountBookOutlined, DownloadOutlined, TagsOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import {
  searchCategories, getCategoryDetail, getCategoryBooks, getCategoryBookDefaults,
} from '../../../services/fa.service';
import type {
  CategoryRecord, CategoryDetail, CategoryBookRecord,
  CategoryBookDefaultRecord, CategorySearchParams,
} from '../../../services/fa.service';

const { Content } = Layout;
const { Text, Title } = Typography;
const { Option } = Select;

const REDWOOD = {
  primary:    '#C74634',
  success:    '#1D7B4D',
  warning:    '#D4A800',
  info:       '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral300: '#C7C7C7',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface:    '#FFFFFF',
};
const FA_COLOR = '#CA7700';

// ── Per-tab data ───────────────────────────────────────────────────────────────
interface OpenCategoryTab {
  key: string;
  category: CategoryRecord;
  loading: boolean;
  detail: Partial<CategoryDetail> | null;
  books: CategoryBookRecord[];
  defaults: CategoryBookDefaultRecord[];
  booksError: string | null;
  activeSubTab: string;
  activeBooksTab: string;
  selectedBookIdx: number;
}

// ── Account field row ──────────────────────────────────────────────────────────
const AccountField: React.FC<{ label: string; value: string | undefined; required?: boolean }> = ({ label, value, required }) => (
  <Row gutter={[0, 4]} style={{ marginBottom: 6 }}>
    <Col span={11}>
      <Text style={{ fontSize: 11, color: REDWOOD.neutral600 }}>
        {required && <span style={{ color: REDWOOD.primary, marginRight: 2 }}>*</span>}
        {label}
      </Text>
    </Col>
    <Col span={13}>
      <div style={{
        fontFamily: 'monospace', fontSize: 11,
        padding: '3px 6px', borderRadius: 4,
        background: REDWOOD.neutral100, border: `1px solid ${REDWOOD.neutral200}`,
        color: value ? REDWOOD.info : REDWOOD.neutral300,
        minHeight: 24, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }} title={value || '—'}>
        {value || '—'}
      </div>
    </Col>
  </Row>
);

// ── Read-only field (for Default Rules panel) ──────────────────────────────────
const ReadField: React.FC<{ label: string; value?: string | null; span?: number }> = ({ label, value }) => (
  <div style={{ marginBottom: 8 }}>
    <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>{label}</Text>
    <Text style={{ fontSize: 12 }}>{value || '—'}</Text>
  </div>
);

// ── Default Rules panel (per-book master/detail) ───────────────────────────────
const DefaultRulesPanel: React.FC<{
  defaults: CategoryBookDefaultRecord[];
  bookTypeCode: string | undefined;
}> = ({ defaults, bookTypeCode }) => {
  const [selIdx, setSelIdx] = useState(0);
  const rows = defaults.filter(d => !bookTypeCode || d.bookTypeCode === bookTypeCode);
  const sel  = rows[selIdx];

  useEffect(() => { setSelIdx(0); }, [bookTypeCode]);

  if (rows.length === 0) {
    return <Empty description="No default rules defined for this book" style={{ marginTop: 24 }} />;
  }

  const lifeYears  = sel?.lifeInMonths ? Math.floor(parseInt(sel.lifeInMonths) / 12) : null;
  const lifeMths   = sel?.lifeInMonths ? parseInt(sel.lifeInMonths) % 12 : null;

  const defColumns: ColumnsType<CategoryBookDefaultRecord> = [
    {
      title: 'From Date Placed in Service', dataIndex: 'fromDate', key: 'fromDate', width: 220,
      render: (v, _, i) => (
        <Button type="link" style={{ padding: 0, fontWeight: selIdx === i ? 700 : 400 }}
          onClick={() => setSelIdx(i)}>{v || '—'}</Button>
      ),
    },
    { title: 'To Date Placed in Service', dataIndex: 'toDate', key: 'toDate', width: 200,
      render: (v) => v || '(open)' },
  ];

  return (
    <div>
      <Table
        dataSource={rows}
        columns={defColumns}
        rowKey={(r, i) => `${r.defaultsId || i}`}
        size="small"
        pagination={false}
        rowClassName={(_, i) => i === selIdx ? 'ant-table-row-selected' : ''}
        onRow={(_, i) => ({ onClick: () => setSelIdx(i ?? 0), style: { cursor: 'pointer' } })}
        style={{ marginBottom: 16 }}
      />

      {sel && (
        <Card
          size="small"
          title={<Text strong style={{ fontSize: 12 }}>{sel.fromDate}: Details</Text>}
          style={{ borderRadius: 8, border: `1px solid ${REDWOOD.neutral200}` }}
          styles={{ body: { padding: '12px 16px' } }}
        >
          {/* Main depreciation fields */}
          <Row gutter={[24, 0]}>
            <Col xs={24} md={12}>
              <div style={{ marginBottom: 8 }}>
                <Checkbox checked={sel.depreciateFlag === 'YES' || sel.depreciateFlag === 'Y'} disabled>
                  <Text style={{ fontSize: 12 }}>Depreciate</Text>
                </Checkbox>
              </div>
              <ReadField label="Depreciation Method"   value={sel.deprnMethodCode} />
              <ReadField label="Life in Years"         value={lifeYears !== null ? String(lifeYears) : undefined} />
              <ReadField label="Life in Months"        value={lifeMths  !== null ? String(lifeMths)  : undefined} />
              <ReadField label="Depreciation Limit Type" value={sel.deprnLimitType} />
              <ReadField label="Bonus Rule"            value={sel.bonusRule} />
            </Col>
            <Col xs={24} md={12}>
              <ReadField label="Prorate Convention"       value={sel.prorateConventionCode} />
              <ReadField label="Retirement Convention"    value={sel.retirementTypeCode} />
              <ReadField label="Default Salvage Percent"  value={sel.percentSalvageValue} />
              <ReadField label="Depreciation Ceiling"     value={sel.ceilingName} />
              <Row gutter={8}>
                <Col span={12}><ReadField label="Capital Gains Threshold Years"  value={sel.capitalGainsThreshYears} /></Col>
                <Col span={12}><ReadField label="Months" value={sel.capitalGainsThreshMonths} /></Col>
              </Row>
              <ReadField label="Price Index"            value={sel.priceIndexName} />
              <div style={{ marginBottom: 8 }}>
                <Checkbox checked={sel.massPropertyFlag === 'Y' || sel.massPropertyFlag === 'YES'} disabled>
                  <Text style={{ fontSize: 12 }}>Mass property eligible</Text>
                </Checkbox>
              </div>
            </Col>
          </Row>

          {/* Default Subcomponent Rules */}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${REDWOOD.neutral200}` }}>
            <Text strong style={{ fontSize: 13, color: REDWOOD.neutral900, display: 'block', marginBottom: 8 }}>
              Default Subcomponent Rules
            </Text>
            <Row gutter={[24, 0]}>
              <Col xs={24} md={8}><ReadField label="Rule"            value={sel.subcompRuleType} /></Col>
              <Col xs={12}  md={8}><ReadField label="Minimum Years"  value={sel.minYearsLife} /></Col>
              <Col xs={12}  md={8}><ReadField label="Months"         value={sel.minMonthsLife} /></Col>
            </Row>
          </div>

          {/* Group Asset Options */}
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${REDWOOD.neutral200}` }}>
            <Text strong style={{ fontSize: 13, color: REDWOOD.neutral900, display: 'block', marginBottom: 8 }}>
              Group Asset Options
            </Text>
            <Row gutter={[24, 0]}>
              <Col xs={24} md={12}><ReadField label="Recognize Gain or Loss" value={sel.recognizeGainLoss} /></Col>
              <Col xs={24} md={12}><ReadField label="Tracking Method"        value={sel.trackingMethod} /></Col>
              <Col xs={24} md={12}><ReadField label="Terminal Gain or Loss"  value={sel.terminalGainLoss} /></Col>
              <Col xs={24} md={12}><ReadField label="Group Asset Number"     value={sel.groupAssetNumber} /></Col>
            </Row>
          </div>
        </Card>
      )}
    </div>
  );
};

// ── Category tab content ───────────────────────────────────────────────────────
const CategoryTabContent: React.FC<{
  tab: OpenCategoryTab;
  onSubTabChange: (key: string, subTab: string) => void;
  onBooksTabChange: (key: string, booksTab: string) => void;
  onBookRowSelect: (key: string, idx: number) => void;
}> = ({ tab, onSubTabChange, onBooksTabChange, onBookRowSelect }) => {
  const { category, detail, books, defaults, booksError, loading, activeSubTab, activeBooksTab, selectedBookIdx } = tab;
  const selectedBook = books[selectedBookIdx] ?? books[0];

  const bookColumns: ColumnsType<CategoryBookRecord> = [
    {
      title: 'Book', dataIndex: 'bookTypeCode', key: 'bookTypeCode', width: 200,
      render: (v, _, i) => (
        <Button type="link" style={{ padding: 0, fontWeight: selectedBookIdx === i ? 700 : 400 }}
          onClick={() => onBookRowSelect(tab.key, i)}>
          {v}
        </Button>
      ),
    },
    { title: 'Description', dataIndex: 'bookTypeName', key: 'bookTypeName', ellipsis: true },
    { title: 'Book Class',  dataIndex: 'bookClass',    key: 'bookClass',    width: 110 },
  ];

  // Book selector shown at the top of Accounts and Default Rules tabs
  const bookSelector = books.length > 1 ? (
    <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
      <Text type="secondary" style={{ fontSize: 12 }}>Book:</Text>
      <Select
        size="small"
        value={selectedBookIdx}
        onChange={(v) => onBookRowSelect(tab.key, v)}
        style={{ width: 220 }}
      >
        {books.map((b, i) => (
          <Option key={b.categoryBookId} value={i}>{b.bookTypeCode} – {b.bookTypeName || b.bookClass}</Option>
        ))}
      </Select>
    </div>
  ) : null;

  const subTabs = [
    {
      key: 'general',
      label: <span><InfoCircleOutlined style={{ marginRight: 4 }} />General</span>,
      children: loading
        ? <Spin style={{ display: 'block', margin: '40px auto' }} />
        : (
          <Descriptions column={2} size="small" bordered
            styles={{ label: { fontWeight: 500, width: 180, background: REDWOOD.neutral100 } }}
            style={{ marginTop: 8 }}
          >
            <Descriptions.Item label="Major Category">{detail?.segment1 || category.segment1}</Descriptions.Item>
            <Descriptions.Item label="Minor Category">{detail?.segment2 || category.segment2}</Descriptions.Item>
            <Descriptions.Item label="Description" span={2}>{detail?.description || category.description}</Descriptions.Item>
            <Descriptions.Item label="Category Type">
              {(detail?.categoryType || category.categoryType)
                ? <Tag style={{ borderRadius: 4 }}>{detail?.categoryType || category.categoryType}</Tag>
                : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="Ownership">{detail?.ownedLeased || category.ownedLeased || '—'}</Descriptions.Item>
            <Descriptions.Item label="Capitalized">
              <Checkbox checked={(detail?.capitalizeFlag || category.capitalizeFlag) === 'YES'} disabled />
            </Descriptions.Item>
            <Descriptions.Item label="Enabled">
              <Checkbox checked={(detail?.enabledFlag || category.enabledFlag) === 'Y'} disabled />
            </Descriptions.Item>
            <Descriptions.Item label="Created By">{detail?.createdBy || '—'}</Descriptions.Item>
            <Descriptions.Item label="Creation Date">{detail?.creationDate || '—'}</Descriptions.Item>
            <Descriptions.Item label="Last Updated By">{detail?.lastUpdatedBy || '—'}</Descriptions.Item>
            <Descriptions.Item label="Last Update Date">{detail?.lastUpdateDate || '—'}</Descriptions.Item>
          </Descriptions>
        ),
    },
    {
      key: 'books',
      label: <span><BookOutlined style={{ marginRight: 4 }} />Books</span>,
      children: loading
        ? <Spin style={{ display: 'block', margin: '40px auto' }} />
        : books.length === 0
          ? <Empty description="No book assignments" style={{ marginTop: 32 }} />
          : (
            <Table
              dataSource={books}
              columns={bookColumns}
              rowKey="categoryBookId"
              size="small"
              pagination={false}
              rowClassName={(_, i) => i === selectedBookIdx ? 'ant-table-row-selected' : ''}
              onRow={(_, i) => ({ onClick: () => onBookRowSelect(tab.key, i ?? 0), style: { cursor: 'pointer' } })}
              style={{ marginTop: 8 }}
            />
          ),
    },
    {
      key: 'accounts',
      label: <span><AccountBookOutlined style={{ marginRight: 4 }} />Accounts</span>,
      children: loading
        ? <Spin style={{ display: 'block', margin: '40px auto' }} />
        : booksError
          ? <div style={{ marginTop: 24, color: '#C74634', fontFamily: 'monospace', fontSize: 12 }}>
              API Error: {booksError}<br/>
              Make sure <b>database/fa/10_fa_categories.sql</b> has been run on the DB.
            </div>
        : books.length === 0
          ? <Empty description="No book assignments" style={{ marginTop: 32 }} />
          : !selectedBook
            ? <Empty description="Select a book" style={{ marginTop: 32 }} />
            : (
              <div style={{ marginTop: 8 }}>
                {bookSelector}
                <Row gutter={[20, 0]}>
                  <Col xs={24} md={8}>
                    <AccountField label="Asset Cost"                    value={selectedBook.assetCostAccount}            required />
                    <AccountField label="Asset Clearing"                value={selectedBook.assetClearingAccount}        required />
                    <AccountField label="Depreciation Expense"          value={selectedBook.deprnExpenseAccount}         required />
                    <AccountField label="Depreciation Reserve"          value={selectedBook.reserveAccount}              required />
                    <AccountField label="Bonus Depreciation Expense"    value={selectedBook.bonusExpenseAccount} />
                    <AccountField label="Bonus Depreciation Reserve"    value={selectedBook.bonusReserveAccount} />
                  </Col>
                  <Col xs={24} md={8}>
                    <AccountField label="CIP Cost"                      value={selectedBook.cipCostAccount} />
                    <AccountField label="CIP Clearing"                  value={selectedBook.cipClearingAccount} />
                    <AccountField label="Unplanned Depreciation Expense" value={selectedBook.unplannedDeprnExpAccount} />
                    <AccountField label="Impairment Expense"            value={selectedBook.impairmentExpenseAccount} />
                    <AccountField label="Impairment Reserve"            value={selectedBook.impairmentReserveAccount} />
                    <AccountField label="Revaluation Reserve"           value={selectedBook.revalReserveAccount} />
                  </Col>
                  <Col xs={24} md={8}>
                    <AccountField label="Revaluation Reserve Amortization" value={selectedBook.revalAmortAccount} />
                    <AccountField label="Revaluation Loss Expense"         value={selectedBook.revalLossExpAccount} />
                  </Col>
                </Row>
              </div>
            ),
    },
    {
      key: 'defaultRules',
      label: <span><FilterOutlined style={{ marginRight: 4 }} />Default Rules</span>,
      children: loading
        ? <Spin style={{ display: 'block', margin: '40px auto' }} />
        : books.length === 0
          ? <Empty description="No book assignments" style={{ marginTop: 32 }} />
          : (
            <div style={{ marginTop: 8 }}>
              {bookSelector}
              <DefaultRulesPanel
                defaults={defaults}
                bookTypeCode={selectedBook?.bookTypeCode}
              />
            </div>
          ),
    },
  ];

  return (
    <div style={{ padding: '16px 20px' }}>
      {/* Header strip */}
      <Card
        size="small"
        style={{
          borderRadius: 10, marginBottom: 16,
          border: `1px solid ${REDWOOD.neutral200}`,
          background: REDWOOD.surface,
          boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
        }}
        styles={{ body: { padding: '14px 20px' } }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <div>
            <Text type="secondary" style={{ fontSize: 11 }}>Category ID</Text>
            {' '}
            <Text strong style={{ fontSize: 15, color: FA_COLOR }}>{category.categoryId}</Text>
          </div>
          <span style={{ color: REDWOOD.neutral300 }}>|</span>
          <Text style={{ fontSize: 13 }}>{category.description}</Text>
          <div style={{ marginLeft: 'auto' }}>
            {(category.capitalizeFlag === 'YES') && (
              <Tag color="success" style={{ borderRadius: 4, fontSize: 11 }}>Capitalized</Tag>
            )}
            {(category.enabledFlag === 'Y') && (
              <Tag color="blue" style={{ borderRadius: 4, fontSize: 11 }}>Enabled</Tag>
            )}
          </div>
        </div>
        <Row gutter={[12, 0]}>
          <Col xs={12} sm={6} md={5}>
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Major Category</Text>
            <Text strong style={{ fontSize: 12 }}>{category.segment1}</Text>
          </Col>
          <Col xs={12} sm={6} md={5}>
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Minor Category</Text>
            <Text strong style={{ fontSize: 12 }}>{category.segment2 || '—'}</Text>
          </Col>
          <Col xs={12} sm={6} md={5}>
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Category Type</Text>
            <Text strong style={{ fontSize: 12 }}>{category.categoryType || '—'}</Text>
          </Col>
          <Col xs={12} sm={6} md={4}>
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Ownership</Text>
            <Text strong style={{ fontSize: 12 }}>{category.ownedLeased || '—'}</Text>
          </Col>
          <Col xs={12} sm={6} md={5}>
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>Books</Text>
            <Text strong style={{ fontSize: 12, color: FA_COLOR }}>{books.length}</Text>
          </Col>
        </Row>
      </Card>

      {/* Sub-tabs */}
      <Tabs
        activeKey={activeSubTab}
        onChange={(k) => onSubTabChange(tab.key, k)}
        size="small"
        tabBarStyle={{ borderBottom: `2px solid ${FA_COLOR}40`, marginBottom: 0 }}
        items={subTabs}
      />
    </div>
  );
};

// ── Main Component ─────────────────────────────────────────────────────────────
const ManageCategories: React.FC = () => {
  const [form] = Form.useForm();

  // Search state
  const [rows,       setRows]       = useState<CategoryRecord[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [page,       setPage]       = useState(1);
  const [pageSize,   setPageSize]   = useState(50);
  const [searched,   setSearched]   = useState(false);
  const [gridSearch, setGridSearch] = useState('');

  // Tab management
  const [activeTabKey,      setActiveTabKey]      = useState('search');
  const [openCategoryTabs,  setOpenCategoryTabs]  = useState<OpenCategoryTab[]>([]);

  const runSearch = useCallback(async (pg = 1, ps = pageSize) => {
    const vals = form.getFieldsValue();
    setLoading(true);
    try {
      const res = await searchCategories({
        description:   vals.description   || undefined,
        categoryType:  vals.categoryType  || undefined,
        capitalizeFlag:vals.capitalizeFlag || undefined,
        ownedLeased:   vals.ownedLeased   || undefined,
        enabledFlag:   vals.enabledFlag   || undefined,
        offset:        (pg - 1) * ps,
        limit:         ps,
      });
      if (res.error) { message.error(res.error); }
      else { setRows(res.items || []); setTotalCount(res.totalCount || 0); setPage(pg); }
    } finally {
      setLoading(false);
      setSearched(true);
    }
  }, [form, pageSize]);

  useEffect(() => { runSearch(1, pageSize); }, []);

  const displayedRows = gridSearch
    ? rows.filter(r => {
        const q = gridSearch.toLowerCase();
        return (
          (r.segment1    || '').toLowerCase().includes(q) ||
          (r.segment2    || '').toLowerCase().includes(q) ||
          (r.description || '').toLowerCase().includes(q) ||
          (r.categoryType|| '').toLowerCase().includes(q)
        );
      })
    : rows;

  const exportToExcel = () => {
    const data = displayedRows.map(r => ({
      'Category ID':    r.categoryId,
      'Major Category': r.segment1,
      'Minor Category': r.segment2,
      'Description':    r.description,
      'Category Type':  r.categoryType,
      'Ownership':      r.ownedLeased,
      'Capitalized':    r.capitalizeFlag === 'YES' ? 'Yes' : 'No',
      'Enabled':        r.enabledFlag === 'Y' ? 'Yes' : 'No',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Categories');
    XLSX.writeFile(wb, `fa_categories_${new Date().toISOString().slice(0,10)}.xlsx`);
  };

  const openCategoryTab = async (category: CategoryRecord) => {
    const tabKey = `cat-${category.categoryId}`;
    if (openCategoryTabs.find(t => t.key === tabKey)) { setActiveTabKey(tabKey); return; }

    setOpenCategoryTabs(prev => [...prev, {
      key: tabKey, category, loading: true,
      detail: null, books: [], defaults: [], booksError: null,
      activeSubTab: 'general', activeBooksTab: 'accounts', selectedBookIdx: 0,
    }]);
    setActiveTabKey(tabKey);

    try {
      const [det, bks, defs] = await Promise.all([
        getCategoryDetail(category.categoryId),
        getCategoryBooks(category.categoryId),
        getCategoryBookDefaults(category.categoryId),
      ]);
      setOpenCategoryTabs(prev => prev.map(t => t.key === tabKey ? {
        ...t, loading: false,
        detail:     det.success  !== false ? det  : null,
        books:      bks.items  || [],
        defaults:   defs.items || [],
        booksError: bks.error  || null,
      } : t));
    } catch {
      message.error('Failed to load category details');
      setOpenCategoryTabs(prev => prev.map(t => t.key === tabKey ? { ...t, loading: false } : t));
    }
  };

  const closeCategoryTab = (tabKey: string) => {
    setOpenCategoryTabs(prev => prev.filter(t => t.key !== tabKey));
    if (activeTabKey === tabKey) setActiveTabKey('search');
  };

  const onTabEdit = (targetKey: React.MouseEvent | React.KeyboardEvent | string, action: 'add' | 'remove') => {
    if (action === 'remove' && typeof targetKey === 'string') closeCategoryTab(targetKey);
  };

  const onSubTabChange    = (key: string, subTab: string)   => setOpenCategoryTabs(prev => prev.map(t => t.key === key ? { ...t, activeSubTab: subTab } : t));
  const onBooksTabChange  = (key: string, booksTab: string) => setOpenCategoryTabs(prev => prev.map(t => t.key === key ? { ...t, activeBooksTab: booksTab } : t));
  const onBookRowSelect   = (key: string, idx: number)      => setOpenCategoryTabs(prev => prev.map(t => t.key === key ? { ...t, selectedBookIdx: idx } : t));

  const handleReset = () => { form.resetFields(); setRows([]); setTotalCount(0); setSearched(false); setGridSearch(''); };

  // ── Table columns ─────────────────────────────────────────────────────────────
  const columns: ColumnsType<CategoryRecord> = [
    {
      title: 'Major Category', dataIndex: 'segment1', key: 'segment1', width: 180,
      sorter: (a, b) => a.segment1.localeCompare(b.segment1),
      render: (v, record) => (
        <Button type="link" style={{ padding: 0, fontWeight: 600 }}
          onClick={(e) => { e.stopPropagation(); openCategoryTab(record); }}>
          {v}
        </Button>
      ),
    },
    {
      title: 'Minor Category', dataIndex: 'segment2', key: 'segment2', width: 200,
      sorter: (a, b) => (a.segment2 || '').localeCompare(b.segment2 || ''),
    },
    {
      title: 'Description', dataIndex: 'description', key: 'description', ellipsis: true,
      sorter: (a, b) => (a.description || '').localeCompare(b.description || ''),
    },
    {
      title: 'Category Type', dataIndex: 'categoryType', key: 'categoryType', width: 120,
      sorter: (a, b) => (a.categoryType || '').localeCompare(b.categoryType || ''),
      render: (v) => v ? <Tag style={{ borderRadius: 4, fontSize: 11 }}>{v}</Tag> : '—',
    },
    {
      title: 'Capitalized', dataIndex: 'capitalizeFlag', key: 'capitalizeFlag', width: 100, align: 'center' as const,
      sorter: (a, b) => (a.capitalizeFlag || '').localeCompare(b.capitalizeFlag || ''),
      render: (v) => v === 'YES' ? <Checkbox checked disabled /> : '—',
    },
    {
      title: 'Ownership', dataIndex: 'ownedLeased', key: 'ownedLeased', width: 110,
      sorter: (a, b) => (a.ownedLeased || '').localeCompare(b.ownedLeased || ''),
    },
    {
      title: 'Enabled', dataIndex: 'enabledFlag', key: 'enabledFlag', width: 80, align: 'center' as const,
      render: (v) => <Tag color={v === 'Y' ? 'success' : 'default'} style={{ borderRadius: 4, fontSize: 11 }}>{v === 'Y' ? 'Yes' : 'No'}</Tag>,
    },
    {
      title: '', key: 'actions', width: 60, align: 'center' as const,
      render: (_: any, record: CategoryRecord) => (
        <Tooltip title="View details">
          <Button size="small" type="text" icon={<InfoCircleOutlined />}
            onClick={(e) => { e.stopPropagation(); openCategoryTab(record); }} />
        </Tooltip>
      ),
    },
  ];

  // ── Search tab content ─────────────────────────────────────────────────────
  const searchTabContent = (
    <div style={{ padding: 16 }}>
      <Card
        style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', marginBottom: 16 }}
        styles={{ body: { padding: '16px 20px' } }}
        title={<Space><FilterOutlined style={{ color: FA_COLOR }} /><Text strong style={{ fontSize: 13 }}>Search Parameters</Text></Space>}
      >
        <Form form={form} layout="vertical" onFinish={() => runSearch(1, pageSize)}>
          <Row gutter={[16, 0]}>
            <Col xs={24} sm={12} md={8}>
              <Form.Item name="description" label="Description" style={{ marginBottom: 8 }}>
                <Input placeholder="Contains..." allowClear prefix={<SearchOutlined />} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={4}>
              <Form.Item name="categoryType" label="Category Type" style={{ marginBottom: 8 }}>
                <Select allowClear placeholder="All">
                  <Option value="CAPITALIZED">Nonlease</Option>
                  <Option value="LEASED">Lease</Option>
                  <Option value="EXPENSED">Expensed</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={4}>
              <Form.Item name="capitalizeFlag" label="Capitalized" style={{ marginBottom: 8 }}>
                <Select allowClear placeholder="All">
                  <Option value="YES">Yes</Option>
                  <Option value="NO">No</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={4}>
              <Form.Item name="ownedLeased" label="Ownership" style={{ marginBottom: 8 }}>
                <Select allowClear placeholder="All">
                  <Option value="OWNED">Owned</Option>
                  <Option value="LEASED">Leased</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={4} style={{ display: 'flex', alignItems: 'flex-end' }}>
              <Form.Item style={{ marginBottom: 8, width: '100%' }}>
                <Space>
                  <Button type="primary" htmlType="submit" icon={<SearchOutlined />} loading={loading}
                    style={{ background: FA_COLOR, borderColor: FA_COLOR }}>Search</Button>
                  <Button icon={<ReloadOutlined />} onClick={handleReset}>Reset</Button>
                </Space>
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Card>

      {/* Results */}
      <Card
        style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}
        styles={{ body: { padding: 0 } }}
        title={
          searched
            ? <Text strong>Results <Badge count={totalCount} style={{ backgroundColor: FA_COLOR }} /></Text>
            : <Text strong>Categories</Text>
        }
        extra={
          <Space size="small">
            <Input
              size="small" allowClear placeholder="Search in grid…"
              prefix={<SearchOutlined style={{ color: REDWOOD.neutral300 }} />}
              style={{ width: 180 }}
              value={gridSearch}
              onChange={(e) => setGridSearch(e.target.value)}
            />
            {rows.length > 0 && (
              <Tooltip title="Export to Excel">
                <Button size="small" icon={<DownloadOutlined />} onClick={exportToExcel}>Excel</Button>
              </Tooltip>
            )}
          </Space>
        }
      >
        <Table<CategoryRecord>
          dataSource={displayedRows}
          columns={columns}
          rowKey="categoryId"
          loading={loading}
          size="small"
          scroll={{ x: 1000 }}
          locale={{ emptyText: searched ? 'No categories found' : 'Enter search criteria above' }}
          onRow={(record) => ({ onClick: () => openCategoryTab(record), style: { cursor: 'pointer' } })}
          pagination={{
            current: page, pageSize, total: totalCount,
            showSizeChanger: true,
            showTotal: (t) => `${t} total${gridSearch ? ` (${displayedRows.length} shown)` : ''}`,
            pageSizeOptions: ['25', '50', '100'],
            onChange: (p, ps) => { setPageSize(ps); runSearch(p, ps); },
          }}
        />
      </Card>
    </div>
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb + header */}
        <div style={{
          padding: '12px 24px',
          background: REDWOOD.surface,
          borderBottom: `1px solid ${REDWOOD.neutral200}`,
        }}>
          <Breadcrumb items={[
            { title: <Link to="/home"><HomeOutlined /> Home</Link> },
            { title: <Link to="/fa">Fixed Assets</Link> },
            { title: 'Manage Asset Categories' },
          ]} />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
            <Space align="center">
              <div style={{
                width: 36, height: 36, borderRadius: 8,
                background: `linear-gradient(135deg, ${FA_COLOR} 0%, #9E5C00 100%)`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <TagsOutlined style={{ fontSize: 18, color: '#fff' }} />
              </div>
              <div>
                <Title level={5} style={{ margin: 0, lineHeight: 1.2 }}>Manage Asset Categories</Title>
                <Text type="secondary" style={{ fontSize: 11 }}>Search and view fixed asset category definitions</Text>
              </div>
            </Space>
            <Button type="primary" icon={<PlusOutlined />}
              style={{ background: FA_COLOR, borderColor: FA_COLOR }}
              disabled
            >
              Create Category
            </Button>
          </div>
        </div>

        {/* Editable-card tabs */}
        <Tabs
          type="editable-card"
          activeKey={activeTabKey}
          onChange={setActiveTabKey}
          onEdit={onTabEdit}
          hideAdd
          destroyOnHidden
          style={{ background: REDWOOD.surface }}
          tabBarStyle={{
            margin: 0,
            padding: '4px 16px 0',
            background: REDWOOD.neutral200,
            borderBottom: `2px solid ${FA_COLOR}`,
          }}
          items={[
            {
              key: 'search',
              closable: false,
              label: (
                <span style={{
                  fontSize: 12,
                  fontWeight: activeTabKey === 'search' ? 600 : 400,
                  color: activeTabKey === 'search' ? FA_COLOR : REDWOOD.neutral600,
                }}>
                  <SearchOutlined style={{ marginRight: 6 }} />
                  Search
                  {totalCount > 0 && (
                    <Tag color={FA_COLOR} style={{ fontSize: 10, marginLeft: 8 }}>{totalCount}</Tag>
                  )}
                </span>
              ),
              children: searchTabContent,
            },
            ...openCategoryTabs.map(tab => ({
              key: tab.key,
              label: (
                <span style={{
                  fontSize: 12,
                  fontWeight: activeTabKey === tab.key ? 600 : 400,
                  color: activeTabKey === tab.key ? FA_COLOR : REDWOOD.neutral600,
                  maxWidth: 180, display: 'inline-block',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  verticalAlign: 'middle',
                }}>
                  {tab.loading && <Spin size="small" style={{ marginRight: 6 }} />}
                  {tab.category.segment1}{tab.category.segment2 ? ' – ' + tab.category.segment2 : ''}
                </span>
              ),
              children: (
                <CategoryTabContent
                  key={tab.key}
                  tab={tab}
                  onSubTabChange={onSubTabChange}
                  onBooksTabChange={onBooksTabChange}
                  onBookRowSelect={onBookRowSelect}
                />
              ),
            })),
          ]}
        />
      </Content>
      
    </Layout>
  );
};

export default ManageCategories;
