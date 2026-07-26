import { ShieldBan } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "访问暂不可用",
  robots: { index: false, follow: false },
};

export default function AccessDeniedPage() {
  return (
    <main className="accessDeniedPage">
      <span aria-hidden="true">
        <ShieldBan size={25} />
      </span>
      <h1>访问暂不可用</h1>
      <p>当前网络暂不能访问本站，请稍后再试。</p>
    </main>
  );
}
