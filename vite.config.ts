import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(() => {
  // Read SMTP/API config from gitignored electron/email.config.json
  let emailCfg: { user?: string; pass?: string } = {};
  try {
    const cfgPath = path.join(process.cwd(), 'electron', 'email.config.json');
    emailCfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    console.log('[vite] Email config loaded — sender:', emailCfg.user, 'key length:', emailCfg.pass?.length);
  } catch (e) {
    console.warn('[vite] electron/email.config.json not found — OTP email will be disabled');
  }

  return {
    plugins: [react()],
    base: process.env.GITHUB_ACTIONS ? '/reacterp/' : './',
    envPrefix: ['VITE_', 'REACT_APP_'], // Load both VITE_ and REACT_APP_ env vars
    server: {
      proxy: {
        // Proxy API calls to local proxy server (port 3001)
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
        },
        // Proxy Mitsumi ORDS calls to avoid CORS in dev
        '/ords-mitsu': {
          target: 'https://g827cd88c3cfc03-mitsumioracledb.adb.me-dubai-1.oraclecloudapps.com',
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/ords-mitsu/, '/ords/test/FUSIONCLIENTERP'),
          secure: true,
        },
      },
    },
    define: {
      __BREVO_API_KEY__: JSON.stringify(emailCfg.pass ?? ''),
      __BREVO_SENDER__:  JSON.stringify(emailCfg.user ?? ''),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            // React core — loaded first, smallest
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            // Ant Design — large but needed for layout
            'vendor-antd': ['antd', '@ant-design/icons'],
            // Sync services — only needed on the Sync page
            'chunk-sync': [
              './src/services/gl-sync.service.ts',
              './src/services/ap-sync.service.ts',
              './src/services/ap-payments-sync.service.ts',
              './src/services/gl-balances-sync.service.ts',
              './src/services/gl-codecomb-sync.service.ts',
              './src/services/gl-periodstatus-sync.service.ts',
              './src/services/banks-sync.service.ts',
              './src/services/bank-branches-sync.service.ts',
              './src/services/bank-accounts-sync.service.ts',
              './src/services/bank-account-transfers-sync.service.ts',
              './src/services/external-cash-transactions-sync.service.ts',
              './src/services/legal-entities-sync.service.ts',
              './src/services/business-units-sync.service.ts',
              './src/services/user-accounts-sync.service.ts',
              './src/services/user-account-roles-sync.service.ts',
              './src/services/roles-sync.service.ts',
              './src/services/suppliers-sync.service.ts',
              './src/services/supplier-address-sync.service.ts',
              './src/services/supplier-sites-sync.service.ts',
              './src/services/supplier-site-assignments-sync.service.ts',
              './src/services/sync-http.ts',
            ],
          },
        },
      },
    },
  };
});

