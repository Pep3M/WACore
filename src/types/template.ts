export type TemplateMediaType = 'image' | 'video' | 'document' | 'audio';

export interface TemplateMedia {
  type: TemplateMediaType;
  url: string;
  mimetype?: string;
  filename?: string;
}

export interface TemplatePublic {
  id: string;
  name: string;
  body: string;
  media: TemplateMedia | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTemplateInput {
  name: string;
  body: string;
  media?: TemplateMedia | null;
}

export interface UpdateTemplateInput {
  name?: string;
  body?: string;
  media?: TemplateMedia | null;
}

export interface SendTemplateRequest {
  to: string;
  variables?: Record<string, string>;
  quotedMessageId?: string;
  quotedParticipant?: string;
  quotedFromMe?: boolean;
}
