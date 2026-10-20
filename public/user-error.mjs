/** An error whose message is written for the player (it comes from texts.mjs).
 * Other errors are bugs, browser or server failures: their messages are not
 * shown, and the screen says what to do next instead. */
export class UserError extends Error {}

/** The message to show for `error`, or `fallback` when it is not one written for the player. */
export const messageFor = (error, fallback) => error instanceof UserError ? error.message : fallback;
