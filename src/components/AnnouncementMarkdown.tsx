import ReactMarkdown from "react-markdown";

export function AnnouncementMarkdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      skipHtml
      components={{
        a: ({ children: linkChildren, href }) => (
          <a href={href} rel="noreferrer noopener">
            {linkChildren}
          </a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
