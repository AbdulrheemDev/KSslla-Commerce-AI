import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { PRODUCT } from "@/config/product";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${PRODUCT.nameAr} — ${PRODUCT.taglineAr}`,
    template: `%s · ${PRODUCT.name}`,
  },
  description: PRODUCT.descriptionAr,
  applicationName: PRODUCT.name,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#050b14",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ar" dir="rtl">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
