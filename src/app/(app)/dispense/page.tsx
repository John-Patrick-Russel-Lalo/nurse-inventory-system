import { redirect } from "next/navigation";

/** The Dispense screen was folded into Record. Keep old links working. */
export default function DispenseRedirect() {
  redirect("/receive?tab=dispense");
}
