export interface DurationParts {
	value: number;
	unit: 'd' | 'w' | 'm' | 'y';
}

export function parseDuration(duration: string): DurationParts | null {
	const match = duration.match(/^(\d+)([dwmy])$/i);
	if (!match) {
		return null;
	}

	const value = Number.parseInt(match[1]!, 10);
	const unit = match[2]!.toLowerCase() as 'd' | 'w' | 'm' | 'y';

	return { value, unit };
}

export function durationToMs(parts: DurationParts): number {
	const msPerDay = 24 * 60 * 60 * 1000;

	switch (parts.unit) {
		case 'd':
			return parts.value * msPerDay;
		case 'w':
			return parts.value * 7 * msPerDay;
		case 'm':
			return parts.value * 30 * msPerDay;
		case 'y':
			return parts.value * 365 * msPerDay;
	}
}

export function dateToTimestamp(date: string): number {
	return new Date(date).getTime();
}

export function timestampFromDuration(
	duration: string,
	direction: 'before' | 'after',
): number | null {
	const parts = parseDuration(duration);
	if (!parts) {
		return null;
	}

	const now = Date.now();
	const ms = durationToMs(parts);

	return direction === 'before' ? now - ms : now + ms;
}

export interface DateFilter {
	field: 'created_at' | 'updated_at';
	operator: '>' | '<' | '>=' | '<=';
	value: number;
}

interface DateFilterOptions {
	createdAfter?: string;
	createdBefore?: string;
	createdWithin?: string;
	updatedAfter?: string;
	updatedBefore?: string;
	updatedWithin?: string;
	stale?: string;
}

function addDateFilter(
	filters: DateFilter[],
	dateStr: string | undefined,
	field: DateFilter['field'],
	operator: DateFilter['operator'],
): void {
	if (!dateStr) return;
	const ts = dateToTimestamp(dateStr);
	if (!Number.isNaN(ts)) {
		filters.push({ field, operator, value: ts });
	}
}

function addDurationFilter(
	filters: DateFilter[],
	duration: string | undefined,
	field: DateFilter['field'],
	operator: DateFilter['operator'],
): void {
	if (!duration) return;
	const ts = timestampFromDuration(duration, 'before');
	if (ts !== null) {
		filters.push({ field, operator, value: ts });
	}
}

export function buildDateFilters(options: DateFilterOptions): DateFilter[] {
	const filters: DateFilter[] = [];

	addDateFilter(filters, options.createdAfter, 'created_at', '>=');
	addDateFilter(filters, options.createdBefore, 'created_at', '<=');
	addDurationFilter(filters, options.createdWithin, 'created_at', '>=');
	addDateFilter(filters, options.updatedAfter, 'updated_at', '>=');
	addDateFilter(filters, options.updatedBefore, 'updated_at', '<=');
	addDurationFilter(filters, options.updatedWithin, 'updated_at', '>=');
	addDurationFilter(filters, options.stale, 'updated_at', '<=');

	return filters;
}

export function filtersToMeilisearchString(filters: DateFilter[]): string {
	return filters.map((f) => `${f.field} ${f.operator} ${f.value}`).join(' AND ');
}
