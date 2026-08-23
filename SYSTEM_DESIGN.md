# System Design — Healthcare Appointment & Follow-up Manager

## 1. Double-booking prevention

Application-level "check then write" cannot prevent double-booking: two requests can both pass the check before either writes. The guarantee therefore lives in the database.

A **partial unique compound index** on the `Appointment` collection allows at most one active row per doctor, date, and start time:

```js
appointmentSchema.index(
  { doctor: 1, date: 1, startTime: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['HELD', 'CONFIRMED'] } } }
);
```

The partial filter is what makes this workable in practice. Cancelled and expired rows fall outside it, so the uniqueness constraint stops applying to them and a freed slot becomes immediately re-bookable without deleting history.

When simultaneous requests reach `POST /hold`, MongoDB's document-level locking lets exactly one insert succeed; the rest fail with duplicate-key error `E11000`, which the controller translates into `409 Conflict`. The controller's pre-check exists only to produce a friendlier message — correctness never depends on it. A test fires ten concurrent holds at one slot and asserts exactly one success and nine `E11000`s.

Two related gaps close alongside it: slot times are validated against the doctor's generated schedule, so a client cannot POST an invented `03:00`, and `syncIndexes()` runs at startup, since a collection created before the index existed would otherwise keep accepting duplicates silently.

## 2. Slot hold mechanism and expiry

A patient needs time to describe symptoms without the slot being taken. Selecting a slot writes a `HELD` row with `holdExpiresAt = now + 5 minutes`, covered by a native TTL index:

```js
appointmentSchema.index({ holdExpiresAt: 1 }, { expireAfterSeconds: 0 });
```

MongoDB's TTL thread runs only once a minute, so a lapsed hold can survive briefly in the collection. Rather than re-reading and then writing — itself a race — confirmation folds every condition into one atomic update:

```js
Appointment.findOneAndUpdate(
  { _id, patient: patientId, status: 'HELD', holdExpiresAt: { $gt: new Date() } },
  { $set: { status: 'CONFIRMED', symptomsText }, $unset: { holdExpiresAt: '' } },
  { new: true }
);
```

A null result means the hold lapsed, was already confirmed, or belongs to someone else; the controller distinguishes these and returns `410 SLOT_EXPIRED`, `409`, or `403`. Because ownership and expiry sit in the filter, a double-submitted form succeeds only once. `$unset` on `holdExpiresAt` is essential — leaving it set would let the TTL thread delete a confirmed booking.

A sweeper moves genuinely stale holds to `EXPIRED` every two minutes so dashboards never show phantom rows.

## 3. Doctor leave conflict handling

Marking leave runs a cascade: upsert the `DoctorLeave` record (a unique index on `{ doctor, date }` makes repeat submissions idempotent), find every `HELD` or `CONFIRMED` appointment on that date, transition each to `CANCELLED_BY_DOCTOR` with a reason naming the leave, delete its Google Calendar event, and email **both** the patient and the doctor.

Each appointment is handled independently and notification results are counted rather than thrown. One dead mailbox must not abort the cascade and strand the remaining patients with bookings for a doctor who will not be there. The response reports how many were cancelled and how many emails were queued for retry.

Leave can also be withdrawn, which reopens the date for new bookings. Already-cancelled appointments are deliberately *not* resurrected: those patients were told to rebook, and silently reinstating an appointment they believe is gone is worse than leaving the slot free.

## 4. Notification failure handling

Every outbound email is written to a `NotificationLog` outbox before dispatch, recording type, recipient, role, rendered body, status, attempt count, and last error. Failures leave the row `FAILED` instead of propagating — a booking must never fail because SMTP is down.

A `node-cron` worker retries `FAILED` rows every fifteen minutes with **exponential backoff**: attempt *n* waits 2ⁿ minutes since the last try, so a flapping provider is not hammered every tick. After three attempts the row is flagged `requiresAdminReview` and surfaced as a failed-email count in the admin console, rather than disappearing.

Medication reminders run on the same worker and are the part most exposed to environment differences. Prescription times are clinic-local wall clock ("09:00" means 9am in `TIMEZONE`), but cloud hosts run UTC — reading the server clock would fire Indian reminders 5.5 hours early. Every comparison resolves through Luxon in the clinic zone. Doses are matched across a catch-up **window** rather than an exact string, so a dose at 09:02 is still delivered by the 09:05 tick, and a per-dose key `medicine|date|time` is claimed atomically before sending, giving at-most-once delivery even if two ticks overlap. Reminders stop automatically once `durationDays` from `prescribedAt` has elapsed.

On Render's free tier the instance sleeps after fifteen minutes of inactivity, which would silently stop every worker above. An external pinger hits `/api/health` — which reports real database state, not just process liveness — every ten minutes to keep it warm.
