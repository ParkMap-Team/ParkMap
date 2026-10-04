import { MascotLoading } from "@/components/mascot";

export default function Loading() {
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4">
      <MascotLoading label="กำลังโหลด" />
    </main>
  );
}
