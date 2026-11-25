import { DashboardClient } from '../../components/dashboard/DashboardClient';

export default function RouteEditorPage() {
  return <DashboardClient initialView="SETUP" initialSetupTab="routes" />;
}
