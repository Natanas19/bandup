type SlugCrypto = Pick<Crypto, "getRandomValues"> & Partial<Pick<Crypto, "randomUUID">>;

export function createBandSlug(name: string, source: SlugCrypto = globalThis.crypto): string {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Informe o nome da banda.");

  const normalizedName = trimmedName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  let suffix: string;
  if (typeof source?.randomUUID === "function") {
    suffix = source.randomUUID().slice(0, 8);
  } else {
    if (typeof source?.getRandomValues !== "function") {
      throw new Error("Não foi possível gerar um endereço seguro para a banda. Tente novamente em um navegador atualizado.");
    }
    // The original UUID prefix contains 32 random bits. Preserve both its
    // entropy and eight hexadecimal characters when randomUUID needs HTTPS.
    const bytes = source.getRandomValues(new Uint8Array(4));
    suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${normalizedName || "banda"}-${suffix}`;
}
