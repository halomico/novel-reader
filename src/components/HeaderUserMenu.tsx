"use client";

import { KeyRound, LogOut, Menu, Settings, UserPlus, UserRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { logoutUserAction } from "@/app/account/actions";

type HeaderUserMenuProps = {
  user:
    | {
        displayName: string;
        avatarPath: string | null;
      }
    | null;
  loginEnabled: boolean;
  registrationEnabled: boolean;
};

export function HeaderUserMenu({ user, loginEnabled, registrationEnabled }: HeaderUserMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="userMenu"
      onBlur={(event) => {
        const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
        if (!event.currentTarget.contains(nextTarget)) {
          setOpen(false);
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
        <div className="userMenuPanel">
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
              <Link href="/account" onClick={() => setOpen(false)}>
                <UserRound size={16} aria-hidden="true" />
                用户中心
              </Link>
              <Link href="/settings" onClick={() => setOpen(false)}>
                <Settings size={16} aria-hidden="true" />
                阅读设置
              </Link>
              <form action={logoutUserAction}>
                <button type="submit">
                  <LogOut size={16} aria-hidden="true" />
                  退出登录
                </button>
              </form>
            </>
          ) : (
            <>
              {loginEnabled ? (
                <Link href="/login" onClick={() => setOpen(false)}>
                  <KeyRound size={16} aria-hidden="true" />
                  登录账号
                </Link>
              ) : null}
              {registrationEnabled ? (
                <Link href="/register" onClick={() => setOpen(false)}>
                  <UserPlus size={16} aria-hidden="true" />
                  创建账号
                </Link>
              ) : null}
              <Link href="/settings" onClick={() => setOpen(false)}>
                <Settings size={16} aria-hidden="true" />
                阅读设置
              </Link>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
