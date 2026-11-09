import { redirect } from "next/navigation";

export default function LegacyPersonalProfilePage(): never {
  redirect("/dashboard");
}
