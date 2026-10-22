# Company Lead Tracker

An enterprise-ready, multi-tenant B2B Lead Management Platform and Native Custom Dynamic Form Builder built with **Next.js 16 (App Router & Turbopack)**, **React 19**, and **MongoDB**.

Designed for B2B businesses and marketing organizations, Company Lead Tracker provides complete tenant data isolation, dynamic drag-and-drop form building, public iframe embedding, inbound pipeline lead qualification, RFC 4180 / CWE-1236 protected CSV exports, and Super Admin organizational governance.

---

## Key Features

### 1. Strict Multi-Tenant Isolation
- **Database-Level Boundaries:** Tenant scoping is enforced at the MongoDB query layer across all read, create, update, delete, and export operations.
- **Tamper-Proof Scoping:** Company Admin API requests derive tenant identity strictly from authenticated JWT sessions (`session.user.companyId`). Client-supplied `companyId` inputs are rejected or ignored.
- **Anti-Enumeration Protection:** Accessing another tenant's forms or leads returns a generic `404 Not Found`, preventing ID harvesting.

### 2. Native Dynamic Form Builder
- **Custom Field Types:** Text, Email, Phone, Number, Textarea, Dropdown, Radio, Checkbox, Date, URL, and Password.
- **Automated Key Generation (`labelToKey`):** Human labels are automatically sanitized into unique lowercase alphanumeric submission keys (`company_name`, `work_email_2`).
- **Input Validation & Sanitization:** Enforces min/max boundaries, required checks, and regex validation.
- **Draft & Publish Workflows:** Forms start in `draft` mode. Publishing generates a unique public identifier (`publicId`) and live embed code.
- **Safe Soft-Archival:** Archived forms reject new visitor submissions with `404 Not Found` while preserving historical leads and reporting.

### 3. Embeddable Form Engine (`/embed/[publicId]`)
- **Third-Party Iframe Support:** Configured with `Content-Security-Policy: frame-ancestors *;` while retaining `X-Content-Type-Options: nosniff`.
- **Public API Rate Limits & Payload Bounds:** Visitor submission payloads are capped at 64 KB (`65536` bytes) with strict schema validation to prevent denial of service.
- **Automatic Field Mapping:** Submissions dynamically map to primary lead contact attributes (`companyName`, `contactPerson`, `email`, `phone`, `notes`) while preserving full raw responses in `submissionData`.

### 4. Lead Pipeline & Private Audit Workflows
- **Lifecycle Stages:** `New`, `Approved`, `Contacted`, `Qualified`, `Proposal Sent`, `Won`, `Lost`, `Converted`, `Rejected`.
- **Private Notes:** Dedicated `contactNote` and `rejectionNote` fields for internal sales rep auditing.
- **Real-Time Overview:** Company dashboard includes visibility-aware metrics polling for active forms and pipeline volume.

### 5. Secure CSV Exports
- **RFC 4180 Compliance:** Proper quote doubling, UTF-8 BOM (`\uFEFF`) for Excel compatibility, and date formatting.
- **Spreadsheet Formula Injection Defense (CWE-1236):** Neutralizes execution triggers (`=`, `+`, `-`, `@`, `\t`, `\r`) by prepending a single quote (`'`).
- **Leading-Zero Preservation:** Formats phone numbers and account codes (e.g. `0712345678`) to prevent Excel truncation.
- **Tenant-Scoped Exports:** Single-lead, per-form, and company-wide exports verify tenant ownership before streaming CSV data.

### 6. Role-Based Access Control (RBAC) & Governance
- **Unified Single Login:** Shared authentication portal (`/login`) automatically routes Super Admins to `/dashboard/super-admin` and Company Admins to `/dashboard/company-admin`.
- **Company Registration & Approval Gate:** Public self-registration assigns `pending` status. Accounts cannot log in or accept submissions until approved by Super Admin.
- **Company Suspension:** Blocked companies are barred from authentication, form management, and public submission ingestion.

### 7. Hardened Security Architecture
- **Session Security:** Cryptographically signed JSON Web Tokens (`jose`) stored in `HttpOnly`, `SameSite=Lax` cookies with 24-hour expiration.
- **Password Hashing:** `bcryptjs` with salt rounds = 10.
- **Clickjacking Protection:** Global `X-Frame-Options: DENY` and CSP `frame-ancestors 'none'` on all dashboard, login, register, and API routes.
- **Atomic Rate Limiting:** Synchronous attempt slot reservation before asynchronous database queries eliminates race conditions under high concurrency.
- **Credentials & Error Sanitization:** Database errors and console logs automatically redact MongoDB connection strings and passwords.

---

## Architecture & Technology Stack

| Layer | Technology | Details |
| :--- | :--- | :--- |
| **Framework** | Next.js 16.4.0 | App Router, Server Actions, Partial Prerendering, Turbopack |
| **Frontend** | React 19.3.0 | Modern Hooks, Client & Server Components, Tailwind CSS v4 |
| **Database** | MongoDB 6.0+ | Object modeling via Mongoose 9.11, Compound Indexes |
| **Authentication** | Jose & Bcryptjs | Ed25519 / HS256 JWT sessions, HttpOnly cookie lifecycle |
| **Security** | Custom Engine | CWE-1236 CSV sanitization, atomic sliding window rate limiter |
| **Tooling** | ESLint 9 | Flat config with Next.js Core Web Vitals |

---

## Directory Structure

```
company-lead-tracker/
├── public/                     # Static assets (favicons, icons)
├── scripts/                    # Bootstrap & regression test suites
│   ├── bootstrap-super-admin.js    # Super Admin CLI initialization
│   ├── reset-super-admin-password.js
│   ├── test-escaping.cjs          # CWE-1236 formula injection tests
│   └── ...
├── src/
│   ├── app/
│   │   ├── api/                # Next.js Server Route Handlers
│   │   │   ├── admin/          # Super Admin company approval & analytics
│   │   │   ├── auth/           # Login, logout, register, me endpoints
│   │   │   ├── company/        # Tenant profile & settings
│   │   │   ├── forms/          # Form builder CRUD & publishing
│   │   │   ├── health/         # MongoDB readiness probe
│   │   │   ├── leads/          # Lead management, PATCH status & CSV export
│   │   │   └── public/         # Unauthenticated embed metadata & submissions
│   │   ├── dashboard/          # Protected dashboard views
│   │   │   ├── company-admin/  # Forms, leads table, pipeline analytics
│   │   │   └── super-admin/    # Multi-tenant directory, approvals & metrics
│   │   ├── embed/[publicId]/   # Public iframe renderer route
│   │   ├── login/              # Unified role sign-in portal
│   │   ├── register/           # Company self-registration portal
│   │   └── page.js             # High-conversion product landing page
│   ├── components/             # Reusable UI components
│   │   ├── CustomFormBuilder.js    # Native drag-and-drop form editor
│   │   ├── DashboardLayout.js      # Responsive sidebar navigation
│   │   └── FormRenderer.js         # Public submission & validation engine
│   ├── lib/                    # Shared core utilities
│   │   ├── auth.js             # Session signing, verification & tenant context
│   │   ├── forms.js            # Dynamic key derivation & payload validator
│   │   ├── mongodb.js          # Cached connection pool manager
│   │   └── rateLimit.js        # Hardened sliding-window rate limiter
│   └── models/                 # Mongoose schemas & compound indexes
│       ├── Company.js          # Organization records & approval status
│       ├── Form.js             # Form definitions, components & validation
│       ├── Lead.js             # Submissions, mapped contacts & audit notes
│       └── User.js             # User credentials, roles & company scoping
├── next.config.mjs             # Next.js security headers & CSP configuration
├── package.json
└── README.md
```

---

## Getting Started

### Prerequisites
- **Node.js:** v18.18.0 or later (v20+ recommended, tested on v24)
- **MongoDB:** v6.0 or later (Local MongoDB instance or MongoDB Atlas cluster)
- **npm:** v9.0 or later

### 1. Installation
Clone the repository and install project dependencies:
```bash
git clone <YOUR_REPOSITORY_URL>
cd company-lead-tracker
npm install
```

### 2. Environment Configuration
Create a `.env.local` file by copying the provided template:
```bash
cp .env.local.example .env.local
```

Configure the environment variables in `.env.local`:

| Variable | Required | Description | Example |
| :--- | :---: | :--- | :--- |
| `MONGODB_URI` | **Yes** | Connection string to MongoDB database | `mongodb://localhost:27017/company_lead_tracker` |
| `JWT_SECRET` | **Yes** | Secret key for signing sessions (min 32 chars) | `use-a-strong-random-secret-at-least-32-chars-long` |
| `NEXT_PUBLIC_APP_URL` | **Yes** | Canonical base URL for embed links & iframes | `http://localhost:3000` |
| `NODE_ENV` | No | Application environment mode | `development` or `production` |
| `TRUST_PROXY` | No | Set to `true` if behind reverse proxy (Nginx, Cloudflare) | `false` (default) or `true` |
| `TRUST_PROXY_HOPS` | No | Number of proxy hops to trust for IP resolution | `1` |
| `SUPER_ADMIN_NAME` | No | Name used when running bootstrap script | `"Platform Administrator"` |
| `SUPER_ADMIN_EMAIL` | No | Email used when running bootstrap script | `admin@example.com` |
| `SUPER_ADMIN_PASSWORD` | No | Initial password for bootstrap (min 8 chars) | `SuperAdminPassword123!` |

> **Security Note:** Never commit `.env.local` to version control. The `.gitignore` file is configured to strictly exclude all `.env*.local` and `.env` files.

### 3. Bootstrap Super Admin Account
Initialize the first platform administrator using the built-in bootstrap utility:
```bash
npm run bootstrap:admin
```
Follow the interactive CLI prompts (or pre-populate credentials in your `.env.local`).

To reset the Super Admin password at any time:
```bash
npm run reset:admin
```

### 4. Running Locally
Start the development server with Turbopack:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

- **Unified Sign In:** [http://localhost:3000/login](http://localhost:3000/login)
- **Company Registration:** [http://localhost:3000/register](http://localhost:3000/register)
- **Health Check Probe:** [http://localhost:3000/api/health](http://localhost:3000/api/health)

---

## Embedding Forms on External Websites

Published forms can be embedded into any external website (WordPress, Webflow, Shopify, custom HTML) via responsive iframe.

### Embedding HTML Snippet
```html
<iframe
  src="https://your-domain.com/embed/<FORM_PUBLIC_ID>"
  width="100%"
  height="650"
  frameborder="0"
  style="border: none; border-radius: 12px; max-width: 680px; width: 100%; display: block; margin: 0 auto;"
  title="Contact & Inquiry Form"
  loading="lazy"
  allow="camera 'none'; microphone 'none'; geolocation 'none'"
></iframe>
```

### Embed Security Details
- The embed route (`/embed/[publicId]`) explicitly issues `Content-Security-Policy: frame-ancestors *;` so client websites can embed published forms without clickjacking blocking.
- Embedded forms validate submission payloads on the server and reject submissions if the owning company account is inactive, blocked, or pending review.

---

## Production Deployment & Operational Notes

### 1. Reverse Proxy & Client IP Detection
When deploying behind a reverse proxy (Cloudflare, AWS Application Load Balancer, Nginx, or Vercel), set:
```env
TRUST_PROXY=true
TRUST_PROXY_HOPS=1
```
This enables the sliding-window rate limiter to accurately inspect `CF-Connecting-IP`, `X-Real-IP`, or `X-Forwarded-For` without spoofing vulnerabilities.

### 2. Multi-Instance Rate Limiting
The application includes a hardened in-memory sliding-window rate limiter with synchronous atomic reservations, LRU eviction, and a 10,000-entry memory bound. 
- For single-server deployments (Docker, VPS, PaaS), this provides zero-dependency high-throughput protection.
- For horizontally auto-scaled multi-container clusters, rate limiting operates per container. If global cross-region rate synchronization is required, an external Redis store (e.g., Upstash) can be configured.

### 3. Production Build & Verification
To verify and run production builds:
```bash
npm run build
npm start
```
`npm run build` compiles with Turbopack, performing full TypeScript type verification and static page prerendering across all 27 application routes.

To run static code analysis:
```bash
npm run lint
```

---

## Core API Reference

| Endpoint | Method | Role | Description |
| :--- | :---: | :---: | :--- |
| `/api/auth/login` | `POST` | Public | Authenticates credentials, sets HttpOnly JWT cookie |
| `/api/auth/register` | `POST` | Public | Submits company registration with `pending` status |
| `/api/auth/me` | `GET` | Authenticated | Returns current session user and company metadata |
| `/api/auth/logout` | `POST` | Authenticated | Clears authentication session cookie |
| `/api/forms` | `GET`, `POST` | Company / Admin | Lists or creates tenant-scoped dynamic forms |
| `/api/forms/[id]` | `GET`, `PATCH`, `DELETE` | Company / Admin | Retrieves, updates, or archives a form definition |
| `/api/public/forms/[publicId]` | `GET` | Public | Fetches published form configuration for iframe rendering |
| `/api/public/forms/[publicId]/submissions` | `POST` | Public | Ingests visitor form submission into company leads |
| `/api/leads` | `GET`, `POST` | Company / Admin | Lists filtered leads or creates a manual lead entry |
| `/api/leads/[id]` | `GET`, `PATCH`, `DELETE` | Company / Admin | Updates lead qualification status, notes, or deletes record |
| `/api/leads/export` | `GET` | Company / Admin | Downloads RFC 4180 / CWE-1236 sanitized CSV lead export |
| `/api/admin/companies` | `GET`, `POST`, `PATCH` | Super Admin | Company approvals, status updates, search & pagination |
| `/api/health` | `GET` | Public | Returns database connection probe without exposing secrets |

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
