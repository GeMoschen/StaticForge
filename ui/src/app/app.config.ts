import {
  ApplicationConfig,
  provideExperimentalZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding, withRouterConfig } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { jwtInterceptor } from './core/auth/jwt.interceptor';
import { refreshInterceptor } from './core/auth/refresh.interceptor';
import { errorInterceptor } from './core/api/error.interceptor';
import { etagInterceptor } from './core/api/etag.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideExperimentalZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding(), withRouterConfig({ paramsInheritanceStrategy: 'always' })),
    provideHttpClient(
      withInterceptors([
        jwtInterceptor,
        refreshInterceptor,
        errorInterceptor,
        etagInterceptor,
      ]),
    ),
  ],
};
