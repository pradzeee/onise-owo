import type { Metadata, Viewport } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";
import { DevAccessBanner } from "@/components/DevAccessBanner";
import { PwaRegistrar } from "@/components/PwaRegistrar";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — ${APP_TAGLINE}`,
    template: `%s | ${APP_NAME}`,
  },
  description:
    "Connect with nearby verified plumbers, electricians, tailors, carpenters, mechanics, painters, and makeup artists across Nigeria.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: APP_NAME,
  },
};

export const viewport: Viewport = {
  themeColor: "#0B6E4F",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-NG">
      <body className="min-h-dvh bg-[#FAFAF8] text-gray-900 antialiased">
        <DevAccessBanner />
        <PwaRegistrar />
        {children}
      </body>
    </html>
  );
}
