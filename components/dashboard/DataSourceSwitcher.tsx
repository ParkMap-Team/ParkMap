import type { DataSourceMode, DemoScenario } from '@/types/parking';

const scenarios: { value: DemoScenario; label: string }[] = [
  { value: 'normal', label: 'Normal' }, { value: 'busy', label: 'Busy' },
  { value: 'almost-full', label: 'Almost full' }, { value: 'processing', label: 'Processing' },
  { value: 'stale', label: 'Stale' }, { value: 'offline', label: 'Offline' }, { value: 'error', label: 'Error' },
];

export function DataSourceSwitcher({ mode, scenario, onModeChange, onScenarioChange }: { mode: DataSourceMode; scenario: DemoScenario; onModeChange: (mode: DataSourceMode) => void; onScenarioChange: (scenario: DemoScenario) => void }) {
  return <div className="flex flex-wrap items-center gap-2"><div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-1" aria-label="Data source"><button type="button" onClick={() => onModeChange('demo')} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${mode === 'demo' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}>Demo</button><button type="button" onClick={() => onModeChange('live')} className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${mode === 'live' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500'}`}>Live</button></div>{mode === 'demo' && <select aria-label="Demo scenario" value={scenario} onChange={(event) => onScenarioChange(event.target.value as DemoScenario)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 outline-none focus:ring-2 focus:ring-blue-500">{scenarios.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>}</div>;
}
