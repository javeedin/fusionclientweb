import { APEX_DB_CONFIG } from '../../config/api.config';
import { ordsTokenEnabled } from '../../services/ordsToken.service';

// ── AI Assistant training recipes (RR_AI_TRAINING via /ai/training) ─────────
// A recipe teaches the assistant one action: a webservice call with its
// parameters. Recipes are loaded into the system prompt on every send
// (with a short cache) so newly taught ones apply immediately.

export interface RecipeParam {
  name: string;
  label?: string;
  example?: string;
  required?: boolean;
  description?: string;
}

export interface TrainingRecipe {
  recipeId?: number;
  recipeName: string;
  description?: string;
  module?: string;
  method: string;
  urlTemplate: string;
  params?: RecipeParam[];
  example?: Record<string, string>;
  appPath?: string;
  enabled?: string;
  createdBy?: string;
}

const APEX = APEX_DB_CONFIG.baseUrl;
const CACHE_MS = 60000;

let cache: { at: number; recipes: TrainingRecipe[] } | null = null;

const parseJson = <T,>(s: unknown, fallback: T): T => {
  if (typeof s !== 'string' || !s.trim()) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
};

export async function fetchTrainingRecipes(force = false): Promise<TrainingRecipe[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.recipes;
  try {
    const res = await fetch(`${APEX}/ai/training`, { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!res.ok) return cache?.recipes ?? [];
    const data = await res.json();
    const recipes: TrainingRecipe[] = (data.items || []).map(mapRecipe)
      .filter((r: TrainingRecipe) => r.recipeName && r.urlTemplate);
    cache = { at: Date.now(), recipes };
    return recipes;
  } catch {
    return cache?.recipes ?? [];
  }
}

export const TRAINING_ENDPOINT = `${APEX}/ai/training`;

const mapRecipe = (raw: Record<string, unknown>): TrainingRecipe => {
  // key casing varies by deployed handler version (recipeName / recipe_name /
  // recipename) — compare with case and underscores stripped
  const norm: Record<string, unknown> = {};
  Object.keys(raw).forEach(k => { norm[k.toLowerCase().replace(/_/g, '')] = raw[k]; });
  const g = (k: string) => norm[k];
  return {
    recipeId: Number(g('recipeid')) || undefined,
    recipeName: String(g('recipename') || ''),
    description: g('description') as string | undefined,
    module: g('module') as string | undefined,
    method: String(g('method') || 'GET'),
    urlTemplate: String(g('urltemplate') || ''),
    params: parseJson<RecipeParam[]>(g('paramsjson'), []),
    example: parseJson<Record<string, string>>(g('examplejson'), {}),
    appPath: g('apppath') as string | undefined,
    enabled: g('enabled') as string | undefined,
    createdBy: g('createdby') as string | undefined,
  };
};

// Diagnostics for the last Teachings GET — shown by the API icon in the sidebar
export interface TrainingDebug {
  url: string;
  status: number | string;
  ok: boolean;
  body: string;
  count: number;
  tokenEnabled: boolean;
  at: number;
}
let lastDebug: TrainingDebug | null = null;
export const getTrainingDebug = (): TrainingDebug | null => lastDebug;

// Full list including disabled — for the Teachings management UI (no cache)
export async function fetchAllTrainingRecipes(): Promise<TrainingRecipe[]> {
  const url = `${TRAINING_ENDPOINT}?all=Y`;
  try {
    const res = await fetch(url, { cache: 'no-store', headers: { Accept: 'application/json' } });
    const text = await res.text();
    let items: Record<string, unknown>[] = [];
    try { items = JSON.parse(text).items || []; } catch { /* non-JSON (error page) */ }
    lastDebug = { url, status: res.status, ok: res.ok, body: text.slice(0, 1500), count: items.length, tokenEnabled: ordsTokenEnabled(), at: Date.now() };
    if (!res.ok) return [];
    return items.map(mapRecipe).filter((r: TrainingRecipe) => r.recipeName && r.urlTemplate);
  } catch (e) {
    lastDebug = { url, status: 'NETWORK', ok: false, body: e instanceof Error ? e.message : String(e), count: 0, tokenEnabled: ordsTokenEnabled(), at: Date.now() };
    return [];
  }
}

export async function updateTrainingRecipe(
  recipeId: number,
  fields: Partial<Pick<TrainingRecipe, 'recipeName' | 'description' | 'module' | 'method' | 'urlTemplate' | 'appPath' | 'enabled'>>,
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${TRAINING_ENDPOINT}/${recipeId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...fields, updatedBy: 'APP' }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success !== false) { cache = null; return { ok: true, message: data.message || 'Updated' }; }
    return { ok: false, message: data.message || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteTrainingRecipe(recipeId: number): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${TRAINING_ENDPOINT}/${recipeId}`, { method: 'DELETE', headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.success !== false) { cache = null; return { ok: true, message: data.message || 'Deleted' }; }
    return { ok: false, message: data.message || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// The exact JSON body the POST sends — also shown in the Teach AI dialog's
// API details section so failures can be debugged / replayed in APEX.
export function buildTrainingPostBody(recipe: TrainingRecipe): Record<string, unknown> {
  return {
    recipeName: recipe.recipeName,
    description: recipe.description,
    module: recipe.module,
    method: recipe.method || 'GET',
    urlTemplate: recipe.urlTemplate,
    paramsJson: JSON.stringify(recipe.params || []),
    exampleJson: JSON.stringify(recipe.example || {}),
    appPath: recipe.appPath,
    createdBy: recipe.createdBy || 'APP',
  };
}

export async function saveTrainingRecipe(recipe: TrainingRecipe): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(TRAINING_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(buildTrainingPostBody(recipe)),
    });
    const text = await res.text();
    let data: { success?: boolean; message?: string } = {};
    try { data = JSON.parse(text); } catch { /* non-JSON error page */ }
    if (res.ok && data.success !== false) {
      cache = null; // taught → assistant picks it up on the next message
      return { ok: true, message: data.message || 'Recipe saved' };
    }
    return { ok: false, message: data.message || `HTTP ${res.status}: ${text.slice(0, 300)}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

// System-prompt section for the loaded recipes
export function buildRecipesPrompt(recipes: TrainingRecipe[]): string {
  const teaching =
    `TEACHING: when the user asks you to learn/remember a search or action ("learn this", "when I say X do Y"), ` +
    `save it with erp_api_write → POST /ai/training with body {recipeName, description (matching phrases), module, method, urlTemplate, ` +
    `paramsJson (JSON string of [{name,label,required}]), exampleJson (JSON string of example values), appPath}. It becomes available on the next message.`;
  if (!recipes.length) return teaching;
  const lines = recipes.map(r => {
    const params = (r.params || [])
      .map(p => `${p.name}${p.required ? '*' : ''}${p.label && p.label !== p.name ? ` (${p.label})` : ''}`)
      .join(', ');
    const example = r.example && Object.keys(r.example).length
      ? ` | example: ${new URLSearchParams(r.example).toString()}`
      : '';
    const page = r.appPath ? ` | page: ${r.appPath}` : '';
    return `- "${r.recipeName}"${r.description ? ` — ${r.description}` : ''}\n  ${r.method} ${r.urlTemplate}${params ? ` | params: ${params}` : ''}${example}${page}`;
  });
  return (
    `LEARNED RECIPES (taught by users — prefer these when the request matches; * = required param)\n` +
    lines.join('\n') +
    `\n\n${teaching}`
  );
}
