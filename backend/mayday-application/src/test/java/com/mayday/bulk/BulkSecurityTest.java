package com.mayday.bulk;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.mayday.common.BusinessException;
import com.mayday.common.BusinessTime;
import com.mayday.security.AccessPolicy;
import com.mayday.system.model.SysUser;
import com.mayday.system.repository.UserRepository;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.transaction.PlatformTransactionManager;
import tools.jackson.databind.json.JsonMapper;

/** 批量任务的归属、撤权后下载和 DTO 隔离；不依赖浏览器隐藏按钮作为授权边界。 */
class BulkSecurityTest {
  @TempDir Path spool;
  private final BulkJobRepository jobs = mock(BulkJobRepository.class);
  private final AccessPolicy access = mock(AccessPolicy.class);
  private final BulkIdentity identity = mock(BulkIdentity.class);
  private BulkService service;

  private BulkService service() {
    SysUser current = new SysUser();
    current.setId(1L);
    current.setUsername("admin");
    when(access.current()).thenReturn(current);
    BulkResourceAdapter adapter = mock(BulkResourceAdapter.class);
    when(adapter.resource()).thenReturn("users");
    var spoolManager = mock(BulkSpoolCleanup.class);
    when(spoolManager.directory()).thenReturn(spool);
    service =
        new BulkService(
            jobs,
            mock(UserRepository.class),
            access,
            identity,
            List.of(adapter),
            mock(PlatformTransactionManager.class),
            JsonMapper.builder().build(),
            mock(com.mayday.operations.cluster.DurableTasks.class),
            mock(BulkResultStore.class),
            spoolManager);
    return service;
  }

  @AfterEach
  void stop() {
    if (service != null) service.stop();
  }

  private BulkJob job(Long owner) {
    BulkJob job = new BulkJob();
    job.setId(7L);
    job.setOwnerId(owner);
    job.setResource("users");
    job.setKind("EXPORT");
    job.setStatus("SUCCEEDED");
    job.setPermissionSignature("original");
    job.setQueryJson("private filters");
    job.setResultKey("private storage key");
    job.setExpiresAt(BusinessTime.now().plusHours(1));
    when(jobs.findById(7L)).thenReturn(Optional.of(job));
    return job;
  }

  @Test
  void administratorStillCannotReadAnotherUsersJob() {
    BulkService target = service();
    job(2L);
    assertThrows(AccessDeniedException.class, () -> target.view(7L));
    assertThrows(AccessDeniedException.class, () -> target.download(7L));
  }

  @Test
  void permissionChangeInvalidatesPreviouslyGeneratedDownload() {
    BulkService target = service();
    job(1L);
    when(identity.signature()).thenReturn("changed");
    assertThrows(AccessDeniedException.class, () -> target.download(7L));
  }

  @Test
  void dtoNeverContainsStorageKeyPermissionSnapshotOrRawFilters() {
    BulkService target = service();
    job(1L);
    String view = target.view(7L).toString();
    assertFalse(view.contains("private"));
    assertFalse(view.contains("original"));
    target.list();
    verify(jobs).findTop20ByOwnerIdOrderByIdDesc(1L);
  }

  @Test
  void unknownResourceCannotSelectArbitraryHandlerOrTemplate() {
    BulkService target = service();
    assertThrows(BusinessException.class, () -> target.template("java.lang.Runtime"));
  }
}
