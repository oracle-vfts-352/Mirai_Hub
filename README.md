# 🗺️ Mirai Hub — Enterprise Multi-Tenant Marketing & Developer Interaction Platform

Mirai Hub is a high-performance, horizontally scalable multi-tenant monorepo architecture engineered using **TypeScript, Express, PostgreSQL, Redis, and Nginx**. Built with a production-grade infrastructure mindset to withstand high-volume traffic spikes, isolate tenant operations, and encrypt critical customer PII data locally.

---

## 🏗️ Core System Architecture Blueprint

The platform shifts heavy operations away from synchronous routing processes, leveraging decoupled background worker channels and standardizing secure Layer-7 reverse proxying.

Use code with caution.
┌───────────────────┐
│  User / Frontend  │
└─────────┬─────────┘
│
▼
┌───────────────────┐
│    Nginx Proxy    │ (Port 80 - least_conn load balancing)
└────┬─────────┬────┘
│         │ (Masks internal ports & headers)
┌──────────┘         └──────────┐
▼                               ▼
┌───────────────────────┐       ┌───────────────────────┐
│ TypeScript Backend #1 │       │ TypeScript Backend #2 │ (Port 5000 / 5001)
└───────┬───────────┬───┘       └───┬───────────┬───────┘
│           │               │           │
│           └───────┬───────┘           │
▼                   ▼                   ▼
┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
│   PostgreSQL DB   │ │   Redis Server    │ │ Cloudflare R2 Space│
│ (Tenant Schema    │ │ (Rate Limits &    │ │ (Campaign Media   │
│  & Passkey Rows)  │ │  BullMQ Queues)   │ │  & User Assets)   │
└───────────────────┘ └─────────┬─────────┘ └───────────────────┘
│
▼
┌───────────────────────┐
│  Async Queue Workers  │ (Decoupled execution thread
│  (TypeScript/BullMQ)  │  processing campaign blasts)
└───────────────────────┘

---

## 🛡️ Production Engineering Features Highlight

### 1. Cryptographically Enforced Multi-Tenant Boundary
*   **Zero Tenant Leaks:** Implemented a secure authentication middleware mapping custom Global Express declarations. Intercepts incoming session tokens from **HttpOnly secure cookies**, decoding signed JWT contexts to bind operations strictly to verified tenant `companyId` lines.
*   **Prisma Parameter Isolation:** Eliminates application layer parameters swapping vulnerability points, preventing SQL Injection threat matrix angles natively.

### 🔑 2. Passwordless Biometric Authentication (WebAuthn)
*   Integrates `@simplewebauthn/server` asymmetric cryptography vectors to enable secure hardware sign-ins via Apple Touch ID, Face ID, or Windows Hello.
*   Stores public keys and anti-replay counters natively inside PostgreSQL, rendering typical database breaches entirely useless against cracking engines (e.g., Hashcat).

### 🔒 3. Local AES-256 Symmetric Data Scrambling
*   Engineered a standalone `CryptoUtils` class utilizing Node's native `crypto` module (`aes-256-cbc`) to obfuscate customer name and email strings locally.
*   Uses unique, randomized **Initialization Vectors (IV)** for every input mutation, guaranteeing identical user strings register entirely unique text blocks in the cloud layer database.

### 🐂 4. High-Throughput Background Job Distribution (BullMQ + Redis)
*   Decoupled heavy processing engines out of the primary Express server layer into a standalone `run-worker.ts` execution pool managed by BullMQ.
*   Drastically reduces UI latency by responding instantly to users while background workers execute intensive campaign blasts or data distributions asynchronously inside an isolated thread.

### 🌐 5. Layer-7 Nginx Load Balancing (`least_conn`)
*   Configured an isolated Nginx router acting as the single public gateway endpoint (Port 80), rendering internal server instances completely anonymous.
*   Implements the `least_conn` load balancing algorithm to smartly route traffic to app clusters, utilizes `server_tokens off` to thwart malicious Nmap scanner port sweeps, and bridges WebSockets seamlessly.

---

## 🚀 Microservices Launch Guide

Ensure you have **Docker Desktop** running in your local workstation, then manage operations using isolated workspace scripts:

### 1. Ingest Core Routing Engines
```bash
cd apps/api
npm install
```

### 2. Boot up the Main Web API Engine
```bash
npm run dev
```

### 3. Initialize the Asynchronous Background Queue Worker Cluster
```bash
npm run worker
```