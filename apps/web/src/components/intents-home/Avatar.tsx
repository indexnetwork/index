import { useState } from "react";

/** A 3px-radius square: the photo when there is one, else the initial. */
export default function Avatar({ name, photo, size = 28 }: { name: string; photo?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (photo && !failed) {
    return <img className="ih-avatar" src={photo} alt="" width={size} height={size} style={{ width: size, height: size }} onError={() => setFailed(true)} />;
  }
  return <span className="ih-avatar" style={{ width: size, height: size }}>{(name.trim()[0] || "?").toUpperCase()}</span>;
}
