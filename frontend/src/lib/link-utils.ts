
import { APIContextType } from "@/contexts/APIContext";

export const handleAddLink = async (
  url: string,
  linksService: APIContextType['linksService'],
  onSuccess?: (id: string) => void,
  onError?: (message: string) => void
) => {
  if (!url) return;

  let normalizedUrl = url.trim();
  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  try {
    const link = await linksService.createLink(normalizedUrl);
    if (onSuccess && link?.id) {
      onSuccess(link.id);
    }
  } catch {
    if (onError) {
      onError('Failed to add link. Please check the URL and try again.');
    }
  }
};