export interface MarkdownFrontmatter {
	title?: string;
	page_id?: string;
	labels?: string[];
	author_email?: string;
	created_at?: string | Date; // gray-matter may parse ISO dates as Date objects
	updated_at?: string | Date; // gray-matter may parse ISO dates as Date objects
	[key: string]: unknown;
}

export interface ParsedMarkdown {
	id: string;
	title: string;
	content: string;
	frontmatter: MarkdownFrontmatter;
	path: string;
}
