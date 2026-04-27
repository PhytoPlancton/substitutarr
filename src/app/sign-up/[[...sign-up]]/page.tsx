import { redirect } from "next/navigation";
import { SignUp } from "@clerk/nextjs";
import { clerkConfigured } from "@/lib/auth";

export default function Page() {
  if (!clerkConfigured()) redirect("/");
  return (
    <div className="min-h-screen flex items-center justify-center">
      <SignUp />
    </div>
  );
}
