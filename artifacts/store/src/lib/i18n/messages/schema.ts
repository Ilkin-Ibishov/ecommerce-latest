// Canonical message shape, derived from the Azerbaijani locale (the source of truth).
export type MessageSchema = typeof import("./az").default;

// Recursively builds the union of dotted key paths for a nested message object,
// e.g. "HomePage.hero.title". Only string leaves produce keys.
type DeepKeyOf<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends Record<string, unknown>
      ? `${K}.${DeepKeyOf<T[K]>}`
      : K;
}[keyof T & string];

// Dotted-key union of every translatable string in the schema.
export type MessageKey = DeepKeyOf<MessageSchema>;
