"use client";

import { useState } from "react";
import { MascotScreen } from "@/components/mascot-screen";
import { Button } from "@/components/ui/button";

// The error message is not shown: it can carry server details. Next logs it on the server.
// `retry` fetches the server data again; `reset` would only re-render what already failed. A retry
// that fails again brings a new error, so the message shakes once per failure, not per click.
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const [seen, setSeen] = useState({ error, failures: 0 });
  if (seen.error !== error) setSeen({ error, failures: seen.failures + 1 });
  return (
    <MascotScreen mood="confused" title="โหลดข้อมูลไม่สำเร็จ" description="อาจเป็นที่สัญญาณหรือระบบขัดข้องชั่วคราว ลองใหม่อีกครั้ง" shakeKey={seen.failures}>
      <Button onClick={() => retry()} className="h-11 px-5">
        ลองใหม่
      </Button>
    </MascotScreen>
  );
}
