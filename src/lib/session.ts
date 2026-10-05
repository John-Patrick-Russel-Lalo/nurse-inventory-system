import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { Role } from "./stock";

export interface CurrentUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}

/**
 * For server components and server actions: the signed-in user, or a redirect to /login.
 *
 * API routes should not use this. They want a 401 in JSON, which is what
 * `context()` in src/server/context.ts gives them.
 */
export async function requireUser(): Promise<CurrentUser> {
  const session = await auth();
  if (!session?.user) redirect("/login");
  return {
    id: Number(session.user.id),
    name: session.user.name ?? "",
    email: session.user.email ?? "",
    role: session.user.role,
  };
}
