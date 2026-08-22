import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'sfFileSize',
  standalone: true,
})
export class SfFileSizePipe implements PipeTransform {
  transform(bytes: number | null | undefined, decimals = 1): string {
    if (bytes === null || bytes === undefined || Number.isNaN(bytes) || bytes < 0) {
      return '—';
    }
    if (bytes === 0) {
      return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const k = 1024;
    const magnitude = Math.min(
      Math.floor(Math.log(bytes) / Math.log(k)),
      units.length - 1,
    );
    const value = (bytes / Math.pow(k, magnitude)).toFixed(decimals);
    return `${parseFloat(value)} ${units[magnitude]}`;
  }
}
