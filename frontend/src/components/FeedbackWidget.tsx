"use client";

import { useState, useRef, useEffect } from "react";
import { Image as ImageIcon, X, Loader2 } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";

export default function FeedbackWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { getAccessToken } = usePrivy();

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        if (!feedback && !selectedImage) {
           setIsOpen(false);
        }
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [feedback, selectedImage]);

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setSelectedImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePaste = (event: React.ClipboardEvent) => {
    const items = event.clipboardData.items;
    for (const item of items) {
      if (item.type.indexOf("image") !== -1) {
        const file = item.getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onloadend = () => {
            setSelectedImage(reader.result as string);
          };
          reader.readAsDataURL(file);
          event.preventDefault();
        }
      }
    }
  };

  const handleSubmit = async () => {
    if (!feedback && !selectedImage) return;
    
    setIsSubmitting(true);
    
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        throw new Error('Authentication required');
      }

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
      const response = await fetch(`${apiUrl}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          feedback,
          image: selectedImage ?? undefined,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to submit feedback');
      }

      console.log("Feedback submitted successfully");
      setFeedback("");
      setSelectedImage(undefined);
      setIsOpen(false);
    } catch (error) {
      console.error('Error submitting feedback:', error);
      // Optional: Show error message to user
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div 
      ref={containerRef}
      className={`fixed bottom-6 right-6 bg-white border border-gray-200 shadow-lg transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden z-50 ${
        isOpen ? "rounded-lg" : "rounded-md hover:bg-gray-50 hover:shadow-md"
      }`}
      style={{
        width: isOpen ? "388px" : "111px",
        height: isOpen ? (selectedImage ? "280px" : "171px") : "39px",
      }}
    >
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="w-full h-full flex items-center justify-center font-medium text-black text-sm"
          style={{
            gap: "8px",
          }}
        >
          Feedback
        </button>
      ) : (
        <div className="relative w-full h-full flex flex-col p-4">
          <textarea
            className="w-full flex-1 resize-none focus:outline-none text-sm placeholder-gray-400 mb-2"
            placeholder="Feedback"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onPaste={handlePaste}
            autoFocus
            disabled={isSubmitting}
          />
          
          {selectedImage && (
            <div className="relative w-full h-24 mb-3 bg-gray-50 rounded border border-gray-100 flex items-center justify-center overflow-hidden group">
              <img src={selectedImage} alt="Preview" className="h-full object-contain" />
              <button
                onClick={() => setSelectedImage(undefined)}
                className="absolute top-1 right-1 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 transition-colors"
                disabled={isSubmitting}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}

          <div className="flex items-center justify-between mt-auto">
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded hover:bg-gray-100"
                title="Attach image"
                disabled={isSubmitting}
              >
                <ImageIcon className="w-5 h-5" />
              </button>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                onChange={handleImageUpload}
              />
            </div>

            <button
              className="bg-black text-white px-4 py-1.5 rounded text-sm font-medium hover:bg-gray-800 transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleSubmit}
              disabled={isSubmitting || (!feedback && !selectedImage)}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Sending...
                </>
              ) : (
                "Send Feedback"
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
