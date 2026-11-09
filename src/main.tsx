import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Boardline from './Boardline.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boardline />
  </StrictMode>,
)
