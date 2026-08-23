const { google } = require('googleapis');

/**
 * Google Calendar integration, single clinic-account model.
 *
 * One clinic-owned Google account holds the OAuth refresh token. Events are
 * created on that account's calendar with the patient and doctor added as
 * attendees (`sendUpdates: 'all'`), so both receive a native invite without
 * ever going through an OAuth consent screen themselves.
 *
 * With credentials absent every call returns a simulated result tagged with a
 * `mock_gcal_` id, so booking, rescheduling and cancellation all work
 * end-to-end without a Google project.
 */

const CALENDAR_ID = () => process.env.GOOGLE_CALENDAR_ID || 'primary';
const timeZone = () => process.env.TIMEZONE || 'Asia/Kolkata';

const isSimulatedId = (eventId) => !eventId || String(eventId).startsWith('mock_gcal_');

let cachedClient;
let clientResolved = false;

const getOAuth2Client = () => {
  if (clientResolved) return cachedClient;
  clientResolved = true;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'https://developers.google.com/oauthplayground';

  const configured =
    clientId && clientSecret && refreshToken && !clientId.startsWith('your_') && !refreshToken.startsWith('your_');

  if (!configured) {
    console.log('[Calendar] Google OAuth credentials not configured - calendar events will be simulated.');
    cachedClient = null;
    return null;
  }

  const client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  client.setCredentials({ refresh_token: refreshToken });
  cachedClient = client;
  return client;
};

const simulate = (label) => {
  const id = `mock_gcal_${label}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return { eventId: id, htmlLink: '', simulated: true };
};

/** Create the event and invite both parties as attendees. */
const createCalendarEvent = async ({
  summary,
  description,
  date,
  startTime,
  endTime,
  patientEmail,
  doctorEmail,
}) => {
  const auth = getOAuth2Client();
  if (!auth) return simulate('evt');

  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const tz = timeZone();

    const response = await calendar.events.insert({
      calendarId: CALENDAR_ID(),
      sendUpdates: 'all',
      requestBody: {
        summary: summary || 'Doctor Appointment',
        description: description || 'Appointment scheduled via CareSync',
        // Wall-clock string plus an explicit zone: Google resolves the offset,
        // so the event lands at the right local time regardless of DST or
        // whatever timezone this server happens to run in.
        start: { dateTime: `${date}T${startTime}:00`, timeZone: tz },
        end: { dateTime: `${date}T${endTime}:00`, timeZone: tz },
        attendees: [
          ...(patientEmail ? [{ email: patientEmail, responseStatus: 'needsAction' }] : []),
          ...(doctorEmail ? [{ email: doctorEmail, responseStatus: 'accepted' }] : []),
        ],
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'email', minutes: 24 * 60 },
            { method: 'popup', minutes: 30 },
          ],
        },
      },
    });

    return { eventId: response.data.id, htmlLink: response.data.htmlLink };
  } catch (error) {
    // A calendar outage must never fail a booking that is already committed.
    console.error(`[Calendar] Create failed: ${error.message}`);
    return { ...simulate('err'), error: error.message };
  }
};

/** Move an existing event (reschedule). */
const updateCalendarEvent = async ({ eventId, date, startTime, endTime, summary }) => {
  if (isSimulatedId(eventId)) return { success: true, simulated: true };

  const auth = getOAuth2Client();
  if (!auth) return { success: true, simulated: true };

  try {
    const calendar = google.calendar({ version: 'v3', auth });
    const tz = timeZone();

    await calendar.events.patch({
      calendarId: CALENDAR_ID(),
      eventId,
      sendUpdates: 'all',
      requestBody: {
        ...(summary ? { summary } : {}),
        start: { dateTime: `${date}T${startTime}:00`, timeZone: tz },
        end: { dateTime: `${date}T${endTime}:00`, timeZone: tz },
      },
    });

    return { success: true };
  } catch (error) {
    console.error(`[Calendar] Update failed: ${error.message}`);
    return { success: false, error: error.message };
  }
};

/** Remove an event (cancellation / doctor leave), notifying attendees. */
const deleteCalendarEvent = async (eventId) => {
  if (isSimulatedId(eventId)) return { success: true, simulated: true };

  const auth = getOAuth2Client();
  if (!auth) return { success: true, simulated: true };

  try {
    const calendar = google.calendar({ version: 'v3', auth });
    await calendar.events.delete({
      calendarId: CALENDAR_ID(),
      eventId,
      sendUpdates: 'all',
    });
    return { success: true };
  } catch (error) {
    // 404/410 means it is already gone - that is the desired end state.
    const code = error.code || error.response?.status;
    if (code === 404 || code === 410) {
      return { success: true, alreadyRemoved: true };
    }
    console.error(`[Calendar] Delete failed: ${error.message}`);
    return { success: false, error: error.message };
  }
};

module.exports = {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  isSimulatedId,
};
