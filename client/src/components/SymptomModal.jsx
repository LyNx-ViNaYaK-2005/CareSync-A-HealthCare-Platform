import React, { useState, useEffect } from 'react';
import { X, Sparkles, Clock, AlertCircle, CheckCircle, Loader2 } from 'lucide-react';
import UrgencyBadge from './UrgencyBadge';

const SymptomModal = ({ appointmentId, holdExpiresAt, doctor, slot, onConfirm, onClose }) => {
  const [symptomsText, setSymptomsText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [timeLeft, setTimeLeft] = useState(300); // 5 minutes in seconds

  useEffect(() => {
    if (!holdExpiresAt) return;
    const expires = new Date(holdExpiresAt).getTime();
    
    const interval = setInterval(() => {
      const now = new Date().getTime();
      const diff = Math.max(0, Math.floor((expires - now) / 1000));
      setTimeLeft(diff);
      if (diff <= 0) {
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [holdExpiresAt]);

  const formatTimer = (seconds) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!symptomsText.trim() || symptomsText.trim().length < 10) {
      setError('Please describe your symptoms in at least 10 characters so the AI can analyze them for the doctor.');
      return;
    }

    if (timeLeft <= 0) {
      setError('SLOT_EXPIRED: Your 5-minute hold on this slot has lapsed. Please close this window and pick a slot again.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      await onConfirm({ appointmentId, symptomsText });
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to confirm booking');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl max-w-xl w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in duration-200">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div>
            <span className="text-xs font-bold text-sky-600 uppercase tracking-wider">Step 2: Pre-Visit Symptom Form</span>
            <h3 className="text-xl font-bold text-slate-900 mt-0.5">Confirm Appointment with Dr. {doctor.name}</h3>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Hold Expiration Timer Banner */}
        <div className={`mt-4 p-3.5 rounded-2xl flex items-center justify-between text-xs font-semibold ${
          timeLeft < 60 ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-sky-50 text-sky-800 border border-sky-200'
        }`}>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 animate-spin" />
            <span>Slot reserved: {slot.date} at {slot.startTime}</span>
          </div>
          <div className="font-bold text-sm">
            Hold expires in: <span className="font-mono">{formatTimer(timeLeft)}</span>
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700 font-medium flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center justify-between">
              <span>Describe your symptoms in detail</span>
              <span className="text-sky-600 font-semibold flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" /> AI Triage Active
              </span>
            </label>
            <textarea
              rows={4}
              value={symptomsText}
              onChange={(e) => setSymptomsText(e.target.value)}
              placeholder="E.g., High fever for 2 days accompanied by severe headache, sore throat, and fatigue..."
              className="w-full p-3.5 border border-slate-300 rounded-2xl text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none"
            />
            <p className="text-xs text-slate-500 mt-1.5">Our AI model will analyze your symptoms to generate a pre-visit summary, urgency level, and suggested questions for Dr. {doctor.name} before your visit.</p>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || timeLeft <= 0}
              className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white text-sm font-bold shadow-md hover:shadow-sky-600/20 transition flex items-center gap-2 disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating AI Summary & Syncing Calendar...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Confirm & Sync Google Calendar
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SymptomModal;
