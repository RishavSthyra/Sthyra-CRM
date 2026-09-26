import { redirect } from "next/navigation";

export default function TeamMembersPage() {
  redirect("/settings?section=people");
}
