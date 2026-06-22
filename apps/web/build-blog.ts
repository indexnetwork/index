import { readdirSync, readFileSync, mkdirSync, cpSync, writeFileSync, existsSync } from "fs";
import { join, extname } from "path";

const CONTENT_DIR = join(import.meta.dir, "content/blog");
const OUTPUT_DIR = join(import.meta.dir, "public/blog");

interface Frontmatter {
  title?: string;
  date?: string;
  description?: string;
  image?: string;
  [key: string]: string | undefined;
}

function parseFrontmatter(fileContents: string): { data: Frontmatter } {
  const lines = fileContents.split("\n");

  if (lines[0].trim() !== "---") {
    return { data: {} };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { data: {} };
  }

  const frontmatterLines = lines.slice(1, endIndex);
  const data: Frontmatter = {};

  for (const line of frontmatterLines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      data[key] = value;
    }
  }

  return { data };
}

mkdirSync(OUTPUT_DIR, { recursive: true });

const slugs = readdirSync(CONTENT_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const posts: Array<{
  slug: string;
  title: string;
  date: string;
  description?: string;
  image?: string;
}> = [];

const mediaExtensions = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif",
  ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac",
  ".mp4", ".webm",
]);

for (const slug of slugs) {
  const postDir = join(CONTENT_DIR, slug);
  const indexPath = join(postDir, "index.md");
  if (!existsSync(indexPath)) continue;

  const raw = readFileSync(indexPath, "utf-8");
  const { data } = parseFrontmatter(raw);

  posts.push({
    slug,
    title: data.title || slug,
    date: data.date || "",
    description: data.description,
    image: data.image ? `/blog/${slug}/${data.image}` : undefined,
  });

  // Copy ALL files from post directory to public/blog/{slug}/
  const outDir = join(OUTPUT_DIR, slug);
  mkdirSync(outDir, { recursive: true });

  const files = readdirSync(postDir);
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (mediaExtensions.has(ext) || ext === ".md") {
      cpSync(join(postDir, file), join(outDir, file));
    }
  }
}

posts.sort((a, b) => {
  const dateA = a.date ? new Date(a.date).getTime() : 0;
  const dateB = b.date ? new Date(b.date).getTime() : 0;
  return dateB - dateA;
});
writeFileSync(join(OUTPUT_DIR, "posts.json"), JSON.stringify(posts, null, 2));
console.log(`Built ${posts.length} blog posts to ${OUTPUT_DIR}`);
