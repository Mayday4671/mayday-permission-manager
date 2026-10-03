package com.mayday.web;

import com.mayday.common.ApiResponse;
import com.mayday.service.PortalStructureService;
import com.mayday.service.PortalStructureService.ChannelDraft;
import com.mayday.service.PortalStructureService.ChannelView;
import com.mayday.service.PortalStructureService.HomeDraft;
import com.mayday.service.PortalStructureService.HomeView;
import com.mayday.service.PortalStructureService.ThemePolicyDraft;
import jakarta.validation.Valid;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** 门户配置接口与内容编辑选项分开授权；所有写入再次由应用服务核验原版本和关联。 */
@RestController
@RequestMapping("/api/portal-management")
@RequiredArgsConstructor
public class PortalStructureController {
  private final PortalStructureService service;

  /** 栏目关联选项复用共享分类资料，只输出最小名称和归属信息。 */
  @GetMapping("/category-options")
  public ApiResponse<java.util.List<PortalStructureService.CategoryOption>> categoryOptions() {
    return ApiResponse.ok(service.categoryOptions());
  }

  /** 返回管理栏目列表，包含停用项与有序分类。 */
  @GetMapping("/channels")
  public ApiResponse<List<ChannelView>> channels() {
    return ApiResponse.ok(service.management());
  }

  /** 新增独立栏目，不自动根据分类名称生成导航。 */
  @PostMapping("/channels")
  public ApiResponse<ChannelView> create(@Valid @RequestBody ChannelDraft input) {
    return ApiResponse.ok(service.save(null, input));
  }

  /** 修改栏目和分类归属，保护已有访问名称及引用快照。 */
  @PutMapping("/channels/{id}")
  public ApiResponse<ChannelView> update(
      @PathVariable Long id, @Valid @RequestBody ChannelDraft input) {
    return ApiResponse.ok(service.save(id, input));
  }

  /** 版本匹配且无分类/修订引用才允许删除。 */
  @DeleteMapping("/channels/{id}")
  public ApiResponse<Void> delete(@PathVariable Long id, @RequestParam Long version) {
    service.delete(id, version);
    return ApiResponse.ok(null);
  }

  /** 读取首页编排与访客主题策略，配置版本独立于文章版本。 */
  @GetMapping("/home")
  public ApiResponse<HomeView> home() {
    return ApiResponse.ok(service.home(true));
  }

  /** 只调整首页选用内容，不能借此发布草稿。 */
  @PutMapping("/home")
  public ApiResponse<HomeView> saveHome(@Valid @RequestBody HomeDraft input) {
    return ApiResponse.ok(service.saveHome(input));
  }

  /** 主题更新不接收文章编号，不能借此改变首页内容或绕过内容范围检查。 */
  @PutMapping("/theme-policy")
  public ApiResponse<HomeView> saveThemePolicy(@Valid @RequestBody ThemePolicyDraft input) {
    return ApiResponse.ok(service.saveThemePolicy(input));
  }
}
