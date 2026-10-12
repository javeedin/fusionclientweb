/// <reference types="vite/client" />
// Training — the user manual built into the app: chapters (one Markdown file each in ./manual),
// their sections, links from a section to its screen, learning paths, search and "help for this screen".
import React from 'react';
import {
  InfoCircleOutlined, LoginOutlined, AccountBookOutlined, DollarOutlined, WalletOutlined, BankOutlined,
  DatabaseOutlined, ShoppingCartOutlined, AppstoreOutlined, AuditOutlined, SettingOutlined, ToolOutlined,
  UserOutlined, CheckCircleOutlined, CalculatorOutlined, SafetyCertificateOutlined, ShopOutlined,
} from '@ant-design/icons';

// chapters are NN-name.md (the README in that folder is not part of the manual)
const FILES = import.meta.glob<string>('./manual/[0-9][0-9]-*.md', { query: '?raw', import: 'default', eager: true });

/** Shared online edition of the same manual (Claude Doc). */
export const ONLINE_EDITION_URL = 'https://claude.ai/code/artifact/7e7b2b9b-f05f-4039-a89b-fc69324cbad5';

/** Screenshots live in public/training/manual so they are not bundled into the JS. */
export const manualImage = (file: string) => `${import.meta.env.BASE_URL}training/manual/${file}`;

const SIZES = Object.values(import.meta.glob<Record<string, [number, number]>>('./manual/images.json', { import: 'default', eager: true }))[0] ?? {};
/** Width / height of a screenshot, so the page can reserve its space before it loads. */
export const manualImageRatio = (file: string) => { const s = SIZES[file]; return s ? s[0] / s[1] : 16 / 10; };

export interface ManualSection {
  id: string;          // `${chapterId}/${slug}`
  chapterId: string;
  slug: string;
  title: string;
  body: string;        // Markdown
  text: string;        // plain text for search
  route?: string;      // the screen this section explains
  images: number;
  minutes: number;
}

export interface ManualChapter {
  id: string;
  title: string;
  short: string;
  summary: string;
  icon: React.ReactNode;
  color: string;
  route?: string;      // module home
  prefixes: string[];  // app paths this chapter covers (for "help for this screen")
  intro: string;
  sections: ManualSection[];
  images: number;
  minutes: number;
}

interface ChapterMeta {
  file: string; id: string; title: string; short: string; summary: string; icon: React.ReactNode; color: string;
  route?: string; prefixes?: string[]; routes?: Record<string, string>;
}

const META: ChapterMeta[] = [
  { file: '00-about', id: 'about', short: 'About', title: 'About this manual', summary: 'What the manual covers and how it is organised.',
    icon: <InfoCircleOutlined />, color: '#6B6B6B' },
  { file: '01-getting-started', id: 'getting-started', short: 'Start', title: 'Getting started', summary: 'Sign in, set your password, find your way around and use the bell.',
    icon: <LoginOutlined />, color: '#00857C', route: '/home', prefixes: ['/home', '/login'], routes: { home: '/home' } },
  { file: '02-general-ledger', id: 'general-ledger', short: 'GL', title: 'General Ledger', summary: 'Journals, trial balance, statement templates and accounting periods.',
    icon: <AccountBookOutlined />, color: '#C74634', route: '/gl', prefixes: ['/gl'],
    routes: { 'find-and-review-journals': '/gl/manage-journals', 'create-a-journal': '/gl/create-journal', 'trial-balance': '/gl/trial-balance',
      'income-statement-templates': '/gl/income-statement-templates', 'accounting-periods': '/gl/accounting-periods' } },
  { file: '03-accounts-payable', id: 'accounts-payable', short: 'AP', title: 'Accounts Payable', summary: 'Supplier invoices, approval, payments, suppliers and accounting.',
    icon: <DollarOutlined />, color: '#E06C00', route: '/ap', prefixes: ['/ap'],
    routes: { 'find-invoices': '/ap/manage-invoices', 'view-an-invoice': '/ap/manage-invoices', 'enter-an-invoice': '/ap/manage-invoices',
      'send-an-invoice-for-approval': '/ap/manage-invoices', payments: '/ap/manage-payments', suppliers: '/ap/suppliers', 'create-accounting': '/ap/create-accounting' } },
  { file: '04-accounts-receivable', id: 'accounts-receivable', short: 'AR', title: 'Accounts Receivable', summary: 'Customer invoices, customers and their accounts, receipts.',
    icon: <WalletOutlined />, color: '#1D7B4D', route: '/ar', prefixes: ['/ar'],
    routes: { 'find-invoices': '/ar/manage-receivables', 'create-or-open-an-invoice': '/ar/manage-receivables', customers: '/ar/manage-customers', receipts: '/ar/manage-receipts' } },
  { file: '05-cash-management', id: 'cash-management', short: 'Cash', title: 'Cash Management', summary: 'External transactions, bank statements, reconciliation and archives.',
    icon: <BankOutlined />, color: '#0572CE', route: '/cash', prefixes: ['/cash', '/ap/external-transactions', '/ap/bank-transfers'],
    routes: { 'external-transactions': '/cash/external-transactions', 'bank-statements': '/cash/bank-statements', 'bank-reconciliation': '/cash/bank-reconciliation',
      'archive-a-reconciliation': '/cash/bank-reconciliation', 'archived-statements': '/cash/archived-statements', payees: '/cash/payees' } },
  { file: '06-fixed-assets', id: 'fixed-assets', short: 'FA', title: 'Fixed Assets', summary: 'Asset register, new assets, depreciation runs and retirements.',
    icon: <DatabaseOutlined />, color: '#7B5EA7', route: '/fa', prefixes: ['/fa'],
    routes: { 'find-an-asset': '/fa/assets', 'add-an-asset': '/fa/create-asset', 'review-depreciation': '/fa/depreciation',
      'run-depreciation-for-a-period': '/fa/calculate-deprn', 'retire-an-asset': '/fa/retirements' } },
  { file: '07-purchasing', id: 'purchasing', short: 'PO', title: 'Purchasing', summary: 'Requisitions, purchase orders and their approval, receiving, branding and setup.',
    icon: <ShoppingCartOutlined />, color: '#C74634', route: '/po', prefixes: ['/po'],
    routes: { 'purchasing-home': '/po', requisitions: '/po/requisitions', 'create-a-purchase-order': '/po/orders', 'submit-for-approval': '/po/orders',
      'approve-or-reject-approver': '/po/approvals', 'after-approval': '/po/orders', 'print-the-purchase-order': '/po/orders', receiving: '/po/receiving',
      'terms-conditions': '/po/terms', 'report-branding': '/po/report-branding', setup: '/po/setup' } },
  { file: '08-other-modules', id: 'other-modules', short: 'Other', title: 'Petty Cash, Rental & Portfolio', summary: 'Petty cash registers, rental agreements and investment holdings.',
    icon: <AppstoreOutlined />, color: '#D4A800', prefixes: ['/pc', '/rm', '/pms'],
    routes: { 'petty-cash': '/pc/registers', 'rental-management': '/rm/agreements', 'portfolio-management-investment-holdings': '/pms/investment-holdings' } },
  { file: '09-approvals', id: 'approvals', short: 'Approvals', title: 'Approvals & notifications', summary: 'Send, approve and reject across invoices, transactions and purchasing.',
    icon: <AuditOutlined />, color: '#00857C', prefixes: [],
    routes: { 'setting-up-approvers-and-rules': '/admin/approvals' } },
  { file: '10-administration', id: 'administration', short: 'Admin', title: 'Administration', summary: 'Users and access, the Approval Engine and the FTP Manager.',
    icon: <SettingOutlined />, color: '#333333', route: '/admin', prefixes: ['/admin'],
    routes: { 'users-and-access': '/admin/users', 'approval-engine': '/admin/approvals', 'ftp-manager-oci-bastion-tunnel': '/admin/ftp-manager' } },
  { file: '11-appendix', id: 'appendix', short: 'Appendix', title: 'Appendix', summary: 'Database scripts, troubleshooting and a glossary.',
    icon: <ToolOutlined />, color: '#6B6B6B' },
];

export const slugify = (s: string) =>
  s.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Markdown → plain text (for search and reading time). */
export const plainText = (md: string) => md
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, '$1')
  .replace(/\*\*|\*|`/g, '')
  .replace(/[>#|]/g, ' ')
  .replace(/^\s*(?:[-*]|\d+\.)\s+/gm, '')
  .replace(/-{3,}/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const readingMinutes = (text: string, images: number) => Math.max(1, Math.round(text.split(' ').length / 200 + images * 0.25));

const countImages = (md: string) => (md.match(/!\[[^\]]*\]\([^)]*\)/g) || []).length;

const buildChapter = (m: ChapterMeta): ManualChapter => {
  const raw = FILES[`./manual/${m.file}.md`] || '';
  const [intro, ...rest] = raw.split(/^### /m);
  const sections: ManualSection[] = rest.map(part => {
    const nl = part.indexOf('\n');
    const title = (nl < 0 ? part : part.slice(0, nl)).trim();
    const body = nl < 0 ? '' : part.slice(nl + 1).trim();
    const slug = slugify(title);
    const text = plainText(body);
    const images = countImages(body);
    return { id: `${m.id}/${slug}`, chapterId: m.id, slug, title, body, text, route: m.routes?.[slug], images, minutes: readingMinutes(text, images) };
  });
  const images = countImages(raw);
  return {
    id: m.id, title: m.title, short: m.short, summary: m.summary, icon: m.icon, color: m.color, route: m.route, prefixes: m.prefixes ?? [],
    intro: intro.trim(), sections, images,
    minutes: Math.max(1, sections.reduce((s, x) => s + x.minutes, 0) + readingMinutes(plainText(intro), countImages(intro)) - 1),
  };
};

export const CHAPTERS: ManualChapter[] = META.map(buildChapter);
export const chapterById = (id?: string) => CHAPTERS.find(c => c.id === id);
export const ALL_SECTIONS: ManualSection[] = CHAPTERS.flatMap(c => c.sections);
export const sectionById = (id?: string) => ALL_SECTIONS.find(s => s.id === id);
export const TOTAL_IMAGES = new Set(Object.values(FILES).flatMap(md => [...md.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1]))).size;

/** Link to a chapter, optionally scrolled to a section and inside a learning path. */
export const manualLink = (chapterId: string, slug?: string, pathId?: string) => {
  const q = new URLSearchParams();
  if (slug) q.set('s', slug);
  if (pathId) q.set('path', pathId);
  const qs = q.toString();
  return `/training/manuals/${chapterId}${qs ? `?${qs}` : ''}`;
};

// ── learning paths: the topics one role needs, in reading order ─────────────────────────────────
export interface LearningPath { id: string; title: string; who: string; icon: React.ReactNode; color: string; steps: string[] }

export const LEARNING_PATHS: LearningPath[] = [
  { id: 'everyone', title: 'First day in Re-ERP', who: 'Everyone', icon: <UserOutlined />, color: '#00857C',
    steps: ['getting-started/sign-in', 'getting-started/set-or-reset-your-password', 'getting-started/home', 'getting-started/the-top-bar',
      'getting-started/find-a-screen', 'getting-started/notifications-and-approval-pop-ups', 'approvals/status-at-a-glance'] },
  { id: 'approver', title: 'Approving documents', who: 'Managers and approvers', icon: <CheckCircleOutlined />, color: '#1D7B4D',
    steps: ['approvals/how-it-works', 'approvals/status-at-a-glance', 'approvals/approve-or-reject', 'purchasing/approve-or-reject-approver', 'approvals/approval-history'] },
  { id: 'payables', title: 'Payables clerk', who: 'Accounts payable team', icon: <DollarOutlined />, color: '#E06C00',
    steps: ['accounts-payable/find-invoices', 'accounts-payable/enter-an-invoice', 'accounts-payable/view-an-invoice', 'accounts-payable/send-an-invoice-for-approval',
      'accounts-payable/payments', 'accounts-payable/suppliers', 'accounts-payable/create-accounting'] },
  { id: 'buyer', title: 'Buyer', who: 'Purchasing team and requesters', icon: <ShopOutlined />, color: '#C74634',
    steps: ['purchasing/purchasing-home', 'purchasing/requisitions', 'purchasing/create-a-purchase-order', 'purchasing/submit-for-approval',
      'purchasing/after-approval', 'purchasing/print-the-purchase-order', 'purchasing/receiving'] },
  { id: 'accountant', title: 'Month-end accountant', who: 'General ledger and treasury', icon: <CalculatorOutlined />, color: '#0572CE',
    steps: ['general-ledger/create-a-journal', 'general-ledger/find-and-review-journals', 'cash-management/bank-statements', 'cash-management/bank-reconciliation',
      'cash-management/archive-a-reconciliation', 'fixed-assets/run-depreciation-for-a-period', 'general-ledger/trial-balance', 'general-ledger/accounting-periods'] },
  { id: 'admin', title: 'Administrator', who: 'System and module owners', icon: <SafetyCertificateOutlined />, color: '#333333',
    steps: ['administration/users-and-access', 'administration/approval-engine', 'approvals/setting-up-approvers-and-rules', 'purchasing/setup',
      'purchasing/report-branding', 'purchasing/terms-conditions', 'appendix/a-database-scripts-for-administrators', 'appendix/b-troubleshooting'] },
].map(p => ({ ...p, steps: p.steps.filter(id => !!sectionById(id)) }));

export const pathById = (id?: string | null) => LEARNING_PATHS.find(p => p.id === id);

// ── help for the screen the user came from ─────────────────────────────────────────────────────────
export interface ScreenHelp { chapter: ManualChapter; sections: ManualSection[] }

export const helpForScreen = (path?: string | null): ScreenHelp | null => {
  if (!path || path.startsWith('/training')) return null;
  const clean = path.split('?')[0].replace(/\/+$/, '') || '/';
  const exact = ALL_SECTIONS.filter(s => s.route === clean);
  if (exact.length) return { chapter: chapterById(exact[0].chapterId)!, sections: exact };
  // a sub-page of a documented screen (e.g. /po/orders/123)
  const under = ALL_SECTIONS.filter(s => s.route && s.route !== '/' && clean.startsWith(`${s.route}/`))
    .sort((a, b) => (b.route!.length - a.route!.length));
  if (under.length) return { chapter: chapterById(under[0].chapterId)!, sections: under.filter(s => s.route === under[0].route) };
  const ch = CHAPTERS.map(c => ({ c, p: c.prefixes.filter(p => clean === p || clean.startsWith(`${p}/`)).sort((a, b) => b.length - a.length)[0] }))
    .filter(x => x.p).sort((a, b) => b.p!.length - a.p!.length)[0];
  return ch ? { chapter: ch.c, sections: [] } : null;
};

// ── search ─────────────────────────────────────────────────────────────────────────────────────────
export interface SearchHit { section: ManualSection; chapter: ManualChapter; score: number; snippet: string }

const SNIPPET = 180;

export const searchManual = (query: string, limit = 30): SearchHit[] => {
  const words = query.toLowerCase().split(/\s+/).map(w => w.trim()).filter(w => w.length > 1);
  if (!words.length) return [];
  const hits: SearchHit[] = [];
  for (const section of ALL_SECTIONS) {
    const chapter = chapterById(section.chapterId)!;
    const title = section.title.toLowerCase();
    const body = section.text.toLowerCase();
    const head = `${chapter.title} ${section.title}`.toLowerCase();
    if (!words.every(w => head.includes(w) || body.includes(w))) continue;
    let score = 0;
    for (const w of words) {
      if (title.includes(w)) score += 10;
      else if (head.includes(w)) score += 4;
      score += Math.min(5, body.split(w).length - 1);
    }
    if (title.includes(query.toLowerCase().trim())) score += 15;
    // snippet around the first body match
    const first = words.map(w => body.indexOf(w)).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? 0;
    const start = Math.max(0, first - 60);
    const snippet = (start > 0 ? '…' : '') + section.text.slice(start, start + SNIPPET).trim() + (start + SNIPPET < section.text.length ? '…' : '');
    hits.push({ section, chapter, score, snippet });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
};
