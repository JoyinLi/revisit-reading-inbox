import type { Highlight, Item, ItemDetail, Note, Status } from './types';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {})
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export const api = {
  listItems(params: { status?: string; source?: string; q?: string }) {
    const query = new URLSearchParams();
    if (params.status && params.status !== 'all') query.set('status', params.status);
    if (params.source && params.source !== 'all') query.set('source', params.source);
    if (params.q) query.set('q', params.q);
    return request<Item[]>(`/api/items?${query.toString()}`);
  },
  getItem(id: string) {
    return request<ItemDetail>(`/api/items/${id}`);
  },
  detectLink(url: string) {
    return request<{ finalUrl: string; domain: string; title?: string; description?: string; imageUrl?: string; recommendedMode: 'article' | 'website'; confidence: 'high' | 'medium' | 'low'; reason: string }>('/api/detect-link', {
      method: 'POST',
      body: JSON.stringify({ url })
    });
  },
  capture(input: { url: string; title?: string; titleIsCustom?: boolean; note?: string; summaryZh?: string; status?: Status; captureMode?: 'article' | 'website' }) {
    return request<{ item: ItemDetail; duplicate: boolean }>('/api/capture', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },
  updateItem(id: string, patch: Partial<Pick<Item, 'status' | 'note' | 'summary_zh' | 'takeaway_summary_zh' | 'progress' | 'scroll_y' | 'title'>>) {
    return request<ItemDetail>(`/api/items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    });
  },
  addHighlight(itemId: string, input: Pick<Highlight, 'block_id' | 'start_offset' | 'end_offset' | 'quote'>) {
    return request<Highlight>(`/api/items/${itemId}/highlights`, {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },
  deleteHighlight(id: string) {
    return request<void>(`/api/highlights/${id}`, { method: 'DELETE' });
  },
  addNote(itemId: string, input: { body: string; highlight_id?: string | null }) {
    return request<Note>(`/api/items/${itemId}/notes`, {
      method: 'POST',
      body: JSON.stringify(input)
    });
  },
  deleteNote(id: string) {
    return request<void>(`/api/notes/${id}`, { method: 'DELETE' });
  },
  deleteImageBlock(itemId: string, blockId: string) {
    return request<ItemDetail>(`/api/items/${itemId}/blocks/${blockId}`, { method: 'DELETE' });
  },
  deleteCoverImage(itemId: string) {
    return request<ItemDetail>(`/api/items/${itemId}/cover-image`, { method: 'DELETE' });
  },
  listHighlights() {
    return request<Highlight[]>('/api/highlights');
  },
  deleteItem(id: string) {
    return request<void>(`/api/items/${id}`, { method: 'DELETE' });
  }
};
