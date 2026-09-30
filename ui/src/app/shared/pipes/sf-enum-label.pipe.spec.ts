import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { SfEnumLabelPipe } from './sf-enum-label.pipe';

describe('SfEnumLabelPipe', () => {
  let pipe: SfEnumLabelPipe;
  beforeEach(() => {
    pipe = TestBed.runInInjectionContext(() => new SfEnumLabelPipe());
  });

  it('turns an enum value into its human label', () => {
    expect(pipe.transform('PROJECT_ADMIN', 'projectRole')).toBe('Project admin');
    expect(pipe.transform('DELETION_PENDING', 'releaseStatus')).toBe('Deletion pending');
    expect(pipe.transform('USER_PASSWORD_RESET', 'auditAction')).toBe('Password reset');
  });

  it('shows a value without a label as it is, and nothing as an em dash', () => {
    expect(pipe.transform('SOMETHING_NEW', 'releaseStatus')).toBe('SOMETHING_NEW');
    expect(pipe.transform(null, 'releaseStatus')).toBe('—');
  });
});
