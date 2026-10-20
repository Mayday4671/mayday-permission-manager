package com.mayday.security;

import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import com.mayday.common.util.ModuleSwitches;
import com.mayday.system.mapper.EntryMapper;
import com.mayday.system.model.SysRole;
import com.mayday.system.model.SysUser;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

/** 请求与无会话的后台任务必须使用同一权限字典和开关，未知权限不能因为 admin 身份放行。 */
class ModuleAuthorizationTest
{
    @AfterEach
    void clearIdentity()
    {
        SecurityContextHolder.clearContext();
    }

    @Test
    void administratorCannotUseDisabledOrUnknownPermissions()
    {
        ModuleSwitches modules = new ModuleSwitches();
        modules.setEnabled(Map.of("crawler", false));
        AccessPolicy access = new AccessPolicy(mock(EntryMapper.class), modules);
        SysUser user = user("admin", Set.of());
        authenticate(user);
        assertTrue(access.has("users:view"));
        assertFalse(access.has("crawler:run"));
        assertFalse(access.hasFor(user, "crawler:run"));
        assertFalse(access.hasFor(user, "unregistered:view"));
    }

    @Test
    void unregisteredPersistedGrantsAreNotTreatedAsValidAuthorization()
    {
        AccessPolicy access = new AccessPolicy(mock(EntryMapper.class), new ModuleSwitches());
        SysUser user = user("legacy", Set.of("users:view", "unregistered:view"));
        authenticate(user);
        assertTrue(access.has("users:view"));
        assertFalse(access.has("unregistered:view"));
        assertFalse(access.hasFor(user, "unregistered:view"));
    }

    @Test
    void permissionDictionaryCannotBeChangedByOtherComponents()
    {
        assertThrows(UnsupportedOperationException.class, () -> PermissionCatalog.ALL.add("unregistered:view"));
        assertThrows(UnsupportedOperationException.class,
                () -> PermissionCatalog.GROUPS.get(1).actions().put("write", "越权"));
    }

    private SysUser user(String roleCode, Set<String> permissions)
    {
        SysRole role = new SysRole();
        role.setCode(roleCode);
        role.setPermissions(new HashSet<>(permissions));
        SysUser user = new SysUser();
        user.setEnabled(true);
        user.setRoles(new HashSet<>(Set.of(role)));
        return user;
    }

    private void authenticate(SysUser user)
    {
        SecurityContextHolder.getContext()
                .setAuthentication(new UsernamePasswordAuthenticationToken(user, null, Set.of()));
    }
}
