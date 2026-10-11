"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { rememberCredential, verifyOffline } from "@/lib/offline";
import { Alert, Button, Field, Input } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    setError(undefined);
    setPending(true);
    try {
      // No network: check the saved verifier and open the pages already kept on the device.
      // A full load, not a client navigation, so the service worker can serve the kept page.
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await verifyOffline(email, password);
        window.location.replace("/");
        return;
      }

      const result = await signIn("credentials", { email, password, redirect: false });
      if (result?.error) {
        setError("Email or password is not correct.");
        return;
      }
      // Signed in for real, so remember it for the next offline start.
      await rememberCredential(email, password);
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign in.");
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
          placeholder="you@office.gov"
        />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <Button type="submit" size="lg" disabled={pending} className="mt-1 w-full justify-center">
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-xs text-muted">
        Use the email and password the office gave you. If it does not work, it can be reset from the user settings.
      </p>
    </form>
  );
}
