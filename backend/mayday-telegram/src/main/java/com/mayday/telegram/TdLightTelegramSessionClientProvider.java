package com.mayday.telegram;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Consumer;

import it.tdlight.ClientFactory;
import it.tdlight.TelegramClient;
import it.tdlight.UpdatesHandler;
import it.tdlight.jni.TdApi;
import it.tdlight.jni.TdApi.File;
import it.tdlight.jni.TdApi.Message;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

/**
 * TDLight low-level adapter that supplies the local database key explicitly.
 *
 * <p>
 * The higher-level SimpleTelegramClient initializer sets the database key to
 * null in this pinned release. This adapter uses the lower-level client
 * protocol so the encrypted-session requirement is preserved and native
 * initialization only occurs after an authorized request invokes open().
 */
@Component
public class TdLightTelegramSessionClientProvider implements TelegramSessionClientProvider
{
    private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory
            .getLogger(TdLightTelegramSessionClientProvider.class);
    private static final long REQUEST_TIMEOUT_SECONDS = 15;
    /**
     * Lets TDLib return Telegram's callback-query timeout before the local guard
     * fires.
     */
    private static final long CALLBACK_ANSWER_TIMEOUT_SECONDS = 45;
    private static final int BLOCK_LIST_PAGE_SIZE = 100;
    private static final int BLOCK_LIST_SCAN_LIMIT = 1_000;
    private final ObjectMapper objectMapper;

    /**
     * Uses the application's configured JSON mapper so event projections match the
     * rest of the platform.
     */
    public TdLightTelegramSessionClientProvider(ObjectMapper objectMapper)
    {
        this.objectMapper = Objects.requireNonNull(objectMapper);
    }

    /**
     * Creates a client only on explicit connection; constructing this Spring bean
     * does not initialize native code.
     */
    @Override
    public TelegramSessionClient open(Path sessionDirectory, TelegramSettings settings,
            Consumer<TelegramSessionUpdate> stateListener, Consumer<TelegramMessageSnapshot> messageListener)
    {
        byte[] databaseKey = settings.sessionEncryptionKey();
        if (databaseKey.length < 32)
        {
            Arrays.fill(databaseKey, (byte) 0);
            throw new IllegalStateException("Telegram 会话加密密钥配置无效");
        }
        TdLightSessionClient sessionClient = null;
        ClientFactory factory = null;
        try
        {
            factory = ClientFactory.create();
            TelegramClient client = factory.createClient();
            sessionClient = new TdLightSessionClient(factory, client, settings, sessionDirectory, databaseKey,
                    stateListener, messageListener, objectMapper);
            sessionClient.initialize();
            return sessionClient;
        } catch (RuntimeException exception)
        {
            Arrays.fill(databaseKey, (byte) 0);
            if (sessionClient != null)
            {
                sessionClient.close();
            } else if (factory != null)
            {
                factory.close();
            }
            throw new IllegalStateException("Telegram 客户端初始化失败，请检查本机 TDLib 运行环境", exception);
        }
    }

    /**
     * Converts validated deployment settings to the selected TDLib proxy variant.
     */
    static TdApi.Proxy configuredProxy(TelegramSettings settings)
    {
        TdApi.ProxyType proxyType = switch (settings.getProxyType())
        {
            case "socks5" -> new TdApi.ProxyTypeSocks5(settings.getProxyUsername(), settings.getProxyPassword());
            case "http" -> new TdApi.ProxyTypeHttp(settings.getProxyUsername(), settings.getProxyPassword(), false);
            case "mtproto" -> new TdApi.ProxyTypeMtproto(settings.getProxySecret());
            default -> throw new IllegalArgumentException("代理类型未通过服务端校验");
        };
        return new TdApi.Proxy(settings.getProxyHost(), settings.getProxyPort(), proxyType);
    }

    /**
     * Owns one TDLib client and translates its authorization events to safe
     * application states.
     */
    static final class TdLightSessionClient implements TelegramSessionClient
    {
        private final java.util.concurrent.Semaphore rangeReaders = new java.util.concurrent.Semaphore(8);
        private final java.util.concurrent.Semaphore[] rangeLocks = java.util.stream.IntStream.range(0, 64)
                .mapToObj(ignored -> new java.util.concurrent.Semaphore(1))
                .toArray(java.util.concurrent.Semaphore[]::new);
        private final ClientFactory factory;
        private final TelegramClient client;
        private final TelegramSettings settings;
        private final Path sessionDirectory;
        private final byte[] databaseKey;
        private final Consumer<TelegramSessionUpdate> stateListener;
        private final Consumer<TelegramMessageSnapshot> messageListener;
        private final ObjectMapper objectMapper;
        private final AtomicBoolean parametersInitializing = new AtomicBoolean();
        private final ThreadPoolExecutor messageEvents = new ThreadPoolExecutor(1, 1, 0, TimeUnit.MILLISECONDS,
                new ArrayBlockingQueue<>(256), runnable -> {
                    Thread thread = new Thread(runnable, "mayday-telegram-message-events");
                    thread.setDaemon(true);
                    return thread;
                }, new ThreadPoolExecutor.AbortPolicy());
        private volatile TelegramAuthorizationState currentState = TelegramAuthorizationState.INITIALIZING;
        private volatile String botChatId;
        private boolean closing;
        private boolean loggedOut;

        TdLightSessionClient(ClientFactory factory, TelegramClient client, TelegramSettings settings,
                Path sessionDirectory, byte[] databaseKey, Consumer<TelegramSessionUpdate> stateListener,
                Consumer<TelegramMessageSnapshot> messageListener, ObjectMapper objectMapper)
        {
            this.factory = Objects.requireNonNull(factory);
            this.client = Objects.requireNonNull(client);
            this.settings = Objects.requireNonNull(settings);
            this.sessionDirectory = Objects.requireNonNull(sessionDirectory);
            this.databaseKey = Objects.requireNonNull(databaseKey);
            this.stateListener = Objects.requireNonNull(stateListener);
            this.messageListener = Objects.requireNonNull(messageListener);
            this.objectMapper = Objects.requireNonNull(objectMapper);
        }

        /**
         * Starts TDLib event processing; request and authorization updates remain
         * asynchronous.
         */
        private void initialize()
        {
            UpdatesHandler updates = received -> received.forEach(update -> {
                if (update instanceof TdApi.Update tdUpdate)
                {
                    handleUpdate(tdUpdate);
                    handleMessageUpdate(tdUpdate);
                }
            });
            client.initialize(updates, this::handleFailure, this::handleFailure);
        }

        /**
         * Resolves only the configured public username syntax. Telegram's returned chat
         * and user are still verified asynchronously before being trusted.
         */
        private String normalizeUsername(String username)
        {
            return TelegramBotUsername.normalize(username);
        }

        /**
         * Captures only messages from the already verified search bot chat and moves
         * serialization/database work off TDLib's native callback thread.
         */
        private void handleMessageUpdate(TdApi.Update update)
        {
            if (update instanceof TdApi.UpdateNewMessage newMessage)
            {
                enqueueSnapshot(newMessage.message, update.getClass().getSimpleName());
            } else if (update instanceof TdApi.UpdateMessageSendSucceeded sent)
            {
                enqueueSnapshot(sent.message, update.getClass().getSimpleName(), Long.toString(sent.oldMessageId));
            } else if (update instanceof TdApi.UpdateMessageSendFailed failed)
            {
                enqueueSnapshot(failed.message, update.getClass().getSimpleName(), Long.toString(failed.oldMessageId),
                        failed.error == null ? null : failed.error.code, sendErrorName(failed.error));
            } else if (update instanceof TdApi.UpdateMessageContent content)
            {
                reloadAndCapture(content.chatId, content.messageId, update.getClass().getSimpleName());
            } else if (update instanceof TdApi.UpdateMessageEdited edited)
            {
                reloadAndCapture(edited.chatId, edited.messageId, update.getClass().getSimpleName());
            }
        }

        /**
         * Loads the canonical message after an edit/content update, without blocking
         * TDLib.
         */
        private void reloadAndCapture(long chatId, long messageId, String updateType)
        {
            if (!isVerifiedBotChat(chatId))
            {
                return;
            }
            client.sendAsync(new TdApi.GetMessage(chatId, messageId)).whenComplete((message, error) -> {
                if (error == null && message != null)
                {
                    enqueueSnapshot(message, updateType);
                }
            });
        }

        /**
         * Enqueues a bot-chat message projection for bounded asynchronous processing.
         */
        private void enqueueSnapshot(TdApi.Message message, String updateType)
        {
            enqueueSnapshot(message, updateType, null);
        }

        /**
         * Moves message projection work away from TDLib's update thread and retains the
         * temporary ID needed to correlate send success/failure updates.
         */
        private void enqueueSnapshot(TdApi.Message message, String updateType, String previousMessageId)
        {
            enqueueSnapshot(message, updateType, previousMessageId, null);
        }

        /**
         * Enqueues an allow-listed message snapshot and numeric send error code. Raw
         * TDLib error text is intentionally omitted because it may contain private
         * request details.
         */
        private void enqueueSnapshot(TdApi.Message message, String updateType, String previousMessageId,
                Integer sendErrorCode)
        {
            enqueueSnapshot(message, updateType, previousMessageId, sendErrorCode, null);
        }

        /**
         * Queues a message with a sanitized symbolic error name for send failures.
         * TDLib error messages are never copied into persistence or user-visible text.
         */
        private void enqueueSnapshot(TdApi.Message message, String updateType, String previousMessageId,
                Integer sendErrorCode, String sendErrorName)
        {
            if (message == null || !isVerifiedBotChat(message.chatId))
            {
                return;
            }
            try
            {
                messageEvents.execute(() -> {
                    try
                    {
                        messageListener.accept(
                                toSnapshot(message, updateType, previousMessageId, sendErrorCode, sendErrorName));
                    } catch (RuntimeException exception)
                    {
                        emit(TelegramAuthorizationState.ERROR, null, "Telegram 消息记录失败，请检查服务端状态");
                    }
                });
            } catch (RejectedExecutionException exception)
            {
                emit(TelegramAuthorizationState.ERROR, null, "Telegram 消息处理队列已满，请稍后重试");
            }
        }

        /**
         * Restricts snapshots to the specific bot chat verified by
         * SearchPublicChat/GetUser.
         */
        private boolean isVerifiedBotChat(long chatId)
        {
            String verifiedChatId = botChatId;
            return verifiedChatId != null && verifiedChatId.equals(Long.toString(chatId));
        }

        /**
         * Builds an explicit allow-listed projection instead of serializing TDLib debug
         * output.
         */
        private TelegramMessageSnapshot toSnapshot(TdApi.Message message, String updateType, String previousMessageId,
                Integer sendErrorCode, String sendErrorName)
        {
            TdApi.MessageReplyToMessage reply = message.replyTo instanceof TdApi.MessageReplyToMessage value
                    ? value
                    : null;
            Long senderId = message.senderId instanceof TdApi.MessageSenderUser user ? user.userId : null;
            String text = messageText(message.content);
            String entityJson = writeJson(messageEntities(message.content));
            String markupJson = writeJson(replyMarkup(message.replyMarkup));
            return new TelegramMessageSnapshot(Long.toString(message.chatId), Long.toString(message.id),
                    senderId == null ? null : Long.toString(senderId), message.isOutgoing, updateType,
                    message.content.getClass().getSimpleName(), text, entityJson, markupJson,
                    reply == null ? null : Long.toString(reply.messageId), (long) message.date,
                    message.editDate == 0 ? null : (long) message.editDate, message.canBeSaved,
                    message.mediaAlbumId == 0 ? null : Long.toString(message.mediaAlbumId), topicId(message),
                    writeJson(attachmentMetadata(message.content)), previousMessageId, sendErrorCode, sendErrorName);
        }

        /** Converts a history result that has no send-update temporary ID. */
        private TelegramMessageSnapshot toSnapshot(TdApi.Message message, String updateType)
        {
            return toSnapshot(message, updateType, null, null, null);
        }

        /**
         * Allows only known symbolic errors into a message snapshot; the raw TDLib
         * message can contain request details and must never be persisted.
         */
        private String sendErrorName(TdApi.Error error)
        {
            return error != null && "YOU_BLOCKED_USER".equals(error.message) ? "YOU_BLOCKED_USER" : null;
        }

        /**
         * Extracts the forum thread identifier without serializing unknown TDLib
         * objects.
         */
        private String topicId(Message message)
        {
            return message.topicId instanceof TdApi.MessageTopicThread thread
                    ? Long.toString(thread.messageThreadId)
                    : null;
        }

        /**
         * Projects known attachment facts and session-bound TDLib file IDs for internal
         * use only.
         */
        private List<Map<String, Object>> attachmentMetadata(TdApi.MessageContent content)
        {
            List<Map<String, Object>> result = new ArrayList<>();
            if (content instanceof TdApi.MessagePhoto photo)
            {
                for (TdApi.PhotoSize size : photo.photo.sizes)
                {
                    addFile(result, "PHOTO", size.photo, null, size.width, size.height, null, false);
                }
            } else if (content instanceof TdApi.MessageVideo video)
            {
                addFile(result, "VIDEO", video.video.video, video.video.fileName, video.video.width, video.video.height,
                        video.video.duration, video.video.supportsStreaming);
            } else if (content instanceof TdApi.MessageDocument document)
            {
                addFile(result, "DOCUMENT", document.document.document, document.document.fileName, null, null, null,
                        false);
            } else if (content instanceof TdApi.MessageAudio audio)
            {
                addFile(result, "AUDIO", audio.audio.audio, audio.audio.fileName, null, null, audio.audio.duration,
                        false);
            } else if (content instanceof TdApi.MessageVoiceNote voice)
            {
                addFile(result, "VOICE", voice.voiceNote.voice, null, null, null, voice.voiceNote.duration, false);
            } else if (content instanceof TdApi.MessageAnimation animation)
            {
                addFile(result, "ANIMATION", animation.animation.animation, animation.animation.fileName,
                        animation.animation.width, animation.animation.height, animation.animation.duration, false);
            }
            if (!result.isEmpty())
            {
                result.getFirst().put("hasThumbnail", TelegramChannelThumbnail.available(content));
            }
            return result;
        }

        /**
         * Adds only documented, bounded metadata; filesystem paths and remote IDs are
         * never persisted.
         */
        private void addFile(List<Map<String, Object>> target, String kind, File file, String fileName, Integer width,
                Integer height, Integer durationSeconds, boolean supportsStreaming)
        {
            if (file == null)
            {
                return;
            }
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("kind", kind);
            item.put("tdFileId", file.id);
            item.put("size", file.size);
            item.put("expectedSize", file.size > 0 ? file.size : file.expectedSize);
            item.put("fileName", fileName);
            item.put("width", width);
            item.put("height", height);
            item.put("durationSeconds", durationSeconds);
            item.put("supportsStreaming", supportsStreaming);
            target.add(item);
        }

        /**
         * Returns text and captions from TDLib message content variants supported by
         * this viewer.
         */
        private String messageText(TdApi.MessageContent content)
        {
            if (content instanceof TdApi.MessageText value)
            {
                return value.text.text;
            }
            TdApi.FormattedText caption = null;
            if (content instanceof TdApi.MessagePhoto value)
            {
                caption = value.caption;
            } else if (content instanceof TdApi.MessageVideo value)
            {
                caption = value.caption;
            } else if (content instanceof TdApi.MessageDocument value)
            {
                caption = value.caption;
            } else if (content instanceof TdApi.MessageAudio value)
            {
                caption = value.caption;
            } else if (content instanceof TdApi.MessageVoiceNote value)
            {
                caption = value.caption;
            } else if (content instanceof TdApi.MessageAnimation value)
            {
                caption = value.caption;
            }
            return caption == null ? null : caption.text;
        }

        /**
         * Projects Telegram text entities into stable JSON fields used by the raw
         * viewer.
         */
        private List<Map<String, Object>> messageEntities(TdApi.MessageContent content)
        {
            TdApi.TextEntity[] entities = content instanceof TdApi.MessageText value
                    ? value.text.entities
                    : content instanceof TdApi.MessagePhoto value
                            ? value.caption.entities
                            : content instanceof TdApi.MessageVideo value
                                    ? value.caption.entities
                                    : content instanceof TdApi.MessageDocument value
                                            ? value.caption.entities
                                            : new TdApi.TextEntity[0];
            List<Map<String, Object>> result = new ArrayList<>();
            for (TdApi.TextEntity entity : entities)
            {
                Map<String, Object> item = new LinkedHashMap<>();
                item.put("offset", entity.offset);
                item.put("length", entity.length);
                item.put("type", entity.type.getClass().getSimpleName());
                if (entity.type instanceof TdApi.TextEntityTypeTextUrl url)
                {
                    item.put("url", url.url);
                }
                result.add(item);
            }
            return result;
        }

        /**
         * Captures inline button labels and safe URL/callback metadata for later
         * server-side actions.
         */
        private List<List<Map<String, Object>>> replyMarkup(TdApi.ReplyMarkup markup)
        {
            if (!(markup instanceof TdApi.ReplyMarkupInlineKeyboard keyboard))
            {
                return List.of();
            }
            List<List<Map<String, Object>>> rows = new ArrayList<>();
            for (TdApi.InlineKeyboardButton[] keyboardRow : keyboard.rows)
            {
                List<Map<String, Object>> row = new ArrayList<>();
                for (TdApi.InlineKeyboardButton button : keyboardRow)
                {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("text", button.text);
                    if (button.type instanceof TdApi.InlineKeyboardButtonTypeUrl url)
                    {
                        item.put("type", "URL");
                        item.put("url", url.url);
                    } else if (button.type instanceof TdApi.InlineKeyboardButtonTypeCallback callback)
                    {
                        item.put("type", "CALLBACK");
                        item.put("data", Base64.getEncoder().encodeToString(callback.data));
                    } else
                    {
                        item.put("type", button.type.getClass().getSimpleName());
                    }
                    row.add(item);
                }
                rows.add(row);
            }
            return rows;
        }

        /**
         * Encodes bounded known fields as JSON; serialization failure is never replaced
         * with TDLib debug text.
         */
        private String writeJson(Object value)
        {
            try
            {
                return objectMapper.writeValueAsString(value);
            } catch (JacksonException exception)
            {
                throw new IllegalStateException("无法序列化 Telegram 消息字段");
            }
        }

        /**
         * Resolves the configured username and verifies Telegram identifies it as a bot
         * before storing its chat ID. Resolution is read-only: a local conversation
         * must not restart the remote bot or inject a welcome reply before the keyword.
         */
        @Override
        public CompletableFuture<TelegramBotChat> resolveBot(String username)
        {
            String normalized = normalizeUsername(username);
            return client.sendAsync(new TdApi.SearchPublicChat(normalized)).thenCompose(chat -> {
                if (!(chat.type instanceof TdApi.ChatTypePrivate privateChat))
                {
                    return CompletableFuture.failedFuture(new IllegalStateException("配置的搜索账号不是私聊机器人"));
                }
                return client.sendAsync(new TdApi.GetUser(privateChat.userId)).thenApply(user -> {
                    if (!(user.type instanceof TdApi.UserTypeBot))
                    {
                        throw new IllegalStateException("配置的搜索账号不是 Telegram 机器人");
                    }
                    String verifiedChatId = Long.toString(chat.id);
                    String botUserId = Long.toString(privateChat.userId);
                    botChatId = verifiedChatId;
                    return new TelegramBotChat(verifiedChatId, normalized, botUserId);
                });
            }).orTimeout(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        }

        /**
         * Reads the active Telegram user, verifies the configured public bot and
         * inspects its existing chat state. This diagnostic never starts the bot, sends
         * a message or changes the account's block list.
         */
        @Override
        public CompletableFuture<TelegramBotSessionDiagnostic> inspectBotSession(String username)
        {
            String normalized = normalizeUsername(username);
            return client.sendAsync(new TdApi.GetMe()).thenCompose(currentUser -> {
                return client.sendAsync(new TdApi.SearchPublicChat(normalized)).thenCompose(chat -> {
                    if (!(chat.type instanceof TdApi.ChatTypePrivate privateChat))
                    {
                        return CompletableFuture.failedFuture(new IllegalStateException("配置的搜索账号不是私聊机器人"));
                    }
                    return client.sendAsync(new TdApi.GetUser(privateChat.userId)).thenCompose(bot -> {
                        if (!(bot.type instanceof TdApi.UserTypeBot))
                        {
                            return CompletableFuture.failedFuture(new IllegalStateException("配置的搜索账号不是 Telegram 机器人"));
                        }
                        return client.sendAsync(new TdApi.GetChat(chat.id)).thenCompose(currentChat -> {
                            if (!(currentChat.type instanceof TdApi.ChatTypePrivate currentPrivateChat)
                                    || currentPrivateChat.userId != bot.id)
                            {
                                throw new IllegalStateException("Telegram 返回的机器人私聊身份不一致");
                            }
                            String cachedBlockListType = currentChat.blockList == null
                                    ? "NONE"
                                    : currentChat.blockList.getClass().getSimpleName();
                            return findMainBlockListStatus(bot.id, 0).thenApply(onlineBlockListStatus -> {
                                return new TelegramBotSessionDiagnostic(Long.toString(currentUser.id), normalized,
                                        Long.toString(bot.id), Long.toString(currentChat.id), cachedBlockListType,
                                        onlineBlockListStatus);
                            });
                        });
                    });
                });
            }).orTimeout(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        }

        /**
         * Checks whether one verified bot ID appears in the current account's online
         * main block list. Only the match result leaves this method; blocked sender IDs
         * are never persisted or returned to the caller.
         *
         * <p>
         * Telegram returns the list in pages of at most 100 senders. The scan is
         * bounded to 1,000 entries so a very large personal block list cannot make the
         * page diagnostic unbounded. An incomplete scan is reported explicitly.
         *
         * @param botUserId
         *            the verified configured bot ID to check
         * @param offset
         *            number of senders already inspected
         * @return BLOCKED, NOT_BLOCKED, or INCOMPLETE
         */
        private CompletableFuture<String> findMainBlockListStatus(long botUserId, int offset)
        {
            TdApi.GetBlockedMessageSenders request = new TdApi.GetBlockedMessageSenders(new TdApi.BlockListMain(),
                    offset, BLOCK_LIST_PAGE_SIZE);
            return client.sendAsync(request).thenCompose(page -> {
                TdApi.MessageSender[] senders = page.senders == null ? new TdApi.MessageSender[0] : page.senders;
                for (TdApi.MessageSender sender : senders)
                {
                    if (sender instanceof TdApi.MessageSenderUser blockedUser && blockedUser.userId == botUserId)
                    {
                        return CompletableFuture.completedFuture("BLOCKED");
                    }
                }
                int nextOffset = offset + senders.length;
                if (nextOffset >= page.totalCount)
                {
                    return CompletableFuture.completedFuture("NOT_BLOCKED");
                }
                if (senders.length == 0 || nextOffset >= BLOCK_LIST_SCAN_LIMIT)
                {
                    return CompletableFuture.completedFuture("INCOMPLETE");
                }
                return findMainBlockListStatus(botUserId, nextOffset);
            });
        }

        /**
         * Searches Telegram's known chats and returns only channels, never private
         * chats or groups.
         */
        @Override
        public CompletableFuture<List<TelegramChannelOption>> searchChannels(String query, int limit)
        {
            String normalized = query == null ? "" : query.trim();
            if (normalized.isEmpty() || normalized.length() > 100 || limit < 1 || limit > 50)
            {
                return CompletableFuture.failedFuture(new IllegalArgumentException("频道搜索词或结果数量无效"));
            }
            return client.sendAsync(new TdApi.SearchChats(normalized, null, limit))
                    .orTimeout(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS).thenCompose(chats -> {
                        List<CompletableFuture<TelegramChannelOption>> lookups = Arrays.stream(chats.chatIds)
                                .mapToObj(
                                        chatId -> resolveChannel(Long.toString(chatId)).exceptionally(ignored -> null))
                                .toList();
                        return CompletableFuture.allOf(lookups.toArray(CompletableFuture[]::new))
                                .thenApply(ignored -> lookups.stream().map(CompletableFuture::join)
                                        .filter(Objects::nonNull).limit(limit).toList());
                    });
        }

        /**
         * Loads bounded chat batches; archive traversal starts after the main list
         * ends.
         */
        @Override
        public CompletableFuture<TelegramChannelBrowserService.ChannelPage> browseChannels(String cursor)
        {
            if (cursor == null || !cursor.matches("[01]:[0-9]{1,5}"))
            {
                return CompletableFuture.failedFuture(new IllegalArgumentException("频道分页游标无效"));
            }
            String[] parts = cursor.split(":");
            int list = Integer.parseInt(parts[0]);
            int offset = Integer.parseInt(parts[1]);
            TdApi.ChatList chatList = list == 0 ? new TdApi.ChatListMain() : new TdApi.ChatListArchive();
            return loadChannelBatch(chatList, list, offset, 0);
        }

        private CompletableFuture<TelegramChannelBrowserService.ChannelPage> loadChannelBatch(TdApi.ChatList chatList,
                int list, int offset, int attempt)
        {
            return client.sendAsync(new TdApi.LoadChats(chatList, 100)).handle((ok, failure) -> {
                if (failure == null)
                {
                    return false;
                }
                Throwable cause = failure;
                while (cause.getCause() != null)
                {
                    cause = cause.getCause();
                }
                if (cause instanceof it.tdlight.client.TelegramError error && error.getErrorCode() == 404)
                {
                    return true;
                }
                throw new java.util.concurrent.CompletionException(failure);
            }).thenCompose(
                    exhausted -> client.sendAsync(new TdApi.GetChats(chatList, offset + 101)).thenCompose(chats -> {
                        if (!exhausted && chats.chatIds.length <= offset)
                        {
                            if (attempt >= 2)
                            {
                                return CompletableFuture.failedFuture(new IllegalStateException("频道目录尚未同步，请重试"));
                            }
                            return loadChannelBatch(chatList, list, offset, attempt + 1);
                        }
                        int end = Math.min(chats.chatIds.length, offset + 100);
                        List<CompletableFuture<TelegramChannelOption>> lookups = Arrays.stream(chats.chatIds)
                                .skip(offset).limit(100)
                                .mapToObj(id -> client.sendAsync(new TdApi.GetChat(id)).thenCompose(chat -> {
                                    if (!(chat.type instanceof TdApi.ChatTypeSupergroup group))
                                    {
                                        return CompletableFuture.<TelegramChannelOption>completedFuture(null);
                                    }
                                    return client.sendAsync(new TdApi.GetSupergroup(group.supergroupId))
                                            .thenApply(channel -> {
                                                if (!channel.isChannel
                                                        || !TelegramChannelMembership.isJoined(channel.status))
                                                {
                                                    return null;
                                                }
                                                String username = channel.usernames == null
                                                        || channel.usernames.activeUsernames.length == 0
                                                                ? null
                                                                : channel.usernames.activeUsernames[0];
                                                return new TelegramChannelOption(Long.toString(chat.id), chat.title,
                                                        username);
                                            });
                                })).toList();
                        String next = exhausted && chats.chatIds.length <= end
                                ? (list == 0 ? "1:0" : null)
                                : list + ":" + end;
                        return CompletableFuture.allOf(lookups.toArray(CompletableFuture[]::new))
                                .thenApply(ignored -> new TelegramChannelBrowserService.ChannelPage(
                                        lookups.stream().map(CompletableFuture::join).filter(Objects::nonNull).toList(),
                                        next));
                    })).orTimeout(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        }

        /** Asks Telegram for the public or private permalink for one channel post. */
        @Override
        public CompletableFuture<String> messageLink(String chatId, String messageId)
        {
            TdApi.GetMessageLink request = new TdApi.GetMessageLink();
            request.chatId = Long.parseLong(chatId);
            request.messageId = Long.parseLong(messageId);
            request.forAlbum = false;
            return client.sendAsync(request).orTimeout(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                    .thenApply(link -> link.link);
        }

        /**
         * Fetches a source thumbnail only; browsing never queues a collection or a full
         * media transfer.
         */
        @Override
        public CompletableFuture<byte[]> channelThumbnail(String chatId, String messageId)
        {
            return client.sendAsync(new TdApi.GetMessage(Long.parseLong(chatId), Long.parseLong(messageId)))
                    .thenCompose(message -> {
                        if (!message.canBeSaved)
                        {
                            return CompletableFuture.failedFuture(new IllegalArgumentException("原消息限制读取媒体"));
                        }
                        TdApi.File thumbnail = TelegramChannelThumbnail.fileFor(message.content);
                        if (thumbnail == null)
                        {
                            byte[] embedded = TelegramChannelThumbnail.embedded(message.content);
                            return embedded == null
                                    ? CompletableFuture.failedFuture(new IllegalArgumentException("原消息没有缩略图"))
                                    : CompletableFuture.completedFuture(embedded);
                        }
                        return downloadFile(thumbnail.id, TelegramChannelThumbnail.MAX_BYTES, true).thenApply(file -> {
                            try
                            {
                                return Files.readAllBytes(file.path());
                            } catch (java.io.IOException exception)
                            {
                                throw new IllegalStateException("缩略图读取失败", exception);
                            }
                        });
                    }).orTimeout(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS).whenComplete((bytes, failure) -> {
                        if (failure == null)
                            return;
                        Throwable cause = failure;
                        while (cause.getCause() != null)
                            cause = cause.getCause();
                        String reason = cause.getMessage();
                        boolean known = reason != null && (reason.matches("[A-Z_]{1,80}")
                                || List.of("原消息限制读取媒体", "原消息没有缩略图", "Telegram 附件未能完整下载", "Telegram 返回的附件路径不在受控目录内",
                                        "Telegram 附件超过本机单文件大小限制").contains(reason));
                        // Log only an allow-listed failure code, never message contents or private file
                        // paths.
                        LOG.warn("Channel thumbnail failed: type={}, code={}, reason={}",
                                cause.getClass().getSimpleName(),
                                cause instanceof it.tdlight.client.TelegramError error ? error.getErrorCode() : 0,
                                known ? reason : "UNCLASSIFIED");
                    });
        }

        /**
         * Verifies that a selected identifier is a channel in the user's accessible
         * chat list.
         */
        @Override
        public CompletableFuture<TelegramChannelOption> resolveChannel(String chatId)
        {
            final long parsed;
            try
            {
                parsed = Long.parseLong(chatId);
            } catch (NumberFormatException exception)
            {
                return CompletableFuture.failedFuture(new IllegalArgumentException("Telegram 频道标识无效"));
            }
            return client.sendAsync(new TdApi.GetChat(parsed)).thenCompose(chat -> {
                if (!(chat.type instanceof TdApi.ChatTypeSupergroup channelChat))
                {
                    return CompletableFuture.failedFuture(new IllegalArgumentException("所选会话不是可访问的频道"));
                }
                return client.sendAsync(new TdApi.GetSupergroup(channelChat.supergroupId)).thenApply(channel -> {
                    if (!channel.isChannel || !TelegramChannelMembership.isJoined(channel.status))
                    {
                        throw new IllegalArgumentException("所选会话不是当前账号已加入的频道");
                    }
                    String username = channel.usernames == null || channel.usernames.activeUsernames.length == 0
                            ? null
                            : channel.usernames.activeUsernames[0];
                    return new TelegramChannelOption(Long.toString(chat.id), chat.title, username);
                });
            }).orTimeout(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS);
        }

        /**
         * Sends plain search text to the chat verified by resolveBot; arbitrary
         * destinations are rejected.
         */
        @Override
        public CompletableFuture<String> sendSearchText(String chatId, String query)
        {
            if (botChatId == null || !botChatId.equals(chatId))
            {
                return CompletableFuture.failedFuture(new IllegalStateException("搜索机器人会话已失效，请重新解析"));
            }
            TdApi.InputMessageText content = new TdApi.InputMessageText();
            content.text = new TdApi.FormattedText(query, new TdApi.TextEntity[0]);
            TdApi.SendMessage request = new TdApi.SendMessage();
            request.chatId = Long.parseLong(chatId);
            request.inputMessageContent = content;
            return client.sendAsync(request).orTimeout(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                    .thenApply(message -> Long.toString(message.id));
        }

        /**
         * Requests the answer for one validated callback on the already verified bot
         * chat. TDLib delivers any resulting message edits through the regular update
         * listener, where they are persisted with their original message ID.
         */
        @Override
        public CompletableFuture<TelegramCallbackAnswer> activateCallback(String chatId, String messageId,
                byte[] callbackData)
        {
            long verifiedChatId = Long.parseLong(chatId);
            long verifiedMessageId = Long.parseLong(messageId);
            if (!isVerifiedBotChat(verifiedChatId) || callbackData == null || callbackData.length == 0
                    || callbackData.length > 64)
            {
                return CompletableFuture.failedFuture(new IllegalArgumentException("Telegram 回调参数无效"));
            }
            byte[] payload = callbackData.clone();
            TdApi.GetCallbackQueryAnswer request = new TdApi.GetCallbackQueryAnswer(verifiedChatId, verifiedMessageId,
                    new TdApi.CallbackQueryPayloadData(payload));
            return client.sendAsync(request).orTimeout(CALLBACK_ANSWER_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                    .thenApply(answer -> new TelegramCallbackAnswer(answer.text, answer.showAlert, answer.url))
                    .whenComplete((answer, error) -> Arrays.fill(payload, (byte) 0));
        }

        /**
         * Resolves public/private links only through the active user's authorized TDLib
         * session.
         */
        @Override
        public CompletableFuture<TelegramMessageLink> resolveMessageLink(String messageLink)
        {
            TdApi.GetMessageLinkInfo request = new TdApi.GetMessageLinkInfo(messageLink);
            return client.sendAsync(request).orTimeout(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS).thenApply(info -> {
                if (info.message == null)
                {
                    throw new IllegalArgumentException("LINK_MESSAGE_UNAVAILABLE");
                }
                if (!info.message.canBeSaved)
                {
                    throw new IllegalArgumentException("LINK_MESSAGE_PROTECTED");
                }
                return new TelegramMessageLink(Long.toString(info.message.chatId), Long.toString(info.message.id),
                        info.isPublic, toSnapshot(info.message, "GetMessageLinkInfo"));
            });
        }

        /** Resolves one album without replacing the authoritative link snapshot. */
        @Override
        public CompletableFuture<List<TelegramMessageSnapshot>> getMessageAlbum(TelegramMessageSnapshot anchor)
        {
            return TelegramMessageAlbumReader.read(this, anchor).orTimeout(40, TimeUnit.SECONDS);
        }

        /**
         * Reads a strictly bounded history page; the caller controls progress and
         * replay safety.
         */
        @Override
        public CompletableFuture<List<TelegramMessageSnapshot>> getChatHistory(String chatId, String fromMessageId,
                int limit)
        {
            if (limit < 1 || limit > 100)
            {
                return CompletableFuture.failedFuture(new IllegalArgumentException("Telegram 历史分页数量超出限制"));
            }
            TdApi.GetChatHistory request = new TdApi.GetChatHistory(Long.parseLong(chatId),
                    Long.parseLong(fromMessageId), 0, limit, false);
            return client.sendAsync(request).orTimeout(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS).thenApply(page -> {
                if (!(page instanceof TdApi.Messages history))
                {
                    throw new IllegalStateException("Telegram 未返回消息历史");
                }
                List<TelegramMessageSnapshot> result = new ArrayList<>(history.messages.length);
                for (Message message : history.messages)
                {
                    result.add(toSnapshot(message, "GetChatHistory"));
                }
                return List.copyOf(result);
            });
        }

        /**
         * Resolves the newest message not after a date; only a native 404 means no
         * match.
         */
        @Override
        public CompletableFuture<String> channelMessageAtDate(String chatId, int timestamp)
        {
            return client.sendAsync(new TdApi.GetChatMessageByDate(Long.parseLong(chatId), timestamp))
                    .orTimeout(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS).handle((message, failure) -> {
                        if (failure == null)
                            return Long.toString(message.id);
                        Throwable cause = failure;
                        while (cause.getCause() != null)
                            cause = cause.getCause();
                        if (cause instanceof it.tdlight.client.TelegramError error && error.getErrorCode() == 404)
                            return null;
                        throw new java.util.concurrent.CompletionException(failure);
                    });
        }

        /** Preserves Telegram's continuation cursor, including short search pages. */
        @Override
        public CompletableFuture<TelegramChannelBrowserService.SearchBatch> searchChannelMessages(String chatId,
                String query, String mediaType, String cursor)
        {
            TdApi.SearchChatMessages request = new TdApi.SearchChatMessages();
            request.chatId = Long.parseLong(chatId);
            request.query = query;
            request.fromMessageId = Long.parseLong(cursor);
            request.limit = 20;
            request.filter = switch (mediaType)
            {
                case "PHOTO" -> new TdApi.SearchMessagesFilterPhoto();
                case "VIDEO" -> new TdApi.SearchMessagesFilterVideo();
                case "DOCUMENT" -> new TdApi.SearchMessagesFilterDocument();
                case "AUDIO" -> new TdApi.SearchMessagesFilterAudio();
                case "LINK" -> new TdApi.SearchMessagesFilterUrl();
                default -> new TdApi.SearchMessagesFilterEmpty();
            };
            return client.sendAsync(request).orTimeout(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                    .thenApply(found -> new TelegramChannelBrowserService.SearchBatch(
                            Arrays.stream(found.messages).map(item -> toSnapshot(item, "SearchChatMessages")).toList(),
                            found.nextFromMessageId == 0 ? null : Long.toString(found.nextFromMessageId)));
        }

        /**
         * Uses TDLib's documented negative offset to inspect messages newer than the
         * saved live cursor.
         */
        @Override
        public CompletableFuture<List<TelegramMessageSnapshot>> getNewerChatHistory(String chatId, String fromMessageId,
                int limit)
        {
            if (limit < 1 || limit > 100)
            {
                return CompletableFuture.failedFuture(new IllegalArgumentException("Telegram 追赶分页数量超出限制"));
            }
            int offset = "0".equals(fromMessageId) ? 0 : -(limit - 1);
            TdApi.GetChatHistory request = new TdApi.GetChatHistory(Long.parseLong(chatId),
                    Long.parseLong(fromMessageId), offset, limit, false);
            return client.sendAsync(request).orTimeout(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS).thenApply(page -> {
                if (!(page instanceof TdApi.Messages history))
                {
                    throw new IllegalStateException("Telegram 未返回频道追赶消息");
                }
                List<TelegramMessageSnapshot> result = new ArrayList<>(history.messages.length);
                for (Message message : history.messages)
                {
                    result.add(toSnapshot(message, "GetChatHistoryCatchUp"));
                }
                return List.copyOf(result);
            });
        }

        /**
         * Downloads only a bounded file selected from an accessible, saveable message.
         * TDLib writes into the configured private files directory; the adapter then
         * verifies the resulting path before returning it to the storage service.
         */
        @Override
        public CompletableFuture<TelegramDownloadedFile> downloadFile(int fileId, long maxBytes)
        {
            return downloadFile(fileId, maxBytes, false);
        }

        private CompletableFuture<TelegramDownloadedFile> downloadFile(int fileId, long maxBytes, boolean thumbnail)
        {
            if (fileId <= 0 || maxBytes <= 0)
            {
                return CompletableFuture.failedFuture(new IllegalArgumentException("Telegram 附件下载参数无效"));
            }
            long byteLimit = maxBytes;
            TdApi.DownloadFile request = new TdApi.DownloadFile(fileId, 32, 0,
                    byteLimit == Long.MAX_VALUE ? byteLimit : byteLimit + 1, true);
            return client.sendAsync(request).thenApply(file -> {
                try
                {
                    if (file == null || file.local == null || !file.local.isDownloadingCompleted
                            || file.local.path == null || file.local.path.isBlank())
                    {
                        throw new IllegalStateException("Telegram 附件未能完整下载");
                    }
                    return TelegramDownloadedFile.checked(sessionDirectory, file.local.path, byteLimit, thumbnail);
                } catch (java.io.IOException exception)
                {
                    throw new IllegalStateException("无法安全读取 Telegram 附件", exception);
                }
            });
        }

        /**
         * Queries TDLib rather than trusting a message's estimated size for HTTP
         * ranges.
         */
        @Override
        public CompletableFuture<Long> fileSize(int fileId)
        {
            return client.sendAsync(new TdApi.GetFile(fileId)).orTimeout(15, TimeUnit.SECONDS).thenApply(file -> {
                if (file.size <= 0)
                {
                    throw new IllegalStateException("Telegram 尚未提供视频大小，请稍后重试");
                }
                return file.size;
            });
        }

        /**
         * Refreshes the exact source message before trusting a session-local file
         * handle.
         */
        @Override
        public CompletableFuture<Integer> resolveMediaFile(String messageLink, String chatId, String messageId,
                int attachmentIndex)
        {
            return resolveStoredMessage(messageLink, chatId, messageId).thenApply(source -> {
                List<Map<String, Object>> attachments = attachmentMetadata(source.content);
                if (attachmentIndex < 0 || attachmentIndex >= attachments.size())
                {
                    throw new IllegalStateException("视频附件已发生变化，请重新读取原消息");
                }
                Object value = attachments.get(attachmentIndex).get("tdFileId");
                if (!(value instanceof Number number) || number.intValue() <= 0)
                {
                    throw new IllegalStateException("视频附件已失效");
                }
                return number.intValue();
            });
        }

        /**
         * Reads alternate qualities from the same verified source as original playback.
         */
        @Override
        public CompletableFuture<List<TelegramVideoQuality>> videoQualities(String messageLink, String chatId,
                String messageId)
        {
            return resolveStoredMessage(messageLink, chatId, messageId)
                    .thenApply(source -> TelegramVideoQuality.from(source.content));
        }

        /**
         * Reconnecting may require resolving the permalink before the stored message is
         * readable.
         */
        private CompletableFuture<TdApi.Message> resolveStoredMessage(String messageLink, String chatId,
                String messageId)
        {
            long chat = Long.parseLong(chatId);
            long message = Long.parseLong(messageId);
            return client.sendAsync(new TdApi.GetMessage(chat, message)).exceptionallyCompose(
                    failure -> client.sendAsync(new TdApi.GetMessageLinkInfo(messageLink)).thenCompose(info -> {
                        if (info.message == null || info.message.chatId != chat)
                        {
                            return CompletableFuture.failedFuture(new IllegalStateException("视频来源已失效"));
                        }
                        return info.message.id == message
                                ? CompletableFuture.completedFuture(info.message)
                                : client.sendAsync(new TdApi.GetMessage(chat, message));
                    })).orTimeout(20, TimeUnit.SECONDS).thenApply(source -> {
                        if (!source.canBeSaved || source.chatId != chat || source.id != message)
                        {
                            throw new IllegalStateException("视频来源禁止保存或访问");
                        }
                        return source;
                    });
        }

        /**
         * Downloads only the requested window and copies at most one MiB from TDLib's
         * verified cache. Per-file locks prevent simultaneous seeks from replacing each
         * other's native download window; existing complete downloads are not
         * cancelled.
         */
        @Override
        public CompletableFuture<byte[]> readFileRange(int fileId, long offset, int count)
        {
            if (fileId <= 0 || offset < 0 || count < 1 || count > 1024 * 1024)
            {
                return CompletableFuture.failedFuture(new IllegalArgumentException("视频分段参数无效"));
            }
            if (!rangeReaders.tryAcquire())
            {
                return CompletableFuture.failedFuture(new IllegalStateException("视频读取繁忙，请稍后重试"));
            }
            CompletableFuture<byte[]> result = new CompletableFuture<>();
            Thread.startVirtualThread(() -> {
                java.util.concurrent.Semaphore lock = rangeLocks[fileId % rangeLocks.length];
                boolean acquired = false;
                try
                {
                    acquired = lock.tryAcquire(30, TimeUnit.SECONDS);
                    if (!acquired || closing)
                    {
                        throw new IllegalStateException("视频读取繁忙或账号已断开");
                    }
                    TdApi.File file = client.sendAsync(new TdApi.GetFile(fileId)).get(15, TimeUnit.SECONDS);
                    if (file.size <= offset || count > file.size - offset)
                    {
                        throw new IllegalArgumentException("视频分段超出文件大小");
                    }
                    long available = client.sendAsync(new TdApi.GetFileDownloadedPrefixSize(fileId, offset)).get(15,
                            TimeUnit.SECONDS).size;
                    if (available < count && !file.local.isDownloadingActive)
                    {
                        if (Files.getFileStore(sessionDirectory).getUsableSpace() < count
                                + Math.max(64L * 1024 * 1024, settings.getMinimumFreeDiskBytes()))
                        {
                            throw new IllegalStateException("视频缓存空间不足");
                        }
                        client.sendAsync(new TdApi.DownloadFile(fileId, 32, offset, count, false)).get(15,
                                TimeUnit.SECONDS);
                    }
                    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
                    while (available < count)
                    {
                        if (closing || result.isCancelled() || System.nanoTime() >= deadline)
                        {
                            throw new IllegalStateException("视频分段加载超时，请重试");
                        }
                        Thread.sleep(100);
                        available = client.sendAsync(new TdApi.GetFileDownloadedPrefixSize(fileId, offset)).get(5,
                                TimeUnit.SECONDS).size;
                        // A small metadata window may still be finishing when a seek
                        // arrives. Extend it once idle without cancelling a full download.
                        if (available < count)
                        {
                            file = client.sendAsync(new TdApi.GetFile(fileId)).get(5, TimeUnit.SECONDS);
                            if (!file.local.isDownloadingActive)
                            {
                                if (Files.getFileStore(sessionDirectory).getUsableSpace() < count
                                        + Math.max(64L * 1024 * 1024, settings.getMinimumFreeDiskBytes()))
                                {
                                    throw new IllegalStateException("视频缓存空间不足");
                                }
                                client.sendAsync(new TdApi.DownloadFile(fileId, 32, offset, count, false)).get(5,
                                        TimeUnit.SECONDS);
                            }
                        }
                    }
                    byte[] bytes = client.sendAsync(new TdApi.ReadFilePart(fileId, offset, count)).get(15,
                            TimeUnit.SECONDS).data;
                    if (bytes.length != count)
                    {
                        throw new IllegalStateException("视频分段不完整");
                    }
                    result.complete(bytes);
                } catch (Exception exception)
                {
                    if (exception instanceof InterruptedException)
                    {
                        Thread.currentThread().interrupt();
                    }
                    result.completeExceptionally(new IllegalStateException("视频分段读取失败，请检查账号连接后重试"));
                } finally
                {
                    if (acquired)
                    {
                        lock.release();
                    }
                    rangeReaders.release();
                }
            });
            return result;
        }

        /** Requests native cancellation when the owning bounded worker times out. */
        @Override
        public void cancelDownloadFile(int fileId)
        {
            if (fileId > 0 && !closing)
            {
                client.sendAsync(new TdApi.CancelDownloadFile(fileId, false));
            }
        }

        /**
         * Handles only known authorization states; unknown future TDLib states are
         * surfaced as unsupported.
         */
        private void handleUpdate(TdApi.Update update)
        {
            if (!(update instanceof TdApi.UpdateAuthorizationState authorizationUpdate))
            {
                return;
            }
            TdApi.AuthorizationState state = authorizationUpdate.authorizationState;
            if (state instanceof TdApi.AuthorizationStateWaitTdlibParameters)
            {
                initializeParameters();
            } else if (state instanceof TdApi.AuthorizationStateWaitPhoneNumber)
            {
                if (loggedOut)
                {
                    emit(TelegramAuthorizationState.LOGGED_OUT, null);
                    close();
                } else
                {
                    emit(TelegramAuthorizationState.WAITING_FOR_PHONE, null);
                }
            } else if (state instanceof TdApi.AuthorizationStateWaitCode)
            {
                emit(TelegramAuthorizationState.WAITING_FOR_CODE, null);
            } else if (state instanceof TdApi.AuthorizationStateWaitPassword)
            {
                emit(TelegramAuthorizationState.WAITING_FOR_PASSWORD, null);
            } else if (state instanceof TdApi.AuthorizationStateWaitEmailAddress)
            {
                emit(TelegramAuthorizationState.WAITING_FOR_EMAIL_ADDRESS, null);
            } else if (state instanceof TdApi.AuthorizationStateWaitEmailCode)
            {
                emit(TelegramAuthorizationState.WAITING_FOR_EMAIL_CODE, null);
            } else if (state instanceof TdApi.AuthorizationStateWaitRegistration)
            {
                emit(TelegramAuthorizationState.WAITING_FOR_REGISTRATION, null);
            } else if (state instanceof TdApi.AuthorizationStateWaitOtherDeviceConfirmation)
            {
                emit(TelegramAuthorizationState.WAITING_FOR_DEVICE_CONFIRMATION, null);
            } else if (state instanceof TdApi.AuthorizationStateReady)
            {
                loadAuthorizedUser();
            } else if (state instanceof TdApi.AuthorizationStateClosing)
            {
                emit(TelegramAuthorizationState.CLOSING, null);
            } else if (state instanceof TdApi.AuthorizationStateClosed)
            {
                emit(loggedOut ? TelegramAuthorizationState.LOGGED_OUT : TelegramAuthorizationState.CLOSED, null);
                releaseFactory();
            } else
            {
                emit(TelegramAuthorizationState.UNSUPPORTED, null);
            }
        }

        /**
         * Sends validated TDLib configuration including the mandatory non-empty local
         * encryption key.
         */
        private void initializeParameters()
        {
            if (!parametersInitializing.compareAndSet(false, true))
            {
                return;
            }
            if (settings.isProxyEnabled())
            {
                // TDLib queues AddProxy while it is waiting for SetTdlibParameters.
                // Do not wait for that queued request here: sending the parameters is
                // what lets TDLib finish initialization and process the proxy request.
                TdApi.Proxy proxy = configuredProxy(settings);
                client.sendAsync(new TdApi.AddProxy(proxy, true, ""))
                        .orTimeout(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS).whenComplete((addedProxy, error) -> {
                            if (error != null || addedProxy == null)
                            {
                                emit(TelegramAuthorizationState.ERROR, null, "Telegram 代理未能连接，请检查部署代理地址、端口和认证信息");
                                return;
                            }
                        });
            }
            sendTdlibParameters();
        }

        /**
         * Sends encrypted initialization parameters, allowing TDLib to process queued
         * preauthorization requests.
         */
        private void sendTdlibParameters()
        {
            TdApi.SetTdlibParameters parameters = new TdApi.SetTdlibParameters();
            parameters.useTestDc = false;
            parameters.databaseDirectory = sessionDirectory.resolve("database").toString();
            parameters.filesDirectory = sessionDirectory.resolve("files").toString();
            parameters.databaseEncryptionKey = databaseKey.clone();
            parameters.useFileDatabase = true;
            parameters.useChatInfoDatabase = true;
            parameters.useMessageDatabase = true;
            parameters.useSecretChats = false;
            parameters.apiId = Integer.parseInt(settings.getApiId());
            parameters.apiHash = settings.getApiHash();
            parameters.systemLanguageCode = "zh-hans";
            parameters.deviceModel = "Mayday Server";
            parameters.systemVersion = System.getProperty("os.name", "unknown");
            parameters.applicationVersion = "Mayday";
            client.send(parameters, result -> {
                Arrays.fill(databaseKey, (byte) 0);
                Arrays.fill(parameters.databaseEncryptionKey, (byte) 0);
                if (result instanceof TdApi.Error)
                {
                    emit(TelegramAuthorizationState.ERROR, null);
                }
            }, ignored -> {
                Arrays.fill(databaseKey, (byte) 0);
                Arrays.fill(parameters.databaseEncryptionKey, (byte) 0);
                emit(TelegramAuthorizationState.ERROR, null);
            });
        }

        /**
         * Resolves the authenticated TDLib identity without exposing profile details or
         * credentials in logs.
         */
        private void loadAuthorizedUser()
        {
            client.sendAsync(new TdApi.GetMe()).orTimeout(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                    .whenComplete((user, error) -> {
                        if (error != null || user == null)
                        {
                            emit(TelegramAuthorizationState.ERROR, null);
                        } else
                        {
                            emit(TelegramAuthorizationState.READY, user.id);
                        }
                    });
        }

        /**
         * Submits one asynchronous TDLib function and translates every failure to a
         * safe fixed state.
         */
        private void submit(TdApi.Function<?> function)
        {
            client.sendAsync(function).orTimeout(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                    .whenComplete((response, error) -> {
                        if (error != null || response instanceof TdApi.Error)
                        {
                            String feedback = response instanceof TdApi.Error telegramError
                                    ? TelegramAuthorizationFeedback.rejected(telegramError.code, telegramError.message)
                                    : TelegramAuthorizationFeedback.failed(error);
                            emit(currentState, null, feedback);
                        }
                    });
        }

        /**
         * Emits an immutable, non-secret update to the serialized account coordinator.
         */
        private void emit(TelegramAuthorizationState state, Long telegramUserId)
        {
            emit(state, telegramUserId, null);
        }

        /**
         * Emits a fixed safe message for a rejected challenge without losing the active
         * authorization step.
         */
        private void emit(TelegramAuthorizationState state, Long telegramUserId, String message)
        {
            currentState = state;
            stateListener.accept(new TelegramSessionUpdate(state, telegramUserId, message));
        }

        /**
         * Avoids logging native errors because lower layers may include phone numbers
         * or request values.
         */
        private void handleFailure(Throwable ignored)
        {
            emit(TelegramAuthorizationState.ERROR, null);
        }

        /** Releases the native factory once TDLib reports its closed state. */
        private synchronized void releaseFactory()
        {
            if (!closing)
            {
                closing = true;
                Arrays.fill(databaseKey, (byte) 0);
                factory.close();
            }
        }

        /**
         * Submits a phone number; the caller must already have validated and authorized
         * this challenge.
         */
        @Override
        public void submitPhoneNumber(String phoneNumber)
        {
            submit(new TdApi.SetAuthenticationPhoneNumber(phoneNumber, new TdApi.PhoneNumberAuthenticationSettings()));
        }

        /**
         * Submits a one-time code without retaining it after the asynchronous function
         * is handed to TDLib.
         */
        @Override
        public void submitCode(String code)
        {
            submit(new TdApi.CheckAuthenticationCode(code));
        }

        /**
         * Submits the two-step password only for the current WAITING_FOR_PASSWORD
         * state.
         */
        @Override
        public void submitPassword(String password)
        {
            submit(new TdApi.CheckAuthenticationPassword(password));
        }

        /** Submits an email address required by the current authorization challenge. */
        @Override
        public void submitEmailAddress(String emailAddress)
        {
            submit(new TdApi.SetAuthenticationEmailAddress(emailAddress));
        }

        /** Submits an email verification code without persisting it. */
        @Override
        public void submitEmailCode(String code)
        {
            submit(new TdApi.CheckAuthenticationEmailCode(new TdApi.EmailAddressAuthenticationCode(code)));
        }

        /**
         * Completes profile registration when required by Telegram for a new user
         * account.
         */
        @Override
        public void register(String firstName, String lastName)
        {
            submit(new TdApi.RegisterUser(firstName, lastName, false));
        }

        /**
         * Explicit logout destroys the reusable authorization session; ordinary
         * shutdown uses close() instead.
         */
        @Override
        public void logOut()
        {
            loggedOut = true;
            client.sendAsync(new TdApi.LogOut()).orTimeout(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                    .whenComplete((ignored, error) -> {
                        if (error != null)
                        {
                            emit(TelegramAuthorizationState.ERROR, null);
                        } else
                        {
                            emit(TelegramAuthorizationState.LOGGED_OUT, null);
                            close();
                        }
                    });
        }

        /**
         * Closes the local client and preserves the authorized session for a later
         * process restart.
         */
        @Override
        public void close()
        {
            if (!closing)
            {
                closing = true;
                messageEvents.shutdown();
                client.sendAsync(new TdApi.Close()).orTimeout(REQUEST_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                        .whenComplete((ignored, error) -> releaseFactoryAfterClose());
            }
        }

        /** Ensures factory cleanup when TDLib cannot deliver a final closed update. */
        private synchronized void releaseFactoryAfterClose()
        {
            Arrays.fill(databaseKey, (byte) 0);
            factory.close();
        }
    }
}
