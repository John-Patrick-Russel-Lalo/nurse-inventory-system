// Edge-safe part of the auth setup: no database or bcrypt imports, so middleware can use it.
import type { NextAuthConfig } from "next-auth";

const ADMIN_PREFIXES = ["/admin"];

export const authConfig = {
  pages: { signIn: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 }, // a working day
  providers: [], // credentials provider is added in auth.ts
  callbacks: {
    authorized({ auth, request }) {
      const { pathname } = request.nextUrl;
      const loggedIn = !!auth?.user;
      if (pathname === "/login") {
        // Signed-in people have no reason to see the login form.
        return loggedIn ? Response.redirect(new URL("/", request.nextUrl)) : true;
      }
      if (!loggedIn) return false; // redirects to /login
      if (ADMIN_PREFIXES.some((p) => pathname.startsWith(p)) && auth.user.role !== "ADMIN") {
        return Response.redirect(new URL("/", request.nextUrl));
      }
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.uid = Number(user.id);
        token.role = user.role;
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === "number") session.user.id = String(token.uid);
      if (token.role === "NURSE" || token.role === "ADMIN") session.user.role = token.role;
      return session;
    },
  },
} satisfies NextAuthConfig;
