// src/layouts/AppLayout.jsx
import React from 'react';
import { Outlet } from 'react-router-dom'; // Outlet renders the matched child route
import { ModeToggle } from '@/components/mode-toggle'; // Example: global mode toggle

export function AppLayout() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Example: A simple header that might appear on all pages */}
      <header className="p-4 bg-card shadow-md dark:bg-slate-800 border-b dark:border-slate-700">
        <div className="container mx-auto flex justify-between items-center">
          <span className="text-xl font-bold text-primary dark:text-slate-100">Transcent</span>
          <ModeToggle />
        </div>
      </header>

      {/* Main content area where child routes will render */}
      <main className="flex-grow container mx-auto py-6 px-4">
        <Outlet /> {/* This is where <HomePage /> or <RoomPage /> will render */}
      </main>

      {/* Example: A simple footer */}
      <footer className="p-4 text-center text-sm text-muted-foreground dark:text-slate-400 border-t dark:border-slate-700">
        © {new Date().getFullYear()} Transcent App. All rights reserved.
      </footer>
    </div>
  );
}