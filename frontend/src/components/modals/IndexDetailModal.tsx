import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, Trash2, ArrowUpRight } from "lucide-react";
import { useState } from "react";

interface IndexDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  indexName: string;
}

export default function IndexDetailModal({ open, onOpenChange, indexName }: IndexDetailModalProps) {
  const [isDragging, setIsDragging] = useState(false);

  const files = [
    { name: "document1.pdf", size: "2.4 MB", date: "2024-03-20" },
    { name: "research.docx", size: "1.1 MB", date: "2024-03-19" },
    { name: "data.csv", size: "4.2 MB", date: "2024-03-18" },
    { name: "document1.pdf", size: "2.4 MB", date: "2024-03-20" },
    { name: "research.docx", size: "1.1 MB", date: "2024-03-19" },
    { name: "data.csv", size: "4.2 MB", date: "2024-03-18" },
    { name: "document1.pdf", size: "2.4 MB", date: "2024-03-20" },
    { name: "research.docx", size: "1.1 MB", date: "2024-03-19" },
  ];

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    console.log('Dropped files:', droppedFiles);
    // Handle file upload logic here
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-gray-900 font-ibm-plex">
            {indexName}
          </DialogTitle>
        </DialogHeader>

        <div className="mt-4">
          <ScrollArea className="h-[400px] rounded-md border">
            <div className="space-y-4 p-4">
              {files.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="text-lg font-medium text-gray-900">{file.name}</h4>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="p-0 hover:bg-transparent text-gray-500 hover:text-gray-900"
                      >
                        <ArrowUpRight className="h-4 w-4" />
                      </Button>
                    </div>
                    <p className="text-sm text-gray-500">
                      {file.size} • {file.date}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>

          <div 
            className={`mt-4 border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center transition-colors cursor-pointer ${
              isDragging 
                ? "border-gray-400 bg-gray-100" 
                : "border-gray-200 bg-gray-50 hover:bg-gray-100"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              type="file"
              className="hidden"
              id="file-upload"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                console.log('Selected files:', files);
                // Handle file upload logic here
              }}
            />
            <label
              htmlFor="file-upload"
              className="flex flex-col items-center cursor-pointer w-full"
            >
              <Upload className={`h-6 w-6 mb-2 ${isDragging ? 'text-gray-600' : 'text-gray-400'}`} />
              <p className="text-sm font-medium text-gray-900">Upload Files</p>
              <p className="text-xs text-gray-500 mt-1">Drag and drop your files here or click to browse</p>
            </label>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
} 