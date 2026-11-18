import Link from "next/link";
import { MascotScreen } from "@/components/mascot-screen";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <MascotScreen mood="confused" title="ไม่พบหน้านี้" description="ลิงก์อาจเก่าหรือหน้านี้ถูกย้ายไปแล้ว กลับไปดูลานจอดได้เลย">
      <Button render={<Link href="/" />} nativeButton={false} className="h-11 px-5">
        ไปที่ลานจอด
      </Button>
    </MascotScreen>
  );
}
