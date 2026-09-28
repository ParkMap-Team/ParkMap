import { GroundMapSetup } from './GroundMapSetup';
import { ParkingAreaSetup } from './ParkingAreaSetup';
import { PhysicalDimensionsSetup } from './PhysicalDimensionsSetup';

export function SetupPage() { return <div className="space-y-6"><div><h1 className="text-2xl font-bold">Setup</h1><p className="mt-1 text-sm text-slate-500">Configure the parking area and physical map.</p></div><ParkingAreaSetup /><GroundMapSetup /><PhysicalDimensionsSetup /></div>; }
