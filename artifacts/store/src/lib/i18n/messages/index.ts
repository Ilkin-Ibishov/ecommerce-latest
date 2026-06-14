import az from "./az";
import ru from "./ru";
import en from "./en";
import type { MessageSchema, MessageKey } from "./schema";

export type { MessageSchema, MessageKey } from "./schema";

// Accepts the typed dotted-key union (for autocomplete + checking of known keys)
// while still permitting arbitrary strings so existing dynamic `t(`...`)` call
// sites keep compiling. See task 14.1 note on the t() typing choice.
export type TranslationKey = MessageKey | (string & {});

const messages: Record<string, MessageSchema> = { az, ru, en };

export default messages;

export function getT(locale: string): (key: TranslationKey) => string {
  const m = messages[locale] ?? messages.az;
  return function t(key: TranslationKey): string {
    const parts = key.split(".");
    let cur: any = m;
    for (const p of parts) {
      cur = cur?.[p];
      if (cur === undefined) return key;
    }
    return typeof cur === "string" ? cur : key;
  };
}
