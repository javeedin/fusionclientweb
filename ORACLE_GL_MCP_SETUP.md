# Oracle GL MCP Server Setup Guide

This guide explains how to integrate the GL Account Analysis MCP server with your Electron app.

## Architecture

```
Electron App (Main Process)
  ├─ Start/Stop GL MCP Server (child process)
  ├─ Manage credentials (encrypted storage)
  └─ IPC handlers for UI communication

Electron App (Renderer / React UI)
  ├─ Admin Panel
  │  ├─ Start/Stop buttons
  │  ├─ Credentials settings
  │  └─ GL query interface
  └─ IPC calls to main process

GL MCP Server (Node.js subprocess)
  ├─ Connects to Oracle ERP GL API
  ├─ Provides MCP tools for Claude
  └─ Caches results for performance
```

## Files Added

| File | Purpose |
|------|---------|
| `electron/gl-mcp-server.cjs` | GL MCP server implementation |
| `electron/main.cjs` | Updated with IPC handlers & server management |
| `electron/preload.cjs` | Expose GL MCP IPC methods to renderer |
| `src/modules/admin/GLAccountAnalysis.jsx` | React component for admin panel |

## Integration Steps

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Add Route to Your Admin Module
```jsx
// In your admin router or App.jsx
import GLAccountAnalysis from './modules/admin/GLAccountAnalysis';

<Route path="/admin/gl-account-analysis" element={<GLAccountAnalysis />} />
```

### Step 3: Add Menu Item
```jsx
{
  label: 'Finance',
  icon: <DollarOutlined />,
  children: [
    {
      label: 'GL Account Analysis',
      onClick: () => navigate('/admin/gl-account-analysis'),
    },
  ],
}
```

### Step 4: Run the App
```bash
npm run electron:dev
```

### Step 5: Use the GL Panel
1. Go to **Admin > GL Account Analysis**
2. Click **Settings** → Enter Oracle credentials
3. Click **Start Server** (turns 🟢 green)
4. Enter GL parameters (Ledger, Period, Company, Account)
5. Click **Query GL Data**
6. Results load in the table

---

## How to Use

### From Electron App

1. **Open GL Account Analysis** in Admin panel
2. **Configure Settings** (first time only)
   - Click "Settings" button
   - Enter Oracle base URL
   - Enter Oracle APEX username
   - Enter Oracle APEX password
   - Click OK
3. **Start Server**
   - Click "Start Server" button
   - Status should change to green "Running"
4. **Query GL Data**
   - Enter Ledger name, Period, Company, Account
   - Click "Query GL Data"
   - Results load in the table below

### Server Lifecycle

- **Auto-start on app launch**: Not enabled by default (add if needed)
- **Manual start**: Click "Start Server" button in UI
- **Auto-stop on app quit**: Yes, automatic
- **Credentials storage**: Encrypted using OS-level encryption (Electron's `safeStorage`)

## Configuration

### Oracle Credentials

Stored in: `~/.config/ReactERP/gl-api-creds.json` (Windows/Linux/Mac varies)

Credentials are encrypted using OS keychain:
- **Windows**: DPAPI
- **macOS**: Keychain
- **Linux**: Secret Service

### MCP Server Tools

The GL MCP server exposes these tools:

1. **getGLAccountAnalysis**
   ```
   Parameters: ledger_name, period_names, company, account
   Returns: GL account analysis with transactions
   ```

2. **getGLTransactions**
   ```
   Parameters: ledger_name, period_names, company, account, limit, offset
   Returns: Paginated GL transactions
   ```

3. **getAccountBalance**
   ```
   Parameters: ledger_name, period_names, account
   Returns: Account balance for period
   ```

4. **searchAccounts**
   ```
   Parameters: ledger_name, search_term
   Returns: Matching accounts from chart of accounts
   ```

5. **getJournalEntry**
   ```
   Parameters: je_header_id
   Returns: Journal entry details
   ```

## Environment Variables (Optional)

When starting the server programmatically:

```
ORACLE_BASE_URL=https://your-oracle-url
ORACLE_USERNAME=your_username
ORACLE_PASSWORD=your_password
```

## Troubleshooting

### Server Won't Start

1. Check if Node.js is available
2. Verify `gl-mcp-server.cjs` exists in `electron/` folder
3. Check Electron console for error messages
4. Ensure Oracle credentials are valid

### No Results from Query

1. Verify GL MCP Server is running (green status)
2. Check Oracle URL is correct
3. Verify credentials are correct
4. Check period/account/company parameters exist in Oracle

### Connection Issues

1. Verify Oracle URL is accessible from your machine
2. Check network proxy settings
3. Ensure Oracle APEX endpoint is `/ords/bcldifc/reerp/gl/*`

## API Integration

The GL MCP server expects Oracle APEX REST endpoints at:

```
/ords/bcldifc/reerp/gl/accountanalysis
/ords/bcldifc/reerp/gl/transactions
/ords/bcldifc/reerp/gl/accountbalance
/ords/bcldifc/reerp/gl/accounts/search
/ords/bcldifc/reerp/gl/journalentry/{id}
```

These endpoints should be created in your Oracle APEX application.

## Advanced: Auto-start Server

To auto-start the GL MCP server when the app launches:

In `electron/main.cjs`, in the `createWindow()` function:

```javascript
mainWindow.once('ready-to-show', () => {
  mainWindow.show();
  mainWindow.focus();
  
  // Auto-start GL MCP server
  const creds = loadGLCredentials(); // helper function
  if (creds) {
    startGLMcpServer(creds);
  }
});
```

## Next Steps

1. ✅ Deploy GL MCP server code
2. ✅ Add React component to admin panel
3. ✅ Configure routing
4. ✅ Test start/stop functionality
5. ⏳ Create Oracle APEX REST endpoints
6. ⏳ Test end-to-end GL queries

## Support

For issues or questions, check:
- `electron/gl-mcp-server.cjs` - server implementation
- `electron/main.cjs` - IPC handlers
- `src/modules/admin/GLAccountAnalysis.jsx` - UI component
- Browser DevTools console for error messages
- Electron main process console for server logs
