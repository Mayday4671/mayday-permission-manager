package com.mayday.agentscope;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

/**
 * Cross-module erasure hook used only after the application authorizes deletion
 * of a user account.
 */
@Service
@RequiredArgsConstructor
public class AgentScopeAccountCleanup
{
    private final AgentScopeService service;

    /**
     * Removes private message history and every JDBC state session for the selected
     * account.
     */
    public void deleteAccountData(Long ownerId)
    {
        service.deleteAccountData(ownerId);
    }
}
