export type CompanyCode = 'BUMERIC' | 'MITSUMI' | 'GRAYSINC';

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
  fusionUser: string;
  fusionPassword: string;
  fusionInstances: FusionInstance[];
}

const parseFusionInstances = (instancesJson: string, companyCode: string): FusionInstance[] => {
  try {
    console.log(`[DEBUG] Parsing Fusion instances for ${companyCode}:`, instancesJson);
    const result = JSON.parse(instancesJson || '[]');
    console.log(`[DEBUG] Parsed instances for ${companyCode}:`, result);
    return result;
  } catch (error) {
    console.error(`[ERROR] Failed to parse Fusion instances for ${companyCode}:`, error, 'Raw value:', instancesJson);
    return [];
  }
};

// Debug: Log all env variables
console.log('[DEBUG] Environment Variables:');
console.log('BUMERIC_INSTANCES:', import.meta.env.REACT_APP_BUMERIC_FUSION_INSTANCES);
console.log('MITSUMI_INSTANCES:', import.meta.env.REACT_APP_MITSUMI_FUSION_INSTANCES);
console.log('GRAYSINC_INSTANCES:', import.meta.env.REACT_APP_GRAYSINC_FUSION_INSTANCES);

const COMPANIES: Record<CompanyCode, CompanyConfig> = {
  BUMERIC: {
    code: 'BUMERIC',
    name: 'BUMERIC',
    apexBaseUrl: import.meta.env.REACT_APP_BUMERIC_APEX_BASE_URL || '',
    fusionBaseUrl: import.meta.env.REACT_APP_BUMERIC_FUSION_BASE_URL || '',
    hcmBaseUrl: import.meta.env.REACT_APP_BUMERIC_HCM_BASE_URL || '',
    fusionUser: import.meta.env.REACT_APP_BUMERIC_FUSION_USER || '',
    fusionPassword: import.meta.env.REACT_APP_BUMERIC_FUSION_PASSWORD || '',
    fusionInstances: parseFusionInstances(import.meta.env.REACT_APP_BUMERIC_FUSION_INSTANCES || '', 'BUMERIC'),
  },
  MITSUMI: {
    code: 'MITSUMI',
    name: 'MITSUMI',
    apexBaseUrl: import.meta.env.REACT_APP_MITSUMI_APEX_BASE_URL || '',
    fusionBaseUrl: import.meta.env.REACT_APP_MITSUMI_FUSION_BASE_URL || '',
    hcmBaseUrl: import.meta.env.REACT_APP_MITSUMI_HCM_BASE_URL || '',
    fusionUser: import.meta.env.REACT_APP_MITSUMI_FUSION_USER || '',
    fusionPassword: import.meta.env.REACT_APP_MITSUMI_FUSION_PASSWORD || '',
    fusionInstances: parseFusionInstances(import.meta.env.REACT_APP_MITSUMI_FUSION_INSTANCES || '', 'MITSUMI'),
  },
  GRAYSINC: {
    code: 'GRAYSINC',
    name: 'GRAYS INC',
    apexBaseUrl: import.meta.env.REACT_APP_GRAYSINC_APEX_BASE_URL || '',
    fusionBaseUrl: import.meta.env.REACT_APP_GRAYSINC_FUSION_BASE_URL || '',
    hcmBaseUrl: import.meta.env.REACT_APP_GRAYSINC_HCM_BASE_URL || '',
    fusionUser: import.meta.env.REACT_APP_GRAYSINC_FUSION_USER || '',
    fusionPassword: import.meta.env.REACT_APP_GRAYSINC_FUSION_PASSWORD || '',
    fusionInstances: parseFusionInstances(import.meta.env.REACT_APP_GRAYSINC_FUSION_INSTANCES || '', 'GRAYSINC'),
  },
};

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
  return 'BUMERIC';
}

// Get current company from env or localStorage
export function getCurrentCompany(): CompanyConfig {
  // If company selection is disabled, always use default company
  if (isCompanySelectionDisabled()) {
    const defaultCompany = getDefaultCompany();
    return COMPANIES[defaultCompany];
  }

  const storedCompany = localStorage.getItem('selectedCompany') as CompanyCode | null;
  const companyCode = storedCompany || (import.meta.env.REACT_APP_COMPANY as CompanyCode) || 'BUMERIC';
  return COMPANIES[companyCode] || COMPANIES.BUMERIC;
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
