import type { Metadata, Viewport } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import { Providers } from "@/components/providers";
import { cn } from "@/lib/utils";
import "./globals.css";

const notoSansThai = Noto_Sans_Thai({ subsets: ["thai", "latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "ParkMap",
  description: "Motorcycle parking availability",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
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
