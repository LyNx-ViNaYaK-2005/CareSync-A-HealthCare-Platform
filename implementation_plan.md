# Healthcare Appointment & Follow-up Manager - Implementation Plan (Revised)

Building a cloud-native Healthcare Appointment and Follow-up Platform featuring Patient, Doctor, and Admin portals, AI-powered pre-visit symptom analysis, AI post-visit patient summaries, double-booking prevention, doctor leave management, automated email & Google Calendar syncing, and background medication reminders.

---

## User Review Required

> [!IMPORTANT]
> **Cloud Setup & Credentials**: This project is 100% cloud-native (zero local storage). The following environment variables will be configured in `.env.example` (never committed as `.env`):
> - `MONGODB_URI`: MongoDB Atlas connection string.
> - `JWT_SECRET`: Secret key for authentication tokens.
> - `LLM_API_KEY`: API Key for AI summaries (Gemini / OpenAI).
> - `EMAIL_API_KEY` / `SMTP_URL`: Resend, Nodemailer, or SendGrid API configuration.
> - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`: OAuth 2.0 credentials for a single **clinic-owned** Google account used to create calendar events (see §5 below — no per-user OAuth).
> - `CLIENT_URL`: Deployed frontend URL, used for CORS and invite/reset links.
> - `TIMEZONE`: Clinic's IANA timezone (e.g. `Asia/Kolkata`), used for slot generation and display.

---

## Open Questions

> [!NOTE]
> **LLM Provider Choice**: Google Gemini API (free tier) or OpenAI (GPT-4o-mini)? Defaults to Gemini with Zod fallback handling.

> [!NOTE]
> **Hosting**: Frontend on Vercel, backend on Render (free tier). Render free-tier dynos sleep on inactivity — the reminder cron needs an external keep-alive/trigger (see §7).

---

## Technical Architecture & Design Solutions

### 1. Concurrency & Double-Booking Prevention
- **Partial Unique Index**: MongoDB compound index on `{ doctorId: 1, date: 1, startTime: 1 }`, filtered to `status: { $in: ["HELD", "CONFIRMED"] }`.
- **Atomic `findOneAndUpdate`**: guarantees only one simultaneous request claims a slot.

### 2. Slot Hold Mechanism
- **MongoDB Native TTL Index**: `appointmentSchema.index({ holdExpiresAt: 1 }, { expireAfterSeconds: 0 })`.
- Slot is `HELD` for 5 minutes during symptom input; auto-expires if unconfirmed.
- **Race-condition fix**: at confirm time, re-check the document is still `HELD`, owned by the requesting patient, and `holdExpiresAt > now()` inside the same atomic update. If the hold has lapsed, return a `410 SLOT_EXPIRED` and let the frontend prompt a rebook — do not silently fail.

### 3. Doctor Leave Conflict Management
- Marking a doctor on leave updates leave records and atomically transitions all impacted appointments on that date to `CANCELLED_BY_DOCTOR`.
- Emits async events to send cancellation emails and delete synced Google Calendar events.

### 4. LLM Pre & Post Visit Summaries with Fallback Safety
- **Pre-Visit Prompt** → `{ urgencyLevel: "LOW"|"MEDIUM"|"HIGH", chiefComplaint: string, suggestedQuestions: string[] }`.
- **Post-Visit Prompt** → `{ patientFriendlySummary: string, medicationSchedule: MedicationItem[] }`.
- **`MedicationItem` strict schema** (Zod-validated, not free text — required so `reminderCron.js` can actually schedule reminders):
  ```ts
  {
    medicineName: string,
    dosage: string,          // e.g. "500mg"
    frequencyPerDay: number, // e.g. 2
    times: string[],         // ["09:00", "21:00"], 24h clock, clinic timezone
    durationDays: number
  }
  ```
- **Graceful Fallback**: LLM calls wrapped in a 10s timeout + 1 retry. On failure/invalid schema, save raw input, mark `llmStatus: "FAILED_FALLBACK"`, and continue the booking/consultation flow without crashing.

### 5. Google Calendar Integration Model
- **Single clinic-owned Google account** (service/admin account) holds the OAuth refresh token — **not** per-patient or per-doctor OAuth. This avoids per-user consent screens and token-refresh storage, which would otherwise balloon scope significantly.
- On booking confirmation, the backend creates an event via this account and adds the patient's and doctor's emails as **attendees** (`sendUpdates: "all"`), so both receive a native Google Calendar invite without logging into anything.
- Reschedule → `events.patch`; cancellation → `events.delete`. Event IDs stored on the `Appointment` document.

### 6. Timezone Handling
- All appointment times stored in MongoDB as UTC `Date` objects.
- Working hours, slot generation, and display conversions use the clinic's `TIMEZONE` env var (via `luxon` or `date-fns-tz`) at the API boundary — never trust client-local time for slot math.

### 7. Deployment & Background Jobs
- **Frontend**: Vercel (static Vite build, `VITE_API_BASE_URL` pointed at backend).
- **Backend**: Render (Node web service) with `render.yaml` for build/start commands and env var declarations.
- **Cron reliability**: Render free-tier services sleep after inactivity, which would silently break `reminderCron.js`. Mitigation: use an external pinger (e.g. cron-job.org or UptimeRobot) hitting a lightweight `/api/health` endpoint every 10 minutes to keep the dyno warm, in addition to the in-process `node-cron` schedule.
- `.env.example` documents every variable needed to run in both local and deployed environments.

---

## Proposed Changes

### Backend (`server/`)

#### [NEW] `server/config/db.js`
MongoDB Atlas connection using Mongoose, auto-reconnect and error handling.

#### [NEW] `server/models/User.js`
Mongoose User model, bcryptjs password hashing, RBAC (`PATIENT`, `DOCTOR`, `ADMIN`), plus `mustResetPassword: Boolean` flag for invited doctor accounts.

#### [NEW] `server/models/DoctorProfile.js`
Specialization, slot duration, working hours schedule.

#### [NEW] `server/models/DoctorLeave.js`
Leave dates and reasons.

#### [NEW] `server/models/Appointment.js`
TTL index on `holdExpiresAt`, status flags, pre-visit summary JSON, post-visit summary JSON (with typed `medicationSchedule`), Google Calendar event IDs.

#### [NEW] `server/models/NotificationLog.js`
Email dispatch statuses, retry counts, background job logs.

#### [NEW] `server/middleware/authMiddleware.js`
JWT verification, role-based authorization (`protect`, `authorize('ADMIN')`).

#### [NEW] `server/middleware/validateRequest.js`
Zod-schema request validation middleware, applied per route (registration, booking, symptom submission, leave marking) — rejects malformed payloads before they reach controllers.

#### [NEW] `server/middleware/rateLimiter.js`
`express-rate-limit` configs for auth endpoints and LLM-triggering endpoints (symptom submission, post-visit summary generation) to prevent abuse and control LLM cost.

#### [NEW] `server/services/llmService.js`
Pre-visit/post-visit AI integration, Zod schema validation (including `medicationSchedule`), fallback logic, 10s timeout + retry.

#### [NEW] `server/services/emailService.js`
HTML templates + dispatch for booking confirmation, cancellation, reminders, **and doctor account invites**.

#### [NEW] `server/services/googleCalendarService.js`
Single-account OAuth 2.0 client; create/update/delete events with patient + doctor as attendees.

#### [NEW] `server/services/reminderCron.js`
`node-cron` scheduler: checks active medication schedules against current time/timezone, dispatches reminder emails, retries failed `NotificationLog` entries.

#### [NEW] `server/controllers/authController.js`
Patient registration, login, profile fetch, password reset (used by invited doctors).

#### [NEW] `server/controllers/doctorController.js`
Admin doctor creation (triggers invite email), working hours config, leave management, conflict cancellation.

#### [NEW] `server/controllers/appointmentController.js`
Slot availability generation, atomic hold/booking, symptom submit + pre-visit summary, post-visit notes + summary, reschedule, cancellation.

#### [NEW] `server/routes/authRoutes.js`, `doctorRoutes.js`, `appointmentRoutes.js`, `adminRoutes.js`
Explicit Express route definitions binding controllers, validation middleware, and auth/role guards — documented in the README's API reference.

#### [NEW] `server/server.js`
Express entry point: middleware (CORS restricted to `CLIENT_URL`, JSON body parsing, rate limiting), routes, centralized error handler, cron initialization, `/api/health` endpoint for the uptime pinger.

#### [NEW] `.env.example`, `.gitignore`
`.gitignore` excludes `node_modules/`, `.env`, `dist/`, `.vscode/`, `.idea/` per submission guidelines.

---

### Frontend (`client/`)

#### [NEW] `client/package.json`
React + Vite, Lucide icons, Axios, Tailwind CSS.

#### [NEW] `client/src/App.jsx`
React Router layout, protected role-based routes (Patient/Doctor/Admin).

#### [NEW] `client/src/components/Navbar.jsx`
Responsive header: role display, quick links, logout.

#### [NEW] `client/src/pages/patient/PatientDashboard.jsx`
Upcoming appointments, pre/post-visit summaries, medication reminders, history.

#### [NEW] `client/src/pages/patient/BookAppointment.jsx`
Doctor search by specialization, slot picker, symptom form, hold/confirm flow with expiry handling.

#### [NEW] `client/src/pages/doctor/DoctorDashboard.jsx`
Daily schedule, pre-visit AI insights, urgency indicators, leave request form.

#### [NEW] `client/src/pages/doctor/ConsultationView.jsx`
Post-visit notes editor, prescription writer (structured medication entry), AI summary generator.

#### [NEW] `client/src/pages/admin/AdminDashboard.jsx`
Doctor creation (with invite trigger), working hours, slot duration, system stats.

#### [NEW] `client/src/pages/auth/SetPassword.jsx`
Password-set screen for doctors landing via invite link (`mustResetPassword` flow).

---

### Deliverables & Documentation

#### [NEW] `README.md`
Setup guide, `.env.example` reference, full API endpoint docs, DB schema diagrams, LLM prompt reference, Google Calendar OAuth setup (clinic-account model), deployment steps for Vercel + Render.

#### [NEW] `SYSTEM_DESIGN.md`
800-word write-up covering: double-booking prevention (atomic locks), doctor leave conflict resolution, TTL slot hold mechanism, notification failure/retry handling.

#### [NEW] `render.yaml`, `vercel.json`
Deployment configuration for backend and frontend respectively.

---

## Verification Plan

### Automated Verification
- **Double Booking Test**: concurrent curl scripts firing simultaneous requests for the same doctor slot — verify exactly 1 succeeds, 0 double-bookings.
- **Hold Expiry Test**: confirm a slot after `holdExpiresAt` has passed — verify `410 SLOT_EXPIRED`, not a silent success or crash.
- **LLM Graceful Failure Test**: simulate invalid API key / timeout — verify appointment/consultation flow completes with fallback data saved.
- **Request Validation Test**: send malformed payloads to booking/registration endpoints — verify rejection with clear 4xx errors, not silent DB writes.

### Manual Verification
- **Role Workflows**: Admin creates Doctor → Doctor receives invite email, sets password, logs in → Patient registers, searches doctor, submits symptoms, sees AI urgency, confirms booking.
- **Doctor Consultation**: Doctor reviews pre-visit summary, submits notes/prescription, verifies patient-friendly post-visit summary and structured medication schedule.
- **Doctor Leave**: mark doctor on leave for a date with existing bookings, verify affected patients receive cancellation emails and calendar events are removed.
- **Google Calendar Sync**: verify both patient and doctor receive a calendar invite (as attendees) on booking, and that reschedule/cancel updates the same event.
- **Deployed App**: verify hosted URL (Vercel frontend + Render backend) functions end-to-end, and that the reminder cron still fires after a period of inactivity (uptime pinger check).
