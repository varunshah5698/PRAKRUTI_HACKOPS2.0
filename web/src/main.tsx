import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';
import App from './App';
import './styles/globals.css';

// Browsers otherwise restore the previous scroll offset before React mounts,
// which can hide the start of a landing-page headline behind the sticky nav.
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: { background: 'rgba(255,255,255,0.97)', color: '#142016', border: '1px solid #dfe6db', borderRadius: '14px', boxShadow: '0 20px 50px -30px rgba(23,42,29,.5)' },
        }}
      />
    </BrowserRouter>
  </React.StrictMode>,
);
