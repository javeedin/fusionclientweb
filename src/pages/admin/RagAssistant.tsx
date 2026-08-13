import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Layout, Breadcrumb, Typography, Button, Input, Space, Tag, Tooltip,
  Upload, List, Popconfirm, message, Spin, Empty, Modal, Table,
} from 'antd';
import {
  HomeOutlined, RobotOutlined, SendOutlined, UploadOutlined, DeleteOutlined,
  FileTextOutlined, FilePdfOutlined, FileWordOutlined, ReloadOutlined,
  DatabaseOutlined, BookOutlined, ThunderboltOutlined, ClearOutlined,
  ApiOutlined, DownloadOutlined, FullscreenOutlined, BarChartOutlined,
  FileExcelOutlined,
} from '@ant-design/icons';
import {
  BarChart, Bar, PieChart, Pie, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend,
  ResponsiveContainer, Cell,
} from 'recharts';
import { Link } from 'react-router-dom';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import dayjs from 'dayjs';

const { Content } = Layout;
const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

const PURPLE = '#722ed1';
const REDWOOD = { primary:'#C74634', success:'#1D7B4D', warning:'#D4A800', info:'#0572CE', neutral100:'#F7F7F7', neutral200:'#E5E5E5', neutral600:'#6B6B6B', neutral900:'#1A1A1A', surface:'#FFFFFF' };
const CHART_COLORS = ['#722ed1','#0572CE','#1D7B4D','#D4A800','#C74634','#08979c','#d46b08','#c41d7f','#1d39c4','#389e0d'];

// ── Types ──────────────────────────────────────────────────────────────────────
interface RagDoc { id:number; name:string; type:string; size_bytes:number; chunk_count:number; created_at:string; }
type QueryMode = 'auto'|'docs'|'erp';
interface StatItem { label:string; value:string; color?:string; }
interface TableSection { type:'table'; title:string; columns:string[]; rows:any[][]; }
interface ChartSection { type:'chart'; chartType:'bar'|'pie'|'line'; title:string; xKey?:string; data:Record<string,any>[]; }
type ReportSection = TableSection | ChartSection;
interface ReportData { title:string; summary:string; stats?:StatItem[]; sections:ReportSection[]; }
interface ChatMessage {
  id:string; role:'user'|'assistant'; content:string;
  msgType?:'text'|'docs'|'erp_data'|'report'|'error';
  report?:ReportData; sources?:string[];
  apiUrl?:string; apiDesc?:string; recordCount?:number; rawData?:any[];
  ts:number;
}

const uid = () => Math.random().toString(36).slice(2);
const fmtBytes = (b:number) => b>1048576?`${(b/1048576).toFixed(1)} MB`:`${Math.round(b/1024)} KB`;
const fileIcon = (n:string) => { const e=n.split('.').pop()?.toLowerCase(); if(e==='pdf') return <FilePdfOutlined style={{color:'#e53e3e'}}/>; if(e==='docx'||e==='doc') return <FileWordOutlined style={{color:'#2b6cb0'}}/>; return <FileTextOutlined style={{color:REDWOOD.neutral600}}/>; };

const colorMap: Record<string,string> = { green:REDWOOD.success, red:REDWOOD.primary, blue:REDWOOD.info, orange:REDWOOD.warning };

// ── Stat cards ─────────────────────────────────────────────────────────────────
const StatCards:React.FC<{stats:StatItem[]}> = ({stats}) => (
  <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:12}}>
    {stats.map((s,i)=>(
      <div key={i} style={{flex:'1 1 140px',padding:'10px 14px',borderRadius:8,background:REDWOOD.surface,border:`1px solid ${REDWOOD.neutral200}`,borderLeft:`4px solid ${colorMap[s.color??'blue']??REDWOOD.info}`}}>
        <div style={{fontSize:11,color:REDWOOD.neutral600,marginBottom:2}}>{s.label}</div>
        <div style={{fontSize:16,fontWeight:700,color:colorMap[s.color??'blue']??REDWOOD.info}}>{s.value}</div>
      </div>
    ))}
  </div>
);

// ── Chart block ────────────────────────────────────────────────────────────────
const ChartBlock:React.FC<{sec:ChartSection; onFullscreen:()=>void}> = ({sec, onFullscreen}) => {
  const h = 240;
  const chart = sec.chartType==='pie' ? (
    <PieChart><Pie data={sec.data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({name,percent})=>`${name} ${((percent??0)*100).toFixed(0)}%`}>
      {sec.data.map((_,i)=><Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]}/>)}
    </Pie><RTooltip/><Legend/></PieChart>
  ) : sec.chartType==='line' ? (
    <LineChart data={sec.data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey={sec.xKey||'name'} tick={{fontSize:11}}/><YAxis tick={{fontSize:11}}/><RTooltip/><Legend/>
      {Object.keys(sec.data[0]??{}).filter(k=>k!==sec.xKey&&k!=='name').map((k,i)=><Line key={k} type="monotone" dataKey={k} stroke={CHART_COLORS[i%CHART_COLORS.length]} dot={false} strokeWidth={2}/>)}
    </LineChart>
  ) : (
    <BarChart data={sec.data}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey={sec.xKey||'name'} tick={{fontSize:11}}/><YAxis tick={{fontSize:11}}/><RTooltip/><Legend/>
      {Object.keys(sec.data[0]??{}).filter(k=>k!==sec.xKey&&k!=='name').map((k,i)=><Bar key={k} dataKey={k} fill={CHART_COLORS[i%CHART_COLORS.length]} radius={[3,3,0,0]}/>)}
    </BarChart>
  );

  return (
    <div style={{marginBottom:12,background:REDWOOD.surface,border:`1px solid ${REDWOOD.neutral200}`,borderRadius:8,overflow:'hidden'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',borderBottom:`1px solid ${REDWOOD.neutral200}`}}>
        <Text strong style={{fontSize:13}}><BarChartOutlined style={{marginRight:6,color:PURPLE}}/>{sec.title}</Text>
        <Tooltip title="Fullscreen"><Button type="text" size="small" icon={<FullscreenOutlined/>} onClick={onFullscreen}/></Tooltip>
      </div>
      <div style={{padding:'8px 4px'}}>
        <ResponsiveContainer width="100%" height={h}>{chart}</ResponsiveContainer>
      </div>
    </div>
  );
};

// ── Table block ────────────────────────────────────────────────────────────────
const TableBlock:React.FC<{sec:TableSection; onExcelExport:()=>void}> = ({sec, onExcelExport}) => (
  <div style={{marginBottom:12,background:REDWOOD.surface,border:`1px solid ${REDWOOD.neutral200}`,borderRadius:8,overflow:'hidden'}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 12px',borderBottom:`1px solid ${REDWOOD.neutral200}`}}>
      <Text strong style={{fontSize:13}}>{sec.title}</Text>
      <Tooltip title="Export to Excel">
        <Button type="text" size="small" icon={<FileExcelOutlined style={{color:REDWOOD.success}}/>} onClick={onExcelExport}/>
      </Tooltip>
    </div>
    <div style={{overflowX:'auto'}}>
      <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
        <thead>
          <tr style={{background:REDWOOD.neutral100}}>
            {sec.columns.map((c,i)=><th key={i} style={{padding:'6px 10px',textAlign:'left',borderBottom:`1px solid ${REDWOOD.neutral200}`,fontWeight:600,whiteSpace:'nowrap'}}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {sec.rows.map((row,ri)=>(
            <tr key={ri} style={{background:ri%2===0?REDWOOD.surface:REDWOOD.neutral100}}>
              {row.map((cell,ci)=><td key={ci} style={{padding:'5px 10px',borderBottom:`1px solid ${REDWOOD.neutral200}`,whiteSpace:'nowrap'}}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

// ── PDF export ─────────────────────────────────────────────────────────────────
function exportReportPdf(report: ReportData) {
  try {
    const doc = new jsPDF({ orientation:'portrait', unit:'mm', format:'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    let y = 15;

    // Header bar
    doc.setFillColor(114, 46, 209);
    doc.rect(0, 0, pageW, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14); doc.setFont('helvetica', 'bold');
    doc.text(report.title, 14, 14);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal');
    doc.text(`Generated: ${dayjs().format('D MMM YYYY HH:mm')}`, pageW - 14, 14, { align: 'right' });
    y = 30;

    // Summary
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    const sumLines = doc.splitTextToSize(report.summary, pageW - 28);
    doc.text(sumLines, 14, y);
    y += sumLines.length * 5 + 8;

    // KPI stat boxes
    if (report.stats?.length) {
      const cols = Math.min(report.stats.length, 4);
      const w = (pageW - 28) / cols;
      report.stats.forEach((s, i) => {
        const x = 14 + (i % cols) * w;
        if (i % cols === 0 && i > 0) y += 18;
        doc.setFillColor(248, 240, 255);
        doc.roundedRect(x, y, w - 3, 15, 2, 2, 'F');
        doc.setFontSize(8); doc.setTextColor(100, 100, 100);
        doc.text(s.label, x + 4, y + 5);
        doc.setFontSize(11); doc.setFont('helvetica', 'bold');
        const col = s.color === 'green' ? [29,123,77] : s.color === 'red' ? [199,70,52] : s.color === 'orange' ? [212,168,0] : [5,114,206];
        doc.setTextColor(col[0] as number, col[1] as number, col[2] as number);
        doc.text(String(s.value), x + 4, y + 12);
        doc.setFont('helvetica', 'normal'); doc.setTextColor(30, 30, 30);
      });
      y += 24;
    }

    // Table sections
    for (const sec of report.sections) {
      if (sec.type === 'table' && sec.columns?.length && sec.rows?.length) {
        if (y > 250) { doc.addPage(); y = 15; }
        doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 30, 30);
        doc.text(sec.title, 14, y); y += 5;
        autoTable(doc, {
          startY: y,
          head: [sec.columns],
          body: sec.rows.map(row => row.map(cell => String(cell ?? ''))),
          theme: 'grid',
          headStyles: { fillColor: [114, 46, 209], textColor: 255, fontSize: 9, fontStyle: 'bold' },
          bodyStyles: { fontSize: 8 },
          alternateRowStyles: { fillColor: [249, 240, 255] },
          margin: { left: 14, right: 14 },
        });
        y = (doc as any).lastAutoTable?.finalY + 10 || y + 20;
      }
    }

    // Save via blob so it works in both Electron and browser
    const blob = doc.output('blob');
    saveAs(blob, `${report.title.replace(/[^a-z0-9]/gi, '_')}_${dayjs().format('YYYYMMDD')}.pdf`);
  } catch (err) {
    console.error('PDF export error:', err);
    message.error('PDF export failed: ' + (err as any)?.message);
  }
}

function exportTableExcel(sec: TableSection) {
  const ws = XLSX.utils.aoa_to_sheet([sec.columns, ...sec.rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sec.title.slice(0,31));
  const buf = XLSX.write(wb,{bookType:'xlsx',type:'array'});
  saveAs(new Blob([buf],{type:'application/octet-stream'}),`${sec.title.replace(/\s+/g,'_')}.xlsx`);
}

// ── Report message ─────────────────────────────────────────────────────────────
const ReportMessage:React.FC<{report:ReportData; apiUrl?:string; recordCount?:number}> = ({report, apiUrl, recordCount}) => {
  const [fsChart, setFsChart] = useState<ChartSection|null>(null);

  return (
    <div style={{background:REDWOOD.surface,border:`1px solid ${REDWOOD.neutral200}`,borderRadius:12,overflow:'hidden',marginBottom:4}}>
      {/* Report header */}
      <div style={{background:`linear-gradient(135deg,${PURPLE} 0%,#531dab 100%)`,padding:'12px 16px',display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
        <div>
          <Text strong style={{color:'#fff',fontSize:14}}>{report.title}</Text>
          <div style={{fontSize:11,color:'rgba(255,255,255,0.7)',marginTop:2}}>{dayjs().format('D MMM YYYY HH:mm')}</div>
        </div>
        <Space size={6}>
          {apiUrl && <Tooltip title={apiUrl}><Tag color="blue" style={{fontSize:10,cursor:'pointer'}} icon={<ApiOutlined/>}>{recordCount} records</Tag></Tooltip>}
          <Tooltip title="Download PDF">
            <Button size="small" icon={<DownloadOutlined/>} onClick={()=>exportReportPdf(report)}
              style={{background:'rgba(255,255,255,0.2)',border:'none',color:'#fff',fontSize:11}}>
              PDF
            </Button>
          </Tooltip>
        </Space>
      </div>

      <div style={{padding:'12px 14px'}}>
        {/* Summary */}
        <Paragraph style={{fontSize:13,color:REDWOOD.neutral900,marginBottom:12}}>{report.summary}</Paragraph>

        {/* KPI stats */}
        {report.stats && report.stats.length>0 && <StatCards stats={report.stats}/>}

        {/* Sections */}
        {report.sections?.map((sec,i)=>{
          if(sec.type==='chart') return (
            <ChartBlock key={i} sec={sec} onFullscreen={()=>setFsChart(sec)}/>
          );
          if(sec.type==='table') return (
            <TableBlock key={i} sec={sec} onExcelExport={()=>exportTableExcel(sec)}/>
          );
          return null;
        })}
      </div>

      {/* Fullscreen chart modal */}
      <Modal open={!!fsChart} onCancel={()=>setFsChart(null)} footer={null} width="90vw"
        title={<Space><BarChartOutlined style={{color:PURPLE}}/>{fsChart?.title}</Space>}>
        {fsChart && (
          <ResponsiveContainer width="100%" height={420}>
            {fsChart.chartType==='pie'
              ? <PieChart><Pie data={fsChart.data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={160} label={({name,percent})=>`${name} ${((percent??0)*100).toFixed(1)}%`}>{fsChart.data.map((_,i)=><Cell key={i} fill={CHART_COLORS[i%CHART_COLORS.length]}/>)}</Pie><RTooltip/><Legend/></PieChart>
              : fsChart.chartType==='line'
              ? <LineChart data={fsChart.data}><CartesianGrid/><XAxis dataKey={fsChart.xKey||'name'}/><YAxis/><RTooltip/><Legend/>{Object.keys(fsChart.data[0]??{}).filter(k=>k!==fsChart.xKey&&k!=='name').map((k,i)=><Line key={k} dataKey={k} stroke={CHART_COLORS[i%CHART_COLORS.length]} strokeWidth={2} dot={false}/>)}</LineChart>
              : <BarChart data={fsChart.data}><CartesianGrid/><XAxis dataKey={fsChart.xKey||'name'}/><YAxis/><RTooltip/><Legend/>{Object.keys(fsChart.data[0]??{}).filter(k=>k!==fsChart.xKey&&k!=='name').map((k,i)=><Bar key={k} dataKey={k} fill={CHART_COLORS[i%CHART_COLORS.length]} radius={[4,4,0,0]}/>)}</BarChart>
            }
          </ResponsiveContainer>
        )}
      </Modal>
    </div>
  );
};

// ── Plain message bubble ───────────────────────────────────────────────────────
const MsgBubble:React.FC<{msg:ChatMessage}> = ({msg}) => {
  const isUser = msg.role==='user';
  const [showRaw, setShowRaw] = useState(false);

  if (!isUser && msg.msgType==='report' && msg.report) {
    return (
      <div style={{display:'flex',gap:8,marginBottom:14,alignItems:'flex-start'}}>
        <div style={{width:32,height:32,borderRadius:'50%',flexShrink:0,background:`linear-gradient(135deg,${PURPLE} 0%,#531dab 100%)`,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <RobotOutlined style={{color:'#fff',fontSize:15}}/>
        </div>
        <div style={{flex:1,maxWidth:'95%'}}>
          <ReportMessage report={msg.report} apiUrl={msg.apiUrl} recordCount={msg.recordCount}/>
          <div style={{fontSize:10,color:'#bbb',marginTop:3}}>{dayjs(msg.ts).format('HH:mm')}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{display:'flex',justifyContent:isUser?'flex-end':'flex-start',marginBottom:12,alignItems:'flex-start',gap:8}}>
      {!isUser && <div style={{width:32,height:32,borderRadius:'50%',flexShrink:0,background:`linear-gradient(135deg,${PURPLE} 0%,#531dab 100%)`,display:'flex',alignItems:'center',justifyContent:'center'}}><RobotOutlined style={{color:'#fff',fontSize:15}}/></div>}
      <div style={{maxWidth:'80%'}}>
        <div style={{padding:'10px 14px',borderRadius:isUser?'18px 18px 4px 18px':'18px 18px 18px 4px',background:isUser?PURPLE:msg.msgType==='error'?'#fff2f0':REDWOOD.surface,color:isUser?'#fff':REDWOOD.neutral900,border:!isUser?`1px solid ${msg.msgType==='error'?'#ffccc7':REDWOOD.neutral200}`:'none',fontSize:13,lineHeight:1.6,whiteSpace:'pre-wrap',wordBreak:'break-word'}}>
          {msg.content}
        </div>
        {/* ERP data quick view */}
        {msg.msgType==='erp_data' && msg.apiDesc && (
          <div style={{marginTop:5,display:'flex',gap:5,flexWrap:'wrap'}}>
            <Tag icon={<DatabaseOutlined/>} color="blue" style={{fontSize:11}}>{msg.recordCount} records</Tag>
            <Tag icon={<ApiOutlined/>} color="geekblue" style={{fontSize:11,cursor:'pointer'}} onClick={()=>setShowRaw(v=>!v)}>{msg.apiDesc}</Tag>
          </div>
        )}
        {showRaw && msg.rawData && (
          <pre style={{marginTop:6,padding:'8px 12px',background:'#1e1e2e',color:'#cdd6f4',borderRadius:6,fontSize:11,overflowX:'auto',maxHeight:200}}>
            {JSON.stringify(msg.rawData.slice(0,8),null,2)}{msg.rawData.length>8?`\n…+${msg.rawData.length-8} more`:''}
          </pre>
        )}
        {msg.sources && msg.sources.length>0 && (
          <div style={{marginTop:5,display:'flex',gap:4,flexWrap:'wrap'}}>
            {msg.sources.map(s=><Tag key={s} icon={<BookOutlined/>} style={{fontSize:11}}>{s}</Tag>)}
          </div>
        )}
        <div style={{fontSize:10,color:'#bbb',marginTop:3,textAlign:isUser?'right':'left'}}>{dayjs(msg.ts).format('HH:mm')}</div>
      </div>
    </div>
  );
};

// ── MODE config ────────────────────────────────────────────────────────────────
const MODES = [
  {value:'auto',label:'Auto',icon:<ThunderboltOutlined/>,tip:'Smart routing — docs or live ERP data'},
  {value:'docs',label:'Docs',icon:<BookOutlined/>,tip:'Search uploaded documents only'},
  {value:'erp', label:'ERP Data',icon:<DatabaseOutlined/>,tip:'Query live ERP data + generate reports'},
];

const SUGGESTIONS: Record<QueryMode, string[]> = {
  auto: ['Create an AP aging report','Show bank transfer trends this year','How do I reconcile a bank statement?','Cash flow summary last 3 months'],
  docs: ['How do I create a bank transfer?','What is the AP invoice approval process?','Explain the reconciliation workflow'],
  erp:  ['Create an AP aging report with chart','Show external transactions by direction this month','Bank transfer trend last 6 months','Top 10 vendors by payment amount'],
};

// ── Main Component ─────────────────────────────────────────────────────────────
const RagAssistant: React.FC = () => {
  const [docs, setDocs]           = useState<RagDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [messages, setMessages]   = useState<ChatMessage[]>([{
    id:uid(), role:'assistant', content:"Hi! I'm your ERP AI Assistant.\n\n• **Docs mode** — ask questions from uploaded manuals/SOPs\n• **ERP Data mode** — query live data, create reports, charts, aging analysis\n• **Auto mode** — I'll decide which source to use\n\nTry: \"Create an AP aging report\" or upload a document to get started.",
    msgType:'text', ts:Date.now(),
  }]);
  const [input, setInput]         = useState('');
  const [thinking, setThinking]   = useState(false);
  const [mode, setMode]           = useState<QueryMode>('auto');
  const chatEndRef                = useRef<HTMLDivElement>(null);
  const inputRef                  = useRef<any>(null);
  const isElectron                = !!(window as any).electronAPI?.ragQuery;

  const loadDocs = useCallback(async () => {
    if (!isElectron) return;
    setDocsLoading(true);
    try { const r=await (window as any).electronAPI.ragListDocs(); if(r.success) setDocs(r.docs??[]); } finally { setDocsLoading(false); }
  }, [isElectron]);

  useEffect(()=>{ loadDocs(); },[loadDocs]);
  useEffect(()=>{ chatEndRef.current?.scrollIntoView({behavior:'smooth'}); },[messages]);

  // ── Upload ──────────────────────────────────────────────────────────────────
  const handleUpload = async (file: File) => {
    if (!isElectron) { message.warning('Upload requires the Electron desktop app.'); return false; }
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const r = await (window as any).electronAPI.ragIngestFile({ buffer:Array.from(new Uint8Array(buf)), filename:file.name, mimeType:file.type });
      if (r.success) { message.success(`"${file.name}" — ${r.chunkCount} chunks indexed.`); loadDocs(); }
      else message.error(r.error||'Ingestion failed.');
    } catch(e:any) { message.error(e.message); } finally { setUploading(false); }
    return false;
  };

  const handleDeleteDoc = async (doc:RagDoc) => {
    const r = await (window as any).electronAPI.ragDeleteDoc({docId:doc.id});
    if(r.success){ message.success(`"${doc.name}" removed.`); loadDocs(); } else message.error(r.error);
  };

  // ── Send ────────────────────────────────────────────────────────────────────
  const sendMessage = async () => {
    const q = input.trim();
    if (!q || thinking) return;
    if (!isElectron) { message.warning('AI Assistant requires the Electron desktop app.'); return; }

    const userMsg: ChatMessage = { id:uid(), role:'user', content:q, ts:Date.now() };
    setMessages(prev=>[...prev, userMsg]);
    setInput('');
    setThinking(true);

    const history = messages.slice(-10).map(m=>({ role:m.role, content:m.content }));
    try {
      const res = await (window as any).electronAPI.ragQuery({ question:q, mode, history });
      if (res.success) {
        const msgType = res.type==='report' ? 'report' : res.type==='erp_data' ? 'erp_data' : res.type==='docs' ? 'docs' : 'text';
        setMessages(prev=>[...prev,{
          id:uid(), role:'assistant', content:res.answer??res.summary??'',
          msgType, report:res.type==='report'?res:undefined,
          sources:res.sources, apiUrl:res.apiUrl, apiDesc:res.apiDesc,
          recordCount:res.recordCount, rawData:res.rawData, ts:Date.now(),
        }]);
      } else {
        setMessages(prev=>[...prev,{ id:uid(), role:'assistant', content:res.error||'Something went wrong.', msgType:'error', ts:Date.now() }]);
      }
    } catch(e:any) {
      setMessages(prev=>[...prev,{ id:uid(), role:'assistant', content:'Network error: '+e.message, msgType:'error', ts:Date.now() }]);
    } finally {
      setThinking(false);
      setTimeout(()=>inputRef.current?.focus(),100);
    }
  };

  const totalChunks = docs.reduce((s,d)=>s+d.chunk_count,0);

  return (
    <Layout style={{minHeight:'calc(100vh - 64px)',background:REDWOOD.neutral100}}>
      <Content>
        <div style={{padding:'14px 24px',background:REDWOOD.surface,borderBottom:`1px solid ${REDWOOD.neutral200}`}}>
          <Breadcrumb items={[
            {title:<Link to="/home"><HomeOutlined/> Home</Link>},
            {title:<Link to="/admin">Administration</Link>},
            {title:'AI Assistant'},
          ]}/>
        </div>

        <div style={{height:'calc(100vh - 113px)',display:'flex',overflow:'hidden'}}>

          {/* ── Left sidebar ── */}
          <div style={{width:270,flexShrink:0,background:REDWOOD.surface,borderRight:`1px solid ${REDWOOD.neutral200}`,display:'flex',flexDirection:'column',overflow:'hidden'}}>
            <div style={{padding:'14px 14px 10px'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:12}}>
                <div style={{width:36,height:36,borderRadius:9,background:`linear-gradient(135deg,${PURPLE} 0%,#531dab 100%)`,display:'flex',alignItems:'center',justifyContent:'center'}}>
                  <RobotOutlined style={{color:'#fff',fontSize:17}}/>
                </div>
                <div>
                  <Text strong style={{fontSize:14}}>Knowledge Base</Text>
                  <div style={{fontSize:11,color:REDWOOD.neutral600}}>{docs.length} docs · {totalChunks} chunks</div>
                </div>
              </div>
              <Upload beforeUpload={handleUpload} showUploadList={false} accept=".pdf,.doc,.docx,.txt,.md,.csv" disabled={!isElectron||uploading}>
                <Button block icon={uploading?<Spin size="small"/>:<UploadOutlined/>} disabled={!isElectron||uploading} style={{borderStyle:'dashed',borderColor:PURPLE,color:PURPLE}}>
                  {uploading?'Indexing…':'Upload Document'}
                </Button>
              </Upload>
              <div style={{fontSize:10,color:REDWOOD.neutral600,marginTop:4,textAlign:'center'}}>PDF · Word · TXT · MD · CSV</div>
            </div>

            <div style={{flex:1,overflowY:'auto'}}>
              {docsLoading?<div style={{textAlign:'center',padding:20}}><Spin/></div>
              :docs.length===0?<Empty description={<Text style={{fontSize:12}}>No documents yet</Text>} image={Empty.PRESENTED_IMAGE_SIMPLE} style={{padding:'20px 14px'}}/>
              :<List size="small" dataSource={docs} renderItem={doc=>(
                <List.Item style={{padding:'6px 12px',border:'none'}} actions={[
                  <Popconfirm title="Remove this document?" onConfirm={()=>handleDeleteDoc(doc)} okText="Remove" okButtonProps={{danger:true}}>
                    <Button type="text" size="small" danger icon={<DeleteOutlined/>}/>
                  </Popconfirm>
                ]}>
                  <List.Item.Meta
                    avatar={<span style={{fontSize:18}}>{fileIcon(doc.name)}</span>}
                    title={<Tooltip title={doc.name}><Text style={{fontSize:12,fontWeight:500}} ellipsis>{doc.name.length>26?doc.name.slice(0,26)+'…':doc.name}</Text></Tooltip>}
                    description={<Text style={{fontSize:11,color:REDWOOD.neutral600}}>{doc.chunk_count} chunks · {fmtBytes(doc.size_bytes)}</Text>}
                  />
                </List.Item>
              )}/>}
            </div>

            {docs.length>0&&<div style={{padding:'8px 12px',borderTop:`1px solid ${REDWOOD.neutral200}`}}>
              <Button size="small" block icon={<ReloadOutlined/>} onClick={loadDocs}>Refresh</Button>
            </div>}
          </div>

          {/* ── Right chat panel ── */}
          <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

            {/* Toolbar */}
            <div style={{padding:'8px 16px',background:REDWOOD.surface,borderBottom:`1px solid ${REDWOOD.neutral200}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <Space>
                <Text style={{fontSize:12,color:REDWOOD.neutral600}}>Mode:</Text>
                {MODES.map(m=>(
                  <Tooltip key={m.value} title={m.tip}>
                    <Button size="small" type={mode===m.value?'primary':'default'} icon={m.icon}
                      onClick={()=>setMode(m.value as QueryMode)}
                      style={mode===m.value?{background:PURPLE,borderColor:PURPLE}:{}}>
                      {m.label}
                    </Button>
                  </Tooltip>
                ))}
              </Space>
              <Tooltip title="Clear chat">
                <Button size="small" icon={<ClearOutlined/>} onClick={()=>setMessages([{id:uid(),role:'assistant',content:'Chat cleared. Ask me anything!',msgType:'text',ts:Date.now()}])}>Clear</Button>
              </Tooltip>
            </div>

            {/* Messages */}
            <div style={{flex:1,overflowY:'auto',padding:'14px 16px'}}>
              {messages.map(msg=><MsgBubble key={msg.id} msg={msg}/>)}

              {thinking&&(
                <div style={{display:'flex',gap:8,marginBottom:12,alignItems:'flex-start'}}>
                  <div style={{width:32,height:32,borderRadius:'50%',background:`linear-gradient(135deg,${PURPLE} 0%,#531dab 100%)`,display:'flex',alignItems:'center',justifyContent:'center'}}>
                    <RobotOutlined style={{color:'#fff',fontSize:15}}/>
                  </div>
                  <div style={{padding:'10px 16px',borderRadius:'18px 18px 18px 4px',background:REDWOOD.surface,border:`1px solid ${REDWOOD.neutral200}`,display:'flex',gap:4,alignItems:'center'}}>
                    {[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:'50%',background:PURPLE,animation:'bounce 1.2s ease-in-out infinite',animationDelay:`${i*0.2}s`}}/>)}
                  </div>
                </div>
              )}
              <div ref={chatEndRef}/>
            </div>

            {/* Suggestions */}
            {messages.length<=2&&!thinking&&(
              <div style={{padding:'0 16px 8px',display:'flex',gap:6,flexWrap:'wrap'}}>
                {SUGGESTIONS[mode].map(s=>(
                  <Button key={s} size="small" onClick={()=>{ setInput(s); inputRef.current?.focus(); }}
                    style={{fontSize:11,borderRadius:12,borderColor:PURPLE,color:PURPLE}}>
                    {s}
                  </Button>
                ))}
              </div>
            )}

            {/* Input */}
            <div style={{padding:'10px 16px',background:REDWOOD.surface,borderTop:`1px solid ${REDWOOD.neutral200}`}}>
              {!isElectron&&<div style={{marginBottom:8,padding:'6px 12px',background:'#fff7e6',border:'1px solid #ffd591',borderRadius:6,fontSize:12}}>AI Assistant requires the Electron desktop app.</div>}
              <div style={{display:'flex',gap:8}}>
                <TextArea ref={inputRef} value={input} onChange={e=>setInput(e.target.value)}
                  onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage();}}}
                  placeholder={mode==='erp'?'Ask for reports, charts, aging analysis…':mode==='docs'?'Ask about your documents…':'Ask anything…'}
                  autoSize={{minRows:1,maxRows:4}} disabled={!isElectron||thinking}
                  style={{borderRadius:20,resize:'none'}}
                />
                <Button type="primary" icon={<SendOutlined/>} onClick={sendMessage}
                  disabled={!input.trim()||!isElectron||thinking}
                  style={{background:PURPLE,borderColor:PURPLE,borderRadius:20,height:'auto',minHeight:32}}
                />
              </div>
              <div style={{marginTop:5,fontSize:11,color:'#bbb',textAlign:'center'}}>
                Enter to send · Shift+Enter new line · Mode: <strong>{MODES.find(m=>m.value===mode)?.label}</strong>
              </div>
            </div>
          </div>
        </div>
      </Content>
      <style>{`@keyframes bounce{0%,80%,100%{transform:scale(0.6);opacity:0.4}40%{transform:scale(1);opacity:1}}`}</style>
    </Layout>
  );
};

export default RagAssistant;
