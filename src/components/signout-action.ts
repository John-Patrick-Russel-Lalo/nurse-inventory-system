"use server";

// Its own file because AppShell is a client component: a server action imported from a client
// component has to be an exported function from a "use server" module, not an inline closure.

import { signOut } from "@/auth";

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
