package com.mayday.telegram;

import java.nio.file.Path;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import it.tdlight.ClientFactory;
import it.tdlight.TelegramClient;
import it.tdlight.jni.TdApi;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Closing must not wait on the thread that still needs to deliver the closed
 * update.
 */
class TdLightSessionCloseTest
{
    @Test
    void immediateCloseResponseDoesNotBlockTheCoordinatorCaller() throws Exception
    {
        assertNonBlockingCleanup(true);
    }

    @Test
    void asynchronousCloseResponseDoesNotBlockTheNativeCallback() throws Exception
    {
        assertNonBlockingCleanup(false);
    }

    /** Simulates native factory cleanup waiting for a final authorization event. */
    private void assertNonBlockingCleanup(boolean alreadyCompleted) throws Exception
    {
        TelegramClient transport = mock(TelegramClient.class);
        ClientFactory factory = mock(ClientFactory.class);
        CompletableFuture<TdApi.Ok> response = new CompletableFuture<>();
        if (alreadyCompleted)
        {
            response.complete(new TdApi.Ok());
        }
        when(transport.sendAsync(any(TdApi.Close.class))).thenReturn(response);
        CountDownLatch cleanupEntered = new CountDownLatch(1);
        CountDownLatch closedEvent = new CountDownLatch(1);
        CountDownLatch cleanupFinished = new CountDownLatch(1);
        doAnswer(invocation -> {
            cleanupEntered.countDown();
            try
            {
                assertThat(closedEvent.await(5, TimeUnit.SECONDS)).isTrue();
            } finally
            {
                cleanupFinished.countDown();
            }
            return null;
        }).when(factory).close();
        TelegramSessionClient session = new TdLightTelegramSessionClientProvider.TdLightSessionClient(factory,
                transport, new TelegramSettings(), Path.of("unused-test-session"), new byte[32], update -> {
                }, message -> {
                }, new ObjectMapper());
        try
        {
            assertTimeoutPreemptively(Duration.ofSeconds(1), session::close);
            assertTimeoutPreemptively(Duration.ofSeconds(1), () -> response.complete(new TdApi.Ok()));
            assertThat(cleanupEntered.await(2, TimeUnit.SECONDS)).isTrue();
            assertTimeoutPreemptively(Duration.ofSeconds(1), session::close);
            verify(transport, times(1)).sendAsync(any(TdApi.Close.class));
        } finally
        {
            closedEvent.countDown();
        }
        assertThat(cleanupFinished.await(2, TimeUnit.SECONDS)).isTrue();
        verify(factory, times(1)).close();
    }
}
