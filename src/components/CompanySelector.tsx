import React from 'react';
import { getCurrentCompany } from '../config/company.config';
import styles from './CompanySelector.module.css';

export const CompanySelector: React.FC = () => {
  const currentCompany = getCurrentCompany();

  return (
    <div className={styles.companySelectorContainer}>
      <span className={styles.badge} title={currentCompany.name}>
        {currentCompany.code}
      </span>
    </div>
  );
};

export default CompanySelector;
