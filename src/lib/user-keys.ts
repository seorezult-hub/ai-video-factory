import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

type ServiceKey = string | null;

const ALGO = "aes-256-gcm";

// BUG-004: проверка ENCRYPTION_KEY при загрузке модуля
const _KEY_CHECK = process.env.ENCRYPTION_KEY;
if (!_KEY_CHECK || _KEY_CHECK.length < 32) {
  throw new Error("ENCRYPTION_KEY must be set (>=32 chars) at boot");
}

function getEncryptionKey(): Buffer | null {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    console.warn("[user-keys] ENCRYPTION_KEY not set or invalid — falling back to base64 (insecure)");
    return null;
  }
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) {
    console.warn(`[user-keys] ENCRYPTION_KEY decoded to ${key.length} bytes, expected 32 — falling back to base64 (insecure)`);
    return null;
  }
  return key;
}

export function encryptKey(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) {
    throw new Error("[user-keys] ENCRYPTION_KEY not set — cannot encrypt API key");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptKey(ciphertext: string): string | null {
  const key = getEncryptionKey();
  if (!key) {
    console.warn("[user-keys] ENCRYPTION_KEY not set — cannot decrypt, returning null");
    return null;
  }
  const buf = Buffer.from(ciphertext, "base64");
  if (buf.length < 29) {
    console.error("[user-keys] ciphertext too short — corrupt or not encrypted");
    return null;
  }
  try {
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const encrypted = buf.subarray(28);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch (e) {
    console.error("[user-keys] decryption failed — key rotation? returning null", e);
    return null;
  }
}

/**
 * Читает API ключ пользователя из Supabase.
 * Если пользователь не залогинен или ключа нет — возвращает null,
 * тогда caller должен fallback на process.env.
 */
export async function getUserApiKey(service: string): Promise<ServiceKey> {
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { cookies: { getAll: () => cookieStore.getAll(), setAll: () => {} } }
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const { data } = await supabase
      .from("user_api_keys")
      .select("encrypted_key")
      .eq("user_id", user.id)
      .eq("service", service)
      .single();

    if (!data?.encrypted_key) return null;

    return decryptKey(data.encrypted_key);
  } catch {
    return null;
  }
}

/**
 * Возвращает ключ: сначала из профиля пользователя, потом из env.
 * Использовать во всех API routes вместо прямого process.env.
 */
export async function resolveApiKey(service: string, envKey: string | undefined): Promise<string | undefined> {
  const userKey = await getUserApiKey(service);
  return userKey ?? envKey;
}
