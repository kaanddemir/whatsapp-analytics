/* Input limits. The former server app capped uploads at 25 MB
   because the file crossed HTTP. In the browser the cost
   is memory instead; the cap stays at 25 MB until a large-export benchmark
   justifies raising it. */

export const MAX_TEXT_BYTES = 25 * 1024 * 1024;
/** A zipped export also carries media; only the chat text inside is read. */
export const MAX_ZIP_BYTES = 200 * 1024 * 1024;
