import type { Metadata, Viewport } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import { Providers } from "@/components/providers";
import { cn } from "@/lib/utils";
import "./globals.css";

const notoSansThai = Noto_Sans_Thai({ subsets: ["thai", "latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "ParkMap",
  description: "ดูพื้นที่ว่างสำหรับจอดรถจักรยานยนต์ในลานจอด",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Draw under the notch and home indicator; the screens pad themselves with safe-area insets.
  viewportFit: "cover",
  themeColor: "#f4f6f8",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" className={cn("font-sans", notoSansThai.variable)}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
