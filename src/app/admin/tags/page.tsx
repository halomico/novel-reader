import { Tags } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { deleteAdminTagAction, saveAdminTagAction } from "../actions";
import { AdminFrame } from "../AdminFrame";
import { listTagGroups, listTags, type Tag } from "@/lib/tags";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

type AdminTagsPageProps = {
  searchParams: Promise<{
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

export default async function AdminTagsPage({ searchParams }: AdminTagsPageProps) {
  const params = await searchParams;
  const tags = listTags({ includeHidden: true });
  const groups = listTagGroups({ includeHidden: true });

  return (
    <AdminFrame active="tags" notice={params.notice} tone={params.tone}>
      <article className="adminPanel adminTagsPanel">
        <div className="adminPanelHeader">
          <div>
            <h2>标签管理</h2>
            <p>维护标签分组和子标签；阅读页和标签页只展示已启用的标签。</p>
          </div>
          <Tags size={20} aria-hidden="true" />
        </div>

        <section className="adminSettingsSection adminTagTreePreview">
          <h3>标签树</h3>
          {groups.length ? (
            <div className="tagGroupStack">
              {groups.map((group) => (
                <section className="tagGroupBlock" key={group.group?.id || "ungrouped"}>
                  <div className="tagGroupHeader">
                    <h4>{group.group?.name || "未分组"}</h4>
                    <small>{group.tags.length} 个子标签</small>
                  </div>
                  {group.tags.length ? (
                    <div className="tagChipCloud">
                      {group.tags.map((tag) => (
                        <Link className={tag.isVisible ? "tagChip" : "tagChip isMuted"} href={`/tags/${tag.slug}`} key={tag.id}>
                          <span>{tag.name}</span>
                          <small>{tag.directCount}</small>
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
            <p className="adminInlineMessage">还没有标签，先创建一个顶级分组或子标签。</p>
          )}
        </section>

        <form className="adminSettingsSection adminTagCreateForm" action={saveAdminTagAction}>
          <h3>新建标签</h3>
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
            <span>说明</span>
            <textarea name="description" rows={2} maxLength={240} />
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

        <section className="adminSettingsSection adminTagEditSection">
          <h3>编辑标签</h3>
          {tags.length ? (
            <div className="adminTagEditList">
              {tags.map((tag) => (
                <form className={tag.parentId ? "adminTagEditRow" : "adminTagEditRow isRoot"} action={saveAdminTagAction} key={tag.id}>
                  <input name="tagId" type="hidden" value={tag.id} />
                  <label>
                    <span>名称</span>
                    <input name="name" maxLength={40} defaultValue={tag.name} required />
                  </label>
                  <label>
                    <span>父级</span>
                    <ParentSelect tags={tags} current={tag} />
                  </label>
                  <label>
                    <span>链接标识</span>
                    <input name="slug" maxLength={64} defaultValue={tag.slug} />
                  </label>
                  <label>
                    <span>排序</span>
                    <input name="sortOrder" type="number" defaultValue={tag.sortOrder} />
                  </label>
                  <label className="adminTagDescriptionField">
                    <span>说明</span>
                    <input name="description" maxLength={240} defaultValue={tag.description} />
                  </label>
                  <label className="adminTagVisibleToggle">
                    <input name="isVisible" type="checkbox" defaultChecked={tag.isVisible} />
                    <span>展示</span>
                  </label>
                  <div className="adminTagRowActions">
                    <button type="submit">保存</button>
                    <button className="adminDangerButton" type="submit" formAction={deleteAdminTagAction} formNoValidate>
                      删除
                    </button>
                  </div>
                </form>
              ))}
            </div>
          ) : (
            <p className="adminInlineMessage">暂无可编辑标签。</p>
          )}
        </section>
      </article>
    </AdminFrame>
  );
}
