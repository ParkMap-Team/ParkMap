'use client';

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ParkingHistoryPoint } from '@/types/parking';

export function ParkingHistoryChart({ data }: { data: ParkingHistoryPoint[] }) {
  return (
    <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-5">
        <h2 className="font-semibold">Parking history</h2>
        <p className="mt-1 text-sm text-slate-500">Dynamic area estimates across the day · demo history</p>
      </div>
      <div className="h-72 min-w-0">
        <ResponsiveContainer width="100%" height="100%" minWidth={0} minHeight={288}>
          <LineChart data={data} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
            <XAxis dataKey="timestamp" tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#64748b', fontSize: 12 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', boxShadow: '0 8px 24px rgba(15,23,42,.08)' }} />
            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, paddingTop: 12 }} />
            <Line type="monotone" dataKey="motorcycles" name="Motorcycles" stroke="#2563eb" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="available" name="Available areas" stroke="#10b981" strokeWidth={3} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="uncertain" name="Uncertain" stroke="#f59e0b" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}
