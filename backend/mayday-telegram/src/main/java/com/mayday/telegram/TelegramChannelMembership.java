package com.mayday.telegram;

import it.tdlight.jni.TdApi;

/**
 * Keeps historical or publicly accessible chats out of the joined-channel
 * directory.
 */
final class TelegramChannelMembership
{
    private TelegramChannelMembership()
    {
    }

    /**
     * Includes actual members and administrators; a former owner must still be a
     * member.
     */
    static boolean isJoined(TdApi.ChatMemberStatus status)
    {
        return status instanceof TdApi.ChatMemberStatusMember || status instanceof TdApi.ChatMemberStatusAdministrator
                || status instanceof TdApi.ChatMemberStatusCreator creator && creator.isMember
                || status instanceof TdApi.ChatMemberStatusRestricted restricted && restricted.isMember;
    }
}
