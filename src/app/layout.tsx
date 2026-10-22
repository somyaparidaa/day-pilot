import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DayPilot",
  description: "AI-powered proactive day planning and execution assistant",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-slate-50 text-slate-900 min-h-screen">
        {children}
      </body>
    </html>
  );
}

