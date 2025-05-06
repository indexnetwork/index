import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserCircle, ChevronDown, LogOut } from "lucide-react";
import { usePathname } from "next/navigation";
import Link from "next/link";

export default function Header() {
  const pathname = usePathname();

  return (
    <div>
      <header className="w-full py-4 flex justify-between items-center">
        <div className="flex items-center">
          <div className="relative mr-2">
            <img 
              src="/logo-black.svg" 
              alt="Index Protocol" 
              width={200} 
              className="object-contain"
            />
          </div>
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="flex items-center gap-2 hover:bg-gray-50 text-gray-700">
              <UserCircle className="h-6 w-6" />
              <span className="hidden sm:inline">Seref</span>
              <ChevronDown className="h-4 w-4 opacity-50" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-white border border-gray-100 shadow-md rounded-md">
            <DropdownMenuItem className="cursor-pointer hover:bg-gray-50 flex items-center px-4 py-3">
              <UserCircle className="mr-2 h-5 w-5 text-gray-500" />
              <span>Profile</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-gray-100" />
            <DropdownMenuItem className="cursor-pointer text-red-600 hover:bg-red-50 flex items-center px-4 py-3">
              <LogOut className="mr-2 h-5 w-5" />
              <span>Logout</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {/* Top Navigation Menu */}
      <div className="w-full flex justify-center my-6">
        <div className="flex gap-8">
          {/* Indexes Menu Item */}
          <Link href="/mvp/indexes">
            <div className="flex flex-col items-center cursor-pointer">
              <div className="w-18 h-18 flex items-center justify-center">
                <img 
                  src="/icon-folder.svg" 
                  width={48} 
                  className="object-contain p-1"
                  style={{filter: pathname.startsWith("/mvp/indexes") ? "invert(70%) sepia(40%) saturate(1000%) hue-rotate(360deg) brightness(100%)" : "invert(50%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(90%)"}}
                />
              </div>
              <span className={`text-sm font-ibm-plex ${pathname.startsWith("/mvp/indexes") ? "text-amber-500 font-medium" : "text-gray-500"}`}>
                Indexes
              </span>
            </div>
          </Link>
          
          {/* Intents Menu Item */}
          <Link href="/mvp/intents">
            <div className="flex flex-col items-center cursor-pointer">
              <div className="w-18 h-18 flex items-center justify-center">
                <img 
                  src="/icon-intent.svg" 
                  width={48} 
                  className="object-contain p-1"
                  style={{filter: pathname.startsWith("/mvp/intents") ? "invert(70%) sepia(40%) saturate(1000%) hue-rotate(360deg) brightness(100%)" : "invert(50%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(90%)"}}
                />
              </div>
              <span className={`text-sm font-ibm-plex ${pathname.startsWith("/mvp/intents")  ? "text-amber-500 font-medium" : "text-gray-500"}`}>
                Intents
              </span>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
} 