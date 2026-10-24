import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { applySettings, loadSettings } from './settings.js';
import './app.css';

// Apply the saved theme before the first paint so there is no flash of the default colors.
applySettings(loadSettings());

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
