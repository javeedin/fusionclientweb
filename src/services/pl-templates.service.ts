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

// Delete template (soft delete)
export const deleteTemplate = async (templateId: number): Promise<ApiResponse<void>> => {
  try {
    const baseUrl = BASE_URL;
    const response = await fetch(`${baseUrl}/pl/template/${templateId}`, {
      method: 'DELETE',
    });
    const result = await response.json();

    if (result.success) {
      return { success: true };
    }
    return { success: false, error: result.error };
  } catch (error) {
    console.error('Error deleting template:', error);
    return { success: false, error: String(error) };
  }
};

// Delete group (soft delete)
export const deleteGroup = async (groupId: number): Promise<ApiResponse<void>> => {
  try {
    const baseUrl = BASE_URL;
    const response = await fetch(`${baseUrl}/pl/group/${groupId}`, {
      method: 'DELETE',
    });
    const result = await response.json();

    if (result.success) {
      return { success: true };
    }
    return { success: false, error: result.error };
  } catch (error) {
    console.error('Error deleting group:', error);
    return { success: false, error: String(error) };
  }
};

// Delete section (soft delete)
export const deleteSection = async (sectionId: number): Promise<ApiResponse<void>> => {
  try {
    const baseUrl = BASE_URL;
    const response = await fetch(`${baseUrl}/pl/section/${sectionId}`, {
      method: 'DELETE',
    });
    const result = await response.json();

    if (result.success) {
      return { success: true };
    }
    return { success: false, error: result.error };
  } catch (error) {
    console.error('Error deleting section:', error);
    return { success: false, error: String(error) };
  }
};

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

// Delete total
export const deleteTotal = async (totalId: number): Promise<ApiResponse<void>> => {
  try {
    const baseUrl = BASE_URL;
    const response = await fetch(`${baseUrl}/pl/total/${totalId}`, {
      method: 'DELETE',
    });
    const result = await response.json();

    if (result.success) {
      return { success: true };
    }
    return { success: false, error: result.error };
  } catch (error) {
    console.error('Error deleting total:', error);
    return { success: false, error: String(error) };
  }
};

// Group types for dropdown
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
