/**
 * @file Comparison of names chosen by players (characters, guilds).
 *
 * Two names that look the same must not both exist, or a player could pass
 * for another one (or for a moderator). SQLite only ignores the case of ASCII
 * letters, so names are compared through a key: Unicode compatibility form
 * (NFKC, which also turns full-width or styled letters into plain ones), lower
 * case in every alphabet, and the Cyrillic and Greek letters drawn like Latin
 * ones replaced by those. Names mixing these three alphabets are refused.
 */

/** Cyrillic and Greek letters (lower case) drawn like Latin letters. */
const LOOK_ALIKES: Readonly<Record<string, string>> = {
  // Cyrillic.
  'а': 'a', 'в': 'b', 'е': 'e', 'ё': 'ë', 'і': 'i', 'ї': 'ï', 'ј': 'j', 'к': 'k', 'м': 'm', 'н': 'h', 'о': 'o', 'р': 'p',
  'с': 'c', 'т': 't', 'у': 'y', 'х': 'x', 'ѕ': 's', 'һ': 'h', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'ӏ': 'l', 'ү': 'y',
  // Greek.
  'α': 'a', 'β': 'b', 'ε': 'e', 'ζ': 'z', 'η': 'h', 'ι': 'i', 'κ': 'k', 'μ': 'm', 'ν': 'n', 'ο': 'o', 'ρ': 'p', 'τ': 't', 'υ': 'y',
  'χ': 'x', 'ϲ': 'c', 'ϳ': 'j',
  // Latin letters without their dot.
  'ı': 'i', 'ȷ': 'j',
};

/** Alphabets whose letters can be confused with each other. */
const CONFUSABLE_SCRIPTS = [/\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Greek}/u];

/**
 * Key under which two names are considered the same.
 * @param name - Name as typed (already validated).
 */
export function nameKey(name: string): string {
  let key = '';
  for (const ch of name.normalize('NFKC').toLowerCase()) key += LOOK_ALIKES[ch] ?? ch;
  return key.replace(/\s+/g, ' ').trim();
}

/** Tells whether a name mixes the Latin, Cyrillic and Greek alphabets. */
export function mixesScripts(name: string): boolean {
  return CONFUSABLE_SCRIPTS.filter((script) => script.test(name)).length > 1;
}

/**
 * Characters drawn as nothing at all. Some of them count as letters (the Hangul fillers U+3164,
 * U+115F, U+1160, U+FFA0): without this rule a name could be invisible, or look exactly like
 * another one ("Bob" followed by a filler) while being a different name.
 */
const INVISIBLE = /\p{Default_Ignorable_Code_Point}/u;

/** Tells whether a name contains a character drawn as nothing. */
export function hasInvisible(name: string): boolean {
  return INVISIBLE.test(name);
}
