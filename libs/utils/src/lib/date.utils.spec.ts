import { formatDate, timeAgo } from './date.utils';

describe('date.utils', () => {
  it('formatDate renders "MMM dd, yyyy"', () => {
    expect(formatDate('2026-07-04')).toBe('Jul 04, 2026');
    expect(formatDate(new Date(2026, 0, 15))).toBe('Jan 15, 2026');
  });

  it('timeAgo suffixes a relative phrase', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    expect(timeAgo(oneHourAgo)).toMatch(/ago$/);
  });
});
