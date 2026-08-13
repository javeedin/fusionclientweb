export type CompanyCode = 'BUMERIC' | 'MITSUMI' | 'GRAYSINC';

export interface CompanyConfig {
  code: CompanyCode;
  name: string;
  apexBaseUrl: string;
  fusionBaseUrl: string;
  hcmBaseUrl: string;
  fusionUser: string;
  fusionPassword: string;
}

const COMPANIES: Record<CompanyCode, CompanyConfig> = {
  BUMERIC: {
    code: 'BUMERIC',
    name: 'BUMERIC',
    apexBaseUrl: process.env.REACT_APP_BUMERIC_APEX_BASE_URL || '',
    fusionBaseUrl: process.env.REACT_APP_BUMERIC_FUSION_BASE_URL || '',
    hcmBaseUrl: process.env.REACT_APP_BUMERIC_HCM_BASE_URL || '',
    fusionUser: process.env.REACT_APP_BUMERIC_FUSION_USER || '',
    fusionPassword: process.env.REACT_APP_BUMERIC_FUSION_PASSWORD || '',
  },
  MITSUMI: {
    code: 'MITSUMI',
    name: 'MITSUMI',
    apexBaseUrl: process.env.REACT_APP_MITSUMI_APEX_BASE_URL || '',
    fusionBaseUrl: process.env.REACT_APP_MITSUMI_FUSION_BASE_URL || '',
    hcmBaseUrl: process.env.REACT_APP_MITSUMI_HCM_BASE_URL || '',
    fusionUser: process.env.REACT_APP_MITSUMI_FUSION_USER || '',
    fusionPassword: process.env.REACT_APP_MITSUMI_FUSION_PASSWORD || '',
  },
  GRAYSINC: {
    code: 'GRAYSINC',
    name: 'GRAYS INC',
    apexBaseUrl: process.env.REACT_APP_GRAYSINC_APEX_BASE_URL || '',
    fusionBaseUrl: process.env.REACT_APP_GRAYSINC_FUSION_BASE_URL || '',
    hcmBaseUrl: process.env.REACT_APP_GRAYSINC_HCM_BASE_URL || '',
    fusionUser: process.env.REACT_APP_GRAYSINC_FUSION_USER || '',
    fusionPassword: process.env.REACT_APP_GRAYSINC_FUSION_PASSWORD || '',
  },
};

// Get current company from env or localStorage
export function getCurrentCompany(): CompanyConfig {
  const storedCompany = localStorage.getItem('selectedCompany') as CompanyCode | null;
  const companyCode = storedCompany || (process.env.REACT_APP_COMPANY as CompanyCode) || 'BUMERIC';
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
