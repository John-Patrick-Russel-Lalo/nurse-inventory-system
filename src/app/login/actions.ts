"use server";

import { AuthError } from "next-auth";
import { signIn } from "@/auth";

export interface LoginState {
  error?: string;
}

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  try {
    await signIn("credentials", {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      redirectTo: "/",
    });
    return {};
  } catch (e) {
    if (e instanceof AuthError) {
      return { error: "Email or password is not correct." };
    }
    throw e; // the redirect after a successful sign-in is thrown and must pass through
  }
}
