import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { installOrdsFetchInterceptor } from './services/ordsFetchInterceptor'

// ORDS token security — no-op while REACT_APP_ORDS_USE_TOKEN=NO in .env.local
installOrdsFetchInterceptor()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
