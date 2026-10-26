# Pharmacy Procurement System (PharmaFlow)

A separate Node.js / Express / MongoDB project for inventory, POS and pharmacist–supplier procurement. This repository is independent of the older MediVault project.

## Requirements and first run

Use Node.js 20.19 or newer and MongoDB configured as a replica set (or an Atlas deployment supporting transactions). Open PowerShell in this project folder:

```powershell
npm install
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the generated value into `JWT_SECRET` in `.env`. Keep your existing `.env` if already configured; update its MongoDB URI for the replica set. Do not commit `.env`.

```env
PORT=5000
MONGODB_URI=mongodb://127.0.0.1:27017/pharmacy_db?replicaSet=rs0
JWT_SECRET=your_generated_secret
JWT_EXPIRES_IN=7d
NODE_ENV=development
```

The app also supports folders with hidden ancestors, such as Antigravity’s `.gemini` workspace. Only known application pages and authorized attachment downloads allow those paths; hidden static files stay blocked.

Run `npm run dev`, then open http://localhost:5000. Express serves the frontend; a separate Live Server is unnecessary.

## Home, registration and login

- `/` or `/home`: public home page with features, role overview, Login and Register links.
- `/register`: submit a registration request as Pharmacist, Cashier or Supplier. Suppliers provide their company name. Public registration cannot create an admin account, activate itself or claim an existing supplier company.
- `/login`: a separate login page for all four roles. No popup login or demo-login bar. The account role determines the dashboard after login.
- `/app`: the authenticated pharmacy workspace. The browser verifies the session before displaying it; missing or expired sessions return to Login. Backend APIs continue to enforce authorization.

New registrations remain inactive until reviewed. Admin → Staff & Security → Edit the pending account → verify details → select/link the supplier company when applicable → enable Account Active → save. Create a supplier company in Suppliers Directory first if it does not exist. The applicant can then log in with the password they registered. Existing accounts continue to work. Administrator accounts are created by an existing admin (or the development seed for initial local setup).

## Existing local MongoDB on Windows

Receiving, returns, credits and POS checkout use multi-document transactions. A standalone database returns a clear 503 **before any stock changes**; there is no unsafe sequential fallback.

For an existing Windows MongoDB service, back up your database first and locate its actual `mongod.cfg` (usually under `C:\Program Files\MongoDB\Server\<version>\bin`). Add the following top-level YAML section without changing the existing storage path or network settings:

```yaml
replication:
  replSetName: rs0
```

Restart the service in an Administrator PowerShell terminal (use its actual service name if different):

```powershell
Restart-Service MongoDB
mongosh "mongodb://127.0.0.1:27017"
```

Inside mongosh, initialize once:

```javascript
rs.initiate({_id: "rs0", members: [{_id: 0, host: "127.0.0.1:27017"}]})
rs.status()
```

Wait for PRIMARY. If the replica set is already initialized, do not reinitialize it; use its existing name in the URI. These steps reuse the existing storage path and database. Atlas is an alternative; use the connection string supplied for that deployment.

## Demo accounts (local development only)

Optional, additive seeding:

```powershell
npm run seed
npm run seed:suppliers
```

Seeding is refused unless `NODE_ENV=development`. Existing users, passwords, inventory and suppliers are preserved. The main seed skips sample sales when inventory already exists. Supplier seeds add missing linked logins and sample orders only when no orders exist. They do not fabricate receipts or payments for your live records.

| Role | Email | Password for newly seeded account |
|---|---|---|
| Admin | admin@pharmacy.com | Admin@123 |
| Pharmacist | pharmacist@pharmacy.com | Pharma@123 |
| Cashier | cashier@pharmacy.com | Cashier@123 |
| Apex supplier | supplier.apex@pharmacy.com | Apex@123 |
| BioCare supplier | supplier.biocare@pharmacy.com | BioCare@123 |
| NovaCare supplier | supplier.nova@pharmacy.com | Nova@123 |

Existing passwords are never reset by seeding. Public login pages use manual credentials; demo shortcut buttons have been removed. Use your own accounts and passwords outside development.

## Role workflows

- **Admin:** manage staff and supplier logins, link each supplier user to a company, configure optional purchase approval, approve orders, inspect audit history and procurement.
- **Pharmacist:** review stock/expiry alerts, create or edit drafts, submit orders, confirm proposed supplier terms, track deliveries, receive verified multi-batch quantities, request returns, record invoices/payments and apply resolved return credits.
- **Supplier:** view only its company's dashboard, assigned orders, delivery tracking, returns, invoices, notifications and profile. Accept/reject orders, propose revisions, pack, dispatch, report delays, mark delivered and discuss orders.
- **Cashier:** inventory lookup, POS billing and sales/receipt reprinting. Procurement and cost prices are blocked by APIs.

### Try the full workflow

1. Pharmacist → Stock & Expiry Alerts → Create Order. Suggestions are computed on the server from demand, supplier lead/safety days, usable stock and outstanding incoming units. Existing open orders are shown as warnings.
2. Submit directly or save/edit a draft. When approval is enabled, orders meeting the threshold wait for admin approval. Supplier cannot see drafts or unapproved orders.
3. Supplier → Purchase Orders → accept or propose revised quantities, prices or delivery date. Pharmacist must confirm proposals. Terms meeting the active approval threshold return to admin approval.
4. Supplier → mark Packed → Dispatch with optional carrier/tracking details → Delivered. Use Report Delay to change ETA and notify pharmacy. Tracking is a shared status timeline, not live GPS.
5. Pharmacist → order → Verify & Receive Stock. Record delivered, accepted and rejected units and accepted batches. Add multiple batches using Add Accepted Batch. Only accepted units increase stock. Partial receipt leaves remaining quantities outstanding.
6. Reopen the order and receive the remaining units to complete it. Receipt retries use the same submission key and cannot add stock twice. Rejected delivery units stay outside inventory; request replacements through the outstanding order.
7. Pharmacist → Returns → select exact stock batch and source receipt. Requested units move into a separate quarantine batch. Supplier approves → pharmacist sends back → supplier acknowledges and resolves. Rejected return requests remain quarantined for staff inspection/disposal; they are never automatically made sellable.
8. Supplier replacement goods must go through a purchase order and verified receipt. Resolving a return never adds stock automatically.
9. Pharmacist → received order → Record Supplier Invoice → open invoice to record payments or apply a full resolved-return credit. Suppliers can view balances but cannot record pharmacy payments. Credits can be used once against the same supplier; partial credit allocation across invoices is not supported.
10. Use order discussions and document uploads for communication. Downloaded documents require authentication and company ownership. In-app reminders cover stock, expiry and invoices due within seven days. Inbox badges poll every 20 seconds; open Notifications to refresh details.

## Data and security

All monetary displays use INR. Quantities are whole units. Backend permissions apply even if browser menus are bypassed. Supplier responses do not expose pharmacy selling prices, and cashiers cannot retrieve purchase costs. Archiving medicines/suppliers and deactivating users preserve historic references. No external email, SMS or payment gateway is configured.

PDF, JPEG and PNG attachments are limited to 5 MB with signature/type validation. Files are stored outside the public directory. `/uploads` is not public. Order, invoice, receipt and return document APIs are under `/api/attachments/:kind/:id` with kinds `orders`, `invoices`, `receipts`, `returns`.

Existing documents do not require destructive migration; new optional fields are filled for new actions. Legacy batches without a receipt reference require selecting the matching original receipt for returns. A legacy batch with no original receiving record cannot enter this traceable return workflow without first reconciling its history. Expiry alerts never auto-order or guarantee return eligibility.

## Verification

```powershell
npm test
npx playwright install chromium
npm run test:ui
```

Tests use a disposable MongoDB replica set and separate database, never the configured pharmacy database. The first run downloads a MongoDB test binary. The API suite exercises all four roles, company isolation, approval/reapproval, partial multi-batch receiving, concurrent duplicate submissions, invalid receipt rollback, returns, credits, payments, attachments and POS.

The browser suite starts the same isolated fixture and checks role navigation and key forms. `tests/ui.cjs` is the internal browser runner; `npm run test:ui` starts its fixture automatically.

## Limits

Notifications are in-app and refreshed by polling; no background email/SMS worker. Invoice UI currently shows the latest 100 records and receipts the latest 200; the backend invoice and order APIs expose pagination. Return credits must be applied in full to one invoice with sufficient outstanding balance. Refunds and replacements are recorded resolutions, not automated bank transfers or supplier dispatch integrations. Help is guidance, not a ticketing service.
