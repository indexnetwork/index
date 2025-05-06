import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserCircle, ChevronDown, LogOut } from "lucide-react";

export default function Header() {
  return (
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
  );
} 