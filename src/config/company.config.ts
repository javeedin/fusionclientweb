export type CompanyCode = 'BUIMERC' | 'MITSUMI' | 'GRAYSINC';

export interface FusionInstance {
  name: string;
  url: string;
}

export interface CompanyConfig {
  code: CompanyCode;
  name: string;
  apexBaseUrl: string;
  fusionBaseUrl: string;
  hcmBaseUrl: string;
  fusionInstances: FusionInstance[];
}

const parseFusionInstances = (instancesJson: string, companyCode: string): FusionInstance[] => {
  try {
    return JSON.parse(instancesJson || '[]');
  } catch {
    console.error(`Failed to parse Fusion instances for ${companyCode}`);
    return [];
  }
};

const COMPANIES: Record<CompanyCode, CompanyConfig> = {
  BUIMERC: {
    code: 'BUIMERC',
    name: 'BUIMERC',
    apexBaseUrl: import.meta.env.REACT_APP_BUIMERC_APEX_BASE_URL || '',
    fusionBaseUrl: import.meta.env.REACT_APP_BUIMERC_FUSION_BASE_URL || '',
    hcmBaseUrl: import.meta.env.REACT_APP_BUIMERC_HCM_BASE_URL || '',
    fusionInstances: parseFusionInstances(import.meta.env.REACT_APP_BUIMERC_FUSION_INSTANCES || '', 'BUIMERC'),
  },
  MITSUMI: {
    code: 'MITSUMI',
    name: 'MITSUMI',
    apexBaseUrl: import.meta.env.REACT_APP_MITSUMI_APEX_BASE_URL || '',
    fusionBaseUrl: import.meta.env.REACT_APP_MITSUMI_FUSION_BASE_URL || '',
    hcmBaseUrl: import.meta.env.REACT_APP_MITSUMI_HCM_BASE_URL || '',
    fusionInstances: parseFusionInstances(import.meta.env.REACT_APP_MITSUMI_FUSION_INSTANCES || '', 'MITSUMI'),
  },
  GRAYSINC: {
    code: 'GRAYSINC',
    name: 'GRAYS INC',
    apexBaseUrl: import.meta.env.REACT_APP_GRAYSINC_APEX_BASE_URL || '',
    fusionBaseUrl: import.meta.env.REACT_APP_GRAYSINC_FUSION_BASE_URL || '',
    hcmBaseUrl: import.meta.env.REACT_APP_GRAYSINC_HCM_BASE_URL || '',
    fusionInstances: parseFusionInstances(import.meta.env.REACT_APP_GRAYSINC_FUSION_INSTANCES || '', 'GRAYSINC'),
  },
};

// App branding — BUIMERC ships as "Re-ERP", other companies keep FusionClient
export function getAppBranding(): { name: string; version: string; tagline: string } {
  return getCurrentCompany().code === 'BUIMERC'
    ? { name: 'Re-ERP', version: 'A3.0.0', tagline: 'Enterprise Resource Planning' }
    : { name: 'FusionClient', version: 'V1.0.0', tagline: 'Multi-Tenant ERP Platform' };
}

// Check if company selection is disabled
export function isCompanySelectionDisabled(): boolean {
  const disabled = import.meta.env.REACT_APP_DISABLE_COMPANY_SELECTION as string || 'no';
  return disabled.toLowerCase() === 'yes';
}

// Get default company
export function getDefaultCompany(): CompanyCode {
  const defaultCompany = import.meta.env.REACT_APP_DEFAULT_COMPANY as CompanyCode;
  if (defaultCompany && COMPANIES[defaultCompany]) {
    return defaultCompany;
  }
  return 'BUIMERC';
}

// Get current company from env or localStorage
export function getCurrentCompany(): CompanyConfig {
  // If company selection is disabled, always use default company
  if (isCompanySelectionDisabled()) {
    const defaultCompany = getDefaultCompany();
    return COMPANIES[defaultCompany];
  }

  const storedCompany = localStorage.getItem('selectedCompany') as CompanyCode | null;
  const companyCode = storedCompany || (import.meta.env.REACT_APP_COMPANY as CompanyCode) || 'BUIMERC';
  return COMPANIES[companyCode] || COMPANIES.BUIMERC;
}

export function getCompany(code: CompanyCode): CompanyConfig {
  return COMPANIES[code];
}

export function getAllCompanies(): CompanyConfig[] {
  return Object.values(COMPANIES);
}

export function setCurrentCompany(code: CompanyCode): void {
  localStorage.setItem('selectedCompany', code);
  window.location.reload();
}

// Helper functions to get company-specific APEX endpoints
export function getApexAuthUrl(): string {
  const company = getCurrentCompany();
  return `${company.apexBaseUrl}/auth`;
}

export function getApexAdminUrl(): string {
  const company = getCurrentCompany();
  return `${company.apexBaseUrl}/admin`;
}

export function getApexBaseUrl(): string {
  const company = getCurrentCompany();
  return company.apexBaseUrl;
}

// Get BUIMERC APEX base URL for shared services (e.g., currency rates webservice)
// This is an exception - currency rates webservice is centralized in BUIMERC
export function getBuimercApexBaseUrl(): string {
  return COMPANIES.BUIMERC.apexBaseUrl;
}

// Get ORDS hostname (dynamic) - can be configured via environment variable
// Path /ords/test/FUSIONCLIENTERP/inventory/itemmaster is fixed for all companies
export function getOrdsHostname(): string {
  return import.meta.env.REACT_APP_ORDS_HOSTNAME || 'https://g827cd88c3cfc03-mitsumioracledb.adb.me-dubai-1.oraclecloudapps.com';
}
