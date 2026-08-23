import React from 'react';
import { Link } from 'react-router-dom';
import { Shield, ArrowLeft } from 'lucide-react';

/**
 * Privacy policy.
 *
 * Required for Google OAuth production publishing, and appropriate on its own
 * terms for a system that stores symptom descriptions and prescriptions.
 * Deliberately public (no auth guard) so Google's verification crawler and any
 * prospective patient can read it without an account.
 */
const Section = ({ title, children }) => (
  <section className="space-y-2">
    <h2 className="text-base font-bold text-slate-900">{title}</h2>
    <div className="text-sm text-slate-600 leading-relaxed space-y-2">{children}</div>
  </section>
);

const Privacy = () => (
  <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
    <Link
      to="/login"
      className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-600 hover:text-sky-700 mb-6"
    >
      <ArrowLeft className="w-4 h-4" /> Back to sign in
    </Link>

    <div className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm space-y-6">
      <div className="flex items-center gap-3 pb-5 border-b border-slate-100">
        <div className="w-11 h-11 rounded-2xl bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
          <Shield className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">Privacy Policy</h1>
          <p className="text-xs text-slate-500">CareSync &middot; last updated 23 August 2026</p>
        </div>
      </div>

      <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl text-sm text-amber-900">
        <strong>This is a student project.</strong> CareSync was built as a technical assignment and is not a real
        clinic. Please do not enter genuine medical information, real prescriptions, or details you would not want
        stored in a demonstration system.
      </div>

      <Section title="What we collect">
        <p>
          <strong>Account details</strong> &mdash; your name, email address, and optionally a phone number, supplied
          when you register or when an administrator creates a doctor account for you.
        </p>
        <p>
          <strong>Appointment data</strong> &mdash; the doctor and time slot you select, the symptom description you
          write before a visit, and the clinical notes and prescription your doctor records afterwards.
        </p>
        <p>
          <strong>Delivery records</strong> &mdash; a log of each email we attempt to send, so failed messages can be
          retried.
        </p>
        <p>We do not use cookies for tracking, run analytics, or serve advertising.</p>
      </Section>

      <Section title="How your information is used">
        <p>
          Your symptom description is sent to Google&rsquo;s Gemini API to produce a short triage summary for your
          doctor, and your doctor&rsquo;s clinical notes are sent to the same service to produce a plain-language
          summary for you. These summaries are stored alongside your appointment.
        </p>
        <p>
          If the clinic has connected a Google Calendar account, booking an appointment creates a calendar event and
          adds you and your doctor as attendees so you both receive an invitation.
        </p>
        <p>
          We email you booking confirmations, cancellations, and medication reminders based on the schedule your
          doctor prescribes.
        </p>
      </Section>

      <Section title="Who can see your data">
        <p>
          Patients see only their own appointments. A doctor sees only the appointments booked with them. An
          administrator can see the doctor roster and clinic-wide totals.
        </p>
        <p>
          Data is stored in MongoDB Atlas. Third parties that necessarily process some of it are Google (Gemini for
          summaries, Calendar for invitations) and our email provider for delivery. We do not sell your data or share
          it for marketing.
        </p>
      </Section>

      <Section title="Security">
        <p>
          Passwords are hashed with bcrypt and never stored in readable form. Access requires a signed token, and all
          traffic runs over HTTPS. No system is perfectly secure, which is another reason not to enter real medical
          information here.
        </p>
      </Section>

      <Section title="Retention and your choices">
        <p>
          Records are kept while the demonstration remains online. You can cancel an appointment at any time from your
          dashboard.
        </p>
        <p>
          To have your account and associated records deleted, email the address below and we will remove them.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions or deletion requests:{' '}
          <a href="mailto:vinayak.oscar20052020@gmail.com" className="text-sky-600 font-semibold hover:text-sky-700">
            vinayak.oscar20052020@gmail.com
          </a>
        </p>
      </Section>
    </div>
  </div>
);

export default Privacy;
