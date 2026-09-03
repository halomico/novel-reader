"use client";

import {
  Activity,
  FileText,
  KeyRound,
  LogOut,
  Menu,
  MessageCircle,
  Settings,
  Sparkles,
  Store,
  UserPlus,
} from "lucide-react";
import Link from "@/components/LocalizedLink";
import { AppLink } from "@/components/AppLink";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { logoutUserAction } from "@/app/account/actions";
import { localeFromPathname, uiText } from "@/lib/locale";
import { UserAvatar } from "./UserAvatar";

type HeaderUserMenuProps = {
  user:
    | {
        id: number;
        displayName: string;
        avatarPath: string | null;
        trustLevel: number;
      }
    | null;
  loginEnabled: boolean;
  registrationEnabled: boolean;
  showMarket: boolean;
  showOriginal: boolean;
  unreadMessages: number;
};

export function HeaderUserMenu({
  user,
  loginEnabled,
  registrationEnabled,
  showMarket,
  showOriginal,
  unreadMessages,
}: HeaderUserMenuProps) {
  const [open, setOpen] = useState(false);
  const locale = localeFromPathname(usePathname());
  const tr = (text: string) => uiText(locale, text);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePress(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function closeMenu() {
    setOpen(false);
  }

  return (
    <div
      className="userMenu"
      ref={menuRef}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
        if (!event.currentTarget.contains(nextTarget)) {
          closeMenu();
        }
      }}
    >
      <button
        className="iconLink userMenuButton"
        type="button"
        aria-label={tr("导航菜单")}
        aria-expanded={open}
        title={tr("导航菜单")}
        onClick={() => setOpen((value) => !value)}
      >
        <Menu size={20} aria-hidden="true" />
      </button>
      {open ? (
        <div className={user ? "userMenuPanel hasIdentity" : "userMenuPanel"}>
          {user ? (
            <>
              <AppLink className="userMenuIdentity" href="/account" onClick={closeMenu}>
                <UserAvatar className="userMenuAvatar" userId={user.id} displayName={user.displayName} avatarPath={user.avatarPath} />
                <span className="userMenuIdentityCopy">
                  <strong>{user.displayName}</strong>
                  <small>Lv.{user.trustLevel}</small>
                </span>
              </AppLink>
              <AppLink href="/account?view=growth" onClick={closeMenu}>
                <Sparkles size={16} aria-hidden="true" />
                {tr("成长")}
              </AppLink>
              <AppLink href="/activity" onClick={closeMenu}>
                <Activity size={16} aria-hidden="true" />
                {tr("动态")}
              </AppLink>
              {showMarket ? (
                <AppLink href="/market" onClick={closeMenu}>
                  <Store size={16} aria-hidden="true" />
                  {tr("集市")}
                </AppLink>
              ) : null}
              {showOriginal ? (
                <AppLink href="/original/mine" onClick={closeMenu}>
                  <FileText size={16} aria-hidden="true" />
                  {tr("文章")}
                </AppLink>
              ) : null}
              <Link href="/messages" onClick={closeMenu}>
                <MessageCircle size={16} aria-hidden="true" />
                {tr("消息")}
                {unreadMessages > 0 ? <span className="userMenuUnreadDot" aria-label={`${unreadMessages} 条未读消息`} /> : null}
              </Link>
            </>
          ) : (
            <>
              {loginEnabled ? (
                <AppLink href="/login" onClick={closeMenu}>
                  <KeyRound size={16} aria-hidden="true" />
                  {tr("登录")}
                </AppLink>
              ) : null}
              {registrationEnabled ? (
                <AppLink href="/register" onClick={closeMenu}>
                  <UserPlus size={16} aria-hidden="true" />
                  {tr("注册")}
                </AppLink>
              ) : null}
            </>
          )}
          <AppLink href="/settings" onClick={closeMenu}>
            <Settings size={16} aria-hidden="true" />
            {tr("设置")}
          </AppLink>
          {user ? (
            <form action={logoutUserAction}>
              <button type="submit">
                <LogOut size={16} aria-hidden="true" />
                {tr("退出")}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
