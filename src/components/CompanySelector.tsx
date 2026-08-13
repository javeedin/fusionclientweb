import React, { useState } from 'react';
import { Select, Button, Modal, Spin } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import { getCurrentCompany, getAllCompanies, setCurrentCompany, isCompanySelectionDisabled } from '../config/company.config';
import type { CompanyCode, CompanyConfig } from '../config/company.config';
import styles from './CompanySelector.module.css';

export const CompanySelector: React.FC = () => {
  const companySelectionDisabled = isCompanySelectionDisabled();
  const [currentCompany, setCurrentCompanyState] = useState<CompanyConfig>(getCurrentCompany());
  const [isLoading, setIsLoading] = useState(false);
  const allCompanies = getAllCompanies();

  const handleCompanyChange = (value: CompanyCode) => {
    if (value === currentCompany.code) return;

    Modal.confirm({
      title: 'Switch Company',
      content: `You are about to switch from ${currentCompany.name} to ${
        allCompanies.find((c) => c.code === value)?.name
      }. This will reload the application.`,
      okText: 'Switch',
      cancelText: 'Cancel',
      onOk() {
        setIsLoading(true);
        try {
          setCurrentCompany(value);
        } catch (error) {
          console.error('Failed to switch company:', error);
          setIsLoading(false);
        }
      },
    });
  };

  // If company selection is disabled, show read-only badge
  if (companySelectionDisabled) {
    return (
      <div className={styles.companySelectorContainer}>
        <div className={styles.selectorWrapper}>
          <label className={styles.label}>Company:</label>
          <span className={styles.badge} title={currentCompany.name}>
            {currentCompany.code}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.companySelectorContainer}>
      <Spin spinning={isLoading}>
        <div className={styles.selectorWrapper}>
          <label className={styles.label}>Company:</label>
          <Select
            value={currentCompany.code}
            onChange={handleCompanyChange}
            disabled={isLoading}
            className={styles.select}
            options={allCompanies.map((company) => ({
              label: company.name,
              value: company.code,
            }))}
          />
          <span className={styles.badge} title={currentCompany.name}>
            {currentCompany.code}
          </span>
        </div>
      </Spin>
    </div>
  );
};

export default CompanySelector;
