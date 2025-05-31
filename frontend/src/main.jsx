// src/main.jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';

import HomePage from './pages/HomePage';
import RoomPage from './pages/RoomPage';
import { AppLayout } from './AppLayout'; // Import the layout
import { ThemeProvider } from './components/theme-provider';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider defaultTheme="dark" storageKey="transcent-ui-theme">
        <Routes>
          {/* Wrap page routes within the AppLayout route */}
          <Route element={<AppLayout />}> {/* Layout Route */}
            <Route path="/" element={<HomePage />} />
            <Route path="/room/:roomID" element={<RoomPage />} />
            {/* <Route path="*" element={<NotFoundPage />} /> */}
          </Route>
          {/* You could have routes outside AppLayout too, e.g., for a dedicated login page */}
        </Routes>
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);