import {
  Directive,
  ElementRef,
  HostListener,
  OnDestroy,
  input,
  inject,
} from '@angular/core';

@Directive({
  selector: '[sfTooltip]',
  standalone: true,
})
export class SfTooltipDirective {
  readonly sfTooltip = input<string>('');

  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef)
    .nativeElement;

  @HostListener('mouseenter')
  @HostListener('focus')
  onShow(): void {
    const text = this.sfTooltip();
    if (text) {
      this.el.setAttribute('title', text);
    }
  }

  @HostListener('mouseleave')
  @HostListener('blur')
  onHide(): void {
    this.el.removeAttribute('title');
  }
}
