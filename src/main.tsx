import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';
import { installGlobalApiAuth } from './lib/apiAuth';
import { ThemeProvider } from './context/ThemeContext';

// Sends the signed-in user's credentials with every /api/ request (the server verifies them).
try {
  installGlobalApiAuth();
} catch (e) {
  console.warn('[main] installGlobalApiAuth warning:', e);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
