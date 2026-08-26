import './utils/consoleSilencer' // MUST stay first — mutes console.log/info/debug unless VITE_DEBUG=true
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { installOrdsFetchInterceptor } from './services/ordsFetchInterceptor'
import { getAppBranding } from './config/company.config'

// ORDS token security — no-op while REACT_APP_ORDS_USE_TOKEN=NO in .env.local
installOrdsFetchInterceptor()

// Window/tab title follows the company branding (BUIMERC → Re-ERP A3.0.0)
const brand = getAppBranding()
document.title = `${brand.name} ${brand.version}`

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
