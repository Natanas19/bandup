type SharingBrowser = {
  clipboard?: { writeText: (text: string) => Promise<void> };
  share?: (data: { title: string; url: string }) => Promise<void>;
};

export type SharingResult = "copied" | "manual" | "shared" | "cancelled";

export async function copyProfileAddress(url: string, browser: SharingBrowser): Promise<SharingResult> {
  if (!url || !browser.clipboard?.writeText) return "manual";
  try {
    await browser.clipboard.writeText(url);
    return "copied";
  } catch {
    return "manual";
  }
}

export async function shareProfileAddress(url: string, browser: SharingBrowser): Promise<SharingResult> {
  if (!url) return "manual";
  if (browser.share) {
    try {
      await browser.share({ title: "Perfil da banda | BandUp", url });
      return "shared";
    } catch (error) {
      // Cancelling the native sheet must not unexpectedly copy or move focus.
      if (error instanceof Error && error.name === "AbortError") return "cancelled";
    }
  }
  return copyProfileAddress(url, browser);
}
