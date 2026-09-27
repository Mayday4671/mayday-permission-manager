-- 采集文章和配图关联。保留 V13 原任务、图片和授权；旧结果不伪造正文，重新采集后才生成文章。
CREATE TABLE `crawl_article` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '采集文章主键；由数据库自增，仅用于本系统结果关联',
  `created_at` datetime(6) NOT NULL COMMENT '首次成功解析文章页面的入库时间；北京时间，微秒精度',
  `updated_at` datetime(6) NOT NULL COMMENT '最近一次文章标题、摘要或来源信息更新时间',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；文章写入同时持有所属任务行锁',
  `task_id` bigint NOT NULL COMMENT '所属采集任务；读取文章前必须校验任务权限和所有者',
  `source_url` varchar(2000) NOT NULL COMMENT '文章分页组首页的规范化公开地址；后续详情分页归入同一文章',
  `source_hash` varchar(64) NOT NULL COMMENT '来源首页 URL 的 SHA-256；与任务 ID 组成唯一键，防止重试生成重复文章',
  `title` varchar(200) NOT NULL COMMENT '文章标题纯文本；优先配置字段，再读取 h1、OG 标题或网页标题',
  `summary` varchar(300) NOT NULL COMMENT '正文开头的纯文本摘要；压缩空白后最多 300 字符，无正文时为空字符串',
  `author` varchar(100) NOT NULL COMMENT '来源作者原始文本；不映射本系统账号，无法识别时为空字符串',
  `published_at` varchar(100) NOT NULL COMMENT '来源发表时间文本；保留原格式而不推测时区，无法识别时为空字符串',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_crawl_article_source` (`task_id`,`source_hash`),
  CONSTRAINT `fk_crawl_article_task` FOREIGN KEY (`task_id`) REFERENCES `crawl_task` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='采集文章标题、摘要和来源元数据；同篇分页只生成一张文章卡片';

ALTER TABLE `crawl_item`
  MODIFY COLUMN `bytes` bigint NOT NULL COMMENT '成功保存或引用图片的字节数；旧版重复记录、网页及失败项可能为零',
  ADD COLUMN `article_id` bigint DEFAULT NULL COMMENT '成功页面所属采集文章 ID；图片通过独立关联表关联文章，旧记录为空',
  ADD COLUMN `article_body` mediumtext DEFAULT NULL COMMENT '当前分页的正文纯文本；移除脚本、表单和导航，每页最多 20000 字符，不保存远端可执行 HTML',
  ADD COLUMN `body_truncated` bit(1) NOT NULL DEFAULT b'0' COMMENT '正文是否超出单页上限而被截断；详情必须向用户提示，旧记录默认否',
  ADD KEY `idx_crawl_item_article` (`article_id`,`ordinal`,`id`),
  ADD CONSTRAINT `fk_crawl_item_article` FOREIGN KEY (`article_id`) REFERENCES `crawl_article` (`id`);

CREATE TABLE `crawl_article_image` (
  `id` bigint NOT NULL AUTO_INCREMENT COMMENT '文章图片关联主键；不保存图片二进制',
  `created_at` datetime(6) NOT NULL COMMENT '首次在文章页面发现此图片引用的时间',
  `updated_at` datetime(6) NOT NULL COMMENT '关联记录最近变更时间；北京时间，微秒精度',
  `version` bigint DEFAULT NULL COMMENT 'JPA 乐观锁版本；关联更改同时持有任务行锁',
  `article_id` bigint NOT NULL COMMENT '所属采集文章 ID；同一图片可以被多篇文章分别引用',
  `item_id` bigint NOT NULL COMMENT '对应 IMAGE 队列项 ID；下载完成后通过其 file_id 读取文件，失败时保留关联供重试',
  `sort_order` int NOT NULL COMMENT '配图顺序：来源页遍历序号乘 1000 加页面内发现序号；封面取最早成功的不同图片',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_crawl_article_image` (`article_id`,`item_id`),
  KEY `idx_crawl_article_image_order` (`article_id`,`sort_order`,`id`),
  CONSTRAINT `fk_crawl_image_article` FOREIGN KEY (`article_id`) REFERENCES `crawl_article` (`id`),
  CONSTRAINT `fk_crawl_image_item` FOREIGN KEY (`item_id`) REFERENCES `crawl_item` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='采集文章与图片队列的多对多引用；图片地址及内容去重不丢失文章配图关系';
