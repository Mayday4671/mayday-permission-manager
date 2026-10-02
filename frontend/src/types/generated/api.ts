/** 自动从 contracts/openapi.json 生成；请修改服务端 DTO 后重新生成，禁止手工编辑。 */
export interface paths {
  "/api/auth/captcha/challenge": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["CaptchaController_challenge"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/auth/captcha/verify": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["CaptchaController_verify"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/auth/login": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["AuthController_login"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/auth/logout": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["AuthController_logout"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/auth/me": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["AuthController_me"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/auth/password": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put: operations["AuthController_password"];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/auth/profile": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put: operations["AuthController_profile"];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/bulk/{resource}/exports": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["BulkController_export"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/bulk/{resource}/import/commit": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["BulkController_commit"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/bulk/{resource}/import/preview": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["BulkController_preview"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/bulk/{resource}/template": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["BulkController_template"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/bulk/jobs": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["BulkController_list"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/bulk/jobs/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["BulkController_view"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/bulk/jobs/{id}/download": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["BulkController_download"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/business/workorders": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["WorkOrderController_list"];
    put?: never;
    post: operations["WorkOrderController_create"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/business/workorders/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["WorkOrderController_get"];
    put: operations["WorkOrderController_update"];
    post?: never;
    delete: operations["WorkOrderController_delete"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/content/notices": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["NoticeController_list"];
    put?: never;
    post: operations["NoticeController_create"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/content/notices/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["NoticeController_detail"];
    put: operations["NoticeController_update"];
    post?: never;
    delete: operations["NoticeController_delete"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/content/notices/{id}/offline": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["NoticeController_offline"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/content/notices/{id}/publications": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["NoticeController_publications"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/content/notices/{id}/publish": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["NoticeController_publish"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/content/notices/{id}/purge": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete: operations["NoticeController_purge"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/content/notices/{id}/restore": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["NoticeController_restore"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/content/notices/{id}/revisions": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["NoticeController_revisions"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/content/notices/{id}/revisions/{revisionId}/files/{fileId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["ContentFileController_managed"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/content/notices/recycle": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["NoticeController_recycle"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/crawler/tasks": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["CrawlController_list"];
    put?: never;
    post: operations["CrawlController_create"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/crawler/tasks/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["CrawlController_detail"];
    put: operations["CrawlController_update"];
    post?: never;
    delete: operations["CrawlController_delete"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/crawler/tasks/{id}/articles": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["CrawlController_articles"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/crawler/tasks/{id}/articles/{articleId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["CrawlController_article"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/crawler/tasks/{id}/items": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["CrawlController_items"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/crawler/tasks/{id}/items/{itemId}/image": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["CrawlController_image"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/crawler/tasks/{id}/retry": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["CrawlController_retry"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/crawler/tasks/{id}/start": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["CrawlController_start"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/crawler/tasks/{id}/stop": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["CrawlController_stop"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/crawler/tasks/articles": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["CrawlController_articleCards"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/crawler/tasks/preview": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["CrawlController_preview"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/dashboard": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["DashboardController_dashboard"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/feedback": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["FeedbackController_list"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/feedback/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["FeedbackController_detail"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/feedback/{id}/process": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["FeedbackController_process"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/feedback/assignees": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["FeedbackController_assignees"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/files": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["FileController_list"];
    put?: never;
    post: operations["FileController_upload"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/files/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["FileController_detail"];
    put?: never;
    post?: never;
    delete: operations["FileController_recycle"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/files/{id}/download": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["FileController_download"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/files/{id}/preview": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["FileController_preview"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/files/{id}/thumbnail": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["FileController_thumbnail"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/files/batch": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["FileController_batch"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/files/directories": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["FileController_directories"];
    put?: never;
    post: operations["FileController_createDirectory"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/files/directories/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put: operations["FileController_updateDirectory"];
    post?: never;
    delete: operations["FileController_deleteDirectory"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/files/storage-info": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["FileController_storageInfo"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/job-logs": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["JobController_logs"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/messages": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["MessageController_inbox"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/messages/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["MessageController_message"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/messages/{id}/read": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["MessageController_read"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/messages/{messageId}/attachments/{fileId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["NotificationAttachmentController_received"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/messages/read-all": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["MessageController_readAll"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/messages/unread": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["MessageController_unread"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/monitor": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["MonitorController_status"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/monitor/history": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["MonitorController_history"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/monitor/policy": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["MonitorController_policy"];
    put: operations["MonitorController_configure"];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/monitor/recipients": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["MonitorController_recipients"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/notifications": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["MessageController_list"];
    put?: never;
    post: operations["MessageController_create"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/notifications/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["MessageController_detail"];
    put: operations["MessageController_update"];
    post?: never;
    delete: operations["MessageController_delete"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/notifications/{id}/copy": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["MessageController_copy"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/notifications/{id}/publish": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["MessageController_publish"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/notifications/{id}/recipients": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["MessageController_recipients"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/notifications/{id}/withdraw": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["MessageController_withdraw"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/notifications/{notificationId}/attachments/{fileId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["NotificationAttachmentController_managed"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/notifications/options/{kind}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["MessageController_options"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/people": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["MessageController_people"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/realtime/stream": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["RealtimeController_stream"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/requests": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["WorkflowController_requests"];
    put?: never;
    post: operations["WorkflowController_submit"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/requests/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["WorkflowController_request"];
    put: operations["WorkflowController_edit"];
    post?: never;
    delete: operations["WorkflowController_discardDraft"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/requests/{id}/copies/read": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["WorkflowController_readCopies"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/requests/{id}/decision": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["WorkflowController_decide"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/requests/{id}/events": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["WorkflowController_events"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/requests/{id}/files/{fileId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["WorkflowFileController_download"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/requests/{id}/history": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["WorkflowController_history"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/requests/{id}/remind": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["WorkflowController_remind"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/requests/{id}/retry-notifications": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["WorkflowController_retry"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/requests/{id}/submit": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["WorkflowController_resubmit"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/requests/{requestId}/content-files/{fileId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["ContentFileController_approval"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/requests/drafts": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["WorkflowController_draft"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/scheduler": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["JobController_list"];
    put?: never;
    post: operations["JobController_create"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/scheduler/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put: operations["JobController_update"];
    post?: never;
    delete: operations["JobController_delete"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/scheduler/{id}/run": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["JobController_run"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/scheduler/handlers": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["JobController_handlers"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/scheduler/recipients": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["JobController_recipients"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/sessions": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["SessionController_list"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/sessions/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete: operations["SessionController_revoke"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/workflows": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["WorkflowController_definitions"];
    put?: never;
    post: operations["WorkflowController_create"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/workflows/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["WorkflowController_detail"];
    put: operations["WorkflowController_update"];
    post?: never;
    delete: operations["WorkflowController_delete"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/workflows/{id}/publish": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["WorkflowController_publish"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/workflows/{id}/versions": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["WorkflowController_versions"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/workflows/options": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["WorkflowController_options"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/workflows/roles": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["WorkflowController_roleOptions"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/workflows/simulate": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["WorkflowController_simulate"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/operations/workflows/templates": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["WorkflowController_templates"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/platform/features": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["PlatformController_features"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/articles": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["PublicController_list"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/articles/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["PublicController_detail"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/articles/{id}/cover": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["ContentFileController_cover"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/articles/{id}/files/{fileId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["ContentFileController_attachment"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/articles/{id}/view": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["PublicController_recordView"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/feedback": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["PublicFeedbackController_submit"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/feedback/track": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["PublicFeedbackController_track"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/site": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["PublicController_site"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/public/taxonomy": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["PublicController_taxonomy"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/relay/config": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["RelayController_config"];
    put: operations["RelayController_save"];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/relay/interfaces": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["RelayController_interfaces"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/relay/start": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["RelayController_start"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/relay/stats": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["RelayController_stats"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/relay/stop": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["RelayController_stop"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/changes": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["ChangeAuditController_list"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/changes/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["ChangeAuditController_detail"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/dictionaries/{typeId}/items": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["DictionaryController_list"];
    put?: never;
    post: operations["DictionaryController_create"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/dictionaries/{typeId}/items/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put: operations["DictionaryController_update"];
    post?: never;
    delete: operations["DictionaryController_delete"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/dictionary-options/{code}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["DictionaryController_options"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/entries/{kind}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["EntryController_list"];
    put?: never;
    post: operations["EntryController_create"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/entries/{kind}/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put: operations["EntryController_update"];
    post?: never;
    delete: operations["EntryController_delete"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/logs": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["AuditController_list"];
    put?: never;
    post?: never;
    delete: operations["AuditController_clean"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/logs/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["AuditController_detail"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/logs/export": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["AuditController_export"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/lookups": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["LookupController_lookups"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/navigation": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["LookupController_navigation"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/options/{kind}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["LookupController_options"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/roles": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["RoleController_list"];
    put?: never;
    post: operations["RoleController_create"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/roles/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put: operations["RoleController_update"];
    post?: never;
    delete: operations["RoleController_delete"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/roles/permissions": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["RoleController_permissions"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/site-config": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["SiteConfigController_get"];
    put: operations["SiteConfigController_update"];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/site-config/refresh": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["SiteConfigController_refresh"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/user-statistics": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["UserStatisticsController_statistics"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/users": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["UserController_list"];
    put?: never;
    post: operations["UserController_create"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/users/{id}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put: operations["UserController_update"];
    post?: never;
    delete: operations["UserController_delete"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/users/{id}/password": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put: operations["UserController_reset"];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/users/export": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["UserController_export"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/api/system/users/status": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put: operations["UserController_status"];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    Action: {
      action: string;
      comment?: string;
      targetNodeId?: string;
      /** Format: int64 */
      targetUserId?: number;
      /** Format: int64 */
      taskId?: number;
      values?: {
        [key: string]: unknown;
      };
      /** Format: int64 */
      version: number;
    };
    AlertRecipientOption: {
      label: string;
      /** Format: int64 */
      value: number;
    };
    ApiResponseBatchResult: {
      data: components["schemas"]["BatchResult"];
      message: string;
      success: boolean;
    };
    ApiResponseChangeAuditView: {
      data: components["schemas"]["ChangeAuditView"];
      message: string;
      success: boolean;
    };
    ApiResponseFeatureView: {
      data: components["schemas"]["FeatureView"];
      message: string;
      success: boolean;
    };
    ApiResponseFeedbackAdminView: {
      data: components["schemas"]["FeedbackAdminView"];
      message: string;
      success: boolean;
    };
    ApiResponseFeedbackPublicView: {
      data: components["schemas"]["FeedbackPublicView"];
      message: string;
      success: boolean;
    };
    ApiResponseFeedbackReceipt: {
      data: components["schemas"]["FeedbackReceipt"];
      message: string;
      success: boolean;
    };
    ApiResponseFileDirectory: {
      data: components["schemas"]["FileDirectory"];
      message: string;
      success: boolean;
    };
    ApiResponseImportPreview: {
      data: components["schemas"]["ImportPreview"];
      message: string;
      success: boolean;
    };
    ApiResponseImportResult: {
      data: components["schemas"]["ImportResult"];
      message: string;
      success: boolean;
    };
    ApiResponseJobExecution: {
      data: components["schemas"]["JobExecution"];
      message: string;
      success: boolean;
    };
    ApiResponseJobView: {
      data: components["schemas"]["JobView"];
      message: string;
      success: boolean;
    };
    ApiResponseListAlertRecipientOption: {
      data: components["schemas"]["AlertRecipientOption"][];
      message: string;
      success: boolean;
    };
    ApiResponseListFeedbackAssignee: {
      data: components["schemas"]["FeedbackAssignee"][];
      message: string;
      success: boolean;
    };
    ApiResponseListFileDirectory: {
      data: components["schemas"]["FileDirectory"][];
      message: string;
      success: boolean;
    };
    ApiResponseListJobView: {
      data: components["schemas"]["JobView"][];
      message: string;
      success: boolean;
    };
    ApiResponseListMonitorHistoryPoint: {
      data: components["schemas"]["MonitorHistoryPoint"][];
      message: string;
      success: boolean;
    };
    ApiResponseListTemplate: {
      data: components["schemas"]["Template"][];
      message: string;
      success: boolean;
    };
    ApiResponseLoginView: {
      data: components["schemas"]["LoginView"];
      message: string;
      success: boolean;
    };
    ApiResponseMapStringString: {
      data: {
        [key: string]: string;
      };
      message: string;
      success: boolean;
    };
    ApiResponseMonitorPolicyView: {
      data: components["schemas"]["MonitorPolicyView"];
      message: string;
      success: boolean;
    };
    ApiResponseMonitorSnapshot: {
      data: components["schemas"]["MonitorSnapshot"];
      message: string;
      success: boolean;
    };
    ApiResponseObject: {
      data: unknown;
      message: string;
      success: boolean;
    };
    ApiResponsePageResultChangeAuditView: {
      data: components["schemas"]["PageResultChangeAuditView"];
      message: string;
      success: boolean;
    };
    ApiResponsePageResultFeedbackAdminView: {
      data: components["schemas"]["PageResultFeedbackAdminView"];
      message: string;
      success: boolean;
    };
    ApiResponsePageResultJobExecution: {
      data: components["schemas"]["PageResultJobExecution"];
      message: string;
      success: boolean;
    };
    ApiResponsePageResultScheduledJob: {
      data: components["schemas"]["PageResultScheduledJob"];
      message: string;
      success: boolean;
    };
    ApiResponsePageResultStoredFile: {
      data: components["schemas"]["PageResultStoredFile"];
      message: string;
      success: boolean;
    };
    ApiResponsePageResultUserView: {
      data: components["schemas"]["PageResultUserView"];
      message: string;
      success: boolean;
    };
    ApiResponsePageResultWorkOrderView: {
      data: components["schemas"]["PageResultWorkOrderView"];
      message: string;
      success: boolean;
    };
    ApiResponseScheduledJob: {
      data: components["schemas"]["ScheduledJob"];
      message: string;
      success: boolean;
    };
    ApiResponseSessionView: {
      data: components["schemas"]["SessionView"];
      message: string;
      success: boolean;
    };
    ApiResponseStorageInfo: {
      data: components["schemas"]["StorageInfo"];
      message: string;
      success: boolean;
    };
    ApiResponseStoredFile: {
      data: components["schemas"]["StoredFile"];
      message: string;
      success: boolean;
    };
    ApiResponseUserView: {
      data: components["schemas"]["UserView"];
      message: string;
      success: boolean;
    };
    ApiResponseVoid: {
      data: unknown;
      message: string;
      success: boolean;
    };
    ApiResponseWorkOrderView: {
      data: components["schemas"]["WorkOrderView"];
      message: string;
      success: boolean;
    };
    ArticleRule: {
      author?: string;
      content?: string;
      enabled?: boolean;
      publishedAt?: string;
      title?: string;
    };
    BatchEdit: {
      action: string;
      /** Format: int64 */
      directoryId?: number;
      ids: number[];
    };
    BatchResult: {
      /** Format: int32 */
      count?: number;
    };
    ChallengeRequest: {
      username: string;
    };
    ChangeAuditView: {
      action: string;
      actor: string;
      changes: components["schemas"]["Difference"][];
      /** Format: date-time */
      createdAt: string;
      /** Format: int64 */
      id: number;
      resource: string;
      /** Format: int64 */
      resourceId?: number;
      /** Format: int64 */
      version: number;
    };
    Cleanup: {
      /** Format: date */
      before: string;
      loginOnly?: boolean;
    };
    Condition: {
      field?: string;
      next?: string;
      operator?: string;
      value?: string;
    };
    ContentDraft: {
      attachmentIds?: number[];
      category?: string;
      /** Format: int64 */
      categoryId?: number;
      content: string;
      contentFormat?: string;
      /** Format: int64 */
      coverId?: number;
      pinned?: boolean;
      published?: boolean;
      recommended?: boolean;
      requiresApproval?: boolean;
      seoDescription?: string;
      seoKeywords?: string;
      seoTitle?: string;
      /** Format: int32 */
      sortOrder?: number;
      summary?: string;
      tagIds?: number[];
      tags?: string[];
      title: string;
      /** Format: int64 */
      version?: number;
      visibility?: string;
    };
    ContentVersion: {
      /** Format: int64 */
      version: number;
    };
    CrawlerConfigEdit: {
      name: string;
      rules: components["schemas"]["CrawlRules"];
      /** Format: int64 */
      version?: number;
    };
    CrawlerConfigVersion: {
      /** Format: int64 */
      version: number;
    };
    CrawlRules: {
      article?: components["schemas"]["ArticleRule"];
      detail?: components["schemas"]["PageRule"];
      detailSelector?: string;
      enterDetails?: boolean;
      entryUrl?: string;
      imageAttributes?: string[];
      imageHosts?: string[];
      imageSelector?: string;
      /** Format: int32 */
      intervalMs?: number;
      list?: components["schemas"]["PageRule"];
      /** Format: int32 */
      maxDetails?: number;
      /** Format: int32 */
      maxImages?: number;
    };
    DepartmentGrant: {
      /** Format: int64 */
      departmentId: number;
      resource: string;
    };
    DictionaryItemEdit: {
      color?: string;
      enabled?: boolean;
      label: string;
      /** Format: int32 */
      sortOrder?: number;
      value: string;
      /** Format: int64 */
      version?: number;
    };
    Difference: {
      after: string;
      before: string;
      field: string;
    };
    DirectoryEdit: {
      name: string;
      /** Format: int64 */
      parentId?: number;
      /** Format: int64 */
      version?: number;
    };
    Edit: {
      /** Format: int64 */
      businessVersion?: number;
      title: string;
      values?: {
        [key: string]: unknown;
      };
      /** Format: int64 */
      version: number;
    };
    EntryRequest: {
      code: string;
      description?: string;
      enabled?: boolean;
      groupName?: string;
      icon?: string;
      /** Format: int64 */
      leaderId?: number;
      name: string;
      /** Format: int64 */
      parentId?: number;
      path?: string;
      permission?: string;
      /** Format: int32 */
      sortOrder?: number;
      value?: string;
      valueType?: string;
      /** Format: int64 */
      version?: number;
    };
    ExportFilter: {
      /** Format: int64 */
      departmentId?: number | null;
      enabled?: boolean | null;
      keyword?: string;
    };
    FeatureView: {
      modules?: {
        [key: string]: boolean;
      };
    };
    FeedbackAdminView: {
      /** Format: int64 */
      articleId?: number;
      /** Format: int64 */
      assigneeId?: number;
      assigneeName?: string;
      contact?: string;
      content: string;
      /** Format: date-time */
      createdAt: string;
      history: components["schemas"]["FeedbackHistory"][];
      /** Format: int64 */
      id: number;
      status: string;
      title: string;
      type: string;
      /** Format: int64 */
      version: number;
    };
    FeedbackAssignee: {
      label: string;
      /** Format: int64 */
      value: number;
    };
    FeedbackHistory: {
      actor: string;
      /** Format: date-time */
      createdAt: string;
      /** Format: int64 */
      feedbackId: number;
      /** Format: int64 */
      id: number;
      internalNote?: string;
      publicReply?: string;
      status: string;
      /** Format: date-time */
      updatedAt?: string;
      /** Format: int64 */
      version: number;
    };
    FeedbackProcess: {
      /** Format: int64 */
      assigneeId?: number;
      internalNote?: string;
      publicReply?: string;
      status: string;
      /** Format: int64 */
      version: number;
    };
    FeedbackPublicHistory: {
      /** Format: date-time */
      createdAt: string;
      reply?: string;
      status: string;
    };
    FeedbackPublicView: {
      /** Format: date-time */
      createdAt: string;
      history: components["schemas"]["FeedbackPublicHistory"][];
      status: string;
      title: string;
      type: string;
    };
    FeedbackReceipt: {
      /** Format: date-time */
      createdAt: string;
      receipt: string;
    };
    FeedbackSubmit: {
      /** Format: int64 */
      articleId?: number;
      /** Format: email */
      contact?: string;
      content: string;
      title: string;
      type: string;
    };
    Field: {
      columns?: components["schemas"]["Field"][];
      helpText?: string;
      id?: string;
      label?: string;
      max?: number;
      /** Format: int32 */
      maxLength?: number;
      /** Format: int32 */
      maxRows?: number;
      min?: number;
      options?: string[];
      placeholder?: string;
      required?: boolean;
      type?: string;
      /** Format: int32 */
      width?: number;
    };
    FileDirectory: {
      /** Format: date-time */
      createdAt?: string;
      /** Format: int64 */
      id?: number;
      name?: string;
      /** Format: int64 */
      ownerId?: number;
      ownerName?: string;
      /** Format: int64 */
      parentId?: number;
      /** Format: date-time */
      updatedAt?: string;
      /** Format: int64 */
      version?: number;
    };
    ImportPreview: {
      rows: components["schemas"]["ImportRow"][];
      /** Format: int32 */
      totalRows: number;
      /** Format: int32 */
      validRows: number;
    };
    ImportResult: {
      /** Format: int32 */
      importedRows: number;
      /** Format: int64 */
      jobId: number;
    };
    ImportRow: {
      errors: string[];
      /** Format: int32 */
      rowNumber: number;
      values: {
        [key: string]: string;
      };
    };
    JobExecution: {
      /** Format: date-time */
      createdAt: string;
      /** Format: int64 */
      durationMs: number;
      /** Format: date-time */
      failureNotifiedAt?: string;
      /** Format: int64 */
      id: number;
      /** Format: int64 */
      jobId: number;
      jobName: string;
      result: string;
      status: string;
      /** Format: date-time */
      updatedAt?: string;
      /** Format: int64 */
      version: number;
    };
    JobView: {
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      expiresAt: string;
      failure?: string;
      /** Format: int64 */
      id: number;
      /** @enum {string} */
      kind: "IMPORT" | "EXPORT";
      /** Format: int32 */
      processedRows: number;
      resource: string;
      /** @enum {string} */
      status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED";
      /** Format: int64 */
      totalRows: number;
    };
    LoginRequest: {
      captchaToken: string;
      password: string;
      username: string;
    };
    LoginView: {
      token: string;
    };
    MonitorHistoryPoint: {
      /** Format: double */
      cpuUsage: number;
      /** Format: date-time */
      createdAt: string;
      databaseHealthy: boolean;
      /** Format: int64 */
      databaseLatencyMs: number;
      /** Format: int64 */
      heapMax: number;
      /** Format: int64 */
      heapUsed: number;
      /** Format: int64 */
      id: number;
      /** Format: int32 */
      threads: number;
    };
    MonitorPolicyEdit: {
      /** Format: int64 */
      alertUserId?: number;
      /** Format: int64 */
      databaseThresholdMs?: number;
      enabled?: boolean;
      /** Format: int32 */
      heapThresholdPercent?: number;
      /** Format: int64 */
      version: number;
    };
    MonitorPolicyView: {
      /** Format: int64 */
      alertUserId?: number;
      /** Format: int64 */
      databaseThresholdMs: number;
      enabled: boolean;
      /** Format: int32 */
      heapThresholdPercent: number;
      /** Format: int64 */
      version: number;
    };
    MonitorSnapshot: {
      /** Format: double */
      cpuUsage: number;
      database: boolean;
      /** Format: int64 */
      databaseLatencyMs: number;
      /** Format: int64 */
      heapCommitted: number;
      /** Format: int64 */
      heapMax: number;
      /** Format: int64 */
      heapUsed: number;
      javaVersion: string;
      os: string;
      /** Format: int32 */
      processors: number;
      /** Format: int32 */
      threads: number;
      /** Format: date-time */
      time: string;
      timezone: string;
      /** Format: int64 */
      uptimeMs: number;
    };
    Node: {
      actions?: string[];
      assigneeIds?: number[];
      conditions?: components["schemas"]["Condition"][];
      id?: string;
      mode?: string;
      name?: string;
      next?: string;
      readable?: string[];
      source?: string;
      /** Format: int32 */
      timeoutMinutes?: number;
      type?: string;
      writable?: string[];
    };
    NotificationDraft: {
      attachmentIds: number[];
      content: string;
      /** Format: date-time */
      expiresAt?: string;
      recipientIds: number[];
      recipientType: string;
      summary?: string;
      title: string;
      type: string;
      /** Format: int64 */
      version?: number;
    };
    NotificationVersion: {
      /** Format: int64 */
      version: number;
    };
    PageResultChangeAuditView: {
      items?: components["schemas"]["ChangeAuditView"][];
      /** Format: int32 */
      page?: number;
      /** Format: int32 */
      size?: number;
      /** Format: int64 */
      total?: number;
    };
    PageResultFeedbackAdminView: {
      items?: components["schemas"]["FeedbackAdminView"][];
      /** Format: int32 */
      page?: number;
      /** Format: int32 */
      size?: number;
      /** Format: int64 */
      total?: number;
    };
    PageResultJobExecution: {
      items?: components["schemas"]["JobExecution"][];
      /** Format: int32 */
      page?: number;
      /** Format: int32 */
      size?: number;
      /** Format: int64 */
      total?: number;
    };
    PageResultScheduledJob: {
      items?: components["schemas"]["ScheduledJob"][];
      /** Format: int32 */
      page?: number;
      /** Format: int32 */
      size?: number;
      /** Format: int64 */
      total?: number;
    };
    PageResultStoredFile: {
      items?: components["schemas"]["StoredFile"][];
      /** Format: int32 */
      page?: number;
      /** Format: int32 */
      size?: number;
      /** Format: int64 */
      total?: number;
    };
    PageResultUserView: {
      items?: components["schemas"]["UserView"][];
      /** Format: int32 */
      page?: number;
      /** Format: int32 */
      size?: number;
      /** Format: int64 */
      total?: number;
    };
    PageResultWorkOrderView: {
      items?: components["schemas"]["WorkOrderView"][];
      /** Format: int32 */
      page?: number;
      /** Format: int32 */
      size?: number;
      /** Format: int64 */
      total?: number;
    };
    PageRule: {
      detailsPointer?: string;
      /** @enum {string} */
      format?: "HTML" | "JSON";
      imagesPointer?: string;
      /** Format: int32 */
      maxPages?: number;
      /** @enum {string} */
      mode?: "SINGLE" | "NEXT" | "LINKS" | "TEMPLATE" | "CURSOR";
      nextPointer?: string;
      selector?: string;
      /** Format: int32 */
      start?: number;
      /** Format: int32 */
      step?: number;
      template?: string;
      urlPointer?: string;
    };
    PasswordRequest: {
      newPassword: string;
      oldPassword: string;
    };
    ProfileRequest: {
      /** Format: email */
      email?: string;
      nickname: string;
      phone?: string;
    };
    Publish: {
      /** Format: date-time */
      offlineAt?: string;
      /** Format: date-time */
      publishAt?: string;
      /** Format: int64 */
      revisionId: number;
      /** Format: int64 */
      version: number;
    };
    RelaySettingsEdit: {
      bindIp: string;
      /** Format: int32 */
      bindPort?: number;
      /** Format: int32 */
      pendingMemoryMiB?: number;
      /** Format: int32 */
      receiveBufferMiB?: number;
      /** Format: int32 */
      sendBufferMiB?: number;
      sendIp?: string;
      /** Format: int32 */
      sendPort?: number;
      targetIp: string;
      /** Format: int32 */
      targetPort?: number;
      transportMode?: string;
      /** Format: int64 */
      version: number;
    };
    ResetPasswordRequest: {
      password: string;
    };
    RoleRequest: {
      code: string;
      dataScopes: {
        [key: string]: string;
      };
      description?: string;
      enabled?: boolean;
      name: string;
      permissions: string[];
      scopeDepartments?: components["schemas"]["DepartmentGrant"][];
      /** Format: int64 */
      version?: number;
    };
    ScheduledJob: {
      /** Format: int64 */
      alertUserId?: number;
      /** Format: date-time */
      createdAt: string;
      cron: string;
      description?: string;
      enabled: boolean;
      handler: string;
      /** Format: int64 */
      id: number;
      name: string;
      /** Format: date-time */
      nextRunAt?: string;
      /** Format: date-time */
      updatedAt?: string;
      /** Format: int64 */
      version: number;
    };
    ScheduledJobEdit: {
      /** Format: int64 */
      alertUserId?: number;
      cron: string;
      description?: string;
      enabled?: boolean;
      handler: string;
      name: string;
      /** Format: int64 */
      version?: number;
    };
    SessionView: {
      admin: boolean;
      dataScopes: {
        [key: string]:
          "SELF" | "DEPARTMENT" | "DEPARTMENT_TREE" | "CUSTOM" | "ALL";
      };
      permissions: string[];
      user: components["schemas"]["UserView"];
    };
    Simulation: {
      /** Format: int64 */
      applicantId?: number;
      schema: components["schemas"]["Spec"];
      values?: {
        [key: string]: unknown;
      };
    };
    Spec: {
      allowRepeatApproval?: boolean;
      allowSelfApproval?: boolean;
      allowWithdraw?: boolean;
      applicantIds?: number[];
      applicantType?: string;
      fields?: components["schemas"]["Field"][];
      nodes?: components["schemas"]["Node"][];
      startNodeId?: string;
    };
    SseEmitter: {
      /** Format: int64 */
      timeout?: number;
    };
    Start: {
      /** Format: int64 */
      version: number;
    };
    Stop: {
      runId: string;
    };
    StorageInfo: {
      extensions?: string[];
      /** Format: int64 */
      maximumBytes?: number;
      provider?: string;
    };
    StoredFile: {
      contentType?: string;
      /** Format: date-time */
      createdAt?: string;
      /** Format: date-time */
      deletedAt?: string;
      /** Format: int64 */
      directoryId?: number;
      /** Format: int64 */
      id?: number;
      name?: string;
      /** Format: int64 */
      ownerId?: number;
      ownerName?: string;
      purgeError?: string;
      /** Format: date-time */
      purgeRequestedAt?: string;
      /** Format: int64 */
      size?: number;
      storageProvider?: string;
      /** Format: date-time */
      updatedAt?: string;
      /** Format: int64 */
      version?: number;
    };
    TargetVersion: {
      /** Format: int64 */
      id: number;
      /** Format: int64 */
      version: number;
    };
    Template: {
      description?: string;
      key?: string;
      name?: string;
      schema?: components["schemas"]["Spec"];
    };
    Track: {
      receipt: string;
    };
    UserRequest: {
      /** Format: int64 */
      departmentId?: number;
      /** Format: email */
      email?: string;
      enabled?: boolean;
      nickname: string;
      password?: string;
      phone?: string;
      postIds?: number[];
      roleIds: number[];
      username: string;
      /** Format: int64 */
      version?: number;
    };
    UserStatusRequest: {
      enabled?: boolean;
      rows: components["schemas"]["TargetVersion"][];
    };
    UserView: {
      /** Format: date-time */
      createdAt: string;
      /** Format: int64 */
      departmentId: number | null;
      departmentName: string;
      email: string | null;
      enabled: boolean;
      /** Format: int64 */
      id: number;
      nickname: string;
      phone: string | null;
      postIds: number[];
      roleIds: number[];
      roleNames: string[];
      username: string;
      /** Format: int64 */
      version: number;
    };
    Value: {
      value?: string;
      /** Format: int64 */
      version?: number;
    };
    VerifyRequest: {
      challengeId: string;
      /** Format: int64 */
      elapsedMs: number;
      username: string;
      /** Format: int32 */
      x: number;
    };
    WorkflowDraft: {
      businessType: string;
      /** Format: int64 */
      categoryId: number;
      code: string;
      description?: string;
      enabled: boolean;
      name: string;
      schema?: components["schemas"]["Spec"];
      /** Format: int64 */
      version?: number;
    };
    WorkflowSubmission: {
      /** Format: int64 */
      businessId?: number;
      /** Format: int64 */
      businessRevisionId?: number;
      /** Format: int64 */
      businessVersion?: number;
      /** Format: int64 */
      definitionId: number;
      title: string;
      values?: {
        [key: string]: unknown;
      };
      /** Format: int64 */
      versionId: number;
    };
    WorkflowVersionRequest: {
      /** Format: int64 */
      version: number;
    };
    WorkOrderRequest: {
      description?: string | null;
      enabled: boolean;
      title: string;
      /** Format: int64 */
      version?: number;
    };
    WorkOrderView: {
      /** Format: date-time */
      createdAt: string;
      /** Format: int64 */
      departmentId: number | null;
      description: string | null;
      enabled: boolean;
      /** Format: int64 */
      id: number;
      /** Format: int64 */
      ownerId: number;
      title: string;
      /** Format: date-time */
      updatedAt: string;
      /** Format: int64 */
      version: number;
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  CaptchaController_challenge: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["ChallengeRequest"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  CaptchaController_verify: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["VerifyRequest"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  AuthController_login: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["LoginRequest"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseLoginView"];
        };
      };
    };
  };
  AuthController_logout: {
    parameters: {
      query?: never;
      header: {
        Authorization: string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  AuthController_me: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseSessionView"];
        };
      };
    };
  };
  AuthController_password: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["PasswordRequest"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  AuthController_profile: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["ProfileRequest"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  BulkController_export: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        resource: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["ExportFilter"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseJobView"];
        };
      };
    };
  };
  BulkController_commit: {
    parameters: {
      query: {
        idempotencyKey: string;
      };
      header?: never;
      path: {
        resource: string;
      };
      cookie?: never;
    };
    requestBody?: {
      content: {
        "multipart/form-data": {
          /** Format: binary */
          file: string;
        };
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseImportResult"];
        };
      };
    };
  };
  BulkController_preview: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        resource: string;
      };
      cookie?: never;
    };
    requestBody?: {
      content: {
        "multipart/form-data": {
          /** Format: binary */
          file: string;
        };
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseImportPreview"];
        };
      };
    };
  };
  BulkController_template: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        resource: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/csv;charset=UTF-8": string;
        };
      };
    };
  };
  BulkController_list: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseListJobView"];
        };
      };
    };
  };
  BulkController_view: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseJobView"];
        };
      };
    };
  };
  BulkController_download: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/csv;charset=UTF-8": string;
        };
      };
    };
  };
  WorkOrderController_list: {
    parameters: {
      query?: {
        enabled?: boolean;
        keyword?: string;
        page?: number;
        size?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponsePageResultWorkOrderView"];
        };
      };
    };
  };
  WorkOrderController_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["WorkOrderRequest"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseWorkOrderView"];
        };
      };
    };
  };
  WorkOrderController_get: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseWorkOrderView"];
        };
      };
    };
  };
  WorkOrderController_update: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["WorkOrderRequest"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseWorkOrderView"];
        };
      };
    };
  };
  WorkOrderController_delete: {
    parameters: {
      query: {
        version: number;
      };
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseVoid"];
        };
      };
    };
  };
  NoticeController_list: {
    parameters: {
      query?: {
        categoryId?: number;
        keyword?: string;
        page?: number;
        published?: boolean;
        size?: number;
        status?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  NoticeController_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["ContentDraft"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  NoticeController_detail: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  NoticeController_update: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["ContentDraft"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  NoticeController_delete: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  NoticeController_offline: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["ContentVersion"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  NoticeController_publications: {
    parameters: {
      query?: {
        page?: number;
        size?: number;
      };
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  NoticeController_publish: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["Publish"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  NoticeController_purge: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  NoticeController_restore: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["ContentVersion"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  NoticeController_revisions: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  ContentFileController_managed: {
    parameters: {
      query?: {
        image?: boolean;
      };
      header?: never;
      path: {
        fileId: number;
        id: number;
        revisionId: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": Record<string, never>;
        };
      };
    };
  };
  NoticeController_recycle: {
    parameters: {
      query?: {
        keyword?: string;
        page?: number;
        size?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  CrawlController_list: {
    parameters: {
      query?: {
        keyword?: string;
        page?: number;
        size?: number;
        status?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  CrawlController_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["CrawlerConfigEdit"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  CrawlController_detail: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  CrawlController_update: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["CrawlerConfigEdit"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  CrawlController_delete: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  CrawlController_articles: {
    parameters: {
      query?: {
        keyword?: string;
        page?: number;
        size?: number;
      };
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  CrawlController_article: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        articleId: number;
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  CrawlController_items: {
    parameters: {
      query?: {
        kind?: string;
        page?: number;
        size?: number;
        status?: string;
      };
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  CrawlController_image: {
    parameters: {
      query?: {
        download?: boolean;
      };
      header?: never;
      path: {
        id: number;
        itemId: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": string;
        };
      };
    };
  };
  CrawlController_retry: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["CrawlerConfigVersion"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  CrawlController_start: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["CrawlerConfigVersion"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  CrawlController_stop: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["CrawlerConfigVersion"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  CrawlController_articleCards: {
    parameters: {
      query?: {
        keyword?: string;
        page?: number;
        size?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  CrawlController_preview: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["CrawlRules"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  DashboardController_dashboard: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  FeedbackController_list: {
    parameters: {
      query?: {
        keyword?: string;
        page?: number;
        size?: number;
        status?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponsePageResultFeedbackAdminView"];
        };
      };
    };
  };
  FeedbackController_detail: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseFeedbackAdminView"];
        };
      };
    };
  };
  FeedbackController_process: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["FeedbackProcess"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseFeedbackAdminView"];
        };
      };
    };
  };
  FeedbackController_assignees: {
    parameters: {
      query?: {
        keyword?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseListFeedbackAssignee"];
        };
      };
    };
  };
  FileController_list: {
    parameters: {
      query?: {
        deleted?: boolean;
        directoryId?: number;
        keyword?: string;
        page?: number;
        size?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponsePageResultStoredFile"];
        };
      };
    };
  };
  FileController_upload: {
    parameters: {
      query?: {
        directoryId?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: {
      content: {
        "application/json": {
          /** Format: binary */
          file: string;
        };
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseStoredFile"];
        };
      };
    };
  };
  FileController_detail: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseStoredFile"];
        };
      };
    };
  };
  FileController_recycle: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseVoid"];
        };
      };
    };
  };
  FileController_download: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": string;
        };
      };
    };
  };
  FileController_preview: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": string;
        };
      };
    };
  };
  FileController_thumbnail: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": string;
        };
      };
    };
  };
  FileController_batch: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["BatchEdit"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseBatchResult"];
        };
      };
    };
  };
  FileController_directories: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseListFileDirectory"];
        };
      };
    };
  };
  FileController_createDirectory: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["DirectoryEdit"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseFileDirectory"];
        };
      };
    };
  };
  FileController_updateDirectory: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["DirectoryEdit"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseFileDirectory"];
        };
      };
    };
  };
  FileController_deleteDirectory: {
    parameters: {
      query: {
        version: number;
      };
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseVoid"];
        };
      };
    };
  };
  FileController_storageInfo: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseStorageInfo"];
        };
      };
    };
  };
  JobController_logs: {
    parameters: {
      query?: {
        jobId?: number;
        keyword?: string;
        page?: number;
        size?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponsePageResultJobExecution"];
        };
      };
    };
  };
  MessageController_inbox: {
    parameters: {
      query?: {
        keyword?: string;
        page?: number;
        read?: boolean;
        size?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  MessageController_message: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  MessageController_read: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  NotificationAttachmentController_received: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        fileId: number;
        messageId: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": string;
        };
      };
    };
  };
  MessageController_readAll: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  MessageController_unread: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  MonitorController_status: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseMonitorSnapshot"];
        };
      };
    };
  };
  MonitorController_history: {
    parameters: {
      query?: {
        minutes?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseListMonitorHistoryPoint"];
        };
      };
    };
  };
  MonitorController_policy: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseMonitorPolicyView"];
        };
      };
    };
  };
  MonitorController_configure: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["MonitorPolicyEdit"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseMonitorPolicyView"];
        };
      };
    };
  };
  MonitorController_recipients: {
    parameters: {
      query?: {
        keyword?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseListAlertRecipientOption"];
        };
      };
    };
  };
  MessageController_list: {
    parameters: {
      query?: {
        keyword?: string;
        page?: number;
        size?: number;
        status?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  MessageController_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["NotificationDraft"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  MessageController_detail: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  MessageController_update: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["NotificationDraft"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  MessageController_delete: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  MessageController_copy: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  MessageController_publish: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["NotificationVersion"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  MessageController_recipients: {
    parameters: {
      query?: {
        page?: number;
        size?: number;
      };
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  MessageController_withdraw: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["NotificationVersion"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  NotificationAttachmentController_managed: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        fileId: number;
        notificationId: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": string;
        };
      };
    };
  };
  MessageController_options: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        kind: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  MessageController_people: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  RealtimeController_stream: {
    parameters: {
      query?: never;
      header: {
        Authorization: string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "text/event-stream": components["schemas"]["SseEmitter"];
        };
      };
    };
  };
  WorkflowController_requests: {
    parameters: {
      query?: {
        box?: string;
        keyword?: string;
        page?: number;
        size?: number;
        status?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  WorkflowController_submit: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["WorkflowSubmission"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  WorkflowController_request: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  WorkflowController_edit: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["Edit"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  WorkflowController_discardDraft: {
    parameters: {
      query: {
        version: number;
      };
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseVoid"];
        };
      };
    };
  };
  WorkflowController_readCopies: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseVoid"];
        };
      };
    };
  };
  WorkflowController_decide: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["Action"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  WorkflowController_events: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  WorkflowFileController_download: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        fileId: number;
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": string;
        };
      };
    };
  };
  WorkflowController_history: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  WorkflowController_remind: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["WorkflowVersionRequest"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseVoid"];
        };
      };
    };
  };
  WorkflowController_retry: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  WorkflowController_resubmit: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["Edit"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  ContentFileController_approval: {
    parameters: {
      query?: {
        image?: boolean;
      };
      header?: never;
      path: {
        fileId: number;
        requestId: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": Record<string, never>;
        };
      };
    };
  };
  WorkflowController_draft: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["WorkflowSubmission"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  JobController_list: {
    parameters: {
      query?: {
        enabled?: boolean;
        keyword?: string;
        page?: number;
        size?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponsePageResultScheduledJob"];
        };
      };
    };
  };
  JobController_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["ScheduledJobEdit"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseScheduledJob"];
        };
      };
    };
  };
  JobController_update: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["ScheduledJobEdit"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseScheduledJob"];
        };
      };
    };
  };
  JobController_delete: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseVoid"];
        };
      };
    };
  };
  JobController_run: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseJobExecution"];
        };
      };
    };
  };
  JobController_handlers: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseMapStringString"];
        };
      };
    };
  };
  JobController_recipients: {
    parameters: {
      query?: {
        keyword?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseListAlertRecipientOption"];
        };
      };
    };
  };
  SessionController_list: {
    parameters: {
      query?: {
        keyword?: string;
        page?: number;
        size?: number;
      };
      header: {
        Authorization: string;
      };
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  SessionController_revoke: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  WorkflowController_definitions: {
    parameters: {
      query?: {
        categoryId?: number;
        enabled?: boolean;
        keyword?: string;
        page?: number;
        size?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  WorkflowController_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["WorkflowDraft"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  WorkflowController_detail: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  WorkflowController_update: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["WorkflowDraft"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  WorkflowController_delete: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  WorkflowController_publish: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["WorkflowVersionRequest"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  WorkflowController_versions: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  WorkflowController_options: {
    parameters: {
      query?: {
        businessType?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  WorkflowController_roleOptions: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  WorkflowController_simulate: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["Simulation"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  WorkflowController_templates: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseListTemplate"];
        };
      };
    };
  };
  PlatformController_features: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseFeatureView"];
        };
      };
    };
  };
  PublicController_list: {
    parameters: {
      query?: {
        category?: string;
        categoryId?: number;
        keyword?: string;
        page?: number;
        recommended?: boolean;
        size?: number;
        tagId?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": Record<string, never>;
        };
      };
    };
  };
  PublicController_detail: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": Record<string, never>;
        };
      };
    };
  };
  ContentFileController_cover: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": Record<string, never>;
        };
      };
    };
  };
  ContentFileController_attachment: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        fileId: number;
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": Record<string, never>;
        };
      };
    };
  };
  PublicController_recordView: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": Record<string, never>;
        };
      };
    };
  };
  PublicFeedbackController_submit: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["FeedbackSubmit"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseFeedbackReceipt"];
        };
      };
    };
  };
  PublicFeedbackController_track: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["Track"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseFeedbackPublicView"];
        };
      };
    };
  };
  PublicController_site: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  PublicController_taxonomy: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  RelayController_config: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  RelayController_save: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["RelaySettingsEdit"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  RelayController_interfaces: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  RelayController_start: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["Start"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  RelayController_stats: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  RelayController_stop: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["Stop"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  ChangeAuditController_list: {
    parameters: {
      query?: {
        keyword?: string;
        page?: number;
        size?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponsePageResultChangeAuditView"];
        };
      };
    };
  };
  ChangeAuditController_detail: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseChangeAuditView"];
        };
      };
    };
  };
  DictionaryController_list: {
    parameters: {
      query?: {
        enabled?: boolean;
        keyword?: string;
        page?: number;
        size?: number;
      };
      header?: never;
      path: {
        typeId: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  DictionaryController_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        typeId: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["DictionaryItemEdit"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  DictionaryController_update: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
        typeId: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["DictionaryItemEdit"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  DictionaryController_delete: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
        typeId: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  DictionaryController_options: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        code: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  EntryController_list: {
    parameters: {
      query?: {
        enabled?: boolean;
        groupName?: string;
        keyword?: string;
        page?: number;
        size?: number;
      };
      header?: never;
      path: {
        kind: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  EntryController_create: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        kind: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["EntryRequest"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  EntryController_update: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
        kind: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["EntryRequest"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  EntryController_delete: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
        kind: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  AuditController_list: {
    parameters: {
      query?: {
        from?: string;
        keyword?: string;
        loginOnly?: boolean;
        page?: number;
        size?: number;
        success?: boolean;
        to?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  AuditController_clean: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["Cleanup"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  AuditController_detail: {
    parameters: {
      query?: {
        loginOnly?: boolean;
      };
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  AuditController_export: {
    parameters: {
      query?: {
        from?: string;
        keyword?: string;
        loginOnly?: boolean;
        page?: number;
        success?: boolean;
        to?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  LookupController_lookups: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  LookupController_navigation: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  LookupController_options: {
    parameters: {
      query?: {
        keyword?: string;
        page?: number;
        size?: number;
      };
      header?: never;
      path: {
        kind: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  RoleController_list: {
    parameters: {
      query?: {
        keyword?: string;
        page?: number;
        size?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  RoleController_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["RoleRequest"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  RoleController_update: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["RoleRequest"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  RoleController_delete: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  RoleController_permissions: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  SiteConfigController_get: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  SiteConfigController_update: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": {
          [key: string]: components["schemas"]["Value"];
        };
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  SiteConfigController_refresh: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  UserStatisticsController_statistics: {
    parameters: {
      query?: {
        days?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  UserController_list: {
    parameters: {
      query?: {
        departmentId?: number;
        enabled?: boolean;
        keyword?: string;
        page?: number;
        size?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponsePageResultUserView"];
        };
      };
    };
  };
  UserController_create: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["UserRequest"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseUserView"];
        };
      };
    };
  };
  UserController_update: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["UserRequest"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseUserView"];
        };
      };
    };
  };
  UserController_delete: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  UserController_reset: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        id: number;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["ResetPasswordRequest"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
  UserController_export: {
    parameters: {
      query?: {
        departmentId?: number;
        enabled?: boolean;
        keyword?: string;
        page?: number;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponsePageResultUserView"];
        };
      };
    };
  };
  UserController_status: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["UserStatusRequest"];
      };
    };
    responses: {
      /** @description OK */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ApiResponseObject"];
        };
      };
    };
  };
}
