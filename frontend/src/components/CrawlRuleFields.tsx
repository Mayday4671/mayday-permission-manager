import { Form, Input, InputNumber, Select, Switch } from "antd";
import type { FormInstance } from "antd";
import type { CrawlPageRule } from "../types/crawler";

/** 标题、正文、作者和日期共用字段定位表单；格式随真正的文章页面（入口或详情）切换。 */
export function CrawlArticleFields({ form }: { form: FormInstance }) {
  const enabled = Form.useWatch(["rules", "article", "enabled"], form);
  const enter = Form.useWatch(["rules", "enterDetails"], form);
  const rules = Form.useWatch("rules", form);
  const json = (enter ? rules?.detail?.format : rules?.list?.format) === "JSON";
  return (
    <>
      <Form.Item
        name={["rules", "article", "enabled"]}
        label="同时采集文章"
        valuePropName="checked"
        extra="同篇详情分页归为一篇文章；卡片显示标题、摘要和已保存配图。"
      >
        <Switch />
      </Form.Item>
      <div className="form-two-columns">
        {(
          [
            ["title", "标题", "h1", "/title"],
            ["author", "作者", "[rel=author]", "/author"],
            ["content", "正文", ".entry-content", "/content"],
            ["publishedAt", "发表时间", "time[datetime]", "/publishedAt"],
          ] as const
        ).map(([key, label, css, pointer]) => (
          <Form.Item
            key={key}
            name={["rules", "article", key]}
            label={`${label}${json ? " JSON 路径" : "选择器"}`}
            extra={json ? `留空读取 ${pointer}` : `留空自动识别；可填 ${css}`}
          >
            <Input
              disabled={!enabled}
              maxLength={256}
              placeholder={json ? pointer : css}
            />
          </Form.Item>
        ))}
      </div>
      <p className="muted">
        正文保存段落文本，配图单独展示。来源没有正文时只保存标题和图片，不生成文章内容。
      </p>
    </>
  );
}

/** 列表和详情的分页表单使用同一组件，字段结构与后端 PageRule 一致。 */
export function CrawlPaginationFields({
  level,
  form,
}: {
  level: "list" | "detail";
  form: FormInstance;
}) {
  const format = Form.useWatch(["rules", level, "format"], form);
  const mode = Form.useWatch(["rules", level, "mode"], form);
  const enterDetails = Form.useWatch(["rules", "enterDetails"], form);
  const required = [{ required: level === "list" || !!enterDetails }];
  const path = (key: keyof CrawlPageRule) => ["rules", level, key];
  return (
    <>
      <div className="form-two-columns">
        <Form.Item name={path("format")} label="响应格式">
          <Select
            onChange={(value) => {
              if (value === "HTML" && mode === "CURSOR")
                form.setFieldValue(path("mode"), "SINGLE");
            }}
            options={[
              { value: "HTML", label: "HTML 网页" },
              { value: "JSON", label: "JSON 数据接口" },
            ]}
          />
        </Form.Item>
        <Form.Item name={path("mode")} label="分页方式">
          <Select
            options={[
              { value: "SINGLE", label: "只采集当前页" },
              { value: "NEXT", label: "下一页链接" },
              { value: "LINKS", label: "页码链接集合" },
              { value: "TEMPLATE", label: "页码 / 偏移量模板" },
              {
                value: "CURSOR",
                label: "游标接口",
                disabled: format !== "JSON",
              },
            ]}
          />
        </Form.Item>
      </div>
      {format === "HTML" && ["NEXT", "LINKS"].includes(mode) && (
        <Form.Item
          name={path("selector")}
          label="分页链接选择器"
          rules={required}
          extra="选择带 href 的链接，例如 .pagination a.next 或 .pagination a。"
        >
          <Input maxLength={256} placeholder="a[rel=next]" />
        </Form.Item>
      )}
      {["TEMPLATE", "CURSOR"].includes(mode) && (
        <Form.Item
          name={path("template")}
          label="下一页地址模板"
          rules={required}
          extra="支持 {page}、{cursor}、{url}（组首页）、{base}（组首页去扩展名及查询）、{origin}（协议与域名）。第一页始终使用入口或详情原地址。"
        >
          <Input
            maxLength={2000}
            placeholder="https://example.com/list?page={page}"
          />
        </Form.Item>
      )}
      {mode === "TEMPLATE" && (
        <div className="form-two-columns">
          <Form.Item
            name={path("start")}
            label="第一页页码 / 偏移量"
            rules={required}
          >
            <InputNumber min={0} max={1000000} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name={path("step")} label="每次递增" rules={required}>
            <InputNumber min={1} max={1000} style={{ width: "100%" }} />
          </Form.Item>
        </div>
      )}
      {mode !== "SINGLE" && (
        <Form.Item
          name={path("maxPages")}
          label={
            level === "detail" ? "每篇详情最多采集页数" : "最多采集列表页数"
          }
          rules={required}
        >
          <InputNumber min={1} max={100} />
        </Form.Item>
      )}
      {format === "JSON" && (
        <>
          {["NEXT", "LINKS", "CURSOR"].includes(mode) && (
            <Form.Item
              name={path("nextPointer")}
              label={mode === "CURSOR" ? "下一游标路径" : "下一页 URL 路径"}
              rules={required}
              extra="使用 JSON Pointer，例如 /data/nextCursor；为空或缺失时停止翻页。"
            >
              <Input maxLength={256} />
            </Form.Item>
          )}
          {level === "list" && (
            <Form.Item
              name={path("detailsPointer")}
              label="详情链接数组路径"
              extra="进入详情模式使用，例如 /data/items；数组项可以是地址字符串或对象。"
            >
              <Input maxLength={256} />
            </Form.Item>
          )}
          <Form.Item
            name={path("imagesPointer")}
            label="图片数组路径"
            extra="直接采图时使用，例如 /data/images。"
          >
            <Input maxLength={256} />
          </Form.Item>
          <Form.Item
            name={path("urlPointer")}
            label="数组对象中的 URL 路径"
            extra="字符串数组留空；对象数组可填写 /url。"
          >
            <Input maxLength={256} />
          </Form.Item>
        </>
      )}
    </>
  );
}
export function CrawlImageFields() {
  return (
    <>
      <Form.Item
        name={["rules", "imageSelector"]}
        label="图片选择器"
        rules={[{ required: true }]}
        extra="例如 article img、.gallery img、a.original；JSON 模式使用各页规则中的图片数组路径。"
      >
        <Input maxLength={256} />
      </Form.Item>
      <Form.Item
        name={["rules", "imageAttributes"]}
        label="图片地址属性（按优先级）"
        rules={[{ required: true }]}
        extra="逐项尝试，取第一个有效地址；srcset 选择最大的候选图。可输入网站自己的懒加载属性。"
      >
        <Select mode="tags" tokenSeparators={[","]} />
      </Form.Item>
      <Form.Item
        name={["rules", "imageHosts"]}
        label="额外图片域名"
        extra="入口域名自动允许；CDN 填准确域名，例如 img.example.com，不填协议或通配符。"
      >
        <Select mode="tags" tokenSeparators={[",", " "]} />
      </Form.Item>
      <div className="form-two-columns">
        <Form.Item
          name={["rules", "maxDetails"]}
          label="最多进入详情篇数"
          rules={[{ required: true }]}
        >
          <InputNumber min={1} max={200} />
        </Form.Item>
        <Form.Item
          name={["rules", "maxImages"]}
          label="图片地址数量上限"
          rules={[{ required: true }]}
        >
          <InputNumber min={1} max={500} />
        </Form.Item>
      </div>
      <Form.Item
        name={["rules", "intervalMs"]}
        label="请求间隔（毫秒）"
        rules={[{ required: true }]}
        extra="单张图片最多 8 MB；每个任务最多保存 200 MB。"
      >
        <InputNumber min={500} max={10000} step={500} />
      </Form.Item>
    </>
  );
}
export function CrawlBasicFields({ form }: { form: FormInstance }) {
  const enter = Form.useWatch(["rules", "enterDetails"], form);
  return (
    <>
      <Form.Item
        name="name"
        label="配置名称"
        rules={[{ required: true, whitespace: true }]}
      >
        <Input maxLength={100} />
      </Form.Item>
      <Form.Item
        name={["rules", "entryUrl"]}
        label="入口页面 / 接口地址"
        rules={[
          { required: true },
          { type: "url", message: "请输入完整的 HTTP/HTTPS 地址" },
        ]}
      >
        <Input maxLength={2000} placeholder="https://example.com/gallery" />
      </Form.Item>
      <Form.Item
        name={["rules", "enterDetails"]}
        label="先进入详情页采集"
        valuePropName="checked"
      >
        <Switch />
      </Form.Item>
      {enter && (
        <Form.Item
          name={["rules", "detailSelector"]}
          label="详情链接选择器"
          rules={[{ required: true }]}
          extra="仅用于 HTML 列表，例如 .article-list a.title；详情中的图片分页在“详情分页”里配置。"
        >
          <Input maxLength={256} />
        </Form.Item>
      )}
    </>
  );
}
