import { Pencil, Search, Tags, X } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { deleteAdminTagAction, saveAdminTagAction } from "../actions";
import { AdminFrame } from "../AdminFrame";
import { listTagGroups, listTags, type Tag, type TagGroup } from "@/lib/tags";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type AdminTagsPageProps = {
  searchParams: Promise<{
    edit?: string;
    q?: string;
    notice?: string;
    tone?: "success" | "warning" | "error";
  }>;
};

function ParentSelect({ tags, current }: { tags: Tag[]; current?: Tag }) {
  const rootTags = tags.filter((tag) => !tag.parentId && tag.id !== current?.id);
  return (
    <select name="parentId" defaultValue={current?.parentId || ""}>
      <option value="">顶级分组</option>
      {rootTags.map((tag) => (
        <option value={tag.id} key={tag.id}>
          {tag.name}
        </option>
      ))}
    </select>
  );
}

function tagMatches(tag: Tag, query: string): boolean {
  if (!query) return true;
  const searchable = [tag.name, tag.slug, tag.description, ...tag.aliases].join("\n").toLocaleLowerCase();
  return searchable.includes(query);
}

function filterTagGroups(groups: TagGroup[], query: string): TagGroup[] {
  if (!query) return groups;
  return groups.flatMap((group) => {
    const groupMatches = group.group ? tagMatches(group.group, query) : false;
    const tags = groupMatches ? group.tags : group.tags.filter((tag) => tagMatches(tag, query));
    return groupMatches || tags.length ? [{ ...group, tags }] : [];
  });
}

function managerHref(tagId: number, query: string): string {
  const params = new URLSearchParams({ edit: String(tagId) });
  if (query) params.set("q", query);
  return `/admin/tags?${params.toString()}#tag-editor`;
}

function managerReturnPath(tagId: number | null, query: string): string {
  const params = new URLSearchParams();
  if (tagId) params.set("edit", String(tagId));
  if (query) params.set("q", query);
  return `/admin/tags${params.size ? `?${params.toString()}` : ""}`;
}

export default async function AdminTagsPage({ searchParams }: AdminTagsPageProps) {
  const params = await searchParams;
  const query = (params.q || "").trim().slice(0, 80);
  const normalizedQuery = query.toLocaleLowerCase();
  const tags = listTags({ includeHidden: true });
  const groups = filterTagGroups(listTagGroups({ includeHidden: true }), normalizedQuery);
  const editId = Number(params.edit || 0);
  const selectedTag = Number.isInteger(editId) && editId > 0 ? tags.find((tag) => tag.id === editId) || null : null;

  return (
    <AdminFrame active="tags" notice={params.notice} tone={params.tone}>
      <article className="adminPanel adminTagsPanel">
        <div className="adminPanelHeader">
          <div>
            <h2>标签管理</h2>
            <p>从标签树选择一项进行编辑；搜索可匹配名称、别名和描述。</p>
          </div>
          <Tags size={20} aria-hidden="true" />
        </div>

        <form className="adminTagSearchForm" action="/admin/tags">
          <Search size={16} aria-hidden="true" />
          <input name="q" defaultValue={query} maxLength={80} placeholder="搜索标签、别名或描述" aria-label="搜索标签" />
          {query ? (
            <Link href="/admin/tags" aria-label="清除标签搜索" title="清除搜索">
              <X size={15} aria-hidden="true" />
            </Link>
          ) : null}
          <button type="submit">搜索</button>
        </form>

        <section className="adminSettingsSection adminTagTreePreview">
          <div className="adminTagSectionTitle">
            <h3>标签树</h3>
            <small>{query ? `找到 ${groups.reduce((count, group) => count + group.tags.length + Number(Boolean(group.group)), 0)} 项` : `共 ${tags.length} 项`}</small>
          </div>
          {groups.length ? (
            <div className="tagGroupStack">
              {groups.map((group) => (
                <section className="tagGroupBlock" key={group.group?.id || "ungrouped"}>
                  <div className="tagGroupHeader">
                    {group.group ? (
                      <Link
                        className={selectedTag?.id === group.group.id ? "adminTagTreeEditLink isActive" : "adminTagTreeEditLink"}
                        href={managerHref(group.group.id, query)}
                        title={`编辑 ${group.group.name}`}
                      >
                        <h4>{group.group.name}</h4>
                        <Pencil size={13} aria-hidden="true" />
                      </Link>
                    ) : (
                      <h4>未分组</h4>
                    )}
                    <small>{group.tags.length} 个子标签</small>
                  </div>
                  {group.tags.length ? (
                    <div className="tagChipCloud">
                      {group.tags.map((tag) => (
                        <Link
                          className={`${tag.isVisible ? "tagChip" : "tagChip isMuted"}${selectedTag?.id === tag.id ? " isActive" : ""}`}
                          href={managerHref(tag.id, query)}
                          title={`编辑 ${tag.name}`}
                          key={tag.id}
                        >
                          <span>{tag.name}</span>
                          <small>{tag.directCount}</small>
                          <Pencil size={12} aria-hidden="true" />
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <p className="adminInlineMessage">暂无子标签。</p>
                  )}
                </section>
              ))}
            </div>
          ) : (
            <p className="adminInlineMessage">{query ? "没有匹配的标签。" : "还没有标签，先创建一个顶级分组或子标签。"}</p>
          )}
        </section>

        <section className="adminSettingsSection adminTagEditSection" id="tag-editor">
          <div className="adminTagSectionTitle">
            <h3>{selectedTag ? `编辑 ${selectedTag.name}` : "编辑标签"}</h3>
            {selectedTag ? <Pencil size={16} aria-hidden="true" /> : null}
          </div>
          {selectedTag ? (
            <form className={selectedTag.parentId ? "adminTagEditorForm" : "adminTagEditorForm isRoot"} action={saveAdminTagAction}>
              <input name="tagId" type="hidden" value={selectedTag.id} />
              <input name="returnPath" type="hidden" value={managerReturnPath(selectedTag.id, query)} />
              <div className="adminTagFormGrid">
                <label>
                  <span>名称</span>
                  <input name="name" maxLength={40} defaultValue={selectedTag.name} required />
                </label>
                <label>
                  <span>父级</span>
                  <ParentSelect tags={tags} current={selectedTag} />
                </label>
                <label>
                  <span>链接标识</span>
                  <input name="slug" maxLength={64} defaultValue={selectedTag.slug} />
                </label>
                <label>
                  <span>排序</span>
                  <input name="sortOrder" type="number" defaultValue={selectedTag.sortOrder} />
                </label>
              </div>
              <label className="adminTagAliasesField">
                <span>别名</span>
                <textarea name="aliases" rows={2} maxLength={800} defaultValue={selectedTag.aliases.join("、")} placeholder="多个别名用逗号或换行分隔" />
              </label>
              <label className="adminTagDescriptionField">
                <span>描述</span>
                <textarea name="description" rows={5} maxLength={240} defaultValue={selectedTag.description} placeholder="说明标签含义、范围或使用边界" />
              </label>
              <label className="adminSwitchLabel">
                <span>
                  <strong>启用展示</strong>
                  <small>关闭后前台标签页和阅读页不会展示这个标签。</small>
                </span>
                <input name="isVisible" type="checkbox" defaultChecked={selectedTag.isVisible} />
              </label>
              <div className="adminTagEditorActions">
                <button type="submit">保存</button>
                <button className="adminDangerButton" type="submit" formAction={deleteAdminTagAction} formNoValidate>
                  删除
                </button>
              </div>
            </form>
          ) : (
            <p className="adminTagEditHint"><Pencil size={16} aria-hidden="true" />点击上方标签或分组即可编辑。</p>
          )}
        </section>

        <details className="adminSettingsSection adminTagCreateDisclosure">
          <summary>新建标签</summary>
          <form className="adminTagCreateForm" action={saveAdminTagAction}>
            <input name="returnPath" type="hidden" value={managerReturnPath(null, query)} />
            <div className="adminTagFormGrid">
              <label>
                <span>名称</span>
                <input name="name" maxLength={40} required />
              </label>
              <label>
                <span>父级</span>
                <ParentSelect tags={tags} />
              </label>
              <label>
                <span>链接标识</span>
                <input name="slug" maxLength={64} placeholder="留空自动生成" />
              </label>
              <label>
                <span>排序</span>
                <input name="sortOrder" type="number" defaultValue="0" />
              </label>
            </div>
            <label>
              <span>别名</span>
              <textarea name="aliases" rows={2} maxLength={800} placeholder="多个别名用逗号或换行分隔" />
            </label>
            <label>
              <span>描述</span>
              <textarea name="description" rows={4} maxLength={240} placeholder="说明标签含义、范围或使用边界" />
            </label>
            <label className="adminSwitchLabel">
              <span>
                <strong>启用展示</strong>
                <small>关闭后前台标签页和阅读页不会展示这个标签。</small>
              </span>
              <input name="isVisible" type="checkbox" defaultChecked />
            </label>
            <button type="submit">创建标签</button>
          </form>
        </details>
      </article>
    </AdminFrame>
  );
}
