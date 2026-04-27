import { redirect } from "next/navigation";

export default function ProfilesRedirect() {
  redirect("/settings/profiles");
}
