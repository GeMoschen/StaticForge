import { Directive, HostListener } from '@angular/core';

@Directive({
  selector: '[sfDropTarget]',
  standalone: true,
})
export class SfDropTargetDirective {
  @HostListener('dragover', ['$event'])
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
  }

  @HostListener('dragenter', ['$event'])
  onDragEnter(event: DragEvent): void {
    event.preventDefault();
  }

  @HostListener('drop', ['$event'])
  onDrop(event: DragEvent): void {
    event.preventDefault();
  }
}
