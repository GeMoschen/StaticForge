import { AfterViewInit, Directive, ElementRef, input } from '@angular/core';

@Directive({
  selector: '[sfAutofocus]',
  standalone: true,
})
export class SfAutofocusDirective implements AfterViewInit {
  readonly sfAutofocus = input(true);

  constructor(private readonly el: ElementRef<HTMLElement>) {}

  ngAfterViewInit(): void {
    if (this.sfAutofocus()) {
      this.el.nativeElement.focus();
    }
  }
}
