import { EN } from "./en.js";

/**
 * Every string the game can say, as a type.
 *
 * English is the source: `Key` is whatever `en.ts` has rows for, and `es.ts`
 * and `ru.ts` are `Table`, so a line added to English and forgotten in Spanish
 * does not compile. That is the whole enforcement mechanism — there is no
 * runtime check to skip, and no way to ship a half-translated build.
 */
export type Key = keyof typeof EN;

/** One language's rows. Exactly the keys English has, no more and no fewer. */
export type Table = Readonly<Record<Key, string>>;
