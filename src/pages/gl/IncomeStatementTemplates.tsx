import React, { useState, useEffect } from 'react';
import {
  Layout,
  Typography,
  Card,
  Breadcrumb,
  Space,
  Button,
  Table,
  Modal,
  Form,
  Input,
  Select,
  InputNumber,
  message,
  Spin,
  Tag,
  Tooltip,
  Divider,
  Empty,
  Popconfirm,
  Row,
  Col,
  Tabs,
  Tree,
} from 'antd';
import type { DataNode } from 'antd/es/tree';
import {
  HomeOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CopyOutlined,
  EyeOutlined,
  SaveOutlined,
  FileTextOutlined,
  FileExcelOutlined,
  FolderOutlined,
  FolderOpenOutlined,
  AppstoreOutlined,
  CalculatorOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  CloseOutlined,
  BankOutlined,
  NumberOutlined,
  MinusCircleOutlined,
  PlusCircleOutlined,
  CaretDownOutlined,
  CaretRightOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import * as plService from '../../services/pl-templates.service';

const { Content } = Layout;
const { Title, Text } = Typography;
const { TextArea } = Input;

// Oracle Redwood Color Palette
const REDWOOD = {
  primary: '#C74634',
  primaryLight: '#E85D4A',
  success: '#1D7B4D',
  warning: '#D4A800',
  info: '#0572CE',
  neutral100: '#F7F7F7',
  neutral200: '#E5E5E5',
  neutral300: '#C7C7C7',
  neutral600: '#6B6B6B',
  neutral900: '#1A1A1A',
  surface: '#FFFFFF',
};

// Group type colors
const GROUP_TYPE_COLORS: Record<string, string> = {
  REVENUE: '#52c41a',
  EXPENSE: '#f5222d',
  OTHER_INCOME: '#1890ff',
  OTHER_EXPENSE: '#fa8c16',
  TAX: '#722ed1',
  COMPREHENSIVE: '#13c2c2',
  CALCULATED: '#8c8c8c',
};

interface TemplateTab {
  key: string;
  label: string;
  templateId: number;
  template: plService.PLTemplateStructure | null;
  loading: boolean;
}

const IncomeStatementTemplates: React.FC = () => {
  // State
  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<plService.PLTemplate[]>([]);
  const [activeTabKey, setActiveTabKey] = useState('list');
  const [templateTabs, setTemplateTabs] = useState<TemplateTab[]>([]);

  // Modal states
  const [templateModalVisible, setTemplateModalVisible] = useState(false);
  const [groupModalVisible, setGroupModalVisible] = useState(false);
  const [sectionModalVisible, setSectionModalVisible] = useState(false);
  const [accountModalVisible, setAccountModalVisible] = useState(false);
  const [totalModalVisible, setTotalModalVisible] = useState(false);
  const [cloneModalVisible, setCloneModalVisible] = useState(false);
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [excelModalVisible, setExcelModalVisible] = useState(false);
  const [excelTemplate, setExcelTemplate] = useState<plService.PLTemplateStructure | null>(null);

  // Edit context
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<number | null>(null);
  const [cloneTemplateId, setCloneTemplateId] = useState<number | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<plService.PLTemplateStructure | null>(null);

  // Forms
  const [templateForm] = Form.useForm();
  const [groupForm] = Form.useForm();
  const [sectionForm] = Form.useForm();
  const [accountForm] = Form.useForm();
  const [totalForm] = Form.useForm();
  const [cloneForm] = Form.useForm();

  // GL Accounts state
  const [glAccounts, setGlAccounts] = useState<plService.GLAccount[]>([]);
  const [glAccountsLoading, setGlAccountsLoading] = useState(false);
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [accountSearchText, setAccountSearchText] = useState('');

  // Load GL accounts
  const loadGLAccounts = async () => {
    setGlAccountsLoading(true);
    try {
      const response = await plService.getGLAccounts();
      if (response.success && response.data) {
        setGlAccounts(response.data);
      } else {
        message.error(response.error || 'Failed to load GL accounts');
      }
    } catch (error) {
      message.error('Failed to load GL accounts');
    }
    setGlAccountsLoading(false);
  };

  // Load templates on mount
  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    setLoading(true);
    try {
      const response = await plService.getTemplates();
      if (response.success && response.data) {
        setTemplates(response.data);
      } else {
        message.error(response.error || 'Failed to load templates');
      }
    } catch (error) {
      message.error('Failed to load templates');
    }
    setLoading(false);
  };

  const loadTemplateStructure = async (templateId: number, tabKey: string) => {
    // Update tab loading state
    setTemplateTabs(prev => prev.map(t =>
      t.key === tabKey ? { ...t, loading: true } : t
    ));

    try {
      const response = await plService.getTemplateStructure(templateId);
      if (response.success && response.data) {
        setTemplateTabs(prev => prev.map(t =>
          t.key === tabKey ? { ...t, template: response.data!, loading: false } : t
        ));
      } else {
        message.error(response.error || 'Failed to load template structure');
        setTemplateTabs(prev => prev.map(t =>
          t.key === tabKey ? { ...t, loading: false } : t
        ));
      }
    } catch (error) {
      message.error('Failed to load template structure');
      setTemplateTabs(prev => prev.map(t =>
        t.key === tabKey ? { ...t, loading: false } : t
      ));
    }
  };

  const openTemplateTab = (template: plService.PLTemplate) => {
    const tabKey = `template-${template.template_id}`;

    // Check if tab already exists
    const existingTab = templateTabs.find(t => t.key === tabKey);
    if (existingTab) {
      setActiveTabKey(tabKey);
      return;
    }

    // Create new tab
    const newTab: TemplateTab = {
      key: tabKey,
      label: template.template_name,
      templateId: template.template_id,
      template: null,
      loading: true,
    };

    setTemplateTabs(prev => [...prev, newTab]);
    setActiveTabKey(tabKey);
    loadTemplateStructure(template.template_id, tabKey);
  };

  const closeTemplateTab = (tabKey: string) => {
    const newTabs = templateTabs.filter(t => t.key !== tabKey);
    setTemplateTabs(newTabs);

    if (activeTabKey === tabKey) {
      setActiveTabKey(newTabs.length > 0 ? newTabs[newTabs.length - 1].key : 'list');
    }
  };

  const getCurrentTemplateTab = (): TemplateTab | undefined => {
    return templateTabs.find(t => t.key === activeTabKey);
  };

  const refreshCurrentTab = () => {
    const tab = getCurrentTemplateTab();
    if (tab) {
      loadTemplateStructure(tab.templateId, tab.key);
    }
  };

  // Template CRUD
  const handleCreateTemplate = async (values: any) => {
    try {
      const response = await plService.createTemplate(
        values.template_code,
        values.template_name,
        values.description,
        values.template_type
      );
      if (response.success && response.data) {
        message.success('Template created successfully');
        setTemplateModalVisible(false);
        templateForm.resetFields();
        loadTemplates();
        // Open the new template in a tab
        const newTemplate: plService.PLTemplate = {
          template_id: response.data.template_id,
          template_code: values.template_code,
          template_name: values.template_name,
          description: values.description,
          template_type: values.template_type,
          is_active: 'Y',
          is_default: 'N',
          created_date: new Date().toISOString(),
        };
        openTemplateTab(newTemplate);
      } else {
        message.error(response.error || 'Failed to create template');
      }
    } catch (error) {
      message.error('Failed to create template');
    }
  };

  const handleDeleteTemplate = async (templateId: number) => {
    try {
      const response = await plService.deleteTemplate(templateId);
      if (response.success) {
        message.success('Template deleted successfully');
        loadTemplates();
        // Close tab if open
        const tabKey = `template-${templateId}`;
        closeTemplateTab(tabKey);
      } else {
        message.error(response.error || 'Failed to delete template');
      }
    } catch (error) {
      message.error('Failed to delete template');
    }
  };

  const handleCloneTemplate = async (values: any) => {
    if (!cloneTemplateId) return;
    try {
      const response = await plService.cloneTemplate(
        cloneTemplateId,
        values.new_template_code,
        values.new_template_name
      );
      if (response.success && response.data) {
        message.success('Template cloned successfully');
        setCloneModalVisible(false);
        cloneForm.resetFields();
        setCloneTemplateId(null);
        loadTemplates();
      } else {
        message.error(response.error || 'Failed to clone template');
      }
    } catch (error) {
      message.error('Failed to clone template');
    }
  };

  // Group CRUD
  const handleAddGroup = async (values: any) => {
    const tab = getCurrentTemplateTab();
    if (!tab) return;

    try {
      const response = await plService.addGroup(
        tab.templateId,
        values.group_code,
        values.group_name,
        values.group_label || values.group_name,
        values.group_type,
        values.display_order,
        values.sign_convention
      );
      if (response.success) {
        message.success('Group added successfully');
        setGroupModalVisible(false);
        groupForm.resetFields();
        refreshCurrentTab();
      } else {
        message.error(response.error || 'Failed to add group');
      }
    } catch (error) {
      message.error('Failed to add group');
    }
  };

  const handleDeleteGroup = async (groupId: number) => {
    try {
      const response = await plService.deleteGroup(groupId);
      if (response.success) {
        message.success('Group deleted successfully');
        refreshCurrentTab();
      } else {
        message.error(response.error || 'Failed to delete group');
      }
    } catch (error) {
      message.error('Failed to delete group');
    }
  };

  // Section CRUD
  const handleAddSection = async (values: any) => {
    if (!selectedGroupId) return;
    try {
      const response = await plService.addSection(
        selectedGroupId,
        values.section_code,
        values.section_name,
        values.section_label || values.section_name,
        values.display_order
      );
      if (response.success) {
        message.success('Section added successfully');
        setSectionModalVisible(false);
        sectionForm.resetFields();
        setSelectedGroupId(null);
        refreshCurrentTab();
      } else {
        message.error(response.error || 'Failed to add section');
      }
    } catch (error) {
      message.error('Failed to add section');
    }
  };

  const handleDeleteSection = async (sectionId: number) => {
    try {
      const response = await plService.deleteSection(sectionId);
      if (response.success) {
        message.success('Section deleted successfully');
        refreshCurrentTab();
      } else {
        message.error(response.error || 'Failed to delete section');
      }
    } catch (error) {
      message.error('Failed to delete section');
    }
  };

  // Account CRUD
  const handleAssignAccount = async (values: any) => {
    if (!selectedSectionId) return;
    try {
      const response = await plService.assignAccount(
        selectedSectionId,
        values.account_code,
        values.account_from,
        values.account_to
      );
      if (response.success) {
        message.success('Account assigned successfully');
        setAccountModalVisible(false);
        accountForm.resetFields();
        setSelectedSectionId(null);
        refreshCurrentTab();
      } else {
        message.error(response.error || 'Failed to assign account');
      }
    } catch (error) {
      message.error('Failed to assign account');
    }
  };

  // Handle assigning multiple selected accounts
  const handleAssignSelectedAccounts = async () => {
    if (!selectedSectionId || selectedAccounts.length === 0) {
      message.warning('Please select at least one account');
      return;
    }

    let successCount = 0;
    let failCount = 0;

    for (const accountCode of selectedAccounts) {
      try {
        const response = await plService.assignAccount(
          selectedSectionId,
          accountCode,
          undefined,
          undefined
        );
        if (response.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch {
        failCount++;
      }
    }

    if (successCount > 0) {
      message.success(`${successCount} account(s) assigned successfully`);
    }
    if (failCount > 0) {
      message.error(`${failCount} account(s) failed to assign`);
    }

    setAccountModalVisible(false);
    setSelectedAccounts([]);
    setAccountSearchText('');
    setSelectedSectionId(null);
    refreshCurrentTab();
  };

  // Total CRUD
  const handleAddTotal = async (values: any) => {
    const tab = getCurrentTemplateTab();
    if (!tab) return;

    try {
      const response = await plService.addTotal(
        tab.templateId,
        values.total_code,
        values.total_name,
        values.calculation_formula,
        values.display_order,
        values.after_group_code
      );
      if (response.success) {
        message.success('Total added successfully');
        setTotalModalVisible(false);
        totalForm.resetFields();
        refreshCurrentTab();
      } else {
        message.error(response.error || 'Failed to add total');
      }
    } catch (error) {
      message.error('Failed to add total');
    }
  };

  const handleDeleteTotal = async (totalId: number) => {
    try {
      const response = await plService.deleteTotal(totalId);
      if (response.success) {
        message.success('Total deleted successfully');
        refreshCurrentTab();
      } else {
        message.error(response.error || 'Failed to delete total');
      }
    } catch (error) {
      message.error('Failed to delete total');
    }
  };

  // Build tree data for template structure
  const buildTreeData = (templateData: plService.PLTemplateStructure): DataNode[] => {
    // Safe access with defaults
    const groups = templateData?.template?.groups || [];
    const totals = templateData?.template?.totals || [];

    const treeData: DataNode[] = [];

    // Add groups with their sections and accounts
    groups.forEach(group => {
      const groupNode: DataNode = {
        key: `group-${group.group_id}`,
        title: (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '4px 0' }}>
            <Space>
              <Tag color={GROUP_TYPE_COLORS[group.group_type]} style={{ margin: 0 }}>
                {group.group_type}
              </Tag>
              <Text strong style={{ fontSize: 14 }}>{group.group_name}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>({group.group_code})</Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                Order: {group.display_order} | Sign: {group.sign_convention === 1 ? '+' : '-'}
              </Text>
            </Space>
            <Space size="small" onClick={e => e.stopPropagation()}>
              <Tooltip title="Add Section">
                <Button
                  type="text"
                  size="small"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setSelectedGroupId(group.group_id);
                    sectionForm.setFieldsValue({
                      display_order: ((group.sections || []).length + 1) * 10,
                    });
                    setSectionModalVisible(true);
                  }}
                />
              </Tooltip>
              <Popconfirm
                title="Delete this group?"
                description="All sections and accounts will also be deleted."
                onConfirm={() => handleDeleteGroup(group.group_id)}
                okText="Delete"
                okButtonProps={{ danger: true }}
              >
                <Button type="text" size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            </Space>
          </div>
        ),
        icon: <FolderOutlined style={{ color: GROUP_TYPE_COLORS[group.group_type] }} />,
        children: (group.sections || []).map(section => ({
          key: `section-${section.section_id}`,
          title: (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '2px 0' }}>
              <Space>
                <Text style={{ fontSize: 13 }}>{section.section_name}</Text>
                <Text type="secondary" style={{ fontSize: 11 }}>({section.section_code})</Text>
              </Space>
              <Space size="small" onClick={e => e.stopPropagation()}>
                <Tooltip title="Add Account">
                  <Button
                    type="text"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      setSelectedSectionId(section.section_id);
                      setAccountModalVisible(true);
                      if (glAccounts.length === 0) {
                        loadGLAccounts();
                      }
                    }}
                  />
                </Tooltip>
                <Popconfirm
                  title="Delete this section?"
                  onConfirm={() => handleDeleteSection(section.section_id)}
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                >
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            </div>
          ),
          icon: <AppstoreOutlined style={{ color: REDWOOD.info }} />,
          children: (section.accounts || []).length > 0 ? (section.accounts || []).map((account, idx) => ({
            key: `account-${section.section_id}-${idx}`,
            title: (
              <Space>
                <Text style={{ fontSize: 12 }}>
                  {account.account_from && account.account_to
                    ? `${account.account_from} - ${account.account_to}`
                    : account.account_code}
                </Text>
              </Space>
            ),
            icon: <NumberOutlined style={{ color: REDWOOD.neutral600 }} />,
            isLeaf: true,
          })) : undefined,
        })),
      };
      treeData.push(groupNode);
    });

    // Add totals section
    if (totals.length > 0) {
      const totalsNode: DataNode = {
        key: 'totals',
        title: (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '4px 0' }}>
            <Space>
              <Text strong style={{ fontSize: 14, color: REDWOOD.primary }}>Calculated Totals</Text>
              <Tag color="purple">{totals.length} items</Tag>
            </Space>
          </div>
        ),
        icon: <CalculatorOutlined style={{ color: REDWOOD.primary }} />,
        children: totals.map(total => ({
          key: `total-${total.total_id}`,
          title: (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '2px 0' }}>
              <Space>
                <Tag color="purple" style={{ margin: 0 }}>{total.total_code}</Tag>
                <Text style={{ fontSize: 13 }}>{total.total_name}</Text>
                <Text code style={{ fontSize: 11 }}>{total.calculation_formula}</Text>
                {total.after_group_code && (
                  <Text type="secondary" style={{ fontSize: 11 }}>after {total.after_group_code}</Text>
                )}
              </Space>
              <Popconfirm
                title="Delete this total?"
                onConfirm={() => handleDeleteTotal(total.total_id)}
                okText="Delete"
                okButtonProps={{ danger: true }}
              >
                <Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={e => e.stopPropagation()} />
              </Popconfirm>
            </div>
          ),
          icon: <CalculatorOutlined style={{ color: '#722ed1' }} />,
          isLeaf: true,
        })),
      };
      treeData.push(totalsNode);
    }

    return treeData;
  };

  // Template List View
  const renderTemplateList = () => {
    const columns = [
      {
        title: 'ID',
        dataIndex: 'template_id',
        key: 'template_id',
        width: 60,
        render: (id: number) => <Text type="secondary">{id}</Text>,
      },
      {
        title: 'Template Code',
        dataIndex: 'template_code',
        key: 'template_code',
        width: 150,
        render: (text: string) => <Text strong>{text}</Text>,
      },
      {
        title: 'Template Name',
        dataIndex: 'template_name',
        key: 'template_name',
      },
      {
        title: 'Type',
        dataIndex: 'template_type',
        key: 'template_type',
        width: 120,
        render: (type: string) => (
          <Tag color={type === 'STANDARD' ? 'blue' : type === 'CUSTOM' ? 'green' : 'default'}>
            {type}
          </Tag>
        ),
      },
      {
        title: 'Default',
        dataIndex: 'is_default',
        key: 'is_default',
        width: 80,
        align: 'center' as const,
        render: (val: string) => val === 'Y' ?
          <CheckCircleOutlined style={{ color: REDWOOD.success }} /> :
          <CloseCircleOutlined style={{ color: REDWOOD.neutral300 }} />,
      },
      {
        title: 'Actions',
        key: 'actions',
        width: 200,
        render: (_: any, record: plService.PLTemplate) => (
          <Space size="small">
            <Tooltip title="Edit">
              <Button
                type="primary"
                size="small"
                icon={<EditOutlined />}
                onClick={() => openTemplateTab(record)}
              >
                Edit
              </Button>
            </Tooltip>
            <Tooltip title="Preview">
              <Button
                type="text"
                icon={<EyeOutlined />}
                onClick={async () => {
                  const response = await plService.getTemplateStructure(record.template_id);
                  if (response.success && response.data) {
                    setPreviewTemplate(response.data);
                    setPreviewModalVisible(true);
                  }
                }}
              />
            </Tooltip>
            <Tooltip title="Clone">
              <Button
                type="text"
                icon={<CopyOutlined />}
                onClick={() => {
                  setCloneTemplateId(record.template_id);
                  setCloneModalVisible(true);
                }}
              />
            </Tooltip>
            <Popconfirm
              title="Delete this template?"
              description="This action cannot be undone."
              onConfirm={() => handleDeleteTemplate(record.template_id)}
              okText="Delete"
              okButtonProps={{ danger: true }}
            >
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Popconfirm>
          </Space>
        ),
      },
    ];

    return (
      <div style={{ padding: 16 }}>
        <Card
          title={
            <Space>
              <FileTextOutlined style={{ color: REDWOOD.primary }} />
              <span>P&L Statement Templates</span>
            </Space>
          }
          extra={
            <Space>
              <Button icon={<ReloadOutlined />} onClick={loadTemplates}>
                Refresh
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setTemplateModalVisible(true)}
                style={{ background: REDWOOD.primary }}
              >
                New Template
              </Button>
            </Space>
          }
          style={{ borderRadius: 8 }}
        >
          <Table
            columns={columns}
            dataSource={templates}
            rowKey="template_id"
            loading={loading}
            pagination={{ pageSize: 10 }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="No templates found"
                >
                  <Button type="primary" onClick={() => setTemplateModalVisible(true)}>
                    Create Template
                  </Button>
                </Empty>
              ),
            }}
          />
        </Card>
      </div>
    );
  };

  // Template Editor View (Tab Content)
  const renderTemplateEditor = (tab: TemplateTab) => {
    if (tab.loading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 400 }}>
          <Spin size="large" />
        </div>
      );
    }

    if (!tab.template || !tab.template.template) {
      return (
        <div style={{ padding: 16 }}>
          <Empty description="Failed to load template. Click refresh to try again.">
            <Button onClick={refreshCurrentTab}>Refresh</Button>
          </Empty>
        </div>
      );
    }

    const template = tab.template.template;
    const treeData = buildTreeData(tab.template);

    return (
      <div style={{ padding: 16 }}>
        {/* Template Header */}
        <Card size="small" style={{ marginBottom: 16, borderRadius: 8 }}>
          <Row justify="space-between" align="middle">
            <Col>
              <Space>
                <Tag color="blue" style={{ fontSize: 14, padding: '4px 12px' }}>{template.template_code}</Tag>
                <Title level={4} style={{ margin: 0 }}>{template.template_name}</Title>
                <Tag>{template.template_type}</Tag>
                {template.is_default === 'Y' && <Tag color="green">Default</Tag>}
              </Space>
              {template.description && (
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary">{template.description}</Text>
                </div>
              )}
            </Col>
            <Col>
              <Space>
                <Button
                  icon={<FileExcelOutlined />}
                  onClick={() => {
                    setExcelTemplate(tab.template);
                    setExcelModalVisible(true);
                  }}
                  style={{ background: '#217346', borderColor: '#217346', color: '#fff' }}
                >
                  Edit in Excel
                </Button>
                <Button
                  icon={<EyeOutlined />}
                  onClick={() => {
                    setPreviewTemplate(tab.template);
                    setPreviewModalVisible(true);
                  }}
                >
                  Preview
                </Button>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={refreshCurrentTab}
                >
                  Refresh
                </Button>
              </Space>
            </Col>
          </Row>
        </Card>

        {/* Action Buttons */}
        <Card size="small" style={{ marginBottom: 16, borderRadius: 8 }}>
          <Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                groupForm.setFieldsValue({
                  display_order: ((template.groups || []).length + 1) * 10,
                  sign_convention: 1,
                });
                setGroupModalVisible(true);
              }}
              style={{ background: REDWOOD.success }}
            >
              Add Group
            </Button>
            <Button
              icon={<CalculatorOutlined />}
              onClick={() => {
                totalForm.setFieldsValue({
                  display_order: ((template.totals || []).length + 1) * 10,
                });
                setTotalModalVisible(true);
              }}
            >
              Add Calculated Total
            </Button>
          </Space>
        </Card>

        {/* Hierarchical Tree View */}
        <Card
          title={
            <Space>
              <FolderOpenOutlined style={{ color: REDWOOD.primary }} />
              <span>Template Structure</span>
              <Text type="secondary" style={{ fontWeight: 'normal', fontSize: 12 }}>
                ({(template.groups || []).length} groups, {(template.totals || []).length} totals)
              </Text>
            </Space>
          }
          style={{ borderRadius: 8 }}
          bodyStyle={{ padding: (template.groups || []).length === 0 ? 24 : 0 }}
        >
          {(template.groups || []).length === 0 && (template.totals || []).length === 0 ? (
            <Empty description="No structure defined. Add a group to get started." />
          ) : (
            <Tree
              showIcon
              showLine={{ showLeafIcon: false }}
              defaultExpandAll
              selectable={false}
              treeData={treeData}
              style={{
                padding: 16,
                background: REDWOOD.neutral100,
              }}
              switcherIcon={({ expanded }) =>
                expanded ? <CaretDownOutlined /> : <CaretRightOutlined />
              }
            />
          )}
        </Card>
      </div>
    );
  };

  // Preview Modal
  const renderPreviewModal = () => {
    if (!previewTemplate) return null;

    const template = previewTemplate?.template;
    if (!template) return null;

    // Build preview rows
    const previewRows: Array<{
      key: string;
      label: string;
      indent: number;
      isBold: boolean;
      isTotal?: boolean;
      formula?: string;
    }> = [];

    // Sort groups and totals by display_order
    const groups = template.groups || [];
    const totals = template.totals || [];
    const items: Array<{type: 'group' | 'total', order: number, data: any}> = [
      ...groups.map(g => ({ type: 'group' as const, order: g.display_order, data: g })),
      ...totals.map(t => ({ type: 'total' as const, order: t.display_order, data: t })),
    ].sort((a, b) => a.order - b.order);

    items.forEach(item => {
      if (item.type === 'group') {
        const group = item.data as plService.PLGroup;
        previewRows.push({
          key: `group-${group.group_id}`,
          label: group.group_label || group.group_name,
          indent: 0,
          isBold: true,
        });
        (group.sections || []).forEach(section => {
          previewRows.push({
            key: `section-${section.section_id}`,
            label: section.section_label || section.section_name,
            indent: 1,
            isBold: false,
          });
        });
        if (group.show_subtotal === 'Y' && group.subtotal_label) {
          previewRows.push({
            key: `subtotal-${group.group_id}`,
            label: group.subtotal_label,
            indent: 0,
            isBold: true,
            isTotal: true,
          });
        }
      } else {
        const total = item.data as plService.PLTotal;
        previewRows.push({
          key: `total-${total.total_id}`,
          label: total.total_label || total.total_name,
          indent: 0,
          isBold: true,
          isTotal: true,
          formula: total.calculation_formula,
        });
      }
    });

    return (
      <Modal
        title={`Preview: ${template.template_name}`}
        open={previewModalVisible}
        onCancel={() => {
          setPreviewModalVisible(false);
          setPreviewTemplate(null);
        }}
        footer={null}
        width={700}
      >
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <Title level={4}>Profit and Loss Statement</Title>
          <Text type="secondary">For the Period Ending December 31, 2024</Text>
        </div>

        <Table
          dataSource={previewRows}
          pagination={false}
          showHeader={false}
          rowKey="key"
          size="small"
          columns={[
            {
              dataIndex: 'label',
              key: 'label',
              render: (text, record) => (
                <div style={{
                  paddingLeft: record.indent * 24,
                  fontWeight: record.isBold ? 600 : 400,
                  borderTop: record.isTotal ? `1px solid ${REDWOOD.neutral200}` : 'none',
                  paddingTop: record.isTotal ? 8 : 4,
                  paddingBottom: 4,
                }}>
                  {text}
                  {record.formula && (
                    <Text type="secondary" style={{ marginLeft: 8, fontSize: 11 }}>
                      [{record.formula}]
                    </Text>
                  )}
                </div>
              ),
            },
            {
              key: 'amount',
              width: 120,
              align: 'right' as const,
              render: (_, record) => (
                <div style={{
                  fontWeight: record.isBold ? 600 : 400,
                  borderTop: record.isTotal ? `1px solid ${REDWOOD.neutral200}` : 'none',
                  paddingTop: record.isTotal ? 8 : 4,
                  paddingBottom: 4,
                }}>
                  {record.indent === 1 || record.isTotal ? '0.00' : ''}
                </div>
              ),
            },
          ]}
        />
      </Modal>
    );
  };

  // Excel View Modal
  const renderExcelModal = () => {
    if (!excelTemplate) return null;

    const template = excelTemplate?.template;
    if (!template) return null;

    // Build Excel-like data rows
    const excelData: Array<{
      key: string;
      rowNum: number;
      type: string;
      code: string;
      name: string;
      label: string;
      displayOrder: number;
      formula: string;
      parentCode: string;
    }> = [];

    let rowNum = 1;

    // Add groups and their sections
    (template.groups || []).forEach(group => {
      excelData.push({
        key: `group-${group.group_id}`,
        rowNum: rowNum++,
        type: 'GROUP',
        code: group.group_code,
        name: group.group_name,
        label: group.group_label || '',
        displayOrder: group.display_order,
        formula: '',
        parentCode: '',
      });

      (group.sections || []).forEach(section => {
        excelData.push({
          key: `section-${section.section_id}`,
          rowNum: rowNum++,
          type: 'SECTION',
          code: section.section_code,
          name: section.section_name,
          label: section.section_label || '',
          displayOrder: section.display_order,
          formula: '',
          parentCode: group.group_code,
        });

        (section.accounts || []).forEach((account, idx) => {
          excelData.push({
            key: `account-${section.section_id}-${idx}`,
            rowNum: rowNum++,
            type: 'ACCOUNT',
            code: account.account_code,
            name: account.account_from && account.account_to
              ? `${account.account_from} - ${account.account_to}`
              : account.account_code,
            label: '',
            displayOrder: idx + 1,
            formula: '',
            parentCode: section.section_code,
          });
        });
      });
    });

    // Add totals
    (template.totals || []).forEach(total => {
      excelData.push({
        key: `total-${total.total_id}`,
        rowNum: rowNum++,
        type: 'TOTAL',
        code: total.total_code,
        name: total.total_name,
        label: total.total_label || '',
        displayOrder: total.display_order,
        formula: total.calculation_formula,
        parentCode: total.after_group_code || '',
      });
    });

    const excelColumns = [
      {
        title: '',
        dataIndex: 'rowNum',
        key: 'rowNum',
        width: 40,
        fixed: 'left' as const,
        render: (num: number) => (
          <div style={{
            background: '#f0f0f0',
            textAlign: 'center',
            fontWeight: 500,
            color: '#666',
            padding: '4px 0',
          }}>
            {num}
          </div>
        ),
      },
      {
        title: 'A',
        dataIndex: 'type',
        key: 'type',
        width: 100,
        render: (type: string) => (
          <Tag
            color={
              type === 'GROUP' ? 'blue' :
              type === 'SECTION' ? 'green' :
              type === 'ACCOUNT' ? 'default' :
              'purple'
            }
            style={{ margin: 0 }}
          >
            {type}
          </Tag>
        ),
      },
      {
        title: 'B',
        dataIndex: 'code',
        key: 'code',
        width: 100,
        render: (code: string) => (
          <Input
            size="small"
            defaultValue={code}
            style={{ border: 'none', background: 'transparent' }}
          />
        ),
      },
      {
        title: 'C',
        dataIndex: 'name',
        key: 'name',
        width: 200,
        render: (name: string) => (
          <Input
            size="small"
            defaultValue={name}
            style={{ border: 'none', background: 'transparent' }}
          />
        ),
      },
      {
        title: 'D',
        dataIndex: 'label',
        key: 'label',
        width: 200,
        render: (label: string) => (
          <Input
            size="small"
            defaultValue={label}
            placeholder="Display Label"
            style={{ border: 'none', background: 'transparent' }}
          />
        ),
      },
      {
        title: 'E',
        dataIndex: 'displayOrder',
        key: 'displayOrder',
        width: 80,
        render: (order: number) => (
          <InputNumber
            size="small"
            defaultValue={order}
            style={{ width: '100%', border: 'none', background: 'transparent' }}
          />
        ),
      },
      {
        title: 'F',
        dataIndex: 'formula',
        key: 'formula',
        width: 120,
        render: (formula: string) => (
          <Input
            size="small"
            defaultValue={formula}
            placeholder="Formula"
            style={{ border: 'none', background: 'transparent', fontFamily: 'monospace' }}
          />
        ),
      },
      {
        title: 'G',
        dataIndex: 'parentCode',
        key: 'parentCode',
        width: 100,
        render: (parent: string) => (
          <Input
            size="small"
            defaultValue={parent}
            placeholder="Parent"
            style={{ border: 'none', background: 'transparent' }}
          />
        ),
      },
    ];

    return (
      <Modal
        title={
          <Space>
            <FileExcelOutlined style={{ color: '#217346' }} />
            <span>Edit in Excel - {template.template_name}</span>
          </Space>
        }
        open={excelModalVisible}
        onCancel={() => {
          setExcelModalVisible(false);
          setExcelTemplate(null);
        }}
        width={1200}
        footer={
          <Space>
            <Button onClick={() => {
              setExcelModalVisible(false);
              setExcelTemplate(null);
            }}>
              Cancel
            </Button>
            <Button type="primary" icon={<SaveOutlined />} style={{ background: '#217346' }}>
              Save Changes
            </Button>
          </Space>
        }
        bodyStyle={{ padding: 0 }}
      >
        {/* Excel-like toolbar */}
        <div style={{
          background: '#217346',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}>
          <Text style={{ color: '#fff', fontWeight: 600 }}>
            {template.template_code}
          </Text>
          <div style={{ flex: 1 }} />
          <Space>
            <Button size="small" icon={<PlusOutlined />} style={{ background: '#fff' }}>
              Add Row
            </Button>
            <Button size="small" icon={<DeleteOutlined />} style={{ background: '#fff' }}>
              Delete Row
            </Button>
          </Space>
        </div>

        {/* Column headers row */}
        <div style={{
          background: '#e8e8e8',
          borderBottom: '2px solid #217346',
          padding: '4px 0',
          display: 'flex',
        }}>
          <div style={{ width: 40, textAlign: 'center', fontWeight: 600, color: '#333' }}></div>
          <div style={{ width: 100, textAlign: 'center', fontWeight: 600, color: '#333', borderLeft: '1px solid #ccc' }}>Type</div>
          <div style={{ width: 100, textAlign: 'center', fontWeight: 600, color: '#333', borderLeft: '1px solid #ccc' }}>Code</div>
          <div style={{ width: 200, textAlign: 'center', fontWeight: 600, color: '#333', borderLeft: '1px solid #ccc' }}>Name</div>
          <div style={{ width: 200, textAlign: 'center', fontWeight: 600, color: '#333', borderLeft: '1px solid #ccc' }}>Label</div>
          <div style={{ width: 80, textAlign: 'center', fontWeight: 600, color: '#333', borderLeft: '1px solid #ccc' }}>Order</div>
          <div style={{ width: 120, textAlign: 'center', fontWeight: 600, color: '#333', borderLeft: '1px solid #ccc' }}>Formula</div>
          <div style={{ width: 100, textAlign: 'center', fontWeight: 600, color: '#333', borderLeft: '1px solid #ccc' }}>Parent</div>
        </div>

        {/* Excel-like table */}
        <div style={{ maxHeight: 500, overflow: 'auto' }}>
          <Table
            columns={excelColumns}
            dataSource={excelData}
            pagination={false}
            size="small"
            showHeader={false}
            rowClassName={(record) =>
              record.type === 'GROUP' ? 'excel-row-group' :
              record.type === 'SECTION' ? 'excel-row-section' :
              record.type === 'TOTAL' ? 'excel-row-total' : ''
            }
            style={{
              border: '1px solid #d9d9d9',
            }}
            onRow={(record) => ({
              style: {
                background: record.type === 'GROUP' ? '#e6f7ff' :
                            record.type === 'TOTAL' ? '#f6ffed' :
                            '#fff',
              },
            })}
          />
        </div>

        {/* Status bar */}
        <div style={{
          background: '#217346',
          padding: '4px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}>
          <Text style={{ color: '#fff', fontSize: 12 }}>
            {excelData.length} rows | {(template.groups || []).length} groups | {(template.totals || []).length} totals
          </Text>
          <div style={{ flex: 1 }} />
          <Text style={{ color: '#fff', fontSize: 12 }}>
            Ready
          </Text>
        </div>
      </Modal>
    );
  };

  // Tab items
  const tabItems = [
    {
      key: 'list',
      label: (
        <span>
          <FileTextOutlined />
          Templates
        </span>
      ),
      children: renderTemplateList(),
      closable: false,
    },
    ...templateTabs.map(tab => ({
      key: tab.key,
      label: (
        <span>
          <EditOutlined />
          {tab.label}
        </span>
      ),
      children: renderTemplateEditor(tab),
      closable: true,
    })),
  ];

  return (
    <Layout style={{ minHeight: 'calc(100vh - 64px)', background: REDWOOD.neutral100 }}>
      <Content>
        {/* Breadcrumb */}
        <div style={{
          padding: '16px 24px',
          background: REDWOOD.surface,
          borderBottom: `1px solid ${REDWOOD.neutral200}`,
        }}>
          <Breadcrumb
            items={[
              { title: <Link to="/home"><HomeOutlined /> Home</Link> },
              { title: <Link to="/gl">General Ledger</Link> },
              { title: 'Income Statement Templates' },
            ]}
          />
        </div>

        {/* Tabs */}
        <Tabs
          type="editable-card"
          activeKey={activeTabKey}
          onChange={setActiveTabKey}
          onEdit={(targetKey, action) => {
            if (action === 'remove' && typeof targetKey === 'string') {
              closeTemplateTab(targetKey);
            }
          }}
          hideAdd
          items={tabItems}
          style={{ background: REDWOOD.surface }}
          tabBarStyle={{
            margin: 0,
            padding: '8px 16px 0 16px',
            background: REDWOOD.surface,
          }}
        />

        {/* Create Template Modal */}
        <Modal
          title="Create New Template"
          open={templateModalVisible}
          onCancel={() => {
            setTemplateModalVisible(false);
            templateForm.resetFields();
          }}
          onOk={() => templateForm.submit()}
          okText="Create"
          okButtonProps={{ style: { background: REDWOOD.primary } }}
        >
          <Form form={templateForm} layout="vertical" onFinish={handleCreateTemplate}>
            <Form.Item
              name="template_code"
              label="Template Code"
              rules={[{ required: true, message: 'Enter template code' }]}
            >
              <Input placeholder="e.g., PL_CUSTOM_01" />
            </Form.Item>
            <Form.Item
              name="template_name"
              label="Template Name"
              rules={[{ required: true, message: 'Enter template name' }]}
            >
              <Input placeholder="e.g., Custom Profit & Loss" />
            </Form.Item>
            <Form.Item name="description" label="Description">
              <TextArea rows={3} placeholder="Optional description" />
            </Form.Item>
            <Form.Item name="template_type" label="Type" initialValue="CUSTOM">
              <Select options={plService.TEMPLATE_TYPES} />
            </Form.Item>
          </Form>
        </Modal>

        {/* Clone Template Modal */}
        <Modal
          title="Clone Template"
          open={cloneModalVisible}
          onCancel={() => {
            setCloneModalVisible(false);
            cloneForm.resetFields();
            setCloneTemplateId(null);
          }}
          onOk={() => cloneForm.submit()}
          okText="Clone"
        >
          <Form form={cloneForm} layout="vertical" onFinish={handleCloneTemplate}>
            <Form.Item
              name="new_template_code"
              label="New Template Code"
              rules={[{ required: true, message: 'Enter new template code' }]}
            >
              <Input placeholder="e.g., PL_COPY_01" />
            </Form.Item>
            <Form.Item
              name="new_template_name"
              label="New Template Name"
              rules={[{ required: true, message: 'Enter new template name' }]}
            >
              <Input placeholder="e.g., Custom P&L Copy" />
            </Form.Item>
          </Form>
        </Modal>

        {/* Add Group Modal */}
        <Modal
          title="Add Group"
          open={groupModalVisible}
          onCancel={() => {
            setGroupModalVisible(false);
            groupForm.resetFields();
          }}
          onOk={() => groupForm.submit()}
          okText="Add"
          okButtonProps={{ style: { background: REDWOOD.primary } }}
        >
          <Form form={groupForm} layout="vertical" onFinish={handleAddGroup}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="group_code"
                  label="Group Code"
                  rules={[{ required: true, message: 'Enter group code' }]}
                >
                  <Input placeholder="e.g., G5" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="group_type"
                  label="Group Type"
                  rules={[{ required: true, message: 'Select group type' }]}
                >
                  <Select options={plService.GROUP_TYPES} placeholder="Select type" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name="group_name"
              label="Group Name"
              rules={[{ required: true, message: 'Enter group name' }]}
            >
              <Input placeholder="e.g., Operating Revenue" />
            </Form.Item>
            <Form.Item name="group_label" label="Display Label">
              <Input placeholder="Leave empty to use group name" />
            </Form.Item>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="display_order"
                  label="Display Order"
                  rules={[{ required: true, message: 'Enter display order' }]}
                >
                  <InputNumber style={{ width: '100%' }} min={1} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="sign_convention"
                  label="Sign Convention"
                  initialValue={1}
                  tooltip="1 for income items (add), -1 for expense items (subtract)"
                >
                  <Select
                    options={[
                      { value: 1, label: '+ (Income/Add)' },
                      { value: -1, label: '- (Expense/Subtract)' },
                    ]}
                  />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </Modal>

        {/* Add Section Modal */}
        <Modal
          title="Add Section"
          open={sectionModalVisible}
          onCancel={() => {
            setSectionModalVisible(false);
            sectionForm.resetFields();
            setSelectedGroupId(null);
          }}
          onOk={() => sectionForm.submit()}
          okText="Add"
          okButtonProps={{ style: { background: REDWOOD.primary } }}
        >
          <Form form={sectionForm} layout="vertical" onFinish={handleAddSection}>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="section_code"
                  label="Section Code"
                  rules={[{ required: true, message: 'Enter section code' }]}
                >
                  <Input placeholder="e.g., G1S4" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="display_order"
                  label="Display Order"
                  rules={[{ required: true, message: 'Enter display order' }]}
                >
                  <InputNumber style={{ width: '100%' }} min={1} />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item
              name="section_name"
              label="Section Name"
              rules={[{ required: true, message: 'Enter section name' }]}
            >
              <Input placeholder="e.g., Interest Income" />
            </Form.Item>
            <Form.Item name="section_label" label="Display Label">
              <Input placeholder="Leave empty to use section name" />
            </Form.Item>
          </Form>
        </Modal>

        {/* Add Account Modal */}
        <Modal
          title={
            <Space>
              <BankOutlined style={{ color: REDWOOD.primary }} />
              <span>Assign Accounts to Section</span>
            </Space>
          }
          open={accountModalVisible}
          onCancel={() => {
            setAccountModalVisible(false);
            accountForm.resetFields();
            setSelectedSectionId(null);
            setSelectedAccounts([]);
            setAccountSearchText('');
          }}
          footer={
            <Space>
              <Button onClick={() => {
                setAccountModalVisible(false);
                setSelectedAccounts([]);
                setAccountSearchText('');
                setSelectedSectionId(null);
              }}>
                Cancel
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleAssignSelectedAccounts}
                disabled={selectedAccounts.length === 0}
                style={{ background: REDWOOD.primary }}
              >
                Assign Selected ({selectedAccounts.length})
              </Button>
            </Space>
          }
          width={800}
          bodyStyle={{ padding: 0 }}
        >
          {/* Search and Filter Bar */}
          <div style={{ padding: 16, borderBottom: `1px solid ${REDWOOD.neutral200}` }}>
            <Row gutter={16} align="middle">
              <Col flex="auto">
                <Input.Search
                  placeholder="Search by account code or description..."
                  value={accountSearchText}
                  onChange={(e) => setAccountSearchText(e.target.value)}
                  allowClear
                  style={{ width: '100%' }}
                />
              </Col>
              <Col>
                <Button
                  icon={<ReloadOutlined />}
                  onClick={loadGLAccounts}
                  loading={glAccountsLoading}
                >
                  Refresh
                </Button>
              </Col>
            </Row>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">
                {selectedAccounts.length > 0 ? (
                  <Tag color="blue">{selectedAccounts.length} account(s) selected</Tag>
                ) : (
                  'Select accounts from the list below'
                )}
              </Text>
            </div>
          </div>

          {/* Accounts Table */}
          <div style={{ maxHeight: 400, overflow: 'auto' }}>
            <Table
              loading={glAccountsLoading}
              dataSource={glAccounts.filter(acc =>
                accountSearchText === '' ||
                acc.account.toLowerCase().includes(accountSearchText.toLowerCase()) ||
                acc.description.toLowerCase().includes(accountSearchText.toLowerCase())
              )}
              rowKey="account"
              size="small"
              pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `Total ${total} accounts` }}
              rowSelection={{
                type: 'checkbox',
                selectedRowKeys: selectedAccounts,
                onChange: (selectedRowKeys) => {
                  setSelectedAccounts(selectedRowKeys as string[]);
                },
              }}
              columns={[
                {
                  title: 'Account Code',
                  dataIndex: 'account',
                  key: 'account',
                  width: 150,
                  sorter: (a, b) => a.account.localeCompare(b.account),
                  render: (code: string) => (
                    <Text strong style={{ fontFamily: 'monospace' }}>{code}</Text>
                  ),
                },
                {
                  title: 'Description',
                  dataIndex: 'description',
                  key: 'description',
                  sorter: (a, b) => a.description.localeCompare(b.description),
                },
                {
                  title: 'Type',
                  dataIndex: 'account_type',
                  key: 'account_type',
                  width: 80,
                  filters: [
                    { text: 'Asset', value: 'A' },
                    { text: 'Liability', value: 'L' },
                    { text: 'Equity', value: 'O' },
                    { text: 'Revenue', value: 'R' },
                    { text: 'Expense', value: 'E' },
                  ],
                  onFilter: (value, record) => record.account_type === value,
                  render: (type: string) => {
                    const typeMap: Record<string, { label: string; color: string }> = {
                      A: { label: 'Asset', color: 'blue' },
                      L: { label: 'Liability', color: 'orange' },
                      O: { label: 'Equity', color: 'purple' },
                      R: { label: 'Revenue', color: 'green' },
                      E: { label: 'Expense', color: 'red' },
                    };
                    const info = typeMap[type] || { label: type, color: 'default' };
                    return <Tag color={info.color}>{info.label}</Tag>;
                  },
                },
              ]}
            />
          </div>

          {/* Manual Entry Option */}
          <Divider style={{ margin: '12px 0' }}>Or enter account range manually</Divider>
          <div style={{ padding: '0 16px 16px 16px' }}>
            <Form form={accountForm} layout="inline" onFinish={handleAssignAccount}>
              <Form.Item name="account_code" style={{ marginBottom: 0 }}>
                <Input placeholder="Single account code" style={{ width: 150 }} />
              </Form.Item>
              <Text style={{ margin: '0 8px', lineHeight: '32px' }}>or range:</Text>
              <Form.Item name="account_from" style={{ marginBottom: 0 }}>
                <Input placeholder="From" style={{ width: 120 }} />
              </Form.Item>
              <Text style={{ margin: '0 4px', lineHeight: '32px' }}>to</Text>
              <Form.Item name="account_to" style={{ marginBottom: 0 }}>
                <Input placeholder="To" style={{ width: 120 }} />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="primary" htmlType="submit" ghost>
                  Add Range
                </Button>
              </Form.Item>
            </Form>
          </div>
        </Modal>

        {/* Add Total Modal */}
        <Modal
          title="Add Calculated Total"
          open={totalModalVisible}
          onCancel={() => {
            setTotalModalVisible(false);
            totalForm.resetFields();
          }}
          onOk={() => totalForm.submit()}
          okText="Add"
          okButtonProps={{ style: { background: REDWOOD.primary } }}
          width={700}
        >
          <Form form={totalForm} layout="vertical" onFinish={handleAddTotal}>
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item
                  name="total_code"
                  label="Total Code"
                  rules={[{ required: true, message: 'Enter total code' }]}
                >
                  <Input placeholder="e.g., T6" />
                </Form.Item>
              </Col>
              <Col span={16}>
                <Form.Item
                  name="total_name"
                  label="Total Name"
                  rules={[{ required: true, message: 'Enter total name' }]}
                >
                  <Input placeholder="e.g., Net Profit" />
                </Form.Item>
              </Col>
            </Row>

            {/* Formula Builder */}
            <Form.Item
              name="calculation_formula"
              label="Calculation Formula"
              rules={[{ required: true, message: 'Build formula using buttons below' }]}
            >
              <Input
                placeholder="Click groups/totals below to build formula"
                style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 600 }}
                readOnly
              />
            </Form.Item>

            {/* Formula Builder Buttons */}
            <Card size="small" style={{ marginBottom: 16, background: REDWOOD.neutral100 }}>
              <div style={{ marginBottom: 12 }}>
                <Text strong style={{ marginRight: 8 }}>Groups:</Text>
                <Space wrap>
                  {(getCurrentTemplateTab()?.template?.template.groups || []).map(g => (
                    <Button
                      key={g.group_code}
                      size="small"
                      style={{
                        background: GROUP_TYPE_COLORS[g.group_type] || '#1890ff',
                        borderColor: GROUP_TYPE_COLORS[g.group_type] || '#1890ff',
                        color: '#fff'
                      }}
                      onClick={() => {
                        const currentFormula = totalForm.getFieldValue('calculation_formula') || '';
                        totalForm.setFieldsValue({
                          calculation_formula: currentFormula + g.group_code
                        });
                      }}
                    >
                      {g.group_code} ({g.group_name})
                    </Button>
                  ))}
                </Space>
              </div>

              <div style={{ marginBottom: 12 }}>
                <Text strong style={{ marginRight: 8 }}>Existing Totals:</Text>
                <Space wrap>
                  {(getCurrentTemplateTab()?.template?.template.totals || []).map(t => (
                    <Button
                      key={t.total_code}
                      size="small"
                      style={{ background: '#722ed1', borderColor: '#722ed1', color: '#fff' }}
                      onClick={() => {
                        const currentFormula = totalForm.getFieldValue('calculation_formula') || '';
                        totalForm.setFieldsValue({
                          calculation_formula: currentFormula + t.total_code
                        });
                      }}
                    >
                      {t.total_code} ({t.total_name})
                    </Button>
                  ))}
                  {(getCurrentTemplateTab()?.template?.template.totals || []).length === 0 && (
                    <Text type="secondary">No totals defined yet</Text>
                  )}
                </Space>
              </div>

              <div>
                <Text strong style={{ marginRight: 8 }}>Operators:</Text>
                <Space>
                  <Button
                    size="small"
                    type="primary"
                    style={{ background: REDWOOD.success, borderColor: REDWOOD.success, fontWeight: 600, fontSize: 16 }}
                    onClick={() => {
                      const currentFormula = totalForm.getFieldValue('calculation_formula') || '';
                      totalForm.setFieldsValue({
                        calculation_formula: currentFormula + '+'
                      });
                    }}
                  >
                    +
                  </Button>
                  <Button
                    size="small"
                    type="primary"
                    danger
                    style={{ fontWeight: 600, fontSize: 16 }}
                    onClick={() => {
                      const currentFormula = totalForm.getFieldValue('calculation_formula') || '';
                      totalForm.setFieldsValue({
                        calculation_formula: currentFormula + '-'
                      });
                    }}
                  >
                    −
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      const currentFormula = totalForm.getFieldValue('calculation_formula') || '';
                      totalForm.setFieldsValue({
                        calculation_formula: currentFormula + '('
                      });
                    }}
                  >
                    (
                  </Button>
                  <Button
                    size="small"
                    onClick={() => {
                      const currentFormula = totalForm.getFieldValue('calculation_formula') || '';
                      totalForm.setFieldsValue({
                        calculation_formula: currentFormula + ')'
                      });
                    }}
                  >
                    )
                  </Button>
                  <Divider type="vertical" />
                  <Button
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => {
                      const currentFormula = totalForm.getFieldValue('calculation_formula') || '';
                      totalForm.setFieldsValue({
                        calculation_formula: currentFormula.slice(0, -1)
                      });
                    }}
                  >
                    Backspace
                  </Button>
                  <Button
                    size="small"
                    danger
                    onClick={() => {
                      totalForm.setFieldsValue({ calculation_formula: '' });
                    }}
                  >
                    Clear
                  </Button>
                </Space>
              </div>
            </Card>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="display_order"
                  label="Display Order"
                  rules={[{ required: true, message: 'Enter display order' }]}
                >
                  <InputNumber style={{ width: '100%' }} min={1} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="after_group_code" label="Show After Group">
                  <Select
                    allowClear
                    placeholder="Select group"
                    options={
                      (getCurrentTemplateTab()?.template?.template.groups || []).map(g => ({
                        value: g.group_code,
                        label: `${g.group_code} - ${g.group_name}`,
                      }))
                    }
                  />
                </Form.Item>
              </Col>
            </Row>
          </Form>
        </Modal>

        {/* Preview Modal */}
        {renderPreviewModal()}

        {/* Excel View Modal */}
        {renderExcelModal()}
      </Content>

      {/* Autopilot */}
      
    </Layout>
  );
};

export default IncomeStatementTemplates;
