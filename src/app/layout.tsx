import type { Metadata } from "next";
import "./globals.css";
import { mobileErrorCapture } from "@/lib/mobile-error-capture";

export const metadata: Metadata = {
  title: "BandUp",
  description: "Um espaço para sua banda crescer.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className="h-full antialiased">
      <head>
        {/* TEMPORARY: native capture without DOM mutations or runtime dependency. */}
        <script
          id="bandup-mobile-error-capture"
          dangerouslySetInnerHTML={{ __html: mobileErrorCapture }}
        />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
