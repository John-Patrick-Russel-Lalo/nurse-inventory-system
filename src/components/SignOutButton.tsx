import { signOutAction } from "./signout-action";

export function SignOutButton() {
  return (
    <form action={signOutAction} className="flex-1">
      <button
        type="submit"
        className="w-full cursor-pointer rounded-xl border border-rule bg-surface px-2.5 py-1 text-xs text-muted shadow-card transition-[transform,box-shadow,color] duration-150 hover:-translate-y-px hover:text-fg hover:shadow-raised active:translate-y-0 active:shadow-none"
      >
        Sign out
      </button>
    </form>
  );
}