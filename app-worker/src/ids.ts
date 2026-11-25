const RECEIPT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** 32 hex chars from the CSPRNG: an unguessable URL token. */
export function newToken(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}

/** 10 chars from an alphabet without look-alike characters. */
export function newReceiptCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => RECEIPT_ALPHABET[b % RECEIPT_ALPHABET.length]).join("");
}

/** Row id: a UUID without dashes. */
export function newId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}
