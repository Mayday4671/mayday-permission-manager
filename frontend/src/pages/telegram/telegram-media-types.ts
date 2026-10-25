/** Owner-scoped Telegram collection and media responses shared by the list and preview. */
export interface TelegramCollectionTask {
  id: number;
  messageLink: string | null;
  sourceTitle: string | null;
  fromDate: string | null;
  toDate: string | null;
  status: string;
  statusMessage: string;
  maxMessages: number;
  collectedMessages: number;
  scannedMessages: number;
  pendingMediaCount: number;
  includeAlbum: boolean;
  trackingEnabled: boolean;
  liveCheckedAt: string | null;
  liveStatusMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TelegramCollectedMessage {
  id: number;
  telegramMessageId: string;
  senderId: string | null;
  contentType: string | null;
  messageText: string | null;
  canBeSaved: boolean;
  albumId: string | null;
  topicId: string | null;
  metadataJson: string;
  telegramSentAt: string | null;
  telegramEditedAt: string | null;
  media: TelegramCollectedMedia[];
}

export interface TelegramCollectedMedia {
  id: number;
  kind: string;
  fileName: string | null;
  expectedSize: number | null;
  actualSize: number | null;
  mediaType: string | null;
  status: string;
  contentUrl: string | null;
  failureMessage: string | null;
}

export interface TelegramVideoPreviewStatus {
  id: number;
  mediaId: number;
  status: string;
  statusMessage: string;
  durationSeconds: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  transcoded: boolean | null;
  manifestUrl: string | null;
  updatedAt: string;
}

/** Actual source renditions; IDs are scoped to the selected message, never native file handles. */
export interface TelegramVideoQuality {
  id: string;
  width: number;
  height: number;
  codec: string;
  size: number;
}
