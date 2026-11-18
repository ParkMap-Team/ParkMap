import { MascotLoading } from "@/components/mascot";

export default function Loading() {
  return (
    <main className="grid flex-1 place-items-center bg-background p-4 motion-safe:animate-screen-enter">
      <MascotLoading label="กำลังโหลด" />
    </main>
  );
}
