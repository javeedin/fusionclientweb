// P&L Template Service
// API calls for P&L Statement Template Management

import { APEX_DB_CONFIG } from '../config/api.config';

// Direct API calls to APEX
const BASE_URL = APEX_DB_CONFIG.baseUrl;

// Types
export interface PLTemplate {
  template_id: number;
  template_code: string;
  template_name: string;
  description: string | null;
  template_type: string;
  is_active: string;
  is_default: string;
  created_date: string;
}

export interface PLGroup {
  group_id: number;
  group_code: string;
  group_name: string;
  group_label: string | null;
  group_type: string;
  display_order: number;
  sign_convention: number;
  show_subtotal: string;
  subtotal_label: string | null;
  sections: PLSection[];
}

export interface PLSection {
  section_id: number;
  section_code: string;
  section_name: string;
  section_label: string | null;
  display_order: number;
  accounts: PLSectionAccount[];
}

export interface PLSectionAccount {
  section_account_id?: number;
  account_code: string;
  account_from: string | null;
  account_to: string | null;
}

export interface PLTotal {
  total_id: number;
  total_code: string;
  total_name: string;
  total_label: string | null;
  calculation_formula: string;
  display_order: number;
  after_group_code: string | null;
  font_style: string;
  row_style: string;
}

export interface PLTemplateStructure {
  template: {
    template_id: number;
    template_code: string;
    template_name: string;
    description: string | null;
    template_type: string;
    is_default: string;
    groups: PLGroup[];
    totals: PLTotal[];
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// GL Account interface
export interface GLAccount {
  account: string;
  description: string;
  account_type: string;
}

// Get GL Accounts list
export const getGLAccounts = async (): Promise<ApiResponse<GLAccount[]>> => {
  try {
    const baseUrl = BASE_URL;
    const response = await fetch(`${baseUrl}/glaccountslist`);
    const result = await response.json();

    if (result.items) {
      return { success: true, data: result.items };
    }
    return { success: true, data: [] };
  } catch (error) {
    console.error('Error fetching GL accounts:', error);
    return { success: false, error: String(error) };
  }
};

// Get all templates
export const getTemplates = async (): Promise<ApiResponse<PLTemplate[]>> => {
  try {
    const baseUrl = BASE_URL;
    const response = await fetch(`${baseUrl}/pl/templates`);
    const result = await response.json();

    if (result.templates) {
      return { success: true, data: result.templates };
    }
    return { success: true, data: [] };
  } catch (error) {
    console.error('Error fetching templates:', error);
    return { success: false, error: String(error) };
  }
};

// Get template structure by ID
export const getTemplateStructure = async (templateId: number): Promise<ApiResponse<PLTemplateStructure>> => {
  try {
    const baseUrl = BASE_URL;
    console.log('Fetching template structure:', `${baseUrl}/pl/templates/${templateId}`);
    const response = await fetch(`${baseUrl}/pl/templates/${templateId}`);
    const result = await response.json();
    console.log('Template structure response:', result);

    // Handle different response structures
    if (result.template) {
      // Response has template wrapper - use as-is
      return { success: true, data: result };
    } else if (result.template_id) {
      // Response is the template directly without wrapper
      return {
        success: true,
        data: {
          template: {
            template_id: result.template_id,
            template_code: result.template_code || '',
            template_name: result.template_name || '',
            description: result.description || null,
            template_type: result.template_type || 'CUSTOM',
            is_default: result.is_default || 'N',
            groups: result.groups || [],
            totals: result.totals || [],
          }
        }
      };
    } else {
      console.error('Unexpected response structure:', result);
      return { success: false, error: 'Invalid response structure from API' };
    }
  } catch (error) {
    console.error('Error fetching template structure:', error);
    return { success: false, error: String(error) };
  }
};

// Create new template
export const createTemplate = async (
  templateCode: string,
  templateName: string,
  description?: string,
  templateType: string = 'CUSTOM'
): Promise<ApiResponse<{ template_id: number }>> => {
  try {
    const baseUrl = BASE_URL;
    const response = await fetch(`${baseUrl}/pl/template/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_code: templateCode,
        template_name: templateName,
        description: description || null,
        template_type: templateType,
      }),
    });
    const result = await response.json();

    if (result.success) {
      return { success: true, data: { template_id: result.template_id } };
    }
    return { success: false, error: result.error };
  } catch (error) {
    console.error('Error creating template:', error);
    return { success: false, error: String(error) };
  }
};

// Add group to template
export const addGroup = async (
  templateId: number,
  groupCode: string,
  groupName: string,
  groupLabel: string,
  groupType: string,
  displayOrder: number,
  signConvention: number = 1
): Promise<ApiResponse<{ group_id: number }>> => {
  try {
    const baseUrl = BASE_URL;
    const url = `${baseUrl}/pl/group/create`;
    const payload = {
      template_id: templateId,
      group_code: groupCode,
      group_name: groupName,
      group_label: groupLabel,
      group_type: groupType,
      display_order: displayOrder,
      sign_convention: signConvention,
    };

    console.log('=== ADD GROUP REQUEST ===');
    console.log('URL:', url);
    console.log('Payload:', JSON.stringify(payload, null, 2));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    console.log('Response Status:', response.status);
    console.log('Response OK:', response.ok);

    const responseText = await response.text();
    console.log('Response Text:', responseText);

    // Try to parse JSON
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError);
      return { success: false, error: `Invalid JSON response: ${responseText}` };
    }

    console.log('Parsed Result:', result);

    if (result.success) {
      return { success: true, data: { group_id: result.group_id } };
    }
    return { success: false, error: result.error || 'Unknown error' };
  } catch (error) {
    console.error('Error adding group:', error);
    return { success: false, error: String(error) };
  }
};

// Add section to group
export const addSection = async (
  groupId: number,
  sectionCode: string,
  sectionName: string,
  sectionLabel: string,
  displayOrder: number
): Promise<ApiResponse<{ section_id: number }>> => {
  try {
    const baseUrl = BASE_URL;
    const response = await fetch(`${baseUrl}/pl/section/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_id: groupId,
        section_code: sectionCode,
        section_name: sectionName,
        section_label: sectionLabel,
        display_order: displayOrder,
      }),
    });
    const result = await response.json();

    if (result.success) {
      return { success: true, data: { section_id: result.section_id } };
    }
    return { success: false, error: result.error };
  } catch (error) {
    console.error('Error adding section:', error);
    return { success: false, error: String(error) };
  }
};

// Assign account to section
export const assignAccount = async (
  sectionId: number,
  accountCode: string,
  accountFrom?: string,
  accountTo?: string
): Promise<ApiResponse<void>> => {
  try {
    const baseUrl = BASE_URL;
    const response = await fetch(`${baseUrl}/pl/account/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        section_id: sectionId,
        account_code: accountCode,
        account_from: accountFrom || null,
        account_to: accountTo || null,
      }),
    });
    const result = await response.json();

    if (result.success) {
      return { success: true };
    }
    return { success: false, error: result.error };
  } catch (error) {
    console.error('Error assigning account:', error);
    return { success: false, error: String(error) };
  }
};

// Add total/calculated row
export const addTotal = async (
  templateId: number,
  totalCode: string,
  totalName: string,
  calculationFormula: string,
  displayOrder: number,
  afterGroupCode?: string
): Promise<ApiResponse<void>> => {
  try {
    const baseUrl = BASE_URL;
    const response = await fetch(`${baseUrl}/pl/total/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_id: templateId,
        total_code: totalCode,
        total_name: totalName,
        calculation_formula: calculationFormula,
        display_order: displayOrder,
        after_group_code: afterGroupCode || null,
      }),
    });
    const result = await response.json();

    if (result.success) {
      return { success: true };
    }
    return { success: false, error: result.error };
  } catch (error) {
    console.error('Error adding total:', error);
    return { success: false, error: String(error) };
  }
};

// Clone template
export const cloneTemplate = async (
  sourceTemplateId: number,
  newTemplateCode: string,
  newTemplateName: string
): Promise<ApiResponse<{ template_id: number }>> => {
  try {
    const baseUrl = BASE_URL;
    const response = await fetch(`${baseUrl}/pl/template/clone`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_template_id: sourceTemplateId,
        new_template_code: newTemplateCode,
        new_template_name: newTemplateName,
      }),
    });
    const result = await response.json();

    if (result.success) {
      return { success: true, data: { template_id: result.template_id } };
    }
    return { success: false, error: result.error };
  } catch (error) {
    console.error('Error cloning template:', error);
    return { success: false, error: String(error) };
  }
};

// Delete (soft) a group / section / total / template. Tries, in order:
//   DELETE {base}/pl/<kind>/<id>          (original handlers)
//   POST   {base}/pl/<kind>/<id>/delete   (database/gl/rr_pl_delete_endpoints.sql)
//   POST   {base}/<kind>/<id>/delete      (same script when the module sits at the base path)
// and moves on when ORDS answers "no such endpoint/method" (HTML page, 404/405 without
// our JSON), so a missing route never surfaces as "Unexpected token '<' … not valid JSON".
type PLKind = 'group' | 'section' | 'total' | 'template';
const plDelete = async (kind: PLKind, id: number): Promise<ApiResponse<void>> => {
  const attempts: Array<[string, string]> = [
    ['DELETE', `${BASE_URL}/pl/${kind}/${id}`],
    ['POST', `${BASE_URL}/pl/${kind}/${id}/delete`],
    ['POST', `${BASE_URL}/${kind}/${id}/delete`],
  ];
  let lastStatus = 0;
  for (const [method, url] of attempts) {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: { Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
        body: method === 'POST' ? '{}' : undefined,
      });
    } catch (error) {
      lastStatus = 0;
      continue; // network / CORS preflight refused (e.g. DELETE not allowed) → next route
    }
    lastStatus = response.status;
    const text = await response.text();
    let result: any = null;
    try { result = text ? JSON.parse(text) : null; } catch { /* HTML error page */ }
    if (result && typeof result.success === 'boolean') {
      return result.success ? { success: true } : { success: false, error: result.error || `HTTP ${response.status}` };
    }
    if (response.ok && !text.trim()) return { success: true };
    // anything else (ORDS 404/405 page, plain-text error) → try the next route
  }
  return {
    success: false,
    error: `Delete ${kind} service not available (HTTP ${lastStatus || 'network error'}) — run database/gl/rr_pl_delete_endpoints.sql`,
  };
};

// Delete template (soft delete)
export const deleteTemplate = async (templateId: number): Promise<ApiResponse<void>> => plDelete('template', templateId);

// Delete group (soft delete)
export const deleteGroup = async (groupId: number): Promise<ApiResponse<void>> => plDelete('group', groupId);

// Delete section (soft delete)
export const deleteSection = async (sectionId: number): Promise<ApiResponse<void>> => plDelete('section', sectionId);

// Delete account assignment
export const deleteAccountAssignment = async (sectionAccountId: number): Promise<ApiResponse<void>> => {
  try {
    const baseUrl = BASE_URL;
    const response = await fetch(`${baseUrl}/pl/account/${sectionAccountId}`, {
      method: 'DELETE',
    });
    const result = await response.json();

    if (result.success) {
      return { success: true };
    }
    return { success: false, error: result.error };
  } catch (error) {
    console.error('Error deleting account assignment:', error);
    return { success: false, error: String(error) };
  }
};

// Remove an account / range from a section (the structure API returns accounts
// without their id, so the row is matched by section + account values)
// POST /pl/section/:section_id/account/remove — database/gl/rr_pl_account_remove.sql
export const removeSectionAccount = async (
  sectionId: number,
  account: { account_code?: string | null; account_from?: string | null; account_to?: string | null },
): Promise<ApiResponse<void>> => {
  try {
    const body = JSON.stringify({
      account_code: account.account_code || null,
      account_from: account.account_from || null,
      account_to: account.account_to || null,
    });
    // Served under /pl/ like the other template endpoints; depending on which ORDS
    // module the script found, it can also sit directly under the base path.
    let response: Response | null = null;
    let result: any = {};
    for (const url of [`${BASE_URL}/pl/section/${sectionId}/account/remove`, `${BASE_URL}/section/${sectionId}/account/remove`]) {
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body,
        });
      } catch {
        // ORDS answers an unknown path without CORS headers → the browser reports "Failed to fetch"
        response = null;
        continue;
      }
      result = await response.json().catch(() => ({}));
      // ORDS' own 404 (no such endpoint) has no "success" field; the handler's 404 does
      const missing = response.status === 404 && result?.success === undefined;
      if (!missing) break;
      response = null;
    }
    if (!response) {
      return { success: false, error: 'Remove-account service not deployed — run database/gl/rr_pl_account_remove.sql' };
    }
    if (result.success) return { success: true };
    return { success: false, error: result.error || `HTTP ${response.status}` };
  } catch (error) {
    console.error('Error removing section account:', error);
    return { success: false, error: String(error) };
  }
};

// Move / add accounts to a section in ONE transaction: put in the target section and taken out of the
// other sections of the template (single-account rows; accounts inside a range elsewhere are reported).
// POST /pl/account/move — database/gl/rr_pl_account_move.sql
export interface MoveAccountsResult {
  moved: number; added: number; removed: number; unchanged: number;
  ranged: { account: string; section: string; from: string; to: string }[];
}
export const moveAccounts = async (
  sectionId: number,
  accounts: string[],
): Promise<ApiResponse<MoveAccountsResult> & { notDeployed?: boolean }> => {
  let response: Response;
  try {
    response = await fetch(`${BASE_URL}/pl/account/move`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ section_id: sectionId, accounts }),
    });
  } catch {
    // unknown ORDS path has no CORS headers → "Failed to fetch"
    return { success: false, notDeployed: true, error: 'Move service not deployed — run database/gl/rr_pl_account_move.sql' };
  }
  const result = await response.json().catch(() => ({} as any));
  if (response.status === 404 && result?.success === undefined) {
    return { success: false, notDeployed: true, error: 'Move service not deployed — run database/gl/rr_pl_account_move.sql' };
  }
  if (result?.success) {
    return { success: true, data: { moved: result.moved || 0, added: result.added || 0, removed: result.removed || 0,
      unchanged: result.unchanged || 0, ranged: result.ranged || [] } };
  }
  return { success: false, error: result?.error || `HTTP ${response.status}` };
};

// Delete total
export const deleteTotal = async (totalId: number): Promise<ApiResponse<void>> => plDelete('total', totalId);

// Group types for dropdown
// Update a calculated total (e.g. its formula) — PUT /pl/total/:total_id
export const updateTotal = async (
  totalId: number,
  changes: { calculation_formula?: string; total_name?: string; display_order?: number },
): Promise<ApiResponse<void>> => {
  try {
    const response = await fetch(`${BASE_URL}/pl/total/${totalId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(changes),
    });
    const text = await response.text();
    let result: any = null;
    try { result = text ? JSON.parse(text) : null; } catch { /* ORDS HTML error page */ }
    if (result?.success) return { success: true };
    return { success: false, error: result?.error || `Update total service not available (HTTP ${response.status})` };
  } catch (error) {
    return { success: false, error: String(error) };
  }
};

export const GROUP_TYPES = [
  { value: 'REVENUE', label: 'Revenue' },
  { value: 'EXPENSE', label: 'Expense' },
  { value: 'OTHER_INCOME', label: 'Other Income' },
  { value: 'OTHER_EXPENSE', label: 'Other Expense' },
  { value: 'TAX', label: 'Tax' },
  { value: 'COMPREHENSIVE', label: 'Comprehensive Income' },
  { value: 'CALCULATED', label: 'Calculated' },
];

// Template types for dropdown
export const TEMPLATE_TYPES = [
  { value: 'STANDARD', label: 'Standard' },
  { value: 'MANAGEMENT', label: 'Management' },
  { value: 'REGULATORY', label: 'Regulatory' },
  { value: 'CUSTOM', label: 'Custom' },
];
