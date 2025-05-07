import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserCircle, ChevronDown, LogOut, MoreVertical, Trash, Pencil } from "lucide-react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";

export default function Header() {
  const pathname = usePathname();
  const { logout, user } = useAuth();
  
  // Extract name from user email or use default
  const displayName = user?.email ? String(user.email).split('@')[0] : 'User';

  return (
    <div>
      <header className="w-full py-4 flex justify-between items-center">
        <div className="flex items-center">
          <Link href="/indexes">
            <div className="relative mr-2 cursor-pointer">
              <img 
                src="/logo-black.svg" 
                alt="Index Protocol" 
                width={200} 
                className="object-contain"
              />
            </div>
          </Link>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
          <Button variant="outline" className="flex items-center rounded-[1px] px-3 py-6 gap-2 hover:bg-gray-50 text-gray-700 border-[#9F9F9F] cursor-pointer">
              <img 
                src="/icon-person.svg" 
                alt="Index Network" 
                width={32} 
                className="object-contain"
            />
              <span className="hidden sm:inline mx-4">{displayName}</span>
              <ChevronDown className="h-4 w-4  opacity-50" />
            </Button>
          </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-white border border-gray-200  rounded-[1px] ">
              <DropdownMenuItem 
                onClick={(e) => {
                  e.stopPropagation();
                  
                }} 
                className="hover:bg-gray-50 cursor-pointer text-gray-700 focus:text-gray-900"
              >
                <UserCircle className="mr-2 h-5 w-5 text-black" />
                <span>Profile</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-gray-100" />
              <DropdownMenuItem 
                onClick={(e) => {
                  e.stopPropagation();
                  logout();
                }}
                className="text-red-600 hover:bg-red-50 hover:text-red-700 cursor-pointer focus:text-red-700"
              >
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
          <Link href="/indexes" className="cursor-pointer">
            <div className="flex flex-col items-center cursor-pointer">
              <div className="w-18 h-18 flex items-center justify-center cursor-pointer">
                <img 
                  src="/icon-folder.svg" 
                  width={48} 
                  className="object-contain p-1"
                  style={{filter: pathname.startsWith("/indexes") ? "invert(70%) sepia(40%) saturate(1000%) hue-rotate(360deg) brightness(100%)" : "invert(50%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(90%)"}}
                />
              </div>
              <span className={`text-sm font-ibm-plex ${pathname.startsWith("/indexes") ? "text-amber-500 font-medium" : "text-gray-500"}`}>
                Indexes
              </span>
            </div>
          </Link>
          
          {/* Intents Menu Item */}
          <Link href="/intents" className="cursor-pointer">
            <div className="flex flex-col items-center cursor-pointer">
              <div className="w-18 h-18 flex items-center justify-center cursor-pointer">
                <img 
                  src="/icon-intent.svg" 
                  width={48} 
                  className="object-contain p-1"
                  style={{filter: pathname.startsWith("/intents") ? "invert(70%) sepia(40%) saturate(1000%) hue-rotate(360deg) brightness(100%)" : "invert(50%) sepia(0%) saturate(0%) hue-rotate(0deg) brightness(90%)"}}
                />
              </div>
              <span className={`text-sm font-ibm-plex ${pathname.startsWith("/intents")  ? "text-amber-500 font-medium" : "text-gray-500"}`}>
                Intents
              </span>
            </div>
          </Link>
        </div>
      </div>
    </div>
  );
} 