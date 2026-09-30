import {
  ApplicationConfig,
  provideExperimentalZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withRouterConfig } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { jwtInterceptor } from './core/auth/jwt.interceptor';
import { passwordRequiredInterceptor } from './core/auth/password-required.interceptor';
import { refreshInterceptor } from './core/auth/refresh.interceptor';
import { compactedReadInterceptor } from './core/api/compacted-read.interceptor';
import { errorInterceptor } from './core/api/error.interceptor';
import { etagInterceptor } from './core/api/etag.interceptor';
import { readonlyInterceptor } from './core/api/readonly.interceptor';
import { provideI18n } from './core/i18n/i18n.providers';
import { providePreferencesSync } from './core/preferences/preferences-sync';

export const appConfig: ApplicationConfig = {
  providers: [
    provideExperimentalZonelessChangeDetection(),
    providePreferencesSync(),
    provideI18n(),
    provideRouter(routes, withComponentInputBinding(), withRouterConfig({ paramsInheritanceStrategy: 'always' })),
    provideHttpClient(
      withInterceptors([
        jwtInterceptor,
        passwordRequiredInterceptor,
        refreshInterceptor,
        errorInterceptor,
        // Downstream of errorInterceptor so a blocked (time-travel) request still gets
        // routed through the existing global error-toast handling: functional
        // interceptors run request-side in array order and response-side in reverse, so
        // errorInterceptor's catchError only observes errors thrown by interceptors
        // registered after it.
        readonlyInterceptor,
        etagInterceptor,
        // Notes past-revision reads that come back compacted, for the time-travel banner (M29.5.2).
        compactedReadInterceptor,
      ]),
    ),
  ],
};
