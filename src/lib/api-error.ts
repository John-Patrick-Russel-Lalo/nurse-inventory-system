// The error every screen already handles. Kept out of src/lib/api.ts so the offline layer
// and the fetch client can both use it without importing each other.

export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;

  constructor(message: string, status: number, code = "ERROR", fields: Record<string, string> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }

  /** True when the session is gone, so the caller should send the person to the login form. */
  get isAuth(): boolean {
    return this.status === 401;
  }

  static unauthorized(message = "Your session has ended. Please sign in again."): ApiError {
    return new ApiError(message, 401, "UNAUTHORIZED");
  }

  static notFound(message = "Not found."): ApiError {
    return new ApiError(message, 404, "NOT_FOUND");
  }

  static offline(message = "This needs an internet connection."): ApiError {
    return new ApiError(message, 0, "OFFLINE");
  }

  static badRequest(message: string, fields: Record<string, string> = {}): ApiError {
    return new ApiError(message, 400, "BAD_REQUEST", fields);
  }
}
