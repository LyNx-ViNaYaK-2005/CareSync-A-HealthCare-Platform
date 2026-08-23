# CareSync — Healthcare Appointment & Follow-up Manager

A full-stack clinic platform with separate **Patient**, **Doctor**, and **Admin** portals. It prevents double-booking under concurrent load, holds slots while patients fill in symptoms, runs AI pre-visit triage and post-visit patient summaries, manages doctor leave with cascading cancellations, syncs Google Calendar, and sends email reminders from a background worker.

**Stack:** React 18 + Vite + Tailwind · Node + Express · MongoDB Atlas · Google Gemini · Nodemailer · Google Calendar API

---

## Quick start

### Prerequisites
- Node.js 18+
- A free [MongoDB Atlas](https://cloud.mongodb.com) cluster

### 1. MongoDB Atlas (the one required step)

1. Create a free **M0** cluster at [cloud.mongodb.com](https://cloud.mongodb.com).
2. **Database Access** → *Add New Database User* → note the username and password.
3. **Network Access** → *Add IP Address* → **Allow access from anywhere** (`0.0.0.0/0`).
   Render's egress IPs rotate, so a narrower allow-list will break the deployed backend.
4. **Database** → *Connect* → *Drivers* → copy the connection string.
5. Paste it into `server/.env` as `MONGODB_URI`, replacing `<password>` and keeping `/caresync_db` before the `?`:

```
MONGODB_URI=mongodb+srv://myuser:mypassword@cluster0.ab1cd.mongodb.net/caresync_db?retryWrites=true&w=majority
```

### 2. Backend

```bash
cd server && npm install && npm run dev
```

On first boot the server connects to Atlas, builds its indexes, and seeds an admin account plus five demo doctors. Watch for:

```
[DB] MongoDB Atlas connected: cluster0-shard-00-01.ab1cd.mongodb.net/caresync_db
[DB] Indexes synced. Double-booking guard: ACTIVE | Slot-hold TTL: ACTIVE
[Seed] Admin account created: admin@caresync.com
[Seed] Doctor roster ready: 5 profile(s)
[Startup] CareSync API listening on port 5000
```

### 3. Frontend

```bash
cd client && npm install && npm run dev
```

Open <http://localhost:5173>.

### Default credentials

| Role | Email | Password |
|---|---|---|
| Admin | `admin@caresync.com` | `Admin@CareSync2026` |
| Doctor | `dr.house@caresync.com` | `DoctorPassword123!` |
| Patient | *register your own* | — |

Both come from `server/.env` (`ADMIN_EMAIL` / `ADMIN_PASSWORD`, `SEED_DOCTOR_PASSWORD`). **Change them before deploying.**

> **Why the admin is seeded:** no API route can create an `ADMIN`. Self-registration is hardcoded to `PATIENT`, and doctors are created *by* an admin. Without `ADMIN_EMAIL` / `ADMIN_PASSWORD` set, the admin console is unreachable on a fresh database.

### Running without external services

Only `MONGODB_URI` is required. Each integration degrades on its own:

| Missing | Behaviour |
|---|---|
| `GEMINI_API_KEY` | Summaries fall back to deterministic text, tagged `FAILED_FALLBACK`. Booking still completes. |
| `SMTP_*` | Emails are logged to the console and recorded as `SENT (simulated)`. |
| `GOOGLE_*` | Calendar events are simulated with a `mock_gcal_` id. Reschedule and cancel still work. |

---

## Environment variables

Full reference with comments: [`.env.example`](.env.example). Copy it to `server/.env`.

| Variable | Required | Notes |
|---|:---:|---|
| `MONGODB_URI` | **yes** | Atlas SRV string |
| `JWT_SECRET` | **yes** | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | **yes** | Seeds the only admin account |
| `CLIENT_URL` | yes in prod | CORS allow-list; comma-separate for preview deploys |
| `TIMEZONE` | | IANA zone, default `Asia/Kolkata`. Drives all slot and reminder maths |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | | Free key at [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| `SMTP_HOST` / `PORT` / `USER` / `PASS` / `EMAIL_FROM` | | Resend, Mailgun, SendGrid, or a Gmail app password |
| `GOOGLE_CLIENT_ID` / `SECRET` / `REFRESH_TOKEN` | | Single clinic account — see below |
| `SLOT_HOLD_MINUTES` | | Hold window, default `5` |
| `REMINDER_TICK_MINUTES` / `REMINDER_WINDOW_MINUTES` | | Cron cadence and catch-up window |
| `ALLOW_LOCAL_DB_FALLBACK` / `ALLOW_INMEMORY_DB` | | Opt-in offline dev only. Keep `false` when deployed |

Frontend (`client/.env`): `VITE_API_BASE_URL` — leave blank locally (Vite proxies `/api`), set to the Render URL in production. Vite inlines it **at build time**, so changing it requires a rebuild.

---

## Database schema

### `User`
`name`, `email` (unique, lowercase), `password` (bcrypt, `select: false`), `role` (`PATIENT` | `DOCTOR` | `ADMIN`), `phone`, `mustResetPassword`

### `DoctorProfile`
`user` (unique ref), `specialization`, `slotDurationMins` (15–120), `roomNumber`, `bio`, `isActive`, `workingHours[]` — `{ dayOfWeek, startTime, endTime, isAvailable }`

### `DoctorLeave`
`doctor`, `date` (`YYYY-MM-DD`), `reason`, `status` (`ACTIVE` | `CANCELLED`)
Unique compound index on `{ doctor, date }`.

### `Appointment`
`patient`, `doctor`, `date`, `startTime`, `endTime`, `status`, `holdExpiresAt`, `symptomsText`, `preVisitSummary`, `postVisitNotes`, `prescription[]`, `prescribedAt`, `postVisitSummary`, `googleEventId`, `googleEventLink`, `cancellationReason`, `rescheduleHistory[]`, `remindersSent[]`

Two indexes carry the core guarantees:

```js
// At most one active booking per doctor/date/time. Cancelled rows fall
// outside the filter, so a freed slot is immediately re-bookable.
{ doctor: 1, date: 1, startTime: 1 }
  → unique, partialFilterExpression: { status: { $in: ['HELD','CONFIRMED'] } }

// Mongo purges unconfirmed holds automatically.
{ holdExpiresAt: 1 } → expireAfterSeconds: 0
```

### `NotificationLog`
`type`, `recipientEmail`, `recipientRole`, `subject`, `body`, `status` (`PENDING` | `SENT` | `FAILED`), `attempts`, `lastError`, `requiresAdminReview`, `appointmentId`

---

## API reference

All protected routes take `Authorization: Bearer <token>`. Every mutating route is Zod-validated and returns `400` with per-field errors on a malformed payload.

### Auth — `/api/auth`
| Method | Path | Access | Description |
|---|---|---|---|
| POST | `/register` | Public | Register a patient (role is forced to `PATIENT`) |
| POST | `/login` | Public | Returns JWT. `401` on bad credentials |
| GET | `/me` | Private | Current profile |
| POST | `/set-password` | Private | First-login password set for invited doctors |

### Doctors — `/api/doctors`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/` | Public | Roster. `?specialization=` `?search=` `?includeInactive=` |
| GET | `/:id` | Public | Profile with upcoming leave days |
| POST | `/` | Admin | Create doctor + send invite email |
| PUT | `/:id` | Admin / self | Working hours, slot duration, room, specialization, active flag |
| GET | `/:id/leave` | Private | Scheduled leave days |
| POST | `/:id/leave` | Admin / self | Mark leave → cascading cancellation + notifications |
| DELETE | `/:id/leave` | Admin / self | Withdraw a leave day |

### Appointments — `/api/appointments`
| Method | Path | Access | Description |
|---|---|---|---|
| GET | `/available-slots` | Public | `?doctorId=&date=`. Excludes booked, held, and past slots |
| GET | `/stats` | Admin | Clinic-wide counts for the console |
| POST | `/hold` | Patient | Reserve a slot for 5 minutes. `409` if taken |
| POST | `/confirm` | Patient | Submit symptoms → AI summary + calendar + emails. `410` if the hold lapsed |
| GET | `/` | Private | Scoped by role. `?status=` `?date=` |
| GET | `/:id` | Private | Single appointment (own, or admin) |
| POST | `/:id/consultation` | Doctor | Notes + prescription → AI patient summary |
| PUT | `/:id/cancel` | Involved / admin | Cancel → remove calendar event, email both sides |
| PUT | `/:id/reschedule` | Involved / admin | Move slot → patch calendar, email both sides |

### Health — `GET /api/health`
Returns `200 UP` / `503 DEGRADED` with database state. Point your uptime pinger here.

---

## LLM prompts & failure handling

Both prompts request strict JSON (`responseMimeType: application/json`), are Zod-validated on return, and run under a 10-second timeout with exactly one retry.

### Pre-visit triage
> You are a medical triage assistant supporting a clinic's doctors. Analyse these patient symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor. … Use HIGH for red-flag presentations (chest pain, breathing difficulty, severe bleeding, stroke signs, suicidal ideation). … Never state a diagnosis or recommend a treatment.
> `Symptoms: "<symptomsText>"`

```json
{ "urgencyLevel": "LOW|MEDIUM|HIGH", "chiefComplaint": "…", "suggestedQuestions": ["…","…","…"] }
```

### Post-visit summary
> You are a patient communication specialist at a clinic. Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps. … medicationSchedule must mirror the prescription details supplied below. Do not invent, add, remove, or alter any medicine or dosage. … times must be 24-hour "HH:mm" strings in the `<TIMEZONE>` timezone.
> `Clinical Notes: "<notes>"` · `Prescription Details: <json>`

```json
{ "patientFriendlySummary": "…", "medicationSchedule": [ … ], "followUpSteps": ["…"] }
```

**Failure handling.** Missing key, timeout, malformed JSON, or schema violation all resolve to a deterministic fallback tagged `llmStatus: "FAILED_FALLBACK"`, surfaced in both dashboards. The booking or consultation always completes.

**Safety boundary.** The doctor's `prescription` array is the only thing that drives medication reminders. The LLM's `medicationSchedule` is stored for display and cross-checking — an LLM is never the source of truth for what a patient takes.

---

## Google Calendar setup

One **clinic-owned** Google account holds the refresh token. Patients and doctors are added as *attendees* and receive native invites without any OAuth consent of their own.

1. [Google Cloud Console](https://console.cloud.google.com/) → create a project.
2. Enable the **Google Calendar API**.
3. **Credentials** → *Create OAuth client ID* → **Web application**.
4. Add `https://developers.google.com/oauthplayground` as an authorised redirect URI.
5. Open the [OAuth Playground](https://developers.google.com/oauthplayground) → gear icon → *Use your own OAuth credentials* → paste your client ID and secret.
6. Authorise the scope `https://www.googleapis.com/auth/calendar`, then exchange the code for a **refresh token**.
7. Put `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REFRESH_TOKEN` in your environment.

Booking creates the event with `sendUpdates: 'all'`; reschedule patches it; cancellation and doctor leave delete it.

---

## Deployment

### Backend — Render
1. Push to GitHub, then **New → Blueprint** and point Render at [`render.yaml`](render.yaml).
2. Fill in the prompted secrets (`MONGODB_URI`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `CLIENT_URL`, and any optional integrations). `JWT_SECRET` is generated for you.
3. Health check path is already `/api/health`.

Or configure manually: Root Directory `server`, Build `npm ci --omit=dev`, Start `npm start`.

> **Free-tier caveat:** Render sleeps the instance after 15 minutes of inactivity, which stops the reminder cron. Point [cron-job.org](https://cron-job.org) or UptimeRobot at `https://<your-backend>.onrender.com/api/health` every 10 minutes.

### Frontend — Vercel
1. Import the repo, set **Root Directory** to `client`.
2. Add environment variable `VITE_API_BASE_URL=https://<your-backend>.onrender.com` (no trailing slash) **before** the first build.
3. Build `npm run build`, output `dist`. [`client/vercel.json`](client/vercel.json) handles SPA routing and asset caching.
4. Add the resulting Vercel URL to the backend's `CLIENT_URL`, or the browser will block responses with a CORS error.

---

## Tests

```bash
cd server && npm test
```

49 tests covering the verification plan, run against an in-memory MongoDB so index and TTL behaviour is real rather than mocked:

- **`booking.test.js`** — 10 concurrent holds on one slot yield exactly 1 success and 9 `E11000`s; cancelled slots become re-bookable; lapsed holds cannot be confirmed; a double-submitted confirm succeeds once; another patient's hold is unclaimable.
- **`leave.test.js`** — leave cancels every booking on the date and only that date, notifies both parties, rejects past dates and cross-doctor attempts, is idempotent, and does not resurrect bookings on withdrawal.
- **`reminders.test.js`** — a 09:00 IST dose fires at 09:00 Kolkata (not 09:00 UTC); the same dose never fires twice; a 09:02 dose is caught by the 09:05 tick; reminders stop when the course ends; stale holds are swept.
- **`validation.test.js`** — malformed payloads are rejected before controllers run; valid input is trimmed, lowercased, coerced, and defaulted.
- **`slots.test.js`** — slot generation across durations and closed days; invented times rejected; past-slot detection in clinic-local time.

---

## Project structure

```
server/
  config/db.js              Atlas-first connection, retry, explicit index sync
  models/                   User · DoctorProfile · DoctorLeave · Appointment · NotificationLog
  controllers/              auth · doctor · appointment
  routes/                   auth · doctor · appointment
  middleware/               authMiddleware · validateRequest · rateLimiter
  validators/schemas.js     Zod schema per endpoint
  services/                 llmService · emailService · googleCalendarService · reminderCron
  utils/slots.js            Timezone-aware slot maths
  tests/                    node:test suites
  seed.js                   Admin + demo doctor bootstrap
client/
  src/api/client.js         Single axios instance, VITE_API_BASE_URL aware
  src/context/AuthContext   JWT storage, token revalidation, 401 auto-logout
  src/components/           SlotPicker · SymptomModal · PrescriptionForm · RescheduleModal · WorkingHoursEditor · DoctorCard · UrgencyBadge · Navbar
  src/pages/                Login · Register · SetPassword · patient/ · doctor/ · admin/
```

---

## License

MIT.
