import path from 'node:path';
import matter from 'gray-matter';
import type { MarkdownFrontmatter, ParsedMarkdown } from './types.js';

export function deriveTitle(
	content: string,
	frontmatter: MarkdownFrontmatter,
	filePath: string,
): string {
	// 1. Try frontmatter title
	if (frontmatter.title && typeof frontmatter.title === 'string') {
		return frontmatter.title;
	}

	// 2. Try first # heading
	const headingMatch = content.match(/^#\s+(.+)$/m);
	if (headingMatch?.[1]) {
		return headingMatch[1].trim();
	}

	// 3. Fall back to filename without extension
	const basename = path.basename(filePath, path.extname(filePath));
	return basename;
}

export function deriveId(
	filePath: string,
	frontmatter: MarkdownFrontmatter,
	basePath: string,
): string {
	// 1. Try frontmatter page_id
	if (frontmatter.page_id && typeof frontmatter.page_id === 'string') {
		return frontmatter.page_id;
	}

	// 2. Generate from path
	const relativePath = path.relative(basePath, filePath);
	const withoutExt = relativePath.replace(/\.[^/.]+$/, '');

	// Sanitize: replace path separators and special chars with dashes
	return withoutExt
		.replace(/[/\\]/g, '-')
		.replace(/[^a-zA-Z0-9-_]/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
		.toLowerCase();
}

export function parseMarkdown(content: string, filePath: string, basePath: string): ParsedMarkdown {
	const { data, content: markdownContent } = matter(content);
	const frontmatter = data as MarkdownFrontmatter;

	// Normalize labels to array
	if (frontmatter.labels && typeof frontmatter.labels === 'string') {
		frontmatter.labels = [frontmatter.labels];
	}

	return {
		id: deriveId(filePath, frontmatter, basePath),
		title: deriveTitle(markdownContent, frontmatter, filePath),
		content: markdownContent,
		frontmatter,
		path: path.relative(basePath, filePath),
	};
}

export async function parseMarkdownFile(
	filePath: string,
	basePath: string,
): Promise<ParsedMarkdown> {
	const content = await Bun.file(filePath).text();
	return parseMarkdown(content, filePath, basePath);
}
