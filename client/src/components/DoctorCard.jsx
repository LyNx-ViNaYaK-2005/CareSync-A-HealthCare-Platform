import React from 'react';
import { UserCheck, Clock, MapPin, Award } from 'lucide-react';

const DoctorCard = ({ doctor, onSelect }) => {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between">
      <div>
        <div className="flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-sky-100 border border-sky-200 text-sky-700 flex items-center justify-center font-bold text-xl shrink-0">
            Dr
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Dr. {doctor.name}</h3>
            <div className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-100 mt-1">
              <Award className="w-3.5 h-3.5" />
              {doctor.specialization}
            </div>
          </div>
        </div>

        <p className="text-sm text-slate-600 mt-3 line-clamp-2">{doctor.bio || 'Experienced healthcare specialist providing compassionate patient consultation and treatment.'}</p>

        <div className="flex items-center gap-4 text-xs font-medium text-slate-500 mt-4 pt-3 border-t border-slate-100">
          <div className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-sky-600" />
            {doctor.slotDurationMins || 30} min slots
          </div>
          <div className="flex items-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-sky-600" />
            {doctor.roomNumber || 'Room 1'}
          </div>
        </div>
      </div>

      <button
        onClick={() => onSelect(doctor)}
        className="w-full mt-4 bg-sky-600 hover:bg-sky-700 text-white font-semibold text-sm py-2.5 rounded-xl transition shadow-sm flex items-center justify-center gap-2"
      >
        <UserCheck className="w-4 h-4" />
        Select & Book Slot
      </button>
    </div>
  );
};

export default DoctorCard;
