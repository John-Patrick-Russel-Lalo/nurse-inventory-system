import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { StockError } from "@/lib/stock";

/** An error we meant to produce. Anything else is a bug and becomes a 500. */
export class ApiError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 400, code = "BAD_REQUEST") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }

  static badRequest(message: string, code = "BAD_REQUEST"): ApiError {
    return new ApiError(message, 400, code);
  }
  static unauthorized(message = "Please sign in."): ApiError {
    return new ApiError(message, 401, "UNAUTHORIZED");
  }
  static forbidden(message = "You do not have permission to do this."): ApiError {
    return new ApiError(message, 403, "FORBIDDEN");
  }
  static notFound(message = "Not found."): ApiError {
    return new ApiError(message, 404, "NOT_FOUND");
  }
  /** The request was well formed but the stock rules refuse it. */
  static conflict(message: string, code = "CONFLICT"): ApiError {
    return new ApiError(message, 409, code);
  }
}

interface ErrorBody {
  error: string;
  code: string;
  fields?: Record<string, string>;
}

/** Maps any thrown value onto an HTTP status. Stock and validation errors are the caller's fault. */
function toBody(e: unknown): { status: number; body: ErrorBody } {
  if (e instanceof ApiError) {
    return { status: e.status, body: { error: e.message, code: e.code } };
  }

  if (e instanceof StockError) {
    // The rules in src/lib/stock.ts were not happy. 409: the request was valid, the stock is not.
    return { status: 409, body: { error: e.message, code: e.code } };
  }

  if (e instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of e.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] ??= issue.message;
    }
    const first = e.issues[0];
    return {
      status: 422,
      body: { error: first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input.", code: "INVALID", fields },
    };
  }

  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") return { status: 409, body: { error: "That value is already taken.", code: "DUPLICATE" } };
    if (e.code === "P2003") return { status: 409, body: { error: "That record is still in use.", code: "IN_USE" } };
    if (e.code === "P2025") return { status: 404, body: { error: "Not found.", code: "NOT_FOUND" } };
    if (e.code === "P2010") return { status: 409, body: { error: "The database refused that change.", code: "DB_REJECTED" } };
  }

  return { status: 500, body: { error: "Something went wrong on the server.", code: "INTERNAL" } };
}

/**
 * Wraps a route handler so services can throw ApiError / StockError / ZodError freely.
 * Unexpected errors are logged server-side and reported as a plain 500, so no stack or
 * database detail ever reaches the browser.
 */
export async function handle(fn: () => Promise<unknown>): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn());
  } catch (e) {
    const { status, body } = toBody(e);
    if (status >= 500) console.error("[api]", e);
    return NextResponse.json(body, { status });
  }
}

/**
 * The same mapping as handle(), for a route whose success case answers with a file rather than
 * JSON. Failures still come back as JSON with a real status, so a download that cannot be built
 * shows the reason instead of saving a corrupt spreadsheet.
 */
export async function handleFile(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    const { status, body } = toBody(e);
    if (status >= 500) console.error("[api]", e);
    return NextResponse.json(body, { status });
  }
}
