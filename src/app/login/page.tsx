import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    // A single card on the soft page background: nothing to click until you have an account.
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="grid size-12 place-items-center rounded-2xl bg-accent text-accent-fg shadow-raised">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="size-6"
              aria-hidden
            >
              <path d="M12 4.5v15M4.5 12h15" />
            </svg>
          </span>
          <div>
            <h1 className="text-xl font-semibold">Nurse office inventory</h1>
            <p className="mt-1 text-sm text-muted">Sign in to record and review stock.</p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-rule bg-surface p-6 shadow-card">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}