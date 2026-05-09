export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface StatusData {
  status: string;
  instance: string;
}

export interface QrData {
  qr: string;
}

export interface SendData {
  id: string;
}

export interface ContactsData {
  contacts: Contact[];
}

export interface Contact {
  phone: string;
  name: string;
}

export interface NormalizedMessage {
  id: string;
  from: string;
  phone: string;
  pushName: string;
  isGroup: boolean;
  groupId: string | null;
  timestamp: number;
  type: string;
  body: string | null;
}

export interface PollMessagesData {
  messages: NormalizedMessage[];
  cursor: string | null;
  hasMore: boolean;
}

export interface LogData {
  id: string;
  direction: 'incoming' | 'outgoing';
  from: string;
  phone: string;
  pushName: string;
  body: string | null;
  timestamp: number;
  type: string;
}
