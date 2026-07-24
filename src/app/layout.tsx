import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: "GameDayGrabs",
  title: "GameDayGrabs Admin",
  description: "Private GameDayGrabs ecommerce operations workspace.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      {
        url: "/icon.png?v=gdg-icons-v1",
        sizes: "256x256",
        type: "image/png"
      },
      {
        url: "/icons/icon-192.png?v=gdg-icons-v1",
        sizes: "192x192",
        type: "image/png"
      },
      {
        url: "/icons/icon-512.png?v=gdg-icons-v1",
        sizes: "512x512",
        type: "image/png"
      }
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png?v=gdg-icons-v1"
  },
  appleWebApp: {
    capable: true,
    title: "GameDayGrabs",
    statusBarStyle: "black-translucent"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#070808"
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
