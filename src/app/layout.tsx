import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { THEME_INITIALIZATION_SCRIPT } from "@/lib/theme";
import { ThemeProvider } from "@/components/theme-provider";
import PrivateSessionBoundary from "@/components/private-session-boundary";
import PullToRefresh from "@/components/pull-to-refresh";
import { isPullRefreshPreview, pullRefreshPreviewPath } from "@/lib/pull-refresh-preview";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

export const metadata: Metadata = {
  title: "BandUp",
  applicationName: "BandUp",
  // Next 15 emits the generic capable tag; iOS 15 also needs the Apple tag.
  other: { "apple-mobile-web-app-capable": "yes" },
  appleWebApp: {
    capable: true,
    title: "BandUp",
    statusBarStyle: "default",
  },
  icons: {
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  description: "Um espaço para sua banda crescer.",
};

export const viewport: Viewport = {
  themeColor: "#0e0e12",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${inter.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script id="bandup-theme-init" dangerouslySetInnerHTML={{ __html: THEME_INITIALIZATION_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col"><ThemeProvider>
        <PullToRefresh debugPath={isPullRefreshPreview() ? pullRefreshPreviewPath : undefined} />
        <PrivateSessionBoundary>{children}</PrivateSessionBoundary>
      </ThemeProvider></body>
    </html>
  );
}
