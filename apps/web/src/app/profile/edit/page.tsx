import { ProfileSettings } from "@/app/settings/page";

/** /profile/edit: the profile form on its own, out of settings. */
export default function EditProfilePage() {
  return <ProfileSettings editProfile />;
}

export const Component = EditProfilePage;
