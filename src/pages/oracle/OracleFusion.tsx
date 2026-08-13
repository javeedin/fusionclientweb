import React, { useRef, useState, useEffect } from 'react';
import {
  Layout, Typography, Button, Input, Tooltip, Breadcrumb,
  Select, message, Tag, Badge, Modal, Form,
} from 'antd';
import {
  HomeOutlined, ReloadOutlined, ArrowLeftOutlined, ArrowRightOutlined,
  VideoCameraOutlined, StopOutlined, LockOutlined,
  AimOutlined, FileTextOutlined, CheckSquareOutlined,
  DeleteOutlined, CloseOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
  KeyOutlined, SettingOutlined, UserOutlined, EyeInvisibleOutlined, EyeTwoTone,
  CameraOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';

const { Text } = Typography;
const { Option } = Select;

const REDWOOD = '#C74634';

interface Step {
  id: string;
  type: 'click' | 'input' | 'navigate' | 'snapshot';
  description: string;
  fieldName: string;   // label / button text / element name
  action: string;      // Click | Enter | Select | Check | Navigate
  value: string;       // entered value, selected option, or button text
  url: string;
  pageTitle: string;
  timestamp: number;
  screenshot?: string;
}

const FUSION_URLS = [
  { label: 'Oracle Fusion Home',          value: 'https://iaaobn.fa.ocs.oraclecloud.com/fscmUI/faces/FuseWelcome' },
  { label: 'Payables — Manage Invoices',  value: 'https://iaaobn.fa.ocs.oraclecloud.com/fscmUI/faces/FuseTaskListManagerTop?fndGlobalItemNodeId=itemNode_payables_invoices' },
  { label: 'Payables — Manage Payments',  value: 'https://iaaobn.fa.ocs.oraclecloud.com/fscmUI/faces/FuseTaskListManagerTop?fndGlobalItemNodeId=itemNode_payables_payments' },
  { label: 'General Ledger',             value: 'https://iaaobn.fa.ocs.oraclecloud.com/fscmUI/faces/FuseWelcome?fndGlobalItemNodeId=itemNode_general_ledger' },
  { label: 'Suppliers',                  value: 'https://iaaobn.fa.ocs.oraclecloud.com/fscmUI/faces/FuseTaskListManagerTop?fndGlobalItemNodeId=itemNode_procurement_suppliers' },
];

// Injected into the webview to capture user interactions
const INJECT_SCRIPT = `
(function() {
  if (window.__reactErpTracking) return;
  window.__reactErpTracking = true;
  window.__reactErpSteps = window.__reactErpSteps || [];

  // ── Label resolution ──────────────────────────────────────────────────────
  function getDirectLabel(el) {
    if (!el || !el.getAttribute) return '';
    // aria-label is most reliable
    var al = el.getAttribute('aria-label'); if (al) return al.trim();
    // aria-labelledby
    var alby = el.getAttribute('aria-labelledby');
    if (alby) {
      var parts = alby.split(' ');
      var texts = [];
      for (var k = 0; k < parts.length; k++) {
        var ref = document.getElementById(parts[k]);
        if (ref) texts.push(ref.textContent.trim());
      }
      if (texts.length) return texts.join(' ');
    }
    // explicit <label for="id">
    if (el.id) {
      var lbl = document.querySelector('label[for="' + el.id + '"]');
      if (lbl) return lbl.textContent.trim().replace(/:$/, '').trim();
    }
    // title / placeholder / name
    return (el.getAttribute('title') || el.getAttribute('placeholder') || el.name || '').trim();
  }

  function findLabel(el) {
    var direct = getDirectLabel(el);
    if (direct) return direct;

    // Walk up DOM — Oracle ADF puts label in adjacent cell (previousElementSibling)
    var node = el.parentElement;
    for (var i = 0; i < 8 && node; i++) {
      // Check previous sibling for label text (ADF panel form layout)
      var prev = node.previousElementSibling;
      if (prev) {
        var lblEl = prev.querySelector('label') || prev.querySelector('[role="label"]');
        if (lblEl) {
          var t = lblEl.textContent.trim().replace(/:$/, '').trim();
          if (t && t.length < 80) return t;
        }
        // Sometimes the sibling itself is the label cell
        var pt = prev.textContent.trim().replace(/:$/, '').trim();
        if (pt && pt.length < 60 && !pt.includes('\\n') && !/^[0-9,.$%]+$/.test(pt)) return pt;
      }
      // <label> anywhere in current ancestor
      var labels = node.querySelectorAll('label');
      for (var j = 0; j < labels.length; j++) {
        var lt = labels[j].textContent.trim().replace(/:$/, '').trim();
        if (lt && lt.length < 80) return lt;
      }
      node = node.parentElement;
    }
    return '';
  }

  // ── Field info extraction ─────────────────────────────────────────────────
  function getFieldInfo(el) {
    if (!el || !el.tagName) return null;
    var tag  = el.tagName.toLowerCase();
    var type = (el.getAttribute('type') || '').toLowerCase();
    var role = (el.getAttribute('role') || '').toLowerCase();
    var fieldName, action, value;

    if (tag === 'select') {
      fieldName = findLabel(el) || 'Dropdown';
      action    = 'Select';
      value     = el.options && el.selectedIndex >= 0 ? (el.options[el.selectedIndex].text || el.value) : el.value;
    } else if (type === 'checkbox') {
      fieldName = findLabel(el) || 'Checkbox';
      action    = el.checked ? 'Check' : 'Uncheck';
      value     = el.checked ? 'Yes' : 'No';
    } else if (type === 'radio') {
      fieldName = findLabel(el) || 'Radio';
      action    = 'Select';
      value     = el.value || '';
    } else if (tag === 'input' || tag === 'textarea' || role === 'textbox' || role === 'combobox' || role === 'spinbutton') {
      fieldName = findLabel(el) || el.getAttribute('placeholder') || 'Field';
      action    = 'Enter';
      value     = (el.value || el.textContent || '').trim().slice(0, 100);
    } else if (tag === 'button' || type === 'button' || type === 'submit') {
      var btnText = (el.innerText || el.textContent || '').trim().slice(0, 80);
      fieldName   = el.getAttribute('aria-label') || btnText || 'Button';
      action      = 'Click';
      value       = fieldName;
    } else if (tag === 'a') {
      var linkText = (el.innerText || el.textContent || '').trim().slice(0, 80);
      fieldName    = el.getAttribute('aria-label') || linkText || el.getAttribute('title') || 'Link';
      action       = 'Click';
      value        = fieldName;
    } else {
      // Generic — get the most meaningful visible text
      var elText = (el.getAttribute('aria-label') || el.getAttribute('title') ||
                   (el.innerText || el.textContent || '').trim()).slice(0, 80);
      if (!elText || elText.length < 2) return null; // skip meaningless elements
      fieldName = elText;
      action    = 'Click';
      value     = elText;
    }
    return { fieldName: fieldName, action: action, value: value };
  }

  // ── Click listener — skip plain input/textarea/select (captured via change) ─
  document.addEventListener('click', function(e) {
    var el = e.target;
    if (!el || !el.tagName) return;
    var tag  = el.tagName.toLowerCase();
    var type = (el.getAttribute('type') || '').toLowerCase();
    var role = (el.getAttribute('role') || '').toLowerCase();

    // Skip focusable field elements — their data entry is captured via 'change'
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (role === 'textbox' || role === 'combobox' || role === 'spinbutton') return;
    if (type === 'text' || type === 'number' || type === 'date' || type === 'email') return;

    var info = getFieldInfo(el);
    if (!info) return;
    window.__reactErpSteps.push({
      type: 'click', fieldName: info.fieldName, action: info.action, value: info.value,
      description: info.action + ': ' + info.fieldName,
      url: location.href, pageTitle: document.title, timestamp: Date.now()
    });
  }, true);

  // ── Change listener — fires when field value is committed ─────────────────
  document.addEventListener('change', function(e) {
    var el = e.target;
    var info = getFieldInfo(el);
    if (!info) return;
    window.__reactErpSteps.push({
      type: 'input', fieldName: info.fieldName, action: info.action, value: info.value,
      description: info.action + ' "' + info.value + '" in: ' + info.fieldName,
      url: location.href, pageTitle: document.title, timestamp: Date.now()
    });
  }, true);

  // Also capture blur on text inputs (ADF doesn't always fire 'change')
  document.addEventListener('blur', function(e) {
    var el = e.target;
    if (!el || !el.tagName) return;
    var tag  = el.tagName.toLowerCase();
    var role = (el.getAttribute('role') || '').toLowerCase();
    if (tag !== 'input' && tag !== 'textarea' && role !== 'textbox' && role !== 'combobox') return;
    var val = (el.value || el.textContent || '').trim();
    if (!val) return;
    var info = getFieldInfo(el);
    if (!info || !info.fieldName) return;
    // Avoid double-capture if 'change' already pushed this
    var last = window.__reactErpSteps[window.__reactErpSteps.length - 1];
    if (last && last.fieldName === info.fieldName && last.value === val) return;
    window.__reactErpSteps.push({
      type: 'input', fieldName: info.fieldName, action: 'Enter', value: val,
      description: 'Enter "' + val + '" in: ' + info.fieldName,
      url: location.href, pageTitle: document.title, timestamp: Date.now()
    });
  }, true);

  console.log('[ReactERP] Step tracking active');

  // ── Snapshot: scan all filled inputs AND read-only ADF display fields ────────
  window.__reactErpCaptureFields = function() {
    var results = [];
    var seen = {};

    // ── 1. Standard form inputs / ARIA widgets ──────────────────────────────
    var els = Array.from(document.querySelectorAll(
      'input, select, textarea, [role="textbox"], [role="combobox"], [role="spinbutton"]'
    ));
    els.forEach(function(el) {
      var tag  = el.tagName.toLowerCase();
      var type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button' ||
          type === 'image'  || type === 'reset'  || type === 'file') return;

      var value = '';
      if (tag === 'select') {
        value = el.options && el.selectedIndex >= 0 ? (el.options[el.selectedIndex].text || el.value) : el.value;
      } else if (type === 'checkbox' || type === 'radio') {
        if (!el.checked) return;
        value = findLabel(el) || (el.checked ? 'Yes' : 'No');
      } else {
        value = (el.value || el.textContent || '').trim();
      }
      if (!value || value.length < 1) return;

      var label = findLabel(el);
      if (!label || label.length < 2) return;
      if (seen[label]) return;
      seen[label] = true;

      var action = tag === 'select' ? 'Select' : (type === 'checkbox' || type === 'radio') ? 'Check' : 'Enter';
      results.push({
        type: 'input',
        fieldName: label,
        action: action,
        value: value,
        description: action + ' "' + value + '" in: ' + label,
        url: location.href,
        pageTitle: document.title,
        timestamp: Date.now()
      });
    });

    // ── 2. Oracle ADF read-only display fields ──────────────────────────────
    // ADF renders read-only fields as label text + adjacent output text (spans/divs/tds).
    // Strategy: find label elements, then look for the value in the next sibling cell/element.
    var labelEls = Array.from(document.querySelectorAll(
      'label, [class*="af_panelLabelAndMessage_label"], [class*="AFPanelFormLayoutLabel"]'
    ));
    labelEls.forEach(function(lbl) {
      var labelText = lbl.textContent.trim().replace(/:$/, '').trim();
      if (!labelText || labelText.length < 2 || labelText.length > 80) return;
      if (seen[labelText]) return;

      // Try to find the value in the adjacent element
      // Pattern 1: <td>label</td><td>value</td>
      var parentCell = lbl.closest('td, th');
      var valueEl = parentCell ? parentCell.nextElementSibling : null;
      // Pattern 2: label is directly followed by sibling span/div
      if (!valueEl) valueEl = lbl.nextElementSibling;
      // Pattern 3: parent div → next sibling div (ADF panelFormLayout)
      if (!valueEl) {
        var p = lbl.parentElement;
        if (p) valueEl = p.nextElementSibling;
      }

      if (!valueEl) return;

      // Get text, skip if empty, too short, or contains nested inputs (handled above)
      var val = (valueEl.textContent || '').trim();
      // Strip internal whitespace runs
      val = val.replace(/\\s+/g, ' ').trim();
      if (!val || val.length < 1 || val.length > 300) return;
      // Skip if the element itself contains an input (already captured above)
      if (valueEl.querySelector('input, select, textarea')) return;
      // Skip noise values
      if (/^[0-9]+$/.test(val) && val.length < 2) return;

      seen[labelText] = true;
      results.push({
        type: 'input',
        fieldName: labelText,
        action: 'Display',
        value: val,
        description: 'Display "' + val + '" — ' + labelText,
        url: location.href,
        pageTitle: document.title,
        timestamp: Date.now()
      });
    });

    return JSON.stringify(results);
  };
})();
true;
`;

const escapeHtml = (s: string) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const downloadHtml = (content: string, filename: string) => {
  const blob = new Blob([content], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

const generateUserManual = (steps: Step[]): string => {
  const date = new Date().toLocaleString();

  // Group steps by screen (pageTitle)
  const screens: { title: string; steps: (Step & { globalIdx: number })[] }[] = [];
  let globalIdx = 0;
  for (const s of steps) {
    const title = s.pageTitle || 'Oracle Fusion';
    let screen = screens.find(sc => sc.title === title);
    if (!screen) { screen = { title, steps: [] }; screens.push(screen); }
    screen.steps.push({ ...s, globalIdx: ++globalIdx });
  }

  const typeLabel: Record<string, string> = { click: 'Click', input: 'Input', navigate: 'Navigate' };
  const typeColor: Record<string, string> = { click: '#1565c0', input: '#2e7d32', navigate: '#e65100' };
  const typeBg:    Record<string, string> = { click: '#e3f2fd', input: '#e8f5e9', navigate: '#fff3e0' };

  const toc = screens.map((sc, i) =>
    `<li><a href="#screen-${i}">${escapeHtml(sc.title)}</a> <span style="color:#999">(${sc.steps.length} step${sc.steps.length !== 1 ? 's' : ''})</span></li>`
  ).join('\n');

  const sectionsHtml = screens.map((sc, si) => {
    // Navigate step screenshot (shows the screen on arrival)
    const navStep = sc.steps.find(s => s.type === 'navigate' && s.screenshot);
    const navScreenShot = navStep?.screenshot || '';

    // Split non-navigate steps into groups separated by 'snapshot' steps.
    // Each snapshot step starts a new group and carries that group's screenshot.
    const nonNavSteps = sc.steps.filter(s => s.type !== 'navigate');

    type Group = { screenshot: string; label: string; steps: (Step & { globalIdx: number })[] };
    const groups: Group[] = [];
    let current: Group = { screenshot: '', label: '', steps: [] };

    for (const step of nonNavSteps) {
      if (step.type === 'snapshot') {
        // Push whatever we've accumulated so far (even if empty — preserves order)
        groups.push(current);
        current = { screenshot: step.screenshot || '', label: step.fieldName || '', steps: [] };
      } else {
        current.steps.push(step);
      }
    }
    groups.push(current);

    // If no snapshot steps were captured, use the nav screenshot for the single group
    if (groups.length === 1 && !groups[0].screenshot && navScreenShot) {
      groups[0].screenshot = navScreenShot;
    }

    const renderGroup = (g: Group, gIdx: number) => {
      const shotHtml = g.screenshot
        ? `<div style="margin:${gIdx === 0 ? '14px' : '24px'} 0 16px;">
             <img src="${g.screenshot}" alt="${escapeHtml(sc.title)} screenshot"
               style="width:100%;border:1px solid #ddd;border-radius:6px;display:block;box-shadow:0 2px 8px rgba(0,0,0,.08);" />
             <div style="font-size:11px;color:#aaa;margin-top:4px;text-align:right;">
               ${g.label ? `Tab: ${escapeHtml(g.label)}` : `Screenshot: ${escapeHtml(sc.title)}`}
             </div>
           </div>`
        : '';

      if (!g.steps.length) return shotHtml;

      const rows = g.steps.map(s => {
        const explanation = s.type === 'input'
          ? `In the <strong>${escapeHtml(s.fieldName || 'field')}</strong> field, enter <strong>${escapeHtml(s.value || '')}</strong>.`
          : `Click the <strong>${escapeHtml(s.fieldName || s.description)}</strong>${s.value && s.value !== s.fieldName ? ' — <em>' + escapeHtml(s.value) + '</em>' : ''}.`;
        const badge = `<span style="display:inline-block;padding:1px 7px;border-radius:3px;font-size:10px;font-weight:700;background:${typeBg[s.type] || '#eee'};color:${typeColor[s.type] || '#333'}">${typeLabel[s.type] || s.type}</span>`;
        return `
        <tr>
          <td style="text-align:center;font-weight:700;font-size:15px;color:#444;white-space:nowrap;">${s.globalIdx}</td>
          <td>${badge}</td>
          <td style="font-weight:600;color:#222;">${escapeHtml(s.fieldName || s.description)}</td>
          <td style="color:#555;">${s.value ? escapeHtml(s.value) : '—'}</td>
          <td style="line-height:1.5;">${explanation}</td>
        </tr>`;
      }).join('\n');

      const tableHtml = `
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:8px;margin-bottom:8px;">
          <thead>
            <tr style="background:#f5f5f5;">
              <th style="padding:9px 12px;border-bottom:2px solid #ddd;width:40px;">#</th>
              <th style="padding:9px 12px;border-bottom:2px solid #ddd;width:72px;">Type</th>
              <th style="padding:9px 12px;border-bottom:2px solid #ddd;width:170px;">Field / Element</th>
              <th style="padding:9px 12px;border-bottom:2px solid #ddd;width:140px;">Value Entered</th>
              <th style="padding:9px 12px;border-bottom:2px solid #ddd;">Step Explanation</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;

      return shotHtml + tableHtml;
    };

    const bodyHtml = groups.map((g, gi) => renderGroup(g, gi)).join('\n');
    const hasAnyFields = groups.some(g => g.steps.length > 0);
    const content = hasAnyFields
      ? bodyHtml
      : (navScreenShot
          ? `<div style="margin:14px 0 20px;"><img src="${navScreenShot}" style="width:100%;border:1px solid #ddd;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.08);" /></div>` : '')
        + '<p style="color:#aaa;font-size:12px;font-style:italic;">No field interactions recorded on this screen.</p>';

    return `
    <section id="screen-${si}" style="margin-bottom:50px;page-break-inside:avoid;">
      <h2 style="color:${REDWOOD};border-bottom:2px solid ${REDWOOD};padding-bottom:6px;margin-top:36px;">
        ${escapeHtml(sc.title)}
      </h2>
      ${content}
    </section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>User Manual — Oracle Fusion</title>
<style>
  body { font-family: Segoe UI, Arial, sans-serif; max-width: 1000px; margin: 0 auto; padding: 30px; color: #333; }
  h1 { color: ${REDWOOD}; margin-bottom: 4px; }
  .meta { color: #888; font-size: 13px; margin-bottom: 20px; }
  .toc { background:#f9f9f9; border:1px solid #e0e0e0; border-radius:8px; padding:16px 24px; margin-bottom:32px; }
  .toc h3 { margin:0 0 10px; color:#444; font-size:14px; }
  .toc ol { margin:0; padding-left:20px; }
  .toc li { margin:4px 0; font-size:13px; }
  .toc a { color:${REDWOOD}; text-decoration:none; }
  .toc a:hover { text-decoration:underline; }
  tbody tr:hover td { background:#fafafa; }
  td, th { padding:9px 12px; border-bottom:1px solid #eee; vertical-align:top; text-align:left; }
  @media print {
    body { max-width:100%; padding:15px; }
    section { break-before:auto; }
    tr { break-inside:avoid; }
  }
</style>
</head>
<body>
<h1>&#128214; User Manual — Oracle Fusion</h1>
<div class="meta">Generated: ${date} &nbsp;|&nbsp; Total steps: ${steps.length} &nbsp;|&nbsp; Screens: ${screens.length}</div>

<div class="toc">
  <h3>&#128196; Table of Contents</h3>
  <ol>${toc}</ol>
</div>

${sectionsHtml}
</body>
</html>`;
};

const generateUATScript = (steps: Step[]): string => {
  const date = new Date().toLocaleString();
  const rows = steps.map((s, i) => `
    <tr>
      <td style="text-align:center;font-weight:600;">${i + 1}</td>
      <td>${escapeHtml(s.pageTitle || 'Oracle Fusion')}</td>
      <td>${escapeHtml(s.description)}</td>
      <td style="color:#555;font-style:italic;">&nbsp;</td>
      <td style="white-space:nowrap;">
        <label style="cursor:pointer;margin-right:10px;">
          <input type="radio" name="res${i}" value="pass" style="accent-color:#2e7d32;"> <span style="color:#2e7d32;font-weight:600;">Pass</span>
        </label>
        <label style="cursor:pointer;">
          <input type="radio" name="res${i}" value="fail" style="accent-color:#c62828;"> <span style="color:#c62828;font-weight:600;">Fail</span>
        </label>
      </td>
      <td><input type="text" placeholder="Add comments…" style="width:100%;border:1px solid #ccc;border-radius:4px;padding:4px 6px;font-size:12px;box-sizing:border-box;"></td>
    </tr>`).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>UAT Script — Oracle Fusion</title>
<style>
  body { font-family: Segoe UI, Arial, sans-serif; padding: 30px; color: #333; }
  h1 { color: ${REDWOOD}; }
  .meta { color: #888; font-size: 13px; margin-bottom: 20px; }
  .tester-row { display:flex; gap:30px; margin-bottom:20px; }
  .tester-row label { font-size:13px; font-weight:600; }
  .tester-row input { border:none; border-bottom:1px solid #999; width:180px; padding:2px 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead tr { background: ${REDWOOD}; color: #fff; }
  th { padding: 10px 12px; text-align: left; font-weight: 600; }
  td { padding: 9px 12px; border-bottom: 1px solid #e0e0e0; vertical-align: top; }
  tr:nth-child(even) td { background: #f8f8f8; }
  .no-print { display: block; }
  @media print {
    .no-print { display: none; }
    table { font-size: 11px; }
    body { padding: 10px; }
  }
</style>
</head>
<body>
<h1>&#9989; UAT Test Script — Oracle Fusion</h1>
<div class="meta">Generated: ${date} &nbsp;|&nbsp; Total test steps: ${steps.length}</div>
<div class="tester-row">
  <div><label>Tester Name: </label><input type="text"></div>
  <div><label>Test Date: </label><input type="text"></div>
  <div><label>Version/Release: </label><input type="text"></div>
  <div><label>Overall Status: </label><input type="text"></div>
</div>
<table>
  <thead>
    <tr>
      <th style="width:42px;">#</th>
      <th style="width:140px;">Screen</th>
      <th>Action / Step Description</th>
      <th style="width:160px;">Expected Result</th>
      <th style="width:120px;">Result</th>
      <th style="width:150px;">Comments</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>
<br>
<button class="no-print" onclick="window.print()" style="background:${REDWOOD};color:#fff;border:none;padding:10px 24px;border-radius:6px;font-size:14px;cursor:pointer;">&#128438; Print / Save as PDF</button>
</body>
</html>`;
};

const isElectron = () => !!(window as any).electronAPI?.isElectron;
const formatTime = (s: number) =>
  `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

const STEP_COLORS: Record<string, string> = { click: 'blue', input: 'green', navigate: 'orange', snapshot: 'purple' };

const OracleFusion: React.FC = () => {
  const navigate = useNavigate();
  const webviewRef = useRef<any>(null);
  const [url, setUrl] = useState(FUSION_URLS[0].value);
  const [inputUrl, setInputUrl] = useState(FUSION_URLS[0].value);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoFwd, setCanGoFwd] = useState(false);
  const [loading, setLoading] = useState(false);

  // --- Step tracking ---
  const [tracking, setTracking] = useState(false);
  const [steps, setSteps] = useState<Step[]>([]);
  const [showPanel, setShowPanel] = useState(false);
  const trackingRef = useRef(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const screenshotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks the pageTitle of the screen currently being interacted with
  const currentPageTitleRef = useRef<string>('');
  // Rolling screenshot updated every 2s while tracking — applied to steps on navigate away
  const lastScreenshotRef = useRef<string>('');

  // --- Saved credentials ---
  const [credsModalOpen, setCredsModalOpen] = useState(false);
  const [hasSavedCreds, setHasSavedCreds] = useState(false);
  const [credsForm] = Form.useForm();

  // --- Screen recording ---
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const elapsedRef = useRef(0);

  // Inject tracking script and add navigate step on each page load
  const injectTracking = async (wv: any) => {
    try {
      await wv.executeJavaScript(INJECT_SCRIPT);
    } catch (_) {}
  };

  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv || !isElectron()) return;

    // Helper: capture webview screenshot as data URL
    const captureShot = async (): Promise<string> => {
      try {
        const shot = await wv.capturePage();
        return shot?.resize?.({ width: 900 })?.toDataURL?.() || shot?.toDataURL?.() || '';
      } catch (_) { return ''; }
    };

    // BEFORE leaving a screen: capture it while fields are still filled in.
    // Apply screenshot to all steps belonging to that screen that don't have one yet.
    const onWillNavigate = async () => {
      if (!trackingRef.current) return;
      const leavingTitle = currentPageTitleRef.current;
      const dataUrl = await captureShot();
      if (dataUrl && leavingTitle) {
        setSteps(prev => prev.map(s =>
          !s.screenshot && s.pageTitle === leavingTitle ? { ...s, screenshot: dataUrl } : s
        ));
      }
    };

    // AFTER arriving at a new screen: add navigate step + capture screenshot of new screen.
    const onLoad = async () => {
      setLoading(false);
      const currentUrl = wv.getURL ? wv.getURL() : url;
      setInputUrl(currentUrl);
      setCanGoBack(wv.canGoBack?.() ?? false);
      setCanGoFwd(wv.canGoForward?.() ?? false);

      if (!trackingRef.current) return;

      await injectTracking(wv);
      try {
        const title = await wv.executeJavaScript('document.title');
        const navUrl = wv.getURL?.() || currentUrl;
        const navId = Date.now() + Math.random() + '';
        currentPageTitleRef.current = title || navUrl;

        // Add navigate step (screenshot filled in shortly after page settles)
        setSteps(prev => [...prev, {
          id: navId,
          type: 'navigate',
          fieldName: title || navUrl,
          action: 'Navigate',
          value: '',
          description: `Navigate to: ${title || navUrl}`,
          url: navUrl,
          pageTitle: title || navUrl,
          timestamp: Date.now(),
        }]);

        // Capture screenshot of the new screen once it has fully rendered
        setTimeout(async () => {
          const dataUrl = await captureShot();
          if (dataUrl) {
            // Apply ONLY to the navigate step we just added (keyed by id)
            setSteps(prev => prev.map(s => s.id === navId ? { ...s, screenshot: dataUrl } : s));
          }
        }, 1000);
      } catch (_) {}
    };

    const onStart = () => setLoading(true);
    const onFail  = () => setLoading(false);

    wv.addEventListener('will-navigate',    onWillNavigate);
    wv.addEventListener('did-finish-load',  onLoad);
    wv.addEventListener('did-start-loading', onStart);
    wv.addEventListener('did-fail-load',    onFail);
    return () => {
      wv.removeEventListener('will-navigate',    onWillNavigate);
      wv.removeEventListener('did-finish-load',  onLoad);
      wv.removeEventListener('did-start-loading', onStart);
      wv.removeEventListener('did-fail-load',    onFail);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup on unmount
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (pollRef.current) clearInterval(pollRef.current);
    if (screenshotIntervalRef.current) clearInterval(screenshotIntervalRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  const navigate_to = (dest: string) => {
    const wv = webviewRef.current;
    setUrl(dest);
    setInputUrl(dest);
    if (wv) wv.src = dest;
  };

  const handleUrlInput = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      let dest = inputUrl.trim();
      if (dest && !dest.startsWith('http')) dest = 'https://' + dest;
      navigate_to(dest);
    }
  };

  // ---- Step Tracking ----
  const startTracking = async () => {
    const wv = webviewRef.current;
    if (!wv) { message.warning('WebView not ready'); return; }
    setTracking(true);
    setSteps([]);
    setShowPanel(true);
    trackingRef.current = true;
    lastScreenshotRef.current = '';
    // Seed current page title
    try { currentPageTitleRef.current = await wv.executeJavaScript('document.title'); } catch (_) {}
    await injectTracking(wv);

    // ── Rolling screenshot every 2s (shows filled-in state of current screen) ──
    screenshotIntervalRef.current = setInterval(async () => {
      if (!trackingRef.current) return;
      try {
        const shot = await wv.capturePage();
        const url = shot?.resize?.({ width: 960 })?.toDataURL?.() || shot?.toDataURL?.() || '';
        if (url) lastScreenshotRef.current = url;
      } catch (_) {}
    }, 2000);

    // ── Poll every 800ms: collect steps + detect SPA navigation by title change ──
    pollRef.current = setInterval(async () => {
      if (!trackingRef.current) return;
      try {
        const pollData = await wv.executeJavaScript(
          '({steps:(window.__reactErpSteps||[]).splice(0), title:document.title, url:location.href})'
        );
        const { steps: rawSteps, title: liveTitle, url: liveUrl } = pollData as any;

        // ── SPA navigation detected (Oracle Fusion ADF navigates without full reload) ──
        if (liveTitle && liveTitle !== currentPageTitleRef.current) {
          const oldTitle = currentPageTitleRef.current;
          const navId = Date.now() + Math.random() + '';

          // 1. Apply last rolling screenshot to all steps from the OLD screen (filled state)
          if (lastScreenshotRef.current && oldTitle) {
            const snap = lastScreenshotRef.current;
            setSteps(prev => prev.map(s =>
              !s.screenshot && s.pageTitle === oldTitle ? { ...s, screenshot: snap } : s
            ));
          }

          currentPageTitleRef.current = liveTitle;
          lastScreenshotRef.current = '';

          // 2. Add navigate step
          setSteps(prev => [...prev, {
            id: navId,
            type: 'navigate' as const,
            fieldName: liveTitle,
            action: 'Navigate',
            value: '',
            description: `Navigate to: ${liveTitle}`,
            url: liveUrl,
            pageTitle: liveTitle,
            timestamp: Date.now(),
          }]);

          // 3. Re-inject tracker into new SPA page
          await injectTracking(wv);

          // 4. Capture screenshot of new screen once settled (1s)
          setTimeout(async () => {
            try {
              const shot = await wv.capturePage();
              const dataUrl = shot?.resize?.({ width: 960 })?.toDataURL?.() || shot?.toDataURL?.() || '';
              if (dataUrl) {
                lastScreenshotRef.current = dataUrl;
                setSteps(prev => prev.map(s => s.id === navId ? { ...s, screenshot: dataUrl } : s));
              }
            } catch (_) {}
          }, 1000);
        }

        // ── Collect field/click steps ──
        if (rawSteps?.length) {
          const enriched: Step[] = rawSteps.map((s: any) => ({
            fieldName: s.fieldName || s.description || '',
            action: s.action || s.type || '',
            value: s.value || '',
            ...s,
            id: Date.now() + Math.random() + '',
          }));
          setSteps(prev => [...prev, ...enriched]);
        }
      } catch (_) {}
    }, 800);

    message.success('Step tracking started — perform your Oracle Fusion workflow');
  };

  const stopTracking = async () => {
    setTracking(false);
    trackingRef.current = false;
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (screenshotIntervalRef.current) { clearInterval(screenshotIntervalRef.current); screenshotIntervalRef.current = null; }
    // Apply last rolling screenshot to any steps still missing one
    if (lastScreenshotRef.current) {
      const snap = lastScreenshotRef.current;
      const title = currentPageTitleRef.current;
      setSteps(prev => prev.map(s =>
        !s.screenshot && s.pageTitle === title ? { ...s, screenshot: snap } : s
      ));
    }
    message.info(`Tracking stopped — ${steps.length} steps captured`);
  };

  // ---- Saved Credentials ----
  // Check on mount whether credentials are already stored
  useEffect(() => {
    (window as any).electronAPI?.getFusionCredentials?.().then((creds: any) => {
      setHasSavedCreds(!!creds?.username);
      if (creds?.username) credsForm.setFieldsValue({ username: creds.username, password: creds.password });
    });
  }, []);

  const openCredsModal = async () => {
    // Pre-fill form with saved values
    const creds = await (window as any).electronAPI?.getFusionCredentials?.();
    if (creds) credsForm.setFieldsValue({ username: creds.username, password: creds.password });
    setCredsModalOpen(true);
  };

  const handleSaveCreds = async () => {
    const values = await credsForm.validateFields();
    const result = await (window as any).electronAPI?.saveFusionCredentials?.(values.username, values.password);
    if (result?.success) {
      setHasSavedCreds(true);
      setCredsModalOpen(false);
      message.success('Credentials saved — use the key button to auto-login');
    } else {
      message.error('Failed to save credentials');
    }
  };

  const handleClearCreds = async () => {
    await (window as any).electronAPI?.clearFusionCredentials?.();
    credsForm.resetFields();
    setHasSavedCreds(false);
    message.info('Credentials cleared');
  };

  // Inject credentials into the Oracle Fusion login page
  const handleAutoLogin = async () => {
    const wv = webviewRef.current;
    if (!wv) { message.warning('WebView not ready'); return; }
    const creds = await (window as any).electronAPI?.getFusionCredentials?.();
    if (!creds) { message.warning('No saved credentials — click the settings icon to set up'); return; }

    const script = `
      (function() {
        function fillField(el, val) {
          el.focus();
          // Clear first
          el.value = '';
          el.dispatchEvent(new Event('input', {bubbles:true}));
          // Set via native setter (bypasses React/ADF synthetic events)
          try {
            var proto = el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
            var setter = Object.getOwnPropertyDescriptor(proto, 'value');
            if (setter && setter.set) setter.set.call(el, val);
            else el.value = val;
          } catch(e) { el.value = val; }
          // Fire all events ADF/OAM listens to
          el.dispatchEvent(new Event('input',  {bubbles:true, cancelable:true}));
          el.dispatchEvent(new Event('change', {bubbles:true, cancelable:true}));
          el.dispatchEvent(new KeyboardEvent('keydown', {bubbles:true, cancelable:true, key:'Tab'}));
          el.dispatchEvent(new KeyboardEvent('keyup',   {bubbles:true, cancelable:true, key:'Tab'}));
          el.blur();
        }

        var allInputs = Array.from(document.querySelectorAll('input'));

        // Username: prefer named/id'd fields, then first text-type
        var userField =
          document.querySelector('input[name="userid"]') ||
          document.querySelector('input[id="userid"]') ||
          document.querySelector('input[autocomplete="username"]') ||
          document.querySelector('input[name="username"]') ||
          document.querySelector('input[id="username"]') ||
          allInputs.find(function(el) {
            var t = (el.type || 'text').toLowerCase();
            return t !== 'password' && t !== 'hidden' && t !== 'submit' &&
                   t !== 'button'   && t !== 'checkbox' && t !== 'radio' && t !== 'file';
          });

        // Password: first password-type
        var passField =
          document.querySelector('input[type="password"]') ||
          document.querySelector('input[name="password"]');

        if (!userField && !passField) {
          return 'no-inputs | found: ' + allInputs.map(function(i){
            return (i.type||'text') + '|' + i.name + '|' + i.id + '|' + i.placeholder;
          }).join(' :: ');
        }

        if (userField) fillField(userField, ${JSON.stringify(creds.username)});
        if (passField) fillField(passField, ${JSON.stringify(creds.password)});

        // Sign In button
        var allBtns = Array.from(document.querySelectorAll('button, input[type="submit"], a[role="button"]'));
        var loginBtn = allBtns.find(function(b) {
          var t = (b.textContent || b.value || b.getAttribute('aria-label') || '').toLowerCase().trim();
          return t === 'sign in' || t === 'login' || t === 'log in' || t === 'submit' || t === 'ok' || t === 'next';
        }) || document.querySelector('input[type="submit"]') || document.querySelector('#btnActive');

        if (loginBtn) { loginBtn.click(); return 'ok-submitted'; }
        return 'ok-filled';
      })();
    `;

    try {
      const result = await wv.executeJavaScript(script);
      if (typeof result === 'string' && result.startsWith('ok-submitted')) {
        message.success('Credentials filled and Sign In clicked');
      } else if (typeof result === 'string' && result.startsWith('ok-filled')) {
        message.success('Credentials filled — click Sign In to continue');
      } else if (typeof result === 'string' && result.startsWith('no-inputs')) {
        message.warning(`No login fields found on this page. Detected: ${result.replace('no-inputs | found: ', '')}`, 10);
      } else {
        message.warning('Result: ' + String(result));
      }
    } catch (e: any) {
      message.error('Auto-login error: ' + e.message);
    }
  };

  // ---- Screen Recording ----
  const startRecording = async () => {
    if (!isElectron()) { message.warning('Recording only works in the desktop app'); return; }
    try {
      const sources = await (window as any).electronAPI.getScreenSources();
      const src = sources.find((s: any) => s.name.includes('Screen') || s.name.includes('Entire')) || sources[0];
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: src.id, minWidth: 1280, maxWidth: 1920, minHeight: 720, maxHeight: 1080 } } as any,
      });
      streamRef.current = stream;
      chunks.current = [];
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.current.push(e.data); };
      rec.start(1000);
      mediaRecorder.current = rec;
      elapsedRef.current = 0;
      setElapsed(0);
      setRecording(true);
      timerRef.current = setInterval(() => { elapsedRef.current++; setElapsed(elapsedRef.current); }, 1000);
      message.success('Recording started');
    } catch (e: any) {
      message.error('Could not start recording: ' + e.message);
    }
  };

  const stopRecording = () => {
    if (!mediaRecorder.current) return;
    mediaRecorder.current.stop();
    streamRef.current?.getTracks().forEach(t => t.stop());
    if (timerRef.current) clearInterval(timerRef.current);
    setRecording(false);
    mediaRecorder.current.onstop = async () => {
      const blob = new Blob(chunks.current, { type: 'video/webm' });
      const buf = await blob.arrayBuffer();
      const now = new Date();
      const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
      const result = await (window as any).electronAPI.saveRecording(
        Array.from(new Uint8Array(buf)),
        { title: `Oracle Fusion ${stamp}`, description: 'Recorded from Oracle Fusion WebView', category: 'Oracle Fusion', defaultName: `OracleFusion_${stamp}.webm`, duration: elapsedRef.current }
      );
      if (result?.success) {
        message.success(<span>Saved! <a onClick={() => navigate('/training')} style={{ textDecoration: 'underline', cursor: 'pointer' }}>View in Training Library</a></span>, 6);
      }
    };
  };

  // ---- Capture Fields Snapshot ----
  const handleCaptureFields = async () => {
    const wv = webviewRef.current;
    if (!wv) return;
    try {
      await injectTracking(wv);
      const raw = await wv.executeJavaScript('window.__reactErpCaptureFields ? window.__reactErpCaptureFields() : "[]"');
      const captured: any[] = JSON.parse(raw || '[]');
      if (!captured.length) { message.warning('No fields found — try Capture Tab to save a screenshot instead'); return; }

      const currentTitle = currentPageTitleRef.current ||
        await wv.executeJavaScript('document.title');

      // Capture screenshot of current state
      const shot = await wv.capturePage();
      const dataUrl = shot?.resize?.({ width: 960 })?.toDataURL?.() || shot?.toDataURL?.() || '';
      if (dataUrl) lastScreenshotRef.current = dataUrl;

      // Build enriched steps
      const now = Date.now();
      const enriched: Step[] = captured.map((s: any, i: number) => ({
        ...s,
        id: now + i + Math.random() + '',
        pageTitle: currentTitle,
        screenshot: undefined,
      }));

      // Replace all non-navigate steps from this screen with the clean snapshot
      setSteps(prev => {
        const others = prev.filter(s => s.pageTitle !== currentTitle || s.type === 'navigate');
        // Apply screenshot to the navigate step for this screen
        const withShot = others.map(s =>
          s.pageTitle === currentTitle && s.type === 'navigate' && dataUrl
            ? { ...s, screenshot: dataUrl }
            : s
        );
        return [...withShot, ...enriched];
      });

      message.success(`Captured ${captured.length} fields from "${currentTitle}"`);
    } catch (e: any) {
      message.error('Capture failed: ' + e.message);
    }
  };

  // ---- Capture Screenshot + Fields (multi-tab: appends, never replaces) ----
  const handleCaptureTab = async () => {
    const wv = webviewRef.current;
    if (!wv) return;
    try {
      // Always inject the script first so __reactErpCaptureFields is available
      await injectTracking(wv);

      const raw = await wv.executeJavaScript('window.__reactErpCaptureFields ? window.__reactErpCaptureFields() : "[]"');
      const captured: any[] = JSON.parse(raw || '[]');

      const currentTitle = currentPageTitleRef.current ||
        await wv.executeJavaScript('document.title');

      // Always capture screenshot — even if no fields found
      const shot = await wv.capturePage();
      const dataUrl = shot?.resize?.({ width: 960 })?.toDataURL?.() || shot?.toDataURL?.() || '';

      const now = Date.now();
      // Snapshot step — section marker carrying the screenshot
      const snapshotStep: Step = {
        id: now + 'snap' + Math.random(),
        type: 'snapshot',
        fieldName: currentTitle,
        action: 'Snapshot',
        value: '',
        description: `Screenshot: ${currentTitle}`,
        url: wv.getURL?.() || '',
        pageTitle: currentTitle,
        timestamp: now,
        screenshot: dataUrl,
      };

      // Field steps — appended after snapshot
      const enriched: Step[] = captured.map((s: any, i: number) => ({
        ...s,
        id: now + i + Math.random() + '',
        pageTitle: currentTitle,
        screenshot: undefined,
      }));

      // Always APPEND — never replace — so every tab is preserved independently
      setSteps(prev => [...prev, snapshotStep, ...enriched]);

      if (captured.length > 0) {
        message.success(`Captured screenshot + ${captured.length} fields from "${currentTitle}"`);
      } else {
        message.info(`Screenshot captured from "${currentTitle}" (no fillable fields detected — read-only view)`);
      }
    } catch (e: any) {
      message.error('Capture failed: ' + e.message);
    }
  };

  // ---- Document Generation ----
  const handleGenerateManual = () => {
    if (!steps.length) { message.warning('No steps recorded yet'); return; }
    const html = generateUserManual(steps);
    const ts = new Date().toISOString().slice(0, 10);
    downloadHtml(html, `UserManual_OracleFusion_${ts}.html`);
    message.success('User Manual downloaded');
  };

  const handleGenerateUAT = () => {
    if (!steps.length) { message.warning('No steps recorded yet'); return; }
    const html = generateUATScript(steps);
    const ts = new Date().toISOString().slice(0, 10);
    downloadHtml(html, `UATScript_OracleFusion_${ts}.html`);
    message.success('UAT Script downloaded');
  };

  return (
    <>
    <Layout style={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column', background: '#1a1a2e', overflow: 'hidden' }}>
      <style>{`
        @keyframes pulse-rec { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.35;transform:scale(1.35)} }
        @keyframes pulse-trk { 0%,100%{opacity:1} 50%{opacity:.4} }
        .wv-scroll::-webkit-scrollbar{width:6px} .wv-scroll::-webkit-scrollbar-thumb{background:#555;border-radius:3px}
      `}</style>

      {/* Breadcrumb */}
      <div style={{ padding: '8px 20px', background: '#fff', borderBottom: '1px solid #e5e5e5', flexShrink: 0 }}>
        <Breadcrumb items={[
          { title: <Link to="/home"><HomeOutlined /> Home</Link> },
          { title: 'Oracle Fusion' },
        ]} />
      </div>

      {/* Browser Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', background: '#2b2b3b', flexShrink: 0, flexWrap: 'nowrap' }}>
        <Tooltip title="Back">
          <Button size="small" icon={<ArrowLeftOutlined />} disabled={!canGoBack}
            onClick={() => webviewRef.current?.goBack?.()}
            style={{ background: '#444', border: 'none', color: '#fff' }} />
        </Tooltip>
        <Tooltip title="Forward">
          <Button size="small" icon={<ArrowRightOutlined />} disabled={!canGoFwd}
            onClick={() => webviewRef.current?.goForward?.()}
            style={{ background: '#444', border: 'none', color: '#fff' }} />
        </Tooltip>
        <Tooltip title="Reload">
          <Button size="small" icon={<ReloadOutlined spin={loading} />}
            onClick={() => webviewRef.current?.reload?.()}
            style={{ background: '#444', border: 'none', color: '#fff' }} />
        </Tooltip>

        <Select size="small" value={undefined} placeholder="Quick links" onChange={navigate_to} style={{ width: 170 }}>
          {FUSION_URLS.map(f => <Option key={f.value} value={f.value}>{f.label}</Option>)}
        </Select>

        <Input
          size="small"
          value={inputUrl}
          onChange={e => setInputUrl(e.target.value)}
          onKeyDown={handleUrlInput}
          prefix={<LockOutlined style={{ color: '#4caf50', fontSize: 11 }} />}
          style={{ flex: 1, background: '#3a3a4a', border: '1px solid #555', color: '#fff', minWidth: 100 }}
        />

        {/* Track Steps */}
        {tracking ? (
          <>
            <Tooltip title="Scan fields and replace noisy clicks with clean data (replaces existing captures for this screen)">
              <Button size="small" icon={<FileTextOutlined />} onClick={handleCaptureFields}
                style={{ background: '#1b5e20', border: 'none', color: '#fff', fontWeight: 600 }}>
                Capture Fields
              </Button>
            </Tooltip>
            <Tooltip title="Capture screenshot + fields and APPEND — use this when switching between tab pages on the same screen">
              <Button size="small" icon={<CameraOutlined />} onClick={handleCaptureTab}
                style={{ background: '#4a148c', border: 'none', color: '#fff', fontWeight: 600 }}>
                Capture Tab
              </Button>
            </Tooltip>
            <Badge count={steps.length} size="small" offset={[-4, 0]}>
              <Button size="small" onClick={stopTracking}
                style={{ background: '#7b2d00', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff6b35', display: 'inline-block', animation: 'pulse-trk 1s infinite' }} />
                Stop Tracking
              </Button>
            </Badge>
          </>
        ) : (
          <Tooltip title="Track navigation to generate User Manual / UAT Script">
            <Button size="small" icon={<AimOutlined />} onClick={startTracking}
              style={{ background: '#1565c0', border: 'none', color: '#fff' }}>
              Track Steps
            </Button>
          </Tooltip>
        )}

        {/* Screen Record */}
        {recording ? (
          <Button size="small" onClick={stopRecording}
            style={{ background: '#333', border: 'none', color: '#fff', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff4444', display: 'inline-block', animation: 'pulse-rec 1s infinite' }} />
            <StopOutlined />
            <span style={{ fontWeight: 600 }}>{formatTime(elapsed)}</span>
          </Button>
        ) : (
          <Tooltip title="Record screen">
            <Button size="small" icon={<VideoCameraOutlined />} onClick={startRecording}
              style={{ background: REDWOOD, border: 'none', color: '#fff' }} />
          </Tooltip>
        )}

        <Tooltip title={showPanel ? 'Hide steps panel' : 'Show steps panel'}>
          <Button size="small"
            icon={showPanel ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setShowPanel(v => !v)}
            style={{ background: '#444', border: 'none', color: steps.length ? '#ffd54f' : '#fff' }} />
        </Tooltip>

        {/* Auto-login button */}
        <Tooltip title={hasSavedCreds ? 'Auto-fill login credentials' : 'No credentials saved yet — click ⚙ to set up'}>
          <Button size="small" icon={<KeyOutlined />} onClick={handleAutoLogin}
            style={{ background: hasSavedCreds ? '#5b3a8c' : '#444', border: 'none', color: hasSavedCreds ? '#fff' : '#666' }} />
        </Tooltip>

        {/* Credentials settings */}
        <Tooltip title="Login credentials settings">
          <Button size="small" icon={<SettingOutlined />} onClick={openCredsModal}
            style={{ background: '#444', border: 'none', color: hasSavedCreds ? '#4caf50' : '#aaa' }} />
        </Tooltip>

        <Tooltip title="Open Training Library">
          <Button size="small" onClick={() => navigate('/training')}
            style={{ background: '#1D7B4D', border: 'none', color: '#fff', fontSize: 11 }}>
            Training
          </Button>
        </Tooltip>
      </div>

      {/* Main Area: WebView + Steps Panel */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* WebView */}
        {isElectron() ? (
          <webview
            ref={webviewRef}
            src={url}
            // @ts-ignore
            disablewebsecurity="true"
            // @ts-ignore
            allowpopups="true"
            style={{ flex: 1, minWidth: 0 }}
          />
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, color: '#fff' }}>
            <Text style={{ color: '#fff', fontSize: 16 }}>Oracle Fusion WebView is only available in the desktop app.</Text>
            <Text style={{ color: '#aaa' }}>Please use the installed ReactERP desktop application.</Text>
          </div>
        )}

        {/* Steps Panel */}
        {showPanel && (
          <div style={{
            width: 340, background: '#1e1e2e', borderLeft: '1px solid #333',
            display: 'flex', flexDirection: 'column', flexShrink: 0,
          }}>
            {/* Panel Header */}
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #333', display: 'flex', alignItems: 'center', gap: 8 }}>
              <AimOutlined style={{ color: tracking ? '#ff6b35' : '#888', fontSize: 15 }} />
              <Text style={{ color: '#fff', fontWeight: 600, flex: 1 }}>
                Steps {steps.length > 0 && <Tag color="blue" style={{ marginLeft: 4 }}>{steps.length}</Tag>}
              </Text>
              {tracking && (
                <span style={{ fontSize: 11, color: '#ff6b35', animation: 'pulse-trk 1s infinite' }}>● LIVE</span>
              )}
              <Tooltip title="Close panel">
                <CloseOutlined style={{ color: '#888', cursor: 'pointer' }} onClick={() => setShowPanel(false)} />
              </Tooltip>
            </div>

            {/* Steps List */}
            <div className="wv-scroll" style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
              {steps.length === 0 ? (
                <div style={{ padding: 30, textAlign: 'center' }}>
                  <AimOutlined style={{ fontSize: 32, color: '#555', display: 'block', marginBottom: 10 }} />
                  <Text style={{ color: '#666', fontSize: 13 }}>
                    {tracking ? 'Perform actions in Oracle Fusion…' : 'Click "Track Steps" to start capturing'}
                  </Text>
                </div>
              ) : (
                steps.map((s, i) => (
                  <div key={s.id} style={{ padding: '8px 14px', borderBottom: '1px solid #222' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7 }}>
                      <span style={{
                        width: 20, height: 20, borderRadius: '50%', background: '#333',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, color: '#aaa', flexShrink: 0, marginTop: 2,
                      }}>{i + 1}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <Tag color={STEP_COLORS[s.type]} style={{ fontSize: 10, marginBottom: 3 }}>{s.type}</Tag>
                        <div style={{ fontSize: 12, color: '#e0e0e0', wordBreak: 'break-word', lineHeight: 1.4 }}>{s.description}</div>
                        {s.pageTitle && <div style={{ fontSize: 10, color: '#666', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.pageTitle}</div>}
                        {s.screenshot && (
                          <img src={s.screenshot} alt={`step ${i + 1}`}
                            style={{ width: '100%', borderRadius: 4, marginTop: 5, border: '1px solid #333' }} />
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Action Buttons */}
            <div style={{ padding: '12px 14px', borderTop: '1px solid #333', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Button
                block
                icon={<FileTextOutlined />}
                onClick={handleGenerateManual}
                disabled={!steps.length}
                style={{ background: steps.length ? '#1565c0' : '#333', border: 'none', color: '#fff' }}
              >
                Generate User Manual
              </Button>
              <Button
                block
                icon={<CheckSquareOutlined />}
                onClick={handleGenerateUAT}
                disabled={!steps.length}
                style={{ background: steps.length ? '#2e7d32' : '#333', border: 'none', color: '#fff' }}
              >
                Generate UAT Script
              </Button>
              <Button
                block
                icon={<DeleteOutlined />}
                onClick={() => { setSteps([]); message.info('Steps cleared'); }}
                disabled={!steps.length}
                style={{ background: '#333', border: 'none', color: steps.length ? '#ff6b35' : '#555' }}
              >
                Clear Steps
              </Button>
            </div>
          </div>
        )}
      </div>
    </Layout>

    {/* ── Credentials Setup Modal ── */}
    <Modal
      title={<span><LockOutlined style={{ color: '#5b3a8c', marginRight: 8 }} />Oracle Fusion Login Credentials</span>}
      open={credsModalOpen}
      onCancel={() => setCredsModalOpen(false)}
      footer={null}
      width={420}
    >
      <p style={{ color: '#666', fontSize: 13, marginBottom: 20 }}>
        Credentials are encrypted using your OS keychain (Windows DPAPI / Mac Keychain) and stored locally.
        They are never sent to any server.
      </p>
      <Form form={credsForm} layout="vertical">
        <Form.Item
          name="username"
          label="Oracle Fusion Username"
          rules={[{ required: true, message: 'Please enter your username' }]}
        >
          <Input prefix={<UserOutlined style={{ color: '#aaa' }} />} placeholder="e.g. john.smith@company.com" />
        </Form.Item>
        <Form.Item
          name="password"
          label="Oracle Fusion Password"
          rules={[{ required: true, message: 'Please enter your password' }]}
        >
          <Input.Password
            placeholder="Your Oracle Fusion password"
            iconRender={visible => (visible ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
          />
        </Form.Item>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Button type="primary" onClick={handleSaveCreds} style={{ flex: 1, background: '#5b3a8c', borderColor: '#5b3a8c' }}>
            <LockOutlined /> Save Credentials
          </Button>
          {hasSavedCreds && (
            <Button danger onClick={handleClearCreds}>
              Clear
            </Button>
          )}
        </div>
        {hasSavedCreds && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: '#f0fff4', borderRadius: 6, border: '1px solid #b7eb8f', fontSize: 12, color: '#389e0d' }}>
            ✓ Credentials saved — click the <KeyOutlined /> button in the toolbar to auto-fill the login page
          </div>
        )}
      </Form>
    </Modal>
    </>
  );
};

export default OracleFusion;
