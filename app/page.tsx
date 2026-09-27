import { DashboardClient } from '@/components/dashboard/DashboardClient';
import { getDemoParkingData } from '@/lib/mockParkingData';

export default function Home() {
  return <DashboardClient initialData={getDemoParkingData('normal')} />;
}
