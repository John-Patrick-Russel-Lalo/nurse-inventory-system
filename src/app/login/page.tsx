import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    // A single card on the soft page background: nothing to click until you have an account.
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-accent-soft shadow-raised">
            <span className="brand-mark size-9" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold">MediSakto</h1>
            <p className="mt-1 text-sm text-muted">Medical supplies inventory for Batangas State University Balayan Clinic.</p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-rule bg-surface p-6 shadow-card">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}