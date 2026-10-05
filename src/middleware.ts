import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  // Pages only. API routes are excluded on purpose: they check the session themselves and
  // answer with JSON (401/403) instead of a redirect to the login form.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
