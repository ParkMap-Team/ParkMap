import { GuideProvider } from "@/components/parking-guide";
import { TabBar } from "@/components/tab-bar";

// The tab screens share the bottom bar. The bar pads for the home indicator, so the screens above it
// see no bottom inset. Loading and error screens of a tab render inside, so the bar stays.
export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <GuideProvider>
      <div className="flex h-dvh flex-col">
        <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto [--safe-bottom:0px]">{children}</div>
        <TabBar />
      </div>
    </GuideProvider>
  );
}
