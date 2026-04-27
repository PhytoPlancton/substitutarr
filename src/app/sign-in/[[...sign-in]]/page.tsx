import { redirect } from "next/navigation";
import { SignIn } from "@clerk/nextjs";
import { clerkConfigured } from "@/lib/auth";

export default function Page() {
  if (!clerkConfigured()) redirect("/");
  return (
    <div className="min-h-screen flex items-center justify-center">
      <SignIn />
    </div>
  );
}
