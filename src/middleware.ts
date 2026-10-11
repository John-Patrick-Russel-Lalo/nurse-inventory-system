import NextAuth from "next-auth";
import { authConfig } from "./auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  // Pages only. API routes are excluded on purpose: they check the session themselves and
  // answer with JSON (401/403) instead of a redirect to the login form. Public static files
  // (the service worker, manifest, icons, logo) are excluded too, so the sign-in page can show
  // the logo and the browser can read the PWA manifest before anyone has signed in.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|sw.js|manifest.webmanifest|logo.png|logo-mark.png|icon.svg).*)",
  ],
};
