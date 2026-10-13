/* Failures the file stage can report. Codes, not prose: the UI owns wording
   and translation, and a worker can only send plain data across. Messages
   never include file content. */

export type InputErrorCode =
  | "empty_file"
  | "too_large"
  | "unsupported_type"
  | "not_text"
  | "zip_invalid"
  | "zip_unsupported"     // ZIP64, encryption, unknown compression
  | "zip_without_chat"
  | "zip_ambiguous";      // several candidate chat files

export class InputError extends Error {
  readonly code: InputErrorCode;

  constructor(code: InputErrorCode, message: string) {
    super(message);
    this.name = "InputError";
    this.code = code;
  }
}
