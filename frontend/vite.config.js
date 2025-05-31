
// frontend/vite.config.js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import tailwindcss from "@tailwindcss/vite" // This is the plugin from your package.json
import path from 'path';

const projectRoot = process.cwd(); 
const certDir = path.resolve(projectRoot, 'certs');

export default defineConfig({
  plugins: [react(),tailwindcss(), ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    https: {
      key: fs.readFileSync(path.join(certDir, 'cert.key')), // From mkcert create-cert
      cert: fs.readFileSync(path.join(certDir, 'cert.crt')), // From mkcert create-cert
    },
    proxy: {
      // Your existing proxy for the signaling server
      '/socket.io': {
        target: 'http://localhost:3001', // Signaling server still runs on localhost from perspective of this machine
        ws: true,
        changeOrigin: true,
      }
    }
  }
});