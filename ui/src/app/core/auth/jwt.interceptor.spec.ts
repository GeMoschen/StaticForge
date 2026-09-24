import '@angular/compiler';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthStore } from './auth.store';
import { jwtInterceptor } from './jwt.interceptor';

describe('jwtInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([jwtInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthStore).accessToken.set('a.b.c');
  });

  it('adds the access token to API calls', () => {
    http.get('/api/v1/projects').subscribe();
    expect(httpMock.expectOne('/api/v1/projects').request.headers.get('Authorization')).toBe('Bearer a.b.c');
  });

  it('never sends it to login or refresh, which a revoked token would otherwise break', () => {
    http.post('/api/v1/auth/login', {}).subscribe();
    http.post('/api/v1/auth/refresh', null).subscribe();
    expect(httpMock.expectOne('/api/v1/auth/login').request.headers.has('Authorization')).toBe(false);
    expect(httpMock.expectOne('/api/v1/auth/refresh').request.headers.has('Authorization')).toBe(false);
  });
});
