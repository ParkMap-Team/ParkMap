import Link from "next/link";
import { MascotScreen } from "@/components/mascot-screen";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <MascotScreen mood="confused" title="ไม่พบหน้านี้" description="ลานจอดหรือหน้าที่เปิดอาจไม่มีอยู่แล้ว">
      <Button render={<Link href="/" />} nativeButton={false}>
        ดูรายการลานจอด
      </Button>
    </MascotScreen>
  );
}
