import '@angular/compiler';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { render, screen } from '@testing-library/angular';
import { describe, expect, it } from 'vitest';
import { DeveloperModeService } from '../../core/frame/developer-mode.service';
import { SfDevOnlyDirective } from './sf-dev-only.directive';

@Component({
  standalone: true,
  imports: [SfDevOnlyDirective],
  template: `<p>always</p><code *sfDevOnly>uid-123</code>`,
})
class HostComponent {}

describe('sfDevOnly', () => {
  it('renders its content only while developer mode is on', async () => {
    const enabled = signal(true);
    const { fixture } = await render(HostComponent, {
      providers: [{ provide: DeveloperModeService, useValue: { enabled } }],
    });
    expect(screen.getByText('uid-123')).toBeTruthy();

    enabled.set(false);
    TestBed.flushEffects();
    fixture.detectChanges();
    expect(screen.queryByText('uid-123')).toBeNull();
    expect(screen.getByText('always')).toBeTruthy();

    enabled.set(true);
    TestBed.flushEffects();
    fixture.detectChanges();
    expect(screen.getByText('uid-123')).toBeTruthy();
  });
});
