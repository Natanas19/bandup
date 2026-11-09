import type { ReactNode } from "react";

// Appearance belongs to this visitor's browser, never to the published band.
// Keep the control available through loading, errors and unavailable profiles.
export default function PublicBandLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <footer className="flex justify-center px-4 pb-6 sm:px-6">
      </footer>
    </>
  );
}
