export type Status = 'unread' | 'reading' | 'read' | 'archived';

export type Item = {
  id: string;
  url: string;
  canonical_url?: string | null;
  title: string;
  author?: string | null;
  source: string;
  type: string;
  excerpt?: string | null;
  summary_zh: string;
  takeaway_summary_zh: string;
  note: string;
  status: Status;
  saved_at: string;
  updated_at: string;
  content_text: string;
  image_url?: string | null;
  website_screenshot_url?: string | null;
  progress: number;
  scroll_y: number;
  extraction_status: string;
  resource_kind?: 'text' | 'website' | 'video' | 'image' | null;
  resource_url?: string | null;
  resource_title?: string | null;
  resource_description?: string | null;
  resource_domain?: string | null;
  resource_image_url?: string | null;
  context_text?: string | null;
  context_author?: string | null;
  context_handle?: string | null;
  highlight_count?: number;
  note_count?: number;
};

export type Block = {
  id: string;
  item_id: string;
  block_index: number;
  kind: string;
  text: string;
  image_url?: string | null;
  website_screenshot_url?: string | null;
  alt?: string | null;
  caption?: string | null;
};

export type Note = {
  id: string;
  item_id: string;
  highlight_id: string | null;
  body: string;
  created_at: string;
  quote?: string;
  title?: string;
  source?: string;
  block_index?: number;
};

export type Highlight = {
  id: string;
  item_id: string;
  block_id: string;
  start_offset: number;
  end_offset: number;
  quote: string;
  created_at: string;
  title?: string;
  source?: string;
  url?: string;
  block_index?: number;
  notes?: Note[];
};

export type ItemDetail = Item & {
  blocks: Block[];
  highlights: Highlight[];
  notes: Note[];
};
