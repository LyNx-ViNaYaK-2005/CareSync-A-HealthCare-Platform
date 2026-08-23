const test = require('node:test');
const assert = require('node:assert/strict');

/**
 * Verification plan: LLM failures must never break a flow.
 * With no API key configured every call must still resolve to a valid,
 * schema-shaped object tagged FAILED_FALLBACK.
 */

test('LLM graceful degradation', async (t) => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalLlmKey = process.env.LLM_API_KEY;

  t.before(() => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.LLM_API_KEY;
  });

  t.after(() => {
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
    if (originalLlmKey) process.env.LLM_API_KEY = originalLlmKey;
  });

  const { generatePreVisitSummary, generatePostVisitSummary, extractJson } = require('../services/llmService');

  await t.test('pre-visit summary falls back without an API key', async () => {
    const { summary } = await generatePreVisitSummary('Severe headache and fever for three days');

    assert.equal(summary.llmStatus, 'FAILED_FALLBACK');
    assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(summary.urgencyLevel));
    assert.ok(summary.chiefComplaint.length > 0, 'the raw symptoms must still reach the doctor');
    assert.equal(summary.suggestedQuestions.length, 3);
  });

  await t.test('a placeholder API key is treated as absent', async () => {
    process.env.GEMINI_API_KEY = 'your_gemini_api_key_here';
    const { summary } = await generatePreVisitSummary('Persistent cough');
    assert.equal(summary.llmStatus, 'FAILED_FALLBACK', 'an unreplaced placeholder must not be sent to the API');
    delete process.env.GEMINI_API_KEY;
  });

  await t.test('post-visit fallback preserves the prescription', async () => {
    const prescription = [
      { medicineName: 'Amoxicillin', dosage: '500mg', frequencyPerDay: 2, times: ['09:00', '21:00'], durationDays: 5, instructions: 'After meals' },
    ];

    const { summary } = await generatePostVisitSummary('Acute pharyngitis, prescribed antibiotics.', prescription);

    assert.equal(summary.llmStatus, 'FAILED_FALLBACK');
    assert.ok(summary.patientFriendlySummary.includes('Amoxicillin'), 'the patient must still see their medication');
    assert.equal(summary.medicationSchedule.length, 1);
    assert.equal(summary.medicationSchedule[0].medicineName, 'Amoxicillin');
    assert.ok(summary.followUpSteps.length > 0);
  });

  await t.test('post-visit fallback handles an empty prescription', async () => {
    const { summary } = await generatePostVisitSummary('Routine checkup, no issues found.', []);
    assert.equal(summary.medicationSchedule.length, 0);
    assert.ok(summary.patientFriendlySummary.length > 0);
  });

  await t.test('JSON extraction survives fences and surrounding prose', () => {
    assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
    assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(extractJson('Here is the result: {"a":1} Hope that helps!'), { a: 1 });
    assert.throws(() => extractJson('no json at all'), /No JSON object found/);
  });

  await t.test('the schema rejects a malformed model response', () => {
    const { preVisitSchema } = require('../services/llmService');

    // Wrong enum casing, and only one question instead of three.
    assert.throws(() =>
      preVisitSchema.parse({ urgencyLevel: 'critical', chiefComplaint: 'x', suggestedQuestions: [] })
    );

    const valid = preVisitSchema.parse({
      urgencyLevel: 'HIGH',
      chiefComplaint: 'Chest pain',
      suggestedQuestions: ['Q1', 'Q2', 'Q3'],
    });
    assert.equal(valid.urgencyLevel, 'HIGH');
  });
});
