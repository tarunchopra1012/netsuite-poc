import { format, formatDistanceToNow } from 'date-fns';

export const formatDate = (date: Date | string): string => format(new Date(date), 'MMM dd, yyyy');

export const timeAgo = (date: Date | string): string =>
  formatDistanceToNow(new Date(date), { addSuffix: true });
