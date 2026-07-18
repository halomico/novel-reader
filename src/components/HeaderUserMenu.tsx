"use client";

import { ChevronDown, Compass, KeyRound, LogOut, Menu, Settings, UserPlus, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { logoutUserAction } from "@/app/account/actions";
import type { MediaKind } from "@/lib/media";
import { HeaderPrimaryNav } from "./HeaderPrimaryNav";

type HeaderUserMenuProps = {
  user:
    | {
        displayName: string;
        avatarPath: string | null;
      }
    | null;
  loginEnabled: boolean;
  registrationEnabled: boolean;
  mediaKinds: MediaKind[];
  showLibrary: boolean;
  showTags: boolean;
};

export function HeaderUserMenu({
  user,
  loginEnabled,
  registrationEnabled,
  mediaKinds,
  showLibrary,
  showTags,
}: HeaderUserMenuProps) {
  const [open, setOpen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const hasNavigation = showLibrary || showTags || mediaKinds.length > 0;

  function closeMenu() {
    setOpen(false);
    setNavigationOpen(false);
  }

  return (
    <div
      className="userMenu"
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
        onClick={() => {
          setOpen((value) => !value);
          setNavigationOpen(false);
        }}
      >
        <Menu size={21} aria-hidden="true" />
      </button>
      {open ? (
        <div className={user ? "userMenuPanel hasIdentity" : "userMenuPanel"}>
          {user ? (
            <>
              <div className="userMenuIdentity">
                <span className="userMenuAvatar" aria-hidden="true">
                  {user.avatarPath ? <img src={user.avatarPath} alt="" /> : <UserRound size={17} />}
                </span>
                <span>
                  <small>当前账户</small>
                  <strong>{user.displayName}</strong>
                </span>
              </div>
              <Link href="/account" onClick={closeMenu}>
                <UserRound size={16} aria-hidden="true" />
                用户中心
              </Link>
            </>
          ) : (
            <>
              {loginEnabled ? (
                <Link href="/login" onClick={closeMenu}>
                  <KeyRound size={16} aria-hidden="true" />
                  登录账号
                </Link>
              ) : null}
              {registrationEnabled ? (
                <Link href="/register" onClick={closeMenu}>
                  <UserPlus size={16} aria-hidden="true" />
                  创建账号
                </Link>
              ) : null}
            </>
          )}
          <Link href="/settings" onClick={closeMenu}>
            <Settings size={16} aria-hidden="true" />
            阅读设置
          </Link>
          {hasNavigation ? (
            <div className={navigationOpen ? "userMenuPrimaryNav isOpen" : "userMenuPrimaryNav"}>
              <button
                className="userMenuPrimaryNavToggle"
                type="button"
                aria-expanded={navigationOpen}
                onClick={() => setNavigationOpen((value) => !value)}
              >
                <Compass size={16} aria-hidden="true" />
                <span>顶部导航</span>
                <ChevronDown className="userMenuPrimaryNavChevron" size={14} aria-hidden="true" />
              </button>
              {navigationOpen ? (
                <HeaderPrimaryNav
                  className="userMenuPrimaryNavLinks"
                  ariaLabel="折叠顶部导航"
                  mediaKinds={mediaKinds}
                  showLibrary={showLibrary}
                  showTags={showTags}
                  onNavigate={closeMenu}
                />
              ) : null}
            </div>
          ) : null}
          {user ? (
            <form action={logoutUserAction}>
              <button type="submit">
                <LogOut size={16} aria-hidden="true" />
                退出登录
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
