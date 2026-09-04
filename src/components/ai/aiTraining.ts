import { APEX_DB_CONFIG } from '../../config/api.config';

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
    const recipes: TrainingRecipe[] = (data.items || []).map((r: Record<string, unknown>) => ({
      recipeId: r.recipeId as number,
      recipeName: String(r.recipeName || ''),
      description: r.description as string | undefined,
      module: r.module as string | undefined,
      method: String(r.method || 'GET'),
      urlTemplate: String(r.urlTemplate || ''),
      params: parseJson<RecipeParam[]>(r.paramsJson, []),
      example: parseJson<Record<string, string>>(r.exampleJson, {}),
      appPath: r.appPath as string | undefined,
      enabled: r.enabled as string | undefined,
    })).filter((r: TrainingRecipe) => r.recipeName && r.urlTemplate);
    cache = { at: Date.now(), recipes };
    return recipes;
  } catch {
    return cache?.recipes ?? [];
  }
}

export const TRAINING_ENDPOINT = `${APEX}/ai/training`;

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
