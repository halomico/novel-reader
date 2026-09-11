import { normalizeChineseSearchForms } from "@/domains/reading/content-text";

export type PostgresOriginalSearchFields = {
  titleSearchOriginal: string;
  titleSearchHans: string | null;
  contentSearchOriginal: string;
  contentSearchHans: string | null;
  normalizationVersion: number;
};

/**
 * Produces all searchable forms in one place. Only the public body is indexed: the
 * paid body never enters the search columns, so no query — and no snippet built from
 * a match — can reveal locked text, whoever is searching. Writers and the reindexer
 * must persist these fields in the same transaction as the article body.
 */
export async function createPostgresOriginalSearchFields(
  title: string,
  publicBodyMarkdown: string,
): Promise<PostgresOriginalSearchFields> {
  const [titleForms, contentForms] = await Promise.all([
    normalizeChineseSearchForms(title, "title"),
    normalizeChineseSearchForms(publicBodyMarkdown, "content"),
  ]);
  if (!titleForms.original) throw new Error("Original article title normalizes to an empty value");
  return {
    titleSearchOriginal: titleForms.original,
    titleSearchHans: titleForms.hans,
    contentSearchOriginal: contentForms.original,
    contentSearchHans: contentForms.hans,
    normalizationVersion: titleForms.version,
  };
}
