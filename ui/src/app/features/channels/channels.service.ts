import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import type { components } from '../../core/api/generated/schema.d.ts';

type ChannelView = components['schemas']['ChannelView'];
type ChannelCreateRequest = components['schemas']['ChannelCreateRequest'];
type ChannelUpdateRequest = components['schemas']['ChannelUpdateRequest'];
type ChannelDeletePreview = components['schemas']['ChannelDeletePreview'];

const BASE = '/api/v1';

@Injectable({ providedIn: 'root' })
export class ChannelsService {
  constructor(private readonly http: HttpClient) {}

  list(projectKey: string): Observable<ChannelView[]> {
    return this.http.get<ChannelView[]>(
      `${BASE}/projects/${projectKey}/channels`,
    );
  }

  create(
    projectKey: string,
    req: ChannelCreateRequest,
  ): Observable<ChannelView> {
    return this.http.post<ChannelView>(
      `${BASE}/projects/${projectKey}/channels`,
      req,
    );
  }

  update(
    projectKey: string,
    channelKey: string,
    req: ChannelUpdateRequest,
  ): Observable<ChannelView> {
    return this.http.put<ChannelView>(
      `${BASE}/projects/${projectKey}/channels/${channelKey}`,
      req,
    );
  }

  deletePreview(
    projectKey: string,
    channelKey: string,
  ): Observable<ChannelDeletePreview> {
    return this.http.get<ChannelDeletePreview>(
      `${BASE}/projects/${projectKey}/channels/${channelKey}/delete-preview`,
    );
  }

  delete(projectKey: string, channelKey: string): Observable<void> {
    return this.http.delete<void>(
      `${BASE}/projects/${projectKey}/channels/${channelKey}`,
    );
  }

  enable(projectKey: string, channelKey: string): Observable<ChannelView> {
    return this.http.post<ChannelView>(
      `${BASE}/projects/${projectKey}/channels/${channelKey}/enable`,
      null,
    );
  }

  disable(projectKey: string, channelKey: string): Observable<ChannelView> {
    return this.http.post<ChannelView>(
      `${BASE}/projects/${projectKey}/channels/${channelKey}/disable`,
      null,
    );
  }
}
