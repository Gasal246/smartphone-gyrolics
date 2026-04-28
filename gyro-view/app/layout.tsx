import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gyro View",
  description: "Live UDP phone sensor telemetry dashboard"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
