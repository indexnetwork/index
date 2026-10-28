import UserAvatar from "@/components/UserAvatar";

/** Keep real photos, with the original colorful geometric faces as fallbacks. */
export default function Avatar({ name, photo, size = 28 }: { name: string; photo?: string | null; size?: number }) {
  return <UserAvatar name={name} avatar={photo} size={size} className="ih-avatar" />;
}
