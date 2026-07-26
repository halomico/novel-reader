"use client";

import {
  Bookmark,
  KeyRound,
  LogOut,
  Menu,
  MessageCircle,
  Settings,
  Sparkles,
  UserPlus,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { logoutUserAction } from "@/app/account/actions";
import type { MediaKind } from "@/lib/media";
import { HeaderPrimaryNav } from "./HeaderPrimaryNav";

type HeaderUserMenuProps = {
  user:
    | {
        displayName: string;
        avatarPath: string | null;
        trustLevel: number;
      }
    | null;
  loginEnabled: boolean;
  registrationEnabled: boolean;
  mediaKinds: MediaKind[];
  showLibrary: boolean;
  showTags: boolean;
  unreadMessages: number;
};

export function HeaderUserMenu({
  user,
  loginEnabled,
  registrationEnabled,
  mediaKinds,
  showLibrary,
  showTags,
  unreadMessages,
}: HeaderUserMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const hasNavigation = showLibrary || showTags || mediaKinds.length > 0;

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
        aria-label="打开导航菜单"
        aria-expanded={open}
        title="导航菜单"
        onClick={() => setOpen((value) => !value)}
      >
        <Menu size={21} aria-hidden="true" />
      </button>
      {open ? (
        <div className={user ? "userMenuPanel hasIdentity" : "userMenuPanel"}>
          {user ? (
            <>
              <Link className="userMenuIdentity" href="/account" onClick={closeMenu}>
                <span className="userMenuAvatar" aria-hidden="true">
                  {user.avatarPath ? <img src={user.avatarPath} alt="" /> : <UserRound size={18} />}
                </span>
                <span>
                  <strong>{user.displayName}</strong>
                  <small>Lv.{user.trustLevel}</small>
                </span>
              </Link>
              <Link href="/account?view=growth" onClick={closeMenu}>
                <Sparkles size={16} aria-hidden="true" />
                成长
              </Link>
              <Link href="/favorites" onClick={closeMenu}>
                <Bookmark size={16} aria-hidden="true" />
                收藏
              </Link>
              <Link href="/messages" onClick={closeMenu}>
                <MessageCircle size={16} aria-hidden="true" />
                消息
                {unreadMessages > 0 ? <span className="userMenuUnreadDot" aria-label={`${unreadMessages} 条未读消息`} /> : null}
              </Link>
            </>
          ) : (
            <>
              {loginEnabled ? (
                <Link href="/login" onClick={closeMenu}>
                  <KeyRound size={16} aria-hidden="true" />
                  登录
                </Link>
              ) : null}
              {registrationEnabled ? (
                <Link href="/register" onClick={closeMenu}>
                  <UserPlus size={16} aria-hidden="true" />
                  注册
                </Link>
              ) : null}
            </>
          )}
          <Link href="/settings" onClick={closeMenu}>
            <Settings size={16} aria-hidden="true" />
            设置
          </Link>
          {hasNavigation ? (
            <HeaderPrimaryNav
              className="userMenuPrimaryNav"
              ariaLabel="菜单导航"
              mediaKinds={mediaKinds}
              showLibrary={showLibrary}
              showTags={showTags}
              onNavigate={closeMenu}
            />
          ) : null}
          {user ? (
            <form action={logoutUserAction}>
              <button type="submit">
                <LogOut size={16} aria-hidden="true" />
                退出
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
