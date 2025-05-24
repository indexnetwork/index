import { usePathname } from "next/navigation";
import Link from "next/link";
import Image from "next/image";


export default function Header({ showNavigation = true }: { showNavigation?: boolean }) {
  const pathname = usePathname();

  const isAuthenticated = false;

  return (
    <div>
      <header className="w-full py-4 flex justify-between items-center">
        <div className="flex items-center">
          <Link href={isAuthenticated ? "/indexes" : "/"}>
            <div className="relative mr-2 cursor-pointer">
              <Image 
                src="/logo-black.svg" 
                alt="Index Protocol" 
                width={200}
                height={40}
                className="object-contain"
              />
            </div>
          </Link>
        </div>
      </header>

      { showNavigation && 
      <div className="w-full flex justify-center my-6">
        <div className="flex gap-8">
          {/* Indexes Menu Item */}
          <Link href="/indexes" className="cursor-pointer">
            <div className="flex flex-col items-center cursor-pointer">
              <div className="w-18 h-18 flex items-center justify-center cursor-pointer">
                <Image 
                  src="/icon-folder.svg" 
                  alt="Indexes"
                  width={48}
                  height={48}
                  className="object-contain p-1"
                  style={{filter: pathname.startsWith("/indexes") ? "invert(70%) sepia(40%) saturate(1000%) hue-rotate(360deg) brightness(100%)" : "invert(50%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(90%)"}}
                />
              </div>
              <span className={`text-sm font-ibm-plex-mono ${pathname.startsWith("/indexes") ? "text-amber-500 font-medium" : "text-gray-500"}`}>
                Indexes
              </span>
            </div>
          </Link>
          
          {/* Intents Menu Item */}
          <Link href="/intents" className="cursor-pointer">
            <div className="flex flex-col items-center cursor-pointer">
              <div className="w-18 h-18 flex items-center justify-center cursor-pointer">
                <Image 
                  src="/icon-intent.svg" 
                  alt="Intents"
                  width={44}
                  height={44}
                  className="object-contain p-1"
                  style={{filter: pathname.startsWith("/intents") ? "invert(70%) sepia(40%) saturate(1000%) hue-rotate(360deg) brightness(100%)" : "invert(50%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(90%)"}}
                />
              </div>
              <span className={`text-sm font-ibm-plex-mono ${pathname.startsWith("/intents")  ? "text-amber-500 font-medium" : "text-gray-500"}`}>
                Intents
              </span>
            </div>
          </Link>
        </div>
      </div>
      }
    </div>
  );
} 