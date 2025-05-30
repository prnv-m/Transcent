Absolutely! Let's simplify the README and make it more professional, suitable for a portfolio project.

---

# TRANSCENT

TRANSCENT is a sophisticated video conferencing platform designed for real-time communication with integrated transcription, efficient note export, and robust media storage. It leverages a custom-built C++ transcription engine for high-performance speech-to-text, complemented by Large Language Model (LLM) capabilities for intelligent Q&A and smart note formatting, allowing users to quickly derive insights and action items from conversations.

---

## Getting Started

This guide will walk you through the essential steps to set up and run TRANSCENT locally.

---

### Prerequisites

Before you begin, ensure you have the following installed on your system:

* **Node.js & npm/yarn**: For managing application dependencies.
* **Docker & Docker Compose**: For containerizing and orchestrating services.
* **Vosk Docker Image**: A pre-built Vosk Docker image is required for the transcription service.
* **SSL Certificates**: `mkcert` (or your existing `cert.key` and `cert.crt` files) configured for `192.168.0.112` and `localhost` in the `certs/` directory.

---

### Local Setup

Follow these steps to get TRANSCENT running on your local machine:

#### 1. Start Vosk Transcription Service

Launch the Vosk Docker container, which powers the real-time transcription.

```bash
# In the directory with Vosk's docker-compose.yml (recommended)
docker-compose up -d

# Alternatively, run directly (adjust image and port as needed)
# docker run -d -p 2700:2700 <your-vosk-image-name>
```

#### 2. Initialize Nginx Reverse Proxy

Nginx acts as a secure WebSocket (WSS) proxy for Vosk, handling SSL termination.

```bash
# If Nginx is installed directly (path to your nginx.conf may vary)
sudo nginx -c /path/to/your/nginx.conf

# If using Docker Compose for Nginx (recommended)
# Ensure your Nginx Dockerfile copies nginx.conf and your docker-compose.nginx.yml maps port 2701 and mounts certs.
docker-compose -f docker-compose.nginx.yml up -d
```

#### 3. Launch Signaling Backend

Navigate to the `signaling_backend` directory and start the server.

```bash
cd path/to/your/project/TRANSCENT/signaling_backend
npm install # or yarn install
npm start   # or node src/server.js
```

The signaling server will be accessible at `http://localhost:3001`.

#### 4. Run Frontend Development Server

Move to the `frontend` directory and launch the Vite development server.

```bash
cd path/to/your/project/TRANSCENT/frontend
npm install # or yarn install
```

Ensure your `.env` file includes `VITE_VOSK_URL=wss://192.168.0.112:2701/`.

```bash
npm run dev
```

The frontend will be served at `https://0.0.0.0:5173`.

#### 5. Access the Application

Open your browser and navigate to `https://192.168.0.112:5173` (or `https://localhost:5173`).

**SSL Certificate Acceptance**: You will likely encounter SSL warnings due to self-signed certificates. Please **accept** these warnings for both the frontend (Vite) and the Nginx WSS endpoint (`https://192.168.0.112:2701`) to ensure full application functionality. You might need to visit `https://192.168.0.112:2701` directly in your browser once to accept its certificate.

---

### Service Ports Summary

* **Vosk Container**: `2700` (Host)
* **Nginx Proxy**: `2701` (Host, WSS)
* **Signaling Backend**: `3001` (Host, HTTP)
* **Frontend Dev Server**: `5173` (Host, HTTPS)

---
