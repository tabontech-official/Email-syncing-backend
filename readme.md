# Zenith Email Syncing & Automation Backend API

A RESTful Node.js & Express API backend powered by MongoDB for handling automated email syncing, lead routing, IMAP/SMTP connection management, AI-driven auto-responses, webhooks, and scenario execution tracking.

---

## 🚀 Features & Modules

- **Authentication & User Management**: User registration, login, JWT token auth, password reset, OAuth Google/Microsoft integration, role-based permissions.
- **Email Syncing & Processing Engine**:
  - IMAP/SMTP polling via `imapflow` and `nodemailer`
  - Real-time Mailhook webhooks processing (`/mailhook`)
  - Email thread tracking, customer reply ingestion, and auto-attachment mapping
- **Scenario Workflows & Rules Engine**: Custom condition routing, Shopify lead matching, delay nodes, and execution logging (`/scenario`, `/scenariorunlog`).
- **Response Templates System**: CRUD operations for Shopify Partner Directory and custom email response templates (`/template`).
- **AI Auto-Response Engine**: Google Gemini (`@google/generative-ai`) & OpenAI integration for dynamic lead email response generation.
- **Connections Management**: Configuration for OAuth tokens, custom SMTP/IMAP servers, and status validation (`/connection`).
- **Payment & Subscriptions**: Stripe billing webhook integration (`/stripe`).

---

## 🛠️ Tech Stack

- **Runtime & Framework**: Node.js (ES Modules), Express.js
- **Database**: MongoDB with Mongoose ORM
- **Email Protocols**: `imapflow`, `nodemailer`, `mailparser`, `smtp-server`
- **AI Integrations**: `@google/generative-ai`, `openai`
- **Authentication & Security**: JSON Web Tokens (`jsonwebtoken`), `bcryptjs`, `helmet`, `cors`
- **API Documentation**: Swagger UI Express (`swagger-ui-express`, `swagger-jsdoc`)
- **Deployment**: Vercel Serverless (`vercel.json`)

---

## 📁 Directory Structure

```
Email-syncing-backend/
├── Models/                 # Mongoose schemas (User, Scenario, Template, Connection, Email)
├── Routes/                 # Express route handlers
│   ├── Scenario.js
│   ├── auth.js
│   ├── connection.js
│   ├── email.js
│   ├── mailhook.js
│   ├── scenarioRunLog.js
│   ├── stripe.js
│   └── template.js
├── controller/             # Business logic & route controllers
├── middleware/             # Auth, error handling, validation middlewares
├── utils/                  # Helper functions, email parsers, AI engines
├── config/                 # Database connection & third-party API configs
├── app.js                  # Express app setup
├── index.js                # Server entry point
├── vercel.json             # Vercel deployment configuration
├── package.json
└── README.md
```

---

## 💻 Getting Started

### Environment Variables

Create a `.env` file in the root directory based on `env-sample`:

```env
PORT=5000
MONGODB_URI=mongodb+srv://<user>:<password>@cluster.mongodb.net/dbname
JWT_SECRET=your_jwt_secret_key
OPENAI_API_KEY=your_openai_key
GEMINI_API_KEY=your_gemini_key
STRIPE_SECRET_KEY=your_stripe_secret_key
```

### Installation

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run in development mode**:
   ```bash
   npm run dev
   ```

3. **Run in production mode**:
   ```bash
   npm start
   ```
   The backend server will start listening on `http://localhost:5000`.

---

## 🌐 API Documentation

Swagger API documentation is available when running the server at:
- `http://localhost:5000/api-docs`

---

## 📜 License

This project is licensed under the MIT License.
