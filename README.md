# CareSync — Healthcare Appointment & Follow-up Manager

A full-stack clinic platform with separate **Patient**, **Doctor**, and **Admin** portals. It prevents double-booking under concurrent load, holds slots while patients describe symptoms, runs AI triage before the visit and writes a plain-language summary after it, cascades cancellations when a doctor takes leave, syncs Google Calendar, and sends email reminders from a background worker.

**Stack** — React 18 · Vite · Tailwind · Node · Express · MongoDB Atlas · Google Gemini · Nodemailer · Google Calendar API

---

## Live demo

| | |
|---|---|
| **Application** | https://caresync-rose.vercel.app |
| **API** | https://caresync-backend-u4mo.onrender.com |
| **Health check** | https://caresync-backend-u4mo.onrender.com/api/health |

### Sign in

| Role | Email | Password |
|---|---|---|
| Doctor | `dr.house@caresync.com` | `DoctorPassword123!` |
| Patient | register your own | — |

Admin credentials are supplied with the submission rather than published here.

> The backend runs on Render's free tier. A keep-alive pinger hits `/api/health` every 10 minutes, but if the instance has gone cold the first request can take up to 50 seconds. Reload once.

### A two-minute tour

1. **Register** as a patient → **Book an appointment** → pick a doctor and slot.
2. Describe symptoms in the modal. Try something with a red flag — *"crushing chest pain radiating to my left arm, sweating"* — and watch it come back **HIGH** urgency with three clinically relevant questions.
3. You get a confirmation email and a Google Calendar invitation.
4. Sign in as **Dr. House** to see the AI assessment on the schedule, ordered with high-urgency patients first. Record notes and a prescription.
5. Back as the patient, read the plain-language summary and the medication schedule you'll be emailed reminders for.
6. As the doctor, **mark a leave day** with bookings on it — every affected appointment is cancelled, both parties emailed, and the calendar event removed.

All four integrations are live. Nothing is stubbed.

---

## Running locally

### Prerequisites
- Node.js 18+
- A free [MongoDB Atlas](https://cloud.mongodb.com) cluster

### 1. MongoDB Atlas — the only required credential

1. Create a free **M0** cluster.
2. **Database Access** → add a database user; avoid `@ : / ? # [ ] %` in the password or it needs percent-encoding.
3. **Network Access** → **Allow access from anywhere** (`0.0.0.0/0`). Render's egress IPs rotate, so a narrower rule breaks the deployed backend.
4. **Connect → Drivers** → copy the string.

Copy [`.env.example`](.env.example) to `server/.env` and set `MONGODB_URI`, keeping `/caresync_db` before the `?`:

```
MONGODB_URI=mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/caresync_db?retryWrites=true&w=majority
```

Verify before starting anything:

```bash
cd server && npm install && npm run check:db
```

### 2. Backend

```bash
cd server && npm run dev
```

First boot connects, builds indexes, and seeds an admin plus five demo doctors:

```
[DB] MongoDB Atlas connected: cluster0-shard-00-01.xxxxx.mongodb.net/caresync_db
[DB] Indexes synced. Double-booking guard: ACTIVE | Slot-hold TTL: ACTIVE
[Seed] Admin account created: admin@caresync.com
[Startup] CareSync API listening on port 5000
```

### 3. Frontend

```bash
cd client && npm install && npm run dev
```

<http://localhost:5173>

> **Why the admin is seeded from env.** No API route can create an `ADMIN`. Self-registration is hardcoded to `PATIENT`, and doctors are created *by* an admin. Without `ADMIN_EMAIL` / `ADMIN_PASSWORD`, the admin console is unreachable on a fresh database.

### Running without the optional integrations

Only `MONGODB_URI` is required. Each integration degrades independently and deliberately:

| Missing | Behaviour |
|---|---|
| `GEMINI_API_KEY` | Summaries fall back to deterministic text tagged `FAILED_FALLBACK`, surfaced in both dashboards. Booking completes. |
| `SMTP_*` | Emails print to the console and are recorded as `SENT (simulated)`. |
| `GOOGLE_*` | Calendar events get a `mock_gcal_` id. Reschedule and cancel still work. |

---

## Diagnostics

Three scripts that check a dependency in isolation and explain what's wrong rather than surfacing a raw provider error.

```bash
npm run check:db                              # Atlas connection + index state + row counts
npm run check:email                           # SMTP auth
npm run check:email -- you@example.com        # ...and send a real test message
npm run check:calendar                        # OAuth token exchange + Calendar API reachability
npm run check:calendar -- --create            # ...and round-trip a real create/patch/delete
```

Each diagnoses the common failures — a placeholder password, a missing IP allow-list entry, a Google account password used where an app password is needed, a refresh token expired by Testing-mode publishing.

---

## Environment variables

Full annotated reference: [`.env.example`](.env.example).

| Variable | Required | Notes |
|---|:---:|---|
| `MONGODB_URI` | **yes** | Atlas SRV string |
| `JWT_SECRET` | **yes** | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | **yes** | Seeds the only admin account |
| `CLIENT_URL` | in prod | CORS allow-list; comma-separate for multiple origins |
| `TIMEZONE` | | IANA zone, default `Asia/Kolkata`. Drives all slot and reminder maths |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | | Default model `gemini-3.5-flash-lite` |
| `SMTP_*` / `EMAIL_FROM` | | Any SMTP provider |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `_REFRESH_TOKEN` | | Single clinic account |
| `SLOT_HOLD_MINUTES` | | Hold window, default `5` |
| `REMINDER_TICK_MINUTES` / `REMINDER_WINDOW_MINUTES` | | Cron cadence and catch-up window |
| `RATE_LIMIT_AUTH` / `_LLM` / `_BOOKING` | | Per-IP caps |
| `ALLOW_LOCAL_DB_FALLBACK` / `ALLOW_INMEMORY_DB` | | Opt-in offline dev only. Keep `false` when deployed |

**Frontend** (`client/.env`): `VITE_API_BASE_URL` — blank locally (Vite proxies `/api`), set to the backend URL in production. Vite inlines it **at build time**, so changing it requires a rebuild, not just a restart.

---

## Database schema

### `User`
`name` · `email` (unique, lowercase) · `password` (bcrypt, `select: false`) · `role` (`PATIENT` | `DOCTOR` | `ADMIN`) · `phone` · `mustResetPassword`

### `DoctorProfile`
`user` (unique ref) · `specialization` · `slotDurationMins` (15–120) · `roomNumber` · `bio` · `isActive` · `workingHours[]` → `{ dayOfWeek, startTime, endTime, isAvailable }`

### `DoctorLeave`
`doctor` · `date` (`YYYY-MM-DD`) · `reason` · `status` (`ACTIVE` | `CANCELLED`)
Unique compound index on `{ doctor, date }` — repeat submissions are idempotent.

### `Appointment`
`patient` · `doctor` · `date` · `startTime` · `endTime` · `status` · `holdExpiresAt` · `symptomsText` · `preVisitSummary` · `postVisitNotes` · `prescription[]` · `prescribedAt` · `postVisitSummary` · `googleEventId` · `googleEventLink` · `cancellationReason` · `rescheduleHistory[]` · `remindersSent[]`

Two indexes carry the core guarantees:

```js
// At most one active booking per doctor/date/time. Cancelled rows fall outside
// the partial filter, so a freed slot is immediately re-bookable.
{ doctor: 1, date: 1, startTime: 1 }
  → unique, partialFilterExpression: { status: { $in: ['HELD','CONFIRMED'] } }

// Mongo purges unconfirmed holds on its own.
{ holdExpiresAt: 1 } → expireAfterSeconds: 0
```

`syncIndexes()` runs at startup and logs whether both are active — a collection created before an index was added would otherwise keep accepting duplicates silently.

### `NotificationLog`
`type` · `recipientEmail` · `recipientRole` · `subject` · `body` · `status` (`PENDING` | `SENT` | `FAILED`) · `attempts` · `lastError` · `requiresAdminReview` · `appointmentId`

---

## API reference

Protected routes take `Authorization: Bearer <token>`. Every mutating route is Zod-validated and returns `400` with per-field errors on a malformed payload.

### Auth — `/api/auth`
| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/register` | Public | Register a patient (role forced to `PATIENT`) |
| POST | `/login` | Public | Returns a JWT. `401` on bad credentials |
| GET | `/me` | Private | Current profile |
| POST | `/set-password` | Private | First-login password set for invited doctors |

### Doctors — `/api/doctors`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Public | Roster. `?specialization=` `?search=` `?includeInactive=` |
| GET | `/:id` | Public | Profile with upcoming leave |
| POST | `/` | Admin | Create doctor + send invite email |
| PUT | `/:id` | Admin / self | Working hours, slot duration, room, specialization, active flag |
| GET | `/:id/leave` | Private | Scheduled leave days |
| POST | `/:id/leave` | Admin / self | Mark leave → cascading cancellation + notifications |
| DELETE | `/:id/leave` | Admin / self | Withdraw a leave day |

### Appointments — `/api/appointments`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/available-slots` | Public | `?doctorId=&date=`. Excludes booked, held, and past slots |
| GET | `/stats` | Admin | Clinic-wide counts |
| POST | `/hold` | Patient | Reserve a slot for 5 minutes. `409` if taken |
| POST | `/confirm` | Patient | Symptoms → AI summary + calendar + emails. `410` if the hold lapsed |
| GET | `/` | Private | Scoped by role |
| GET | `/:id` | Private | Own appointment, or admin |
| POST | `/:id/consultation` | Doctor | Notes + prescription → AI patient summary |
| PUT | `/:id/cancel` | Involved / admin | Remove calendar event, email both sides |
| PUT | `/:id/reschedule` | Involved / admin | Patch calendar, email both sides |

### Health — `GET /api/health`
`200 UP` / `503 DEGRADED` with real database state. Target for the uptime pinger.

---

## LLM prompts and failure handling

Both prompts request strict JSON (`responseMimeType: application/json`), are Zod-validated on return, and run under a 20-second timeout with exactly one retry.

### Pre-visit triage

> You are a medical triage assistant supporting a clinic's doctors. Analyse these patient symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor. … Use HIGH for red-flag presentations (chest pain, breathing difficulty, severe bleeding, stroke signs, suicidal ideation). … chiefComplaint must be a concise clinical summary, not a diagnosis. … Never state a diagnosis or recommend a treatment.
> `Symptoms: "<symptomsText>"`

```json
{ "urgencyLevel": "LOW|MEDIUM|HIGH", "chiefComplaint": "…", "suggestedQuestions": ["…","…","…"] }
```

### Post-visit summary

> You are a patient communication specialist at a clinic. Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps. … medicationSchedule must mirror the prescription details supplied below. Do not invent, add, remove, or alter any medicine or dosage. … times must be 24-hour "HH:mm" strings in the `<TIMEZONE>` timezone. … Write to the patient in second person. Never contradict the clinical notes.
> `Clinical Notes: "<notes>"` · `Prescription Details: <json>`

```json
{ "patientFriendlySummary": "…", "medicationSchedule": [ … ], "followUpSteps": ["…"] }
```

### Failure handling

A missing key, timeout, malformed JSON, or schema violation all resolve to a deterministic fallback tagged `llmStatus: "FAILED_FALLBACK"` and shown in both dashboards. The booking or consultation always completes.

### Safety boundary

The doctor's `prescription` array is the **only** input to medication reminders. The LLM's `medicationSchedule` is stored for display and cross-checking. An LLM is never the source of truth for what a patient takes.

### Model choice

Google retires Gemini versions on a short cycle — `gemini-1.5-flash` and `gemini-2.5-flash` both return 404 for newly issued API keys. The model is therefore `GEMINI_MODEL` rather than hardcoded; if calls start 404ing, change the variable. The default `gemini-3.5-flash-lite` returns triage in ~1.3s versus ~14.7s for `gemini-3.6-flash` at equivalent quality on this task, which matters because the patient waits on this call during booking.

---

## Google Calendar setup

One **clinic-owned** Google account holds the refresh token. Patients and doctors are added as *attendees* and receive native invitations without any OAuth of their own.

Google recently replaced the "OAuth consent screen" with **Google Auth Platform**, so older guides won't match.

1. [console.cloud.google.com](https://console.cloud.google.com) → new project.
2. **APIs & Services → Library** → enable **Google Calendar API**.
3. **Google Auth Platform → Branding** — app name, support email, developer email, plus **homepage URL** and **privacy policy URL** (both required before publishing; this repo serves one at `/privacy`).
4. **Data access** → add scope `https://www.googleapis.com/auth/calendar` — full access, not `calendar.readonly`.
5. **Audience** → **Publish app**.
   ⚠️ In **Testing** status Google expires refresh tokens after **7 days**. Publishing to production keeps them alive. Verification is *not* required — an unverified production app just shows a warning screen you click past.
6. **Clients** → Create client → **Web application** → authorised redirect URI `https://developers.google.com/oauthplayground`.
7. [OAuth Playground](https://developers.google.com/oauthplayground) → gear icon → **Access type: Offline** → tick *Use your own OAuth credentials* → paste client id and secret → enter the calendar scope → **Authorize** → **Exchange authorization code for tokens** → copy the **refresh token** (`1//…`).
8. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, then run `npm run check:calendar -- --create`.

**Access type must be Offline** — on Online the flow appears to succeed and returns no refresh token at all. Google also only issues one on *first* consent; if the field comes back empty, revoke at [myaccount.google.com/permissions](https://myaccount.google.com/permissions) and retry.

Booking inserts the event with `sendUpdates: 'all'`; reschedule patches it; cancellation and doctor leave delete it.

---

## Email setup

Any SMTP provider works. Gmail is the quickest for a demo because it delivers to arbitrary recipients without domain verification.

1. Enable **2-Step Verification** on the Google account — the App Passwords page doesn't exist without it.
2. [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) → create one → copy the 16 characters.
3. Set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER=<your address>`, `SMTP_PASS=<16 chars, no spaces>`, `EMAIL_FROM="CareSync Clinic" <your address>`.
4. `npm run check:email -- you@example.com`

`EMAIL_FROM` must use the same mailbox as `SMTP_USER`; Gmail rejects a From address it doesn't own. Mail from a personal Gmail without SPF/DKIM alignment often lands in spam on first send.

---

## Deployment

### Backend — Render

**New → Blueprint** → select this repo. [`render.yaml`](render.yaml) declares the service, build and start commands, health check path, and every environment variable; Render prompts for the secrets. `JWT_SECRET` is auto-generated.

Manual equivalent: Root Directory `server`, Build `npm ci --omit=dev`, Start `npm start`, Health Check `/api/health`.

> **Free-tier caveat.** Render sleeps the instance after 15 minutes of inactivity, which stops the reminder cron. Point [cron-job.org](https://cron-job.org) or UptimeRobot at `/api/health` every 10 minutes.

### Frontend — Vercel

Import the repo, **Root Directory `client`**, framework Vite, build `npm run build`, output `dist`.

Add `VITE_API_BASE_URL=https://<your-backend>.onrender.com` (no trailing slash) **before the first build** — Vite inlines it at compile time, so setting it afterwards does nothing until you redeploy without cache.

Finally, set the backend's `CLIENT_URL` to the Vercel URL. That's the CORS allow-list; skip it and every browser request is blocked.

[`client/vercel.json`](client/vercel.json) handles SPA routing and asset caching.

---

## Tests

```bash
cd server && npm test
```

49 tests run against an in-memory MongoDB, so index and TTL behaviour is real rather than mocked.

| Suite | Covers |
|---|---|
| `booking.test.js` | 10 concurrent holds on one slot → exactly 1 success, 9 `E11000`s; cancelled slots re-bookable; lapsed holds unconfirmable; double-submitted confirm succeeds once; another patient's hold unclaimable |
| `leave.test.js` | Leave cancels every booking on that date and only that date; both parties notified; past dates and cross-doctor attempts rejected; idempotent; withdrawal doesn't resurrect bookings |
| `reminders.test.js` | A 09:00 IST dose fires at 09:00 Kolkata, not 09:00 UTC; no dose fires twice; a 09:02 dose is caught by the 09:05 tick; reminders stop when the course ends; stale holds swept |
| `validation.test.js` | Malformed payloads rejected before controllers run; valid input trimmed, lowercased, coerced, defaulted |
| `slots.test.js` | Slot generation across durations and closed days; invented times rejected; past-slot detection in clinic-local time |

---

## Design notes

[`SYSTEM_DESIGN.md`](SYSTEM_DESIGN.md) covers the four required topics in 800 words: double-booking prevention, the slot-hold mechanism, doctor-leave conflict handling, and notification failure handling.

Three decisions worth calling out here:

**Concurrency lives in the database, not the application.** A check-then-write can't prevent double-booking — two requests both pass the check before either writes. A partial unique index makes MongoDB the arbiter; the loser surfaces as `E11000` and becomes a `409`. Confirmation folds status, ownership, and expiry into a single atomic `findOneAndUpdate` for the same reason.

**Timezone is resolved explicitly, never inferred from the server clock.** Slot times are clinic-local wall clock. Render runs UTC, so reading `Date` directly would fire Asia/Kolkata reminders 5.5 hours early. Everything routes through Luxon in `TIMEZONE`, and there's a test asserting it.

**Side effects never block the transaction.** LLM, calendar, and email failures are caught and logged, not propagated. A booking that is already committed must not fail because a third party is down.

---

## Project structure

```
server/
  config/db.js              Atlas-first connection, retry/backoff, explicit index sync
  models/                   User · DoctorProfile · DoctorLeave · Appointment · NotificationLog
  controllers/              auth · doctor · appointment
  routes/                   auth · doctor · appointment
  middleware/               authMiddleware · validateRequest · rateLimiter
  validators/schemas.js     Zod schema per endpoint
  services/                 llmService · emailService · googleCalendarService · reminderCron
  utils/slots.js            Timezone-aware slot maths
  scripts/                  check-db · check-email · check-calendar
  tests/                    node:test suites
  seed.js                   Admin + demo doctor bootstrap
client/
  src/api/client.js         Single axios instance, VITE_API_BASE_URL aware
  src/context/AuthContext   JWT storage, token revalidation, 401 auto-logout
  src/components/           SlotPicker · SymptomModal · PrescriptionForm · RescheduleModal
                            WorkingHoursEditor · DoctorCard · UrgencyBadge · Navbar
  src/pages/                Login · Register · SetPassword · Privacy · patient/ · doctor/ · admin/
```

---

## License

MIT
