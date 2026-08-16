import { ORACLE_SOAP_CONFIG } from '../config/api.config';
import { callSoapBip } from './sync-http';

export interface CustomerSearchResult {
  partyNumber: string;
  accountName: string;
  accountNumber: string;
  address1?: string;
  address2?: string;
  city?: string;
  country?: string;
  creditLimit?: number;
  prCreditLimit?: number;
  customerClassCode?: string;
  status?: string;
  custAccountId?: string;
  partyId?: string;
  billToSiteUseId?: string;
  shipToPartySiteId?: string;
  buName?: string;
  [key: string]: any;
}

export interface BIPSearchParams {
  CUSTOMER_NAME: string;
  account_number: string;
  BUSINESS_UNIT_ID: string;
}

const buildCustomerSearchSoapEnvelope = (
  reportPath: string,
  parameters: BIPSearchParams,
  username: string,
  password: string
): string => {
  const paramXml = Object.entries(parameters)
    .map(([key, value]) => `
            <v2:item>
              <v2:name>${key}</v2:name>
              <v2:values><v2:item>${value}</v2:item></v2:values>
            </v2:item>`)
    .join('');

  return `<?xml version="1.0" encoding="utf-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v2="http://xmlns.oracle.com/oxp/service/v2">
  <soapenv:Header/>
  <soapenv:Body>
    <v2:runReport>
      <v2:reportRequest>
        <v2:reportAbsolutePath>${reportPath}</v2:reportAbsolutePath>
        <v2:parameterNameValues>
          <v2:listOfParamNameValues>${paramXml}
          </v2:listOfParamNameValues>
        </v2:parameterNameValues>
        <v2:reportData/>
        <v2:reportOutputPath/>
      </v2:reportRequest>
      <v2:userID>${username}</v2:userID>
      <v2:password>${password}</v2:password>
    </v2:runReport>
  </soapenv:Body>
</soapenv:Envelope>`;
};

const parseCustomerSearchXml = (xmlString: string): CustomerSearchResult[] => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

  const parseError = xmlDoc.querySelector('parsererror');
  if (parseError) {
    throw new Error('XML Parse Error: ' + parseError.textContent);
  }

  const records: CustomerSearchResult[] = [];
  const g1Elements = xmlDoc.querySelectorAll('G_1');

  g1Elements.forEach((g1) => {
    const getText = (tagName: string): string => {
      const el = g1.querySelector(tagName);
      return el?.textContent?.trim() || '';
    };

    const getNumber = (tagName: string): number | undefined => {
      const text = getText(tagName);
      if (!text) return undefined;
      const num = parseFloat(text);
      return isNaN(num) ? undefined : num;
    };

    const record: CustomerSearchResult = {
      partyNumber: getText('PARTY_NUMBER'),
      accountName: getText('ACCOUNT_NAME'),
      accountNumber: getText('ACCOUNT_NUMBER'),
      address1: getText('ADDRESS1') || undefined,
      address2: getText('ADDRESS2') || undefined,
      city: getText('CITY') || undefined,
      country: getText('COUNTRY') || undefined,
      creditLimit: getNumber('CREDIT_LIMIT'),
      prCreditLimit: getNumber('PR_CREDIT_LIMIT'),
      customerClassCode: getText('CUSTOMER_CLASS_CODE') || undefined,
      status: getText('STATUS') || undefined,
      custAccountId: getText('CUST_ACCOUNT_ID') || undefined,
      partyId: getText('PARTY_ID') || undefined,
      billToSiteUseId: getText('BILL_TO_SITE_USE_ID') || undefined,
      shipToPartySiteId: getText('SHIP_TO_PARTY_SITE_ID') || undefined,
      buName: getText('BU_NAME') || undefined,
    };

    records.push(record);
  });

  return records;
};

export interface CustomerSearchResponse {
  success: boolean;
  customers?: CustomerSearchResult[];
  error?: string;
  details?: string;
  soapEnvelope?: string;
  soapUrl?: string;
  duration?: number;
}

export const searchCustomersByBIP = async (
  businessUnitId: string,
  customerName: string,
  soapBaseUrl: string,
  username: string,
  password: string,
  searchType: 'name' | 'account' = 'name'
): Promise<CustomerSearchResponse> => {
  try {
    const reportPath = '/Custom/fusion_client/AR/CUSTOMER_SEARCH_BY_NAME_BIP.xdo';

    const parameters: any = {
      BUSINESS_UNIT_ID: businessUnitId,
    };

    if (searchType === 'name') {
      parameters.CUSTOMER_NAME = customerName;
    } else {
      parameters.account_number = customerName;
    }

    const envelope = buildCustomerSearchSoapEnvelope(reportPath, parameters, username, password);

    const result = await callSoapBip(soapBaseUrl, envelope);

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        details: result.details,
        soapEnvelope: envelope,
        soapUrl: soapBaseUrl,
      };
    }

    const customers = parseCustomerSearchXml(result.decodedXml || '');

    return {
      success: true,
      customers,
      duration: result.duration,
      soapEnvelope: envelope,
      soapUrl: soapBaseUrl,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: errorMsg,
    };
  }
};

export const convertBipCustomerToFill = (customer: CustomerSearchResult) => {
  const join = (...parts: (string | undefined)[]): string | undefined => {
    const filtered = parts.filter(Boolean);
    return filtered.length ? filtered.join(', ') : undefined;
  };

  return {
    customerName: customer.accountName,
    accountNumber: customer.accountNumber,
    billToSite: customer.billToSiteUseId,
    shipToSite: customer.shipToPartySiteId,
    billToAddress: join(customer.address1, customer.address2, customer.city),
    shipToAddress: join(customer.address1, customer.address2, customer.city, customer.country),
    custAccountId: customer.custAccountId,
    partyId: customer.partyId,
    creditLimit: customer.prCreditLimit || customer.creditLimit,
  };
};
