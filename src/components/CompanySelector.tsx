import React from 'react';
import { getCurrentCompany, isCompanySelectionDisabled } from '../config/company.config';
import { Tag } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import styles from './CompanySelector.module.css';

export const CompanySelector: React.FC = () => {
  const currentCompany = getCurrentCompany();
  const isDisabled = isCompanySelectionDisabled();

  // When disabled, show company name as a locked badge
  if (isDisabled) {
    return (
      <Tag
        icon={<LockOutlined />}
        style={{
          marginLeft: 6,
          marginRight: 0,
          fontWeight: 600,
          background: 'rgba(255,255,255,0.15)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.3)'
        }}
        title={currentCompany.name}
      >
        {currentCompany.code}
      </Tag>
    );
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
