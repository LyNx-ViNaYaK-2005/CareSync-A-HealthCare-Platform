const { GoogleGenerativeAI } = require('@google/generative-ai');
const { z } = require('zod');

/**
 * LLM integration for pre-visit triage and post-visit patient summaries.
 *
 * Every path through this module resolves to a usable object. A missing API
 * key, a timeout, malformed JSON, or a schema violation all degrade to a
 * deterministic fallback tagged `llmStatus: 'FAILED_FALLBACK'` so booking and
 * consultation flows never break on a third-party outage.
 */

// Model is env-configurable because Google retires Gemini versions on a short
// cycle - `gemini-1.5-flash` and `gemini-2.5-flash` are already unavailable to
// new API keys. If a call starts 404ing, change GEMINI_MODEL rather than code.
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 20000;

// ---------------------------------------------------------------- schemas

const preVisitSchema = z.object({
  urgencyLevel: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  chiefComplaint: z.string().min(1),
  suggestedQuestions: z.array(z.string().min(1)).min(1).max(5),
});

const medicationItemSchema = z.object({
  medicineName: z.string().min(1),
  dosage: z.string().default(''),
  frequencyPerDay: z.coerce.number().int().min(1).max(12).default(1),
  times: z.array(z.string()).default([]),
  durationDays: z.coerce.number().int().min(1).max(365).default(5),
  instructions: z.string().optional().default(''),
});

const postVisitSchema = z.object({
  patientFriendlySummary: z.string().min(1),
  medicationSchedule: z.array(medicationItemSchema).optional().default([]),
  followUpSteps: z.array(z.string()).optional().default([]),
});

// ---------------------------------------------------------------- helpers

const hasApiKey = () => {
  const key = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
  return Boolean(key) && !key.startsWith('your_') && key !== 'your_gemini_api_key_here';
};

const getApiKey = () => process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;

const withTimeout = (promise, ms = TIMEOUT_MS) => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`LLM request timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
};

/**
 * Pull a JSON object out of a model response.
 * Handles bare JSON, ```json fenced blocks, and JSON wrapped in prose.
 */
const extractJson = (text) => {
  const cleaned = text
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const first = cleaned.indexOf('{');
    const last = cleaned.lastIndexOf('}');
    if (first !== -1 && last > first) {
      return JSON.parse(cleaned.slice(first, last + 1));
    }
    throw new Error('No JSON object found in LLM response');
  }
};

const callModel = async (prompt) => {
  const genAI = new GoogleGenerativeAI(getApiKey());
  const model = genAI.getGenerativeModel({
    model: MODEL_NAME,
    generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
  });
  const result = await model.generateContent(prompt);
  return extractJson(result.response.text().trim());
};

/** One attempt, then exactly one retry, each under its own timeout. */
const callWithRetry = async (prompt, parse, label) => {
  try {
    return parse(await withTimeout(callModel(prompt)));
  } catch (firstErr) {
    console.warn(`[LLM] ${label} attempt 1 failed (${firstErr.message}). Retrying once...`);
    return parse(await withTimeout(callModel(prompt)));
  }
};

// ------------------------------------------------------------- pre-visit

const preVisitFallback = (symptomsText) => ({
  urgencyLevel: 'MEDIUM',
  chiefComplaint: (symptomsText || '').slice(0, 150) || 'Patient reported symptoms',
  suggestedQuestions: [
    'When did these symptoms first begin?',
    'What makes the symptoms better or worse?',
    'Are you currently taking any medication or have any relevant medical history?',
  ],
  llmStatus: 'FAILED_FALLBACK',
});

/**
 * Pre-visit symptom triage.
 * Assignment prompt: "Analyse these symptoms and return: urgency level
 * (Low / Medium / High), chief complaint, and three suggested questions for
 * the doctor. Symptoms: <symptoms>"
 */
const generatePreVisitSummary = async (symptomsText) => {
  if (!hasApiKey()) {
    console.warn('[LLM] No GEMINI_API_KEY configured. Using deterministic pre-visit fallback.');
    return { summary: preVisitFallback(symptomsText) };
  }

  const prompt = `You are a medical triage assistant supporting a clinic's doctors.
Analyse these patient symptoms and return: urgency level (Low / Medium / High), chief complaint, and three suggested questions for the doctor.

Return ONLY a valid JSON object matching this schema - no markdown, no backticks, no commentary:
{
  "urgencyLevel": "LOW" | "MEDIUM" | "HIGH",
  "chiefComplaint": "Short 1-2 sentence summary of the primary issue",
  "suggestedQuestions": ["Question 1", "Question 2", "Question 3"]
}

Rules:
- urgencyLevel must be exactly "LOW", "MEDIUM", or "HIGH" (uppercase).
- Use HIGH for red-flag presentations (chest pain, breathing difficulty, severe bleeding, stroke signs, suicidal ideation).
- chiefComplaint must be a concise clinical summary, not a diagnosis.
- suggestedQuestions must contain exactly 3 clinically useful questions for the doctor to ask.
- Never state a diagnosis or recommend a treatment.

Symptoms: "${String(symptomsText).replace(/"/g, "'")}"`;

  try {
    const validated = await callWithRetry(
      prompt,
      (parsed) => {
        if (typeof parsed.urgencyLevel === 'string') {
          parsed.urgencyLevel = parsed.urgencyLevel.toUpperCase();
        }
        return preVisitSchema.parse(parsed);
      },
      'pre-visit'
    );

    return {
      summary: {
        urgencyLevel: validated.urgencyLevel,
        chiefComplaint: validated.chiefComplaint,
        suggestedQuestions: validated.suggestedQuestions,
        llmStatus: 'SUCCESS',
      },
    };
  } catch (error) {
    console.error(`[LLM] Pre-visit summary failed after retry: ${error.message}. Falling back.`);
    return { summary: preVisitFallback(symptomsText) };
  }
};

// ------------------------------------------------------------ post-visit

const postVisitFallback = (clinicalNotes, prescriptionItems) => ({
  patientFriendlySummary:
    `Summary of your visit:\n\n${clinicalNotes}\n\n` +
    (prescriptionItems.length
      ? `Please take your prescribed medication as directed:\n${prescriptionItems
          .map((p) => `- ${p.medicineName} ${p.dosage} for ${p.durationDays} days (${p.instructions || 'as directed'})`)
          .join('\n')}\n\n`
      : '') +
    'Contact the clinic if your symptoms worsen or do not improve.',
  medicationSchedule: prescriptionItems.map((p) => ({
    medicineName: p.medicineName,
    dosage: p.dosage,
    frequencyPerDay: p.frequencyPerDay,
    times: p.times || [],
    durationDays: p.durationDays,
    instructions: p.instructions || '',
  })),
  followUpSteps: ['Complete the full course of any prescribed medication.', 'Contact the clinic if symptoms worsen.'],
  llmStatus: 'FAILED_FALLBACK',
});

/**
 * Post-visit patient-friendly summary.
 * Assignment prompt: "Convert these clinical notes into a patient-friendly
 * summary with medication schedule and follow-up steps: <notes>"
 */
const generatePostVisitSummary = async (clinicalNotes, prescriptionItems = []) => {
  const items = Array.isArray(prescriptionItems) ? prescriptionItems : [];

  if (!hasApiKey()) {
    console.warn('[LLM] No GEMINI_API_KEY configured. Using deterministic post-visit fallback.');
    return { summary: postVisitFallback(clinicalNotes, items) };
  }

  const prescriptionContext = items.length > 0 ? JSON.stringify(items) : 'None prescribed';
  const timezone = process.env.TIMEZONE || 'Asia/Kolkata';

  const prompt = `You are a patient communication specialist at a clinic.
Convert these clinical notes into a patient-friendly summary with medication schedule and follow-up steps.

Return ONLY a valid JSON object matching this schema - no markdown, no backticks, no commentary:
{
  "patientFriendlySummary": "Warm, clear 2-3 paragraph explanation of what was found and what to do next, in plain language and no jargon.",
  "medicationSchedule": [
    {
      "medicineName": "string",
      "dosage": "string, e.g. 500mg",
      "frequencyPerDay": 2,
      "times": ["09:00", "21:00"],
      "durationDays": 5,
      "instructions": "e.g. after meals"
    }
  ],
  "followUpSteps": ["Step 1", "Step 2"]
}

Rules:
- medicationSchedule must mirror the prescription details supplied below. Do not invent, add, remove, or alter any medicine or dosage.
- times must be 24-hour "HH:mm" strings in the ${timezone} timezone, and must contain exactly frequencyPerDay entries spread sensibly across waking hours.
- If no prescription was supplied, return an empty medicationSchedule array.
- followUpSteps: 2-4 short, concrete actions for the patient.
- Write to the patient in second person. Be encouraging but accurate. Never contradict the clinical notes.

Clinical Notes: "${String(clinicalNotes).replace(/"/g, "'")}"
Prescription Details: ${prescriptionContext}`;

  try {
    const validated = await callWithRetry(prompt, (parsed) => postVisitSchema.parse(parsed), 'post-visit');

    return {
      summary: {
        patientFriendlySummary: validated.patientFriendlySummary,
        medicationSchedule: validated.medicationSchedule,
        followUpSteps: validated.followUpSteps,
        llmStatus: 'SUCCESS',
      },
    };
  } catch (error) {
    console.error(`[LLM] Post-visit summary failed after retry: ${error.message}. Falling back.`);
    return { summary: postVisitFallback(clinicalNotes, items) };
  }
};

module.exports = {
  generatePreVisitSummary,
  generatePostVisitSummary,
  // exported for tests
  preVisitSchema,
  postVisitSchema,
  extractJson,
};
