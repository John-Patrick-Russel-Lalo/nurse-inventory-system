// Signing in with no network. The password itself is never stored: a salted PBKDF2 verifier is
// kept in IndexedDB after a successful online sign-in, and checked against on the next offline
// sign-in. Where the browser refuses Web Crypto (an insecure origin), offline sign-in is simply
// unavailable and the person is asked to connect.

import { ApiError } from "@/lib/api-error";
import { store, type CachedSession } from "./store";

const ITERATIONS = 150_000;

function supported(): boolean {
  return typeof crypto !== "undefined" && !!crypto.subtle && typeof crypto.getRandomValues === "function";
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function derive(password: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: fromBase64(salt), iterations, hash: "SHA-256" },
    key,
    256,
  );
  return toHex(bits);
}

/** Called after a confirmed online sign-in, so the next one can happen offline. */
export async function rememberCredential(email: string, password: string): Promise<void> {
  if (!supported()) return;
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await derive(password, salt, ITERATIONS);
  await store.saveCredential({ email: email.trim().toLowerCase(), salt, hash, iterations: ITERATIONS, savedAt: Date.now() });
}

/** Verifies an offline sign-in and returns the cached session it unlocks. */
export async function verifyOffline(email: string, password: string): Promise<CachedSession> {
  const [record, session] = await Promise.all([store.getCredential(), store.getSession()]);
  if (!record || !session) {
    throw new ApiError("This device has no saved sign-in yet. Connect to the internet once first.", 0, "OFFLINE_LOGIN");
  }
  if (record.email !== email.trim().toLowerCase()) {
    throw new ApiError("Email or password is not correct.", 401, "INVALID");
  }
  const hash = await derive(password, record.salt, record.iterations);
  if (hash !== record.hash) throw new ApiError("Email or password is not correct.", 401, "INVALID");
  return session;
}
