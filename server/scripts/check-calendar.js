/**
 * Google Calendar OAuth checker.
 *
 * Run with:  npm run check:calendar
 *            npm run check:calendar -- --create   (creates then deletes a real event)
 *
 * Verifies the clinic account's refresh token still exchanges for an access
 * token and that the Calendar API is reachable. Diagnoses the failures that
 * account for most setup problems: an unenabled API, a revoked or expired
 * refresh token, and consent-screen scope mismatches.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { google } = require('googleapis');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const ok = (m) => console.log(`${GREEN}  OK${RESET}    ${m}`);
const bad = (m) => console.log(`${RED}  FAIL${RESET}  ${m}`);
const warn = (m) => console.log(`${YELLOW}  WARN${RESET}  ${m}`);
const hint = (m) => console.log(`${DIM}        ${m}${RESET}`);

const diagnose = (err) => {
  const msg = (err.message || '') + JSON.stringify(err.response?.data || {});

  if (/invalid_grant/i.test(msg)) {
    hint('The refresh token is no longer valid. Usual causes:');
    hint('  - The OAuth consent screen is in "Testing" mode, where refresh tokens');
    hint('    expire after 7 days. Set publishing status to "In production".');
    hint('  - Access was revoked at myaccount.google.com/permissions');
    hint('  - The token was issued by a different client id/secret pair');
    hint('Generate a fresh one at developers.google.com/oauthplayground');
  } else if (/invalid_client/i.test(msg)) {
    hint('GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is wrong.');
    hint('Copy them again from Google Cloud Console -> Credentials.');
  } else if (/has not been used|is disabled|accessNotConfigured/i.test(msg)) {
    hint('The Google Calendar API is not enabled on this project.');
    hint('Console -> APIs & Services -> Library -> Google Calendar API -> Enable.');
    hint('Enabling can take a minute to propagate.');
  } else if (/insufficient|insufficientPermissions|forbidden/i.test(msg)) {
    hint('The token lacks the calendar scope.');
    hint('Re-authorise with https://www.googleapis.com/auth/calendar');
  }
};

const main = async () => {
  console.log('\nGoogle Calendar OAuth check\n');

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const calendarId = process.env.GOOGLE_CALENDAR_ID || 'primary';

  const unset = (v) => !v || v.startsWith('your_');

  if (unset(clientId) || unset(clientSecret) || unset(refreshToken)) {
    warn('Google Calendar is not configured - events will be simulated.');
    hint(`GOOGLE_CLIENT_ID     : ${clientId ? (unset(clientId) ? '(placeholder)' : '(set)') : '(empty)'}`);
    hint(`GOOGLE_CLIENT_SECRET : ${clientSecret ? (unset(clientSecret) ? '(placeholder)' : '(set)') : '(empty)'}`);
    hint(`GOOGLE_REFRESH_TOKEN : ${refreshToken ? (unset(refreshToken) ? '(placeholder)' : '(set)') : '(empty)'}`);
    hint('');
    hint('This is a valid way to run the app: bookings still store a mock_gcal_ id');
    hint('and reschedule/cancel still work. Only real invites are missing.');
    process.exit(0);
  }

  ok(`Client ID  : ${clientId.slice(0, 24)}...`);
  ok(`Calendar   : ${calendarId}`);

  const auth = new google.auth.OAuth2(
    clientId,
    clientSecret,
    process.env.GOOGLE_REDIRECT_URI || 'https://developers.google.com/oauthplayground'
  );
  auth.setCredentials({ refresh_token: refreshToken });

  console.log('\nToken exchange');
  try {
    const { token } = await auth.getAccessToken();
    if (!token) throw new Error('No access token returned');
    ok('Refresh token exchanged for an access token');
  } catch (err) {
    bad(`Token exchange failed: ${err.message}`);
    diagnose(err);
    process.exit(1);
  }

  const calendar = google.calendar({ version: 'v3', auth });

  console.log('\nCalendar API');
  let ownerEmail;
  try {
    const cal = await calendar.calendars.get({ calendarId });
    ownerEmail = cal.data.id;
    ok(`Reached calendar: ${cal.data.summary || cal.data.id}`);
    ok(`Timezone: ${cal.data.timeZone}`);
    if (cal.data.timeZone && process.env.TIMEZONE && cal.data.timeZone !== process.env.TIMEZONE) {
      warn(`Calendar timezone (${cal.data.timeZone}) differs from TIMEZONE (${process.env.TIMEZONE}).`);
      hint('Not a problem - events carry an explicit timeZone - but worth knowing.');
    }
  } catch (err) {
    bad(`Calendar API call failed: ${err.message}`);
    diagnose(err);
    process.exit(1);
  }

  if (!process.argv.includes('--create')) {
    console.log(`\n${GREEN}Google Calendar is configured correctly.${RESET}`);
    console.log(`${DIM}To create and then delete a real test event:  npm run check:calendar -- --create${RESET}\n`);
    process.exit(0);
  }

  console.log('\nRound-trip test (create, patch, delete)');
  let eventId;
  try {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const tz = process.env.TIMEZONE || 'Asia/Kolkata';

    const created = await calendar.events.insert({
      calendarId,
      requestBody: {
        summary: 'CareSync connectivity test (safe to ignore)',
        description: 'Created by npm run check:calendar. Deleted automatically.',
        start: { dateTime: `${tomorrow}T09:00:00`, timeZone: tz },
        end: { dateTime: `${tomorrow}T09:30:00`, timeZone: tz },
      },
    });
    eventId = created.data.id;
    ok(`Created event ${eventId}`);
    hint(`Link: ${created.data.htmlLink}`);

    await calendar.events.patch({
      calendarId,
      eventId,
      requestBody: {
        start: { dateTime: `${tomorrow}T10:00:00`, timeZone: tz },
        end: { dateTime: `${tomorrow}T10:30:00`, timeZone: tz },
      },
    });
    ok('Patched it to a new time (this is what reschedule does)');

    await calendar.events.delete({ calendarId, eventId });
    ok('Deleted it (this is what cancel and doctor-leave do)');
    eventId = null;

    console.log(`\n${GREEN}Full create/update/delete cycle works. Real invites will be sent.${RESET}\n`);
  } catch (err) {
    bad(`Round trip failed: ${err.message}`);
    diagnose(err);
    if (eventId) hint(`A test event may be left behind: ${eventId}`);
    process.exit(1);
  }
};

main().catch((err) => {
  bad(`Unexpected error: ${err.message}`);
  process.exit(1);
});
