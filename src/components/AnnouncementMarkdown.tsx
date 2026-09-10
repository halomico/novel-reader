import ReactMarkdown from "react-markdown";

function safeHref(value: string | undefined): string | null {
  const href = value?.trim();
  if (!href) return null;
  if (href.startsWith("/") || href.startsWith("#")) return href;
  try {
    const protocol = new URL(href).protocol.toLowerCase();
    return protocol === "http:" || protocol === "https:" || protocol === "mailto:" ? href : null;
  } catch {
    return null;
  }
}

export function AnnouncementMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      skipHtml
      components={{
        a: ({ children: linkChildren, href }) => {
          const target = safeHref(href);
          return target ? (
            <a href={target} rel="noreferrer noopener">
              {linkChildren}
            </a>
          ) : (
            <span>{linkChildren}</span>
          );
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
