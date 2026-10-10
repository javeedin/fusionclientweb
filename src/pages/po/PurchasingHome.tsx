// Purchasing-RR — module home: KPIs, worklist and navigation.
import React, { useEffect, useState } from 'react';
import { Card, Row as GridRow, Col, Typography, Spin, Alert, List, Tag, Button, Space } from 'antd';
import {
  ShoppingCartOutlined, FileTextOutlined, ThunderboltOutlined, InboxOutlined, CalculatorOutlined, AuditOutlined,
  BarChartOutlined, SettingOutlined, PlusOutlined, ClockCircleOutlined, WarningOutlined, DollarOutlined,
  FileProtectOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { poQuery, nlit, lit, money, day, Row } from '../../services/po.service';
import { PoBar, BuNotSetUp, StatusTag, useBusinessUnits, usePoUser, PO_RED } from './poShared';

const { Text } = Typography;

const TILES = [
  { label: 'Requisitions', path: '/po/requisitions', icon: <FileTextOutlined />, desc: 'Request goods & services' },
  { label: 'Buyer Workbench', path: '/po/buyer-workbench', icon: <ThunderboltOutlined />, desc: 'Approved demand → PO' },
  { label: 'Purchase Orders', path: '/po/orders', icon: <ShoppingCartOutlined />, desc: 'Direct & requisition POs' },
  { label: 'Receiving', path: '/po/receiving', icon: <InboxOutlined />, desc: 'Receipts · returns · corrections' },
  { label: 'Accounting & Accruals', path: '/po/accruals', icon: <CalculatorOutlined />, desc: 'GRNI · period-end · write-off' },
  { label: 'Approvals', path: '/po/approvals', icon: <AuditOutlined />, desc: 'Requisitions · POs · changes' },
  { label: 'Reports', path: '/po/reports', icon: <BarChartOutlined />, desc: 'Spend · backlog · overdue' },
  { label: 'Terms & Conditions', path: '/po/terms', icon: <FileProtectOutlined />, desc: 'Clauses printed on POs' },
  { label: 'Setup', path: '/po/setup', icon: <SettingOutlined />, desc: 'Options · categories · buyers' },
];

const PurchasingHome: React.FC = () => {
  const buState = useBusinessUnits();
  const user = usePoUser();
  const navigate = useNavigate();
  const [k, setK] = useState<Row | null>(null);
  const [mine, setMine] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fc = buState.current?.FUNCTIONAL_CURRENCY || '';

  useEffect(() => {
    if (!buState.bu) return;
    const b = nlit(buState.bu);
    setLoading(true); setErr(null);
    Promise.all([
      poQuery(`SELECT
        (SELECT NVL(SUM(AMOUNT_TO_RECEIVE * RATE), 0) FROM RR_PO_V_ORDERS WHERE BUSINESS_UNIT_ID = ${b} AND DOCUMENT_STATUS = 'APPROVED'
           AND CLOSURE_STATUS IN ('OPEN','CLOSED_FOR_INVOICING')) AS OPEN_VALUE,
        (SELECT COUNT(*) FROM RR_PO_V_ORDERS WHERE BUSINESS_UNIT_ID = ${b} AND DOCUMENT_STATUS = 'APPROVED'
           AND CLOSURE_STATUS IN ('OPEN','CLOSED_FOR_INVOICING')) AS OPEN_POS,
        (SELECT COUNT(*) FROM RR_PO_V_ORDERS WHERE BUSINESS_UNIT_ID = ${b} AND DOCUMENT_STATUS IN ('INCOMPLETE','REJECTED')) AS DRAFT_POS,
        (SELECT COUNT(*) FROM RR_PO_V_REQ_LINES WHERE BUSINESS_UNIT_ID = ${b} AND REQ_STATUS = 'APPROVED' AND LINE_STATUS = 'OPEN') AS DEMAND,
        (SELECT COUNT(*) FROM RR_PO_V_OPEN_SCHEDULES WHERE BUSINESS_UNIT_ID = ${b} AND NEED_BY_DATE < TRUNC(SYSDATE)
           AND NVL(QUANTITY_REMAINING, AMOUNT_REMAINING) > 0) AS OVERDUE,
        (SELECT COUNT(*) FROM RR_PO_V_APPROVALS WHERE STATUS = 'PENDING') AS PENDING_APPROVALS,
        (SELECT NVL(SUM(ACCRUED_AMOUNT_FUNC), 0) FROM RR_PO_V_UNINVOICED WHERE BUSINESS_UNIT_ID = ${b}) AS GRNI,
        (SELECT COUNT(DISTINCT RCV_TRANSACTION_ID) FROM RR_PO_V_RCV_ACCOUNTING WHERE BUSINESS_UNIT_ID = ${b}
           AND ACCOUNTING_STATUS = 'UNACCOUNTED') AS UNACCOUNTED,
        (SELECT NVL(SUM(AMOUNT_FUNC), 0) FROM RR_PO_V_SPEND WHERE BUSINESS_UNIT_ID = ${b} AND SPEND_MONTH = TRUNC(SYSDATE, 'MM')) AS SPEND_MTD
        FROM dual`),
      poQuery(`SELECT 'REQ' AS KIND, REQ_HEADER_ID AS ID, REQ_NUMBER AS DOC, DESCRIPTION, STATUS, TOTAL_AMOUNT_FUNC AS AMOUNT, CREATION_DATE
               FROM RR_PO_V_REQUISITIONS WHERE BUSINESS_UNIT_ID = ${b} AND UPPER(PREPARER_USER) = UPPER(${lit(user)})
                 AND STATUS IN ('INCOMPLETE','REJECTED','PENDING_APPROVAL')
               UNION ALL
               SELECT 'PO', PO_HEADER_ID, PO_NUMBER, NVL(DESCRIPTION, SUPPLIER_NAME), DOCUMENT_STATUS, TOTAL_AMOUNT, CREATION_DATE
               FROM RR_PO_V_ORDERS WHERE BUSINESS_UNIT_ID = ${b} AND UPPER(BUYER_USER) = UPPER(${lit(user)})
                 AND DOCUMENT_STATUS IN ('INCOMPLETE','REJECTED','PENDING_APPROVAL')
               ORDER BY CREATION_DATE DESC`, 50),
    ])
      .then(([[kpi], my]) => { setK(kpi); setMine(my); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [buState.bu, user]);

  const kpis = k ? [
    { label: 'Open PO value', value: `${money(k.OPEN_VALUE, 0)} ${fc}`, sub: `${k.OPEN_POS} open orders`, icon: <ShoppingCartOutlined />, path: '/po/orders' },
    { label: 'Demand waiting', value: String(k.DEMAND), sub: 'approved req lines', icon: <ThunderboltOutlined />, path: '/po/buyer-workbench' },
    { label: 'Pending approvals', value: String(k.PENDING_APPROVALS), sub: 'purchasing documents', icon: <AuditOutlined />, path: '/po/approvals' },
    { label: 'Overdue receipts', value: String(k.OVERDUE), sub: 'past need-by date', icon: <ClockCircleOutlined />, path: '/po/reports', warn: Number(k.OVERDUE) > 0 },
    { label: 'GRNI balance', value: `${money(k.GRNI, 0)} ${fc}`, sub: `${k.UNACCOUNTED} receipt txn(s) to account`, icon: <CalculatorOutlined />, path: '/po/accruals', warn: Number(k.UNACCOUNTED) > 0 },
    { label: 'Spend this month', value: `${money(k.SPEND_MTD, 0)} ${fc}`, sub: `${k.DRAFT_POS} draft PO(s)`, icon: <DollarOutlined />, path: '/po/reports' },
  ] : [];

  return (
    <div style={{ padding: 20 }}>
      <PoBar title="Purchasing" subtitle="Procure-to-receipt for expense purchases" buState={buState}
        extra={<Space>
          <Button icon={<PlusOutlined />} onClick={() => navigate('/po/requisitions?id=new')}>Requisition</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/po/orders?id=new')}>Purchase order</Button>
        </Space>} />
      <BuNotSetUp current={buState.current} />
      {err && <Alert type="error" showIcon style={{ marginBottom: 12 }} message="Purchasing data could not be read"
        description={<span>{err}<br />Run database/po/300 → 301 → 302 → 303 on the database first.</span>} />}

      <Spin spinning={loading}>
        <GridRow gutter={[12, 12]} style={{ marginBottom: 16 }}>
          {kpis.map(x => (
            <Col key={x.label} xs={24} sm={12} lg={8} xxl={4}>
              <Card hoverable size="small" onClick={() => navigate(x.path)} style={{ borderRadius: 10, height: '100%' }}>
                <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
                  <div>
                    <Text type="secondary" style={{ fontSize: 11, textTransform: 'uppercase', fontWeight: 600 }}>{x.label}</Text>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{x.value}</div>
                    <Text type={x.warn ? 'warning' : 'secondary'} style={{ fontSize: 11 }}>{x.warn && <WarningOutlined />} {x.sub}</Text>
                  </div>
                  <div style={{ fontSize: 20, color: PO_RED }}>{x.icon}</div>
                </Space>
              </Card>
            </Col>
          ))}
        </GridRow>
      </Spin>

      <GridRow gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <GridRow gutter={[12, 12]}>
            {TILES.map(t => (
              <Col key={t.path} xs={12} md={8} xl={6}>
                <Card hoverable size="small" onClick={() => navigate(t.path)} style={{ borderRadius: 10, height: '100%' }}>
                  <div style={{ fontSize: 22, color: PO_RED }}>{t.icon}</div>
                  <div style={{ fontWeight: 600 }}>{t.label}</div>
                  <Text type="secondary" style={{ fontSize: 11 }}>{t.desc}</Text>
                </Card>
              </Col>
            ))}
          </GridRow>
        </Col>
        <Col xs={24} lg={10}>
          <Card size="small" title="My open documents" style={{ borderRadius: 10 }}>
            <List size="small" dataSource={mine} locale={{ emptyText: 'Nothing waiting on you' }}
              renderItem={r => (
                <List.Item style={{ cursor: 'pointer' }}
                  onClick={() => navigate(r.KIND === 'REQ' ? `/po/requisitions?id=${r.ID}` : `/po/orders?id=${r.ID}`)}
                  extra={<StatusTag s={r.STATUS} />}>
                  <List.Item.Meta
                    title={<Space size={6}><Tag>{r.KIND}</Tag>{r.DOC}</Space>}
                    description={<Text type="secondary" style={{ fontSize: 12 }}>{r.DESCRIPTION} · {money(r.AMOUNT)} · {day(r.CREATION_DATE)}</Text>} />
                </List.Item>
              )} />
          </Card>
        </Col>
      </GridRow>
    </div>
  );
};

export default PurchasingHome;
