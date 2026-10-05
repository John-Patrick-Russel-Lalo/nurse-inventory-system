import { signOutAction } from "./signout-action";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <button type="submit" className="text-left text-muted underline underline-offset-2 hover:text-fg">
        Sign out
      </button>
    </form>
  );
}
