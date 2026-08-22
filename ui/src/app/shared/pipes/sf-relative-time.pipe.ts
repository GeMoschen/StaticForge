import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'sfRelativeTime',
  standalone: true,
})
export class SfRelativeTimePipe implements PipeTransform {
  transform(
    value: Date | string | number | null | undefined,
    now: Date = new Date(),
  ): string {
    if (value === null || value === undefined || value === '') {
      return '—';
    }

    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }

    const diffMs = date.getTime() - now.getTime();
    const absSeconds = Math.round(Math.abs(diffMs) / 1000);
    const suffix = diffMs < 0 ? 'ago' : 'from now';

    if (absSeconds < 60) {
      return 'just now';
    }
    const minutes = Math.round(absSeconds / 60);
    if (minutes < 60) {
      return `${minutes} min ${suffix}`;
    }
    const hours = Math.round(minutes / 60);
    if (hours < 24) {
      return `${hours} h ${suffix}`;
    }
    const days = Math.round(hours / 24);
    if (days < 30) {
      return `${days} d ${suffix}`;
    }
    const months = Math.round(days / 30);
    if (months < 12) {
      return `${months} mo ${suffix}`;
    }
    const years = Math.round(months / 12);
    return `${years} y ${suffix}`;
  }
}
