package com.mayday.telegram;

import java.util.Optional;

import com.mayday.common.exception.ResourceNotFoundException;
import com.mayday.security.AccessPolicy;
import com.mayday.system.model.SysUser;
import com.mayday.telegram.mapper.TelegramAccountMapper;
import com.mayday.telegram.mapper.TelegramConversationMapper;
import com.mayday.telegram.mapper.TelegramSearchMapper;
import com.mayday.telegram.mapper.TelegramSearchMessageMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.TransactionTemplate;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Regression coverage for private Telegram transcripts across broad data
 * scopes.
 */
class TelegramConversationOwnershipTest
{
    private AccessPolicy access;
    private TelegramConversationMapper conversations;
    private TelegramSearchMapper searches;
    private TelegramSearchMessageMapper messages;
    private TelegramSearchService service;
    private TelegramConversation otherUsersConversation;

    @BeforeEach
    void setUp()
    {
        TelegramModuleGuard moduleGuard = mock(TelegramModuleGuard.class);
        access = mock(AccessPolicy.class);
        conversations = mock(TelegramConversationMapper.class);
        searches = mock(TelegramSearchMapper.class);
        messages = mock(TelegramSearchMessageMapper.class);
        service = new TelegramSearchService(moduleGuard, mock(TelegramSettings.class), access,
                mock(TelegramSessionCoordinator.class), mock(TelegramAccountMapper.class), conversations, searches,
                messages, mock(TelegramResultParser.class), mock(TransactionTemplate.class));

        SysUser currentUser = new SysUser();
        currentUser.setId(7L);
        when(access.current()).thenReturn(currentUser);

        otherUsersConversation = new TelegramConversation();
        otherUsersConversation.setId(42L);
        otherUsersConversation.setOwnerId(11L);
        otherUsersConversation.setDepartmentId(3L);
        when(conversations.findById(42L)).thenReturn(Optional.of(otherUsersConversation));
    }

    @Test
    void transcriptCannotBeReadByAnotherUserEvenWhenTheirDataScopeWouldAllowIt()
    {
        assertThatThrownBy(() -> service.listConversation(42L, 1, 20)).isInstanceOf(ResourceNotFoundException.class);

        verify(searches, never()).paginate(org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any());
    }

    @Test
    void anotherUsersConversationCannotBeDeleted()
    {
        assertThatThrownBy(() -> service.deleteConversation(42L)).isInstanceOf(ResourceNotFoundException.class);

        verify(messages, never()).deleteByQuery(org.mockito.ArgumentMatchers.any());
        verify(searches, never()).deleteByQuery(org.mockito.ArgumentMatchers.any());
        verify(conversations, never()).deleteById(42L);
    }
}
