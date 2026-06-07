/**
 * Maximum allowed length of a note, in characters (per spec FR-008 / data-model.md).
 * Shared so the client and server enforce the same limit.
 */
export const NOTE_MAX_LENGTH = 10000;

/**
 * Maximum allowed length of a contact value, in characters (spec FR-014). 320 is the
 * practical maximum length of an email address (64-char local part + "@" + 255-char
 * domain). Shared so the client and server enforce the same limit.
 */
export const CONTACT_MAX_LENGTH = 320;

/**
 * Maximum number of contacts a single user may store (spec FR-015). Shared so the
 * client can disable the add control at the cap and the server can reject the 51st.
 */
export const CONTACT_LIMIT = 50;
