import React, { useState, useRef, useMemo } from 'react';
import { Select, Tag, Typography, Switch, Tooltip } from 'antd';
import { SearchOutlined, ExportOutlined, OpenOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getFilteredMenuItemsGrouped, type MenuSearchItem } from '../data/menuItems';
import { getCurrentCompany } from '../config/company.config';

const { Text } = Typography;

const MODULE_COLORS: Record<string, string> = {
  GL:   '#1677ff',
  FA:   '#722ed1',
  AP:   '#d46b08',
  CASH: '#08979c',
  PC:   '#389e0d',
  RM:   '#c41d7f',
  PMS:  '#1d39c4',
  PROC: '#d48806',
  FSC:  '#13c2c2',
  ADMIN:'#cf1322',
  SYNC: '#531dab',
  SUPP: '#0958d9',
  EXT:  '#595959',
  HOME: '#C74634',
};

const GlobalMenuSearch: React.FC = () => {
  const navigate    = useNavigate();
  const [open,      setOpen]      = useState(false);
  const [newWindow, setNewWindow] = useState(false);
  const selectRef = useRef<any>(null);
  const currentCompany = getCurrentCompany();

  const filteredMenuItems = useMemo(() => getFilteredMenuItemsGrouped(), [currentCompany.code]);

  const handleSelect = (path: string | null) => {
    if (!path) return;
    setOpen(false);
    if (selectRef.current) selectRef.current.blur();

    if (newWindow) {
      // Build the full URL for the HashRouter route and open in a new tab/window
      const base = window.location.href.replace(/#.*$/, '');
      // Open maximized: width and height are ignored by most browsers for security,
      // but we set them anyway. User can maximize manually if needed.
      const newWin = window.open(
        `${base}#${path}`,
        '_blank',
        'width=1400,height=900,left=0,top=0,noopener,noreferrer'
      );
      // Try to maximize (works in some browsers)
      if (newWin) {
        try {
          newWin.moveTo(0, 0);
          newWin.resizeTo(screen.width, screen.height);
        } catch (e) {
          // Browsers may block this for security reasons - that's ok
        }
      }
    } else {
      navigate(path);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Select
        ref={selectRef}
        showSearch
        open={open}
        onDropdownVisibleChange={setOpen}
        placeholder={
          <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13 }}>
            <SearchOutlined style={{ marginRight: 6 }} />
            Search menu…
          </span>
        }
        suffixIcon={<SearchOutlined style={{ color: '#999', pointerEvents: 'none' }} />}
        filterOption={(input, option: any) =>
          option?.searchText?.includes(input.toLowerCase()) ?? false
        }
        onSelect={handleSelect}
        value={null}
        options={filteredMenuItems}
        optionRender={(opt) => {
          const item: MenuSearchItem = (opt.data as any).item;
          return (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '2px 0' }}>
              <Tag
                color={MODULE_COLORS[item.module] || '#999'}
                style={{ fontSize: 10, lineHeight: '18px', padding: '0 5px', minWidth: 38, textAlign: 'center', flexShrink: 0, marginTop: 1 }}
              >
                {item.module}
              </Tag>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 13 }}>{item.label}</Text>
                  {newWindow && (
                    <ExportOutlined style={{ fontSize: 10, color: '#999' }} />
                  )}
                </div>
                {item.description && (
                  <Text type="secondary" style={{ fontSize: 11 }}>{item.description}</Text>
                )}
              </div>
            </div>
          );
        }}
        style={{ width: 220, background: '#fff', borderRadius: 6 }}
        styles={{ popup: { root: { maxHeight: 420, minWidth: 340 } } }}
        notFoundContent={
          <div style={{ padding: '8px 12px', color: '#999', fontSize: 13 }}>No pages found</div>
        }
      />

      {/* Open new instance button */}
      <Tooltip title="Open new instance of the application" placement="bottom">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 32,
            height: 32,
            background: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.3)',
            borderRadius: 5,
            cursor: 'pointer',
            transition: 'background 0.2s',
          }}
          onClick={() => {
            const base = window.location.href.replace(/#.*$/, '');
            const newWin = window.open(base, '_blank', 'width=1400,height=900,left=0,top=0,noopener,noreferrer');
            if (newWin) {
              try {
                newWin.moveTo(0, 0);
                newWin.resizeTo(screen.width, screen.height);
              } catch (e) {
                // Graceful fallback
              }
            }
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.25)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.12)')}
        >
          <OpenOutlined style={{ fontSize: 14, color: '#fff' }} />
        </div>
      </Tooltip>

      {/* New-window toggle */}
      <Tooltip
        title={newWindow ? 'Opens in new tab — click to navigate in current tab' : 'Click to open results in a new tab'}
        placement="bottom"
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: newWindow ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.3)',
            borderRadius: 5,
            padding: '3px 7px',
            cursor: 'pointer',
            transition: 'background 0.2s',
          }}
          onClick={() => setNewWindow(v => !v)}
        >
          <Switch
            size="small"
            checked={newWindow}
            onChange={setNewWindow}
            style={{ minWidth: 28 }}
          />
          <ExportOutlined style={{ fontSize: 12, color: newWindow ? '#fff' : 'rgba(255,255,255,0.7)' }} />
        </div>
      </Tooltip>
    </div>
  );
};

export default GlobalMenuSearch;
