import React, { useMemo, useState } from 'react';
import { Button, Select, Input, Table, Tag, Progress, Space, Typography, message } from 'antd';
import { TableOutlined, PartitionOutlined, KeyOutlined, DownloadOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

const { Text } = Typography;

const sqlEsc = (s: string) => s.replace(/'/g, "''");

export interface FtlExecResult { success: boolean; rows?: Record<string, unknown>[]; error?: string }
export type FtlExec = (sql: string, rowLimit: number) => Promise<FtlExecResult>;

interface Props {
  owners: string[];
  defaultOwner: string;
  exec?: FtlExec;                                   // undefined ⇒ not desktop / no runner
  cacheRead: (key: string) => Promise<unknown>;
  cacheWrite: (key: string, value: unknown) => void;
}

const PAGE = 5000;
const MAX_PAGES = 60;                               // 300k row ceiling

type Loader = 'tables' | 'indexes' | 'fks';
interface Prog { running: boolean; loaded: number; done: boolean }
const IDLE: Prog = { running: false, loaded: 0, done: false };

const val = (r: Record<string, unknown>, ...keys: string[]) => {
  for (const k of keys) { if (r[k] != null) return String(r[k]); }
  return '';
};

const FusionTablesList: React.FC<Props> = ({ owners, defaultOwner, exec, cacheRead, cacheWrite }) => {
  const [owner, setOwner] = useState(defaultOwner || 'FUSION');
  const [tables, setTables] = useState<string[]>([]);
  const [indexes, setIndexes] = useState<Record<string, unknown>[]>([]);
  const [fks, setFks] = useState<Record<string, unknown>[]>([]);
  const [prog, setProg] = useState<Record<Loader, Prog>>({ tables: IDLE, indexes: IDLE, fks: IDLE });
  const [q, setQ] = useState('');

  const setP = (l: Loader, p: Partial<Prog>) => setProg(prev => ({ ...prev, [l]: { ...prev[l], ...p } }));

  // generic paged pull over an ordered inner query
  const pull = async (
    loader: Loader,
    inner: string,
    onRows: (rows: Record<string, unknown>[]) => void,
  ) => {
    if (!exec) { message.warning('The desktop app is required to load from the pod.'); return; }
    setP(loader, { running: true, loaded: 0, done: false });
    const all: Record<string, unknown>[] = [];
    try {
      for (let p = 0; p < MAX_PAGES; p++) {
        const from = p * PAGE + 1;
        const to = from + PAGE - 1;
        const sql = `SELECT * FROM (${inner}) WHERE rn BETWEEN ${from} AND ${to}`;
        const r = await exec(sql, PAGE);
        if (!r.success) { message.error(r.error || 'Load failed'); break; }
        const rows = r.rows || [];
        all.push(...rows);
        onRows([...all]);
        setP(loader, { loaded: all.length });
        if (rows.length < PAGE) break;
      }
      setP(loader, { done: true });
      message.success(`Loaded ${all.length.toLocaleString()} ${loader === 'fks' ? 'foreign keys' : loader}`);
    } finally {
      setP(loader, { running: false });
    }
  };

  const loadTables = () => pull(
    'tables',
    `SELECT object_name, ROW_NUMBER() OVER (ORDER BY object_name) rn ` +
    `FROM all_objects WHERE owner='${sqlEsc(owner)}' AND object_type='TABLE'`,
    rows => { const names = rows.map(r => val(r, 'OBJECT_NAME', 'object_name')).filter(Boolean); setTables(names); cacheWrite(`schema.${owner}.TABLE`, { at: Date.now(), names, capped: false }); },
  );

  const loadIndexes = () => pull(
    'indexes',
    `SELECT i.table_name, i.index_name, i.uniqueness, ` +
    `LISTAGG(c.column_name, ', ') WITHIN GROUP (ORDER BY c.column_position) AS columns, ` +
    `ROW_NUMBER() OVER (ORDER BY i.table_name, i.index_name) rn ` +
    `FROM all_indexes i JOIN all_ind_columns c ON c.index_owner=i.owner AND c.index_name=i.index_name ` +
    `WHERE i.table_owner='${sqlEsc(owner)}' ` +
    `GROUP BY i.table_name, i.index_name, i.uniqueness`,
    rows => { setIndexes(rows); cacheWrite(`bulk.idx.${owner}`, rows); },
  );

  const loadFks = () => pull(
    'fks',
    `SELECT ac.table_name, ac.constraint_name AS fk_name, ` +
    `LISTAGG(cc.column_name, ', ') WITHIN GROUP (ORDER BY cc.position) AS fk_columns, ` +
    `MAX(rc.table_name) AS ref_table, ` +
    `ROW_NUMBER() OVER (ORDER BY ac.table_name, ac.constraint_name) rn ` +
    `FROM all_constraints ac JOIN all_cons_columns cc ON cc.owner=ac.owner AND cc.constraint_name=ac.constraint_name ` +
    `LEFT JOIN all_constraints rc ON rc.owner=ac.r_owner AND rc.constraint_name=ac.r_constraint_name ` +
    `WHERE ac.owner='${sqlEsc(owner)}' AND ac.constraint_type='R' ` +
    `GROUP BY ac.table_name, ac.constraint_name`,
    rows => { setFks(rows); cacheWrite(`bulk.fk.${owner}`, rows); },
  );

  // load cached copies when the owner changes
  React.useEffect(() => {
    let alive = true;
    (async () => {
      const t = await cacheRead(`schema.${owner}.TABLE`) as { names?: string[] } | null;
      const ix = await cacheRead(`bulk.idx.${owner}`) as Record<string, unknown>[] | null;
      const fk = await cacheRead(`bulk.fk.${owner}`) as Record<string, unknown>[] | null;
      if (!alive) return;
      setTables(Array.isArray(t?.names) ? t!.names! : []);
      setIndexes(Array.isArray(ix) ? ix : []);
      setFks(Array.isArray(fk) ? fk : []);
      setProg({ tables: IDLE, indexes: IDLE, fks: IDLE });
    })();
    return () => { alive = false; };
  }, [owner, cacheRead]);

  const qUpper = q.trim().toUpperCase();
  const tableRows = useMemo(
    () => (qUpper ? tables.filter(t => t.toUpperCase().includes(qUpper)) : tables).map((t, i) => ({ key: i, name: t })),
    [tables, qUpper],
  );
  const idxRows = useMemo(
    () => (qUpper ? indexes.filter(r => JSON.stringify(r).toUpperCase().includes(qUpper)) : indexes).map((r, i) => ({ ...r, key: i })),
    [indexes, qUpper],
  );
  const fkRows = useMemo(
    () => (qUpper ? fks.filter(r => JSON.stringify(r).toUpperCase().includes(qUpper)) : fks).map((r, i) => ({ ...r, key: i })),
    [fks, qUpper],
  );

  const idxCols: ColumnsType<Record<string, unknown>> = [
    { title: 'Table', dataIndex: 'TABLE_NAME', render: (_: unknown, r) => val(r, 'TABLE_NAME', 'table_name'), width: 260, ellipsis: true },
    { title: 'Index', dataIndex: 'INDEX_NAME', render: (_: unknown, r) => val(r, 'INDEX_NAME', 'index_name'), width: 260, ellipsis: true },
    { title: 'Unique', width: 80, align: 'center', render: (_: unknown, r) => val(r, 'UNIQUENESS', 'uniqueness') === 'UNIQUE' ? <Tag color="green">Yes</Tag> : <Text type="secondary">—</Text> },
    { title: 'Columns', render: (_: unknown, r) => <Text style={{ fontSize: 12 }}>{val(r, 'COLUMNS', 'columns')}</Text> },
  ];
  const fkCols: ColumnsType<Record<string, unknown>> = [
    { title: 'Table', render: (_: unknown, r) => val(r, 'TABLE_NAME', 'table_name'), width: 240, ellipsis: true },
    { title: 'FK', render: (_: unknown, r) => val(r, 'FK_NAME', 'fk_name'), width: 240, ellipsis: true },
    { title: 'Columns', render: (_: unknown, r) => val(r, 'FK_COLUMNS', 'fk_columns'), width: 220, ellipsis: true },
    { title: 'References', render: (_: unknown, r) => <Text style={{ fontSize: 12 }}>→ {val(r, 'REF_TABLE', 'ref_table')}</Text> },
  ];

  const loadBtn = (loader: Loader, label: string, icon: React.ReactNode, onClick: () => void, count: number) => {
    const p = prog[loader];
    return (
      <Space direction="vertical" size={2} style={{ minWidth: 220 }}>
        <Space>
          <Button type="primary" icon={icon} loading={p.running} onClick={onClick} disabled={!exec}
            style={{ background: '#1D7B4D', borderColor: '#1D7B4D' }}>
            {p.running ? `Loading… ${p.loaded.toLocaleString()}` : label}
          </Button>
          <Tag>{count.toLocaleString()} cached</Tag>
        </Space>
        {p.running && <Progress percent={100} status="active" showInfo={false} strokeColor="#1D7B4D" size="small" />}
      </Space>
    );
  };

  return (
    <div style={{ padding: 12, height: '100%', overflow: 'auto' }}>
      <Space wrap style={{ marginBottom: 12 }} align="center">
        <Text strong>Schema (owner)</Text>
        <Select size="small" showSearch value={owner} onChange={setOwner} style={{ width: 220 }}
          options={owners.map(o => ({ value: o, label: o }))} optionFilterProp="label" />
        <Input size="small" allowClear placeholder="Filter tables / indexes / FKs" style={{ width: 260 }}
          value={q} onChange={e => setQ(e.target.value)} />
        {!exec && <Tag color="orange">Desktop app required</Tag>}
      </Space>

      <Space wrap size="large" style={{ marginBottom: 16 }}>
        {loadBtn('tables', 'Load Tables', <TableOutlined />, loadTables, tables.length)}
        {loadBtn('indexes', 'Load Indexes', <PartitionOutlined />, loadIndexes, indexes.length)}
        {loadBtn('fks', 'Load Foreign Keys', <KeyOutlined />, loadFks, fks.length)}
      </Space>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 16 }}>
        <div>
          <Text strong><TableOutlined /> Tables ({tableRows.length.toLocaleString()}{qUpper ? ` of ${tables.length.toLocaleString()}` : ''})</Text>
          <Table size="small" style={{ marginTop: 6 }} dataSource={tableRows} pagination={{ pageSize: 15, showSizeChanger: true }}
            columns={[{ title: 'Table name', dataIndex: 'name' }]} />
        </div>
        <div>
          <Text strong><PartitionOutlined /> Indexes ({idxRows.length.toLocaleString()})</Text>
          <Table size="small" style={{ marginTop: 6 }} dataSource={idxRows} columns={idxCols}
            scroll={{ x: 'max-content' }} pagination={{ pageSize: 15, showSizeChanger: true }} />
        </div>
        <div>
          <Text strong><KeyOutlined /> Foreign Keys ({fkRows.length.toLocaleString()})</Text>
          <Table size="small" style={{ marginTop: 6 }} dataSource={fkRows} columns={fkCols}
            scroll={{ x: 'max-content' }} pagination={{ pageSize: 15, showSizeChanger: true }}
            locale={{ emptyText: 'No foreign keys loaded (Fusion often has none enforced at DB level)' }} />
        </div>
      </div>

      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 12 }}>
        <DownloadOutlined /> Each Load pages the pod in 5,000-row windows and caches to the local schema file, so the
        Schema browser and these lists load instantly next time. Re-click Load to refresh from the pod.
      </Text>
    </div>
  );
};

export default FusionTablesList;
