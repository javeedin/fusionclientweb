import React from 'react';
import { getCurrentCompany, isCompanySelectionDisabled } from '../config/company.config';
import styles from './CompanySelector.module.css';

export const CompanySelector: React.FC = () => {
  const currentCompany = getCurrentCompany();
  const isDisabled = isCompanySelectionDisabled();

  // Hide the selector entirely when company selection is disabled
  if (isDisabled) {
    return null;
  }

  return (
    <div className={styles.companySelectorContainer}>
      <span className={styles.badge} title={currentCompany.name}>
        {currentCompany.code}
      </span>
    </div>
  );
};

export default CompanySelector;
