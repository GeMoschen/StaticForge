import { Injectable, inject, signal } from '@angular/core';
import { ApiClient } from '../../core/api/api.client';
import type { components } from '../../core/api/generated/schema.d.ts';

type PasswordPolicyView = components['schemas']['PasswordPolicyView'];

/** The server's password policy, fetched once per app session (it only changes with the server's configuration). */
@Injectable({ providedIn: 'root' })
export class PasswordPolicyStore {
  private readonly api = inject(ApiClient);
  private requested = false;

  readonly policy = signal<PasswordPolicyView | null>(null);

  load(): void {
    if (this.requested) {
      return;
    }
    this.requested = true;
    this.api.passwordPolicy().subscribe({
      next: (policy) => this.policy.set(policy),
      error: () => {
        this.requested = false;
      },
    });
  }
}
