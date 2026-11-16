export interface BlogPost {
  slug: string;
  title: string;
  date: string;
  /** Comma-separated author names, as written in frontmatter. */
  authors?: string;
  description?: string;
  meta_description?: string;
  image?: string;
  content?: string;
}

/** "Seref Yarar, Seren Sandikci" -> ["Seref Yarar", "Seren Sandikci"] */
export function parseAuthors(authors?: string): string[] {
  return (authors || '').split(',').map((name) => name.trim()).filter(Boolean);
}

/** Profile links for the people who write here, keyed by the name used in frontmatter. */
const AUTHOR_LINKS: Record<string, string> = {
  'Seref Yarar': 'https://x.com/serefyarar',
  'Seren Sandikci': 'https://x.com/serensandikci',
};

export interface BlogAuthor {
  name: string;
  href?: string;
}

/** A post's authors in byline order, each with a profile link when we know one. */
export function getAuthors(authors?: string): BlogAuthor[] {
  return parseAuthors(authors).map((name) => ({ name, href: AUTHOR_LINKS[name] }));
}

interface Frontmatter {
  title?: string;
  date?: string;
  authors?: string;
  description?: string;
  meta_description?: string;
  image?: string;
  [key: string]: string | undefined;
}

export function parseFrontmatter(fileContents: string): { data: Frontmatter; content: string } {
  const lines = fileContents.split('\n');

  // Check if file starts with ---
  if (lines[0].trim() !== '---') {
    return { data: {}, content: fileContents };
  }

  // Find closing ---
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { data: {}, content: fileContents };
  }

  // Parse frontmatter
  const frontmatterLines = lines.slice(1, endIndex);
  const data: Frontmatter = {};

  for (const line of frontmatterLines) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();
      // Remove surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      data[key] = value;
    }
  }

  // Get content after frontmatter
  const content = lines.slice(endIndex + 1).join('\n').trim();

  return { data, content };
}

export function transformAssetPaths(content: string, slug: string): string {
  // Transform markdown image syntax: ![alt](image.jpg) -> ![alt](/blog/slug/image.jpg)
  // Only transform relative paths (not starting with / or http)
  let transformed = content.replace(
    /!\[([^\]]*)\]\((?!\/|https?:\/\/)([^)]+)\)/g,
    `![$1](/blog/${slug}/$2)`
  );

  // Transform audio links: [audio](song.mp3) -> [audio](/blog/slug/song.mp3)
  // Only transform relative paths (not starting with / or http)
  transformed = transformed.replace(
    /\[audio\]\((?!\/|https?:\/\/)([^)]+)\)/gi,
    `[audio](/blog/${slug}/$1)`
  );

  // Transform video links: [video](clip.mp4) -> [video](/blog/slug/clip.mp4)
  // Only transform relative paths (not starting with / or http)
  transformed = transformed.replace(
    /\[video\]\((?!\/|https?:\/\/)([^)]+)\)/gi,
    `[video](/blog/${slug}/$1)`
  );

  return transformed;
}

/** Newest-first posts. Throws when the index can't be fetched, so callers can show an error. */
export async function fetchAllPosts(): Promise<BlogPost[]> {
  const response = await fetch('/blog/posts.json');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const posts: BlogPost[] = await response.json();
  return posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export async function getPostBySlug(slug: string): Promise<BlogPost | null> {
  try {
    const response = await fetch(`/blog/${slug}/index.md`);
    if (!response.ok) return null;

    const ct = response.headers.get("content-type") || "";
    if (ct.includes("text/html")) return null;

    const fileContents = await response.text();
    const { data, content } = parseFrontmatter(fileContents);

    // Transform relative asset paths (images, audio) to blog asset paths
    const transformedContent = transformAssetPaths(content, slug);

    // Transform frontmatter image if it's a relative path
    let image = data.image;
    if (image && !image.startsWith('/') && !image.startsWith('http')) {
      image = `/blog/${slug}/${image}`;
    }

    return {
      slug,
      title: data.title || 'Untitled',
      date: data.date || new Date().toISOString().split('T')[0],
      authors: data.authors,
      description: data.description,
      meta_description: data.meta_description,
      content: transformedContent,
      image,
    };
  } catch {
    return null;
  }
}
