const test = require('node:test');
const assert = require('node:assert/strict');
const validate = require('../middleware/validateRequest');
const schemas = require('../validators/schemas');

/**
 * Verification plan: malformed payloads must be rejected with a clear 4xx
 * before any controller runs, never written silently to the database.
 */

/** Minimal Express req/res doubles. */
const runMiddleware = (schema, request) => {
  const req = { body: {}, query: {}, params: {}, ...request };
  let statusCode = 200;
  let payload = null;
  let nextCalled = false;

  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      payload = data;
      return this;
    },
  };

  validate(schema)(req, res, () => {
    nextCalled = true;
  });

  return { statusCode, payload, nextCalled, req };
};

test('request validation middleware', async (t) => {
  await t.test('rejects registration with a short password', () => {
    const { statusCode, payload, nextCalled } = runMiddleware(schemas.registerSchema, {
      body: { name: 'Alice', email: 'alice@test.com', password: '123' },
    });

    assert.equal(nextCalled, false, 'the controller must not run');
    assert.equal(statusCode, 400);
    assert.match(payload.message, /password/i);
  });

  await t.test('rejects a malformed email', () => {
    const { statusCode, nextCalled } = runMiddleware(schemas.registerSchema, {
      body: { name: 'Alice', email: 'not-an-email', password: 'password123' },
    });
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 400);
  });

  await t.test('normalises a valid registration', () => {
    const { nextCalled, req } = runMiddleware(schemas.registerSchema, {
      body: { name: '  Alice  ', email: '  ALICE@TEST.COM ', password: 'password123' },
    });

    assert.equal(nextCalled, true);
    assert.equal(req.body.name, 'Alice', 'whitespace should be trimmed');
    assert.equal(req.body.email, 'alice@test.com', 'email should be lowercased');
    assert.equal(req.body.phone, '', 'optional fields get their default');
  });

  await t.test('rejects a non-ObjectId doctor id', () => {
    const { statusCode, nextCalled } = runMiddleware(schemas.holdSlotSchema, {
      body: { doctorId: 'not-an-id', date: '2026-09-01', startTime: '09:00', endTime: '09:30' },
    });
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 400);
  });

  await t.test('rejects a bad date format', () => {
    const { statusCode, nextCalled, payload } = runMiddleware(schemas.holdSlotSchema, {
      body: {
        doctorId: '507f1f77bcf86cd799439011',
        date: '01-09-2026',
        startTime: '09:00',
        endTime: '09:30',
      },
    });
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 400);
    assert.match(payload.message, /YYYY-MM-DD/);
  });

  await t.test('rejects a 25-hour clock time', () => {
    const { statusCode, nextCalled } = runMiddleware(schemas.holdSlotSchema, {
      body: {
        doctorId: '507f1f77bcf86cd799439011',
        date: '2026-09-01',
        startTime: '25:00',
        endTime: '09:30',
      },
    });
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 400);
  });

  await t.test('rejects a too-short symptom description', () => {
    const { statusCode, nextCalled } = runMiddleware(schemas.confirmBookingSchema, {
      body: { appointmentId: '507f1f77bcf86cd799439011', symptomsText: 'sick' },
    });
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 400);
  });

  await t.test('coerces numeric prescription fields sent as strings', () => {
    const { nextCalled, req } = runMiddleware(schemas.consultationSchema, {
      params: { id: '507f1f77bcf86cd799439011' },
      body: {
        clinicalNotes: 'Acute pharyngitis, antibiotics prescribed.',
        prescription: [
          {
            medicineName: 'Amoxicillin',
            dosage: '500mg',
            frequencyPerDay: '2',
            times: ['09:00', '21:00'],
            durationDays: '5',
          },
        ],
      },
    });

    assert.equal(nextCalled, true);
    assert.strictEqual(req.body.prescription[0].frequencyPerDay, 2, 'must arrive as a number, not "2"');
    assert.strictEqual(req.body.prescription[0].durationDays, 5);
    assert.strictEqual(req.body.prescription[0].instructions, '');
  });

  await t.test('rejects a working-hours range that ends before it starts', () => {
    const { statusCode, nextCalled } = runMiddleware(schemas.updateDoctorSchema, {
      params: { id: '507f1f77bcf86cd799439011' },
      body: {
        workingHours: [{ dayOfWeek: 'Monday', startTime: '17:00', endTime: '09:00', isAvailable: true }],
      },
    });
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 400);
  });

  await t.test('rejects an empty profile update', () => {
    const { statusCode, nextCalled } = runMiddleware(schemas.updateDoctorSchema, {
      params: { id: '507f1f77bcf86cd799439011' },
      body: {},
    });
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 400);
  });

  await t.test('accepts a well-formed leave request', () => {
    const { nextCalled, req } = runMiddleware(schemas.markLeaveSchema, {
      params: { id: '507f1f77bcf86cd799439011' },
      body: { date: '2026-09-01' },
    });
    assert.equal(nextCalled, true);
    assert.equal(req.body.reason, 'Scheduled Leave', 'default reason applied');
  });
});
