export default function OriginalArticleLoading() {
  return (
    <main className="readerShell originalReaderShell" aria-busy="true" aria-label="正在加载文章">
      <div className="originalReaderLoadingHeader" aria-hidden="true" />
      <article className="readerPage originalReaderSkeleton" aria-hidden="true">
        <div className="originalReaderSkeletonTitle" />
        <div className="originalReaderSkeletonMeta" />
        <div className="originalReaderSkeletonBody">
          {Array.from({ length: 12 }, (_, index) => <span className="originalReaderSkeletonLine" key={index} />)}
        </div>
      </article>
    </main>
  );
}
