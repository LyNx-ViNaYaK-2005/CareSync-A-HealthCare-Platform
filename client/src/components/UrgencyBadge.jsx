import React from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';

const UrgencyBadge = ({ level = 'MEDIUM' }) => {
  const normalized = level ? level.toUpperCase() : 'MEDIUM';

  if (normalized === 'HIGH') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-200 shadow-sm animate-pulse">
        <AlertTriangle className="w-3.5 h-3.5" />
        High Urgency
      </span>
    );
  }

  if (normalized === 'MEDIUM') {
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
        <AlertCircle className="w-3.5 h-3.5" />
        Medium Urgency
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
      <CheckCircle2 className="w-3.5 h-3.5" />
      Low Urgency
    </span>
  );
};

export default UrgencyBadge;
