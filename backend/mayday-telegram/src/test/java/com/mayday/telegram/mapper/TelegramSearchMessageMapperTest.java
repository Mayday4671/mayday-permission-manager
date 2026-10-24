package com.mayday.telegram.mapper;

import java.util.Optional;

import com.mayday.telegram.TelegramSearchMessage;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Answers.CALLS_REAL_METHODS;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

/**
 * Verifies Telegram message IDs are reconciled when TDLib replaces a pending
 * outgoing message's temporary ID with its final ID.
 */
class TelegramSearchMessageMapperTest
{
    @Test
    void reusesTheTemporaryMessageRowAfterTelegramAssignsTheFinalId()
    {
        TelegramSearchMessageMapper mapper = mock(TelegramSearchMessageMapper.class, CALLS_REAL_METHODS);
        TelegramSearchMessage temporaryMessage = message(31L);
        doReturn(Optional.empty()).when(mapper).findMessage("900", "7002");
        doReturn(Optional.of(temporaryMessage)).when(mapper).findMessage("900", "7001");

        Optional<TelegramSearchMessage> result = mapper.findMessageForUpdate("900", "7002", "7001");

        assertThat(result).containsSame(temporaryMessage);
        verify(mapper, never()).deleteById(temporaryMessage.getId());
    }

    @Test
    void removesTheStaleTemporaryRowWhenTheFinalIdWasAlreadyStored()
    {
        TelegramSearchMessageMapper mapper = mock(TelegramSearchMessageMapper.class, CALLS_REAL_METHODS);
        TelegramSearchMessage finalMessage = message(32L);
        TelegramSearchMessage temporaryMessage = message(31L);
        doReturn(Optional.of(finalMessage)).when(mapper).findMessage("900", "7002");
        doReturn(Optional.of(temporaryMessage)).when(mapper).findMessage("900", "7001");

        Optional<TelegramSearchMessage> result = mapper.findMessageForUpdate("900", "7002", "7001");

        assertThat(result).containsSame(finalMessage);
        verify(mapper).deleteById(temporaryMessage.getId());
    }

    private TelegramSearchMessage message(Long id)
    {
        TelegramSearchMessage message = new TelegramSearchMessage();
        message.setId(id);
        return message;
    }
}
