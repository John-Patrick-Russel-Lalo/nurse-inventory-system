import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4 py-10">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-muted">Nurse office</p>
        <h1 className="text-2xl font-semibold">Inventory sign in</h1>
      </div>
      <div className="rounded-md border border-rule bg-surface p-5">
        <LoginForm />
      </div>
    </div>
  );
}
