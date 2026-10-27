// Compatibility settings for the existing local laboratory only.
// Keep exact origins: production and test must never accept these HTTP exceptions.
export const laboratory = {
  allowedDevOrigins: ["192.168.0.6"],
  publicOrigin: "http://192.168.0.6:55321",
  internalOrigin: "http://127.0.0.1:55321",
};

export function isLaboratoryHttpOrigin(
  origin: string,
  endpoint?: "public" | "internal",
): boolean {
  if (process.env.NODE_ENV !== "development") return false;
  if (endpoint === "public") return origin === laboratory.publicOrigin;
  if (endpoint === "internal") return origin === laboratory.internalOrigin;
  return origin === laboratory.publicOrigin || origin === laboratory.internalOrigin;
}
