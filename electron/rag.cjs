/**
 * Enhanced RAG Engine — structured reports, charts, PDF-ready data
 */
'use strict';

const path = require('path');
const fs   = require('fs');

let _store = null, _storePath = null;

function loadStore(userDataPath) {
  if (_store) return _store;
  _storePath = path.join(userDataPath, 'rag_store.json');
  if (fs.existsSync(_storePath)) {
    try { _store = JSON.parse(fs.readFileSync(_storePath, 'utf8')); } catch { _store = null; }
  }
  if (!_store) _store = { documents: [], chunks: [], nextDocId: 1, nextChunkId: 1 };
  return _store;
}

function saveStore() {
  if (_storePath && _store) fs.writeFileSync(_storePath, JSON.stringify(_store), 'utf8');
}

// ── Tokeniser / BM25 ─────────────────────────────────────────────────────────
const STOP = new Set(['a','an','the','and','or','but','in','on','at','to','for','of','with','by','from','is','it','its','as','be','are','was','were','been','have','has','had','do','does','did','will','would','could','should','may','might','this','that','these','those','i','you','he','she','we','they']);

function tokenise(text) {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(t => t.length > 1 && !STOP.has(t));
}
function termFreq(tokens) { const tf={}; for(const t of tokens) tf[t]=(tf[t]||0)+1; return tf; }

function searchChunks(userDataPath, query, limit=6) {
  const store = loadStore(userDataPath);
  if (!store.chunks.length) return [];
  const qTerms = tokenise(query);
  if (!qTerms.length) return [];
  const N=store.chunks.length, df={};
  let total=0;
  for(const c of store.chunks){ total+=c.tokenCount; for(const t of Object.keys(c.tf)) df[t]=(df[t]||0)+1; }
  const avg=total/N;
  return store.chunks
    .map(c=>{
      let s=0;
      for(const t of qTerms){
        const tf=c.tf[t]||0; if(!tf) continue;
        const idf=Math.log((N-(df[t]||0)+0.5)/((df[t]||0)+0.5)+1);
        s+=idf*(tf*2.5)/(tf+1.5*(1-0.75+0.75*c.tokenCount/avg));
      }
      return { chunk:c, score:s };
    })
    .filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,limit)
    .map(({chunk})=>{ const doc=store.documents.find(d=>d.id===chunk.docId); return { content:chunk.content, doc_name:doc?.name||'Unknown' }; });
}

// ── Chunking / Parsing ────────────────────────────────────────────────────────
function chunkText(text, size=800, overlap=120) {
  const clean=text.replace(/\r\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  const chunks=[]; let start=0;
  while(start<clean.length){
    let end=start+size;
    if(end<clean.length){ const b=clean.lastIndexOf('\n',end); if(b>start+size/2) end=b; }
    const c=clean.slice(start,end).trim();
    if(c.length>40) chunks.push(c);
    start=end-overlap; if(start>=clean.length) break;
  }
  return chunks;
}

async function extractText(buffer, filename) {
  const ext=path.extname(filename).toLowerCase();
  if(ext==='.pdf'){ const p=require('pdf-parse'); return (await p(buffer)).text; }
  if(ext==='.docx'||ext==='.doc'){ const m=require('mammoth'); return (await m.extractRawText({buffer})).value; }
  return buffer.toString('utf8');
}

async function ingestFile(userDataPath, buffer, filename, mimeType) {
  const store=loadStore(userDataPath);
  const ei=store.documents.findIndex(d=>d.name===filename);
  if(ei!==-1){ store.chunks=store.chunks.filter(c=>c.docId!==store.documents[ei].id); store.documents.splice(ei,1); }
  const text=await extractText(buffer,filename);
  const chunks=chunkText(text);
  const docId=store.nextDocId++;
  store.documents.push({ id:docId, name:filename, type:mimeType||path.extname(filename).slice(1), size_bytes:buffer.length, chunk_count:chunks.length, created_at:new Date().toISOString() });
  for(let i=0;i<chunks.length;i++){
    const tokens=tokenise(chunks[i]);
    store.chunks.push({ id:store.nextChunkId++, docId, chunkIndex:i, content:chunks[i], tokenCount:tokens.length, tf:termFreq(tokens) });
  }
  saveStore();
  return { docId, chunkCount:chunks.length, textLength:text.length };
}

function listDocuments(ud) { return loadStore(ud).documents.slice().reverse(); }
function deleteDocument(ud, id) { const s=loadStore(ud); s.documents=s.documents.filter(d=>d.id!==id); s.chunks=s.chunks.filter(c=>c.docId!==id); saveStore(); }

// ── ERP endpoints ─────────────────────────────────────────────────────────────
const ERP_ENDPOINTS = [
  { path:'/cash/banktransfers',        desc:'Bank transfers. Params: date_from,date_to,from_account,to_account,status,business_unit,row_limit' },
  { path:'/cash/externaltransactions', desc:'External cash transactions. Params: date_from,date_to,bank_account,direction(DR/CR),txn_type,business_unit,row_limit' },
  { path:'/cash/bankstatements',       desc:'Bank statements/lines. Params: bank_account,date_from,date_to,business_unit,row_limit' },
  { path:'/cash/transactioncodes',     desc:'Transaction code types list' },
  { path:'/gl/journals',              desc:'GL journals. Params: date_from,date_to,status,business_unit,row_limit' },
  { path:'/ap/invoices',              desc:'AP invoices. Params: date_from,date_to,vendor,status,business_unit,row_limit' },
  { path:'/ap/payments',              desc:'AP payments. Params: date_from,date_to,vendor,status,business_unit,row_limit' },
];

// ── Main query ────────────────────────────────────────────────────────────────
async function ragQuery(userDataPath, apexBase, apiKey, { question, mode, history }) {
  const today = new Date().toISOString().split('T')[0];
  const systemBase = `You are a powerful ERP data analyst for an Oracle ERP system. Today: ${today}.`;

  if (mode==='erp')  return erpQuery(apexBase,apiKey,question,history,systemBase);
  if (mode==='docs') return docsQuery(userDataPath,apiKey,question,history,systemBase);

  const erpKw = /\b(report|chart|graph|aging|ageing|trend|list|show|find|total|sum|count|invoice|payment|transfer|journal|statement|balance|vendor|unreconciled|overdue|unpaid|pending|cash flow|summary|breakdown|analysis|pdf|excel|export|download)\b/i;
  if (erpKw.test(question)) {
    const r = await erpQuery(apexBase,apiKey,question,history,systemBase);
    if (r.type!=='text') return r;
  }
  return docsQuery(userDataPath,apiKey,question,history,systemBase);
}

// ── ERP query (two-step: plan → execute → visualise) ─────────────────────────
async function erpQuery(apexBase, apiKey, question, history, systemBase) {
  // Step 1: plan — strip output-format intent (pdf/excel/chart) so Claude picks the right endpoint
  const today = new Date().toISOString().split('T')[0];
  const planPrompt = `You are an ERP API router. Your ONLY job is to pick which API endpoint to call.

IMPORTANT RULES:
- PDF, Excel, charts, and downloads are handled automatically by the UI — you do NOT need to mention them.
- ALWAYS return type "api_call" for any data/report/analysis question.
- Only return type "text" if the question is completely unrelated to ERP data (e.g. a greeting).
- Never refuse to answer — always pick the best matching endpoint.

Available ERP endpoints:
${ERP_ENDPOINTS.map(e=>`  GET ${e.path} — ${e.desc}`).join('\n')}

Reply with ONLY valid JSON, no extra text:
{ "type": "api_call", "endpoint": "/path", "params": { "key": "value" }, "intent": "report|chart|table|lookup", "description": "one sentence about what data this fetches" }

Rules: dates=YYYY-MM-DD, row_limit max 500. Today=${today}.
For aging/overdue: use /ap/invoices with status=UNPAID and a wide date range (date_from 2+ years ago).
For trends: use appropriate date range and row_limit=500.`;

  // Strip output-format hints so Claude focuses on data intent
  const cleanQuestion = question.replace(/\b(as|in|to|into|download|export|generate|create|make|give me|show me)\s+(a\s+)?(pdf|excel|xlsx|csv|chart|graph|spreadsheet)\b/gi, '').trim();
  const planMsg = [...(history||[]).slice(-4), { role:'user', content:cleanQuestion }];
  const plan = await callClaude(apiKey, planPrompt, planMsg, 500);
  const planRaw = plan.content?.[0]?.text ?? '';

  let planned;
  try { planned = JSON.parse(planRaw.match(/\{[\s\S]*\}/)?.[0] ?? '{}'); } catch { return { type:'text', answer:planRaw, sources:[] }; }
  if (planned.type !== 'api_call') return { type:'text', answer:planned.answer??planRaw, sources:[] };

  // Step 2: execute
  const params = new URLSearchParams(planned.params ?? {});
  const url = `${apexBase}${planned.endpoint}${params.toString()?'?'+params.toString():''}`;
  let items = [];
  try {
    const res  = await fetch(url, { headers: { ...(await require('./ords-token.cjs').getOrdsAuthHeader()) } });
    const text = await res.text();
    const data = JSON.parse(text);
    items = data.items ?? data.data ?? [];
  } catch(e) {
    return { type:'text', answer:`Could not fetch data: ${e.message}`, sources:[] };
  }

  // Step 3: visualise / structure
  const intent = planned.intent ?? 'table';
  const isVisual = ['report','chart','table'].includes(intent);

  const vizSystem = isVisual
    ? `You are an ERP data analyst. Analyse the provided data and return a structured JSON report.
Return ONLY valid JSON — absolutely no extra text, no markdown fences, no explanations.
JSON schema:
{
  "type": "report",
  "title": "clear report title",
  "summary": "2-3 sentence executive summary with key numbers",
  "stats": [
    { "label": "KPI name", "value": "formatted value", "color": "green|red|blue|orange" }
  ],
  "sections": [
    {
      "type": "table",
      "title": "section title",
      "columns": ["Col1","Col2","Col3"],
      "rows": [["val1","val2","val3"]]
    },
    {
      "type": "chart",
      "chartType": "bar",
      "title": "chart title",
      "xKey": "name",
      "data": [{ "name": "label", "value": 0, "amount": 0 }]
    }
  ]
}
Chart types: "bar" (comparisons), "pie" (proportions), "line" (trends over time).
For aging reports: bucket amounts by 0-30, 31-60, 61-90, 91-120, 120+ days overdue.
For trends: group by month (YYYY-MM). For vendor breakdowns: top 10 vendors.
Monetary values: 2 decimal places, currency AED unless data says otherwise.`
    : `You are an ERP data analyst. Summarise the data in 3-5 sentences highlighting key figures.`;

  const vizUserMsg = `User question: "${question}"
API called: ${planned.description}
Records returned: ${items.length}
Data: ${JSON.stringify(items.slice(0, 60), null, 1)}`;

  const vizMsg = [{ role:'user', content: vizUserMsg }];
  const viz = await callClaude(apiKey, vizSystem, vizMsg, 2500);
  const vizRaw = viz.content?.[0]?.text ?? '';

  if (isVisual) {
    try {
      const jsonMatch = vizRaw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch?.[0] ?? '{}');
      if (parsed.type === 'report') {
        return { ...parsed, apiUrl:url, apiDesc:planned.description, recordCount:items.length, rawData:items.slice(0,50), sources:[] };
      }
    } catch { /* fall through */ }
  }

  return { type:'erp_data', answer:vizRaw, apiUrl:url, apiDesc:planned.description, recordCount:items.length, rawData:items.slice(0,30), sources:[] };
}

// ── Docs RAG query ────────────────────────────────────────────────────────────
async function docsQuery(userDataPath, apiKey, question, history, systemBase) {
  const chunks = searchChunks(userDataPath, question, 6);
  if (!chunks.length) return { type:'text', answer:"No relevant documents found. Upload manuals/SOPs or switch to ERP Data mode.", sources:[] };
  const context = chunks.map((c,i)=>`[Source ${i+1}: ${c.doc_name}]\n${c.content}`).join('\n\n---\n\n');
  const sp = `${systemBase}\n\nAnswer using ONLY the context below. Cite as [Source N]. If not in context, say so.\n\nCONTEXT:\n${context}`;
  const msgs = [...(history||[]).slice(-6), { role:'user', content:question }];
  const r = await callClaude(apiKey, sp, msgs, 1024);
  return { type:'docs', answer:r.content?.[0]?.text??'No response.', sources:[...new Set(chunks.map(c=>c.doc_name))], chunks:chunks.map(c=>({ docName:c.doc_name, snippet:c.content.substring(0,120)+'…' })) };
}

// ── Claude helper ─────────────────────────────────────────────────────────────
async function callClaude(apiKey, system, messages, maxTokens=1024) {
  const body = { model:'claude-sonnet-4-6', max_tokens:maxTokens, messages };
  if (system) body.system = system;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{ 'x-api-key':apiKey, 'anthropic-version':'2023-06-01', 'content-type':'application/json' },
    body:JSON.stringify(body),
  });
  if (!res.ok) { const e=await res.text(); throw new Error(`Claude API ${res.status}: ${e.substring(0,200)}`); }
  return res.json();
}

module.exports = { ingestFile, searchChunks, listDocuments, deleteDocument, ragQuery };
