import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { BuildDialogService } from './build-dialog.service';

describe('BuildDialogService', () => {
  it('opens and closes the dialog', () => {
    const service = TestBed.inject(BuildDialogService);
    expect(service.isOpen()).toBe(false);
    service.open();
    expect(service.isOpen()).toBe(true);
    service.close();
    expect(service.isOpen()).toBe(false);
  });
});
