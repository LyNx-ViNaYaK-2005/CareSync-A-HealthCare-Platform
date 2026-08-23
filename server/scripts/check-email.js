/**
 * SMTP connection checker.
 *
 * Run with:  npm run check:email -- you@example.com
 *
 * Verifies the SMTP credentials authenticate, then optionally sends a real
 * test email. Diagnoses the failures that account for most SMTP setup
 * problems: an account password used instead of an app password, 2FA not
 * enabled, and a From address the provider will not let you send as.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const nodemailer = require('nodemailer');

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
  const msg = err.message || '';
  const code = err.code || '';

  if (/Invalid login|535|BadCredentials/i.test(msg)) {
    hint('The server rejected your username or password.');
    hint('For Gmail this almost always means you used your account password.');
    hint('You need a 16-character App Password from myaccount.google.com/apppasswords');
    hint('(2-Step Verification must be enabled first, or that page will not appear).');
    hint('Paste it without spaces.');
  } else if (/ETIMEDOUT|ECONNREFUSED/i.test(code + msg)) {
    hint('Could not reach the SMTP host.');
    hint('Check SMTP_HOST and SMTP_PORT. Port 587 with SMTP_SECURE=false is the');
    hint('usual combination; port 465 needs SMTP_SECURE=true.');
  } else if (/self signed|certificate/i.test(msg)) {
    hint('TLS certificate problem - check you are not on a proxy that intercepts TLS.');
  } else if (/Mail command failed|5\.7\.\d|not allowed to send/i.test(msg)) {
    hint('Authenticated fine, but the provider refused your From address.');
    hint('EMAIL_FROM must use the same mailbox as SMTP_USER unless you have');
    hint('verified a custom domain with the provider.');
  }
};

const main = async () => {
  console.log('\nSMTP configuration check\n');

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE, EMAIL_FROM } = process.env;

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    warn('SMTP is not configured - emails will be logged to the console instead of sent.');
    hint(`SMTP_HOST: ${SMTP_HOST || '(empty)'}`);
    hint(`SMTP_USER: ${SMTP_USER || '(empty)'}`);
    hint(`SMTP_PASS: ${SMTP_PASS ? '(set)' : '(empty)'}`);
    hint('');
    hint('This is a valid way to run the app. Every flow still completes and each');
    hint('message is recorded in the NotificationLog collection.');
    process.exit(0);
  }

  if (SMTP_PASS.startsWith('your_')) {
    bad('SMTP_PASS still contains placeholder text.');
    process.exit(1);
  }

  const port = Number(SMTP_PORT) || 587;
  const secure = SMTP_SECURE === 'true' || port === 465;

  ok(`Host: ${SMTP_HOST}:${port} (secure: ${secure})`);
  ok(`User: ${SMTP_USER}`);
  ok(`From: ${EMAIL_FROM || '(not set - will use the default)'}`);

  // Gmail app passwords are exactly 16 characters. A longer value is usually
  // the account password, which Gmail will reject.
  if (/gmail\.com$/i.test(SMTP_HOST)) {
    const stripped = SMTP_PASS.replace(/\s/g, '');
    if (stripped.length !== 16) {
      warn(`SMTP_PASS is ${stripped.length} characters; Gmail app passwords are 16.`);
      hint('If this is your normal Google password it will be rejected.');
    }
    if (EMAIL_FROM && !EMAIL_FROM.includes(SMTP_USER)) {
      warn('EMAIL_FROM does not contain SMTP_USER.');
      hint('Gmail rewrites or rejects a From address that is not your own mailbox.');
    }
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  console.log('\nConnection');
  try {
    await transporter.verify();
    ok('Authenticated with the SMTP server');
  } catch (err) {
    bad(`Could not authenticate: ${err.message}`);
    diagnose(err);
    process.exit(1);
  }

  const recipient = process.argv[2];
  if (!recipient) {
    console.log(`\n${GREEN}SMTP is configured correctly.${RESET}`);
    console.log(`${DIM}To send a real test email:  npm run check:email -- you@example.com${RESET}\n`);
    process.exit(0);
  }

  console.log('\nTest send');
  try {
    const info = await transporter.sendMail({
      from: EMAIL_FROM || `"CareSync Clinic" <${SMTP_USER}>`,
      to: recipient,
      subject: 'CareSync SMTP test',
      html: `
        <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;padding:24px;background:#f1f5f9;">
          <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
            <div style="background:#0284c7;height:6px;"></div>
            <div style="padding:28px;color:#0f172a;">
              <h2 style="margin:0 0 12px;font-size:20px;">SMTP is working</h2>
              <p style="font-size:14px;color:#475569;">
                If you are reading this, CareSync can send real email. Booking
                confirmations, cancellations, doctor invites, and medication
                reminders will now be delivered instead of logged to the console.
              </p>
              <p style="font-size:12px;color:#94a3b8;margin-top:24px;">
                Sent ${new Date().toISOString()} via ${SMTP_HOST}
              </p>
            </div>
          </div>
        </div>`,
    });
    ok(`Sent to ${recipient}`);
    hint(`Message id: ${info.messageId}`);
    console.log(`\n${GREEN}Check the inbox (and the spam folder).${RESET}\n`);
  } catch (err) {
    bad(`Send failed: ${err.message}`);
    diagnose(err);
    process.exit(1);
  }
};

main().catch((err) => {
  bad(`Unexpected error: ${err.message}`);
  process.exit(1);
});
